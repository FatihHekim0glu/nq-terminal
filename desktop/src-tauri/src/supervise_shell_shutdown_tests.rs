//! Unit tests of the close and exit shutdown gate of supervise_shell.rs (V033B).

use super::*;

/// V033B review: close-app.ps1 cannot tell an open question from none unless the shell logs the answer too.
#[test]
fn the_answer_to_the_close_question_is_logged_with_the_choice() {
    use crate::dialogs::Confirm;
    assert_eq!(
        answered_record(Confirm::Proceed),
        json!({ "choice": "close" })
    );
    assert_eq!(
        answered_record(Confirm::Cancel),
        json!({ "choice": "cancel" })
    );
}

#[test]
fn a_cancelled_question_leaves_the_guard_open_and_the_next_close_asks_again() {
    let done = AtomicBool::new(false);
    assert_eq!(shutdown_gate(&done, || false), ShutdownGate::Kept);
    assert!(!done.load(Ordering::SeqCst), "a cancel closed the guard");
    let mut asked = false;
    let gate = shutdown_gate(&done, || {
        asked = true;
        true
    });
    assert_eq!((gate, asked), (ShutdownGate::Go, true));
    assert!(done.load(Ordering::SeqCst), "the guard stayed open");
}

#[test]
fn after_a_shutdown_a_later_call_returns_at_once_without_asking() {
    let done = AtomicBool::new(false);
    assert_eq!(shutdown_gate(&done, || true), ShutdownGate::Go);
    let mut asked = false;
    let again = shutdown_gate(&done, || {
        asked = true;
        false
    });
    assert_eq!((again, asked), (ShutdownGate::Done, false));
}

#[test]
fn the_exit_path_never_asks_and_still_shuts_down_with_a_mode() {
    // A question that would answer Cancel (a running backtest, or a count nobody can read).
    let supervisor = Supervisor::new(None, None);
    let mut asked = false;
    let mut ended = false;
    let result = supervisor.run_shutdown(
        ShutdownKind::Exit,
        |_| {
            asked = true;
            false
        },
        |_| {
            ended = true;
            Ended::Nothing
        },
    );
    assert_eq!((result.is_ok(), asked, ended), (true, false, true));
    assert!(
        supervisor.done.load(Ordering::SeqCst),
        "the guard stayed open"
    );
}

#[test]
fn a_close_that_answers_cancel_still_keeps_the_window_and_ends_nothing() {
    let supervisor = Supervisor::new(None, None);
    let mut ended = false;
    let result = supervisor.run_shutdown(
        ShutdownKind::Close,
        |_| false,
        |_| {
            ended = true;
            Ended::Nothing
        },
    );
    assert!(matches!(result, Err(ShellError::Refused(_))));
    assert!(!ended && !supervisor.done.load(Ordering::SeqCst));
}

#[test]
fn the_exit_after_a_completed_close_ends_nothing_again() {
    let supervisor = Supervisor::new(None, None);
    let first = supervisor.run_shutdown(ShutdownKind::Close, |_| true, |_| Ended::Nothing);
    let mut ended = false;
    let again = supervisor.run_shutdown(
        ShutdownKind::Exit,
        |_| true,
        |_| {
            ended = true;
            Ended::Nothing
        },
    );
    assert_eq!((first.is_ok(), again.is_ok(), ended), (true, true, false));
}

#[test]
fn every_shutdown_path_names_its_mode_and_a_spawned_one_its_grace() {
    for (ended, record) in [
        (
            Ended::Spawned(true),
            json!({ "mode": "spawned", "stopped_in_grace": true }),
        ),
        (Ended::Attached, json!({ "mode": "attached" })),
        (Ended::Nothing, json!({ "mode": "none" })),
    ] {
        assert_eq!(shutdown_record(ended), record);
    }
}
