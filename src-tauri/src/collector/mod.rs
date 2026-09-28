//! Collector layer: Claude Code -> (CLI collector) -> localhost HTTP -> Tauri backend -> UI.
//!
//! Claude Code runs `ai-coding-pet claude-statusline|claude-hook` (see `cli.rs`), which
//! forwards the raw JSON it received on stdin to the in-app HTTP server (`server.rs`).
//! The server only listens on 127.0.0.1 and requires a per-install random bearer token
//! stored in an owner-only file in the app data directory.

pub mod cli;
pub mod server;

use serde::{Deserialize, Serialize};

/// Marker appended to every command we write into Claude settings, so that
/// Disconnect removes exactly (and only) what we added.
pub const MARKER: &str = "--source=ai-coding-pet";
pub const ENDPOINT_FILE: &str = "collector.json";
pub const INTEGRATION_STATE_FILE: &str = "claude-integration.json";
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorEndpoint {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub protocol: u32,
}

impl CollectorEndpoint {
    pub fn load() -> Option<Self> {
        let path = crate::paths::app_data_dir()?.join(ENDPOINT_FILE);
        let text = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&text).ok()
    }
}

/// Persisted integration state, e.g. the user's original statusLine that we wrap.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationState {
    /// The user's statusLine object before we connected (restored on Disconnect,
    /// and chained at runtime so their status line keeps working).
    #[serde(default)]
    pub original_status_line: Option<serde_json::Value>,
    #[serde(default)]
    pub connected_at: Option<u64>,
    #[serde(default)]
    pub exe_path: Option<String>,
}

impl IntegrationState {
    pub fn load() -> Self {
        crate::paths::app_data_dir()
            .map(|d| d.join(INTEGRATION_STATE_FILE))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> std::io::Result<()> {
        let dir = crate::paths::ensure_app_data_dir()?;
        let bytes = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        crate::paths::write_private_atomic(&dir.join(INTEGRATION_STATE_FILE), &bytes)
    }
}
