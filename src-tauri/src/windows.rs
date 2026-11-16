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
    if let Ok(ptr) = win.ns_window() {
        // SAFETY: `ns_window` is this window's live NSWindow and we are on the main
        // thread (run_on_main_thread), as AppKit requires.
        unsafe { mac_panel::apply(ptr, on) };
    }
}

/// macOS only shows another app's window inside a full-screen Space (e.g. a
/// full-screen Chrome) when that window is a non-activating *panel*. Tauri creates
/// a regular NSWindow, so we swap the pet window's class to an NSPanel subclass
/// (the same technique as the `tauri-nspanel` plugin) and configure it as an
/// auxiliary, non-activating, all-Spaces panel.
#[cfg(target_os = "macos")]
mod mac_panel {
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, ClassType, MainThreadOnly};
    use objc2_app_kit::{
        NSPanel, NSResponder, NSWindow, NSWindowCollectionBehavior as B, NSWindowStyleMask,
    };
    use std::ffi::c_void;

    /// kCGStatusWindowLevel — above normal and floating windows.
    const STATUS_LEVEL: isize = 25;
    const NORMAL_LEVEL: isize = 0;

    define_class!(
        // SAFETY: NSPanel has no subclassing requirements; no Drop impl, no ivars.
        #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "AICodingPetPanel"]
        struct PetPanel;

        impl PetPanel {
            // Borderless panels refuse key status by default; the pet popover needs
            // keyboard focus (Escape, focus-loss to close).
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    /// # Safety
    /// `ptr` must be a live NSWindow, and this must run on the main thread.
    pub unsafe fn apply(ptr: *mut c_void, on: bool) {
        let obj: &AnyObject = &*(ptr as *const AnyObject);
        if obj.class() != PetPanel::class() {
            AnyObject::set_class(obj, PetPanel::class());
        }
        let panel: &NSPanel = &*(ptr as *const NSPanel);
        panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        panel.setFloatingPanel(on);
        panel.setHidesOnDeactivate(false);
        panel.setLevel(if on { STATUS_LEVEL } else { NORMAL_LEVEL });
        panel.setCollectionBehavior(
            B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::Stationary | B::IgnoresCycle,
        );
    }
}
