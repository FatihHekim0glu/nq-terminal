//! How the owner started the app: a minimised start is honoured (V032; owner report on 0.3.1, which came up maximised
//! on screen 1 although it was started with `Start-Process -WindowStyle Minimized`).
//!
//! The window is built hidden and is revealed by window.rs `reveal` once the splash has loaded. The window-state plugin
//! has by then restored the saved size, position and maximised state, and tao's `show()` applies a saved maximised
//! state with ShowWindow(SW_MAXIMIZE), which activates the window. So when this process was started minimised (its
//! STARTUPINFO carries STARTF_USESHOWWINDOW with SW_SHOWMINIMIZED, SW_MINIMIZE or SW_SHOWMINNOACTIVE) the release
//! reveals the window minimised and without activating it instead, and a saved maximised state comes back when the
//! owner restores it. A normal start keeps restoring the saved state as before.
//!
//! The decision is pure and unit-tested here; the one call that puts the window on screen stays in window.rs (the
//! release reveal). tao is not told about a window revealed this way (its own show would restore and activate it), so
//! `pending` records that, and the second-launch focus (window.rs `focus_existing`) restores the window natively before
//! it lets tao show it.
#![cfg_attr(
    any(feature = "smoke", feature = "measure"),
    allow(
        dead_code,
        reason = "only the release reveals the window; the test builds never show it, and the unit tests run the rule"
    )
)]

use std::sync::atomic::{AtomicBool, Ordering};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{GetStartupInfoW, STARTF_USESHOWWINDOW, STARTUPINFOW};
use windows::Win32::UI::WindowsAndMessaging::{
    SIZE_MAXIMIZED, SW_MINIMIZE, SW_SHOWMINIMIZED, SW_SHOWMINNOACTIVE, SendMessageW,
    WINDOWPLACEMENT_FLAGS, WM_SIZE, WPF_RESTORETOMAXIMIZED,
};

/// The start show states that ask for a minimised window (Start-Process -WindowStyle Minimized gives
/// SW_SHOWMINIMIZED; a shortcut set to run minimised and `start /min` give SW_SHOWMINNOACTIVE).
pub const MINIMISED_SHOW_STATES: [u16; 3] = [
    SW_SHOWMINIMIZED.0 as u16,
    SW_MINIMIZE.0 as u16,
    SW_SHOWMINNOACTIVE.0 as u16,
];

/// Whether a window revealed minimised has not been shown through tao yet.
static PENDING: AtomicBool = AtomicBool::new(false);

/// How the window is revealed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reveal {
    /// tao's own show: the saved state (maximised included) comes back and the window takes the focus.
    Restore,
    /// Minimised and not activated; the saved maximised state comes back when the owner restores it.
    Minimised,
}

/// The pure rule: minimised only when the starter set a show state and it is one of the minimised ones.
pub fn reveal_for(flags: u32, show_window: u16) -> Reveal {
    let given = flags & STARTF_USESHOWWINDOW.0 != 0;
    if given && MINIMISED_SHOW_STATES.contains(&show_window) {
        Reveal::Minimised
    } else {
        Reveal::Restore
    }
}

/// This process's start flags and show state, as its starter gave them.
pub fn start_show_state() -> (u32, u16) {
    let mut info = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    // SAFETY: fills a STARTUPINFOW this function owns; the call cannot fail.
    unsafe { GetStartupInfoW(&mut info) };
    (info.dwFlags.0, info.wShowWindow)
}

/// How this process's window is revealed.
pub fn this_start() -> Reveal {
    let (flags, show) = start_show_state();
    reveal_for(flags, show)
}

/// The placement flags for a minimised reveal: restore to maximised exactly when the saved state is maximised.
pub fn placement_flags(current: WINDOWPLACEMENT_FLAGS, maximised: bool) -> WINDOWPLACEMENT_FLAGS {
    if maximised {
        current | WPF_RESTORETOMAXIMIZED
    } else {
        WINDOWPLACEMENT_FLAGS(current.0 & !WPF_RESTORETOMAXIMIZED.0)
    }
}

