//! A backend that ends while its spawn-time proof is being retried is an exit, not a refusal (V021 security review,
//! LOW). The retry's next proof then finds no listener, or a connection the ended backend never answered, and before
//! desktop 0.3.1 that was reported as the "listener" refusal (or the "swapped" one), which ends the supervision loop
//! as if a foreign process held the port. It is now reported as an exit, with the backend's exit code in the shell
//! log, and the loop restarts it as it does any crash. A wrong answer or a foreign owner is still refused at once
//! (tests/supervise_spawn_proof.rs), the proof keeps its fresh nonce and owner checks, and the token never goes out.
//!
//! Born failing: before 0.3.1 the first test got `Refused(Listener(None))` or `Refused(Proof(_))`, no
//! `supervise_exit_during_proof` event was logged, and the loop showed the refusal's section and stopped.
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
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;
use supervise::check::{self, BACKEND_MODULE, Expect, Failure, Mismatch, Spec};
use supervise::run::{self, AfterStop, EXIT_SETTLE, PROOF_MISMATCH, Shared, Sink};
use support::{FakeLab, Recorder, fake_lab, records_in, wait_until};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

/// The fake's own exit code when it ends during the retry (not the launcher's usual 0 or 1).
const EXIT_CODE: u64 = 7;

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

/// The first proof is late (so it is retried), and the fake ends the moment the retried proof arrives.
fn ends_at_the_retried_proof() -> Value {
    json!({ "proof_delay_s": 2.5, "proof_exit_on": 2, "proof_exit_code": EXIT_CODE })
}

/// The first proof is late (2 s link budget, then a 0.5 s pause), and the fake closes its listener when that proof
/// arrives and ends 3.5 s after it: the retried proof, about 2.5 s in, finds no listener while the process is still
/// ending, and the process ends well inside the shell's 3 s settle time (supervise_run.rs, `EXIT_SETTLE`).
fn port_gone_before_the_end() -> Value {
    json!({
        "proof_delay_s": 2.5,
        "proof_close_on": 1,
        "proof_exit_after_s": 3.5,
        "proof_exit_code": EXIT_CODE,
    })
}

fn requests(lab: &FakeLab) -> Vec<Value> {
    let lines = lab.lines();
    let tagged = lines.iter().filter_map(|l| l.strip_prefix("FAKE-REQUEST "));
    tagged
        .filter_map(|j| serde_json::from_str(j).ok())
        .collect()
}

fn path_of(request: &Value) -> &str {
    request["path"].as_str().unwrap_or("")
}

fn carries_a_secret(request: &Value) -> bool {
    let headers = request["headers"].as_object();
    headers.is_some_and(|h| h.keys().any(|k| k.eq_ignore_ascii_case("authorization")))
}

/// The `supervise_exit_during_proof` events logged for the fake with this port.
fn exits_during_proof(port: u64) -> Vec<Value> {
    crash::events()
        .into_iter()
        .filter(|(_, event, detail)| {
            event == "supervise_exit_during_proof" && detail["port"].as_u64() == Some(port)
        })
        .map(|(_, _, detail)| detail)
        .collect()
}

fn fake_ports(lab: &FakeLab) -> Vec<u64> {
    let records = records_in(&lab.lines());
    records.iter().filter_map(|r| r["port"].as_u64()).collect()
}

/// Spawns against `mode`, expects an exit, and checks the exit event, the proofs and that no secret went out.
fn assert_an_exit_with_its_code(name: &str, mode: &Value, proofs_expected: usize) {
    let lab = fake_lab(name, mode);
    let failure = supervise::spawn(&spec_for(&lab), &expect_for(&lab))
        .expect_err("a backend that ended is not used");
    assert!(
        matches!(failure, Failure::Exited),
        "an ended backend was reported as {failure:?}"
    );
    assert_eq!(failure.code(), "exited");
    wait_until(Duration::from_secs(10), "the fake's record", || {
        !fake_ports(&lab).is_empty()
    });
    let port = fake_ports(&lab)[0];
    let logged = exits_during_proof(port);
    assert_eq!(
        logged.len(),
        1,
        "one exit event for the ended fake: {logged:?}"
    );
    assert_eq!(logged[0]["code"].as_u64(), Some(EXIT_CODE), "{logged:?}");
    assert!(
        logged[0]["after"].is_string(),
        "the attempt's own reason is kept for the log: {logged:?}"
    );
    let seen = requests(&lab);
    let proofs = seen
        .iter()
        .filter(|r| path_of(r).starts_with("/api/desktop/proof?nonce="))
        .count();
    assert_eq!(proofs, proofs_expected, "{seen:?}");
    assert!(
        !seen.iter().any(|r| path_of(r) == "/api/session"),
        "the token went out to an unproven backend: {seen:?}"
    );
    assert!(!seen.iter().any(carries_a_secret), "{seen:?}");
}

#[test]
fn a_backend_whose_port_is_gone_during_the_proof_retry_is_an_exit_not_a_listener_refusal() {
    // The retried proof never reaches the fake: its listener is gone.
    assert_an_exit_with_its_code("proof-exit-port-gone", &port_gone_before_the_end(), 1);
}

#[test]
fn a_backend_that_ends_at_the_retried_proof_is_an_exit_with_its_code() {
    assert_an_exit_with_its_code("proof-exit-at-retry", &ends_at_the_retried_proof(), 2);
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
    fn still_unverified(&self) {
        self.0.push("still_unverified".into());
    }
}

