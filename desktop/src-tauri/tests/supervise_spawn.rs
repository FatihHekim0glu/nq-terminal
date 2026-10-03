//! The spawn and its checks (03 sections 2.2, 7.1 and 8; 04 D4.3): the exact spawn line from `terminal/backend`, the
//! allow-listed environment, no window, the real interpreter's pid (the venv launcher's child) accepted and a pid
//! outside the job refused, each of the HMAC, ROOT, prefix, contract, page build and listener mismatches refused
//! with its own message, a refused backend's tree ended, and the proof sent with no Authorization header.
//!
//! Every backend here is tests/fixtures/fake_backend.py in a fake lab under D:\dev\tmp\w4b-supervise, run by the
//! nq-lab venv's python.exe through the fake lab's `.venv` junction; the global window watch runs throughout.
//! Born failing: against the stage A stub (`start` returned Idle, nothing was spawned) every test here fails.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: fake labs, fake backends and a loopback listener this test owns"
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
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use supervise::check::{self, BACKEND_MODULE, Expect, Failure, Mismatch, Spec};
use supervise::run::{self, AfterStop, Shared, Sink};
use support::{FakeLab, Recorder, Tracked, fake_lab, records_in, wait_until, watch};

fn spec_for(lab: &FakeLab) -> Spec {
    let state_dir = lab.state.clone();
    Spec {
        lab: lab.lab.clone(),
        state_dir,
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    }
}

fn expect_for(lab: &FakeLab) -> Expect {
    Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)
}

/// The pids of every fake this lab started (from their records).
fn fake_pids(lab: &FakeLab) -> Vec<u32> {
    // The reader hands the handshake over before it appends that chunk, so the record may land a moment later; a
    // fake that only prints NQT-ATTACH has none.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut records = records_in(&lab.lines());
    while records.is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
        records = records_in(&lab.lines());
    }
    records
        .iter()
        .filter_map(|v| v["pid"].as_u64())
        .map(|p| p as u32)
        .collect()
}

/// The interpreter's switches and module, exactly (03 section 7.1).
const SPAWN_LINE: [&str; 8] = [
    "-E",
    "-s",
    "-X",
    "utf8",
    "-X",
    "faulthandler",
    "-m",
    "nq_terminal",
];
/// Names the backend may see: the allow list, plus the venv launcher's own marker for the base interpreter.
const SET_BY_THE_SHELL: [&str; 5] = [
    "PYTHONUTF8",
    "PYTHONIOENCODING",
    "NQT_DESKTOP",
    "NQT_PORT",
    "__PYVENV_LAUNCHER__",
];
/// Secret-shaped, interpreter, engine, fixture and broker names the parent holds and the backend must never see.
const CANARIES: [(&str, &str); 9] = [
    ("QUANTPAD_API_KEY", "canary-key"),
    ("TYPESAFE_API_KEY", "canary-key"),
    ("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--canary"),
    ("PYTHONPATH", r"C:\canary"),
    ("PYTHONSTARTUP", "canary.py"),
    ("NQT_FIXTURE_DIR", r"C:\canary"),
    ("NQT_JOBS", "on"),
    ("IB_HOST", "canary"),
    ("COVERAGE_PROCESS_START", "x"),
];

/// Names in a fake's record that the allow list does not hold.
fn stray_names(record: &Value) -> Vec<String> {
    let base = check::BASE_ENV.iter().chain(check::PASSED_NQT.iter());
    let allowed: HashSet<&str> = base.chain(SET_BY_THE_SHELL.iter()).copied().collect();
    let names: Vec<String> = serde_json::from_value(record["env_names"].clone()).expect("names");
    names
        .into_iter()
        .filter(|n| !allowed.contains(n.to_uppercase().as_str()))
        .collect()
}

