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
