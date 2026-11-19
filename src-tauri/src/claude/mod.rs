//! Claude Code integration: detection, settings preview/patch, and connection tests.
//!
//! Flow (as surfaced in the UI): detect install -> resolve config dir -> read settings ->
//! inspect our entries -> show a diff preview -> user approves -> patch (with backup and
//! an optimistic-concurrency hash check) -> test connection. Disconnect removes only
//! entries marked with `collector::MARKER`.

pub mod settings_patch;

use crate::collector::{server::CollectorState, IntegrationState, MARKER};
use serde::Serialize;
use serde_json::Value;
use settings_patch::{Change, ConnectionStatus, PetCommands};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

/// `CLAUDE_CONFIG_DIR` overrides the default `~/.claude` (documented by Claude Code).
pub fn config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    dirs::home_dir().map(|h| h.join(".claude"))
}

pub fn settings_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("settings.json"))
}

fn cli_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["claude.exe", "claude.cmd"]
    } else {
        &["claude"]
    }
}

/// GUI apps (especially on macOS) get a minimal PATH, so also probe common install dirs.
pub fn find_claude_cli() -> Option<PathBuf> {
    let mut dirs_to_check: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        dirs_to_check.push(home.join(".local").join("bin"));
        dirs_to_check.push(home.join(".claude").join("local"));
        dirs_to_check.push(home.join(".npm-global").join("bin"));
        dirs_to_check.push(home.join(".bun").join("bin"));
    }
    #[cfg(not(windows))]
    {
        dirs_to_check.push("/opt/homebrew/bin".into());
        dirs_to_check.push("/usr/local/bin".into());
    }
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs_to_check.push(PathBuf::from(appdata).join("npm"));
    }
    dirs_to_check
        .iter()
        .flat_map(|d| cli_names().iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

/// A Claude Code binary to run: the installed CLI, else one bundled with the Claude
/// desktop app or an IDE extension. People who use Claude Code only through those
/// apps have no `claude` on PATH, but the bundled binary works the same way and
/// shares the login.
pub fn find_claude_runnable() -> Option<PathBuf> {
    find_claude_cli().or_else(|| newest(bundled_candidates()))
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default()
}

/// Where bundled binaries live (version folders vary, so the levels are walked):
/// - Claude desktop: `<data>/claude-code/<version>/[<build>/]claude[.exe]`, with the
///   data dir under `%LOCALAPPDATA%\Claude-Data\<package>` (Store install),
///   `%APPDATA%\Claude` or `~/Library/Application Support/Claude`.
/// - VS Code family: `<ext dir>/anthropic.claude-code-<ver>-<platform>/resources/native-binary/`.
fn bundled_candidates() -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
    let mut data_dirs: Vec<PathBuf> = vec![];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        data_dirs.extend(children(&PathBuf::from(local).join("Claude-Data")));
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        data_dirs.push(PathBuf::from(roaming).join("Claude"));
    }
    let home = dirs::home_dir();
    if let Some(home) = &home {
        data_dirs.push(home.join("Library/Application Support/Claude"));
        data_dirs.push(home.join(".config/Claude"));
    }

    let mut out = vec![];
    for data in data_dirs {
        for version in children(&data.join("claude-code")) {
            out.push(version.join(exe));
            out.extend(children(&version).into_iter().map(|build| build.join(exe)));
        }
    }
    if let Some(home) = &home {
        for ext_root in [".vscode", ".vscode-insiders", ".cursor", ".windsurf"] {
            for ext in children(&home.join(ext_root).join("extensions")) {
                let is_claude = ext
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("anthropic.claude-code-"));
                if is_claude {
                    out.push(ext.join("resources").join("native-binary").join(exe));
                }
            }
        }
    }
    out.retain(|p| p.is_file());
    out
}