#[test]
fn the_spawn_line_is_exact_the_environment_allow_listed_and_no_window_appears() {
    let watch = watch();
    let lab = fake_lab("spawn-line", &json!({}));
    let spawned =
        supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect("the honest fake is accepted");
    let record = lab.record(spawned.pid());
    let argv: Vec<String> = serde_json::from_value(record["orig_argv"].clone()).expect("argv");
    assert_eq!(argv[1..], SPAWN_LINE);
    let cwd = check::normalise(record["cwd"].as_str().expect("cwd"));
    assert_eq!(
        cwd,
        check::normalise(&lab.lab.join("terminal").join("backend").to_string_lossy())
    );
    let stray = stray_names(&record);
    assert!(
        stray.is_empty(),
        "names outside the allow list reached the backend: {stray:?}"
    );
    assert_eq!(
        record["nqt"],
        json!({ "NQT_DESKTOP": "1", "NQT_PORT": "0" })
    );
    drop(spawned);
    watch.assert_clean();
}

fn canary_parent() -> Vec<(OsString, OsString)> {
    let base = [
        ("Path", r"C:\Windows;C:\tools"),
        ("SystemRoot", r"C:\Windows"),
        ("NQT_PORT", "8765"),
        ("NQT_CACHE_BYTES", "1000"),
        ("TEMP", r"D:\dev\tmp"),
    ];
    let all = base.iter().chain(CANARIES.iter());
    all.map(|(n, v)| (OsString::from(n), OsString::from(v)))
        .collect()
}

#[test]
fn the_environment_is_built_from_nothing() {
    let lab = std::path::PathBuf::from(r"D:\dev\tmp\w4b-supervise\env\lab");
    let spec = Spec {
        lab: lab.clone(),
        state_dir: lab.join("s"),
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    };
    let env = check::backend_env(canary_parent(), &spec);
    let get = |name: &str| {
        env.iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.to_string_lossy().into_owned())
    };
    let path = get("PATH").expect("PATH");
    assert!(
        path.starts_with(&format!(r"{}\.venv\Scripts;", lab.display())),
        "{path}"
    );
    assert_eq!(
        get("NQT_PORT").as_deref(),
        Some("0"),
        "the shell's own NQT_PORT wins over the parent's"
    );
    assert_eq!(get("NQT_CACHE_BYTES").as_deref(), Some("1000"));
    assert_eq!(get("SYSTEMROOT").as_deref(), Some(r"C:\Windows"));
    for (canary, _) in CANARIES {
        assert_eq!(get(canary), None, "{canary} reached the backend");
    }
    let names: Vec<&String> = env.iter().map(|(n, _)| n).collect();
    assert!(
        names.windows(2).all(|w| w[0] < w[1]),
        "sorted and unique: {names:?}"
    );
}

#[test]
fn the_real_interpreter_pid_is_accepted_not_the_launcher() {
    let lab = fake_lab("pid-real", &json!({}));
    let spawned = supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect("accepted");
    let record = lab.record(spawned.pid());
    assert_eq!(record["pid"].as_u64(), Some(u64::from(spawned.pid())));
    assert_ne!(
        spawned.pid(),
        spawned.launcher_pid(),
        "the venv launcher starts the real interpreter as a child"
    );
    assert_eq!(
        record["ppid"].as_u64(),
        Some(u64::from(spawned.launcher_pid()))
    );
    let in_job = spawned.job_pids();
    assert!(
        in_job.contains(&spawned.pid()) && in_job.contains(&spawned.launcher_pid()),
        "{in_job:?}"
    );
}

