//! Click-through for the transparent pet window.
//!
//! The OS can only ignore mouse events for a whole window, so we poll the global cursor
//! position and toggle `set_ignore_cursor_events` depending on whether the cursor is
//! over the pet's hit region (reported by the frontend in logical pixels).

use serde::Deserialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Default)]
pub struct ClickThroughState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    /// While a popover or drag is active the whole window must receive input.
    interactive: bool,
    hit: Option<HitRect>,
    ignoring: bool,
}

impl ClickThroughState {
    pub fn configure(&self, enabled: bool, interactive: bool, hit: Option<HitRect>) {
        let mut s = self.inner.lock().unwrap();
        s.enabled = enabled;
        s.interactive = interactive;
        if hit.is_some() {
            s.hit = hit;
        }
    }

    /// True while the popover temporarily enlarges the pet window.
    pub fn is_interactive(&self) -> bool {
        self.inner.lock().unwrap().interactive
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("click-through".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(40));
            tick(&app);
        })
        .expect("spawn click-through thread");
}

fn tick(app: &AppHandle) {
    let Some(win) = app.get_webview_window("pet") else {
        return;
    };
    let state = app.state::<ClickThroughState>();
    let (enabled, interactive, hit, ignoring) = {
        let s = state.inner.lock().unwrap();
        (s.enabled, s.interactive, s.hit, s.ignoring)
    };

    let want_ignore = if !enabled || interactive || !win.is_visible().unwrap_or(false) {
        false
    } else {
        match (
            hit,
            win.cursor_position(),
            win.outer_position(),
            win.scale_factor(),
        ) {
            (Some(h), Ok(cursor), Ok(pos), Ok(scale)) => {
                let x = (cursor.x - pos.x as f64) / scale;
                let y = (cursor.y - pos.y as f64) / scale;
                let inside = x >= h.x && x <= h.x + h.width && y >= h.y && y <= h.y + h.height;
                !inside
            }
            _ => false,
        }
    };

    if want_ignore != ignoring && win.set_ignore_cursor_events(want_ignore).is_ok() {
        state.inner.lock().unwrap().ignoring = want_ignore;
    }
}
