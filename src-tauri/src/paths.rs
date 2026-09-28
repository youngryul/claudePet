//! OS-independent path resolution. Never hardcode user paths.

use std::path::PathBuf;

pub const APP_IDENTIFIER: &str = "dev.aicodingpet.pet";

/// App data directory shared by the GUI app and the CLI collector.
/// macOS: ~/Library/Application Support/<id>, Windows: %APPDATA%\<id>,
/// Linux: $XDG_DATA_HOME/<id>. Override with `AI_PET_DATA_DIR` (tests/dev).
pub fn app_data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AI_PET_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER))
}

pub fn ensure_app_data_dir() -> std::io::Result<PathBuf> {
    let dir = app_data_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "cannot resolve app data dir")
    })?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write a file atomically (temp file + rename) with owner-only permissions on Unix.
pub fn write_private_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
