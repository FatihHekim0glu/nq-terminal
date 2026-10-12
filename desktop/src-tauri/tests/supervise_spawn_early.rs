//! The backend is spawned before the window and its WebView2 are built (startup.md 7.2; 03 section 2.2 step 4, "in
//! parallel with step 3"). On 0.3.2 and 0.3.3 setup built the window first and only then started the supervisor, so
//! `supervise_spawned` came 451 to 596 ms after the shell's start while WebView2 was ready by about 350 ms.
//!
//! - main.rs starts the supervisor after the settings read and before the window build (a scan of setup's own
//!   source: the order is the thing under test, and it cannot be driven without a window).
//! - The loop started that way spawns, handshakes and proves its backend with no window at all; its calls wait in
//!   the handoff and reach the window's sink, in order, once it is given (READY, and a refusal made before the window
//!   existed).
//! - A start that never gets its window answers the fail-closed way: nothing shown, no rebuild, Quit.
//! - The two new log lines place the time before the spawn: `supervise_thread_began`, then
//!   `supervise_create_process` just before CreateProcessW, then `supervise_spawned`.
//!
//! Born failing: the order scan fails on the 0.3.3 main.rs (`supervise::start(&main, ...)` after `builder.build()`),
//! and the refusal test fails against a handoff that drops what came before the window.
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
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use supervise::run::{AfterStop, Backend, Shared, Sink};
use supervise::shell::{self, Handoff};
use support::{FakeLab, Recorder, fake_lab, wait_until, watch};

/// The tests that spawn read the one shared event list by time, so they run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The window's sink as the loop sees it: every call recorded.
struct Recording(Arc<Recorder>);

impl Sink for Recording {
    fn ready(&self, port: u16, session: &str) {
        self.0.push(format!("ready {port} {session}"));
    }
    fn stopped(&self, code: &str) {
        self.0.push(format!("stopped {code}"));
    }
    fn exited(&self, exit_code: Option<u32>) {
        self.0.push(format!("exited {exit_code:?}"));
    }
    fn gave_up(&self, log: &Path) -> AfterStop {
        self.0.push(format!("gave_up {}", log.display()));
        AfterStop::Quit
    }
    fn stale_dist(&self, state: &str) -> bool {
        self.0.push(format!("stale_dist {state}"));
        false
    }
    fn reload(&self, uri: &str) {
        self.0.push(format!("reload {uri}"));
    }
    fn checking(&self) {
        self.0.push("checking".to_string());
    }
    fn still_unverified(&self) {
        self.0.push("still_unverified".to_string());
    }
    fn ib_switch(&self, on: bool, attached: bool) {
        self.0.push(format!("ib_switch {on} {attached}"));
    }
}

fn shared_for(lab: &FakeLab) -> Arc<Shared> {
    let spec = Spec {
        lab: lab.lab.clone(),
        state_dir: lab.state.clone(),
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    };
    Shared::new(spec, Expect::for_lab(&lab.lab, check::CONTRACT_RANGE)).expect("shared")
}

/// The events of one name logged since `since`, with their times.
fn logged_since(event: &str, since: Instant) -> Vec<(Instant, Value)> {
    let all = crash::events().into_iter();
    all.filter(|(t, e, _)| e == event && *t >= since)
        .map(|(t, _, d)| (t, d))
        .collect()
}

fn calls_of(recorder: &Recorder) -> Vec<String> {
    recorder.calls().into_iter().map(|(_, c)| c).collect()
}

/// Stops the loop and ends a spawned backend still current.
fn finish(shared: &Shared) {
    let current = shared.current();
    shared.stop();
    if let Some(backend) = current
        && let Backend::Spawned(s) = backend.as_ref()
    {
        s.end();
    }
}

// ---------------------------------------------------------------- main.rs order

/// The body of `fn setup` in main.rs, up to the next top-level item.
fn setup_body(source: &str) -> &str {
    let start = source.find("\nfn setup(").expect("main.rs has fn setup");
    let rest = &source[start..];
    let end = rest[1..].find("\n}\n").map_or(rest.len(), |i| i + 3);
    &rest[..end]
}

/// `body` without its `//` comments, so a comment naming a call can never satisfy the scan.
fn code_only(body: &str) -> String {
    let code = |l: &str| l.split("//").next().unwrap_or_default().to_string();
    body.lines().map(code).collect::<Vec<_>>().join(NEWLINE)
}

