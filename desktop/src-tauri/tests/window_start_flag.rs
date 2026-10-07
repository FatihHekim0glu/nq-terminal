//! A minimised start that is closed without being restored keeps the saved maximised state (V032 audit finding on
//! 0.3.1). Window.rs `reveal_minimised` puts a saved-maximised window on screen minimised; the OS then sends WM_SIZE with
//! SIZE_MINIMIZED, and tao answers with MAXIMIZED = false. The window-state plugin saves `maximized` from that flag when
//! the window closes (CloseRequested and Exit), so the next normal start came up un-maximised.
//!
//! The test builds a real tao window that is never shown, saves the flag the way the reveal leaves it (maximised, then
//! the minimise message) and checks `start::keep_maximised_flag`, the call the reveal makes right after it minimises the
//! window. Nothing reaches the screen and nothing takes the focus.
#![cfg(windows)]
#![allow(
    clippy::disallowed_methods,
    reason = "test code: it builds its own never-shown tao window"
)]

#[path = "../src/window_start.rs"]
mod start;

use start::keep_maximised_flag;
use tao::event_loop::EventLoopBuilder;
use tao::platform::windows::{EventLoopBuilderExtWindows, WindowExtWindows};
use tao::window::{Window, WindowBuilder};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    IsIconic, IsWindowVisible, SIZE_MINIMIZED, SendMessageW, WM_SIZE,
};

/// A window of its own that is never shown (`with_visible(false)`), on an event loop that may run on the test thread.
fn hidden_window(event_loop: &tao::event_loop::EventLoop<()>, maximised: bool) -> (Window, HWND) {
    let window = WindowBuilder::new()
        .with_visible(false)
        .with_focused(false)
        .with_maximized(maximised)
        .build(event_loop)
        .expect("a hidden window");
    let hwnd = HWND(window.hwnd() as *mut core::ffi::c_void);
    (window, hwnd)
}

/// What the OS tells the window when it is minimised: WM_SIZE with SIZE_MINIMIZED and a 0 by 0 client area.
fn minimise_message(hwnd: HWND) {
    // SAFETY: a plain message to this test's own window, whose procedure runs on this thread.
    unsafe {
        SendMessageW(
            hwnd,
            WM_SIZE,
            Some(WPARAM(SIZE_MINIMIZED as usize)),
            Some(LPARAM(0)),
        );
    }
}

#[test]
fn the_window_is_hidden_and_the_minimise_message_clears_tao_s_maximised_flag() {
    let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
    let (window, hwnd) = hidden_window(&event_loop, true);
    assert!(window.is_maximized(), "the window was built maximised");
    // SAFETY: plain reads on this test's own window.
    unsafe {
        assert!(
            !IsWindowVisible(hwnd).as_bool(),
            "the test window must stay hidden"
        );
        assert!(!IsIconic(hwnd).as_bool());
    }
    minimise_message(hwnd);
    // The behaviour the fix works around: if tao ever stops doing this, the fix is no longer needed.
    assert!(
        !window.is_maximized(),
        "tao reads the minimise message as 'not maximised'"
    );
}

#[test]
fn a_maximised_window_that_was_minimised_at_the_reveal_still_reads_maximised() {
    let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
    let (window, hwnd) = hidden_window(&event_loop, true);
    minimise_message(hwnd);
    keep_maximised_flag(hwnd, true);
    assert!(
        window.is_maximized(),
        "the window-state plugin saves tao's flag at close, so it must still say maximised"
    );
}

#[test]
fn a_window_that_was_not_maximised_stays_not_maximised() {
    let event_loop = EventLoopBuilder::new().with_any_thread(true).build();
    let (window, hwnd) = hidden_window(&event_loop, false);
    minimise_message(hwnd);
    keep_maximised_flag(hwnd, false);
    assert!(!window.is_maximized());
}
