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

impl ProcessProbe {
    pub fn claude_running(&self) -> bool {
        let mut guard = self.0.lock().unwrap();
        let sys = guard.get_or_insert_with(System::new);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
        );
        sys.processes()
            .values()
            .any(|p| looks_like_claude_code(&p.name().to_string_lossy(), p.cmd()))
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
}