const NEWLINE: &str = "\n";

/// The first place `needle` appears in the code of `body`, or the reason it is missing.
fn at(body: &str, needle: &str) -> Result<usize, String> {
    body.find(needle)
        .ok_or_else(|| format!("setup in main.rs has no `{needle}`"))
}

/// The first rule of the order the concurrent loop thread depends on that `setup` breaks, if any.
fn order_violation(source: &str) -> Option<String> {
    let body = code_only(setup_body(source));
    let names = [
        "window::resolve(",
        "configure_writes(",
        "crash::set_log_dir(",
        "lab_may_start(",
        "supervise::begin(",
        "builder.build()",
        "window::setup(",
        "early.attach(",
    ];
    let found: Result<Vec<usize>, String> = names.iter().map(|n| at(&body, n)).collect();
    let p = match found {
        Ok(p) => p,
        Err(missing) => return Some(missing),
    };
    let rules = [
        (
            p[0] < p[4],
            "the supervisor needs the settings (the lab, the IB snapshot): it starts after window::resolve",
        ),
        (
            p[1] < p[4],
            "the backend log drain writes through writes::append: configure_writes runs before supervise::begin",
        ),
        (
            p[2] < p[4],
            "the early supervise_* lines go to the log dir: crash::set_log_dir runs before supervise::begin",
        ),
        (
            p[4] < p[5],
            "the supervisor starts after the window build, so the spawn waits on WebView2 (startup.md 7.2)",
        ),
        (
            p[6] < p[7],
            "the loop attaches to the window after window::setup",
        ),
        (
            p[3] < p[4] && body[p[3].saturating_sub(3)..p[4]].starts_with("if lab_may_start("),
            "supervise::begin is called only under `if lab_may_start(`",
        ),
    ];
    let broken = rules.iter().find(|(held, _)| !held);
    broken.map(|(_, why)| (*why).to_string())
}

#[test]
fn main_starts_the_supervisor_after_the_settings_read_and_before_the_window_build() {
    let violation = order_violation(include_str!("../src/main.rs"));
    assert_eq!(violation, None);
}

/// main.rs with the first `moved` taken out of its place and put just before the first `before`.
fn moved_before(moved: &str, before: &str) -> String {
    let source = include_str!("../src/main.rs");
    let without = source.replacen(moved, "", 1);
    let anchor = without.find(before).expect("anchor");
    format!("{}{}{}", &without[..anchor], moved, &without[anchor..])
}

#[test]
fn the_scan_catches_the_supervisor_moved_above_a_step_the_loop_thread_needs() {
    let begin = "supervise::begin(app.handle(), &launch)?";
    for step in ["configure_writes(&options", "crash::set_log_dir("] {
        let swapped = moved_before(begin, step);
        assert!(
            order_violation(&swapped).is_some(),
            "supervise::begin placed above `{step}` must fail the scan"
        );
    }
}

#[test]
fn the_scan_catches_an_ungated_start_and_an_attach_before_the_window_setup() {
    let source = include_str!("../src/main.rs");
    let gate = "let early = if lab_may_start(&options) {";
    let ungated = source.replacen(
        gate,
        "let _g = lab_may_start(&options); let early = if true {",
        1,
    );
    assert!(
        order_violation(&ungated).is_some(),
        "an ungated begin must fail the scan"
    );
    let attach = moved_before("early.attach(", "window::setup(&main");
    assert!(
        order_violation(&attach).is_some(),
        "attach above window::setup must fail the scan"
    );
}

#[test]
fn a_comment_naming_the_call_does_not_satisfy_the_scan() {
    let source = include_str!("../src/main.rs");
    let begin = "supervise::begin(app.handle(), &launch)?";
    let commented = source.replacen(begin, "Default::default() // supervise::begin(", 1);
    assert!(
        order_violation(&commented).is_some(),
        "a comment is not a call"
    );
}

// ---------------------------------------------------------------- the handoff on its own

#[test]
fn calls_made_before_the_sink_is_given_reach_it_in_order() {
    let handoff = Arc::new(Handoff::default());
    let loop_side = handoff.clone();
    let caller = std::thread::spawn(move || {
        loop_side.stopped("hmac");
        loop_side.exited(Some(3));
        loop_side.ready(5000, "s")
    });
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !caller.is_finished(),
        "a call before the window waits for it"
    );
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    caller
        .join()
        .expect("the caller ends once the sink is given");
    let calls = calls_of(&recorder);
    assert_eq!(calls, ["stopped hmac", "exited Some(3)", "ready 5000 s"]);
}

