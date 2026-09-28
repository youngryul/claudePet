//! Pet window placement: restore the saved position if it is still on a connected
//! monitor, otherwise fall back to the bottom-right corner of the primary work area.

use crate::db::Db;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

const POSITION_KEY: &str = "petPosition";
const MARGIN: i32 = 24;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct SavedPosition {
    pub x: i32,
    pub y: i32,
}

/// Pending (debounced) position write.
#[derive(Default)]
pub struct PositionState(pub Mutex<Option<SavedPosition>>);

fn on_some_monitor(win: &WebviewWindow, p: SavedPosition) -> bool {
    let size = win.outer_size().unwrap_or_default();
    // Require the window's centre to be inside a monitor.
    let cx = p.x + size.width as i32 / 2;
    let cy = p.y + size.height as i32 / 2;
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let mp = m.position();
            let ms = m.size();
            cx >= mp.x && cx < mp.x + ms.width as i32 && cy >= mp.y && cy < mp.y + ms.height as i32
        })
}

pub fn default_position(win: &WebviewWindow) -> Option<SavedPosition> {
    let monitor = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let size = win.outer_size().ok()?;
    let margin = (MARGIN as f64 * monitor.scale_factor()) as i32;
    Some(SavedPosition {
        x: area.position.x + area.size.width as i32 - size.width as i32 - margin,
        y: area.position.y + area.size.height as i32 - size.height as i32 - margin,
    })
}

pub fn restore(app: &AppHandle, win: &WebviewWindow) {
    let saved = app
        .state::<Db>()
        .kv_get(POSITION_KEY)
        .and_then(|s| serde_json::from_str::<SavedPosition>(&s).ok())
        .filter(|p| on_some_monitor(win, *p));
    if let Some(p) = saved.or_else(|| default_position(win)) {
        let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
    }
}

pub fn reset(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pet") {
        if let Some(p) = default_position(&win) {
            let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
            remember(app, p);
        }
    }
}

pub fn remember(app: &AppHandle, p: SavedPosition) {
    *app.state::<PositionState>().0.lock().unwrap() = Some(p);
}

/// Flush the last known position at most every 2 seconds (moves fire per pixel).
pub fn spawn_flusher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        flush(&app);
    });
}

pub fn flush(app: &AppHandle) {
    let pending = app.state::<PositionState>().0.lock().unwrap().take();
    if let Some(p) = pending {
        if let Ok(json) = serde_json::to_string(&p) {
            let _ = app.state::<Db>().kv_set(POSITION_KEY, &json);
        }
    }
}
