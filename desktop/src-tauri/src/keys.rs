//! Keys (03 section 11.1; 04 D4.2 items 4 and 5): browser accelerators off through `with_webview`, and the shell's
//! own app zoom on `AcceleratorKeyPressed` (Ctrl+plus, Ctrl+=, Ctrl+minus and Ctrl+0, main row and keypad) through
//! the controller's zoom factor, 50% to 300% in 25% steps (WCAG 1.4.4). The engine's own zoom keys are off on the
//! builder (`zoom_hotkeys_enabled(false)` in main.rs) and again here, and devtools are off unless smoke.
//!
//! With accelerators off, Find (Ctrl+F, F3), Print (Ctrl+P), Reload (Ctrl+R, F5) and DevTools (F12) do nothing,
//! while F1 and F8 to F11 reach the page as its own keys (W0A P1). `AcceleratorKeyPressed` fires for real key
//! presses whether accelerators are on or off, so the zoom keys are marked handled there and never reach the page;
//! every other key passes through untouched.

use crate::{Launch, ShellError};
use serde_json::{Value, json};
use tauri::WebviewWindow;
use webview2_com::AcceleratorKeyPressedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
    ICoreWebView2AcceleratorKeyPressedEventArgs, ICoreWebView2Controller, ICoreWebView2Settings,
    ICoreWebView2Settings3,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, VIRTUAL_KEY, VK_ADD, VK_CONTROL, VK_MENU, VK_NUMPAD0, VK_OEM_MINUS, VK_OEM_PLUS,
    VK_SUBTRACT,
};
use windows::core::{BOOL, Interface};

pub const ZOOM_MIN: u16 = 50;
pub const ZOOM_MAX: u16 = 300;
pub const ZOOM_STEP: u16 = 25;
pub const ZOOM_DEFAULT: u16 = 100;
/// The main-row 0 key (there is no VK_ constant for digits).
const VK_DIGIT_0: u32 = 0x30;

/// An app-zoom key the shell handles itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoomKey {
    In,
    Out,
    Reset,
}

const fn vk(key: VIRTUAL_KEY) -> u32 {
    key.0 as u32
}

/// The zoom key for a virtual key pressed with these modifiers, if it is one. Ctrl must be held and Alt must not
/// (Ctrl+Alt is AltGr on many layouts); Shift is ignored, so Ctrl+= and Ctrl+plus (Shift+= on UK and US layouts)
/// are the same key, as in a browser.
pub fn zoom_key(virtual_key: u32, ctrl: bool, alt: bool) -> Option<ZoomKey> {
    if !ctrl || alt {
        return None;
    }
    match virtual_key {
        k if k == vk(VK_OEM_PLUS) || k == vk(VK_ADD) => Some(ZoomKey::In),
        k if k == vk(VK_OEM_MINUS) || k == vk(VK_SUBTRACT) => Some(ZoomKey::Out),
        k if k == VK_DIGIT_0 || k == vk(VK_NUMPAD0) => Some(ZoomKey::Reset),
        _ => None,
    }
}

/// A stored or switched level brought onto the 25% grid inside 50% to 300% (rounded to the nearest step).
pub fn snap(percent: u16) -> u16 {
    let clamped = percent.clamp(ZOOM_MIN, ZOOM_MAX);
    let steps = (clamped + ZOOM_STEP / 2) / ZOOM_STEP;
    (steps * ZOOM_STEP).clamp(ZOOM_MIN, ZOOM_MAX)
}

/// The zoom after one key press, clamped to 50% to 300%. A level off the grid moves to the next step in the
/// direction of the key.
pub fn next_zoom(current_percent: u16, key: ZoomKey) -> u16 {
    let current = current_percent.clamp(ZOOM_MIN, ZOOM_MAX);
    match key {
        ZoomKey::Reset => ZOOM_DEFAULT,
        ZoomKey::In => ((current / ZOOM_STEP + 1) * ZOOM_STEP).min(ZOOM_MAX),
        ZoomKey::Out => (current.div_ceil(ZOOM_STEP).saturating_sub(1) * ZOOM_STEP).max(ZOOM_MIN),
    }
}

