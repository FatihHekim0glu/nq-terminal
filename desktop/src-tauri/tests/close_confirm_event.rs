//! A close with a backtest running asks first, and the shell says so in its log (V033B review, finding 8; 03 section
//! 2.3; O11). desktop/scripts/close-app.ps1 reads that line: `close_confirm_asked` after its request means an
//! unanswered question and a running backtest, and `-Force` must then never stop the shell (exit 6). Both halves were
//! tested alone (the script on a hand-built log, the dialog by its own unit test), so a rename, a moved call or a
//! changed gate in `may_close` kept everything green. This test closes a real shell, hidden, over a fake backend that
//! reports one running job, and reads the log the script reads. tests/close_events_pinned.rs pins the event names.
//!
//! Born failing: with the log call removed (or renamed) from `may_close`, no `close_confirm_asked` is ever written and
//! the close wait below times out. A test build answers the question Cancel, so the shell must stay up with its
//! backend, write no `supervise_shutdown`, and ask again on the next close.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[allow(
    dead_code,
    reason = "each test binary that includes the support files uses a part of them"
)]
#[path = "hidden_support/labs.rs"]
mod labs;
#[path = "hidden_support/launch.rs"]
mod launch_support;
#[path = "hidden_support/watch.rs"]
mod watch;

use launch_support::{Owned, launch_shell, run_dir};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use watch::{TAO_CLASS, all_windows, describe, failures, start_watch};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

const READY_TIMEOUT: Duration = Duration::from_secs(120);
const ASK_TIMEOUT: Duration = Duration::from_secs(20);
const QUIET: Duration = Duration::from_secs(3);
const ASKED: &str = "close_confirm_asked";

/// The smoke lab of tests/hidden_support/labs.rs with the fake backend of the supervision tests in place of the real
/// one: it takes the handshake, the proof and the session, and `running_jobs: 1` makes its job list report one run.
fn fake_backend_lab(run: &Path) -> PathBuf {
    let lab = labs::stand_in_lab(run);
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let source = std::fs::read(fixtures.join("fake_backend.py")).expect("the fake backend source");
    let package = lab.join(r"terminal\backend\nq_terminal");
    let files: [(PathBuf, &[u8]); 4] = [
        (package.join("__init__.py"), b""),
        (package.join("__main__.py"), &source),
        (package.join("fake_backend.py"), &source),
        (package.join(r"desktop\__init__.py"), b""),
    ];
    std::fs::create_dir_all(package.join("desktop")).expect("package folders");
    for (file, bytes) in files {
        std::fs::write(&file, bytes).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
    }
    std::fs::write(package.join(r"desktop\fixture_main.py"), &source).expect("fixture entry");
    std::fs::write(
        lab.join(r"terminal\backend\fake_mode.json"),
        json!({ "running_jobs": 1 }).to_string(),
    )
    .expect("the mode file");
    std::fs::create_dir_all(lab.join(r"terminal\state")).expect("state folder");
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

fn events<'a>(log: &'a [Value], name: &str) -> Vec<&'a Value> {
    log.iter().filter(|e| e["event"] == name).collect()
}

fn wait_for(
    run: &Path,
    shell: &mut Owned,
    what: &str,
    limit: Duration,
    done: impl Fn(&[Value]) -> bool,
) {
    let started = Instant::now();
    while started.elapsed() < limit {
        let log = shell_log(run);
        if done(&log) {
            return;
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            panic!("the shell exited ({status}) before {what}: {log:?}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("the shell never reached {what}: {:?}", shell_log(run));
}

/// One WM_CLOSE to the app's own windows (the helper windows are left to the relay), as launch_support::close_shell
/// sends it, without its 20 s wait for an exit that this test expects not to come.
fn post_close(pid: u32) {
    for h in all_windows() {
        let w = describe(h);
        if w.pid == pid && w.class != TAO_CLASS {
            // SAFETY: one message to a window of the process this test started.
            let _ =
                unsafe { PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
    }
}

#[test]
fn a_close_with_a_running_backtest_logs_the_question_before_any_shutdown() {
    let run = run_dir("closeask");
    let lab = fake_backend_lab(&run);
    let watch = start_watch();
    let mut shell = launch_shell(Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal")), &run, &lab);
    wait_for(
        &run,
        &mut shell,
        "a backend it could ask about",
        READY_TIMEOUT,
        |log| !events(log, "supervise_ready").is_empty(),
    );
    let pid = shell.0.id();

    post_close(pid);
    wait_for(&run, &mut shell, "the close question", ASK_TIMEOUT, |log| {
        !events(log, ASKED).is_empty()
    });
    std::thread::sleep(QUIET);
    let first = shell_log(&run);

    // The next close asks again: a kept window keeps its question.
    post_close(pid);
    let started = Instant::now();
    while started.elapsed() < ASK_TIMEOUT && events(&shell_log(&run), ASKED).len() < 2 {
        std::thread::sleep(Duration::from_millis(100));
    }
    let second = shell_log(&run);
    let still_running = matches!(shell.0.try_wait(), Ok(None));
    drop(shell);
    std::thread::sleep(Duration::from_millis(800));
    let report = watch.finish();
    labs::drop_junctions(&lab);

    let asked = events(&first, ASKED);
    assert_eq!(asked.len(), 1, "one close, one question: {first:?}");
    assert_eq!(
        asked[0]["count_read"], true,
        "the count was read, so the log must say so: {}",
        asked[0]
    );
    assert!(
        events(&first, "supervise_shutdown").is_empty(),
        "the shell shut down with the question unanswered: {first:?}"
    );
    assert!(
        events(&first, "dialog_refused")
            .iter()
            .any(|e| e["dialog"] == "confirm_close_running_job"),
        "the question is the close confirmation: {first:?}"
    );
    assert!(
        still_running,
        "a cancelled close ended the shell: {second:?}"
    );
    assert_eq!(
        events(&second, ASKED).len(),
        2,
        "the second close did not ask: {second:?}"
    );
    assert!(
        events(&second, "supervise_shutdown").is_empty(),
        "{second:?}"
    );
    let verdict = failures(&report);
    assert!(verdict.is_empty(), "the watch saw: {verdict:#?}");
}
