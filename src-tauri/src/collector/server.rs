//! Localhost HTTP receiver for collector payloads.
//!
//! Security model:
//! - binds to 127.0.0.1 only (never 0.0.0.0);
//! - every request must carry `Authorization: Bearer <token>`; the token is 256 random
//!   bits written to an owner-only file that only local processes of this user can read;
//! - requests carrying an `Origin` header are rejected, so web pages in a browser
//!   cannot talk to the collector (CSRF / DNS-rebinding style attacks);
//! - bodies are capped at 1 MiB and must be JSON objects.

use super::{CollectorEndpoint, ENDPOINT_FILE, MAX_BODY_BYTES};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub const EVENT_NAME: &str = "collector://event";
const PREFERRED_PORTS: std::ops::Range<u16> = 47821..47831;
const RECENT_CAPACITY: usize = 64;

/// Providers the collector accepts. Add new providers here.
const KNOWN_PROVIDERS: &[&str] = &["claude"];
const KNOWN_CHANNELS: &[&str] = &["statusline", "hook", "selftest"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorEvent {
    pub provider: String,
    /// "statusline" | "hook" | "selftest"
    pub channel: String,
    pub received_at: u64,
    /// Raw payload exactly as Claude Code produced it (RAW_EVENT).
    pub payload: Value,
}

#[derive(Default)]
pub struct CollectorState {
    pub endpoint: Mutex<Option<CollectorEndpoint>>,
    pub last_statusline: Mutex<Option<CollectorEvent>>,
    pub recent_hooks: Mutex<VecDeque<CollectorEvent>>,
    pub last_selftest_at: Mutex<Option<u64>>,
    pub last_event_at: Mutex<Option<u64>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorSnapshot {
    pub port: Option<u16>,
    pub last_statusline: Option<CollectorEvent>,
    pub recent_hooks: Vec<CollectorEvent>,
    pub last_event_at: Option<u64>,
}

impl CollectorState {
    pub fn snapshot(&self) -> CollectorSnapshot {
        CollectorSnapshot {
            port: self.endpoint.lock().unwrap().as_ref().map(|e| e.port),
            last_statusline: self.last_statusline.lock().unwrap().clone(),
            recent_hooks: self.recent_hooks.lock().unwrap().iter().cloned().collect(),
            last_event_at: *self.last_event_at.lock().unwrap(),
        }
    }
}

/// Privacy: only these top-level fields survive. Prompts, assistant messages, tool
/// inputs/outputs, transcript paths and working directories are dropped on arrival.
const HOOK_FIELDS: &[&str] = &[
    "hook_event_name",
    "session_id",
    "agent_id",
    "agent_type",
    "source",
    "model",
    "tool_name",
    "tool_use_id",
    "is_interrupt",
    "notification_type",
    "error",
    "reason",
    "trigger",
    "permission_mode",
    "duration_ms",
];
const STATUSLINE_FIELDS: &[&str] = &[
    "session_id",
    "model",
    "version",
    "cost",
    "context_window",
    "exceeds_200k_tokens",
    "effort",
    "thinking",
    "rate_limits",
];

fn sanitize(channel: &str, payload: Value) -> Value {
    let allowed = match channel {
        "hook" => HOOK_FIELDS,
        "statusline" => STATUSLINE_FIELDS,
        _ => &[][..],
    };
    match payload {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(k, _)| allowed.contains(&k.as_str()))
                .collect(),
        ),
        _ => Value::Null,
    }
}

fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("OS RNG unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Constant-time comparison to avoid leaking the token through timing.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn bind() -> std::io::Result<tiny_http::Server> {
    for port in PREFERRED_PORTS {
        if let Ok(s) = tiny_http::Server::http(("127.0.0.1", port)) {
            return Ok(s);
        }
    }
    tiny_http::Server::http(("127.0.0.1", 0)).map_err(std::io::Error::other)
}

