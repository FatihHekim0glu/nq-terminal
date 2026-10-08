//! Close requests that land on a helper window (the close investigation of 8 October 2026).
//!
//! The UI thread owns two unowned top-level helper windows besides the app window: tao's event target window (class
//! `Tao Thread Event Target`) and, in the release only, the single-instance plugin's window (class
//! `<identifier>-sic`). Both are created with `WS_VISIBLE` and both send WM_CLOSE to `DefWindowProcW`, which destroys
//! them. Windows tools that close "the main window" of a process (.NET `Process.CloseMainWindow`, Task Manager style
//! closers) pick the first unowned visible top-level window of the process in z-order, and that is a helper whenever
//! the app window is hidden (before the reveal) or minimised (a minimised window drops to the bottom). The helper then
//! destroyed itself, the app window never saw a close request, and the app kept running; losing the tao window also
//! cuts every message other threads send to the UI thread, and losing the plugin window stops a second launch from
//! finding the first.
//!
//! The relay subclasses both helpers on the UI thread: a WM_CLOSE sent to a helper is posted on to the app window, which
//! runs the usual close (flush.rs, then the supervisor's shutdown), and the helper stays. Every other message reaches
//! the helper unchanged. tao destroys its window with DestroyWindow, never WM_CLOSE, so its teardown is untouched.

use serde_json::json;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumThreadWindows, GetClassNameW, PostMessageW, WM_CLOSE, WM_NCDESTROY,
};
use windows::core::BOOL;

/// The class of tao's event target window (tao 0.37 windows/event_loop.rs).
pub const TAO_TARGET_CLASS: &str = "Tao Thread Event Target";
/// The suffix of the single-instance plugin's window class: `<identifier>-sic`, or `<identifier>_<semver>-sic` when
/// the plugin's `semver` feature is on.
const SINGLE_INSTANCE_SUFFIX: &str = "-sic";
/// This module's subclass id (any value unique per window and procedure).
const SUBCLASS_ID: usize = 0x4E51_5443;

/// Whether a window of this class, on the UI thread, gets the relay.
pub fn relays_close(class: &str, identifier: &str) -> bool {
    if class == TAO_TARGET_CLASS {
        return true;
    }
    let Some(stem) = class.strip_suffix(SINGLE_INSTANCE_SUFFIX) else {
        return false;
    };
    !identifier.is_empty()
        && (stem == identifier
            || stem
                .strip_prefix(identifier)
                .is_some_and(|rest| rest.starts_with('_')))
}

