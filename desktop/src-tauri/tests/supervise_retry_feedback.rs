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
use std::time::Duration;
use supervise::check::{self, BACKEND_MODULE, Expect, Mismatch, Spec};
use supervise::run::{self, AfterRetry, AfterStop, IbGate, Shared, Sink, Verdict};
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
    run::conclude_retry(
        &Hearing(recorder.clone()),
        "http://x/",
        unverified,
        AfterRetry::Current,
    );
    assert_eq!(heard(&recorder), ["still_unverified"]);
}

#[test]
fn a_retry_that_passes_goes_on_and_a_wrong_answer_shows_its_section() {
    let recorder = Arc::new(Recorder::default());
    let sink = Hearing(recorder.clone());
    run::conclude_retry(&sink, "http://x/", Ok(()), AfterRetry::Current);
    let swapped = Err(Mismatch::Proof("no".into()));
    run::conclude_retry(&sink, "http://x/", swapped, AfterRetry::Current);
    let gone = AfterRetry::Ended(None);
    run::conclude_retry(&sink, "http://x/", Err(Mismatch::Hmac), gone);
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

/// A retry that ends with no backend and no exit code known goes through `exited` with no code, so the stopped page
/// clears an earlier exit's code line instead of keeping it under a fragment-only navigation (V032 review item).
#[test]
fn a_retry_whose_backend_has_gone_with_no_known_code_clears_the_exit_code() {
    let recorder = Arc::new(Recorder::default());
    let late = Err(Mismatch::Unverified("slow".into()));
    run::conclude_retry(
        &Hearing(recorder.clone()),
        "http://x/",
        late,
        AfterRetry::Ended(None),
    );
    assert_eq!(heard(&recorder), ["exited None"]);
}

/// V032 review: a backend that exits while its proof is retried has just had its code written by `serve`; the retry
/// then ended with `exited(None)` and wiped that fresh code. The retry now ends with the last code `serve` reported.
#[test]
fn a_retry_whose_backend_exited_meanwhile_keeps_its_exit_code() {
    let recorder = Arc::new(Recorder::default());
    let sink = Hearing(recorder.clone());
    // What serve reports when the backend ends, then how the retry that saw it end concludes.
    sink.exited(Some(3));
    let gone = Err(Mismatch::Proof("the backend has ended".into()));
    run::conclude_retry(&sink, "http://x/", gone, AfterRetry::Ended(Some(3)));
    assert_eq!(heard(&recorder), ["exited Some(3)", "exited Some(3)"]);
}

/// The shared state starts with no exit code known, which is what a retry with no backend ever reports.
#[test]
fn no_exit_code_is_known_before_a_backend_has_exited() {
    assert_eq!(shared_without_backend().last_exit(), None);
}

/// The IB switch addresses are never allowed as a shell page (V032): with no backend they are a plain cancel, and the
/// switch itself is only for a current backend.
#[test]
fn the_ib_switch_addresses_are_cancelled_without_a_backend() {
    let shared = shared_without_backend();
    for uri in [ib_switch::IB_ON_URI, ib_switch::IB_OFF_URI] {
        assert_eq!(shared.navigation_verdict(uri), Verdict::Cancel, "{uri}");
    }
    assert_eq!(
        shared.ib_switch_gate("http://127.0.0.1:1/"),
        IbGate::Refused
    );
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
    Hearing(recorder.clone()).ib_switch(true, false);
    Hearing(recorder.clone()).ib_switch(false, true);
    assert!(heard(&recorder).is_empty());
}

/// V032 review: on a backend this app attached to, the switch said off and its off confirm said the terminal would not
/// connect to TWS, although that backend follows its own environment. The gate tells an attached backend's page
/// apart, so the window says why the switch does not apply instead of asking (ib_switch.rs `Outcome::Attached`).
#[test]
fn the_ib_gate_tells_a_started_backend_from_an_attached_one() {
    let page = "http://127.0.0.1:5000/live";
    assert_eq!(run::ib_gate(page, Some((5000, false))), IbGate::Started);
    assert_eq!(run::ib_gate(page, Some((5000, true))), IbGate::Attached);
    assert_eq!(run::ib_gate(page, None), IbGate::Refused);
    for (other, attached) in [
        ("http://127.0.0.1:5001/", false),
        ("http://127.0.0.1:5001/", true),
        ("http://tauri.localhost/stopped.html#exited", true),
        ("", true),
    ] {
        assert_eq!(
            run::ib_gate(other, Some((5000, attached))),
            IbGate::Refused,
            "{other}"
        );
    }
}

/// The same through the real loop and a fake backend (V032 review): the Retry link's proof reaches a backend that ends
/// at that very proof with exit code 7, so `serve` writes `exited Some(7)`; the restart is refused (the fake then
/// reports a contract this app does not accept), so no backend is current when the retry concludes. The retry must
/// end with the code `serve` has just written, never with `exited None`, which would wipe it from the stopped page.
#[test]
fn a_retry_through_the_loop_keeps_the_code_of_the_backend_that_ended_at_its_proof() {
    let lab = fake_lab(
        "retry-keeps-code",
        &json!({ "proof_exit_on": 2, "proof_exit_code": 7 }),
    );
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let shared =
        Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Hearing(recorder.clone()));
    let (loop_shared, loop_sink) = (shared.clone(), sink.clone());
    let looping = std::thread::spawn(move || run::run(loop_shared, loop_sink));
    support::wait_until(Duration::from_secs(60), "the first backend", || {
        shared.current().is_some()
    });
    let port = shared.current().expect("a current backend").port();
    // The next start reports a contract this app refuses, so the loop ends after the crash with no backend current.
    let mode = lab
        .lab
        .join("terminal")
        .join("backend")
        .join("fake_mode.json");
    std::fs::write(&mode, json!({ "lie": "contract" }).to_string()).expect("the next mode");
    shared.retry_navigation(sink.as_ref(), &format!("http://127.0.0.1:{port}/"));
    support::wait_until(Duration::from_secs(60), "the loop to end", || {
        looping.is_finished()
    });
    let _ = looping.join();
    let calls = heard(&recorder);
    assert_eq!(shared.last_exit(), Some(7), "{calls:?}");
    assert!(
        !calls.iter().any(|c| c == "exited None"),
        "the retry wiped the exit code: {calls:?}"
    );
    let exits = calls.iter().filter(|c| *c == "exited Some(7)").count();
    assert_eq!(
        exits, 2,
        "serve's report and the retry's conclusion: {calls:?}"
    );
    assert!(calls.contains(&"checking".to_string()), "{calls:?}");
}

