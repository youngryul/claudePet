//! In-app updates via `tauri-plugin-updater`.
//!
//! Release builds check the GitHub Releases `latest.json` shortly after launch and
//! then every few hours. When a newer signed build exists, the tray's update item
//! turns into "Install Update vX.Y.Z" — clicking it downloads, verifies, installs
//! and restarts. Nothing is installed without that click.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
pub const CHECK_LABEL: &str = "Check for Updates…";

/// Version of an update that is available but not yet installed.
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<String>>,
    busy: Mutex<bool>,
}

/// Start the background update checker (release builds only).
pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        loop {
            check(&app, false);
            thread::sleep(CHECK_INTERVAL);
        }
    });
}

/// Tray click: install the pending update, or run a manual check.
pub fn on_tray_click(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let pending = state(&app).pending.lock().unwrap().clone();
        if pending.is_some() {
            install(&app);
        } else {
            check(&app, true);
        }
    });
}

fn state(app: &AppHandle) -> tauri::State<'_, UpdateState> {
    app.state::<UpdateState>()
}

/// Returns false if another check/install is already running.
fn begin(app: &AppHandle) -> bool {
    let st = state(app);
    let mut busy = st.busy.lock().unwrap();
    if *busy {
        return false;
    }
    *busy = true;
    true
}

fn end(app: &AppHandle) {
    *state(app).busy.lock().unwrap() = false;
}

fn check(app: &AppHandle, manual: bool) {
    if !begin(app) {
        return;
    }
    if manual {
        crate::tray::set_update_item(app, "Checking for Updates…", false);
    }
    let result = tauri::async_runtime::block_on(async {
        app.updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())
    });
    match result {
        Ok(Some(update)) => {
            log::info!("update available: {}", update.version);
            crate::tray::set_update_item(app, &format!("Install Update v{}", update.version), true);
            *state(app).pending.lock().unwrap() = Some(update.version);
        }
        Ok(None) => {
            if manual {
                flash(app, "You're Up to Date");
            }
        }
        Err(e) => {
            log::warn!("update check failed: {e}");
            if manual {
                flash(app, "Update Check Failed");
            }
        }
    }
    end(app);
}

fn install(app: &AppHandle) {
    if !begin(app) {
        return;
    }
    crate::tray::set_update_item(app, "Downloading Update…", false);
    let result = tauri::async_runtime::block_on(async {
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "update is no longer available".to_string())?;
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())
    });
    match result {
        Ok(()) => {
            crate::platform::placement::flush(app);
            app.restart();
        }
        Err(e) => {
            log::error!("update install failed: {e}");
            *state(app).pending.lock().unwrap() = None;
            flash(app, "Update Failed — Try Again");
            end(app);
        }
    }
}

/// Show a short status on the tray item, then go back to the default label.
fn flash(app: &AppHandle, label: &str) {
    crate::tray::set_update_item(app, label, false);
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        if state(&app).pending.lock().unwrap().is_none() {
            crate::tray::set_update_item(&app, CHECK_LABEL, true);
        }
    });
}
