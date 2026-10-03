//! Attach mode (03 sections 2.1 to 2.3; 04 D4.3): a backend that holds the lab's lock (held open, owner-only DACL, as
//! backend desktop/lock.py makes it) is attached to after the listener-ownership check and a fresh-nonce proof, the
//! loop serves it without spawning anything, and stopping the loop never stops it. A stale lock, or a lock whose
//! backend fails the proof, is not attached to.
//!
//! The live backend is the fake, started by this test itself (hidden) with TOKEN and NONCE on its stdin, so the
//! attached backend is one the shell did not start. Born failing: against the stage A stub nothing was attached.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it starts the live backend the shell attaches to and ends it afterwards"
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
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use supervise::run::{self, AfterStop, Backend, Shared, Sink};
use support::{
    CREATE_NO_WINDOW, Collector, FakeLab, Recorder, Tracked, fake_lab, hold_lock, records_in,
    wait_until, watch,
};

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

/// The live backend: the fake started by this test, with the lock the backend would hold (owner-only DACL, held open
/// sharing read only) naming its pid, port and token; its stdin stays open while the Child lives.
struct Live {
    child: Child,
    record: Value,
    _lock: std::fs::File,
}

fn live_backend(lab: &FakeLab) -> Live {
    let spec = spec_for(lab);
    let mut child = Command::new(spec.python())
        .args(check::SPAWN_ARGS)
        .arg(BACKEND_MODULE)
        .current_dir(spec.backend_dir())
        .env("NQT_PORT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("start the live backend");
    let output = Collector::of(&mut child);
    let token = link::fresh_secret();
    let secrets = format!("TOKEN {token}\nNONCE {}\n", link::fresh_secret());
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(secrets.as_bytes())
        .expect("secrets");
    wait_until(Duration::from_secs(20), "the record", || {
        !records_in(&output.lines()).is_empty()
    });
    let record = records_in(&output.lines()).remove(0);
    let lock = json!({ "v": 1, "pid": record["pid"], "port": record["port"], "token": token,
        "root": lab.lab, "started": "2026-10-03T00:00:00.000Z" });
    Live {
        child,
        record,
        _lock: hold_lock(&lab.state, &lock),
    }
}

fn spawned_events() -> usize {
    crash::events()
        .iter()
        .filter(|(_, e, _)| e == "supervise_spawned")
        .count()
}

#[test]
fn a_live_lock_is_attached_served_and_never_stopped() {
    let watch = watch();
    let lab = fake_lab("attach-live", &json!({}));
    let Live {
        mut child,
        record,
        _lock,
    } = live_backend(&lab);
    let (pid, port) = (
        record["pid"].as_u64().expect("pid") as u32,
        record["port"].as_u64().expect("port") as u16,
    );
    let spawns_before = spawned_events();
    let expect = Expect::for_lab(&lab.lab, check::CONTRACT_RANGE);
    let attached = run::try_attach(&spec_for(&lab), &expect).expect("the live lock is attached");
    assert_eq!((attached.pid(), attached.port()), (pid, port));
    drop(attached);
    let shared = Shared::new(spec_for(&lab), expect).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let loop_shared = shared.clone();
    let looping = std::thread::spawn(move || run::run(loop_shared, sink));
    wait_until(Duration::from_secs(10), "the loop to attach", || {
        !recorder.calls().is_empty()
    });
    assert!(matches!(shared.current().as_deref(), Some(Backend::Attached(a)) if a.port() == port));
    assert_eq!(recorder.calls()[0].1, format!("ready {port}"));
    shared.stop();
    looping.join().expect("the loop ends on stop");
    assert_eq!(
        spawned_events(),
        spawns_before,
        "attach mode spawned a backend"
    );
    let backend = Tracked::open(pid).expect("the attached backend");
    let stopped = backend.ended_within(Duration::from_secs(supervise::STOP_GRACE_S + 1));
    let _ = child.kill();
    let _ = child.wait();
    assert!(!stopped, "the shell stopped a backend it did not spawn");
    watch.assert_clean();
}

#[test]
fn a_lock_whose_backend_fails_the_proof_is_not_attached() {
    let lab = fake_lab("attach-root", &json!({ "lie": "root" }));
    let Live {
        mut child,
        record,
        _lock,
    } = live_backend(&lab);
    let expect = Expect::for_lab(&lab.lab, check::CONTRACT_RANGE);
    let attached = run::try_attach(&spec_for(&lab), &expect);
    let pid = record["pid"].as_u64().expect("pid") as u32;
    let alive = Tracked::open(pid).is_some_and(|t| !t.ended_within(Duration::from_millis(500)));
    let _ = child.kill();
    let _ = child.wait();
    assert!(
        attached.is_none(),
        "a backend serving another lab was attached"
    );
    assert!(
        alive,
        "a refused attach must leave the other backend running"
    );
}

#[test]
fn a_stale_lock_is_not_attached() {
    let lab = fake_lab("attach-stale", &json!({}));
    let mut ended = Command::new("cmd")
        .args(["/d", "/c", "exit"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("cmd");
    let dead_pid = ended.id();
    ended.wait().expect("ended");
    let lock = json!({ "v": 1, "pid": dead_pid, "port": 1, "token": "00".repeat(32), "root": lab.lab, "started": "x" });
    std::fs::write(lab.state.join("backend.lock"), lock.to_string()).expect("plant the stale lock");
    let expect = Expect::for_lab(&lab.lab, check::CONTRACT_RANGE);
    assert!(
        run::try_attach(&spec_for(&lab), &expect).is_none(),
        "a stale lock was attached"
    );
    std::fs::write(lab.state.join("backend.lock"), "not json").expect("plant a broken lock");
    assert!(
        run::try_attach(&spec_for(&lab), &expect).is_none(),
        "a broken lock was attached"
    );
}