/// The most recently updated binary is the newest version in practice; old versions
/// linger after app and extension updates.
fn newest(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths
        .into_iter()
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

pub(crate) fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

pub(crate) fn claude_version(cli: &Path) -> Option<String> {
    let mut cmd = if cli.extension().map(|e| e == "cmd").unwrap_or(false) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(cli);
        c
    } else {
        Command::new(cli)
    };
    cmd.arg("--version")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let child = no_window(&mut cmd)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = rx.recv_timeout(Duration::from_secs(4)).ok()?.ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Which shell Claude Code will use to run our commands on this machine.
fn shell_kind() -> &'static str {
    #[cfg(windows)]
    {
        if crate::collector::cli::find_git_bash().is_some() {
            "git-bash"
        } else {
            "powershell"
        }
    }
    #[cfg(not(windows))]
    {
        "sh"
    }
}

pub(crate) fn exe_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot resolve app executable: {e}"))?;
    let s = exe.to_string_lossy().to_string();
    #[cfg(windows)]
    let s = s.trim_start_matches(r"\\?\").replace('\\', "/");
    Ok(s)
}

/// Build shell-form commands (exec-form `args` needs Claude Code >= 2.1.139, so we
/// stay with shell form for compatibility). Paths use forward slashes on Windows,
/// as the Claude Code docs recommend for Git Bash.
pub fn pet_commands() -> Result<PetCommands, String> {
    let exe = exe_path()?;
    let invoke = match shell_kind() {
        "powershell" => format!("& '{}'", exe.replace('\'', "''")),
        _ => format!("'{}'", exe.replace('\'', r"'\''")),
    };
    Ok(PetCommands {
        statusline: format!("{invoke} claude-statusline {MARKER}"),
        hook: format!("{invoke} claude-hook {MARKER}"),
    })
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

struct SettingsFile {
    path: PathBuf,
    exists: bool,
    raw: Vec<u8>,
    value: Value,
}

fn read_settings() -> Result<SettingsFile, String> {
    let path = settings_path().ok_or("cannot resolve the home directory")?;
    // Follow symlinks (dotfile managers) so we edit the real file.
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
            Ok(SettingsFile {
                path,
                exists: true,
                raw,
                value,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SettingsFile {
            path,
            exists: false,
            raw: vec![],
            value: Value::Null,
        }),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

pub(crate) fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_default();
    s.push('\n');
    s
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDetection {
    pub installed: bool,
    pub cli_path: Option<String>,
    pub version: Option<String>,
    pub config_dir: Option<String>,
    pub config_dir_exists: bool,
    pub settings_path: Option<String>,
    pub settings_exists: bool,
    pub settings_error: Option<String>,
    pub status: ConnectionStatus,
    pub exe_path: Option<String>,
    pub is_dev_build: bool,
    pub shell: String,
}

#[tauri::command]
pub async fn claude_detect() -> ClaudeDetection {
    tauri::async_runtime::spawn_blocking(|| {
        let cli = find_claude_cli();
        let version = cli.as_deref().and_then(claude_version);
        let cfg = config_dir();
        let config_dir_exists = cfg.as_ref().map(|d| d.is_dir()).unwrap_or(false);
        let (settings_exists, settings_error, status) = match read_settings() {
            Ok(f) => (f.exists, None, settings_patch::inspect(&f.value)),
            Err(e) => (true, Some(e), ConnectionStatus::default()),
        };
        ClaudeDetection {
            installed: cli.is_some() || config_dir_exists,
            cli_path: cli.map(|p| p.display().to_string()),
            version,
            config_dir: cfg.map(|d| d.display().to_string()),
            config_dir_exists,
            settings_path: settings_path().map(|p| p.display().to_string()),
            settings_exists,
            settings_error,
            status,
            exe_path: exe_path().ok(),
            is_dev_build: cfg!(debug_assertions),
            shell: shell_kind().into(),
        }
    })
    .await
    .expect("detect task panicked")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPreview {
    pub action: String,
    pub settings_path: String,
    pub before: String,
    pub after: String,
    pub changes: Vec<Change>,
    pub base_hash: String,
    pub warnings: Vec<String>,
}

fn plan(action: &str) -> Result<(SettingsFile, Value, Vec<Change>, IntegrationState), String> {
    let file = read_settings()?;
    let mut state = IntegrationState::load();
    let (after, changes) = match action {
        "connect" => {
            let mut orig = state.original_status_line.clone();
            let r = settings_patch::apply_connect(&file.value, &pet_commands()?, &mut orig)?;
            state.original_status_line = orig;
            r
        }
        "disconnect" => {
            let r =
                settings_patch::apply_disconnect(&file.value, state.original_status_line.as_ref())?;
            state.original_status_line = None;
            r
        }
        other => return Err(format!("unknown action {other}")),
    };
    Ok((file, after, changes, state))
}

#[tauri::command]
pub fn claude_preview(action: String) -> Result<SettingsPreview, String> {
    let (file, after, changes, _) = plan(&action)?;
    let mut warnings = vec![];
    if action == "connect" && cfg!(debug_assertions) {
        warnings.push(
            "This is a development build: Claude Code will call the debug executable. \
             Reconnect after installing the release build."
                .into(),
        );
    }
    if !file.exists {
        warnings.push("settings.json does not exist yet and will be created.".into());
    }
    Ok(SettingsPreview {
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
pub struct ApplyResult {
    pub backup_path: Option<String>,
    pub status: ConnectionStatus,
    pub changed: bool,
}

#[tauri::command]
pub fn claude_apply(action: String, base_hash: String) -> Result<ApplyResult, String> {
    let (file, after, changes, mut state) = plan(&action)?;
    if sha256_hex(&file.raw) != base_hash {
        return Err(
            "settings.json changed since the preview. Please review the changes again.".into(),
        );
    }
    if changes.is_empty() {
        return Ok(ApplyResult {
            backup_path: None,
            status: settings_patch::inspect(&after),
            changed: false,
        });
    }

    let mut backup_path = None;
    if file.exists {
        let dir = crate::paths::ensure_app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let backup = dir.join(format!("claude-settings-{}.json", crate::paths::now_ms()));
        std::fs::write(&backup, &file.raw).map_err(|e| format!("backup failed: {e}"))?;
        backup_path = Some(backup.display().to_string());
    }
    if let Some(parent) = file.path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Persist integration state first so a crash never leaves us unable to restore.
    if action == "connect" {
        state.connected_at = Some(crate::paths::now_ms());
        state.exe_path = exe_path().ok();
    } else {
        state.connected_at = None;
    }
    state
        .save()
        .map_err(|e| format!("cannot save integration state: {e}"))?;
    crate::paths::write_private_atomic(&file.path, pretty(&after).as_bytes())
        .map_err(|e| format!("cannot write {}: {e}", file.path.display()))?;

    Ok(ApplyResult {
        backup_path,
        status: settings_patch::inspect(&after),
        changed: true,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    /// Our collector executable can reach the running app (end-to-end local path).
    pub collector_ok: bool,
    /// Last time a real Claude Code statusLine/hook payload arrived (ms since epoch).
    pub last_claude_event_at: Option<u64>,
    pub message: String,
}

#[tauri::command]
pub async fn claude_test_connection(
    state: tauri::State<'_, Arc<CollectorState>>,
) -> Result<ConnectionTest, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = crate::paths::now_ms();
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(exe);
        cmd.args(["claude-hook", "--selftest"])
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
                .map(|t| t >= started)
                .unwrap_or(false)
            {
                ok = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let last = state.last_event_for("claude");
        let message = match (ok, last) {
            (false, _) => "The collector could not reach the app.".to_string(),
            (true, Some(_)) => "Connected. Claude Code events are arriving.".to_string(),
            (true, None) => "Collector OK. Start or continue a Claude Code session; \
                             new sessions pick up the settings automatically."
                .to_string(),
        };
        Ok(ConnectionTest {
            collector_ok: ok,
            last_claude_event_at: last,
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