/// V032 review (narrower race): `serve` cleared the current backend, wrote its log line and only then recorded the exit
/// code, so a retry deciding in that gap saw no backend and no (or the previous run's) code. Ending a backend now
/// records the code and clears the current backend in one step, and a retry reads both in one step.
#[test]
fn ending_a_backend_records_its_code_in_the_same_step_that_clears_it() {
    let shared = shared_without_backend();
    assert_eq!(shared.standing(), AfterRetry::Ended(None));
    shared.end_current(Some(5));
    assert_eq!(shared.standing(), AfterRetry::Ended(Some(5)));
    assert_eq!(shared.last_exit(), Some(5));
    shared.end_current(None);
    assert_eq!(shared.standing(), AfterRetry::Ended(None));
}

/// Through the real loop: whenever no backend is current after one has run, the code of the one that ended is already
/// known. A poller watches the shared state while the fake backend exits with code 9 at the Retry link's proof; the next
/// start is refused, so the state stays at its end.
#[test]
fn a_retry_never_sees_no_backend_before_the_exit_code_of_the_one_that_ended() {
    let lab = fake_lab(
        "retry-no-gap",
        &json!({ "proof_exit_on": 2, "proof_exit_code": 9 }),
    );
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let shared =
        Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Hearing(recorder.clone()));
    let (loop_shared, loop_sink) = (shared.clone(), sink.clone());
    let looping = std::thread::spawn(move || run::run(loop_shared, loop_sink));
    support::wait_until(Duration::from_secs(60), "the first backend", || {
        shared.current().is_some()
    });
    let port = shared.current().expect("a current backend").port();
    let mode = lab
        .lab
        .join("terminal")
        .join("backend")
        .join("fake_mode.json");
    std::fs::write(&mode, json!({ "lie": "contract" }).to_string()).expect("the next mode");
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (watched, flag) = (shared.clone(), done.clone());
    let poller = std::thread::spawn(move || {
        while !flag.load(std::sync::atomic::Ordering::SeqCst) {
            if watched.standing() == AfterRetry::Ended(None) {
                return false;
            }
        }
        true
    });
    shared.retry_navigation(sink.as_ref(), &format!("http://127.0.0.1:{port}/"));
    support::wait_until(Duration::from_secs(60), "the loop to end", || {
        looping.is_finished()
    });
    let _ = looping.join();
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        poller.join().expect("the poller"),
        "no backend and no code: {:?}",
        heard(&recorder)
    );
}
