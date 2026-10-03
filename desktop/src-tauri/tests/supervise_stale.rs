//! A backend that reports its page build as stale (03 section 7.1; 04 D4.2 item 12 and D4.3): the supervisor ends that
//! backend and asks its sink what to do. A sink that rebuilt the page returns true and the loop starts the backend
//! again (after the usual 1 s back-off, so a rebuild that does not help is bounded by the crash window); a sink that
//! did not returns false and the loop ends without a stopped page of its own. The default sink shows the stopped
//! page's `dist` section, as before.
//!
//! Born failing: against the supervisor before `Sink::stale_dist` existed the loop never asked, so the second spawn
//! never came and the sink never heard of the stale build.
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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use supervise::run::{self, AfterStop, Shared, Sink};
use support::{Recorder, fake_lab, watch};

/// The spawns are counted from the shell log of this process, so the two runs go one at a time.
static ONE_RUN: Mutex<()> = Mutex::new(());

fn spawns_logged() -> usize {
    crash::events()
        .iter()
        .filter(|(_, e, _)| e == "supervise_spawned")
        .count()
}

/// A sink that records what it hears. `rebuild_once` makes its first `stale_dist` answer "rebuilt".
struct Hearing {
    heard: Arc<Recorder>,
    rebuild_once: Option<AtomicBool>,
}

impl Sink for Hearing {
    fn ready(&self, port: u16, _session: &str) {
        self.heard.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.heard.push(format!("stopped {code}"));
    }
    fn gave_up(&self, _log: &Path) -> AfterStop {
        self.heard.push("gave_up".to_string());
        AfterStop::Quit
    }
    fn stale_dist(&self, state: &str) -> bool {
        let Some(once) = &self.rebuild_once else {
            self.stopped("dist");
            return false;
        };
        self.heard.push(format!("stale {state}"));
        once.swap(false, Ordering::SeqCst)
    }
}

/// Runs the loop over a fake that always reports a stale page build; what the sink heard, and the spawns.
fn run_over_stale_fake(sink_of: impl FnOnce(Arc<Recorder>) -> Hearing) -> (Vec<String>, usize) {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let before = spawns_logged();
    let lab = fake_lab("stale-dist", &json!({ "lie": "dist" }));
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let shared =
        Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(sink_of(recorder.clone()));
    run::run(shared, sink);
    let heard = recorder.calls().into_iter().map(|(_, c)| c).collect();
    (heard, spawns_logged() - before)
}

#[test]
fn a_rebuilt_page_starts_the_backend_again_and_a_second_stale_answer_ends_the_loop() {
    let watching = watch();
    let (heard, spawns) = run_over_stale_fake(|heard| Hearing {
        heard,
        rebuild_once: Some(AtomicBool::new(true)),
    });
    assert_eq!(
        heard,
        ["stale stale", "stale stale"],
        "the sink heard {heard:?}"
    );
    assert_eq!(
        spawns, 2,
        "one spawn per attempt, none after the loop ended"
    );
    watching.assert_clean();
}

#[test]
fn without_a_rebuild_the_default_shows_the_stopped_pages_dist_section_once() {
    let watching = watch();
    let (heard, spawns) = run_over_stale_fake(|heard| Hearing {
        heard,
        rebuild_once: None,
    });
    assert_eq!(heard, ["stopped dist"]);
    assert_eq!(spawns, 1);
    watching.assert_clean();
}