#[test]
fn an_abandoned_handoff_shows_nothing_rebuilds_nothing_and_quits() {
    let handoff = Handoff::default();
    handoff.abandon();
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    handoff.stopped("hmac");
    assert!(!handoff.stale_dist("stale"), "no rebuild without a window");
    let log = Path::new(r"D:\dev\tmp\w4b-supervise\backend.log");
    assert_eq!(handoff.gave_up(log), AfterStop::Quit);
    assert!(
        calls_of(&recorder).is_empty(),
        "a sink given after the abandon is never used"
    );
}

/// How long a caller blocked in the handoff gets to end once the start is abandoned.
const RELEASE_LIMIT: Duration = Duration::from_secs(5);

/// Runs `call` on its own thread, blocked in the handoff until it is settled; its answer comes down the channel.
fn blocked_call<T: Send + 'static>(
    handoff: &Arc<Handoff>,
    call: impl FnOnce(&Handoff) -> T + Send + 'static,
) -> std::sync::mpsc::Receiver<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    let side = handoff.clone();
    std::thread::spawn(move || {
        let _ = tx.send(call(&side));
    });
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        rx.try_recv().is_err(),
        "the call waits in the handoff until it is settled"
    );
    rx
}

#[test]
fn an_abandon_releases_a_ready_call_already_blocked_and_it_never_reaches_a_later_sink() {
    let handoff = Arc::new(Handoff::default());
    let ended = blocked_call(&handoff, |h| h.ready(5000, "s"));
    handoff.abandon();
    ended
        .recv_timeout(RELEASE_LIMIT)
        .expect("abandon releases the blocked ready call");
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    assert!(calls_of(&recorder).is_empty(), "no later sink is reached");
}

#[test]
fn an_abandon_releases_a_gave_up_call_already_blocked_and_it_quits() {
    let handoff = Arc::new(Handoff::default());
    let ended = blocked_call(&handoff, |h| {
        h.gave_up(Path::new(r"D:\dev\tmp\w4b-supervise\backend.log"))
    });
    handoff.abandon();
    let after = ended
        .recv_timeout(RELEASE_LIMIT)
        .expect("abandon releases the blocked gave_up call");
    assert_eq!(after, AfterStop::Quit);
}

#[test]
fn an_abandon_releases_a_stale_dist_call_already_blocked_and_it_does_not_rebuild() {
    let handoff = Arc::new(Handoff::default());
    let ended = blocked_call(&handoff, |h| h.stale_dist("stale"));
    handoff.abandon();
    let rebuild = ended
        .recv_timeout(RELEASE_LIMIT)
        .expect("abandon releases the blocked stale_dist call");
    assert!(!rebuild, "no rebuild without a window");
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    assert!(calls_of(&recorder).is_empty(), "no later sink is reached");
}

#[test]
fn a_give_then_an_abandon_keeps_the_sink_the_first_call_gave() {
    let handoff = Handoff::default();
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    handoff.abandon();
    handoff.stopped("hmac");
    assert!(!handoff.stale_dist("stale"));
    assert_eq!(calls_of(&recorder), ["stopped hmac", "stale_dist stale"]);
}

#[test]
fn a_given_sink_answers_for_the_window() {
    let handoff = Handoff::default();
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    let log = Path::new(r"D:\dev\tmp\w4b-supervise\backend.log");
    assert_eq!(handoff.gave_up(log), AfterStop::Quit);
    assert!(!handoff.stale_dist("missing"));
    let calls = calls_of(&recorder);
    assert_eq!(calls.len(), 2, "{calls:?}");
    assert_eq!(calls[0], format!("gave_up {}", log.display()));
    assert_eq!(calls[1], "stale_dist missing");
}

/// The session becomes the `nqt_s_<port>` cookie, and every override carries its arguments through unchanged.
#[test]
fn a_given_sink_receives_every_call_with_its_arguments() {
    let handoff = Handoff::default();
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    handoff.ready(48213, "session-7f3a");
    handoff.reload("http://127.0.0.1:48213/");
    handoff.checking();
    handoff.still_unverified();
    handoff.ib_switch(true, false);
    handoff.ib_switch(false, true);
    assert_eq!(
        calls_of(&recorder),
        [
            "ready 48213 session-7f3a",
            "reload http://127.0.0.1:48213/",
            "checking",
            "still_unverified",
            "ib_switch true false",
            "ib_switch false true",
        ]
    );
}

