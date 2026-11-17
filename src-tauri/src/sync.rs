//! Account-wide pet progress through a folder the user already syncs (OneDrive, iCloud
//! Drive, Dropbox, Google Drive...). No server: each device writes only its own file,
//!
//!   <sync folder>/AI Coding Pet/<Claude account id>/<device id>.json
//!
//! and reads everyone's files to show the sum. One writer per file means the sync
//! service never has to resolve a conflict.
//!
//! The account comes from Claude Code's own login (`oauthAccount.accountUuid` in
//! `.claude.json`), so devices signed in to the same Claude account land in the same
//! folder without any extra login. Only the account id is used; email stays local.

use crate::db::{self, Db, DashboardData, PetProgress, SyncDay};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const KV_FOLDER: &str = "sync_folder";
const KV_DEVICE_ID: &str = "device_id";
const APP_FOLDER: &str = "AI Coding Pet";
const FILE_VERSION: u32 = 1;
/// Upper bound per device file (years of daily rows are ~100 KB).
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const EXPORT_EVERY: Duration = Duration::from_secs(30);
const ACCOUNT_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: Option<String>,
}

#[derive(Default)]
pub struct SyncState {
    last_export: Mutex<Option<Instant>>,
    account: Mutex<Option<(Instant, Option<Account>)>>,
    last_error: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceFile {
    version: u32,
    device_id: String,
    device_name: String,
    updated_at: u64,
    days: Vec<SyncDay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub updated_at: u64,
    pub this_device: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCandidate {
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub account: Option<Account>,
    pub folder: Option<String>,
    pub active: bool,
    pub devices: Vec<DeviceInfo>,
    pub candidates: Vec<FolderCandidate>,
    pub last_error: Option<String>,
}

// ---------- account ----------

/// Claude Code keeps its login in `.claude.json`: inside `CLAUDE_CONFIG_DIR` when that is
/// set, otherwise in the home directory (next to, not inside, `~/.claude`).
fn claude_json_candidates() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        v.push(PathBuf::from(dir).join(".claude.json"));
    }
    if let Some(home) = dirs::home_dir() {
        v.push(home.join(".claude.json"));
        v.push(home.join(".claude").join(".claude.json"));
    }
    v
}

pub fn parse_account(json: &Value) -> Option<Account> {
    let acc = json.get("oauthAccount")?;
    let id = acc.get("accountUuid")?.as_str()?.trim();
    // The id becomes a folder name: accept only uuid-like text.
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(Account {
        id: id.to_owned(),
        email: acc.get("emailAddress").and_then(Value::as_str).map(str::to_owned),
    })
}

fn read_account() -> Option<Account> {
    claude_json_candidates().into_iter().find_map(|p| {
        let text = std::fs::read_to_string(p).ok()?;
        parse_account(&serde_json::from_str(&text).ok()?)
    })
}

impl SyncState {
    /// `.claude.json` can be several MB, so the account is cached for a few minutes.
    fn account(&self) -> Option<Account> {
        let mut cache = self.account.lock().unwrap();
        if let Some((at, acc)) = cache.as_ref() {
            if at.elapsed() < ACCOUNT_TTL {
                return acc.clone();
            }
        }
        let acc = read_account();
        *cache = Some((Instant::now(), acc.clone()));
        acc
    }

    fn set_error(&self, e: Option<String>) {
        if let Some(msg) = &e {
            log::warn!("sync: {msg}");
        }
        *self.last_error.lock().unwrap() = e;
    }
}

// ---------- device ----------

fn device_id(db: &Db) -> String {
    if let Some(id) = db.kv_get(KV_DEVICE_ID) {
        return id;
    }
    let mut buf = [0u8; 8];
    getrandom::fill(&mut buf).expect("OS RNG unavailable");
    let id: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    let _ = db.kv_set(KV_DEVICE_ID, &id);
    id
}

fn device_name() -> String {
    sysinfo::System::host_name().unwrap_or_else(|| "device".into())
}

// ---------- folder ----------

fn folder(db: &Db) -> Option<PathBuf> {
    db.kv_get(KV_FOLDER).map(PathBuf::from)
}

fn account_dir(root: &Path, account: &Account) -> PathBuf {
    root.join(APP_FOLDER).join(&account.id)
}

