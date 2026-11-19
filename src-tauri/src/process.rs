//! Detects whether a Claude Code CLI process is running. Used only to distinguish
//! "offline" from "idle" (a DERIVED_STATE); no process data leaves this machine.

use std::sync::Mutex;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Default)]
pub struct ProcessProbe(Mutex<Option<System>>);

fn looks_like_claude_code(name: &str, cmd: &[std::ffi::OsString]) -> bool {
    // Native installer: `claude` / `claude.exe` (case-sensitive, so the "Claude"
    // desktop app does not match). npm installs run under node.
    if name == "claude" || name == "claude.exe" {
        return true;
    }
    let is_node = name == "node" || name == "node.exe";
    is_node
        && cmd.iter().any(|a| {
            let a = a.to_string_lossy();
            a.contains("@anthropic-ai/claude-code")
                || a.ends_with("/claude")
                || a.ends_with("\\claude")
        })
}

/// Codex CLI is a native `codex` binary (the npm package launches it from node, and
/// the Codex desktop app runs it as its app server, where hooks fire too).
fn looks_like_codex(name: &str, cmd: &[std::ffi::OsString]) -> bool {
    if name == "codex" || name == "codex.exe" {
        return true;
    }
    let is_node = name == "node" || name == "node.exe";
    is_node && cmd.iter().any(|a| a.to_string_lossy().contains("@openai/codex"))
}

impl ProcessProbe {
    fn any_process(&self, matches: fn(&str, &[std::ffi::OsString]) -> bool) -> bool {
        let mut guard = self.0.lock().unwrap();
        let sys = guard.get_or_insert_with(System::new);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
        );
        sys.processes()
            .values()
            .any(|p| matches(&p.name().to_string_lossy(), p.cmd()))
    }

    pub fn claude_running(&self) -> bool {
        self.any_process(looks_like_claude_code)
    }

    pub fn codex_running(&self) -> bool {
        self.any_process(looks_like_codex)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_cli_but_not_desktop_app() {
        assert!(looks_like_claude_code("claude", &[]));
        assert!(looks_like_claude_code("claude.exe", &[]));
        assert!(!looks_like_claude_code("Claude", &[]));
        assert!(looks_like_claude_code(
            "node",
            &["/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js".into()]
        ));
        assert!(!looks_like_claude_code("node", &["server.js".into()]));
    }

    #[test]
    fn matches_codex_binary_and_npm_launcher() {
        assert!(looks_like_codex("codex.exe", &[]));
        assert!(looks_like_codex(
            "node",
            &["C:/npm/node_modules/@openai/codex/bin/codex.js".into()]
        ));
        assert!(!looks_like_codex("node", &["server.js".into()]));
        assert!(!looks_like_codex("claude", &[]));
    }
}