/// Spawns a fake that tells the given lie and returns the refusal; the refused fake's tree must end.
fn refused(name: &str, mode: Value) -> Mismatch {
    let lab = fake_lab(name, &mode);
    let failure =
        supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect_err("the lie is refused");
    for pid in fake_pids(&lab) {
        if let Some(process) = Tracked::open(pid) {
            assert!(
                process.ended_within(Duration::from_secs(5)),
                "the refused fake {pid} is still running"
            );
        }
    }
    match failure {
        Failure::Refused(m) => m,
        other => panic!("{name}: expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_wrong_ready_hmac_is_refused() {
    let m = refused("lie-hmac", json!({ "lie": "hmac" }));
    assert_eq!((m.code(), m.clone()), ("hmac", Mismatch::Hmac));
    assert!(m.message().contains("proof"), "{}", m.message());
}

#[test]
fn another_root_is_refused() {
    let m = refused("lie-root", json!({ "lie": "root" }));
    assert_eq!(m, Mismatch::Root(r"C:\elsewhere\lab".into()));
    assert!(m.message().contains("another lab"), "{}", m.message());
}

#[test]
fn another_prefix_is_refused() {
    let m = refused("lie-prefix", json!({ "lie": "prefix" }));
    assert_eq!(m, Mismatch::Prefix(r"C:\elsewhere\.venv".into()));
    assert!(
        m.message().contains("another environment"),
        "{}",
        m.message()
    );
}

#[test]
fn a_contract_out_of_range_is_refused() {
    let m = refused("lie-contract", json!({ "lie": "contract" }));
    assert_eq!(m, Mismatch::Contract(99));
    assert!(m.message().contains("out of step"), "{}", m.message());
}

#[test]
fn a_stale_page_build_is_refused() {
    let m = refused("lie-dist", json!({ "lie": "dist" }));
    assert_eq!(m, Mismatch::Dist("stale".into()));
}

#[test]
fn a_pid_outside_the_job_is_refused() {
    let me = std::process::id();
    let m = refused(
        "lie-pid",
        json!({ "lie": "pid_outside", "outside_pid": me }),
    );
    assert_eq!(m, Mismatch::PidOutsideJob(me));
    assert!(
        m.message().contains("not one this app started"),
        "{}",
        m.message()
    );
}

#[test]
fn a_port_another_process_listens_on_is_refused() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a spare loopback port");
    let port = listener.local_addr().expect("address").port();
    let m = refused(
        "lie-listener",
        json!({ "lie": "listener", "report_port": port }),
    );
    assert_eq!(m, Mismatch::Listener(Some(std::process::id())));
}

#[test]
fn an_attach_notice_is_refused_as_a_held_lock() {
    let m = refused("lie-attach", json!({ "attach_line": true }));
    assert_eq!(m, Mismatch::LockHeld);
}

#[test]
fn a_backend_that_ends_with_the_untrusted_lock_code_is_refused_at_once() {
    let lab = fake_lab("lie-untrusted", &json!({ "exit_before_handshake": 4 }));
    let failure = supervise::spawn(&spec_for(&lab), &expect_for(&lab))
        .expect_err("an untrusted lock is never attached to");
    assert_eq!(failure, Failure::Refused(Mismatch::LockUntrusted));
    assert_eq!(failure.code(), "lock-untrusted");
    assert!(
        Mismatch::LockUntrusted.message().contains("backend.lock"),
        "{}",
        Mismatch::LockUntrusted.message()
    );
}

#[test]
fn any_other_exit_before_the_handshake_is_still_an_exit() {
    for code in [1, 2, 3] {
        let lab = fake_lab("early-exit", &json!({ "exit_before_handshake": code }));
        let failure = supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect_err("it ended");
        assert_eq!(failure, Failure::Exited, "exit code {code}");
    }
}

struct Recording(Arc<Recorder>);

impl Sink for Recording {
    fn ready(&self, port: u16, _session: &str) {
        self.0.push(format!("ready {port}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn gave_up(&self, log: &Path) -> AfterStop {
        self.0.push(format!("gave_up {}", log.display()));
        AfterStop::Quit
    }
}

/// An untrusted lock ends the backend with its own exit code before any handshake: the loop spawns once, shows the
/// page for it, and never restarts or asks Restart or Quit (it used to spawn three times and then ask).
#[test]
fn an_untrusted_lock_is_one_spawn_and_its_own_page_never_a_restart() {
    let watch = watch();
    let lab = fake_lab("loop-untrusted", &json!({ "exit_before_handshake": 4 }));
    let shared = Shared::new(spec_for(&lab), expect_for(&lab)).expect("shared");
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn Sink> = Arc::new(Recording(recorder.clone()));
    let looping = std::thread::spawn(move || run::run(shared, sink));
    wait_until(Duration::from_secs(10), "the loop to end", || {
        looping.is_finished()
    });
    std::thread::sleep(Duration::from_millis(2500));
    let calls: Vec<String> = recorder.calls().into_iter().map(|(_, c)| c).collect();
    assert_eq!(calls, ["stopped lock-untrusted"]);
    let ended = |line: &&String| line.contains("ending before any handshake");
    let spawns = lab.lines().iter().filter(ended).count();
    assert_eq!(spawns, 1, "one spawn only");
    watch.assert_clean();
}

#[test]
fn every_refusal_has_its_own_message_and_page_section() {
    let all = [
        Mismatch::Malformed("x".into()),
        Mismatch::LockHeld,
        Mismatch::LockUntrusted,
        Mismatch::Hmac,
        Mismatch::PidOutsideJob(1),
        Mismatch::Listener(None),
        Mismatch::Root("r".into()),
        Mismatch::Prefix("p".into()),
        Mismatch::Contract(9),
        Mismatch::Dist("stale".into()),
        Mismatch::Proof("p".into()),
        Mismatch::Unverified("u".into()),
    ];
    let codes: HashSet<&str> = all.iter().map(Mismatch::code).collect();
    let messages: HashSet<String> = all.iter().map(Mismatch::message).collect();
    assert_eq!((codes.len(), messages.len()), (all.len(), all.len()));
    let page = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/stopped.html"))
        .expect("page");
    for code in codes.iter().chain(["exited", "spawn", "renderer"].iter()) {
        assert!(
            page.contains(&format!("id=\"{code}\"")),
            "stopped.html has no section #{code}"
        );
    }
    // The heading is shared by every section, so it must not name the backend (a renderer failure is not one).
    assert!(
        !page.contains("backend is not running") && !page.contains("backend stopped</title>"),
        "the shared heading or title blames the backend"
    );
}

/// A request's header by name (case-insensitive), from the fake's header log.
fn header(request: &Value, name: &str) -> Option<String> {
    let headers = request["headers"].as_object()?;
    let found = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name));
    found.and_then(|(_, v)| v.as_str().map(str::to_string))
}

fn path_of(request: &Value) -> String {
    request["path"].as_str().unwrap_or("").to_string()
}

/// The fake's requests, once the session request (the last of the spawn) has been drained into backend.log.
fn requests_through_the_session(lab: &FakeLab, pid: u32) -> Vec<Value> {
    let has_session = || {
        lab.requests(pid)
            .iter()
            .any(|r| path_of(r) == "/api/session")
    };
    wait_until(
        Duration::from_secs(5),
        "the session request in backend.log",
        has_session,
    );
    lab.requests(pid)
}

#[test]
fn the_proof_carries_no_authorization_and_the_session_carries_the_token() {
    let lab = fake_lab("proof-headers", &json!({}));
    let spawned = supervise::spawn(&spec_for(&lab), &expect_for(&lab)).expect("accepted");
    let requests = requests_through_the_session(&lab, spawned.pid());
    let is_proof = |r: &&Value| path_of(r).starts_with("/api/desktop/proof?nonce=");
    let proofs: Vec<&Value> = requests.iter().filter(is_proof).collect();
    assert!(!proofs.is_empty(), "no proof request: {requests:?}");
    for proof in &proofs {
        assert_eq!(
            header(proof, "authorization"),
            None,
            "the proof call carried a secret: {proof}"
        );
        assert!(
            !proof.to_string().contains(spawned.token()),
            "the token went out with the proof"
        );
    }
    let session = requests
        .iter()
        .find(|r| path_of(r) == "/api/session")
        .expect("a session request");
    assert_eq!(
        header(session, "authorization"),
        Some(format!("NQT {}", spawned.token()))
    );
    let origin = format!("http://127.0.0.1:{}", spawned.port());
    assert_eq!(header(session, "x-nqt-origin"), Some(origin));
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
        "the session cookie opens /api"
    );
}

#[test]
fn a_lab_without_the_venv_interpreter_is_a_spawn_failure() {
    let run =
        std::path::PathBuf::from(support::RUN_ROOT).join(format!("no-venv-{}", std::process::id()));
    let spec = Spec {
        lab: run.join("lab"),
        state_dir: run.join("state"),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let failure =
        supervise::spawn(&spec, &Expect::for_lab(&spec.lab, (1, 1))).expect_err("refused");
    assert!(
        matches!(failure, Failure::Spawn(ref why) if why.contains("python.exe")),
        "{failure:?}"
    );
}
