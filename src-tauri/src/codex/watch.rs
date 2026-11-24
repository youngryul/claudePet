//! Hook-free Codex integration: follow the session logs ("rollouts") Codex writes for
//! every session, whichever surface started it (CLI, desktop app, IDE extension).
//!
//! `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` gets one JSON line per item. New
//! lines are mapped onto the same payload shape as a Codex hook (`hook_event_name`, …)
//! and published through the collector, so the UI reuses its hook parser. Lines carry
//! prompts and replies; only event names, ids, the model, tool names and token / limit
//! numbers are taken from them (the collector's whitelist applies again on publish).
//!
//! Hooks stay optional: when they are connected and trusted they react a little faster,
//! and the UI then ignores the log for that session so nothing is counted twice.

use crate::collector::server::{self, CollectorEvent, CollectorState};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

const POLL: Duration = Duration::from_secs(1);
const IDLE_POLL: Duration = Duration::from_secs(5);
/// Files untouched for this long are no longer followed.
const ACTIVE_WINDOW: Duration = Duration::from_secs(3 * 3600);
/// Upper bound read from one file per tick (a busy session writes far less).
const MAX_READ: u64 = 4 * 1024 * 1024;
/// `session_meta` embeds the system prompt, so the first line can be long.
const MAX_FIRST_LINE: u64 = 1024 * 1024;
/// Payload marker so the UI can tell log events from real hooks.
pub const VIA: &str = "session_log";

pub fn sessions_dir() -> Option<PathBuf> {
    super::home_dir().map(|d| d.join("sessions"))
}

/// Per-file state while a session log is followed.
#[derive(Default)]
struct Tail {
    offset: u64,
    ctx: SessionCtx,
}

/// What earlier lines of the same file told us.
#[derive(Default, Debug, Clone)]
pub struct SessionCtx {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub turn_id: Option<String>,
}

pub fn spawn(app: AppHandle, state: Arc<CollectorState>) {
    let started = SystemTime::now();
    let _ = std::thread::Builder::new()
        .name("codex-session-log".into())
        .spawn(move || {
            let mut tails: HashMap<PathBuf, Tail> = HashMap::new();
            loop {
                let Some(root) = sessions_dir().filter(|d| d.is_dir()) else {
                    std::thread::sleep(IDLE_POLL);
                    continue;
                };
                let active = active_files(&root, SystemTime::now());
                tails.retain(|p, _| active.contains(p));
                for path in active {
                    let tail = tails
                        .entry(path.clone())
                        .or_insert_with(|| open_tail(&path, started));
                    for payload in read_new(&path, tail) {
                        publish(&app, &state, payload);
                    }
                }
                std::thread::sleep(POLL);
            }
        });
}

fn publish(app: &AppHandle, state: &CollectorState, payload: Value) {
    let payload = server::sanitize("codex", "hook", payload);
    server::publish(
        app,
        state,
        CollectorEvent {
            provider: "codex".into(),
            channel: "hook".into(),
            received_at: crate::paths::now_ms(),
            payload,
        },
    );
}

/// Newest entries of a directory by name (`YYYY`, `MM`, `DD` sort chronologically).
fn newest(dir: &Path, n: usize) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|it| it.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    v.sort();
    v.into_iter().rev().take(n).collect()
}

/// Rollouts written to recently. Only the newest day folders are listed, so the cost
/// stays flat however much history the user has.
fn active_files(root: &Path, now: SystemTime) -> Vec<PathBuf> {
    let mut out = vec![];
    for year in newest(root, 2) {
        for month in newest(&year, 2) {
            for day in newest(&month, 3) {
                let Ok(it) = std::fs::read_dir(&day) else { continue };
                for e in it.flatten() {
                    let p = e.path();
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
                        continue;
                    }
                    let fresh = e
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|m| now.duration_since(m).ok())
                        .is_some_and(|age| age < ACTIVE_WINDOW);
                    if fresh {
                        out.push(p);
                    }
                }
            }
        }
    }
    out
}

/// Start following a file. A session that began while the app runs is read from the
/// top (so its start is seen); an older one from its end, so history is never replayed
/// (that would re-count tokens). The first line is still read for the session id.
fn open_tail(path: &Path, started: SystemTime) -> Tail {
    let meta = std::fs::metadata(path).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let new_session = meta
        .and_then(|m| m.created().ok())
        .is_some_and(|c| c >= started);
    let mut ctx = SessionCtx {
        session_id: id_from_file_name(path),
        ..Default::default()
    };
    if !new_session {
        if let Some(first) = first_line(path) {
            map_line(&first, &mut ctx);
        }
    }
    Tail {
        offset: if new_session { 0 } else { len },
        ctx,
    }
}

