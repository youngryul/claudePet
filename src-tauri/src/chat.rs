//! "Talk to the pet": runs Claude Code headless (`claude -p`) and streams the reply to
//! the pet window. Uses the user's existing Claude Code login, so no API key is needed.
//!
//! - The prompt goes over stdin, never argv, so arbitrary text is safe even when the
//!   CLI is a `.cmd` shim on Windows.
//! - Tools and MCP servers are disabled: the pet only talks, it never touches files.
//! - The child gets `AI_PET_CHAT=1`; our hook collector sees it and drops the event, so
//!   chatting does not count as coding time or XP.
//! - It runs in its own working directory, so `--resume` finds only pet conversations
//!   and no project CLAUDE.md leaks into the pet's personality.

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub const CHAT_ENV: &str = "AI_PET_CHAT";
pub const EVENT_NAME: &str = "chat://event";
const MAX_MESSAGE_CHARS: usize = 8_000;

const PERSONA: &str = "You are a small desktop pet that lives in the corner of the user's screen \
and keeps them company while they code. Be warm, playful and concise: answer in a few short \
sentences unless the user asks for detail. Plain text only, no markdown headings or tables. \
Always reply in the same language the user writes in.";

#[derive(Default)]
pub struct ChatState {
    child: Mutex<Option<Arc<Mutex<Child>>>>,
    session_id: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatEvent {
    /// The CLI started and Claude is thinking.
    Started,
    /// A chunk of reply text.
    Delta { text: String },
    /// The reply finished. `text` is the full reply when the CLI reported one.
    Done { text: Option<String> },
    Error { message: String },
}

fn command_for(cli: &std::path::Path) -> Command {
    let mut cmd = if cli.extension().map(|e| e == "cmd").unwrap_or(false) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(cli);
        c
    } else {
        Command::new(cli)
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Maps one line of `--output-format stream-json` to an event. Returns the session id
/// separately so the next message can `--resume` the conversation.
pub fn parse_line(line: &str) -> (Option<ChatEvent>, Option<String>) {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return (None, None);
    };
    let session = v.get("session_id").and_then(Value::as_str).map(str::to_owned);
    let event = match v.get("type").and_then(Value::as_str) {
        Some("stream_event") => {
            let ev = &v["event"];
            (ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta")
                .then(|| ev["delta"]["text"].as_str())
                .flatten()
                .map(|t| ChatEvent::Delta { text: t.to_owned() })
        }
        Some("result") => {
            let text = v.get("result").and_then(Value::as_str).map(str::to_owned);
            if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
                Some(ChatEvent::Error {
                    message: text.unwrap_or_else(|| "Claude returned an error".into()),
                })
            } else {
                Some(ChatEvent::Done { text })
            }
        }
        _ => None,
    };
    (event, session)
}

fn chat_dir() -> Result<std::path::PathBuf, String> {
    let dir = crate::paths::ensure_app_data_dir()
        .map_err(|e| e.to_string())?
        .join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn chat_send(
    app: AppHandle,
    state: tauri::State<'_, Arc<ChatState>>,
    message: String,
) -> Result<(), String> {
    let message: String = message.trim().chars().take(MAX_MESSAGE_CHARS).collect();
    if message.is_empty() {
        return Err("empty message".into());
    }
    if state.child.lock().unwrap().is_some() {
        return Err("busy".into());
    }
    let cli = crate::claude::find_claude_cli().ok_or("Claude Code CLI not found")?;

    let mut cmd = command_for(&cli);
    cmd.args([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--strict-mcp-config",
        "--system-prompt",
        PERSONA,
        "--tools",
        "",
    ]);
    if let Some(id) = state.session_id.lock().unwrap().clone() {
        cmd.args(["--resume", &id]);
    }
    let mut child = cmd
        .current_dir(chat_dir()?)
        .env(CHAT_ENV, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start Claude Code: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(message.as_bytes())
            .map_err(|e| e.to_string())?;
        // Dropping stdin closes it, which tells `claude -p` the prompt is complete.
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    *state.child.lock().unwrap() = Some(child.clone());
    let _ = app.emit(EVENT_NAME, ChatEvent::Started);

    let state = state.inner().clone();
    std::thread::spawn(move || {
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut e) = stderr {
                let _ = std::io::Read::read_to_string(&mut e, &mut s);
            }
            s
        });

        let mut finished = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let (event, session) = parse_line(&line);
            if let Some(id) = session {
                *state.session_id.lock().unwrap() = Some(id);
            }
            if let Some(ev) = event {
                finished |= matches!(ev, ChatEvent::Done { .. } | ChatEvent::Error { .. });
                let _ = app.emit(EVENT_NAME, ev);
            }
        }

        let status = child.lock().unwrap().wait();
        let stderr_text = err_reader.join().unwrap_or_default();
        let was_cancelled = state.child.lock().unwrap().take().is_none();
        if !finished && !was_cancelled {
            let detail = stderr_text.trim();
            let message = if detail.is_empty() {
                format!("Claude Code exited ({})", status.map(|s| s.to_string()).unwrap_or_default())
            } else {
                detail.chars().take(400).collect()
            };
            let _ = app.emit(EVENT_NAME, ChatEvent::Error { message });
        }
    });
    Ok(())
}

/// Stops the reply in progress, if any.
#[tauri::command]
pub fn chat_cancel(app: AppHandle, state: tauri::State<'_, Arc<ChatState>>) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.lock().unwrap().kill();
        let _ = app.emit(EVENT_NAME, ChatEvent::Done { text: None });
    }
}

/// Forgets the conversation so the next message starts fresh.
#[tauri::command]
pub fn chat_reset(state: tauri::State<'_, Arc<ChatState>>) {
    *state.session_id.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_deltas() {
        let line = r#"{"type":"stream_event","session_id":"s1","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}"#;
        assert_eq!(
            parse_line(line),
            (Some(ChatEvent::Delta { text: "Hi".into() }), Some("s1".into()))
        );
    }

    #[test]
    fn parses_result_and_errors() {
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"Hello!","session_id":"s2"}"#;
        assert_eq!(
            parse_line(ok),
            (Some(ChatEvent::Done { text: Some("Hello!".into()) }), Some("s2".into()))
        );
        let err = r#"{"type":"result","is_error":true,"result":"Not logged in"}"#;
        assert_eq!(
            parse_line(err).0,
            Some(ChatEvent::Error { message: "Not logged in".into() })
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(parse_line("not json"), (None, None));
        let init = r#"{"type":"system","subtype":"init","session_id":"s3"}"#;
        assert_eq!(parse_line(init), (None, Some("s3".into())));
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}}"#;
        assert_eq!(parse_line(thinking), (None, None));
    }
}