#[test]
fn the_loop_treats_an_exit_during_the_proof_retry_as_a_crash_not_a_refusal() {
    let lab = fake_lab("proof-exit-loop", &port_gone_before_the_end());
    let shared = Shared::new(spec_for(&lab), expect_for(&lab)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let (loop_shared, loop_sink) = (shared.clone(), sink.clone());
    let looping = std::thread::spawn(move || run::run(loop_shared, loop_sink));
    // Three crashes within 60 s stop the restarts and ask Restart or Quit; this sink answers Quit.
    wait_until(Duration::from_secs(90), "the loop to give up", || {
        looping.is_finished()
    });
    let _ = looping.join();
    let calls: Vec<String> = recorder.calls().into_iter().map(|(_, c)| c).collect();
    assert_eq!(
        calls,
        [
            "stopped exited",
            "stopped exited",
            "stopped exited",
            "gave_up"
        ],
        "each ended backend was a crash and was restarted"
    );
    assert_eq!(records_in(&lab.lines()).len(), 3, "three backends started");
    assert!(shared.current().is_none());
}

// ---------------------------------------------------------------- which reasons an exit may replace

/// No console window for the short-lived process below.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The ended process's exit code.
const ENDED_CODE: u32 = 5;
/// The backend's own pids in these cases, and a pid that is not one of them.
const OWN: [u32; 2] = [4100, 4104];
const FOREIGN: u32 = 9999;
/// A wait can return up to one system timer tick early.
const TIMER_SLACK: Duration = Duration::from_millis(50);

/// A process that has ended with `ENDED_CODE`, kept open so its handle stays valid.
fn ended_process() -> std::process::Child {
    let mut child = std::process::Command::new("cmd.exe")
        .args(["/d", "/c", &format!("exit {ENDED_CODE}")])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("cmd.exe");
    let status = child.wait().expect("the short process ends");
    assert_eq!(status.code(), Some(ENDED_CODE as i32));
    child
}

fn handle_of(child: &std::process::Child) -> HANDLE {
    HANDLE(child.as_raw_handle())
}

#[test]
fn a_checked_answer_stays_a_refusal_even_when_the_backend_has_ended() {
    let mut child = ended_process();
    let ended = [handle_of(&child)];
    let checked = [
        Mismatch::Proof(PROOF_MISMATCH.into()),
        Mismatch::Listener(Some(FOREIGN)),
        Mismatch::PidOutsideJob(FOREIGN),
        Mismatch::Root("C:/elsewhere/lab".into()),
        Mismatch::Contract(99),
        Mismatch::Hmac,
    ];
    for m in checked {
        assert!(!run::unanswered(&m, &OWN), "{m:?}");
        let began = Instant::now();
        let failure = run::proof_failure(m.clone(), 1, &ended, &OWN);
        assert!(
            matches!(&failure, Failure::Refused(r) if *r == m),
            "the refusal {m:?} lost its reason: {failure:?}"
        );
        assert!(
            began.elapsed() < Duration::from_secs(1),
            "a checked answer waits for nothing"
        );
    }
    let _ = child.wait();
}

#[test]
fn an_unanswered_proof_from_an_ended_backend_is_an_exit_with_its_code() {
    let mut child = ended_process();
    let ended = [handle_of(&child)];
    assert_eq!(run::ended_code(&ended, Duration::ZERO), Some(ENDED_CODE));
    let unanswered = [
        Mismatch::Unverified("the backend did not answer in time".into()),
        Mismatch::Listener(None),
        Mismatch::Listener(Some(OWN[0])),
        Mismatch::PidOutsideJob(OWN[1]),
        Mismatch::Proof("bad answer: the connection closed".into()),
    ];
    for m in unanswered {
        assert!(run::unanswered(&m, &OWN), "{m:?}");
        let failure = run::proof_failure(m.clone(), 2, &ended, &OWN);
        assert!(matches!(failure, Failure::Exited), "{m:?}: {failure:?}");
    }
    let logged: Vec<Value> = crash::events()
        .into_iter()
        .filter(|(_, e, d)| e == "supervise_exit_during_proof" && d["port"] == 2)
        .map(|(_, _, d)| d)
        .collect();
    assert_eq!(logged.len(), 5, "{logged:?}");
    assert!(
        logged
            .iter()
            .all(|d| d["code"].as_u64() == Some(u64::from(ENDED_CODE))),
        "{logged:?}"
    );
    let _ = child.wait();
}

#[test]
fn a_live_backend_without_a_listener_is_still_refused_after_the_settle_time() {
    let access = PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION;
    // SAFETY: opens this running test process for waiting only; the handle is closed below.
    let me = unsafe { OpenProcess(access, false, std::process::id()) }.expect("this process");
    let live = [me];
    let began = Instant::now();
    let failure = run::proof_failure(Mismatch::Listener(None), 3, &live, &OWN);
    assert!(
        matches!(failure, Failure::Refused(Mismatch::Listener(None))),
        "{failure:?}"
    );
    assert!(
        began.elapsed() + TIMER_SLACK >= EXIT_SETTLE,
        "the refusal came before the settle time"
    );
    assert_eq!(run::ended_code(&live, Duration::ZERO), None);
    // SAFETY: the handle opened above, closed once.
    let _ = unsafe { CloseHandle(me) };
}
