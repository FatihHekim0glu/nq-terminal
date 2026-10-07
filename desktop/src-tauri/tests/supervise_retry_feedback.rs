//! The Retry link on the stopped page must never look dead (05 G08; review finding): a click shows "Checking the
//! backend again" at once, a retry that fails again is announced in place (the page is not reloaded, so the link keeps
//! its focus), and a click with no backend left (Verdict::Gone) starts a new supervised backend instead of doing nothing.
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
use supervise::run::{self, AfterStop, Shared, Sink, Verdict};
use supervise::{ib_switch, retry};
use support::{Recorder, fake_lab};

struct Hearing(Arc<Recorder>);

impl Sink for Hearing {
    fn ready(&self, port: u16, _session: &str) {
        self.0.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn exited(&self, exit_code: Option<u32>) {
        self.0.push(format!("exited {exit_code:?}"));
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
fn the_retry_link_with_no_backend_is_gone_and_starts_a_new_backend() {
    let shared = shared_without_backend();
    let verdict = shared.navigation_verdict(retry::RETRY_URI);
    assert_eq!(verdict, Verdict::Gone, "a dead click: {verdict:?}");
}

#[test]
fn a_retry_with_no_backend_says_it_is_checking_then_that_it_exited() {
    let shared = shared_without_backend();
    let recorder = Arc::new(Recorder::default());
    shared.retry_navigation(&Hearing(recorder.clone()), "http://127.0.0.1:1/");
    assert_eq!(heard(&recorder), ["checking", "exited None"]);
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
        ["reload http://x/", "stopped swapped", "exited None"]
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

/// A retry that ends because the backend has gone goes through `exited` with no code, so the stopped page clears an
/// earlier exit's code line instead of keeping it under a fragment-only navigation (V032 review item).
#[test]
fn a_retry_whose_backend_has_gone_clears_the_exit_code() {
    let recorder = Arc::new(Recorder::default());
    let late = Err(Mismatch::Unverified("slow".into()));
    run::conclude_retry(&Hearing(recorder.clone()), "http://x/", late, true);
    assert_eq!(heard(&recorder), ["exited None"]);
}

/// The IB switch addresses are never allowed as a shell page (V032): with no backend they are a plain cancel, and the
/// switch itself is only for a current backend.
#[test]
fn the_ib_switch_addresses_are_cancelled_without_a_backend() {
    let shared = shared_without_backend();
    for uri in [ib_switch::IB_ON_URI, ib_switch::IB_OFF_URI] {
        assert_eq!(shared.navigation_verdict(uri), Verdict::Cancel, "{uri}");
    }
    assert!(!shared.ib_switch_allowed("http://127.0.0.1:1/"));
    // Look-alikes are ordinary shell pages, never the switch.
    let near = "http://tauri.localhost/ib-snapshot/on/";
    assert_eq!(shared.navigation_verdict(near), Verdict::Allow);
}

#[test]
fn the_ib_switch_verdict_needs_a_current_backend_and_the_exact_address() {
    assert_eq!(
        run::ib_switch_verdict(ib_switch::IB_ON_URI, true),
        Some(Verdict::IbSwitch(true))
    );
    assert_eq!(
        run::ib_switch_verdict(ib_switch::IB_OFF_URI, true),
        Some(Verdict::IbSwitch(false))
    );
    assert_eq!(
        run::ib_switch_verdict(ib_switch::IB_ON_URI, false),
        Some(Verdict::Cancel)
    );
    for other in [
        "http://tauri.localhost/stopped.html",
        "http://tauri.localhost/ib-snapshot/on?x=1",
        "",
    ] {
        assert_eq!(run::ib_switch_verdict(other, true), None, "{other}");
    }
}

#[test]
fn only_the_backends_own_page_may_ask_for_the_switch() {
    assert!(run::is_backend_page("http://127.0.0.1:5000/", 5000));
    assert!(run::is_backend_page("http://127.0.0.1:5000", 5000));
    assert!(run::is_backend_page("http://127.0.0.1:5000/live?x=1", 5000));
    for other in [
        "http://127.0.0.1:50001/",
        "http://127.0.0.1:500/",
        "http://tauri.localhost/stopped.html#exited",
        "http://localhost:5000/",
        "https://127.0.0.1:5000/",
        "about:blank",
        "",
    ] {
        assert!(!run::is_backend_page(other, 5000), "{other}");
    }
}

/// The sink's default for the switch does nothing, so a fake sink never opens a dialog.
#[test]
fn a_sink_without_a_window_ignores_the_switch() {
    let recorder = Arc::new(Recorder::default());
    Hearing(recorder.clone()).ib_switch(true);
    assert!(heard(&recorder).is_empty());
}
