//! The WebView2 guards fail closed (03 sections 4.4, 6 and 8; 05 G08): when a guard cannot be installed (the
//! navigation check, the new-window and bridge hooks, the download handler, the keys), the shell refuses the setup
//! and exits with the run code, so the window never loads the backend's page without it.
//!
//! The smoke exe takes `NQT_SMOKE_FAIL_HOOK=<navigation|new_window|download|keys>`, which makes that one install
//! report a failure. Each case starts `--fixture` over a fake lab (hidden, no build tools on PATH, the global window
//! watch running) and checks that the shell ended with code 1, that its log holds `setup_failed` naming the hook,
//! and that the webview never sent the session cookie to the backend.
//!
//! Born failing: before the fix an install error was only logged, setup returned Ok, the page loaded and the cookie
//! reached /api/health.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it starts the smoke exe it owns over a fake lab, and ends it"
)]

#[path = "supervise_support.rs"]
mod support;

use serde_json::{Value, json};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use support::{CREATE_NO_WINDOW, FakeLab, backend_log_lines, fake_lab, requests_in, watch};

/// main.rs EXIT_RUN: the code of a refused setup.
const EXIT_RUN: i32 = 1;
const EXIT_LIMIT: Duration = Duration::from_secs(60);
/// How long a refused start keeps watching for a late request to the backend after the shell is gone.
const SETTLE: Duration = Duration::from_secs(4);
/// The fault switch (smoke builds only): the name of the one hook whose install is made to fail.
const FAULT_ENV: &str = "NQT_SMOKE_FAIL_HOOK";

/// One launch at a time: the shell and its window watch are shared by the cases of this file.
static ONE_RUN: Mutex<()> = Mutex::new(());

fn clean_path() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    let keep = |p: &&str| {
        let lower = p.to_ascii_lowercase();
        !lower.starts_with(r"d:\dev\mingw") && !lower.starts_with(r"d:\dev\cargo")
    };
    path.split(';').filter(keep).collect::<Vec<_>>().join(";")
}

fn launch(lab: &FakeLab, fault: &str) -> Child {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    cmd.arg("--fixture")
        .arg("--lab")
        .arg(&lab.lab)
        .arg("--webview-data-dir")
        .arg(lab.run.join("wv"))
        .arg("--config-dir")
        .arg(lab.run.join("config"))
        .env("PATH", clean_path())
        .env(FAULT_ENV, fault)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
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
    cmd.spawn().expect("start the smoke exe")
}

fn fixture_state(lab: &FakeLab, shell_pid: u32) -> PathBuf {
    lab.run
        .join("config")
        .join(format!("fixture-state-{shell_pid}"))
}

fn shell_log(lab: &FakeLab) -> Vec<Value> {
    let path = lab.run.join("config").join("logs").join("shell.log");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    text.lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// Every request the fixture backend saw that carried the session cookie.
fn cookie_requests(state: &Path) -> usize {
    let lines = backend_log_lines(state);
    let pids: Vec<u32> = support::records_in(&lines)
        .iter()
        .filter_map(|r| r["pid"].as_u64().map(|p| p as u32))
        .collect();
    let carries = |r: &Value| {
        let headers = r["headers"].as_object();
        let cookie = headers.and_then(|h| h.iter().find(|(k, _)| k.eq_ignore_ascii_case("cookie")));
        cookie
            .and_then(|(_, v)| v.as_str())
            .is_some_and(|c| c.contains("nqt_s_"))
    };
    pids.iter()
        .flat_map(|pid| requests_in(&lines, *pid))
        .filter(carries)
        .count()
}

fn wait_for_exit(shell: &mut Child) -> Option<i32> {
    let started = Instant::now();
    while started.elapsed() < EXIT_LIMIT {
        if let Ok(Some(status)) = shell.try_wait() {
            return status.code();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// Runs one faulted start and checks what a refused setup leaves behind.
fn refused_with(hook: &str) {
    let _one = ONE_RUN.lock().unwrap_or_else(|e| e.into_inner());
    let watch = watch();
    let lab = fake_lab(&format!("hooks-{hook}"), &json!({}));
    let mut shell = launch(&lab, hook);
    let pid = shell.id();
    let code = wait_for_exit(&mut shell);
    if code.is_none() {
        let _ = shell.kill();
        let _ = shell.wait();
    }
    std::thread::sleep(SETTLE);
    let log = shell_log(&lab);
    let refusal = log.iter().find(|e| e["event"] == "setup_failed");
    let cookies = cookie_requests(&fixture_state(&lab, pid));
    assert_eq!(
        code,
        Some(EXIT_RUN),
        "{hook}: the shell kept running with a failed guard; log: {log:#?}"
    );
    let text = refusal.map(|e| e["error"].to_string()).unwrap_or_default();
    assert!(
        text.contains(hook),
        "{hook}: setup_failed does not name the hook: {refusal:?}"
    );
    assert_eq!(cookies, 0, "{hook}: the backend's page was reached");
    watch.assert_clean();
}

#[test]
fn a_failed_navigation_check_refuses_the_setup() {
    refused_with("navigation");
}

#[test]
fn a_failed_new_window_hook_refuses_the_setup() {
    refused_with("new_window");
}

#[test]
fn a_failed_download_hook_refuses_the_setup() {
    refused_with("download");
}

#[test]
fn a_failed_keys_install_refuses_the_setup() {
    refused_with("keys");
}
