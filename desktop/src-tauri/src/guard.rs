//! Security guards that are installed through `with_webview` (navigation check, new-window denial, accelerators,
//! download policy). The closure runs on the UI thread and its COM result used to reach only the log, so a guard
//! that failed to install left a running shell without it. `guarded` sends each closure's result back to the
//! caller, which turns a failed or missing install into a `ShellError`, so setup fails closed (`setup_failed`).

use crate::ShellError;
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::time::Duration;

/// How long setup waits for a guard closure that did not run at once. On the setup thread (the UI thread) the
/// closure has already run when `with_webview` returns; the wait only covers a call from another thread.
const REPORT_WAIT: Duration = Duration::from_secs(10);

/// What a guard closure sends back: `Ok` once every part of the guard is installed, else the COM error text.
pub type Report = SyncSender<Result<(), String>>;

/// Runs `dispatch` (which must hand `Report` to the closure it queues) and waits for the closure's result.
/// A refused install, a closure that never ran, and a dispatch error are all errors.
pub fn guarded(
    name: &'static str,
    dispatch: impl FnOnce(Report) -> Result<(), ShellError>,
) -> Result<(), ShellError> {
    guarded_within(name, REPORT_WAIT, dispatch)?;
    fault_check(name)
}

/// The smoke fault switch (the guard tests' contract): `NQT_SMOKE_FAIL_HOOK=<name>` makes that one guard report a
/// failed install after the real install ran, so the refusal path is exercised end to end. Absent in every other
/// build, which never reads the variable.
#[cfg(feature = "smoke")]
const FAULT_ENV: &str = "NQT_SMOKE_FAIL_HOOK";

#[cfg(feature = "smoke")]
fn fault_check(name: &str) -> Result<(), ShellError> {
    let value = std::env::var(FAULT_ENV).ok();
    match fault_matches(value.as_deref(), name) {
        true => Err(ShellError::Refused(format!(
            "the {name} guard is not installed: fault switch {FAULT_ENV}"
        ))),
        false => Ok(()),
    }
}

#[cfg(not(feature = "smoke"))]
fn fault_check(name: &str) -> Result<(), ShellError> {
    let _ = name;
    Ok(())
}

#[cfg(any(feature = "smoke", test))]
fn fault_matches(switch: Option<&str>, name: &str) -> bool {
    switch == Some(name)
}

fn guarded_within(
    name: &'static str,
    wait: Duration,
    dispatch: impl FnOnce(Report) -> Result<(), ShellError>,
) -> Result<(), ShellError> {
    let (report, answer) = mpsc::sync_channel(1);
    dispatch(report)?;
    let refused =
        |why: String| ShellError::Refused(format!("the {name} guard is not installed: {why}"));
    match answer.recv_timeout(wait) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(refused(e)),
        Err(RecvTimeoutError::Timeout) => Err(refused("the install did not report".into())),
        Err(RecvTimeoutError::Disconnected) => Err(refused("the install did not run".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT: Duration = Duration::from_millis(50);

    #[test]
    fn a_reported_success_passes() {
        let done = guarded_within("test", SHORT, |report| {
            report.send(Ok(())).unwrap();
            Ok(())
        });
        assert!(done.is_ok());
    }

    #[test]
    fn a_fault_switch_matches_only_its_own_guard() {
        assert!(fault_matches(Some("keys"), "keys"));
        assert!(!fault_matches(Some("keys"), "download"));
        assert!(!fault_matches(None, "keys"));
    }

    #[test]
    fn a_reported_failure_fails_setup_with_the_guard_name() {
        let done = guarded_within("navigation", SHORT, |report| {
            report.send(Err("0x80004005".into())).unwrap();
            Ok(())
        });
        let text = done.unwrap_err().to_string();
        assert!(text.contains("navigation guard is not installed"), "{text}");
        assert!(text.contains("0x80004005"), "{text}");
    }

    #[test]
    fn a_closure_that_never_runs_fails_setup() {
        let done = guarded_within("keys", SHORT, |report| {
            drop(report);
            Ok(())
        });
        assert!(done.unwrap_err().to_string().contains("did not run"));
    }

    #[test]
    fn a_closure_that_stays_silent_fails_setup_after_the_wait() {
        let mut held = None;
        let done = guarded_within("keys", SHORT, |report| {
            held = Some(report);
            Ok(())
        });
        assert!(done.unwrap_err().to_string().contains("did not report"));
        drop(held);
    }

    #[test]
    fn a_dispatch_error_is_passed_on_unchanged() {
        let done = guarded_within("keys", SHORT, |_| {
            Err(ShellError::Tauri("no window".into()))
        });
        assert!(matches!(done, Err(ShellError::Tauri(_))));
    }
}