/// Well-known sync folders that exist on this machine.
pub fn candidates() -> Vec<FolderCandidate> {
    let mut found: Vec<(String, PathBuf)> = vec![];
    let home = dirs::home_dir();
    for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(p) = std::env::var_os(var) {
            found.push(("OneDrive".into(), PathBuf::from(p)));
        }
    }
    if let Some(home) = &home {
        found.push(("iCloud Drive".into(), home.join("iCloudDrive")));
        found.push((
            "iCloud Drive".into(),
            home.join("Library/Mobile Documents/com~apple~CloudDocs"),
        ));
        found.push(("Dropbox".into(), home.join("Dropbox")));
        found.push(("Google Drive".into(), home.join("Google Drive")));
        // macOS File Provider locations: OneDrive-<org>, GoogleDrive-<email>/My Drive, ...
        if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let label = name.split('-').next().unwrap_or(&name).to_string();
                let path = e.path();
                let my_drive = path.join("My Drive");
                found.push((label, if my_drive.is_dir() { my_drive } else { path }));
            }
        }
    }
    #[cfg(windows)]
    for letter in ['G', 'H', 'I'] {
        for sub in ["My Drive", "내 드라이브"] {
            found.push(("Google Drive".into(), PathBuf::from(format!("{letter}:\\{sub}"))));
        }
    }
    let mut out: Vec<FolderCandidate> = vec![];
    for (label, path) in found {
        if !path.is_dir() {
            continue;
        }
        let path = path.display().to_string();
        if !out.iter().any(|c| c.path == path) {
            out.push(FolderCandidate { label, path });
        }
    }
    out
}

// ---------- read / write ----------

fn write_own_file(db: &Db, dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let id = device_id(db);
    let file = DeviceFile {
        version: FILE_VERSION,
        device_id: id.clone(),
        device_name: device_name(),
        updated_at: crate::paths::now_ms(),
        days: db::local_days(db)?,
    };
    let bytes = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
    crate::paths::write_private_atomic(&dir.join(format!("{id}.json")), &bytes)
        .map_err(|e| format!("cannot write to {}: {e}", dir.display()))
}

/// Every other device's file in the account folder. Unreadable or foreign files are
/// skipped rather than failing the whole view.
fn read_other_files(dir: &Path, own_id: &str) -> Vec<DeviceFile> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let stem = path.file_stem()?.to_str()?.to_owned();
            if path.extension()? != "json" || stem == own_id {
                return None;
            }
            if e.metadata().ok()?.len() > MAX_FILE_BYTES {
                return None;
            }
            let file: DeviceFile = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
            (file.version == FILE_VERSION && file.device_id == stem).then_some(file)
        })
        .collect()
}

/// The account folder when sync is set up and usable.
fn active_dir(db: &Db, state: &SyncState) -> Option<PathBuf> {
    let root = folder(db)?;
    let account = state.account()?;
    if !root.is_dir() {
        state.set_error(Some(format!("sync folder not found: {}", root.display())));
        return None;
    }
    Some(account_dir(&root, &account))
}

fn export(db: &Db, state: &SyncState, dir: &Path, force: bool) {
    let mut last = state.last_export.lock().unwrap();
    if !force && last.is_some_and(|t| t.elapsed() < EXPORT_EVERY) {
        return;
    }
    match write_own_file(db, dir) {
        Ok(()) => {
            *last = Some(Instant::now());
            state.set_error(None);
        }
        Err(e) => state.set_error(Some(e)),
    }
}

fn merged(db: &Db, dir: &Path) -> Result<db::Merged, String> {
    let own = db::local_days(db)?;
    let others = read_other_files(dir, &device_id(db));
    Ok(db::merge_days(
        own.into_iter().chain(others.into_iter().flat_map(|f| f.days)),
    ))
}

// ---------- hooks used by the stats commands ----------

/// After local stats change: publish them, and return the account-wide progress.
pub fn after_apply(db: &Db, state: &SyncState, local: PetProgress) -> PetProgress {
    let Some(dir) = active_dir(db, state) else {
        return local;
    };
    export(db, state, &dir, false);
    match merged(db, &dir) {
        Ok(m) => PetProgress {
            streak_bonus_xp: local.streak_bonus_xp,
            ..m.progress
        },
        Err(_) => local,
    }
}

/// Account-wide dashboard, or `None` when sync is off (the caller shows local data).
pub fn dashboard(db: &Db, state: &SyncState, today: &str, days: u32) -> Option<Result<DashboardData, String>> {
    let dir = active_dir(db, state)?;
    export(db, state, &dir, false);
    Some(merged(db, &dir).and_then(|m| db::dashboard_from_merged(m, today, days)))
}