// ---------------------------------------------------------------- the early loop on a real fake backend

#[test]
fn the_loop_spawns_and_proves_its_backend_with_no_window() {
    let _serial = serial();
    let watch = watch();
    let lab = fake_lab("early-ready", &json!({}));
    let began = Instant::now();
    let shared = shared_for(&lab);
    let handoff = shell::start_loop(shared.clone()).expect("the loop starts");
    let checked = || !logged_since("supervise_checked", began).is_empty();
    wait_until(
        Duration::from_secs(30),
        "supervise_checked with no window",
        checked,
    );
    std::thread::sleep(Duration::from_millis(300));
    // `supervise_ready` means the window has the backend (serve: set_current, sink.ready, then the log line), so with
    // no window yet the backend is current and the line is absent. Logging it above `sink.ready` would break this.
    assert!(
        shared.current().is_some(),
        "a checked backend is current before the window is given"
    );
    assert!(
        logged_since("supervise_ready", began).is_empty(),
        "supervise_ready is logged before the window has the backend"
    );
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    let ready = || calls_of(&recorder).iter().any(|c| c.starts_with("ready "));
    wait_until(Duration::from_secs(5), "READY to reach the sink", ready);
    let logged = || !logged_since("supervise_ready", began).is_empty();
    wait_until(
        Duration::from_secs(5),
        "supervise_ready after the hand-off",
        logged,
    );
    let first = |event: &str| logged_since(event, began).first().map(|(t, _)| *t);
    let order = [
        "supervise_thread_began",
        "supervise_create_process",
        "supervise_create_returned",
        "supervise_spawned",
    ]
    .map(|e| first(e).unwrap_or_else(|| panic!("no {e} in the log")));
    assert!(
        order.windows(2).all(|pair| pair[0] <= pair[1]),
        "thread began, the line before CreateProcessW, the line when it returned, then spawned: {order:?}"
    );
    finish(&shared);
    watch.assert_clean();
}

#[test]
fn a_refusal_made_before_the_window_exists_reaches_the_window_built_later() {
    let _serial = serial();
    let watch = watch();
    let lab = fake_lab("early-refused", &json!({ "lie": "hmac" }));
    let began = Instant::now();
    let shared = shared_for(&lab);
    let handoff = shell::start_loop(shared.clone()).expect("the loop starts");
    let refused = || {
        let seen = logged_since("supervise_refused", began);
        seen.iter().any(|(_, d)| d["code"] == "hmac")
    };
    wait_until(
        Duration::from_secs(30),
        "the refusal with no window",
        refused,
    );
    std::thread::sleep(Duration::from_millis(300));
    let recorder = Arc::new(Recorder::default());
    handoff.give(Arc::new(Recording(recorder.clone())));
    let shown = || calls_of(&recorder).iter().any(|c| c == "stopped hmac");
    wait_until(
        Duration::from_secs(5),
        "the refusal to reach the window's sink",
        shown,
    );
    assert_eq!(calls_of(&recorder), ["stopped hmac"]);
    finish(&shared);
    watch.assert_clean();
}

// ---------------------------------------------------------------- the fail-closed path of Early

