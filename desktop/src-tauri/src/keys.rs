//! Keys (03 section 11.1; 04 D4.2): browser accelerators off through `with_webview`, and the shell's own app zoom
//! on `AcceleratorKeyPressed` (Ctrl+plus, Ctrl+=, Ctrl+minus, Ctrl+0, main row and keypad) through `set_zoom`,
//! 50% to 300% in 25% steps (WCAG 1.4.4). The engine's own zoom keys are already off on the builder
//! (`zoom_hotkeys_enabled(false)` in main.rs).
//!
//! STAGE A: stubs with their final signatures; stage B (slice w4b-window-keys) fills them.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError};
use tauri::WebviewWindow;

pub const ZOOM_MIN: u16 = 50;
pub const ZOOM_MAX: u16 = 300;
pub const ZOOM_STEP: u16 = 25;
pub const ZOOM_DEFAULT: u16 = 100;

/// An app-zoom key the shell handles itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoomKey {
    In,
    Out,
    Reset,
}

/// Turns the browser accelerators off and subscribes to `AcceleratorKeyPressed` for the app zoom. STUB.
pub fn install(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}

/// The zoom after one key press, clamped to 50% to 300%. STUB: returns the current level unchanged.
pub fn next_zoom(current_percent: u16, key: ZoomKey) -> u16 {
    let _ = key;
    current_percent
}
