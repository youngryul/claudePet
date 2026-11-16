//! Window management for the pet overlay and the dashboard.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn set_pet_visible(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window("pet") {
        let _ = if visible { win.show() } else { win.hide() };
        let _ = app.emit("pet://visibility", visible);
    }
}

pub fn open_dashboard(app: &AppHandle, tab: Option<&str>) {
    if let Some(win) = app.get_webview_window("dashboard") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    } else {
        let url = match tab {
            Some(t) => format!("index.html#{t}"),
            None => "index.html".into(),
        };
        let built = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App(url.into()))
            .title("AI Coding Pet")
            .inner_size(920.0, 680.0)
            .min_inner_size(720.0, 520.0)
            .center()
            .build();
        if let Err(e) = built {
            log::error!("failed to open dashboard: {e}");
            return;
        }
        crate::platform::set_dock_visible(app, true);
    }
    if let Some(t) = tab {
        let _ = app.emit_to("dashboard", "dashboard://navigate", t);
    }
}

/// Keep the pet above other windows. On macOS the regular "always on top" level
/// (floating) is not enough for full-screen apps such as a full-screen browser, so
/// the window is also raised to the status-bar level and allowed into full-screen
/// spaces as an auxiliary window.
pub fn set_pet_always_on_top(app: &AppHandle, on: bool) {
    let Some(win) = app.get_webview_window("pet") else {
        return;
    };
    let _ = win.set_always_on_top(on);
    #[cfg(target_os = "macos")]
    {
        let w = win.clone();
        let _ = win.run_on_main_thread(move || macos_set_level(&w, on));
    }
}

#[cfg(target_os = "macos")]
fn macos_set_level(win: &tauri::WebviewWindow, on: bool) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as B};
    /// kCGStatusWindowLevel — above normal and floating windows, incl. full-screen apps.
    const STATUS_LEVEL: isize = 25;
    const NORMAL_LEVEL: isize = 0;

    let Ok(ptr) = win.ns_window() else {
        return;
    };
    // SAFETY: `ns_window` returns this window's live NSWindow pointer and we are on
    // the main thread (run_on_main_thread), as AppKit requires.
    let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    ns.setLevel(if on { STATUS_LEVEL } else { NORMAL_LEVEL });
    ns.setCollectionBehavior(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::IgnoresCycle);
}