/// A start that never gets its window (the build, the keys, the window setup or the attach fails) drops the `Early`
/// that holds the running loop: the loop is stopped first, then the handoff is abandoned, so the loop waiting on
/// READY wakes, starts no new backend, ends, and the backend it spawned ends with it (supervise_shell.rs, Drop).
#[test]
fn dropping_an_early_with_a_running_loop_stops_the_loop_and_ends_its_backend() {
    let _serial = serial();
    let watch = watch();
    let lab = fake_lab("early-drop-ends-loop", &json!({}));
    let began = Instant::now();
    let shared = shared_for(&lab);
    let handoff = shell::start_loop(shared.clone()).expect("the loop starts");
    let checked = || !logged_since("supervise_checked", began).is_empty();
    wait_until(
        Duration::from_secs(30),
        "supervise_checked with no window",
        checked,
    );
    std::thread::sleep(Duration::from_millis(300));
    // Only the pid is kept: a held backend would keep the process alive past the loop's own drop of it.
    let pid = match shared.current().expect("the loop holds a backend").as_ref() {
        Backend::Spawned(spawned) => spawned.pid(),
        Backend::Attached(_) => panic!("the loop spawned its backend"),
    };
    let process = support::Tracked::open(pid).expect("the backend process is open");
    assert!(shared.looping(), "the loop waits on READY in the handoff");
    assert!(!process.ended_within(Duration::ZERO), "the backend runs");

    drop(shell::Early::running(shared.clone(), handoff));

    wait_until(Duration::from_secs(10), "the loop to end", || {
        !shared.looping()
    });
    assert!(shared.stopping(), "the loop was stopped, not left running");
    assert!(shared.current().is_none(), "no backend is current");
    assert!(
        process.ended_within(Duration::from_secs(10)),
        "the backend the early loop spawned ends with it"
    );
    let spawns = logged_since("supervise_spawned", began).len();
    assert_eq!(spawns, 1, "no second backend started after the drop");
    finish(&shared);
    watch.assert_clean();
}

// ---------------------------------------------------------------- a refused lab is never spawned

/// The launch harness of the smoke build, for the one test that starts the exe.
#[cfg(feature = "smoke")]
#[allow(
    clippy::duplicate_mod,
    reason = "the window harness and supervise_support.rs both load tests/hidden_support/scope.rs by path, as the               other hidden-window tests do"
)]
#[path = "window_harness.rs"]
mod harness;

/// The spawn guard (main.rs `lab_may_start`): a lab the lab check refuses never reaches the supervisor's loop. The
/// supervisor now starts before the window, so without the guard a lab with a venv python (here an empty file) would
/// begin its loop, and one without it would fail in `begin` with the supervisor's own "has no .venv" error instead of
/// the lab check's `lab_refused`. Needs the smoke exe, so it is compiled into the smoke set only.
#[cfg(feature = "smoke")]
mod refused_lab {
    use super::harness::*;
    use serde_json::{Value, json};
    use std::time::Duration;

    const REQUIRED: [&str; 3] = [
        r".venv\Scripts\python.exe",
        r"src\nq_lab\config.py",
        r"terminal\backend\nq_terminal\__main__.py",
    ];

    /// The supervisor lines that mean its loop began or reached CreateProcessW.
    const SPAWN_LINES: [&str; 3] = [
        "supervise_thread_began",
        "supervise_create_process",
        "supervise_spawned",
    ];

    fn events_named<'a>(log: &'a [Value], name: &'a str) -> impl Iterator<Item = &'a Value> {
        log.iter().filter(move |e| e["event"] == name)
    }

    #[test]
    fn a_lab_the_lab_check_refuses_is_never_spawned() {
        let _one = one_run();
        for (index, part) in REQUIRED.iter().enumerate() {
            let run = run_dir(&format!("spawn-guard-lab-{index}"));
            let lab = fake_lab(&run, true);
            std::fs::remove_file(lab.join(part)).expect("remove one required file");
            let run = run_dir(&format!("spawn-guard-run-{index}"));
            let mut args = base_args(&run);
            args.extend(["--lab".into(), lab.into()]);
            let watch = start_watch();
            let mut shell = launch(&run, &args, &[]);
            let code = wait_for_exit(&mut shell, Duration::from_secs(60));
            drop(shell);
            assert_clean(&watch.finish());
            let log = shell_log(&run);

            assert_eq!(code, Some(EXIT_RUN), "{part}: exit code; log {log:?}");
            let refused = events_named(&log, "lab_refused").next();
            let refused = refused.unwrap_or_else(|| panic!("{part}: no lab_refused: {log:?}"));
            assert_eq!(refused["missing"], json!([part]), "{part}: {refused}");
            for line in SPAWN_LINES {
                assert!(
                    events_named(&log, line).next().is_none(),
                    "{part}: a refused lab logged {line}: {log:?}"
                );
            }
            let failed = events_named(&log, "setup_failed").next();
            let failed = failed.unwrap_or_else(|| panic!("{part}: no setup_failed: {log:?}"));
            let error = failed["error"].as_str().unwrap_or_default();
            assert!(
                !error.contains("has no .venv"),
                "{part}: the supervisor, not the lab check, refused this lab: {failed}"
            );
        }
    }
}
