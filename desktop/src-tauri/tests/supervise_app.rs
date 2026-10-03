//! The whole chain in the real smoke exe (04 D4.3 and the D4 launch check): `--fixture` over a fake lab spawns the
//! fixture entry through the job, checks its handshake, sets the session cookie into the hidden webview, passes the
//! navigation check, and loads the backend's page, which then reaches /api with the cookie; when the shell dies, the
//! Job Object ends the backend within 5 s. The global window watch runs throughout (the window is never shown), and
//! the exe runs with the launch prelude's PATH (no build tools).
//!
//! Born failing: against the stage A stub, `--fixture` was refused at setup (NotReady), so no backend, no cookie.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it starts the smoke exe it owns over a fake lab, and ends it"
)]

#[path = "supervise_support.rs"]
mod support;

use serde_json::{Value, json};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use support::{
    CREATE_NO_WINDOW, FakeLab, Tracked, backend_log_lines, fake_lab, records_in, requests_in, watch,
};

const DEATH_LIMIT: Duration = Duration::from_secs(5);

/// The launch prelude's PATH: no build tools.
fn clean_path() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    let keep = |p: &&str| {
        let lower = p.to_ascii_lowercase();
        !lower.starts_with(r"d:\dev\mingw") && !lower.starts_with(r"d:\dev\cargo")
    };
    path.split(';').filter(keep).collect::<Vec<_>>().join(";")
}

fn launch(lab: &FakeLab) -> std::process::Child {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    cmd.arg("--fixture")
        .arg("--lab")
        .arg(&lab.lab)
        .arg("--webview-data-dir")
        .arg(lab.run.join("wv"))
        .arg("--config-dir")
        .arg(lab.run.join("config"))
        .env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
        {
            cmd.env_remove(name);
        }
    }
    cmd.spawn().expect("start the smoke exe")
}

/// The fixture backend's state folder under the config folder (`fixture-state-<shell pid>`).
fn fixture_state(lab: &FakeLab, shell_pid: u32) -> PathBuf {
    lab.run
        .join("config")
        .join(format!("fixture-state-{shell_pid}"))
}

fn json_lines(path: &Path) -> Vec<Value> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    text.lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// The fixture backend's record (how it was started), from what the shell drained into its backend.log.
fn backend_record(state: &Path) -> Value {
    records_in(&backend_log_lines(state))
        .into_iter()
        .next()
        .unwrap_or_default()
}

/// Every request the fixture backend reported, from its backend.log.
fn all_requests(state: &Path) -> Vec<Value> {
    let lines = backend_log_lines(state);
    let pid = records_in(&lines)
        .first()
        .and_then(|r| r["pid"].as_u64())
        .unwrap_or(0) as u32;
    requests_in(&lines, pid)
}

/// The requests that carried the session cookie to /api/health.
fn cookie_requests(state: &Path) -> Vec<Value> {
    let carries = |r: &Value| {
        let headers = r["headers"].as_object();
        let cookie = headers.and_then(|h| h.iter().find(|(k, _)| k.eq_ignore_ascii_case("cookie")));
        let cookie = cookie.and_then(|(_, v)| v.as_str());
        r["path"] == "/api/health" && cookie.is_some_and(|c| c.contains("nqt_s_"))
    };
    all_requests(state).into_iter().filter(carries).collect()
}

/// Waits until the webview sends the cookie to /api/health (true), the shell exits, or 60 s pass.
fn wait_for_cookie(shell: &mut std::process::Child, state: &Path) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if !cookie_requests(state).is_empty() {
            return true;
        }
        if let Ok(Some(_)) = shell.try_wait() {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn proofs_sent(state: &Path) -> usize {
    let is_proof = |r: &&Value| {
        r["path"]
            .as_str()
            .is_some_and(|p| p.starts_with("/api/desktop/proof"))
    };
    all_requests(state).iter().filter(is_proof).count()
}

#[test]
fn the_smoke_exe_spawns_checks_sets_the_cookie_and_its_death_ends_the_backend() {
    let watch = watch();
    let lab = fake_lab("app", &json!({}));
    let mut shell = launch(&lab);
    let state = fixture_state(&lab, shell.id());
    let reached = wait_for_cookie(&mut shell, &state);
    let record = backend_record(&state);
    let backend = record["pid"].as_u64().and_then(|p| Tracked::open(p as u32));
    let shell_log = json_lines(&lab.run.join("config").join("logs").join("shell.log"));
    let proofs = proofs_sent(&state);
    let _ = shell.kill();
    let died = Instant::now();
    let _ = shell.wait();
    let ended = backend
        .as_ref()
        .map(|b| b.ended_within(DEATH_LIMIT.saturating_sub(died.elapsed())));
    if let Some(b) = &backend {
        b.end();
    }
    assert!(
        reached,
        "the webview never sent the session cookie to /api/health; shell log: {shell_log:#?}"
    );
    assert_eq!(
        record["nqt"]["NQT_JOBS"], "off",
        "a fixture backend runs with jobs off: {record}"
    );
    let state_dir = record["nqt"]["NQT_STATE_DIR"].as_str();
    assert!(
        state_dir.is_some_and(|s| s.contains("fixture-state-")),
        "{record}"
    );
    assert!(
        proofs >= 2,
        "the navigation check sent no proof of its own ({proofs} proofs)"
    );
    let ready = shell_log.iter().any(|e| e["event"] == "supervise_ready");
    assert!(ready, "{shell_log:#?}");
    assert_eq!(ended, Some(true), "the backend outlived the shell by 5 s");
    watch.assert_clean();
}
