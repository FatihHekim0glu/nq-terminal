//! Under smoke and measure the window's `show()` is never called (04 standing rule 4; 04 D4.1), and the shell
//! starts, checks and ends the real backend (04 D4.3 and D4.6).
//!
//! The same file runs for both test builds, with the same global watch (EnumWindows over every process every 100 ms,
//! plus GetForegroundWindow), the same checks for new windows, foreground changes and folders on C:, and the same
//! born-failing show() copy. Windows are created hidden and the run closes them at once.
//!
//! - Smoke (`cargo test --no-default-features --features smoke --test hidden_window`): the smoke exe is started with
//!   `--lab`, `--fixture`, `--webview-data-dir` and `--config-dir` under D:\dev\d4\hw\<run>. The lab is a derived lab
//!   (hidden_support/labs.rs) whose `terminal` is this worktree, so the supervisor spawns the worktree's real
//!   `nq_terminal.desktop.fixture_main` on port 0 in its Job Object, takes the handshake (the MACs, ROOT, prefix,
//!   contract and page build) and the session cookie, and navigates to HOME, which a Node script reads over the
//!   debugging protocol. The run asserts: HOME ready in a hidden but visible page, no new drawn window anywhere, no
//!   foreground change, the smoke identity and no release plugin in the start record, the WEBVIEW2_* canaries
//!   scrubbed, the backend spawned, checked and stopped within its grace on close, and no new EBWebView or
//!   dev.nqlab.* folder in the local or roaming app-data folders on C:.
//! - Measure (`--features measure`): the exe takes no switch, so the run folder reaches it as `NQT_MEASURE_DIR` and
//!   its settings file in `<run>\config` names a stand-in lab whose backend only waits for its stdin to close. The run
//!   is ready when the shell log holds `page_finished` and `controller_visible`; the close path then ends the
//!   stand-in through the shell's shutdown. HOME of a real backend is the measurement run's business (W5B).
//!
//! Born failing (`--ignored`): a temporary copy of the crate whose main.rs calls `show()` (sized and placed inside
//! the work area of the second monitor first, shown without activation, closed at once) must be caught by the same
//! watch. It refuses to run unless that monitor exists and is not the primary one.
#![cfg(any(feature = "smoke", feature = "measure"))]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files, copies the crate and starts processes it owns"
)]

#[path = "hidden_support/labs.rs"]
mod labs;
#[path = "hidden_support/launch.rs"]
mod launch_support;
#[path = "hidden_support/show_copy.rs"]
mod show_copy;
#[path = "hidden_support/watch.rs"]
mod watch;

use launch_support::{Owned, c_drive_folders, close_shell, launch_shell, run_dir, terminal_dir};
use serde_json::Value;
use show_copy::{build_show_copy, screen2_work_area};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use watch::{Seen, Watch, WatchReport, failures, start_watch};

/// The feature this run of the file was built with, and the identity that build must carry.
const BUILD: &str = if cfg!(feature = "measure") {
    "measure"
} else {
    "smoke"
};
const BUILD_ID: &str = if cfg!(feature = "measure") {
    "dev.nqlab.terminal.measure"
} else {
    "dev.nqlab.terminal.smoke"
};
/// How long a measure run keeps watching after the splash has loaded, so a reveal that follows it is caught.
#[cfg(feature = "measure")]
const SETTLE: Duration = Duration::from_millis(2_000);
#[cfg(feature = "measure")]
const READY_TIMEOUT_MEASURE: Duration = Duration::from_secs(60);

/// One launch at a time: the watch and the debugging profile are shared by the tests of this file.
static ONE_RUN: Mutex<()> = Mutex::new(());

struct RunResult {
    run: PathBuf,
    shell_pid: u32,
    /// When the shell process started (ms since the Unix epoch), as read right after the launch.
    #[cfg_attr(
        feature = "smoke",
        allow(dead_code, reason = "only the measure reading uses it")
    )]
    started_ms: Option<u128>,
    home: Value,
    closed: bool,
    report: WatchReport,
    new_c_folders: Vec<PathBuf>,
}