/// The class name of a window; empty when it cannot be read.
fn class_of(hwnd: HWND) -> String {
    let mut class = [0u16; 256];
    // SAFETY: a read-only query into a buffer of the stated length; a dead handle yields 0.
    let n = unsafe { GetClassNameW(hwnd, &mut class) };
    String::from_utf16_lossy(&class[..usize::try_from(n).unwrap_or(0)])
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that `thread_windows` keeps alive for the whole enumeration.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

/// The top-level windows of the calling thread.
fn thread_windows() -> Vec<isize> {
    let mut list: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `list`, which outlives the call.
    let _ = unsafe {
        EnumThreadWindows(
            GetCurrentThreadId(),
            Some(collect),
            LPARAM(&mut list as *mut _ as isize),
        )
    };
    list
}

/// The subclass procedure of a helper window. `target` is the app window's handle.
unsafe extern "system" fn relay(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    target: usize,
) -> LRESULT {
    if msg == WM_CLOSE {
        // SAFETY: posting a message to a window handle; a handle that is gone only makes the post fail.
        let posted =
            unsafe { PostMessageW(Some(HWND(target as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        crate::crash::log(
            "close_relayed",
            json!({ "from": class_of(hwnd), "posted": posted.is_ok() }),
        );
        return LRESULT(0);
    }
    if msg == WM_NCDESTROY {
        // SAFETY: removes this procedure from the window it was installed on, on the window's own thread.
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(relay), SUBCLASS_ID) };
    }
    // SAFETY: passes the message on to the next procedure of the window, with the arguments it came with.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Installs the relay on `helper` towards `target`. Must run on the thread that created `helper`.
pub fn install_on(helper: HWND, target: HWND) -> bool {
    // SAFETY: subclassing a window of the calling thread with a procedure that lives for the whole process.
    unsafe { SetWindowSubclass(helper, Some(relay), SUBCLASS_ID, target.0 as usize) }.as_bool()
}

/// Installs the relay on every helper window of the calling thread (the UI thread, in `setup`), towards the app
/// window, and logs what it found.
pub fn install(target: HWND, identifier: &str) {
    let (mut relayed, mut failed) = (Vec::new(), Vec::new());
    for handle in thread_windows() {
        let hwnd = HWND(handle as *mut _);
        if hwnd == target {
            continue;
        }
        let class = class_of(hwnd);
        if !relays_close(&class, identifier) {
            continue;
        }
        if install_on(hwnd, target) {
            relayed.push(class);
        } else {
            failed.push(class);
        }
    }
    crate::crash::log(
        "close_relay",
        json!({ "relayed": relayed, "failed": failed }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, HWND_MESSAGE, IsWindow, MSG, PM_REMOVE, PeekMessageW,
        SendMessageW, WINDOW_EX_STYLE, WINDOW_STYLE,
    };
    use windows::core::w;

    const ID: &str = "dev.nqlab.terminal";

    #[test]
    fn the_tao_target_and_the_single_instance_window_get_the_relay() {
        assert!(relays_close("Tao Thread Event Target", ID));
        assert!(relays_close("dev.nqlab.terminal-sic", ID));
        assert!(relays_close("dev.nqlab.terminal_0.3-sic", ID));
    }

    #[test]
    fn no_other_window_gets_the_relay() {
        for class in [
            "",
            "Tauri Window",
            "Chrome_WidgetWin_0",
            "dev.nqlab.terminal-siw",
            "dev.nqlab.terminal",
            "other.app-sic",
            "dev.nqlab.terminalx-sic",
            "-sic",
            "#32770",
        ] {
            assert!(!relays_close(class, ID), "{class}");
        }
        assert!(
            !relays_close("-sic", ""),
            "an empty identifier relays nothing"
        );
    }

    /// A never-shown top-level window of the built-in STATIC class, on this thread, or a message-only one.
    fn test_window(parent: Option<HWND>) -> HWND {
        // SAFETY: creates a window with no WS_VISIBLE style (never shown), destroyed by the test.
        unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                parent,
                None,
                None,
                None,
            )
        }
        .expect("a hidden test window")
    }

    /// Whether a WM_CLOSE posted to `target` is waiting in this thread's queue (it is taken off the queue).
    fn close_posted_to(target: HWND) -> bool {
        let mut msg = MSG::default();
        // SAFETY: reads this thread's own queue for the one window and message the test posted.
        unsafe { PeekMessageW(&mut msg, Some(target), WM_CLOSE, WM_CLOSE, PM_REMOVE) }.as_bool()
    }

    #[test]
    fn a_close_sent_to_a_relayed_helper_reaches_the_app_window_and_the_helper_stays() {
        let helper = test_window(None);
        let target = test_window(Some(HWND_MESSAGE));
        assert!(install_on(helper, target), "the subclass was not installed");
        // SAFETY: a synchronous message to a window of this thread.
        let answer = unsafe { SendMessageW(helper, WM_CLOSE, None, None) };
        assert_eq!(answer, LRESULT(0));
        // SAFETY: a plain query on a handle this test owns.
        let alive = unsafe { IsWindow(Some(helper)) }.as_bool();
        assert!(alive, "the helper destroyed itself");
        assert!(
            close_posted_to(target),
            "the close was not passed on to the app window"
        );
        // SAFETY: destroys the windows this test created, on their thread; the subclass leaves on WM_NCDESTROY.
        unsafe {
            let _ = DestroyWindow(helper);
            let _ = DestroyWindow(target);
        }
    }

    #[test]
    fn without_the_relay_a_close_destroys_the_helper() {
        // Born failing: this is what the helpers did before the relay.
        let helper = test_window(None);
        // SAFETY: a synchronous message to a window of this thread; DefWindowProc destroys it on WM_CLOSE.
        let _ = unsafe { SendMessageW(helper, WM_CLOSE, None, None) };
        // SAFETY: a plain query on a handle this test created.
        assert!(!unsafe { IsWindow(Some(helper)) }.as_bool());
    }
}