/// Tells tao that a window just minimised by the reveal still restores maximised.
///
/// The OS sends WM_SIZE with SIZE_MINIMIZED when the placement is set, and tao's handler turns that into
/// `is_maximized() == false` (tao event_loop.rs, WM_SIZE). The window-state plugin saves `maximized` from that flag on
/// CloseRequested and on Exit, so closing the window while it is still minimised would store "not maximised" and the
/// next normal start would come up un-maximised. The window's own placement still carries WPF_RESTORETOMAXIMIZED
/// (`placement_flags`), so the same WM_SIZE the OS will send on restore is sent now, which makes tao's flag say what the
/// owner's saved state says. The size and position the plugin tracks are untouched: it skips both while the window is
/// minimised, and the restore sends the real message again. Nothing is done for a window that was not maximised.
pub fn keep_maximised_flag(hwnd: HWND, maximised: bool) {
    if !maximised {
        return;
    }
    // SAFETY: a plain message to this process's own live window, handled on this thread (the caller is the window's
    // own thread); the client size is 0 by 0, as in the minimise message it follows.
    unsafe {
        SendMessageW(
            hwnd,
            WM_SIZE,
            Some(WPARAM(SIZE_MAXIMIZED as usize)),
            Some(LPARAM(0)),
        );
    }
}

/// Records that the window was revealed minimised, outside tao.
pub fn mark_pending() {
    PENDING.store(true, Ordering::SeqCst);
}

/// Whether the window was revealed minimised and tao has not shown it since; clears the mark.
pub fn take_pending() -> bool {
    PENDING.swap(false, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        SW_HIDE, SW_MAXIMIZE, SW_RESTORE, SW_SHOW, SW_SHOWDEFAULT, SW_SHOWMAXIMIZED, SW_SHOWNA,
        SW_SHOWNOACTIVATE, SW_SHOWNORMAL, WPF_SETMINPOSITION,
    };

    const GIVEN: u32 = STARTF_USESHOWWINDOW.0;

    #[test]
    fn a_minimised_start_is_revealed_minimised() {
        for show in [SW_SHOWMINIMIZED, SW_MINIMIZE, SW_SHOWMINNOACTIVE] {
            assert_eq!(
                reveal_for(GIVEN, show.0 as u16),
                Reveal::Minimised,
                "{show:?}"
            );
            // Other start flags beside it change nothing.
            assert_eq!(
                reveal_for(GIVEN | 0x100, show.0 as u16),
                Reveal::Minimised,
                "{show:?}"
            );
        }
    }

    #[test]
    fn a_normal_or_maximised_start_restores_the_saved_state() {
        for show in [
            SW_SHOWNORMAL,
            SW_SHOW,
            SW_SHOWDEFAULT,
            SW_SHOWMAXIMIZED,
            SW_MAXIMIZE,
            SW_RESTORE,
            SW_SHOWNA,
            SW_SHOWNOACTIVATE,
            SW_HIDE,
        ] {
            assert_eq!(
                reveal_for(GIVEN, show.0 as u16),
                Reveal::Restore,
                "{show:?}"
            );
        }
    }

    #[test]
    fn a_show_state_the_starter_did_not_set_is_ignored() {
        assert_eq!(reveal_for(0, SW_SHOWMINIMIZED.0 as u16), Reveal::Restore);
        assert_eq!(
            reveal_for(0x100, SW_SHOWMINNOACTIVE.0 as u16),
            Reveal::Restore
        );
    }

    #[test]
    fn the_saved_maximised_state_comes_back_on_restore() {
        let other = WPF_SETMINPOSITION;
        assert_eq!(placement_flags(other, true), other | WPF_RESTORETOMAXIMIZED);
        assert_eq!(
            placement_flags(other | WPF_RESTORETOMAXIMIZED, false),
            other
        );
        assert_eq!(
            placement_flags(WINDOWPLACEMENT_FLAGS(0), false),
            WINDOWPLACEMENT_FLAGS(0)
        );
    }

    #[test]
    fn the_start_state_of_this_test_process_is_readable() {
        let (flags, show) = start_show_state();
        assert_eq!(this_start(), reveal_for(flags, show));
    }

    #[test]
    fn the_pending_mark_is_taken_once() {
        mark_pending();
        assert!(take_pending());
        assert!(!take_pending());
    }
}