/// The engine's zoom factor for a level in percent.
pub fn factor(percent: u16) -> f64 {
    f64::from(snap(percent)) / 100.0
}

/// Turns the browser accelerators, the engine's zoom control and (outside smoke) devtools off, restores the stored
/// zoom, and subscribes to `AcceleratorKeyPressed` for the app zoom. The settings are read back into the shell log
/// (`keys_installed`), so a test can see them without a window.
pub fn install(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = launch;
    let zoom = crate::window::zoom_percent();
    crate::guard::guarded("keys", |report| {
        window.with_webview(move |webview| {
            let controller = webview.controller();
            // SAFETY: COM calls on the controller Tauri hands to this closure on the UI thread, while it is alive.
            let done = match unsafe { configure(&controller, zoom) } {
                Ok(read_back) => {
                    crate::crash::log("keys_installed", read_back);
                    Ok(())
                }
                Err(e) => {
                    crate::crash::log("keys_failed", json!({ "error": e.to_string() }));
                    Err(e.to_string())
                }
            };
            let _ = report.send(done);
        })?;
        Ok(())
    })
}

fn read_bool(f: impl FnOnce(*mut BOOL) -> windows::core::Result<()>) -> Option<bool> {
    let mut value = BOOL::default();
    f(&mut value).ok().map(|()| value.as_bool())
}

/// SAFETY: call on the UI thread with a live controller.
unsafe fn configure(
    controller: &ICoreWebView2Controller,
    zoom: u16,
) -> windows::core::Result<Value> {
    // SAFETY: the caller's contract; every call below is a plain COM getter or setter on live interfaces.
    unsafe {
        let settings = controller.CoreWebView2()?.Settings()?;
        let settings3: ICoreWebView2Settings3 = settings.cast()?;
        settings3.SetAreBrowserAcceleratorKeysEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        settings.SetAreDevToolsEnabled(cfg!(feature = "smoke"))?;
        controller.SetZoomFactor(factor(zoom))?;
        let mut token = 0i64;
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(on_accelerator_key));
        controller.add_AcceleratorKeyPressed(&handler, &mut token)?;
        Ok(read_back(&settings, &settings3, controller))
    }
}

/// SAFETY: plain COM getters on live interfaces, on the UI thread.
unsafe fn read_back(
    settings: &ICoreWebView2Settings,
    settings3: &ICoreWebView2Settings3,
    controller: &ICoreWebView2Controller,
) -> Value {
    let mut zoom_factor = 0f64;
    // SAFETY: the caller's contract.
    unsafe {
        let zoom_read = controller.ZoomFactor(&mut zoom_factor).is_ok();
        json!({
            "accelerator_keys": read_bool(|b| settings3.AreBrowserAcceleratorKeysEnabled(b)),
            "zoom_control": read_bool(|b| settings.IsZoomControlEnabled(b)),
            "devtools": read_bool(|b| settings.AreDevToolsEnabled(b)),
            "zoom_factor": zoom_read.then_some(zoom_factor),
        })
    }
}

/// Whether a key is held now, from the UI thread's keyboard state (the event carries no modifier state).
fn held(key: VIRTUAL_KEY) -> bool {
    // SAFETY: a plain query of the calling thread's keyboard state.
    unsafe { GetKeyState(i32::from(key.0)) < 0 }
}

