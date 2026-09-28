//! Platform abstraction. Tauri already smooths over most differences; the remaining
//! OS-specific behaviour lives here behind small functions.
//!
//! - click-through: implemented portably via global cursor polling + per-window
//!   `set_ignore_cursor_events` (works on macOS and Windows).
//! - dock / taskbar presence: macOS uses activation policies, Windows uses skipTaskbar.

pub mod click_through;
pub mod placement;

use tauri::AppHandle;

/// Show the app in the macOS Dock / Cmd-Tab only while a regular window is open.
pub fn set_dock_visible(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, visible);
    }
}
