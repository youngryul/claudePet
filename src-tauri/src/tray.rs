//! System tray: connection status + quick actions.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

pub struct TrayHandles {
    pub status: MenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
    pub update: MenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "○ Claude Offline", false, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show_pet", "Show Pet", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide_pet", "Hide Pet", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Launch at Startup",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(
        app,
        "update",
        crate::updater::CHECK_LABEL,
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit AI Coding Pet", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &sep()?,
            &dashboard,
            &show,
            &hide,
            &settings,
            &sep()?,
            &autostart,
            &update,
            &sep()?,
            &quit,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("AI Coding Pet")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dashboard" => crate::windows::open_dashboard(app, Some("dashboard")),
            "settings" => crate::windows::open_dashboard(app, Some("settings")),
            "show_pet" => crate::windows::set_pet_visible(app, true),
            "hide_pet" => crate::windows::set_pet_visible(app, false),
            "autostart" => {
                let al = app.autolaunch();
                let enable = !al.is_enabled().unwrap_or(false);
                let _ = if enable { al.enable() } else { al.disable() };
                sync_autostart(app);
                let _ = app.emit("autostart://changed", enable);
            }
            "update" => crate::updater::on_tray_click(app),
            "quit" => {
                crate::platform::placement::flush(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    app.manage(TrayHandles {
        status,
        autostart,
        update,
    });
    Ok(())
}

pub fn sync_autostart(app: &AppHandle) {
    if let Some(h) = app.try_state::<TrayHandles>() {
        let _ = h
            .autostart
            .set_checked(app.autolaunch().is_enabled().unwrap_or(false));
    }
}

pub fn set_status(app: &AppHandle, label: &str) {
    if let Some(h) = app.try_state::<TrayHandles>() {
        let _ = h.status.set_text(label);
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("AI Coding Pet — {label}")));
    }
}

pub fn set_update_item(app: &AppHandle, label: &str, enabled: bool) {
    if let Some(h) = app.try_state::<TrayHandles>() {
        let _ = h.update.set_text(label);
        let _ = h.update.set_enabled(enabled);
    }
}