fn status(db: &Db, state: &SyncState) -> SyncStatus {
    let account = state.account();
    let folder_path = folder(db);
    let dir = active_dir(db, state);
    let own_id = device_id(db);
    let mut devices = vec![];
    if let Some(dir) = &dir {
        let own_updated = std::fs::metadata(dir.join(format!("{own_id}.json")))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        devices.push(DeviceInfo {
            device_id: own_id.clone(),
            device_name: device_name(),
            updated_at: own_updated,
            this_device: true,
        });
        let mut others: Vec<DeviceInfo> = read_other_files(dir, &own_id)
            .into_iter()
            .map(|f| DeviceInfo {
                device_id: f.device_id,
                device_name: f.device_name,
                updated_at: f.updated_at,
                this_device: false,
            })
            .collect();
        others.sort_by_key(|d| std::cmp::Reverse(d.updated_at));
        devices.extend(others);
    }
    SyncStatus {
        account,
        folder: folder_path.map(|p| p.display().to_string()),
        active: dir.is_some(),
        devices,
        candidates: candidates(),
        last_error: state.last_error.lock().unwrap().clone(),
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn sync_status(db: tauri::State<'_, Db>, state: tauri::State<'_, SyncState>) -> SyncStatus {
    status(&db, &state)
}

/// Sets (or with `None`, clears) the sync folder and publishes this device right away.
/// Turning sync off leaves the files in place, so other devices keep this device's past.
#[tauri::command]
pub fn sync_set_folder(
    db: tauri::State<'_, Db>,
    state: tauri::State<'_, SyncState>,
    path: Option<String>,
) -> Result<SyncStatus, String> {
    match path.map(|p| p.trim().to_owned()).filter(|p| !p.is_empty()) {
        None => {
            db.0.lock()
                .unwrap()
                .execute("DELETE FROM kv WHERE key = ?1", [KV_FOLDER])
                .map_err(|e| e.to_string())?;
            state.set_error(None);
        }
        Some(p) => {
            let root = PathBuf::from(&p);
            if !root.is_absolute() || !root.is_dir() {
                return Err(format!("not a folder: {p}"));
            }
            let account = state.account().ok_or("Claude account not found")?;
            write_own_file(&db, &account_dir(&root, &account))?;
            db.kv_set(KV_FOLDER, &root.display().to_string())
                .map_err(|e| e.to_string())?;
            *state.last_export.lock().unwrap() = Some(Instant::now());
            state.set_error(None);
        }
    }
    Ok(status(&db, &state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{apply_usage, UsageDeltaBatch};

    fn batch(date: &str) -> UsageDeltaBatch {
        UsageDeltaBatch {
            date: date.into(),
            provider: "claude".into(),
            coding_ms: 60_000,
            xp: 5,
            ..Default::default()
        }
    }

    #[test]
    fn account_is_read_from_oauth_block() {
        let v = serde_json::json!({"oauthAccount": {"accountUuid": "ab-12", "emailAddress": "a@b.c"}});
        assert_eq!(
            parse_account(&v),
            Some(Account { id: "ab-12".into(), email: Some("a@b.c".into()) })
        );
        assert_eq!(parse_account(&serde_json::json!({})), None);
        let evil = serde_json::json!({"oauthAccount": {"accountUuid": "../../etc"}});
        assert_eq!(parse_account(&evil), None);
    }

    #[test]
    fn two_devices_see_the_same_total() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("acct");
        let (a, b) = (Db::in_memory(), Db::in_memory());
        apply_usage(&a, &batch("2026-01-01")).unwrap();
        apply_usage(&b, &batch("2026-01-02")).unwrap();
        write_own_file(&a, &dir).unwrap();
        write_own_file(&b, &dir).unwrap();

        let ma = merged(&a, &dir).unwrap().progress;
        let mb = merged(&b, &dir).unwrap().progress;
        assert_eq!(ma, mb);
        // 5 + 5 base XP, bonus 10 (day 1) + 20 (day 2, streak continues across devices).
        assert_eq!((ma.xp, ma.streak), (40, 2));
    }

    #[test]
    fn ignores_junk_and_own_file() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::in_memory();
        write_own_file(&db, tmp.path()).unwrap();
        std::fs::write(tmp.path().join("junk.json"), b"{not json").unwrap();
        std::fs::write(tmp.path().join("notes.txt"), b"hi").unwrap();
        assert!(read_other_files(tmp.path(), &device_id(&db)).is_empty());
    }
}
