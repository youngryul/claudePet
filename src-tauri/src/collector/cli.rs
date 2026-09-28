//! CLI collector mode. Claude Code invokes the app executable as:
//!
//!   <exe> claude-statusline --source=ai-coding-pet   (statusLine command)
//!   <exe> claude-hook --source=ai-coding-pet         (hook command, async)
//!   <exe> claude-hook --selftest                     (connection test from the app)
//!
//! Rules: never block Claude Code, never fail loudly, never print to stdout for hooks
//! (hook stdout could be interpreted as a decision). Always exit 0.

use super::{CollectorEndpoint, IntegrationState, MAX_BODY_BYTES};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_millis(250);
const IO_TIMEOUT: Duration = Duration::from_millis(800);
const CHAINED_TIMEOUT: Duration = Duration::from_secs(5);

pub fn try_run_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first()?.as_str();
    match mode {
        "claude-statusline" => Some(run_statusline()),
        "claude-hook" => {
            let channel = if args.iter().any(|a| a == "--selftest") {
                "selftest"
            } else {
                "hook"
            };
            Some(run_hook(channel))
        }
        _ => None,
    }
}

fn read_stdin() -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = std::io::stdin()
        .take(MAX_BODY_BYTES as u64)
        .read_to_end(&mut buf);
    buf
}

fn run_hook(channel: &str) -> i32 {
    let input = read_stdin();
    if let Some(endpoint) = CollectorEndpoint::load() {
        let _ = post_json(&endpoint, &format!("/v1/claude/{channel}"), &input);
    }
    0
}

fn run_statusline() -> i32 {
    let input = read_stdin();
    if let Some(endpoint) = CollectorEndpoint::load() {
        let _ = post_json(&endpoint, "/v1/claude/statusline", &input);
    }

    // Keep the user's own status line working: if they had one before connecting,
    // run it with the same stdin and print its output instead of ours.
    let chained = IntegrationState::load()
        .original_status_line
        .and_then(|sl| sl.get("command").and_then(Value::as_str).map(str::to_owned));
    let output = match chained {
        Some(cmd) => run_chained(&cmd, &input).unwrap_or_default(),
        None => default_status_text(&input).into_bytes(),
    };
    let mut out = std::io::stdout();
    let _ = out.write_all(&output);
    let _ = out.flush();
    0
}

/// Minimal HTTP/1.1 POST without extra dependencies. Returns the status code.
pub fn post_json(endpoint: &CollectorEndpoint, path: &str, body: &[u8]) -> std::io::Result<u16> {
    let addr = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        endpoint.port,
        endpoint.token,
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    let mut status = [0u8; 12];
    stream.read_exact(&mut status)?;
    let code = std::str::from_utf8(&status[9..12])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Ok(code)
}

fn pct(v: &Value, path: &[&str]) -> Option<f64> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    cur.as_f64()
}

/// Compact default status line, used when the user had no status line of their own.
pub fn default_status_text(input: &[u8]) -> String {
    let Ok(v) = serde_json::from_slice::<Value>(input) else {
        return "🐾".to_string();
    };
    let mut parts = vec![];
    if let Some(model) = v.pointer("/model/display_name").and_then(Value::as_str) {
        parts.push(format!("🐾 {model}"));
    } else {
        parts.push("🐾".to_string());
    }
    if let Some(p) = pct(&v, &["context_window", "used_percentage"]) {
        parts.push(format!("ctx {p:.0}%"));
    }
    if let Some(p) = pct(&v, &["rate_limits", "five_hour", "used_percentage"]) {
        parts.push(format!("5h {p:.0}%"));
    }
    if let Some(p) = pct(&v, &["rate_limits", "seven_day", "used_percentage"]) {
        parts.push(format!("7d {p:.0}%"));
    }
    parts.join(" · ")
}

#[cfg(windows)]
pub fn find_git_bash() -> Option<std::path::PathBuf> {
    if let Some(p) = std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH") {
        let p = std::path::PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let mut candidates = vec![];
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let base = std::path::PathBuf::from(base);
            candidates.push(base.join("Git").join("bin").join("bash.exe"));
            candidates.push(
                base.join("Programs")
                    .join("Git")
                    .join("bin")
                    .join("bash.exe"),
            );
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn shell_command(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = match find_git_bash() {
            Some(bash) => {
                let mut c = Command::new(bash);
                c.arg("-c").arg(cmd);
                c
            }
            None => {
                let mut c = Command::new("powershell");
                c.args(["-NoProfile", "-Command", cmd]);
                c
            }
        };
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.arg("-c").arg(cmd);
        c
    }
}

fn run_chained(cmd: &str, input: &[u8]) -> Option<Vec<u8>> {
    let mut child = shell_command(cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input);
    }
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.read_to_end(&mut out);
        out
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < CHAINED_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    reader.join().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_text_is_null_safe() {
        assert_eq!(default_status_text(b"not json"), "🐾");
        assert_eq!(default_status_text(b"{}"), "🐾");
        let full = br#"{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12.4},
            "rate_limits":{"five_hour":{"used_percentage":23.5}}}"#;
        assert_eq!(default_status_text(full), "🐾 Opus · ctx 12% · 5h 24%");
        let nulls =
            br#"{"model":null,"context_window":{"used_percentage":null},"rate_limits":null}"#;
        assert_eq!(default_status_text(nulls), "🐾");
    }

    #[cfg(unix)]
    #[test]
    fn chained_command_receives_stdin() {
        let out = run_chained("cat", b"hello").unwrap();
        assert_eq!(out, b"hello");
    }
}
