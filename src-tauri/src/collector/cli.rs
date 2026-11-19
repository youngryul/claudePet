//! CLI collector mode. Claude Code invokes the app executable as:
//!
//!   <exe> claude-statusline --source=ai-coding-pet   (statusLine command)
//!   <exe> claude-hook --source=ai-coding-pet         (hook command, async)
//!   <exe> claude-hook --selftest                     (connection test from the app)
//!
//! Codex CLI invokes it the same way through `~/.codex/hooks.json`:
//!
//!   <exe> codex-hook --source=ai-coding-pet          (hook command)
//!   <exe> codex-hook --selftest                      (connection test from the app)
//!
//! Rules: never block the agent, never fail loudly, never print to stdout for hooks
//! (hook stdout could be interpreted as a decision or as model context). Always exit 0.

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
        "codex-hook" => {
            let selftest = args.iter().any(|a| a == "--selftest");
            Some(run_codex_hook(selftest))
        }
        _ => None,
    }
}

fn run_codex_hook(selftest: bool) -> i32 {
    let input = read_stdin();
    if let Some(endpoint) = CollectorEndpoint::load() {
        let (path, body) = if selftest {
            ("/v1/codex/selftest", input)
        } else {
            let body = crate::codex::rollout::enrich_hook(&input, read_tail).unwrap_or(input);
            ("/v1/codex/hook", body)
        };
        let _ = post_json(&endpoint, path, &body);
    }
    0
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
        let body = with_transcript_usage(&input).unwrap_or(input);
        let _ = post_json(&endpoint, &format!("/v1/claude/{channel}"), &body);
    }
    0
}

/// Hook events after which the transcript holds a fresh API response.
const USAGE_EVENTS: &[&str] = &["Stop", "PostToolUse", "PostToolUseFailure", "PreCompact"];
/// Only the end of the transcript is read; the latest response is always there.
const TRANSCRIPT_TAIL_BYTES: u64 = 512 * 1024;

/// statusLine (and with it token counts) only runs in the terminal UI; the desktop
/// app and IDE extensions fire hooks only. So for those hooks we read the token usage
/// of the latest response from the session transcript and attach just those numbers
/// as `transcript_usage`. The transcript text itself never leaves this process.
fn with_transcript_usage(input: &[u8]) -> Option<Vec<u8>> {
    let mut v: Value = serde_json::from_slice(input).ok()?;
    let event = v.get("hook_event_name")?.as_str()?;
    if !USAGE_EVENTS.contains(&event) {
        return None;
    }
    let path = v.get("transcript_path")?.as_str()?;
    let usage = last_usage(&read_tail(std::path::Path::new(path))?)?;
    v.as_object_mut()?.insert("transcript_usage".into(), usage);
    serde_json::to_vec(&v).ok()
}

pub(crate) fn read_tail(path: &std::path::Path) -> Option<String> {
    use std::io::{Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(TRANSCRIPT_TAIL_BYTES);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.take(TRANSCRIPT_TAIL_BYTES).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    // Drop the first, possibly cut, line when we did not start at the beginning.
    Some(if start > 0 {
        text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default()
    } else {
        text
    })
}

/// Token usage of the main conversation's latest assistant response, numbers only.
pub fn last_usage(jsonl: &str) -> Option<Value> {
    jsonl.lines().rev().find_map(|line| {
        if !line.contains("\"usage\"") {
            return None;
        }
        let v: Value = serde_json::from_str(line).ok()?;
        if v.get("type")?.as_str()? != "assistant" || v.get("isSidechain") == Some(&Value::Bool(true)) {
            return None;
        }
        let msg = v.get("message")?;
        let u = msg.get("usage")?;
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        Some(serde_json::json!({
            "message_id": msg.get("id").and_then(Value::as_str),
            "model": msg.get("model").and_then(Value::as_str),
            "input_tokens": n("input_tokens"),
            "output_tokens": n("output_tokens"),
            "cache_creation_input_tokens": n("cache_creation_input_tokens"),
            "cache_read_input_tokens": n("cache_read_input_tokens"),
        }))
    })
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

    #[test]
    fn last_usage_takes_latest_main_response_numbers_only() {
        let jsonl = [
            r#"{"type":"assistant","message":{"id":"m1","model":"claude-x","content":[{"type":"text","text":"secret"}],"usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3}}}"#,
            r#"{"type":"assistant","message":{"id":"m2","model":"claude-x","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":40}}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"id":"sub","usage":{"input_tokens":999}}}"#,
            r#"{"type":"user","message":{"content":"hi"}}"#,
        ]
        .join("\n");
        let u = last_usage(&jsonl).unwrap();
        assert_eq!(u["message_id"], "m2");
        assert_eq!(u["input_tokens"], 10);
        assert_eq!(u["cache_read_input_tokens"], 40);
        assert!(!u.to_string().contains("secret"));
        assert!(last_usage("not json\n{}").is_none());
    }

    #[test]
    fn usage_is_attached_only_for_matching_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let t = dir.path().join("t.jsonl");
        std::fs::write(
            &t,
            r#"{"type":"assistant","message":{"id":"m","usage":{"input_tokens":5,"output_tokens":6}}}"#,
        )
        .unwrap();
        let hook = |event: &str| {
            serde_json::json!({"hook_event_name": event, "transcript_path": t.to_str().unwrap()})
                .to_string()
        };
        let out: Value = serde_json::from_slice(&with_transcript_usage(hook("Stop").as_bytes()).unwrap()).unwrap();
        assert_eq!(out["transcript_usage"]["output_tokens"], 6);
        assert!(with_transcript_usage(hook("PreToolUse").as_bytes()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn chained_command_receives_stdin() {
        let out = run_chained("cat", b"hello").unwrap();
        assert_eq!(out, b"hello");
    }
}
