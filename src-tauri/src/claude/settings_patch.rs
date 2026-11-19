//! Pure functions that add/remove *only our* entries in Claude Code's settings.json.
//!
//! Everything else in the file is preserved (including key order, thanks to
//! serde_json's `preserve_order`). Our entries are identified by `collector::MARKER`
//! inside the command string.

use crate::collector::MARKER;
use serde::Serialize;
use serde_json::{Map, Value};

/// Hook events we subscribe to. All exist in Claude Code >= 2.1.78 (StopFailure was the
/// most recent addition). Verified against https://code.claude.com/docs/en/hooks.
pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "SessionEnd",
];

#[derive(Debug, Clone)]
pub struct PetCommands {
    pub statusline: String,
    pub hook: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: String,
    pub description: String,
}

pub(crate) fn change(kind: &str, description: impl Into<String>) -> Change {
    Change {
        kind: kind.into(),
        description: description.into(),
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub status_line_connected: bool,
    pub connected_hooks: Vec<String>,
    pub missing_hooks: Vec<String>,
    /// A statusLine exists that is not ours (will be wrapped/chained, not lost).
    pub foreign_status_line: Option<Value>,
    pub fully_connected: bool,
}

pub fn is_ours(command: &str) -> bool {
    command.contains(MARKER)
}

pub(crate) fn handler_is_ours(handler: &Value) -> bool {
    handler
        .get("command")
        .and_then(Value::as_str)
        .map(is_ours)
        .unwrap_or(false)
}

fn status_line_is_ours(sl: &Value) -> bool {
    sl.get("command")
        .and_then(Value::as_str)
        .map(is_ours)
        .unwrap_or(false)
}

pub(crate) fn event_has_our_hook(groups: &Value) -> bool {
    groups
        .as_array()
        .map(|gs| {
            gs.iter().any(|g| {
                g.get("hooks")
                    .and_then(Value::as_array)
                    .map(|hs| hs.iter().any(handler_is_ours))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub fn inspect(settings: &Value) -> ConnectionStatus {
    let sl = settings.get("statusLine");
    let status_line_connected = sl.map(status_line_is_ours).unwrap_or(false);
    let foreign_status_line = sl.filter(|s| !status_line_is_ours(s)).cloned();
    let hooks = settings.get("hooks");
    let (connected, missing): (Vec<&str>, Vec<&str>) = HOOK_EVENTS.iter().partition(|e| {
        hooks
            .and_then(|h| h.get(**e))
            .map(event_has_our_hook)
            .unwrap_or(false)
    });
    ConnectionStatus {
        status_line_connected,
        fully_connected: status_line_connected && missing.is_empty(),
        connected_hooks: connected.into_iter().map(String::from).collect(),
        missing_hooks: missing.into_iter().map(String::from).collect(),
        foreign_status_line,
    }
}

/// Remove our handlers from one event's matcher groups. Groups that become empty
/// because of us are dropped; groups the user left empty are kept. Returns true if
/// anything changed.
pub(crate) fn strip_ours(groups: &mut Vec<Value>) -> bool {
    let before = groups.len();
    let mut changed = false;
    groups.retain_mut(|g| match g.get_mut("hooks").and_then(Value::as_array_mut) {
        Some(hs) => {
            let n = hs.len();
            hs.retain(|h| !handler_is_ours(h));
            changed |= hs.len() != n;
            !(hs.len() != n && hs.is_empty())
        }
        None => true,
    });
    changed || groups.len() != before
}

/// Add our statusLine + hooks. `original_status_line` receives the user's previous
/// statusLine the first time we replace it (the caller persists it for restore/chaining).
pub fn apply_connect(
    settings: &Value,
    cmds: &PetCommands,
    original_status_line: &mut Option<Value>,
) -> Result<(Value, Vec<Change>), String> {
    let mut root = match settings {
        Value::Object(m) => m.clone(),
        Value::Null => Map::new(),
        _ => return Err("settings.json root is not a JSON object".into()),
    };
    let mut changes = vec![];

    // statusLine
    let mut new_sl = Map::new();
    new_sl.insert("type".into(), Value::String("command".into()));
    new_sl.insert("command".into(), Value::String(cmds.statusline.clone()));
    match root.get("statusLine") {
        Some(existing) if status_line_is_ours(existing) => {
            if existing.get("command").and_then(Value::as_str) != Some(cmds.statusline.as_str()) {
                changes.push(change(
                    "update",
                    "Update AI Coding Pet statusLine command path",
                ));
            }
            copy_display_fields(existing, &mut new_sl);
        }
        Some(existing) => {
            if original_status_line.is_none() {
                *original_status_line = Some(existing.clone());
            }
            copy_display_fields(existing, &mut new_sl);
            changes.push(change(
                "wrap",
                "Wrap your existing statusLine: AI Coding Pet runs it and shows its output \
                 unchanged. It is restored on Disconnect.",
            ));
        }
        None => changes.push(change(
            "add",
            "Add statusLine collector (prints a compact status line)",
        )),
    }
    root.insert("statusLine".into(), Value::Object(new_sl));

    // hooks
    let hooks_val = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(hooks) = hooks_val else {
        return Err("\"hooks\" in settings.json is not an object".into());
    };
    let mut added = vec![];
    for event in HOOK_EVENTS {
        let entry = hooks
            .entry(event.to_string())
            .or_insert_with(|| Value::Array(vec![]));
        let Value::Array(groups) = entry else {
            return Err(format!("hooks.{event} in settings.json is not an array"));
        };
        let had = event_has_our_hook(&Value::Array(groups.clone()));
        strip_ours(groups);
        groups.push(serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": cmds.hook,
                "async": true,
                "timeout": 10
            }]
        }));
        if !had {
            added.push(*event);
        }
    }
    if !added.is_empty() {
        changes.push(change(
            "add",
            format!("Add async, read-only hooks: {}", added.join(", ")),
        ));
    }
    Ok((Value::Object(root), changes))
}

fn copy_display_fields(from: &Value, to: &mut Map<String, Value>) {
    for key in ["padding", "refreshInterval"] {
        if let Some(v) = from.get(key) {
            to.insert(key.into(), v.clone());
        }
    }
}

/// Remove only our entries. Restores the user's original statusLine if we had wrapped one.
pub fn apply_disconnect(
    settings: &Value,
    original_status_line: Option<&Value>,
) -> Result<(Value, Vec<Change>), String> {
    let mut root = match settings {
        Value::Object(m) => m.clone(),
        Value::Null => return Ok((Value::Object(Map::new()), vec![])),
        _ => return Err("settings.json root is not a JSON object".into()),
    };
    let mut changes = vec![];

    if root
        .get("statusLine")
        .map(status_line_is_ours)
        .unwrap_or(false)
    {
        match original_status_line {
            Some(orig) => {
                root.insert("statusLine".into(), orig.clone());
                changes.push(change("restore", "Restore your original statusLine"));
            }
            None => {
                root.remove("statusLine");
                changes.push(change("remove", "Remove AI Coding Pet statusLine"));
            }
        }
    }

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
    use serde_json::json;

    fn cmds() -> PetCommands {
        PetCommands {
            statusline: format!("\"/app/pet\" claude-statusline {MARKER}"),
            hook: format!("\"/app/pet\" claude-hook {MARKER}"),
        }
    }

    fn user_settings() -> Value {
        json!({
            "theme": "dark",
            "enabledPlugins": {"x": true},
            "statusLine": {"type": "command", "command": "~/.claude/sl.sh", "padding": 2},
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Bash", "hooks": [{"type": "command", "command": "~/check.sh"}]}
                ]
            }
        })
    }

    #[test]
    fn connect_preserves_user_settings_and_wraps_statusline() {
        let mut orig = None;
        let (out, changes) = apply_connect(&user_settings(), &cmds(), &mut orig).unwrap();
        assert_eq!(out["theme"], "dark");
        assert_eq!(out["enabledPlugins"]["x"], true);
        assert_eq!(orig.unwrap()["command"], "~/.claude/sl.sh");
        assert!(is_ours(out["statusLine"]["command"].as_str().unwrap()));
        assert_eq!(out["statusLine"]["padding"], 2);
        let pre = out["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[0]["hooks"][0]["command"], "~/check.sh");
        assert!(inspect(&out).fully_connected);
        assert!(changes.iter().any(|c| c.kind == "wrap"));
        // key order preserved
        let keys: Vec<_> = out.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys[0], "theme");
    }

    #[test]
    fn connect_is_idempotent() {
        let mut orig = None;
        let (once, _) = apply_connect(&user_settings(), &cmds(), &mut orig).unwrap();
        let (twice, changes) = apply_connect(&once, &cmds(), &mut orig).unwrap();
        assert_eq!(once, twice);
        assert!(changes.is_empty());
        assert_eq!(orig.unwrap()["command"], "~/.claude/sl.sh");
    }

    #[test]
    fn disconnect_restores_exact_original() {
        let original = user_settings();
        let mut orig = None;
        let (connected, _) = apply_connect(&original, &cmds(), &mut orig).unwrap();
        let (restored, _) = apply_disconnect(&connected, orig.as_ref()).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn disconnect_on_fresh_settings_removes_everything_we_added() {
        let mut orig = None;
        let (connected, _) = apply_connect(&json!({}), &cmds(), &mut orig).unwrap();
        assert!(orig.is_none());
        let (restored, _) = apply_disconnect(&connected, None).unwrap();
        assert_eq!(restored, json!({}));
    }

    #[test]
    fn rejects_malformed_structures() {
        let mut orig = None;
        assert!(apply_connect(&json!([]), &cmds(), &mut orig).is_err());
        assert!(apply_connect(&json!({"hooks": []}), &cmds(), &mut orig).is_err());
        assert!(apply_connect(&json!({"hooks": {"Stop": {}}}), &cmds(), &mut orig).is_err());
    }

    #[test]
    fn shared_group_keeps_user_handler() {
        let s = json!({"hooks": {"Stop": [{"hooks": [
            {"type": "command", "command": "~/mine.sh"},
            {"type": "command", "command": format!("x claude-hook {MARKER}")}
        ]}]}});
        let (out, _) = apply_disconnect(&s, None).unwrap();
        assert_eq!(
            out,
            json!({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "~/mine.sh"}]}]}})
        );
    }
}
