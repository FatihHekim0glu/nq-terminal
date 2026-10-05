//! Quiet memory when the window is put away (vnext perf-3): the WebView2 memory usage target goes to Low when the
//! main window is minimised or hidden, and back to Normal when it is restored or shown. Focus loss alone changes
//! nothing (the owner's default: a game in front of a visible window keeps Normal). Low is best effort: scripts keep
//! running and the engine may page memory out; the shell never mixes it with `TrySuspend`.
//!
//! The level is set through `ICoreWebView2_19` from the webview2-com crate wry already uses. A runtime without that
//! interface is left alone, and the shell log says so once (`memory_target_unsupported`).
//!
//! A window never shown yet counts as visible: the release before its reveal (so the first page loads at Normal)
//! and every smoke or measure build, whose window is never put on screen, so no measurement changes. The smoke
//! harness's simulated minimise hides the controller, not the window, and reaches this module through
//! `on_simulated_visibility`.

use crate::MAIN_LABEL;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{Manager, WebviewWindow, Window, WindowEvent};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19, ICoreWebView2Controller,
};
use windows::core::Interface;

/// The WebView2 memory usage target level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Normal,
    Low,
}

impl Level {
    const fn engine(self) -> COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL {
        match self {
            Self::Normal => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            Self::Low => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        }
    }

    const fn code(self) -> u8 {
        match self {
            Self::Normal => 0,
            Self::Low => 1,
        }
    }

    const fn from_code(code: u8) -> Self {
        if code == 1 { Self::Low } else { Self::Normal }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Low => "low",
        }
    }
}

/// What the shell knows about the main window when an event arrives.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WindowState {
    pub minimised: bool,
    pub visible: bool,
    pub maximised: bool,
    pub focused: bool,
}

/// The level for a window state: Low when it is minimised or hidden, Normal otherwise (focus does not count).
pub const fn level_for(state: WindowState) -> Level {
    if state.minimised || !state.visible {
        Level::Low
    } else {
        Level::Normal
    }
}

/// Whether the window counts as visible: a window never shown yet does, so start-up and the test builds (whose
/// window is never shown) stay at Normal.
pub const fn counted_visible(visible: bool, shown_before: bool) -> bool {
    visible || !shown_before
}

/// The level to set, or None when the engine already has the wanted one.
pub fn change(applied: Level, wanted: Level) -> Option<Level> {
    (applied != wanted).then_some(wanted)
}

/// Whether a window event can mean the window was minimised, restored, hidden or shown: on Windows a minimise and a
/// restore each send a resize and a move, and a hide or a reveal moves the focus.
pub const fn worth_a_look(event: &WindowEvent) -> bool {
    matches!(
        event,
        WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::Focused(_)
    )
}

/// The level the engine has (Normal until the shell sets one).
static APPLIED: AtomicU8 = AtomicU8::new(0);
/// Whether the main window has been seen on screen.
static SHOWN: AtomicBool = AtomicBool::new(false);
/// Whether the runtime lacks `ICoreWebView2_19`; once set, nothing more is tried.
static UNSUPPORTED: AtomicBool = AtomicBool::new(false);

/// The window-event hook (main.rs): reads the main window's state and sets the level when it changes.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_LABEL || !worth_a_look(event) || UNSUPPORTED.load(Ordering::Relaxed) {
        return;
    }
    let Some(main) = window.app_handle().get_webview_window(MAIN_LABEL) else {
        return;
    };
    let visible = main.is_visible().unwrap_or(true);
    if visible {
        SHOWN.store(true, Ordering::Relaxed);
    }
    let state = WindowState {
        minimised: main.is_minimized().unwrap_or(false),
        visible: counted_visible(visible, SHOWN.load(Ordering::Relaxed)),
        maximised: main.is_maximized().unwrap_or(false),
        focused: main.is_focused().unwrap_or(false),
    };
    follow(&main, state);
}

/// Smoke only: the harness's simulated minimise (smoke.rs hides or shows the controller behind the hidden window)
/// counts as the window being hidden or shown.
#[cfg(feature = "smoke")]
#[allow(
    dead_code,
    reason = "called by the smoke visibility watcher in smoke.rs"
)]
pub fn on_simulated_visibility(window: &WebviewWindow, visible: bool) {
    let state = WindowState {
        visible,
        ..WindowState::default()
    };
    follow(window, state);
}

/// Sets the level for this state when it differs from the one the engine has.
fn follow(window: &WebviewWindow, state: WindowState) {
    if UNSUPPORTED.load(Ordering::Relaxed) {
        return;
    }
    let applied = Level::from_code(APPLIED.load(Ordering::Relaxed));
    if let Some(level) = change(applied, level_for(state)) {
        apply(window, level, state);
    }
}

