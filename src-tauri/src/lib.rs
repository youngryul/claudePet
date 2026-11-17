//! AI Coding Pet — Tauri backend.
//!
//! Responsibilities of the Rust layer (kept deliberately thin):
//! transport (collector), persistence (SQLite), OS integration (windows, tray,
//! click-through, autostart) and Claude settings patching. Provider normalisation,
//! the pet state machine and XP rules live in TypeScript (`src/`).

pub mod chat;
pub mod claude;
pub mod collector;
pub mod db;
pub mod paths;
pub mod platform;
pub mod process;
pub mod sync;
pub mod tray;
pub mod updater;
pub mod windows;

use collector::server::{CollectorSnapshot, CollectorState};
use db::{DashboardData, Db, PetProgress, UsageDeltaBatch, UsageSample};
use platform::click_through::{ClickThroughState, HitRect};
use platform::placement::{PositionState, SavedPosition};
use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

const SETTINGS_KEY: &str = "settings";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    dev_mode: bool,
    platform: String,
    data_dir: Option<String>,
    collector_port: Option<u16>,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, collector: tauri::State<'_, Arc<CollectorState>>) -> AppInfo {
    let env_dev = std::env::var("AI_PET_DEV_MODE")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false);
    AppInfo {
        version: app.package_info().version.to_string(),
        dev_mode: cfg!(debug_assertions) || env_dev,
        platform: std::env::consts::OS.into(),
        data_dir: paths::app_data_dir().map(|d| d.display().to_string()),
        collector_port: collector.endpoint.lock().unwrap().as_ref().map(|e| e.port),
    }
}

#[tauri::command]
fn collector_snapshot(state: tauri::State<'_, Arc<CollectorState>>) -> CollectorSnapshot {
    state.snapshot()
}

#[tauri::command]
fn claude_process_running(probe: tauri::State<'_, process::ProcessProbe>) -> bool {
    probe.claude_running()
}

#[tauri::command]
fn settings_load(db: tauri::State<'_, Db>) -> Option<serde_json::Value> {
    db.kv_get(SETTINGS_KEY)
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
fn settings_save(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    settings: serde_json::Value,
) -> Result<(), String> {
    db.kv_set(SETTINGS_KEY, &settings.to_string())
        .map_err(|e| e.to_string())?;
    let _ = app.emit("settings://changed", &settings);
    Ok(())
}

#[tauri::command]
fn stats_apply(
    db: tauri::State<'_, Db>,
    sync_state: tauri::State<'_, sync::SyncState>,
    batch: UsageDeltaBatch,
) -> Result<PetProgress, String> {
    let local = db::apply_usage(&db, &batch)?;
    Ok(sync::after_apply(&db, &sync_state, local))
}

#[tauri::command]
fn stats_dashboard(
    db: tauri::State<'_, Db>,
    sync_state: tauri::State<'_, sync::SyncState>,
    today: String,
    days: u32,
) -> Result<DashboardData, String> {
    let days = days.min(90);
    sync::dashboard(&db, &sync_state, &today, days)
        .unwrap_or_else(|| db::dashboard(&db, &today, days))
}

#[tauri::command]
fn stats_session_cursor(
    db: tauri::State<'_, Db>,
    provider: String,
    session_id: String,
) -> Option<serde_json::Value> {
    db::get_session_cursor(&db, &provider, &session_id)
}

#[tauri::command]
fn stats_record_samples(db: tauri::State<'_, Db>, samples: Vec<UsageSample>) -> Result<(), String> {
    db::record_samples(&db, &samples)
}

#[tauri::command]
fn pet_set_interaction(
    state: tauri::State<'_, ClickThroughState>,
    click_through: bool,
    interactive: bool,
    hit: Option<HitRect>,
) {
    state.configure(click_through, interactive, hit);
}

#[tauri::command]
fn pet_set_visible(app: tauri::AppHandle, visible: bool) {
    windows::set_pet_visible(&app, visible);
}

#[tauri::command]
fn pet_set_always_on_top(app: tauri::AppHandle, on: bool) {
    windows::set_pet_always_on_top(&app, on);
}

#[tauri::command]
fn pet_reset_position(app: tauri::AppHandle) {
    platform::placement::reset(&app);
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle, tab: Option<String>) {
    windows::open_dashboard(&app, tab.as_deref());
}

#[tauri::command]
fn tray_set_status(app: tauri::AppHandle, label: String) {
    tray::set_status(&app, &label);
}

#[tauri::command]
fn autostart_changed(app: tauri::AppHandle) {
    tray::sync_autostart(&app);
}

pub fn run() {
    let collector_state = Arc::new(CollectorState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            windows::set_pet_visible(app, true);
            windows::open_dashboard(app, None);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(collector_state.clone())
        .manage(Arc::new(chat::ChatState::default()))
        .manage(sync::SyncState::default())
        .manage(ClickThroughState::default())
        .manage(PositionState::default())
        .manage(process::ProcessProbe::default())
        .manage(updater::UpdateState::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            let data_dir = paths::ensure_app_data_dir()?;
            app.manage(Db::open(&data_dir.join("pet.db"))?);

            platform::set_dock_visible(&handle, false);

            if let Err(e) = collector::server::start(handle.clone(), collector_state.clone()) {
                log::error!("collector failed to start: {e}");
            }
            tray::build(&handle)?;

            if let Some(pet) = app.get_webview_window("pet") {
                platform::placement::restore(&handle, &pet);
                let _ = pet.show();
            }
            platform::click_through::spawn(handle.clone());
            updater::spawn(handle.clone());
            platform::placement::spawn_flusher(handle);
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("pet", WindowEvent::Moved(pos))
                if !window
                    .app_handle()
                    .state::<ClickThroughState>()
                    .is_interactive() =>
            {
                platform::placement::remember(
                    window.app_handle(),
                    SavedPosition { x: pos.x, y: pos.y },
                );
            }
            ("pet", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            ("dashboard", WindowEvent::Destroyed) => {
                platform::set_dock_visible(window.app_handle(), false);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            collector_snapshot,
            claude_process_running,
            settings_load,
            settings_save,
            stats_apply,
            stats_dashboard,
            stats_session_cursor,
            stats_record_samples,
            pet_set_interaction,
            pet_set_visible,
            pet_set_always_on_top,
            pet_reset_position,
            open_dashboard,
            tray_set_status,
            autostart_changed,
            claude::claude_detect,
            claude::claude_preview,
            claude::claude_apply,
            claude::claude_test_connection,
            chat::chat_send,
            chat::chat_cancel,
            chat::chat_reset,
            sync::sync_status,
            sync::sync_set_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI Coding Pet")
        .run(|app, event| {
            // Keep running in the tray when the dashboard is closed.
            match event {
                tauri::RunEvent::ExitRequested {
                    code: None, api, ..
                } => api.prevent_exit(),
                tauri::RunEvent::Exit => platform::placement::flush(app),
                _ => {}
            }
        });
}
