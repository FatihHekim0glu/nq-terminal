//! The noisy child (05 T08; 03 section 17): a backend that prints 10 MB before its NQT-READY line and 10 MB after it,
//! and logs every request on stdout, still answers /api/health within 1 s, because the reader thread drains its output
//! into backend.log (rotated at 5 MB, 5 kept) from the first byte; and the handshake is the FIRST `NQT-` line only, so
//! a later line that looks like one changes nothing.
//!
//! Born failing: a shell that stops reading after the handshake leaves the pipe full, the fake's access-log print
//! blocks, and /api/health hangs past 1 s; a scanner that keeps the last `NQT-` line takes the fake port 1.
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
use std::time::{Duration, Instant};
use supervise::FirstNqt;
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use support::{fake_lab, wait_until, watch};

const TEN_MB: u64 = 10 * 1024 * 1024;
const HEALTH_BUDGET: Duration = Duration::from_secs(1);
const LATE_LINE: &str = "NQT-READY {\"v\":1,\"port\":1,";

#[test]
fn only_the_first_nqt_line_is_the_handshake() {
    let mut scan = FirstNqt::default();
    assert_eq!(scan.feed(b"noise\nNQT-RE"), None);
    assert_eq!(
        scan.feed(b"ADY {\"port\":2}\r\nNQT-READY {\"port\":1}\n")
            .as_deref(),
        Some("NQT-READY {\"port\":2}")
    );
    assert_eq!(
        scan.feed(b"NQT-READY {\"port\":3}\n"),
        None,
        "a later NQT- line is ignored"
    );
}

#[test]
fn a_line_too_long_to_be_a_handshake_is_skipped_whole() {
    let mut scan = FirstNqt::default();
    let mut long = b"NQT-READY ".to_vec();
    long.extend(std::iter::repeat_n(b'x', 70 * 1024));
    long.extend(b" NQT-READY tail\n");
    assert_eq!(
        scan.feed(&long),
        None,
        "neither the long line nor its tail is a handshake"
    );
    assert_eq!(
        scan.feed(b"NQT-READY {}\n").as_deref(),
        Some("NQT-READY {}")
    );
}

fn health_takes(port: u16, session: &str, owner_ok: &dyn Fn(u32) -> bool) -> Duration {
    let started = Instant::now();
    let answer = link::with_session(port, "/api/health", session, owner_ok, 2 * HEALTH_BUDGET)
        .expect("health");
    assert_eq!(answer.status, 200);
    started.elapsed()
}

/// Every byte of backend.log and its rotated files, and whether the late line is among them.
fn logged(state: &std::path::Path) -> (u64, bool) {
    let logs = state.join("logs");
    let files: Vec<_> = std::fs::read_dir(&logs)
        .map(|d| d.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    let total = files
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    let late = files.iter().any(|p| {
        std::fs::read(p).is_ok_and(|bytes| {
            bytes
                .windows(LATE_LINE.len())
                .any(|w| w == LATE_LINE.as_bytes())
        })
    });
    (total, late)
}

#[test]
fn a_noisy_backend_answers_health_within_1s_and_a_later_nqt_line_is_ignored() {
    let watch = watch();
    let mode = json!({ "noise_before": TEN_MB, "noise_after": TEN_MB, "late_nqt": true });
    let lab = fake_lab("noisy", &mode);
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: vec![],
    };
    let spawned = supervise::spawn(&spec, &Expect::for_lab(&lab.lab, check::CONTRACT_RANGE))
        .expect("accepted");
    let owner_ok = |pid| spawned.job_pids().contains(&pid);
    let first = health_takes(spawned.port(), spawned.session(), &owner_ok);
    assert!(
        first < HEALTH_BUDGET,
        "health took {first:?} while the backend was printing 10 MB"
    );
    wait_until(
        Duration::from_secs(60),
        "the late NQT- line in backend.log",
        || logged(&lab.state).1,
    );
    let (total, _) = logged(&lab.state);
    assert!(
        total >= 2 * TEN_MB,
        "backend.log and its rotations hold {total} bytes, not the 20 MB printed"
    );
    assert!(
        lab.state.join("logs").join("backend.log.1").is_file(),
        "backend.log never rotated at 5 MB"
    );
    let again = health_takes(spawned.port(), spawned.session(), &owner_ok);
    assert!(
        again < HEALTH_BUDGET,
        "health took {again:?} after the noise"
    );
    assert_ne!(
        spawned.port(),
        1,
        "the later NQT- line was taken as the handshake"
    );
    watch.assert_clean();
}
