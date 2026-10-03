//! A refused setup ends the start with a log line, a fail-closed dialog and exit code 1 (03 section 17; 04 D4.1).
//!
//! Tauri 2.12 answers an error returned from the setup hook with `panic!("Failed to setup app")`, not with an error
//! from `run()`. Under the release's `panic = "abort"` and the windows subsystem that would end the process with no
//! dialog and no shell log line, so main.rs must handle the refusal inside the hook. This test plants a refusal the
//! smoke build cannot get past (`--fixture` over an empty lab folder: window::setup's lab check refuses a folder
//! with no venv interpreter, research config or backend entry before the supervisor is reached), starts the hidden smoke exe under D:\dev\d4\sr\<run> with no
//! build tools on PATH, watches for any window or foreground change of the shell, and asserts exit code 1, a
//! `setup_failed` line in `<config>/logs/shell.log`, the fail-closed fatal dialog and no panic text.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it plants and reads its own run files and starts the process it owns"
)]

use serde_json::Value;
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsWindowVisible,
};
use windows::core::BOOL;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const RUN_ROOT: &str = r"D:\dev\d4\sr";
const SAMPLE: Duration = Duration::from_millis(100);
const EXIT_TIMEOUT: Duration = Duration::from_secs(60);
const TAO_CLASS: &str = "Tao Thread Event Target";
/// main.rs EXIT_RUN.
const EXIT_RUN: i32 = 1;

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that visible_of keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

fn owner_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: a read-only query on a window handle; a dead handle yields 0.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

fn class_of(hwnd: HWND) -> String {
    let mut class = [0u16; 256];
    // SAFETY: a read-only query into a buffer that outlives the call.
    let n = unsafe { GetClassNameW(hwnd, &mut class) } as usize;
    String::from_utf16_lossy(&class[..n])
}

/// The visible top-level windows of one process, other than tao's never-drawn event target (W0A).
fn visible_of(pid: u32) -> HashSet<String> {
    let mut list: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `list`, which outlives the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
    list.into_iter()
        .map(|h| HWND(h as *mut _))
        // SAFETY: a plain query on a handle EnumWindows just listed.
        .filter(|h| owner_pid(*h) == pid && unsafe { IsWindowVisible(*h) }.as_bool())
        .map(class_of)
        .filter(|class| class != TAO_CLASS)
        .collect()
}

fn run_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let dir = PathBuf::from(RUN_ROOT).join(format!("refused-{stamp}"));
    std::fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    dir
}

/// The launch prelude's PATH: no build tools.
fn clean_path() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    path.split(';')
        .filter(|p| {
            let lower = p.to_ascii_lowercase();
            !lower.starts_with(r"d:\dev\mingw") && !lower.starts_with(r"d:\dev\cargo")
        })
        .collect::<Vec<_>>()
        .join(";")
}

struct Outcome {
    code: Option<i32>,
    seen: HashSet<String>,
    foreground_taken: bool,
}

/// Starts the smoke exe with `--fixture` over an empty lab folder, and samples its windows until it exits.
fn launch_refused(run: &Path) -> Outcome {
    let lab = run.join("empty-lab");
    std::fs::create_dir_all(&lab).expect("plant the empty lab");
    let err = std::fs::File::create(run.join("shell.err.log")).expect("stderr log");
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    cmd.arg("--fixture")
        .arg("--lab")
        .arg(&lab)
        .arg("--state-dir")
        .arg(run.join("state"))
        .arg("--webview-data-dir")
        .arg(run.join("wv"))
        .arg("--config-dir")
        .arg(run.join("config"))
        .env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(err))
        .creation_flags(CREATE_NO_WINDOW);
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
        {
            cmd.env_remove(name);
        }
    }
    let mut child = cmd.spawn().expect("start the smoke exe");
    let (pid, started) = (child.id(), Instant::now());
    let mut outcome = Outcome {
        code: None,
        seen: HashSet::new(),
        foreground_taken: false,
    };
    while started.elapsed() < EXIT_TIMEOUT {
        outcome.seen.extend(visible_of(pid));
        // SAFETY: a plain query.
        outcome.foreground_taken |= owner_pid(unsafe { GetForegroundWindow() }) == pid;
        if let Ok(Some(status)) = child.try_wait() {
            outcome.code = status.code();
            return outcome;
        }
        std::thread::sleep(SAMPLE);
    }
    let _ = child.kill();
    let _ = child.wait();
    outcome
}

fn shell_log_events(run: &Path) -> Vec<Value> {
    let path = run.join("config").join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[test]
fn a_refused_setup_logs_and_exits_with_the_run_code() {
    let run = run_dir();
    let outcome = launch_refused(&run);
    let events = shell_log_events(&run);
    let stderr = std::fs::read_to_string(run.join("shell.err.log")).unwrap_or_default();
    assert!(
        outcome.seen.is_empty(),
        "the refused start showed windows: {:?}",
        outcome.seen
    );
    assert!(
        !outcome.foreground_taken,
        "the refused start took the foreground"
    );
    assert_eq!(
        outcome.code,
        Some(EXIT_RUN),
        "exit code (None: still running after {EXIT_TIMEOUT:?}); stderr: {stderr}"
    );
    let failed = events
        .iter()
        .find(|e| e["event"] == "setup_failed")
        .unwrap_or_else(|| {
            panic!("no setup_failed line in shell.log: {events:?}; stderr: {stderr}")
        });
    assert!(
        failed["error"].as_str().is_some_and(|e| !e.is_empty()),
        "setup_failed carries no error: {failed}"
    );
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "dialog_refused" && e["dialog"] == "fatal"),
        "the fatal dialog was not reached (it fails closed in a test build): {events:?}"
    );
    assert!(
        !stderr.contains("Failed to setup app"),
        "setup still panics inside Tauri: {stderr}"
    );
}
