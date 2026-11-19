//! Numbers-only extraction from Codex CLI hook payloads and session logs ("rollouts").
//!
//! Codex hooks carry no rate limits or context size, but every session writes a JSONL
//! rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, passed to hooks as
//! `transcript_path`) whose `token_count` events hold token usage, the model's context
//! window and the 5h / weekly limits. The rollout is an internal format that can change
//! between Codex versions, so every field is optional and anything unexpected is
//! skipped. Only numbers leave this module: prompts and messages are never copied.

use serde_json::{json, Map, Value};
use std::path::Path;

/// Hook events after which the rollout may hold fresh usage or limits.
const ROLLOUT_EVENTS: &[&str] = &[
    "SessionStart",
    "PostToolUse",
    "PostModelRequest",
    "PreCompact",
    "PostCompact",
    "Stop",
];

const TOKEN_FIELDS: &[&str] = &[
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
];

/// Keep only the known integer token counters of a usage object.
pub fn numbers_only(usage: &Value) -> Option<Value> {
    let obj = usage.as_object()?;
    let out: Map<String, Value> = TOKEN_FIELDS
        .iter()
        .filter_map(|k| {
            obj.get(*k)
                .and_then(Value::as_u64)
                .map(|n| (k.to_string(), json!(n)))
        })
        .collect();
    (!out.is_empty()).then_some(Value::Object(out))
}

fn rate_window(w: &Value) -> Option<Value> {
    let used = w.get("used_percent").and_then(Value::as_f64)?;
    Some(json!({
        "used_percent": used,
        "window_minutes": w.get("window_minutes").and_then(Value::as_u64),
        // Unix seconds (current) or seconds from now (older versions).
        "resets_at": w.get("resets_at").and_then(Value::as_u64),
        "resets_in_seconds": w.get("resets_in_seconds").and_then(Value::as_u64),
    }))
}

/// Latest token usage, context window and rate limits from a rollout's tail.
/// The newest `token_count` with usage and the newest one with limits may differ
/// (limit-only updates have `info: null`), so each is taken separately.
pub fn latest_usage(jsonl: &str) -> Option<Value> {
    let mut info: Option<&Value> = None;
    let mut limits: Option<&Value> = None;
    let lines: Vec<Value> = jsonl
        .lines()
        .rev()
        .filter(|l| l.contains("\"token_count\""))
        .filter_map(|l| serde_json::from_str(l).ok())
        .take(64)
        .collect();
    for v in &lines {
        let Some(p) = v
            .get("payload")
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("token_count"))
        else {
            continue;
        };
        if info.is_none() {
            info = p.get("info").filter(|i| i.is_object());
        }
        if limits.is_none() {
            limits = p.get("rate_limits").filter(|r| r.is_object());
        }
        if info.is_some() && limits.is_some() {
            break;
        }
    }
    if info.is_none() && limits.is_none() {
        return None;
    }
    let out = json!({
        "last": info.and_then(|i| i.get("last_token_usage")).and_then(numbers_only),
        "total": info.and_then(|i| i.get("total_token_usage")).and_then(numbers_only),
        "context_window": info.and_then(|i| i.get("model_context_window")).and_then(Value::as_u64),
        "primary": limits.and_then(|l| l.get("primary")).and_then(rate_window),
        "secondary": limits.and_then(|l| l.get("secondary")).and_then(rate_window),
    });
    Some(out)
}

/// Rewrite a Codex hook payload for sending: `token_usage` is reduced to numbers and,
/// for events that follow a model response, `rollout_usage` is added. `read` returns
/// the end of a file (injected for tests). `None` = send the payload unchanged.
pub fn enrich_hook(input: &[u8], read: impl Fn(&Path) -> Option<String>) -> Option<Vec<u8>> {
    let mut v: Value = serde_json::from_slice(input).ok()?;
    let obj = v.as_object_mut()?;
    let event = obj.get("hook_event_name")?.as_str()?.to_owned();
    if let Some(tu) = obj.remove("token_usage") {
        if let Some(n) = numbers_only(&tu) {
            obj.insert("token_usage".into(), n);
        }
    }
    if ROLLOUT_EVENTS.contains(&event.as_str()) {
        let usage = obj
            .get("transcript_path")
            .and_then(Value::as_str)
            .and_then(|p| read(Path::new(p)))
            .and_then(|tail| latest_usage(&tail));
        if let Some(u) = usage {
            obj.insert("rollout_usage".into(), u);
        }
    }
    serde_json::to_vec(&v).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLLOUT: &str = r#"{"type":"session_meta","payload":{"id":"s1","cwd":"/secret"}}
{"type":"response_item","payload":{"type":"message","content":[{"type":"output_text","text":"secret"}]}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900,"cached_input_tokens":300,"output_tokens":90,"reasoning_output_tokens":40,"total_tokens":990},"last_token_usage":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":20,"total_tokens":550},"model_context_window":272000},"rate_limits":{"primary":{"used_percent":12.5,"window_minutes":300,"resets_at":1763500000},"secondary":{"used_percent":40.0,"window_minutes":10080,"resets_at":1764000000}}}}
{"type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":13.0,"window_minutes":300,"resets_in_seconds":600}}}}
"#;

    #[test]
    fn latest_usage_combines_newest_info_and_newest_limits() {
        let u = latest_usage(ROLLOUT).unwrap();
        assert_eq!(u["last"]["input_tokens"], 500);
        assert_eq!(u["last"]["cached_input_tokens"], 200);
        assert_eq!(u["total"]["total_tokens"], 990);
        assert_eq!(u["context_window"], 272000);
        assert_eq!(u["primary"]["used_percent"], 13.0);
        assert_eq!(u["primary"]["resets_in_seconds"], 600);
        // The newest limits update had no secondary window.
        assert!(u["secondary"].is_null());
        assert!(!u.to_string().contains("secret"));
    }

    #[test]
    fn latest_usage_is_null_safe() {
        assert!(latest_usage("").is_none());
        assert!(latest_usage("not json\n{\"type\":\"token_count\"}").is_none());
    }

    #[test]
    fn enrich_adds_rollout_usage_and_strips_token_usage() {
        let hook = json!({"hook_event_name": "PostModelRequest", "transcript_path": "/r.jsonl",
            "token_usage": {"input_tokens": 5, "output_tokens": 6, "note": "x"}})
        .to_string();
        let out: Value = serde_json::from_slice(
            &enrich_hook(hook.as_bytes(), |_| Some(ROLLOUT.into())).unwrap(),
        )
        .unwrap();
        assert_eq!(
            out["token_usage"],
            json!({"input_tokens": 5, "output_tokens": 6})
        );
        assert_eq!(out["rollout_usage"]["context_window"], 272000);

        let pre =
            json!({"hook_event_name": "PreToolUse", "transcript_path": "/r.jsonl"}).to_string();
        let out: Value =
            serde_json::from_slice(&enrich_hook(pre.as_bytes(), |_| Some(ROLLOUT.into())).unwrap())
                .unwrap();
        assert!(out.get("rollout_usage").is_none());
        assert!(enrich_hook(b"not json", |_| None).is_none());
    }
}
