//! `--screen2` (owner decision 10; plan W4B): the smoke build shows its window ONLY on the non-primary monitor,
//! inside its work area, without activation, after the guard. This is the one test that puts a window on a screen,
//! so it is `#[ignore]`d: run it on purpose with `cargo test --features smoke --test crash_screen2 -- --ignored`.
//! It refuses to run when no non-primary monitor holds the screen 2 anchor. The window is 1024 by 640 (the
//! minimum), because screen 2 is 1080 pixels wide: a larger window is refused by the guard, which is also correct.
//!
//! The global window and foreground watch runs for the whole launch. The only drawn window it tolerates is the
//! shell's own, and only while its rectangle lies inside screen 2's work area (plus the invisible resize border);
//! any other window, any drawn window elsewhere, and any foreground change fail the run. The window is closed
//! (WM_CLOSE) at the end of the test, a couple of seconds after it appeared.
#![cfg(feature = "smoke")]
#![allow(
    dead_code,
    clippy::disallowed_methods,
    reason = "test: it reads the run folder of the shell it started and includes the guard module whole"
)]

mod crash_support;
#[path = "../src/smoke_screen2.rs"]
mod screen2;

use crash_support::{Page, Spec, failures_allowing, launch, one_run};
use std::path::Path;
use std::time::Duration;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GWL_EXSTYLE, GetWindowLongW, WS_EX_NOACTIVATE};

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"))
}

/// The invisible resize border Windows adds around a frame.
const BORDER: i32 = 16;

#[test]
#[ignore = "shows a window on screen 2 (decision 10); run on purpose with --ignored"]
fn the_window_is_shown_on_screen_2_only_inside_its_work_area_and_without_activation() {
    let _one = one_run();
    let all = screen2::monitors().expect("GetMonitorInfo");
    let Ok(screen_2) = screen2::target(&all, screen2::ANCHOR) else {
        println!("SKIPPED: no non-primary monitor holds the screen 2 anchor");
        return;
    };
    let mut run = launch(
        exe(),
        &Spec {
            tag: "screen2",
            page: Page::Painted,
            args: &["--screen2", "--size", "1024x640"],
            envs: &[],
        },
    );
    let record = run.wait_event("smoke_screen2", 1, Duration::from_secs(90));
    println!("smoke_screen2: {record}");
    assert_eq!(
        record["shown"], true,
        "the guarded show was refused: {record}"
    );
    let frame = record["frame"].as_array().expect("frame");
    let bounds = screen2::Rect {
        left: frame[0].as_i64().expect("l") as i32,
        top: frame[1].as_i64().expect("t") as i32,
        right: frame[2].as_i64().expect("r") as i32,
        bottom: frame[3].as_i64().expect("b") as i32,
    };
    assert_eq!(
        screen2::judge(bounds, &screen_2, &all),
        Ok(()),
        "{bounds:?}"
    );
    run.wait_page_finished();
    std::thread::sleep(Duration::from_secs(2));
    // The shell's own windows: the style must carry WS_EX_NOACTIVATE.
    let pid = run.shell.0.id();
    let mut no_activate = false;
    for handle in crash_support::all_windows() {
        let seen = crash_support::describe(handle);
        if seen.pid == pid && seen.drawn {
            // SAFETY: a read-only style query on a window of the process this test started.
            let ex = unsafe { GetWindowLongW(HWND(handle as *mut _), GWL_EXSTYLE) } as u32;
            no_activate |= ex & WS_EX_NOACTIVATE.0 != 0;
        }
    }
    assert!(no_activate, "the shown window lacks WS_EX_NOACTIVATE");
    let outcome = run.finish();
    let work = screen_2.work;
    let verdict = failures_allowing(&outcome.report, |seen| {
        let (l, t, r, b) = seen.rect;
        seen.pid == pid
            && l >= work.left - BORDER
            && t >= work.top - BORDER
            && r <= work.right + BORDER
            && b <= work.bottom + BORDER
    });
    assert!(verdict.is_empty(), "the watch saw: {verdict:#?}");
    assert!(
        outcome
            .report
            .new_visible
            .iter()
            .any(|w| w.drawn && w.pid == pid),
        "the window was never drawn, so the run proved nothing"
    );
    assert!(outcome.closed && outcome.new_c_folders.is_empty());
}
