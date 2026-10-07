//! Restarts (03 section 17; 04 D4.3): 1, 2 and 4 s between restarts, and three crashes within 60 s stop the retries
//! and ask Restart or Quit (which fails closed to Quit in a test build). The policy is checked on a fixed clock, and
//! the loop on a real fake backend that crashes 0.3 s after each handshake: spawn, crash, 1 s, spawn, crash, 2 s,
//! spawn, crash, give up, and no fourth spawn.
//!
//! Born failing: against the stage A stub (no loop, constants only) the loop test fails, and a policy that counts
//! every crash ever (no 60 s window) or never resets its streak fails the policy cases.
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

use serde_json::json;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use supervise::run::{self, AfterStop, Next, RestartPolicy, Shared, Sink};
use support::{Recorder, fake_lab, wait_until, watch};

const SECOND: Duration = Duration::from_secs(1);
/// Spawn, handshake and checks of the fake take well under this on this PC.
const SPAWN_SLACK: Duration = Duration::from_millis(1500);

fn at(t0: Instant, seconds: u64) -> Instant {
    t0 + Duration::from_secs(seconds)
}

#[test]
fn backoff_is_1_then_2_seconds_and_three_crashes_in_60_s_give_up() {
    let (mut policy, t0) = (RestartPolicy::default(), Instant::now());
    assert_eq!(policy.crashed(at(t0, 0), SECOND), Next::Retry(SECOND));
    assert_eq!(policy.crashed(at(t0, 5), SECOND), Next::Retry(2 * SECOND));
    assert_eq!(policy.crashed(at(t0, 10), SECOND), Next::GiveUp);
}

#[test]
fn a_third_crash_outside_the_window_waits_4_seconds() {
    let (mut policy, t0) = (RestartPolicy::default(), Instant::now());
    assert_eq!(policy.crashed(at(t0, 0), SECOND), Next::Retry(SECOND));
    assert_eq!(
        policy.crashed(at(t0, 30), 20 * SECOND),
        Next::Retry(2 * SECOND)
    );
    // The crash at 0 s has left the 60 s window, so this is the second within it; the streak is at its third step.
    assert_eq!(
        policy.crashed(at(t0, 70), 30 * SECOND),
        Next::Retry(4 * SECOND)
    );
    assert_eq!(
        policy.crashed(at(t0, 75), SECOND),
        Next::GiveUp,
        "30, 70 and 75 s: three within 60 s"
    );
}

#[test]
fn a_long_run_ends_the_streak_and_a_reset_clears_everything() {
    let (mut policy, t0) = (RestartPolicy::default(), Instant::now());
    assert_eq!(policy.crashed(at(t0, 0), SECOND), Next::Retry(SECOND));
    assert_eq!(
        policy.crashed(at(t0, 200), 120 * SECOND),
        Next::Retry(SECOND),
        "a 120 s run starts a new streak"
    );
    policy.reset();
    assert_eq!(policy.crashed(at(t0, 201), SECOND), Next::Retry(SECOND));
    assert_eq!(policy.crashed(at(t0, 202), SECOND), Next::Retry(2 * SECOND));
    assert_eq!(policy.crashed(at(t0, 203), SECOND), Next::GiveUp);
}

struct Recording(Arc<Recorder>);

impl Sink for Recording {
    fn ready(&self, port: u16, _session: &str) {
        self.0.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn exited(&self, exit_code: Option<u32>) {
        self.0.push(format!("exited {exit_code:?}"));
    }
    fn gave_up(&self, log: &Path) -> AfterStop {
        self.0.push(format!("gave_up {}", log.display()));
        crate::dialogs::restart_or_quit::<tauri::Wry>(None, log);
        AfterStop::Quit
    }
}

/// The times of one event in the shell log, in order.
fn times_of(event: &str) -> Vec<Instant> {
    crash::events()
        .into_iter()
        .filter(|(_, e, _)| e == event)
        .map(|(t, _, _)| t)
        .collect()
}

/// Runs the loop over a fake that crashes 0.3 s after each handshake until the loop ends; the sink's calls.
fn run_until_it_gives_up() -> Vec<String> {
    let lab = fake_lab("restart-loop", &json!({ "exit_after_ready_s": 0.3 }));
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let shared =
        Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let looping = std::thread::spawn(move || run::run(shared, sink));
    wait_until(Duration::from_secs(40), "the loop to give up", || {
        looping.is_finished()
    });
    std::thread::sleep(2 * SECOND);
    recorder.calls().into_iter().map(|(_, c)| c).collect()
}

#[test]
fn the_loop_restarts_at_1_and_2_seconds_then_gives_up_after_three_crashes() {
    let watch = watch();
    let calls = run_until_it_gives_up();
    let (spawned, exits) = (times_of("supervise_spawned"), times_of("supervise_exit"));
    assert_eq!(
        spawned.len(),
        3,
        "exactly three spawns, none after giving up: {calls:?}"
    );
    assert_eq!(exits.len(), 3, "{calls:?}");
    let (first_gap, second_gap) = (
        spawned[1].duration_since(exits[0]),
        spawned[2].duration_since(exits[1]),
    );
    assert!(
        first_gap >= SECOND && first_gap < SECOND + SPAWN_SLACK,
        "first restart after {first_gap:?}"
    );
    let second_ok = second_gap >= 2 * SECOND && second_gap < 2 * SECOND + SPAWN_SLACK;
    assert!(second_ok, "second restart after {second_gap:?}");
    let readies = calls.iter().filter(|c| c.starts_with("ready ")).count();
    // The fake ends itself with code 3 after its handshake; the stopped page is told that code each time.
    let stops = calls.iter().filter(|c| *c == "exited Some(3)").count();
    assert_eq!((readies, stops), (3, 3), "{calls:?}");
    let asked = calls.last().is_some_and(|c| c.starts_with("gave_up "));
    assert!(asked, "the last word is the question: {calls:?}");
    let events = crash::events();
    let refused = events
        .iter()
        .any(|(_, e, d)| e == "dialog_refused" && d["dialog"] == "restart_or_quit");
    assert!(
        refused,
        "the Restart or Quit dialog fails closed in a test build"
    );
    watch.assert_clean();
}
