//! The close confirmation for a running backtest fails closed (03 section 2.3; O11; INT1): when the shell cannot read
//! how many backtests run (an answer past its size cap, a 401 for an evicted session, a timeout), it asks, it never
//! closes on a guess. A long job history (200 records of up to 100 log lines) bulks `GET /api/jobs` past 1 MiB, and
//! the count must still be read from it.
//!
//! Born failing: `running_jobs` refused any answer over 1 MiB as too large and the close then read the error as "no
//! backtest running" (`unwrap_or(0) > 0`), so the shell ended the job without asking.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: fake labs and fake backends"
)]

#[allow(dead_code)]
#[path = "../src/link.rs"]
mod link;
#[allow(dead_code, unused_imports)]
#[path = "../src/supervise.rs"]
mod supervise;
#[path = "supervise_support.rs"]
mod support;

pub use support::{Launch, ShellError, crash, dialogs, guard, reads, window, writes};

use link::LinkError;
use serde_json::json;
use std::time::Duration;
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use support::{FakeLab, fake_lab, watch};

const TIMEOUT: Duration = Duration::from_secs(5);
/// Past the shell's general 1 MiB cap and past the 26 full-tail jobs the finding named.
const BULKY_TAIL: usize = 2 * 1024 * 1024;
/// Past anything the backend's 200-record history can hold (200 x about 40 KB).
const ABSURD_TAIL: usize = 32 * 1024 * 1024;

fn spawn_over(lab: &FakeLab) -> supervise::Spawned {
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    };
    let expect = Expect::for_lab(&lab.lab, check::CONTRACT_RANGE);
    supervise::spawn(&spec, &expect).expect("the honest fake is accepted")
}

fn count(spawned: &supervise::Spawned, session: &str) -> Result<u32, LinkError> {
    let owner_ok = |pid| spawned.job_pids().contains(&pid);
    link::running_jobs(spawned.port(), session, &owner_ok, TIMEOUT)
}

#[test]
fn only_a_read_zero_lets_the_close_go_without_asking() {
    assert!(!link::close_needs_confirm(&Ok(0)));
    assert!(link::close_needs_confirm(&Ok(1)));
    for failure in [
        LinkError::Status(401),
        LinkError::Timeout,
        LinkError::Io("reset".into()),
        LinkError::Protocol("the answer is too large".into()),
    ] {
        assert!(
            link::close_needs_confirm(&Err(failure)),
            "a failed read let the close go unasked"
        );
    }
}

#[test]
fn a_history_bigger_than_1_mib_still_gives_the_running_count() {
    let watch = watch();
    let lab = fake_lab(
        "close-bulky",
        &json!({ "running_jobs": 1, "jobs_pad": BULKY_TAIL }),
    );
    let spawned = spawn_over(&lab);
    let read = count(&spawned, spawned.session());
    spawned.end();
    assert_eq!(read, Ok(1), "the count was lost to the size cap");
    watch.assert_clean();
}

#[test]
fn an_answer_past_every_cap_is_a_failed_read_and_the_close_asks() {
    let lab = fake_lab(
        "close-absurd",
        &json!({ "running_jobs": 1, "jobs_pad": ABSURD_TAIL }),
    );
    let spawned = spawn_over(&lab);
    let read = count(&spawned, spawned.session());
    spawned.end();
    assert!(read.is_err(), "an unbounded answer was read: {read:?}");
    assert!(link::close_needs_confirm(&read));
}

#[test]
fn a_401_for_the_session_is_a_failed_read_and_the_close_asks() {
    let lab = fake_lab("close-401", &json!({ "running_jobs": 1 }));
    let spawned = spawn_over(&lab);
    let read = count(&spawned, "an-evicted-session");
    spawned.end();
    assert_eq!(read, Err(LinkError::Status(401)));
    assert!(link::close_needs_confirm(&read));
}