fn first_line(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(f.take(MAX_FIRST_LINE))
        .read_line(&mut line)
        .ok()?;
    Some(line)
}

/// `rollout-2026-11-24T10-00-00-<uuid>.jsonl` -> `<uuid>` (fallback before session_meta).
fn id_from_file_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    (id.len() == 36 && id.chars().filter(|c| *c == '-').count() == 4).then(|| id.to_owned())
}

/// Read complete lines appended since the last tick and map them to payloads.
fn read_new(path: &Path, tail: &mut Tail) -> Vec<Value> {
    let Ok(mut f) = std::fs::File::open(path) else {
        return vec![];
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < tail.offset {
        // Truncated or replaced: follow from the new end.
        tail.offset = len;
    }
    if len == tail.offset || f.seek(SeekFrom::Start(tail.offset)).is_err() {
        return vec![];
    }
    let mut buf = Vec::new();
    if f.take(MAX_READ).read_to_end(&mut buf).is_err() {
        return vec![];
    }
    // Only whole lines; a line still being written is picked up next tick.
    let Some(end) = buf.iter().rposition(|b| *b == b'\n') else {
        if buf.len() as u64 >= MAX_READ {
            tail.offset += buf.len() as u64; // a single oversized line: skip it
        }
        return vec![];
    };
    tail.offset += end as u64 + 1;
    String::from_utf8_lossy(&buf[..end])
        .lines()
        .filter_map(|l| map_line(l, &mut tail.ctx))
        .collect()
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(str::to_owned)
}

/// One rollout line -> a hook-shaped payload, or `None` for lines that only update
/// `ctx` or that the pet does not care about. Unknown shapes are ignored.
pub fn map_line(line: &str, ctx: &mut SessionCtx) -> Option<Value> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let outer = v.get("type")?.as_str()?;
    let p = v.get("payload").unwrap_or(&Value::Null);
    let inner = p.get("type").and_then(Value::as_str).unwrap_or("");

    let mut extra = Map::new();
    let event = match (outer, inner) {
        ("session_meta", _) => {
            if let Some(id) = s(p, "id").or_else(|| s(p, "session_id")) {
                ctx.session_id = Some(id);
            }
            "SessionStart"
        }
        ("turn_context", _) => {
            if let Some(m) = s(p, "model") {
                ctx.model = Some(m);
            }
            if let Some(t) = s(p, "turn_id") {
                ctx.turn_id = Some(t);
            }
            return None;
        }
        ("event_msg", "task_started") | ("event_msg", "user_message") => "UserPromptSubmit",
        ("event_msg", "task_complete") => "Stop",
        ("event_msg", "turn_aborted") => "Interrupt",
        ("event_msg", "token_count") => {
            let usage = super::rollout::latest_usage(line)?;
            extra.insert("rollout_usage".into(), usage);
            extra.insert("status".into(), json!("completed"));
            "PostModelRequest"
        }
        ("event_msg", "error") => {
            extra.insert("status".into(), json!("failed"));
            extra.insert("error".into(), json!("model_request_failed"));
            "PostModelRequest"
        }
        ("response_item", "function_call" | "custom_tool_call") => {
            if let Some(n) = s(p, "name") {
                extra.insert("tool_name".into(), json!(n));
            }
            "PreToolUse"
        }
        ("response_item", "local_shell_call") => {
            extra.insert("tool_name".into(), json!("shell"));
            "PreToolUse"
        }
        ("response_item", "web_search_call") => {
            extra.insert("tool_name".into(), json!("web_search"));
            "PreToolUse"
        }
        ("event_msg", "mcp_tool_call_begin") => {
            if let Some(n) = p.pointer("/invocation/tool").and_then(Value::as_str) {
                extra.insert("tool_name".into(), json!(n));
            }
            "PreToolUse"
        }
        ("response_item", "function_call_output" | "custom_tool_call_output")
        | ("event_msg", "mcp_tool_call_end" | "exec_command_end" | "patch_apply_end") => {
            "PostToolUse"
        }
        ("compacted", _) => "PostCompact",
        _ => return None,
    };

    let mut out = Map::new();
    out.insert("hook_event_name".into(), json!(event));
    out.insert("via".into(), json!(VIA));
    if let Some(id) = &ctx.session_id {
        out.insert("session_id".into(), json!(id));
    }
    if let Some(m) = &ctx.model {
        out.insert("model".into(), json!(m));
    }
    if let Some(t) = &ctx.turn_id {
        out.insert("turn_id".into(), json!(t));
    }
    if event == "SessionStart" {
        out.insert("source".into(), json!("startup"));
    }
    out.extend(extra);
    Some(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    const META: &str = r#"{"timestamp":"2026-11-24T01:00:00Z","type":"session_meta","payload":{"id":"0199a213-81c0-7800-8aa1-bbab2a035a53","cwd":"/secret","originator":"codex_desktop","base_instructions":{"text":"secret"}}}"#;

    fn run(lines: &[&str]) -> Vec<Value> {
        let mut ctx = SessionCtx::default();
        lines.iter().filter_map(|l| map_line(l, &mut ctx)).collect()
    }

    #[test]
    fn maps_a_turn_to_hook_events() {
        let out = run(&[
            META,
            r#"{"type":"turn_context","payload":{"turn_id":"t1","model":"gpt-5.5-codex","cwd":"/secret"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_started","model_context_window":272000}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"secret prompt"}}"#,
            r#"{"type":"response_item","payload":{"type":"reasoning","encrypted_content":"x"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":\"secret\"}","call_id":"c1"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"secret"}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12},"model_context_window":272000},"rate_limits":{"primary":{"used_percent":5.0,"window_minutes":300}}}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"secret reply"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"secret"}}"#,
        ]);
        let events: Vec<&str> = out.iter().map(|v| v["hook_event_name"].as_str().unwrap()).collect();
        assert_eq!(
            events,
            ["SessionStart", "UserPromptSubmit", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostModelRequest", "Stop"]
        );
        assert!(out.iter().all(|v| v["session_id"] == "0199a213-81c0-7800-8aa1-bbab2a035a53" && v["via"] == VIA));
        assert_eq!(out[3]["tool_name"], "shell");
        assert_eq!(out[3]["model"], "gpt-5.5-codex");
        assert_eq!(out[5]["rollout_usage"]["context_window"], 272000);
        assert_eq!(out[5]["rollout_usage"]["primary"]["used_percent"], 5.0);
        let all = serde_json::to_string(&out).unwrap();
        assert!(!all.contains("secret"), "no prompt, reply, tool io or path leaks: {all}");
    }

    #[test]
    fn ignores_garbage_and_unknown_lines() {
        assert!(run(&["", "not json", r#"{"type":"world_state","payload":{}}"#, r#"{"payload":{}}"#]).is_empty());
    }

    #[test]
    fn session_id_from_file_name() {
        let p = Path::new("/x/rollout-2026-11-24T10-00-00-0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl");
        assert_eq!(id_from_file_name(p).as_deref(), Some("0199a213-81c0-7800-8aa1-bbab2a035a53"));
        assert_eq!(id_from_file_name(Path::new("/x/short.jsonl")), None);
    }

    #[test]
    fn follows_only_whole_appended_lines() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("2026").join("11").join("24");
        std::fs::create_dir_all(&day).unwrap();
        let f = day.join("rollout-2026-11-24T10-00-00-0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl");
        std::fs::write(&f, format!("{META}\n")).unwrap();

        // Already existing when the app started: skip history, keep the id.
        let mut tail = open_tail(&f, SystemTime::now() + Duration::from_secs(60));
        assert!(read_new(&f, &mut tail).is_empty());
        assert_eq!(tail.ctx.session_id.as_deref(), Some("0199a213-81c0-7800-8aa1-bbab2a035a53"));

        use std::io::Write;
        let mut w = std::fs::OpenOptions::new().append(true).open(&f).unwrap();
        write!(w, "{}\n{}", r#"{"type":"event_msg","payload":{"type":"task_started"}}"#, r#"{"type":"event_msg","payload":{"type":"task_comp"#).unwrap();
        let got = read_new(&f, &mut tail);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["hook_event_name"], "UserPromptSubmit");
        writeln!(w, "{}", r#"lete"}}"#).unwrap();
        let got = read_new(&f, &mut tail);
        assert_eq!(got[0]["hook_event_name"], "Stop");

        assert_eq!(active_files(dir.path(), SystemTime::now()), vec![f.clone()]);
        assert!(active_files(dir.path(), SystemTime::now() + ACTIVE_WINDOW * 2).is_empty());
    }
}
