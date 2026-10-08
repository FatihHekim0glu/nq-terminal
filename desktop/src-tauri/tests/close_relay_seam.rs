//! A close request sent the standard Windows way ends the app (the close investigation of 8 October 2026;
//! src/close_relay.rs).
//!
//! .NET's `Process.CloseMainWindow`, and closers that copy it, post one WM_CLOSE to the process's "main window": the
//! first window in z-order (EnumWindows order) of the process that has no owner and is visible. Under smoke and
//! measure the app window is never shown, so that window is one of the shell's helper windows (tao's event target),
//! exactly as it is for a hidden or minimised release window. Before the relay the helper destroyed itself and the
//! shell kept running; with it the close reaches the app window and the usual close runs: the flush, then the
//! backend's shutdown.
//!
//! The run is hidden like tests/hidden_window.rs (same labs, same launch prelude, same global watch); nothing is drawn.
#![cfg(any(feature = "smoke", feature = "measure"))]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "hidden_support/labs.rs"]
mod labs;
#[path = "hidden_support/launch.rs"]
mod launch_support;
#[path = "hidden_support/watch.rs"]
mod watch;

use launch_support::{Owned, launch_shell, run_dir, terminal_dir};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use watch::{TAO_CLASS, all_windows, describe, failures, start_watch};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GW_OWNER, GetWindow, IsWindowVisible, PostMessageW, WM_CLOSE,
};

const READY_TIMEOUT: Duration = Duration::from_secs(120);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(20);

fn make_lab(run: &Path) -> PathBuf {
    if cfg!(feature = "smoke") {
        return labs::derived_lab(run, &terminal_dir());
    }
    let lab = labs::stand_in_lab(run);
    let settings = serde_json::json!({ "lab": lab.display().to_string() });
    let file = run.join("config").join("settings.json");
    std::fs::create_dir_all(file.parent().expect("a parent folder")).expect("config folder");
    std::fs::write(&file, settings.to_string()).expect("the measure settings file");
    lab
}

fn shell_log(run: &Path) -> Vec<Value> {
    let path = run.join("config").join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn has(log: &[Value], event: &str) -> bool {
    log.iter().any(|e| e["event"] == event)
}

/// The window the shell has settled on: smoke once the backend is ready behind the window, measure once the splash
/// has loaded. The relay is installed in setup, before either.
fn wait_until_settled(run: &Path, shell: &mut Owned) {
    let ready_event = if cfg!(feature = "smoke") {
        "supervise_ready"
    } else {
        "controller_visible"
    };
    let started = Instant::now();
    while started.elapsed() < READY_TIMEOUT {
        let log = shell_log(run);
        if has(&log, "page_finished") && has(&log, ready_event) {
            std::thread::sleep(Duration::from_millis(1_000));
            return;
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            panic!("the shell exited ({status}) before it settled: {log:?}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("the shell never settled: {:?}", shell_log(run));
}

/// .NET's `Process.MainWindowHandle` rule: the first top-level window of the process, in EnumWindows order, that has
/// no owner and is visible.
fn dotnet_main_window(pid: u32) -> Option<isize> {
    all_windows().into_iter().find(|&h| {
        let hwnd = HWND(h as *mut _);
        // SAFETY: read-only queries on a window handle EnumWindows just listed.
        let unowned = unsafe { GetWindow(hwnd, GW_OWNER) }.map_or(true, |o| o.is_invalid());
        // SAFETY: as above.
        let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
        describe(h).pid == pid && unowned && visible
    })
}

fn wait_exit(shell: &mut Owned, wait: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < wait {
        if matches!(shell.0.try_wait(), Ok(Some(_))) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

#[test]
fn one_close_sent_the_dotnet_way_ends_the_app_through_its_own_close() {
    let run = run_dir("closerelay");
    let lab = make_lab(&run);
    let watch = start_watch();
    let mut shell = launch_shell(Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal")), &run, &lab);
    wait_until_settled(&run, &mut shell);
    let pid = shell.0.id();
    let target = dotnet_main_window(pid).expect("the process has no unowned visible window");
    let class = describe(target).class;
    // SAFETY: one message to a window of the process this test started, as CloseMainWindow sends it.
    let posted =
        unsafe { PostMessageW(Some(HWND(target as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    assert!(posted.is_ok(), "the close could not be posted");
    let exited = wait_exit(&mut shell, CLOSE_TIMEOUT);
    drop(shell);
    std::thread::sleep(Duration::from_millis(800));
    let report = watch.finish();
    let log = shell_log(&run);
    labs::drop_junctions(&lab);
    assert!(
        exited,
        "the shell kept running after one WM_CLOSE to its main window ({class}): {log:?}"
    );
    let relay = log.iter().find(|e| e["event"] == "close_relay");
    let relay = relay.unwrap_or_else(|| panic!("no close_relay record: {log:?}"));
    assert_eq!(relay["failed"], serde_json::json!([]), "{relay}");
    if class == TAO_CLASS {
        assert!(
            has(&log, "close_relayed"),
            "the relay did not pass the close on: {log:?}"
        );
    }
    assert!(
        has(&log, "store_flush"),
        "the close skipped the flush: {log:?}"
    );
    if cfg!(feature = "smoke") {
        assert!(
            has(&log, "supervise_shutdown"),
            "the backend was not shut down: {log:?}"
        );
    } else {
        let ended = launch_support::stand_in_ended(&lab, Duration::from_secs(10));
        assert!(ended, "the stand-in backend outlived the shell's close");
    }
    let verdict = failures(&report);
    assert!(verdict.is_empty(), "the watch saw: {verdict:#?}");
}