pub fn start(app: AppHandle, state: Arc<CollectorState>) -> std::io::Result<CollectorEndpoint> {
    let server = bind()?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| std::io::Error::other("collector is not bound to an IP socket"))?;

    // Reuse the token across restarts so running Claude sessions keep working.
    let token = CollectorEndpoint::load()
        .map(|e| e.token)
        .filter(|t| t.len() == 64)
        .unwrap_or_else(random_token);
    let endpoint = CollectorEndpoint {
        port,
        token,
        pid: std::process::id(),
        protocol: 1,
    };

    let dir = crate::paths::ensure_app_data_dir()?;
    let bytes = serde_json::to_vec_pretty(&endpoint).map_err(std::io::Error::other)?;
    crate::paths::write_private_atomic(&dir.join(ENDPOINT_FILE), &bytes)?;
    *state.endpoint.lock().unwrap() = Some(endpoint.clone());

    let expected = format!("Bearer {}", endpoint.token);
    std::thread::Builder::new()
        .name("collector-http".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                handle(&app, &state, &expected, request);
            }
        })?;
    log::info!("collector listening on 127.0.0.1:{port}");
    Ok(endpoint)
}

fn respond(request: tiny_http::Request, code: u16, body: &str) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    let _ = request.respond(
        tiny_http::Response::from_string(body)
            .with_status_code(code)
            .with_header(header),
    );
}

fn header<'a>(request: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

fn handle(
    app: &AppHandle,
    state: &CollectorState,
    expected: &str,
    mut request: tiny_http::Request,
) {
    if header(&request, "Origin").is_some() {
        return respond(
            request,
            403,
            r#"{"error":"browser requests are not allowed"}"#,
        );
    }
    let authorized = header(&request, "Authorization")
        .map(|v| ct_eq(v.as_bytes(), expected.as_bytes()))
        .unwrap_or(false);
    if !authorized {
        return respond(request, 401, r#"{"error":"unauthorized"}"#);
    }

    let url = request.url().to_string();
    if *request.method() == tiny_http::Method::Get && url == "/v1/health" {
        return respond(request, 200, r#"{"ok":true}"#);
    }
    if *request.method() != tiny_http::Method::Post {
        return respond(request, 405, r#"{"error":"method not allowed"}"#);
    }

    // Route: /v1/<provider>/<channel>
    let parts: Vec<&str> = url.trim_start_matches('/').split('/').collect();
    let (provider, channel) = match parts.as_slice() {
        ["v1", p, c] if KNOWN_PROVIDERS.contains(p) && KNOWN_CHANNELS.contains(c) => {
            (p.to_string(), c.to_string())
        }
        _ => return respond(request, 404, r#"{"error":"not found"}"#),
    };

    if request.body_length().unwrap_or(0) > MAX_BODY_BYTES {
        return respond(request, 413, r#"{"error":"payload too large"}"#);
    }
    let mut body = Vec::new();
    let read = request
        .as_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut body);
    if read.is_err() || body.len() > MAX_BODY_BYTES {
        return respond(request, 413, r#"{"error":"payload too large"}"#);
    }
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v @ Value::Object(_)) => v,
        _ => return respond(request, 400, r#"{"error":"expected a JSON object"}"#),
    };

    let now = crate::paths::now_ms();
    let payload = sanitize(&channel, payload);
    let event = CollectorEvent {
        provider,
        channel: channel.clone(),
        received_at: now,
        payload,
    };
    match channel.as_str() {
        "statusline" => *state.last_statusline.lock().unwrap() = Some(event.clone()),
        "hook" => {
            let mut q = state.recent_hooks.lock().unwrap();
            if q.len() >= RECENT_CAPACITY {
                q.pop_front();
            }
            q.push_back(event.clone());
        }
        _ => *state.last_selftest_at.lock().unwrap() = Some(now),
    }
    if channel != "selftest" {
        *state.last_event_at.lock().unwrap() = Some(now);
    }
    let _ = app.emit(EVENT_NAME, &event);
    respond(request, 200, r#"{}"#);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_compare() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
    }

    #[test]
    fn sanitize_drops_sensitive_fields() {
        let hook = serde_json::json!({"hook_event_name": "UserPromptSubmit", "session_id": "s",
            "prompt": "secret", "tool_input": {"command": "x"}, "transcript_path": "/p", "cwd": "/c"});
        assert_eq!(
            sanitize("hook", hook),
            serde_json::json!({"hook_event_name": "UserPromptSubmit", "session_id": "s"})
        );
        let sl = serde_json::json!({"session_id": "s", "workspace": {"current_dir": "/c"}, "rate_limits": {}});
        assert_eq!(
            sanitize("statusline", sl),
            serde_json::json!({"session_id": "s", "rate_limits": {}})
        );
        assert_eq!(
            sanitize("selftest", serde_json::json!({"a": 1})),
            serde_json::json!({})
        );
    }

    #[test]
    fn token_is_64_hex_chars() {
        let t = random_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t, random_token());
    }
}
