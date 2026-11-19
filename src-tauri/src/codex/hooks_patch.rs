//! Pure functions that add/remove *only our* entries in Codex's `hooks.json`.
//!
//! The file has the same `{"hooks": {Event: [matcher groups]}}` layout as Claude Code's
//! settings, so the marker-based helpers from `claude::settings_patch` are reused.
//! Everything else in the file (other hooks, key order) is preserved.

use crate::claude::settings_patch::{change, event_has_our_hook, strip_ours, Change};
use serde::Serialize;
use serde_json::{Map, Value};

/// Hook events we subscribe to (https://learn.chatgpt.com/docs/hooks). PreModelRequest
/// is skipped: it fires on every retry and adds nothing UserPromptSubmit does not.
pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "PostModelRequest",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "Interrupt",
    "SessionEnd",
];

/// Codex caps these at 3 seconds and always runs SessionEnd synchronously.
const SHORT_EVENTS: &[&str] = &["Interrupt", "SessionEnd"];

#[derive(Debug, Clone)]
pub struct CodexCommands {
    /// POSIX shell form (`sh -lc` on macOS/Linux).
    pub command: String,
    /// `cmd.exe /C` form, set on Windows only (Codex's `commandWindows` override).
    pub command_windows: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexHookStatus {
    pub connected_hooks: Vec<String>,
    pub missing_hooks: Vec<String>,
    pub fully_connected: bool,
}

pub fn inspect(file: &Value) -> CodexHookStatus {
    let hooks = file.get("hooks");
    let (connected, missing): (Vec<&str>, Vec<&str>) = HOOK_EVENTS.iter().partition(|e| {
        hooks
            .and_then(|h| h.get(**e))
            .map(event_has_our_hook)
            .unwrap_or(false)
    });
    CodexHookStatus {
        fully_connected: missing.is_empty(),
        connected_hooks: connected.into_iter().map(String::from).collect(),
        missing_hooks: missing.into_iter().map(String::from).collect(),
    }
}

fn handler(event: &str, cmds: &CodexCommands) -> Value {
    let short = SHORT_EVENTS.contains(&event);
    let mut h = Map::new();
    h.insert("type".into(), "command".into());
    h.insert("command".into(), cmds.command.clone().into());
    if let Some(w) = &cmds.command_windows {
        h.insert("commandWindows".into(), w.clone().into());
    }
    if !short {
        h.insert("async".into(), true.into());
    }
    h.insert("timeout".into(), (if short { 3 } else { 10 }).into());
    Value::Object(h)
}

pub fn apply_connect(file: &Value, cmds: &CodexCommands) -> Result<(Value, Vec<Change>), String> {
    let mut root = match file {
        Value::Object(m) => m.clone(),
        Value::Null => Map::new(),
        _ => return Err("hooks.json root is not a JSON object".into()),
    };
    let hooks_val = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(hooks) = hooks_val else {
        return Err("\"hooks\" in hooks.json is not an object".into());
    };
    let mut added = vec![];
    let mut updated = false;
    for event in HOOK_EVENTS {
        let entry = hooks
            .entry(event.to_string())
            .or_insert_with(|| Value::Array(vec![]));
        let Value::Array(groups) = entry else {
            return Err(format!("hooks.{event} in hooks.json is not an array"));
        };
        let had = event_has_our_hook(&Value::Array(groups.clone()));
        let before = groups.clone();
        strip_ours(groups);
        groups.push(serde_json::json!({ "hooks": [handler(event, cmds)] }));
        if !had {
            added.push(*event);
        } else if *groups != before {
            updated = true;
        }
    }
    let mut changes = vec![];
    if !added.is_empty() {
        changes.push(change(
            "add",
            format!("Add read-only hooks: {}", added.join(", ")),
        ));
    }
    if updated {
        changes.push(change("update", "Update AI Coding Pet hook commands"));
    }
    Ok((Value::Object(root), changes))
}

/// Remove only our handlers; groups and events that become empty because of us go too.
pub fn apply_disconnect(file: &Value) -> Result<(Value, Vec<Change>), String> {
    let mut root = match file {
        Value::Object(m) => m.clone(),
        Value::Null => return Ok((Value::Object(Map::new()), vec![])),
        _ => return Err("hooks.json root is not a JSON object".into()),
    };
    let mut changes = vec![];
    let mut remove_hooks_key = false;
    if let Some(Value::Object(hooks)) = root.get_mut("hooks") {
        let mut removed = vec![];
        let keys: Vec<String> = hooks.keys().cloned().collect();
        for key in keys {
            let Some(Value::Array(groups)) = hooks.get_mut(&key) else {
                continue;
            };
            if strip_ours(groups) {
                removed.push(key.clone());
                if groups.is_empty() {
                    hooks.remove(&key);
                }
            }
        }
        if !removed.is_empty() {
            changes.push(change(
                "remove",
                format!("Remove AI Coding Pet hooks: {}", removed.join(", ")),
            ));
            remove_hooks_key = hooks.is_empty();
        }
    }
    if remove_hooks_key {
        root.remove("hooks");
    }
    Ok((Value::Object(root), changes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collector::MARKER;
    use serde_json::json;

    fn cmds() -> CodexCommands {
        CodexCommands {
            command: format!("'/app/pet' codex-hook {MARKER}"),
            command_windows: Some(format!("\"C:\\app\\pet.exe\" codex-hook {MARKER}")),
        }
    }

    fn user_file() -> Value {
        json!({
            "hooks": {
                "PreToolUse": [
                    {"matcher": "^Bash$", "hooks": [{"type": "command", "command": "~/guard.sh"}]}
                ]
            }
        })
    }

    #[test]
    fn connect_keeps_user_hooks_and_is_idempotent() {
        let (once, changes) = apply_connect(&user_file(), &cmds()).unwrap();
        assert_eq!(changes.len(), 1);
        let pre = once["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[0]["hooks"][0]["command"], "~/guard.sh");
        assert!(inspect(&once).fully_connected);
        let (twice, changes) = apply_connect(&once, &cmds()).unwrap();
        assert_eq!(once, twice);
        assert!(changes.is_empty());
    }

    #[test]
    fn short_events_are_sync_with_small_timeout() {
        let (out, _) = apply_connect(&json!({}), &cmds()).unwrap();
        let end = &out["hooks"]["SessionEnd"][0]["hooks"][0];
        assert_eq!(end["timeout"], 3);
        assert!(end.get("async").is_none());
        let stop = &out["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(stop["async"], true);
        assert!(stop["commandWindows"]
            .as_str()
            .unwrap()
            .contains("codex-hook"));
    }

    #[test]
    fn disconnect_restores_original() {
        let (connected, _) = apply_connect(&user_file(), &cmds()).unwrap();
        let (restored, _) = apply_disconnect(&connected).unwrap();
        assert_eq!(restored, user_file());
        let (fresh, _) = apply_connect(&Value::Null, &cmds()).unwrap();
        assert_eq!(apply_disconnect(&fresh).unwrap().0, json!({}));
    }

    #[test]
    fn rejects_malformed_structures() {
        assert!(apply_connect(&json!([]), &cmds()).is_err());
        assert!(apply_connect(&json!({"hooks": []}), &cmds()).is_err());
        assert!(apply_connect(&json!({"hooks": {"Stop": {}}}), &cmds()).is_err());
    }
}