/// The `AcceleratorKeyPressed` handler: a zoom key is marked handled and changes the zoom; any other key is left
/// alone (the engine, with accelerators off, passes it to the page).
fn on_accelerator_key(
    controller: Option<ICoreWebView2Controller>,
    args: Option<ICoreWebView2AcceleratorKeyPressedEventArgs>,
) -> windows::core::Result<()> {
    let (Some(controller), Some(args)) = (controller, args) else {
        return Ok(());
    };
    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
    let mut virtual_key = 0u32;
    // SAFETY: getters on the live event arguments, inside the handler on the UI thread.
    unsafe {
        args.KeyEventKind(&mut kind)?;
        args.VirtualKey(&mut virtual_key)?;
    }
    let Some(key) = zoom_key(virtual_key, held(VK_CONTROL), held(VK_MENU)) else {
        return Ok(());
    };
    // SAFETY: as above; key down and key up of a zoom key are both kept from the page.
    unsafe { args.SetHandled(true)? };
    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
        return Ok(());
    }
    let current = crate::window::zoom_percent();
    let next = next_zoom(current, key);
    if next != current {
        // SAFETY: a setter on the controller that raised the event.
        unsafe { controller.SetZoomFactor(factor(next))? };
        crate::window::store_zoom(next);
    }
    crate::crash::log(
        "app_zoom",
        json!({ "key": format!("{key:?}"), "from": current, "to": next }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLUS: u32 = 0xBB;
    const MINUS: u32 = 0xBD;
    const PAD_PLUS: u32 = 0x6B;
    const PAD_MINUS: u32 = 0x6D;
    const PAD_0: u32 = 0x60;

    #[test]
    fn main_row_and_keypad_map_to_the_zoom_keys() {
        for (key, want) in [
            (PLUS, ZoomKey::In),
            (PAD_PLUS, ZoomKey::In),
            (MINUS, ZoomKey::Out),
            (PAD_MINUS, ZoomKey::Out),
            (0x30, ZoomKey::Reset),
            (PAD_0, ZoomKey::Reset),
        ] {
            assert_eq!(zoom_key(key, true, false), Some(want), "vk {key:#x}");
            assert_eq!(
                zoom_key(key, false, false),
                None,
                "vk {key:#x} without Ctrl"
            );
            assert_eq!(zoom_key(key, true, true), None, "vk {key:#x} with AltGr");
        }
    }

    #[test]
    fn other_keys_are_left_to_the_page() {
        // F1, F5, F8 to F12, R, F, P, the main-row 1 and K: never zoom keys, with or without Ctrl.
        for key in [
            0x70, 0x74, 0x77, 0x78, 0x79, 0x7A, 0x7B, 0x52, 0x46, 0x50, 0x31, 0x4B,
        ] {
            assert_eq!(zoom_key(key, true, false), None, "vk {key:#x}");
            assert_eq!(zoom_key(key, false, false), None, "vk {key:#x}");
        }
    }

    #[test]
    fn zoom_steps_by_25_between_50_and_300() {
        let mut level = ZOOM_DEFAULT;
        let mut seen = vec![level];
        while level < ZOOM_MAX {
            level = next_zoom(level, ZoomKey::In);
            seen.push(level);
        }
        assert_eq!(seen, [100, 125, 150, 175, 200, 225, 250, 275, 300].to_vec());
        assert_eq!(next_zoom(ZOOM_MAX, ZoomKey::In), ZOOM_MAX);
        assert_eq!(next_zoom(75, ZoomKey::Out), 50);
        assert_eq!(next_zoom(ZOOM_MIN, ZoomKey::Out), ZOOM_MIN);
        assert_eq!(next_zoom(275, ZoomKey::Reset), 100);
    }

    #[test]
    fn a_level_off_the_grid_moves_to_the_next_step() {
        assert_eq!(next_zoom(110, ZoomKey::In), 125);
        assert_eq!(next_zoom(110, ZoomKey::Out), 100);
        assert_eq!(next_zoom(10, ZoomKey::Out), 50);
        assert_eq!(next_zoom(999, ZoomKey::In), 300);
        assert_eq!(snap(110), 100);
        assert_eq!(snap(113), 125);
        assert_eq!(snap(0), 50);
        assert_eq!(snap(u16::MAX), 300);
        assert!((factor(200) - 2.0).abs() < f64::EPSILON);
    }
}
