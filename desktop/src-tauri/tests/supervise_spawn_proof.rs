//! A slow first identity proof at spawn time is not a refusal (desktop 0.2.1, the launch-reliability probe): the
//! first fresh proof after READY gets the 2 s link budget, and when it is only late it is tried again with a fresh
//! nonce under the navigation check's own rules (RETRY_ATTEMPTS, RETRY_BUDGET, RETRY_PAUSE), inside the 30 s handshake
//! budget. A wrong answer or a foreign owner is still refused at once, the token goes out only after a proof passes,
//! and the stopped page's Retry recovers from a spawn-time refusal by starting a new supervised backend.
//!
//! Born failing: before 0.2.1 a first proof that answered after 2 s refused the spawn as unverified, the fixture had no
//! late or lying proof route, and Retry with no backend only showed the "exited" section.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: fake labs and fake backends this test owns"
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

use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use supervise::check::{self, BACKEND_MODULE, Expect, Failure, Mismatch, Spec};
use supervise::retry::{self, RETRY_ATTEMPTS};
use supervise::run::{self, AfterStop, Backend, Shared, Sink, Verdict};
use support::{FakeLab, Recorder, Tracked, fake_lab, records_in, wait_until, watch};

/// Longer than every attempt's budget, so each proof of such a fake is late.
const ALWAYS_LATE_S: f64 = 8.0;

fn spec_for(lab: &FakeLab) -> Spec {
    Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    }
}

fn expect_for(lab: &FakeLab) -> Expect {
    Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)
}

/// Every proof answer of this fake is late.
fn always_late() -> Value {
    json!({ "proof_delay_s": ALWAYS_LATE_S, "proof_delay_count": 99 })
}

/// Every request any fake of this lab reported, in arrival order.
fn all_requests(lab: &FakeLab) -> Vec<Value> {
    let lines = lab.lines();
    let tagged = lines.iter().filter_map(|l| l.strip_prefix("FAKE-REQUEST "));
    tagged
        .filter_map(|j| serde_json::from_str(j).ok())
        .collect()
}

fn path_of(request: &Value) -> String {
    request["path"].as_str().unwrap_or("").to_string()
}

fn is_proof(request: &Value) -> bool {
    path_of(request).starts_with("/api/desktop/proof?nonce=")
}

fn carries_a_secret(request: &Value) -> bool {
    let headers = request["headers"].as_object();
    headers.is_some_and(|h| h.keys().any(|k| k.eq_ignore_ascii_case("authorization")))
}

/// The requests once `count` proofs have been drained into backend.log.
fn requests_after_proofs(lab: &FakeLab, count: usize) -> Vec<Value> {
    let enough = || all_requests(lab).iter().filter(|r| is_proof(r)).count() >= count;
    wait_until(
        Duration::from_secs(10),
        "the proof requests in backend.log",
        enough,
    );
    all_requests(lab)
}

/// Every fake this lab started has ended (a refused backend's tree is ended with its job).
fn assert_every_fake_ended(lab: &FakeLab) {
    for pid in records_in(&lab.lines())
        .iter()
        .filter_map(|r| r["pid"].as_u64())
    {
        if let Some(process) = Tracked::open(pid as u32) {
            let ended = process.ended_within(Duration::from_secs(5));
            assert!(ended, "the refused fake {pid} is still running");
        }
    }
}

