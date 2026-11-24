//! OpenAI Codex integration. The pet follows Codex's session logs without any setup
//! (`watch`), which covers the CLI, the desktop app and IDE extensions alike. Hooks
//! are an optional extra for slightly faster reactions: detection, `hooks.json`
//! preview/patch and a connection test live here.
//!
//! The hooks flow is the same as the Claude integration: detect -> read `$CODEX_HOME/hooks.json` -> show
//! a preview -> user approves -> patch with backup and a hash check -> test. Codex only
//! runs hooks the user has trusted, so after connecting the user approves them once in
//! Codex (`/hooks` in the CLI, or Settings > Hooks in the app).

pub mod hooks_patch;
pub mod rollout;
pub mod watch;

use crate::claude::settings_patch::Change;
use crate::claude::{claude_version as cli_version, exe_path, no_window, pretty, sha256_hex};
use crate::collector::{server::CollectorState, MARKER};
use hooks_patch::{CodexCommands, CodexHookStatus};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

/// `CODEX_HOME` overrides the default `~/.codex` (documented by Codex).
pub fn home_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(dir));
    }
    dirs::home_dir().map(|h| h.join(".codex"))
}

pub fn hooks_path() -> Option<PathBuf> {
    home_dir().map(|d| d.join("hooks.json"))
}

fn cli_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex.exe", "codex.cmd"]
    } else {
        &["codex"]
    }
}

