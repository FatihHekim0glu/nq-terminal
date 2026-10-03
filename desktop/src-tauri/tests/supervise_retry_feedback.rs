//! The Retry link on the stopped page must never look dead (05 G08; review finding): a click shows "Checking the
//! backend again" at once, a retry that fails again is announced in place (the page is not reloaded, so the link keeps
//! its focus), and a click with no backend to check goes to the "exited" section instead of doing nothing.
//!
//! Born failing: before the fix the retry gave no feedback for the whole retry budget (about 16 s), a second failure
//! navigated to the address already shown, and with no backend the click was cancelled and nothing happened.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: a fake lab for the shared state"
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
use supervise::check::{self, BACKEND_MODULE, Expect, Mismatch, Spec};
use supervise::retry;
use supervise::run::{self, AfterStop, Shared, Sink, Verdict};
use support::{Recorder, fake_lab};

struct Hearing(Arc<Recorder>);

impl Sink for Hearing {
    fn ready(&self, port: u16, _session: &str) {
        self.0.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn gave_up(&self, _log: &Path) -> AfterStop {
        AfterStop::Quit
    }
    fn reload(&self, uri: &str) {
        self.0.push(format!("reload {uri}"));
    }
    fn checking(&self) {
        self.0.push("checking".into());
    }
    fn still_unverified(&self) {
        self.0.push("still_unverified".into());
    }
}

fn heard(recorder: &Recorder) -> Vec<String> {
    recorder.calls().into_iter().map(|(_, c)| c).collect()
}

/// A shared state with no backend: the loop was never started, so nothing is current.
fn shared_without_backend() -> Arc<Shared> {
    let lab = fake_lab("retry-feedback", &json!({}));
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared")
}

#[test]
fn the_retry_link_with_no_backend_goes_to_the_exited_section() {
    let shared = shared_without_backend();
    let verdict = shared.navigation_verdict(retry::RETRY_URI);
    assert_eq!(verdict, Verdict::Gone, "a dead click: {verdict:?}");
}

#[test]
fn a_retry_with_no_backend_says_it_is_checking_then_that_it_exited() {
    let shared = shared_without_backend();
    let recorder = Arc::new(Recorder::default());
    shared.retry_navigation(&Hearing(recorder.clone()), "http://127.0.0.1:1/");
    assert_eq!(heard(&recorder), ["checking", "stopped exited"]);
}

#[test]
fn a_retry_that_is_unverified_again_is_announced_not_navigated() {
    let recorder = Arc::new(Recorder::default());
    let unverified = Err(Mismatch::Unverified("slow".into()));
    run::conclude_retry(&Hearing(recorder.clone()), "http://x/", unverified, false);
    assert_eq!(heard(&recorder), ["still_unverified"]);
}

#[test]
fn a_retry_that_passes_goes_on_and_a_wrong_answer_shows_its_section() {
    let recorder = Arc::new(Recorder::default());
    let sink = Hearing(recorder.clone());
    run::conclude_retry(&sink, "http://x/", Ok(()), false);
    run::conclude_retry(&sink, "http://x/", Err(Mismatch::Proof("no".into())), false);
    run::conclude_retry(&sink, "http://x/", Err(Mismatch::Hmac), true);
    assert_eq!(
        heard(&recorder),
        ["reload http://x/", "stopped swapped", "stopped exited"]
    );
}

#[test]
fn the_status_script_sets_the_status_paragraph_only_on_the_stopped_page() {
    let script = retry::status_script(retry::CHECKING);
    assert!(script.contains("unverified-text"), "{script}");
    assert!(script.contains("stopped.html"), "{script}");
    assert!(script.contains("Checking the backend again."), "{script}");
    let quoted = retry::status_script("a \"b\"");
    assert!(quoted.contains(r#"a \"b\""#), "{quoted}");
    for text in [retry::CHECKING, retry::STILL_UNVERIFIED] {
        assert!(!text.contains(['\u{2013}', '\u{2014}']), "{text}");
    }
}