/// The lab this build starts on: smoke the derived lab with the real backend, measure the stand-in lab (whose
/// settings file the run plants, as the measure exe takes no switch). The show() copy is a smoke or measure build
/// like the others and gets the same lab.
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

fn run_once(exe: &Path, tag: &str, stop_on_drawn: bool) -> RunResult {
    let run = run_dir(tag);
    let before = c_drive_folders();
    let lab = make_lab(&run);
    let watch = start_watch();
    let mut shell = launch_shell(exe, &run, &lab);
    let shell_pid = shell.0.id();
    let started_ms = launch_support::process_started_ms(shell_pid);
    let home = if stop_on_drawn {
        wait_for_drawn(&watch, &mut shell)
    } else {
        wait_until_ready(&run, &mut shell)
    };
    let closed = close_shell(&mut shell);
    drop(shell);
    std::thread::sleep(Duration::from_millis(800));
    let report = watch.finish();
    let new_c_folders = c_drive_folders().difference(&before).cloned().collect();
    labs::drop_junctions(&lab);
    RunResult {
        run,
        shell_pid,
        started_ms,
        home,
        closed,
        report,
        new_c_folders,
    }
}

/// Smoke: HOME of the real backend's page loaded over the debugging protocol.
#[cfg(feature = "smoke")]
fn wait_until_ready(run: &Path, shell: &mut Owned) -> Value {
    let port = launch_support::devtools_port(run, shell);
    launch_support::wait_for_home(port, "http://127.0.0.1:")
}

