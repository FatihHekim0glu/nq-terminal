//! The lab check without a picker (04 D4.2 item 1; 03 section 7.1).
//!
//! A smoke build never gets a picker: `--lab` supplies the lab and the shell checks it as the release picker does.
//! Each fake lab here (under the run folder, never the real lab) misses one required file, or has no page build with
//! no node or pnpm on PATH; each start must stop with exit code 1, a `lab_refused` line naming exactly what is
//! missing, the fatal dialog failing closed, and no window. A start with neither `--lab` nor `--attach-url` is the
//! hard error `lab_missing`.
//!
//! Born failing: the stage A shell checks no lab, so these starts keep running on the splash.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it plants and reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::{Value, json};
use std::ffi::OsString;
use std::time::Duration;

const REQUIRED: [&str; 3] = [
    r".venv\Scripts\python.exe",
    r"src\nq_lab\config.py",
    r"terminal\backend\nq_terminal\__main__.py",
];

/// Starts the smoke exe with these extra switches and variables and returns its exit code and shell log.
fn refused(tag: &str, extra: Vec<OsString>, env: &[(&str, OsString)]) -> (Option<i32>, Vec<Value>) {
    let run = run_dir(tag);
    let mut args = base_args(&run);
    args.extend(extra);
    let watch = start_watch();
    let mut shell = launch(&run, &args, env);
    let code = wait_for_exit(&mut shell, Duration::from_secs(60));
    drop(shell);
    let report = watch.finish();
    assert_clean(&report);
    (code, shell_log(&run))
}

fn has(log: &[Value], event: &str) -> Option<Value> {
    log.iter().find(|e| e["event"] == event).cloned()
}

fn assert_refused(code: Option<i32>, log: &[Value], missing: &Value) {
    assert_eq!(code, Some(EXIT_RUN), "exit code; log {log:?}");
    let line = has(log, "lab_refused").unwrap_or_else(|| panic!("no lab_refused: {log:?}"));
    assert_eq!(&line["missing"], missing, "{line}");
    assert!(has(log, "setup_failed").is_some(), "{log:?}");
    let fatal = log
        .iter()
        .any(|e| e["event"] == "dialog_refused" && e["dialog"] == "fatal");
    assert!(fatal, "the fatal dialog did not fail closed: {log:?}");
}

#[test]
fn a_lab_missing_any_required_file_is_refused() {
    let _one = one_run();
    for (index, part) in REQUIRED.iter().enumerate() {
        let run = run_dir(&format!("lab-missing-{index}"));
        let lab = fake_lab(&run, true);
        std::fs::remove_file(lab.join(part)).expect("remove one required file");
        let (code, log) = refused(
            &format!("lab-run-{index}"),
            vec!["--lab".into(), lab.into()],
            &[],
        );
        assert_refused(code, &log, &json!([part]));
    }
}

#[test]
fn no_page_build_and_no_tools_is_refused() {
    let _one = one_run();
    let run = run_dir("lab-nodist");
    let lab = fake_lab(&run, false);
    let no_tools: OsString = std::env::var("SystemRoot")
        .map(|root| format!(r"{root}\System32;{root}"))
        .unwrap_or_default()
        .into();
    let env = [("PATH", no_tools)];
    let (code, log) = refused("lab-nodist-run", vec!["--lab".into(), lab.into()], &env);
    let missing = json!([r"terminal\web\dist\index.html, or node and pnpm on PATH to build it"]);
    assert_refused(code, &log, &missing);
}

#[test]
fn no_lab_at_all_is_a_hard_error_never_a_picker() {
    let _one = one_run();
    let (code, log) = refused("lab-none", Vec::new(), &[]);
    assert_eq!(code, Some(EXIT_RUN), "{log:?}");
    let line = has(&log, "lab_missing").unwrap_or_else(|| panic!("no lab_missing: {log:?}"));
    assert_eq!(line["picker"], json!(false), "{line}");
    let picked = log
        .iter()
        .any(|e| e["dialog"] == "pick_lab" || e["dialog"] == "choose_webview_dir");
    assert!(!picked, "a test build reached a picker: {log:?}");
}