/// GUI apps get a minimal PATH, so also probe the usual install locations.
pub fn find_codex_cli() -> Option<PathBuf> {
    let mut dirs_to_check: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        dirs_to_check.push(home.join(".local").join("bin"));
        dirs_to_check.push(home.join(".npm-global").join("bin"));
        dirs_to_check.push(home.join(".bun").join("bin"));
    }
    #[cfg(not(windows))]
    {
        dirs_to_check.push("/opt/homebrew/bin".into());
        dirs_to_check.push("/usr/local/bin".into());
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs_to_check.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            dirs_to_check.push(
                local
                    .join("Programs")
                    .join("OpenAI")
                    .join("Codex")
                    .join("bin"),
            );
            dirs_to_check.push(local.join("OpenAI").join("Codex").join("bin"));
        }
    }
    dirs_to_check
        .iter()
        .flat_map(|d| cli_names().iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

/// Hook commands. On Windows Codex runs `cmd.exe /C "<command>"` (see
/// `codex-rs/hooks/src/engine/command_runner.rs`), so the path is double-quoted
/// with backslashes there; elsewhere it is single-quoted for `sh -lc`.
pub fn pet_commands() -> Result<CodexCommands, String> {
    let exe = exe_path()?;
    let command = format!("'{}' codex-hook {MARKER}", exe.replace('\'', r"'\''"));
    let command_windows =
        cfg!(windows).then(|| format!("\"{}\" codex-hook {MARKER}", exe.replace('/', "\\")));
    Ok(CodexCommands {
        command,
        command_windows,
    })
}

struct HooksFile {
    path: PathBuf,
    exists: bool,
    raw: Vec<u8>,
    value: Value,
}

fn read_hooks() -> Result<HooksFile, String> {
    let path = hooks_path().ok_or("cannot resolve the home directory")?;
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    match std::fs::read(&path) {
        Ok(raw) => {
            let value = if raw.iter().all(u8::is_ascii_whitespace) {
                Value::Null
            } else {
                serde_json::from_slice(&raw).map_err(|e| {
                    format!(
                        "{} is not valid JSON ({e}). Nothing was changed.",
                        path.display()
                    )
                })?
            };
            Ok(HooksFile {
                path,
                exists: true,
                raw,
                value,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HooksFile {
            path,
            exists: false,
            raw: vec![],
            value: Value::Null,
        }),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Codex warns when one layer declares hooks both in `hooks.json` and inline in
/// `config.toml`; worth telling the user before we create `hooks.json`.
fn config_has_inline_hooks() -> bool {
    home_dir()
        .and_then(|d| std::fs::read_to_string(d.join("config.toml")).ok())
        .map(|t| {
            t.lines().any(|l| {
                let l = l.trim_start();
                l.starts_with("[hooks") || l.starts_with("[[hooks")
            })
        })
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDetection {
    pub installed: bool,
    pub cli_path: Option<String>,
    pub version: Option<String>,
    pub home_dir: Option<String>,
    pub home_dir_exists: bool,
    /// Session logs the pet follows without hooks (`watch`).
    pub sessions_dir: Option<String>,
    pub sessions_dir_exists: bool,
    pub hooks_path: Option<String>,
    pub hooks_exists: bool,
    pub hooks_error: Option<String>,
    pub status: CodexHookStatus,
    pub exe_path: Option<String>,
    pub is_dev_build: bool,
}

#[tauri::command]
pub async fn codex_detect() -> CodexDetection {
    tauri::async_runtime::spawn_blocking(|| {
        let cli = find_codex_cli();
        let version = cli.as_deref().and_then(cli_version);
        let home = home_dir();
        let home_dir_exists = home.as_ref().map(|d| d.is_dir()).unwrap_or(false);
        let (hooks_exists, hooks_error, status) = match read_hooks() {
            Ok(f) => (f.exists, None, hooks_patch::inspect(&f.value)),
            Err(e) => (true, Some(e), CodexHookStatus::default()),
        };
        CodexDetection {
            installed: cli.is_some() || home_dir_exists,
            cli_path: cli.map(|p| p.display().to_string()),
            version,
            home_dir: home.map(|d| d.display().to_string()),
            home_dir_exists,
            sessions_dir: watch::sessions_dir().map(|d| d.display().to_string()),
            sessions_dir_exists: watch::sessions_dir().is_some_and(|d| d.is_dir()),
            hooks_path: hooks_path().map(|p| p.display().to_string()),
            hooks_exists,
            hooks_error,
            status,
            exe_path: exe_path().ok(),
            is_dev_build: cfg!(debug_assertions),
        }
    })
    .await
    .expect("detect task panicked")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPreview {
    pub action: String,
    pub settings_path: String,
    pub before: String,
    pub after: String,
    pub changes: Vec<Change>,
    pub base_hash: String,
    pub warnings: Vec<String>,
}

fn plan(action: &str) -> Result<(HooksFile, Value, Vec<Change>), String> {
    let file = read_hooks()?;
    let (after, changes) = match action {
        "connect" => hooks_patch::apply_connect(&file.value, &pet_commands()?)?,
        "disconnect" => hooks_patch::apply_disconnect(&file.value)?,
        other => return Err(format!("unknown action {other}")),
    };
    Ok((file, after, changes))
}

#[tauri::command]
pub fn codex_preview(action: String) -> Result<CodexPreview, String> {
    let (file, after, changes) = plan(&action)?;
    let mut warnings = vec![];
    if action == "connect" {
        if cfg!(debug_assertions) {
            warnings.push(
                "This is a development build: Codex will call the debug executable. \
                 Reconnect after installing the release build."
                    .into(),
            );
        }
        if !file.exists && config_has_inline_hooks() {
            warnings.push(
                "config.toml already declares [hooks]. Codex warns when a folder uses both \
                 config.toml hooks and hooks.json; both keep working."
                    .into(),
            );
        }
    }
    if !file.exists {
        warnings.push("hooks.json does not exist yet and will be created.".into());
    }
    Ok(CodexPreview {
        action,
        settings_path: file.path.display().to_string(),
        before: if file.exists {
            String::from_utf8_lossy(&file.raw).into_owned()
        } else {
            String::new()
        },
        after: pretty(&after),
        changes,
        base_hash: sha256_hex(&file.raw),
        warnings,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexApplyResult {
    pub backup_path: Option<String>,
    pub status: CodexHookStatus,
    pub changed: bool,
}

#[tauri::command]
pub fn codex_apply(action: String, base_hash: String) -> Result<CodexApplyResult, String> {
    let (file, after, changes) = plan(&action)?;
    if sha256_hex(&file.raw) != base_hash {
        return Err(
            "hooks.json changed since the preview. Please review the changes again.".into(),
        );
    }
    if changes.is_empty() {
        return Ok(CodexApplyResult {
            backup_path: None,
            status: hooks_patch::inspect(&after),
            changed: false,
        });
    }
    let mut backup_path = None;
    if file.exists {
        let dir = crate::paths::ensure_app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let backup = dir.join(format!("codex-hooks-{}.json", crate::paths::now_ms()));
        std::fs::write(&backup, &file.raw).map_err(|e| format!("backup failed: {e}"))?;
        backup_path = Some(backup.display().to_string());
    }
    if let Some(parent) = file.path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::paths::write_private_atomic(&file.path, pretty(&after).as_bytes())
        .map_err(|e| format!("cannot write {}: {e}", file.path.display()))?;
    Ok(CodexApplyResult {
        backup_path,
        status: hooks_patch::inspect(&after),
        changed: true,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConnectionTest {
    pub collector_ok: bool,
    /// Last time a real Codex hook payload arrived (ms since epoch).
    pub last_event_at: Option<u64>,
}

#[tauri::command]
pub async fn codex_test_connection(
    state: tauri::State<'_, Arc<CollectorState>>,
) -> Result<CodexConnectionTest, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = crate::paths::now_ms();
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(exe);
        cmd.args(["codex-hook", "--selftest"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = no_window(&mut cmd).spawn().map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(br#"{"selftest":true}"#);
        }
        let _ = child.wait();
        let mut ok = false;
        for _ in 0..30 {
            if state
                .last_selftest_at
                .lock()
                .unwrap()
                .is_some_and(|t| t >= started)
            {
                ok = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(CodexConnectionTest {
            collector_ok: ok,
            last_event_at: state.last_event_for("codex"),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