/// Measure: the splash has loaded and the controller is visible, then a settle time with the watch still running.
#[cfg(feature = "measure")]
fn wait_until_ready(run: &Path, shell: &mut Owned) -> Value {
    let started = Instant::now();
    while started.elapsed() < READY_TIMEOUT_MEASURE {
        let log = shell_log_if_any(run);
        let has = |event: &str| log.iter().any(|e| e["event"] == event);
        if has("page_finished") && has("controller_visible") {
            std::thread::sleep(SETTLE);
            return serde_json::json!({ "ready": true });
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            return serde_json::json!({ "ready": false, "exited": status.to_string(), "log": log });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    serde_json::json!({ "ready": false, "reason": "timeout" })
}

/// Born-failing runs: stop as soon as a drawn window appears (or after 60 s), so it is closed at once.
fn wait_for_drawn(watch: &Watch, shell: &mut Owned) -> Value {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if watch.drawn_seen.load(Ordering::SeqCst) {
            return serde_json::json!({ "drawn_after_ms": started.elapsed().as_millis() });
        }
        if matches!(shell.0.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    serde_json::json!({ "drawn_after_ms": null })
}

fn shell_log_if_any(run: &Path) -> Vec<Value> {
    let path = run.join("config").join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn shell_log(run: &Path) -> Vec<Value> {
    let log = shell_log_if_any(run);
    assert!(
        !log.is_empty(),
        "no shell log under {}",
        run.join("config").display()
    );
    log
}

fn write_record(result: &RunResult, verdict: &[String]) {
    let record = serde_json::json!({
        "run": result.run.display().to_string(), "shell_pid": result.shell_pid, "home": result.home,
        "closed": result.closed, "samples": result.report.samples, "max_gap_ms": result.report.max_gap_ms as u64,
        "new_visible": result.report.new_visible.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>(),
        "foreground_changes": result.report.foreground_changes.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>(),
        "new_c_folders": result.new_c_folders, "failures": verdict,
    });
    let path = result.run.join("record.json");
    let text = serde_json::to_string_pretty(&record).unwrap_or_default();
    std::fs::write(&path, text).unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    println!("record: {}", path.display());
}

#[cfg(feature = "smoke")]
#[test]
fn smoke_build_stays_hidden_through_home_and_close() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let result = run_once(exe, "smoke", false);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let (r, home) = (&result.report, &result.home);
    let checks = [
        (
            home["ready"] == true,
            format!("HOME never became ready: {home}"),
        ),
        (
            home["visibility"] == "visible",
            "the page must run behind the hidden window".into(),
        ),
        (
            result.closed,
            "the shell did not close on WM_CLOSE within 20 s".into(),
        ),
        (verdict.is_empty(), format!("the watch saw: {verdict:#?}")),
        (
            r.samples >= 20 && r.max_gap_ms < 1_000,
            format!("watch gaps: {} samples, {} ms", r.samples, r.max_gap_ms),
        ),
        (
            result.new_c_folders.is_empty(),
            format!("new folders on C: {:?}", result.new_c_folders),
        ),
        (
            !result.run.join("canary-udf").exists(),
            "WEBVIEW2_USER_DATA_FOLDER reached the engine".into(),
        ),
    ];
    for (ok, why) in checks {
        assert!(ok, "{why}");
    }
    let log = shell_log(&result.run);
    check_start_record(&log);
    check_backend_lifecycle(&log);
}

/// The backend this run started: spawned in its job, checked through the handshake and the proof, served to the
/// window, and stopped within its grace when the window closed.
#[cfg(feature = "smoke")]
fn check_backend_lifecycle(log: &[Value]) {
    let first = |event: &str| log.iter().find(|e| e["event"] == event);
    for event in ["supervise_spawned", "supervise_checked", "supervise_ready"] {
        assert!(
            first(event).is_some(),
            "the shell log has no {event}: {log:?}"
        );
    }
    let spawned = first("supervise_spawned").expect("spawned");
    assert_eq!(
        spawned["route"], "job_list",
        "the job-list route was not used"
    );
    let ready = first("supervise_ready").expect("ready");
    assert_eq!(ready["attached"], false, "the run attached to a backend");
    let port = ready["port"].as_u64().unwrap_or(0);
    assert!(port > 1023 && port != 8765, "the backend's port: {port}");
    let shutdown =
        first("supervise_shutdown").expect("the close did not run the supervisor's shutdown");
    assert_eq!(
        shutdown["stopped_in_grace"], true,
        "the backend needed the job to end it: {shutdown}"
    );
    for refused in [
        "supervise_refused",
        "supervise_failed",
        "navigation_refused",
    ] {
        assert!(
            first(refused).is_none(),
            "the shell log has {refused}: {log:?}"
        );
    }
}

/// Measure: the build reaches its window (identity, controller visible, splash loaded) and stays hidden.
#[cfg(feature = "measure")]
#[test]
fn measure_build_stays_hidden_through_splash_and_close() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let result = run_once(exe, "measure", false);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let (r, home) = (&result.report, &result.home);
    let checks = [
        (
            home["ready"] == true,
            format!("the measure build never reached its window: {home}"),
        ),
        (
            result.closed,
            "the shell did not close on WM_CLOSE within 20 s".into(),
        ),
        (verdict.is_empty(), format!("the watch saw: {verdict:#?}")),
        (
            r.samples >= 20 && r.max_gap_ms < 1_000,
            format!("watch gaps: {} samples, {} ms", r.samples, r.max_gap_ms),
        ),
        (
            result.new_c_folders.is_empty(),
            format!("new folders on C: {:?}", result.new_c_folders),
        ),
        (
            !result.run.join("canary-udf").exists(),
            "WEBVIEW2_USER_DATA_FOLDER reached the engine".into(),
        ),
    ];
    for (ok, why) in checks {
        assert!(ok, "{why}");
    }
    let log = shell_log(&result.run);
    check_start_record(&log);
    let ended = launch_support::stand_in_ended(&result.run.join("lab"), Duration::from_secs(10));
    assert!(ended, "the stand-in backend outlived the shell's close");
}

fn check_start_record(log: &[Value]) {
    let start = log
        .iter()
        .find(|e| e["event"] == "start")
        .unwrap_or_else(|| panic!("no start record: {log:?}"));
    assert_eq!(start["identifier"], BUILD_ID);
    assert_eq!(
        start["release_plugins"], false,
        "a test build registered the release plugins"
    );
    assert_eq!(start[BUILD], true);
    assert_eq!(start["test_build"], true);
    let scrubbed: Vec<&str> = start["scrubbed"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    for canary in [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_USER_DATA_FOLDER",
    ] {
        assert!(
            scrubbed.contains(&canary),
            "{canary} was not scrubbed: {scrubbed:?}"
        );
    }
    assert!(
        log.iter().any(|e| e["event"] == "controller_visible"),
        "after_build never made the controller visible"
    );
    assert!(
        !log.iter().any(|e| e["event"] == "show_failed"),
        "show() was reached in a test build"
    );
}

#[test]
#[ignore = "born-failing proof: builds a crate copy that calls show() and shows it on screen 2 for a moment"]
fn a_build_that_calls_show_is_caught() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let area = match screen2_work_area() {
        Ok(area) => area,
        Err(why) => {
            println!("SKIPPED: {why}; the born-failing window may only appear on screen 2");
            return;
        }
    };
    println!("screen 2 work area: {area:?}");
    let exe = build_show_copy(&run_dir("showcopy-build"));
    let result = run_once(&exe, "showcopy", true);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let ours: Vec<&Seen> = result
        .report
        .new_visible
        .iter()
        .filter(|w| w.drawn && w.pid == result.shell_pid)
        .collect();
    assert!(
        !ours.is_empty(),
        "the watch missed the shown window: {:?}",
        result.report
    );
    assert!(
        !verdict.is_empty(),
        "the judge passed a run that showed a window"
    );
    for w in &ours {
        let (l, t, r, b) = w.rect;
        let inside = l >= area.left && t >= area.top && r <= area.right && b <= area.bottom;
        assert!(inside, "window left screen 2: {w:?}");
    }
    assert!(
        result.report.foreground_changes.is_empty(),
        "the shown copy took the foreground"
    );
}

/// The splash's load event, in milliseconds after the shell process started, from the shell log.
#[cfg(feature = "measure")]
fn splash_load_ms(result: &RunResult) -> Option<u128> {
    let log = shell_log(&result.run);
    let done = log.iter().find(|e| {
        e["event"] == "page_finished"
            && e["url"]
                .as_str()
                .is_some_and(|u| u.ends_with("splash.html"))
    })?;
    let finished = u128::from(done["t"].as_u64()?);
    finished.checked_sub(result.started_ms?)
}

/// First readings (04 D4.6): the splash within 1,000 ms (target 500 ms), median of five hidden runs of the RELEASE
/// measure exe (`NQT_MEASURE_EXE`, built with `cargo tauri build --no-bundle --features measure`), and its size.
/// Each run goes through the same watch and checks as the hidden-window test. Run it alone, in a quiet window; the
/// figure is the splash page's load event after process start, which is what the shell log can say (the harness of
/// W5B measures the first painted frame on screen 2 and keeps this load-event figure as a separate row: painted
/// deferred to W5B, and no record may call this figure "painted").
#[cfg(feature = "measure")]
#[test]
#[ignore = "a reading, not a check: needs NQT_MEASURE_EXE and a quiet machine"]
fn first_readings_of_the_splash_and_the_exe_size() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let exe = PathBuf::from(std::env::var_os("NQT_MEASURE_EXE").expect("NQT_MEASURE_EXE"));
    let mut readings: Vec<u128> = Vec::new();
    for _ in 0..5 {
        let result = run_once(&exe, "reading", false);
        let verdict = failures(&result.report);
        assert!(verdict.is_empty(), "the watch saw: {verdict:#?}");
        assert!(result.closed && result.new_c_folders.is_empty());
        readings.push(splash_load_ms(&result).expect("a splash load time in the shell log"));
    }
    let mut sorted = readings.clone();
    sorted.sort_unstable();
    let size = std::fs::metadata(&exe).map_or(0, |m| m.len());
    println!(
        "READING splash_load_ms {readings:?} median {} exe_bytes {size} (load event; painted deferred to W5B)",
        sorted[sorted.len() / 2]
    );
}
