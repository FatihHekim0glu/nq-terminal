//! Under smoke every native dialog fails closed (04 D4.2 item 14; review 2 blocker): no picker, no message box, the
//! safe answer, a `dialog_refused` log line, and the GLOBAL watch sees no new window and no foreground change.
//!
//! The starts here reach the dialogs a start can reach: the fatal stop after a refused setup (`--fixture` with no
//! lab: a hard error, never the lab picker) and the policy refusal (a planted test policy). Every other entry point
//! (Restart or Quit, the close confirm, the browser update, the rebuild confirm, the save dialogs, the folder choices)
//! is called directly by the unit test in src/dialogs.rs under the smoke and measure features, which fails on any new
//! window of its process.
//!
//! Born failing: a dialogs.rs whose test-build branch opened the native dialog would put a window up here (the
//! watch fails it), and the stage A shell reached no fatal dialog for a missing lab (it kept running).
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::Value;
use std::ffi::OsString;
use std::time::Duration;

fn refused_dialogs(log: &[Value]) -> Vec<String> {
    log.iter()
        .filter(|e| e["event"] == "dialog_refused")
        .filter_map(|e| e["dialog"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn a_start_with_no_lab_fails_closed_without_a_picker() {
    let _one = one_run();
    let run = run_dir("dialog-nolab");
    let mut args = base_args(&run);
    args.push("--fixture".into());
    let watch = start_watch();
    let mut shell = launch(&run, &args, &[]);
    let code = wait_for_exit(&mut shell, Duration::from_secs(60));
    drop(shell);
    let report = watch.finish();
    let log = shell_log(&run);
    assert_eq!(code, Some(EXIT_RUN), "{log:?}");
    assert_eq!(refused_dialogs(&log), ["fatal"], "{log:?}");
    assert_clean(&report);
}

#[test]
fn a_policy_refusal_fails_closed() {
    let _one = one_run();
    let run = run_dir("dialog-policy");
    let env: [(&str, OsString); 1] = [("NQT_TEST_POLICY_ROOT", "outside-the-test-tree".into())];
    let watch = start_watch();
    let mut shell = launch(&run, &base_args(&run), &env);
    let code = wait_for_exit(&mut shell, Duration::from_secs(30));
    drop(shell);
    let report = watch.finish();
    let stderr = std::fs::read_to_string(run.join("shell.err.log")).unwrap_or_default();
    assert_eq!(code, Some(EXIT_POLICY), "{stderr}");
    assert!(stderr.contains("\"dialog\":\"policy_refused\""), "{stderr}");
    assert_clean(&report);
}