/// What setting the level came to.
enum Outcome {
    Set,
    Unsupported,
}

fn apply(window: &WebviewWindow, level: Level, state: WindowState) {
    let queued = window.with_webview(move |webview| {
        // SAFETY: COM calls on the controller Tauri hands to this closure on the UI thread, while it is alive.
        match unsafe { set_level(&webview.controller(), level) } {
            Ok(Outcome::Set) => {
                APPLIED.store(level.code(), Ordering::Relaxed);
                crate::crash::log(
                    "memory_target",
                    json!({
                        "level": level.name(),
                        "minimised": state.minimised,
                        "visible": state.visible,
                        "maximised": state.maximised,
                        "focused": state.focused,
                    }),
                );
            }
            Ok(Outcome::Unsupported) => {
                if !UNSUPPORTED.swap(true, Ordering::Relaxed) {
                    crate::crash::log(
                        "memory_target_unsupported",
                        json!({ "interface": "ICoreWebView2_19" }),
                    );
                }
            }
            Err(e) => crate::crash::log(
                "memory_target_failed",
                json!({ "level": level.name(), "error": e.to_string() }),
            ),
        }
    });
    if let Err(e) = queued {
        crate::crash::log(
            "memory_target_failed",
            json!({ "level": level.name(), "error": e.to_string() }),
        );
    }
}

/// SAFETY: call on the UI thread with a live controller.
unsafe fn set_level(
    controller: &ICoreWebView2Controller,
    level: Level,
) -> windows::core::Result<Outcome> {
    // SAFETY: the caller's contract; a plain COM query and setter on live interfaces.
    unsafe {
        let Ok(core) = controller.CoreWebView2()?.cast::<ICoreWebView2_19>() else {
            return Ok(Outcome::Unsupported);
        };
        core.SetMemoryUsageTargetLevel(level.engine())?;
    }
    Ok(Outcome::Set)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOWN_STATE: WindowState = WindowState {
        minimised: false,
        visible: true,
        maximised: false,
        focused: true,
    };

    #[test]
    fn a_minimised_window_is_low() {
        let state = WindowState {
            minimised: true,
            focused: false,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(state), Level::Low);
    }

    #[test]
    fn a_minimised_maximised_window_is_low() {
        let state = WindowState {
            minimised: true,
            maximised: true,
            focused: false,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(state), Level::Low);
    }

    #[test]
    fn a_hidden_window_is_low() {
        let state = WindowState {
            visible: false,
            focused: false,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(state), Level::Low);
    }

    #[test]
    fn a_normal_window_is_normal() {
        assert_eq!(level_for(SHOWN_STATE), Level::Normal);
    }

    #[test]
    fn a_maximised_window_is_normal() {
        let state = WindowState {
            maximised: true,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(state), Level::Normal);
    }

    #[test]
    fn an_unfocused_window_is_normal() {
        let state = WindowState {
            focused: false,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(state), Level::Normal);
    }

    #[test]
    fn a_window_never_shown_counts_as_visible() {
        assert!(counted_visible(false, false));
        assert!(!counted_visible(false, true));
        assert!(counted_visible(true, true));
        let before_reveal = WindowState {
            visible: counted_visible(false, false),
            focused: false,
            ..SHOWN_STATE
        };
        assert_eq!(level_for(before_reveal), Level::Normal);
    }

    #[test]
    fn the_level_is_set_only_when_it_changes() {
        assert_eq!(change(Level::Normal, Level::Normal), None);
        assert_eq!(change(Level::Low, Level::Low), None);
        assert_eq!(change(Level::Normal, Level::Low), Some(Level::Low));
        assert_eq!(change(Level::Low, Level::Normal), Some(Level::Normal));
    }

    #[test]
    fn the_levels_map_to_the_engine_values_and_round_trip() {
        assert_eq!(
            Level::Low.engine(),
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        );
        assert_eq!(
            Level::Normal.engine(),
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        );
        for level in [Level::Normal, Level::Low] {
            assert_eq!(Level::from_code(level.code()), level);
        }
    }

    #[test]
    fn only_size_move_and_focus_events_are_looked_at() {
        use tauri::{PhysicalPosition, PhysicalSize};
        assert!(worth_a_look(&WindowEvent::Resized(PhysicalSize::new(0, 0))));
        assert!(worth_a_look(&WindowEvent::Moved(PhysicalPosition::new(
            -32000, -32000
        ))));
        assert!(worth_a_look(&WindowEvent::Focused(false)));
        assert!(!worth_a_look(&WindowEvent::Destroyed));
    }
}
