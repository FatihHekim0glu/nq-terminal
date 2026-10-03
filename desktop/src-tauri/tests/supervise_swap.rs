//! 05 G08, the backend swapped on the same port after the handshake: the child-exit watch sees the checked backend
//! end at once and sends the window to the stopped page; the next navigation to that port is refused; and the
//! impostor never receives the token (it logs every header it gets), because no request reaches a listener that
//! fails the ownership check.
//!
//! Born failing: `a_check_without_ownership_reaches_the_impostor` shows what the impostor would receive from a client
//! that connected first and checked later; the real checks never connect to it.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: fake labs, fake backends and the impostor this test starts"
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
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use supervise::run::{self, AfterStop, Backend, Shared, Sink, Verdict};
use support::{
    Collector, FakeLab, Recorder, Tracked, fake_lab, records_in, requests_in, start_swapped,
    wait_until, watch,
};

const WATCH_BUDGET: Duration = Duration::from_secs(1);

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
}

fn spec_for(lab: &FakeLab) -> Spec {
    let state_dir = lab.state.clone();
    Spec {
        lab: lab.lab.clone(),
        state_dir,
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    }
}

/// The impostor: its process, what it prints, and the pid that listens (the venv launcher's child, not `Child::id`).
struct Impostor {
    child: std::process::Child,
    output: Collector,
    pid: u32,
}

/// Starts the impostor on `port` once the checked backend has let it go.
fn impostor(lab: &FakeLab, port: u16) -> Impostor {
    let (child, output) = start_swapped(lab, port);
    let mut pid = None;
    wait_until(Duration::from_secs(20), "the impostor to listen", || {
        let records = records_in(&output.lines());
        pid = records
            .iter()
            .find(|v| v["swapped"] == true)
            .and_then(|v| v["pid"].as_u64())
            .map(|p| p as u32);
        pid.is_some() && link::listener_owner(port).ok() == pid
    });
    Impostor {
        child,
        output,
        pid: pid.expect("the impostor's pid"),
    }
}

impl Impostor {
    /// Every request it received, and whether any of it carries the token or an Authorization header.
    fn leaked(&self, token: &str) -> (Vec<Value>, bool) {
        std::thread::sleep(Duration::from_millis(300)); // what it printed reaches the collector
        let requests = requests_in(&self.output.lines(), self.pid);
        let text = serde_json::to_string(&requests).unwrap_or_default();
        let leak = text.contains(token) || text.to_ascii_lowercase().contains("authorization");
        (requests, leak)
    }

    fn end(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The loop over an honest fake, once its first backend is checked: the shared state, the sink's record and the loop.
fn loop_on(
    lab: &FakeLab,
    expect: &Expect,
) -> (Arc<Shared>, Arc<Recorder>, std::thread::JoinHandle<()>) {
    let shared = Shared::new(spec_for(lab), expect.clone()).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let loop_shared = shared.clone();
    let looping = std::thread::spawn(move || run::run(loop_shared, sink));
    wait_until(Duration::from_secs(20), "the first backend", || {
        shared.current().is_some()
    });
    (shared, recorder, looping)
}

/// Every way the old window could reach the port after the swap: none may pass, and none may reach the impostor.
fn assert_refused_after_the_swap(
    shared: &Shared,
    checked: &Backend,
    expect: &Expect,
    swapped_pid: u32,
) {
    let port = checked.port();
    let origin = format!("http://127.0.0.1:{port}/");
    let verdict = shared.navigation_verdict(&origin);
    assert!(
        matches!(verdict, Verdict::Refuse(_) | Verdict::Cancel),
        "the next navigation to the old port was not blocked (Refuse once the proof fails, Cancel once the exit watch has cleared the ended backend; never Allow and never Retry): {verdict:?}"
    );
    assert!(
        run::verify_now(checked, expect).is_err(),
        "the window's backend still passed after the swap"
    );
    let owner_ok = |pid| checked.owner_ok(pid);
    let proof = link::proof(
        port,
        &link::fresh_secret(),
        &owner_ok,
        Duration::from_secs(2),
    );
    assert_eq!(
        proof.unwrap_err(),
        link::LinkError::NotOwned {
            port,
            owner: Some(swapped_pid)
        }
    );
    let Backend::Spawned(first) = checked else {
        panic!("expected a spawned backend")
    };
    let session = link::session(port, first.token(), &owner_ok, Duration::from_secs(2));
    assert!(
        matches!(session, Err(link::LinkError::NotOwned { .. })),
        "{session:?}"
    );
}

#[test]
fn a_swapped_backend_is_seen_by_the_exit_watch_refused_and_never_given_the_token() {
    let watch = watch();
    let lab = fake_lab("swap", &json!({}));
    let expect = Expect::for_lab(&lab.lab, check::CONTRACT_RANGE);
    let (shared, recorder, looping) = loop_on(&lab, &expect);
    let checked = shared.current().expect("the checked backend");
    let Backend::Spawned(first) = checked.as_ref() else {
        panic!("expected a spawned backend")
    };
    let (port, token, origin) = (
        first.port(),
        first.token().to_string(),
        format!("http://127.0.0.1:{}/", first.port()),
    );
    assert_eq!(
        shared.navigation_verdict(&origin),
        Verdict::Allow,
        "the checked backend passes the check"
    );
    let killed = Instant::now();
    Tracked::open(first.pid()).expect("the interpreter").end();
    let exited = || recorder.calls().iter().any(|(_, c)| c == "stopped exited");
    wait_until(WATCH_BUDGET, "the exit watch", exited);
    let seen_after = killed.elapsed();
    let swapped = impostor(&lab, port);
    assert_refused_after_the_swap(&shared, &checked, &expect, swapped.pid);
    let (requests, leak) = swapped.leaked(&token);
    shared.stop();
    looping.join().expect("the loop ends on stop");
    swapped.end();
    assert!(
        seen_after < WATCH_BUDGET,
        "the exit was seen after {seen_after:?}"
    );
    assert!(
        requests.is_empty() && !leak,
        "the impostor was reached: {requests:?}"
    );
    watch.assert_clean();
}

#[test]
fn a_check_without_ownership_reaches_the_impostor() {
    let lab = fake_lab("swap-naive", &json!({}));
    let spawned = supervise::spawn(
        &spec_for(&lab),
        &Expect::for_lab(&lab.lab, check::CONTRACT_RANGE),
    )
    .expect("spawned");
    let port = spawned.port();
    Tracked::open(spawned.pid()).expect("the interpreter").end();
    let swapped = impostor(&lab, port);
    let naive = link::proof(
        port,
        &link::fresh_secret(),
        &|_| true,
        Duration::from_secs(2),
    );
    let (requests, _) = swapped.leaked(spawned.token());
    swapped.end();
    assert!(
        naive.is_ok(),
        "the impostor answers a client that does not check who listens: {naive:?}"
    );
    assert_eq!(
        requests.len(),
        1,
        "born failing: without the ownership check the impostor gets the request"
    );
}