fn refusal(failure: Failure) -> Mismatch {
    match failure {
        Failure::Refused(m) => m,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_late_first_proof_at_spawn_is_retried_and_checked_not_refused() {
    let watch = watch();
    let lab = fake_lab("proof-late-first", &json!({ "proof_delay_s": 2.5 }));
    let began = Instant::now();
    let spawned = supervise::spawn(&spec_for(&lab), &expect_for(&lab))
        .expect("a proof that is only late is retried, then accepted");
    assert!(began.elapsed() < supervise::HANDSHAKE_TIMEOUT);
    wait_until(Duration::from_secs(5), "the session request", || {
        all_requests(&lab)
            .iter()
            .any(|r| path_of(r) == "/api/session")
    });
    let requests = all_requests(&lab);
    let session_at = requests
        .iter()
        .position(|r| path_of(r) == "/api/session")
        .expect("a session request");
    let proofs: Vec<String> = requests[..session_at]
        .iter()
        .filter(|r| is_proof(r))
        .map(path_of)
        .collect();
    assert!(
        proofs.len() >= 2,
        "the late proof was not tried again: {proofs:?}"
    );
    let fresh: std::collections::HashSet<&String> = proofs.iter().collect();
    assert_eq!(
        fresh.len(),
        proofs.len(),
        "a nonce was used twice: {proofs:?}"
    );
    let owner_ok = |pid| spawned.job_pids().contains(&pid);
    let health = link::with_session(
        spawned.port(),
        "/api/health",
        spawned.session(),
        &owner_ok,
        Duration::from_secs(2),
    );
    assert_eq!(
        health.expect("health").status,
        200,
        "the session opens /api"
    );
    drop(spawned);
    watch.assert_clean();
}

#[test]
fn a_wrong_proof_at_spawn_is_still_refused_at_once() {
    let lab = fake_lab("proof-wrong-mac", &json!({ "proof_lie": "mac" }));
    let failure =
        supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect_err("a wrong proof is refused");
    let m = refusal(failure);
    assert!(matches!(m, Mismatch::Proof(_)), "{m:?}");
    assert_eq!(m.code(), "swapped");
    let requests = requests_after_proofs(&lab, 1);
    let proofs = requests.iter().filter(|r| is_proof(r)).count();
    assert_eq!(proofs, 1, "a wrong answer was tried again: {requests:?}");
    assert!(!requests.iter().any(carries_a_secret), "{requests:?}");
    assert_every_fake_ended(&lab);
}

#[test]
fn a_foreign_owner_is_still_refused_at_once() {
    let me = std::process::id();
    let mode = json!({ "proof_delay_s": 2.5, "proof_lie": "foreign_pid", "outside_pid": me });
    let lab = fake_lab("proof-foreign-owner", &mode);
    let failure = supervise::spawn(&spec_for(&lab), &expect_for(&lab))
        .expect_err("a foreign owner is refused");
    assert_eq!(refusal(failure), Mismatch::PidOutsideJob(me));
    // The first proof was only late; the retried one named a foreign pid, and that ended the retries at once.
    let requests = requests_after_proofs(&lab, 2);
    let proofs = requests.iter().filter(|r| is_proof(r)).count();
    assert_eq!(proofs, 2, "a foreign owner was tried again: {requests:?}");
    assert!(!requests.iter().any(carries_a_secret), "{requests:?}");
    assert_every_fake_ended(&lab);
}

#[test]
fn the_token_is_never_sent_before_a_passing_proof() {
    let lab = fake_lab("proof-always-late", &always_late());
    let began = Instant::now();
    let failure = supervise::spawn(&spec_for(&lab), &expect_for(&lab))
        .expect_err("a backend that never proves itself is not used");
    let took = began.elapsed();
    assert!(
        matches!(refusal(failure), Mismatch::Unverified(_)),
        "every proof was late, so the spawn is unverified"
    );
    assert!(took < supervise::HANDSHAKE_TIMEOUT, "{took:?}");
    let requests = requests_after_proofs(&lab, 1 + RETRY_ATTEMPTS);
    let proofs: Vec<String> = requests
        .iter()
        .filter(|r| is_proof(r))
        .map(path_of)
        .collect();
    assert_eq!(proofs.len(), 1 + RETRY_ATTEMPTS, "{proofs:?}");
    assert!(
        !requests.iter().any(|r| path_of(r) == "/api/session"),
        "the token went out before a proof passed: {requests:?}"
    );
    assert!(!requests.iter().any(carries_a_secret), "{requests:?}");
    assert_every_fake_ended(&lab);
}

struct Recording(Arc<Recorder>);

impl Sink for Recording {
    fn ready(&self, port: u16, _session: &str) {
        self.0.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn gave_up(&self, _log: &Path) -> AfterStop {
        self.0.push("gave_up".into());
        AfterStop::Quit
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

fn set_mode(lab: &FakeLab, mode: &Value) {
    let file = lab
        .lab
        .join("terminal")
        .join("backend")
        .join("fake_mode.json");
    std::fs::write(file, mode.to_string()).expect("mode file");
}

fn spawned_pid(shared: &Shared) -> Option<u32> {
    match shared.current().as_deref() {
        Some(Backend::Spawned(s)) => Some(s.pid()),
        _ => None,
    }
}

#[test]
fn retry_after_a_spawn_refusal_starts_a_new_supervised_backend() {
    let watch = watch();
    let lab = fake_lab("proof-retry-respawn", &always_late());
    let shared = Shared::new(spec_for(&lab), expect_for(&lab)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let (loop_shared, loop_sink) = (shared.clone(), sink.clone());
    let first = std::thread::spawn(move || run::run(loop_shared, loop_sink));
    wait_until(Duration::from_secs(40), "the refused loop to end", || {
        first.is_finished()
    });
    assert_eq!(
        heard(&recorder),
        ["still_unverified"],
        "the unverified section, said in place"
    );
    assert!(
        shared.current().is_none(),
        "no backend is left after a refusal"
    );
    // The backend would now answer in time; the stopped page's Retry link is followed.
    set_mode(&lab, &json!({}));
    assert_eq!(shared.navigation_verdict(retry::RETRY_URI), Verdict::Gone);
    let (retry_shared, retry_sink) = (shared.clone(), sink.clone());
    let second = std::thread::spawn(move || run::retry_without_backend(retry_shared, retry_sink));
    wait_until(Duration::from_secs(30), "the new backend's page", || {
        heard(&recorder).iter().any(|c| c.starts_with("ready "))
    });
    let calls = heard(&recorder);
    assert_eq!(calls[..2], ["still_unverified", "checking"], "{calls:?}");
    let pid = spawned_pid(&shared).expect("a new spawned, checked backend");
    assert_eq!(
        records_in(&lab.lines()).len(),
        2,
        "one refused spawn, one new"
    );
    let requests = support::requests_in(&lab.lines(), pid);
    let session_at = requests.iter().position(|r| path_of(r) == "/api/session");
    let proof_at = requests.iter().position(is_proof);
    assert!(
        matches!((proof_at, session_at), (Some(p), Some(s)) if p < s),
        "the new backend was proved before its token went out: {requests:?}"
    );
    shared.stop();
    wait_until(Duration::from_secs(15), "the retried loop to end", || {
        second.is_finished()
    });
    let _ = second.join();
    drop(shared);
    watch.assert_clean();
}

#[test]
fn a_retry_while_the_loop_runs_never_starts_a_second_backend() {
    let lab = fake_lab("proof-retry-busy", &json!({}));
    let shared = Shared::new(spec_for(&lab), expect_for(&lab)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let (loop_shared, loop_sink) = (shared.clone(), sink.clone());
    let looping = std::thread::spawn(move || run::run(loop_shared, loop_sink));
    wait_until(Duration::from_secs(30), "the backend's page", || {
        heard(&recorder).iter().any(|c| c.starts_with("ready "))
    });
    let began = Instant::now();
    run::retry_without_backend(shared.clone(), sink.clone());
    assert!(
        began.elapsed() < Duration::from_secs(2),
        "a busy loop is not waited for"
    );
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(
        records_in(&lab.lines()).len(),
        1,
        "a second backend was started"
    );
    let calls = heard(&recorder);
    assert_eq!(
        calls[1..],
        ["checking"],
        "the running loop's page is kept: {calls:?}"
    );
    shared.stop();
    wait_until(Duration::from_secs(15), "the loop to end", || {
        looping.is_finished()
    });
    let _ = looping.join();
}
