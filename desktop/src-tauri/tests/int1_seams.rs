//! The seams between the shell and the backend and page it serves, in hidden launches on the owner's real lab
//! (integration wave INT1; 03 sections 2.3, 4.5 and 10; 04 D3 and D4 exit criteria).
//!
//! `cargo test --no-default-features --features smoke --test int1_seams -- --nocapture` starts the smoke exe hidden
//! with `--lab <the lab this tree sits in>` and NO `--fixture`, so the supervisor spawns the real
//! `python -m nq_terminal` through the lock, the NQT-READY handshake, the proof and the session. The state folder
//! (`--state-dir`), the save folder, the WebView2 profile and the shell's config folder are under D:\dev\tmp\int1, so
//! the lab's own `terminal\state` is never written (and NQT_JOBS stays off). The page is driven over the debugging
//! protocol by a small Node script (no browser of its own). The first test launches twice on one state folder:
//!
//! 1. HOME of the real backend loads behind the session, and the page's workspace store is on it: a GET of a
//!    document answers 200 and the shell's flush hook reports a ready store with nothing pending.
//! 2. A file saved through the page's real bridge (GRAB: an object-URL anchor that the bridge revokes at once) lands
//!    in the save folder through DownloadStarting, with the bytes of a PNG and nothing else beside it.
//! 3. A change made 0.1 s before the close (inside the page's 500 ms debounce) is in the store's file after the
//!    shell has stopped the backend: the shell flushes the page's pending writes before it closes the backend's
//!    stdin, and says so in its log.
//! 4. A second launch, on a new port with empty page storage, finds the saved workspace in the page (03 section 10.1).
//! 5. The lab scan, after every test: no new file under results/, data/, live/ or backtests/output (the gate's own access log aside),
//!    nothing new in terminal/state, no profile folder on C:, no window drawn and no foreground change.
//!
//! The second test starts a real backend by hand (the lock, the stdin secrets, port 0), lets a shell attach to it
//! through the real lock file and proof, and checks that closing the shell leaves that backend running.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files, scans the lab read only and starts processes it owns"
)]

#[allow(
    dead_code,
    reason = "each test binary that includes the support files uses a part of them"
)]
#[path = "hidden_support/labs.rs"]
mod labs;
#[path = "hidden_support/launch.rs"]
mod launch_support;
/// The shell's own link code (the proof, the session and the MAC check the attach path runs), driven against a real
/// backend with secrets the shell was not given.
#[allow(dead_code, reason = "this test uses a part of the link module")]
#[path = "../src/link.rs"]
mod link;
#[path = "hidden_support/seam_gate.rs"]
mod seam_gate;
#[path = "hidden_support/seam_js.rs"]
mod seam_js;
#[path = "hidden_support/seam_util.rs"]
mod seam_util;
#[path = "hidden_support/watch.rs"]
mod watch;

use launch_support::{Owned, c_drive_folders, close_shell, devtools_port, log_file, terminal_dir};
use seam_gate::{GATE_LOG, gate_log_appended, gate_log_len, gate_log_path, gate_log_violations};
use seam_js::*;
use seam_util::{first_event, position_of, wait_until};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashSet};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use watch::{failures, start_watch};

const RUN_ROOT: &str = r"D:\dev\tmp\int1";
const PAGE_PREFIX: &str = "http://127.0.0.1:";
/// Folders of the lab the app must never write (04 D4 exit; the plan's lab scan).
const LAB_DIRS: [&str; 4] = ["results", "data", "live", r"backtests\output"];
const WORKSPACE_NAME: &str = "INT1SEAM";
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

static ONE_RUN: Mutex<()> = Mutex::new(());

/// The driver's results, or None while there is no page to drive yet (or the driver itself failed).
fn drive_quietly(port: u16, steps: &Value) -> Option<Vec<Value>> {
    let out = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            DRIVER_JS,
            &port.to_string(),
            PAGE_PREFIX,
        ])
        .env("NQT_STEPS", steps.to_string())
        .stdin(Stdio::null())
        .creation_flags(launch_support::CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node for the page driver: {e}"));
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    serde_json::from_str::<Value>(text.trim())
        .ok()?
        .as_array()
        .cloned()
}

fn drive(port: u16, steps: &Value) -> Vec<Value> {
    drive_quietly(port, steps).unwrap_or_else(|| panic!("the page driver gave no results"))
}

fn run_folder() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let dir = PathBuf::from(RUN_ROOT).join(format!("seams-{stamp}"));
    std::fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    dir
}

/// Every file under `root` with its size and modification time, read only (a missing folder is empty).
fn listing(root: &Path) -> BTreeSet<(PathBuf, u64)> {
    let mut found = BTreeSet::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.metadata() {
                Ok(m) if m.is_dir() => stack.push(path),
                Ok(m) => {
                    found.insert((path, m.len()));
                }
                Err(_) => {}
            }
        }
    }
    found
}

fn lab_listing(lab: &Path) -> BTreeSet<(PathBuf, u64)> {
    LAB_DIRS
        .iter()
        .flat_map(|d| listing(&lab.join(d)))
        .collect()
}

/// The owner's lab: NQT_LAB, or the nq-lab folder of the user profile.
fn real_lab() -> PathBuf {
    std::env::var_os("NQT_LAB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab")
        })
}

/// The lab this tree sits in, or why this run cannot use one (printed, never silent).
fn lab_of_this_tree() -> Result<PathBuf, String> {
    let lab = real_lab();
    let here = terminal_dir()
        .canonicalize()
        .map_err(|e| format!("this tree: {e}"))?;
    let theirs = lab
        .join("terminal")
        .canonicalize()
        .map_err(|e| format!("{}: {e}", lab.display()))?;
    if here == theirs {
        Ok(lab)
    } else {
        Err(format!(
            "this tree ({}) is not the lab's terminal folder ({})",
            here.display(),
            theirs.display()
        ))
    }
}

fn shell_log(config: &Path) -> Vec<Value> {
    let path = config.join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// The folders one launch of the shell uses, all under the run folder.
struct Dirs {
    /// Whether the shell gets `--save-dir`; without it a test build has no way to save and the save is cancelled.
    save_dir: bool,
    root: PathBuf,
    state: PathBuf,
    saved: PathBuf,
    wv: PathBuf,
    config: PathBuf,
}

impl Dirs {
    /// `tag` keeps the profile and config folders of two launches apart; the state folder is named by the caller.
    fn new(run: &Path, tag: &str, state: &str, save_dir: bool) -> Self {
        let root = run.join(tag);
        std::fs::create_dir_all(&root)
            .unwrap_or_else(|e| panic!("cannot create {}: {e}", root.display()));
        Self {
            save_dir,
            state: run.join(state),
            saved: root.join("saved"),
            wv: root.join("wv"),
            config: root.join("config"),
            root,
        }
    }
}

fn start_shell(exe: &Path, lab: &Path, dirs: &Dirs) -> Owned {
    let mut cmd = Command::new(exe);
    cmd.arg("--lab")
        .arg(lab)
        .arg("--state-dir")
        .arg(&dirs.state)
        .arg("--webview-data-dir")
        .arg(&dirs.wv)
        .arg("--config-dir")
        .arg(&dirs.config)
        .env("PATH", launch_support::clean_path())
        .stdin(Stdio::null())
        .stdout(log_file(&dirs.root.join("shell.out.log")))
        .stderr(log_file(&dirs.root.join("shell.err.log")))
        .creation_flags(launch_support::CREATE_NO_WINDOW);
    if dirs.save_dir {
        cmd.arg("--save-dir").arg(&dirs.saved);
    }
    launch_support::without_webview2_vars(&mut cmd);
    Owned(
        cmd.spawn()
            .unwrap_or_else(|e| panic!("cannot start {}: {e}", exe.display())),
    )
}

/// A launch to the point where HOME of its backend has loaded: the shell, and the debugging port of its page.
fn launch_to_home(exe: &Path, lab: &Path, dirs: &Dirs) -> (Owned, u16) {
    let mut shell = start_shell(exe, lab, dirs);
    let port = devtools_port(&dirs.root, &mut shell);
    let home = launch_support::wait_for_home(port, PAGE_PREFIX);
    assert_eq!(home["ready"], true, "HOME never became ready: {home}");
    (shell, port)
}

/// A launch to the point where the page is up with its four panels and quiet, for a state the store restored.
fn launch_to_restored_page(exe: &Path, lab: &Path, dirs: &Dirs) -> (Owned, u16) {
    let mut shell = start_shell(exe, lab, dirs);
    let port = devtools_port(&dirs.root, &mut shell);
    wait_until("the restored page", Duration::from_secs(120), || {
        let out = drive_quietly(port, &json!([{ "eval": PANELS_QUIET }]))?;
        (out.first() == Some(&Value::Bool(true))).then_some(())
    });
    (shell, port)
}

/// What a run must leave as it found it: the lab's research folders, its own terminal/state, the app-data folders of
/// C:, and (through the global watch) every window and the foreground.
struct Scan {
    lab: PathBuf,
    /// Length of `results/oos_access_log.jsonl` before the run: only what is appended past it is read afterwards.
    gate_len_before: u64,
    lab_before: BTreeSet<(PathBuf, u64)>,
    state_before: BTreeSet<(PathBuf, u64)>,
    c_before: HashSet<PathBuf>,
    watch: watch::Watch,
}

impl Scan {
    fn begin(lab: &Path) -> Self {
        Self {
            lab: lab.to_path_buf(),
            gate_len_before: gate_log_len(lab),
            lab_before: lab_listing(lab),
            state_before: listing(&lab.join("terminal").join("state")),
            c_before: c_drive_folders(),
            watch: start_watch(),
        }
    }

    fn finish(self) {
        std::thread::sleep(Duration::from_millis(800));
        let report = self.watch.finish();
        let new_in_lab: Vec<_> = lab_listing(&self.lab)
            .difference(&self.lab_before)
            .map(|(p, _)| p.clone())
            .filter(|p| *p != gate_log_path(&self.lab))
            .collect();
        assert!(
            new_in_lab.is_empty(),
            "new or changed files in the lab: {new_in_lab:?}"
        );
        let appended = gate_log_appended(&self.lab, self.gate_len_before)
            .unwrap_or_else(|why| panic!("the gate's access log: {why}"));
        let bad = gate_log_violations(&appended);
        assert!(
            bad.is_empty(),
            "the lines this run added to {GATE_LOG} break the research rules: {bad:#?}"
        );
        let state = listing(&self.lab.join("terminal").join("state"));
        let new_in_state: Vec<_> = state.difference(&self.state_before).cloned().collect();
        assert!(
            new_in_state.is_empty(),
            "the lab's own terminal/state changed: {new_in_state:?}"
        );
        let new_c: Vec<_> = c_drive_folders()
            .difference(&self.c_before)
            .cloned()
            .collect();
        assert!(new_c.is_empty(), "new folders on C: {new_c:?}");
        let verdict = failures(&report);
        assert!(verdict.is_empty(), "the watch saw: {verdict:#?}");
    }
}

/// Waits until the page's message line says something containing `wanted`.
fn wait_for_message(port: u16, wanted: &str) -> String {
    wait_until(
        &format!("the message \"{wanted}\""),
        Duration::from_secs(30),
        || {
            let out = drive_quietly(port, &json!([{ "eval": MESSAGE_LINE }]))?;
            out.first()?
                .as_str()
                .filter(|t| t.contains(wanted))
                .map(str::to_owned)
        },
    )
}

/// The environment variable that turns a skipped seam run into a failure (scripts\check.ps1 sets it in the lab's own
/// tree, where the run must happen; any other tree may still skip, loudly).
const REQUIRE_SEAMS: &str = "NQT_REQUIRE_SEAMS";

/// What a run does when the lab of this tree cannot be used: skip with a printed reason, or, when the seams are
/// required, fail. A skip is a green test that started no backend, so a run that must prove the seams cannot take it.
fn seam_gate(found: Result<PathBuf, String>, require: bool) -> Option<PathBuf> {
    match found {
        Ok(lab) => Some(lab),
        Err(why) if require => panic!(
            "{REQUIRE_SEAMS}=1 but the seam run cannot start: {why}; it needs the lab's own terminal folder"
        ),
        Err(why) => {
            println!("SKIPPED: {why}; the seam run needs the lab's own terminal folder");
            None
        }
    }
}

fn lab_or_skip() -> Option<PathBuf> {
    seam_gate(
        lab_of_this_tree(),
        std::env::var_os(REQUIRE_SEAMS).is_some_and(|v| v == "1"),
    )
}

#[test]
#[should_panic(expected = "NQT_REQUIRE_SEAMS=1 but the seam run cannot start")]
fn a_tree_that_is_not_the_lab_fails_when_the_seams_are_required() {
    seam_gate(Err("this tree is a clone".to_owned()), true);
}

#[test]
fn a_tree_that_is_not_the_lab_skips_when_the_seams_are_not_required() {
    assert_eq!(
        seam_gate(Err("this tree is a clone".to_owned()), false),
        None
    );
    let lab = PathBuf::from("lab");
    assert_eq!(seam_gate(Ok(lab.clone()), true), Some(lab));
}

/// Checks 1 and 2: the page's store is on its session, the object the shell injects is the one the page reads, and a
/// file saved through the real bridge lands in the save folder (through DownloadStarting) with the bytes of a PNG and
/// nothing beside it.
fn check_store_and_export(port: u16, dirs: &Dirs) {
    let first = drive(
        port,
        &json!([
            { "eval": STORE_STATUS }, { "eval": SYNC_ANSWER }, { "eval": SHELL_OBJECT }, { "eval": HEALTH_PORT_FIXED },
        ]),
    );
    assert_eq!(
        first[0], 200,
        "GET /api/workspaces/prefs through the page's session: {first:?}"
    );
    let answer: Value =
        serde_json::from_str(first[1].as_str().unwrap_or("null")).unwrap_or(Value::Null);
    assert_eq!(
        answer["status"], "ready",
        "the page's store is not ready: {first:?}"
    );
    let shell_object: Value =
        serde_json::from_str(first[2].as_str().unwrap_or("null")).unwrap_or(Value::Null);
    assert_eq!(
        shell_object,
        json!({ "bridgeVersion": 3, "platform": "windows", "keys": "pc", "ibSnapshot": false }),
        "the object the shell injects is not the one detect.ts reads"
    );
    assert_eq!(
        first[3], false,
        "port_fixed must be false on the app's random port (Copy link then copies the portable form): {first:?}"
    );
    let saved = drive(
        port,
        &json!([
            { "eval": FOCUS_COMMAND_LINE }, { "insert": "GRAB" }, { "key": "Enter", "vk": 13 }, { "wait": 500 },
        ]),
    );
    assert_eq!(
        saved[0], true,
        "the command line could not be focused: {saved:?}"
    );
    let png = wait_until("the exported file", Duration::from_secs(60), || {
        std::fs::read_dir(&dirs.saved)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|x| x == "png"))
    });
    let bytes = std::fs::read(&png).unwrap_or_default();
    assert!(
        bytes.starts_with(&PNG_MAGIC),
        "{} is not a PNG ({} bytes)",
        png.display(),
        bytes.len()
    );
    // The shell told the page how the save ended, so its own message line says it was saved.
    wait_for_message(port, "Saved 1 chart with its labels as");
    let in_saved: Vec<_> = listing(&dirs.saved).into_iter().map(|(p, _)| p).collect();
    assert_eq!(
        in_saved,
        vec![png],
        "the save folder holds more than the one export"
    );
}

#[test]
fn real_backend_store_export_flush_on_close_and_the_next_launch() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(lab) = lab_or_skip() else {
        return;
    };
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let run = run_folder();
    let scan = Scan::begin(&lab);

    // Launch 1: the store and the bridge, then a change made while the page's debounce is held (so the page cannot
    // send it itself) and an immediate close: the shell's flush is the only way the change can reach the store.
    let one = Dirs::new(&run, "one", "state", true);
    let (mut shell, port) = launch_to_home(exe, &lab, &one);
    let served = first_event(&shell_log(&one.config), "supervise_ready")["port"]
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .expect("the supervise_ready port in the shell log");
    assert_real_backend_refuses_sessionless(served);
    check_store_and_export(port, &one);
    let typed = drive(
        port,
        &json!([
            { "eval": HOLD_DEBOUNCE }, { "eval": HELD_MARK }, { "eval": FOCUS_COMMAND_LINE },
            { "insert": format!("SAVE {WORKSPACE_NAME}") }, { "key": "Enter", "vk": 13 }, { "eval": HELD_NOTED },
        ]),
    );
    assert_eq!(typed[0], true, "the debounce could not be held: {typed:?}");
    assert_eq!(
        typed[2], true,
        "the command line could not be focused: {typed:?}"
    );
    assert_eq!(
        typed[5], true,
        "the change was never noted by the page (no debounce was scheduled): {typed:?}"
    );
    assert!(
        close_shell(&mut shell),
        "the shell did not close on WM_CLOSE within 20 s"
    );
    drop(shell);
    let workspaces = std::fs::read_to_string(one.state.join("workspaces").join("workspaces.json"))
        .unwrap_or_default();
    assert!(
        workspaces.contains(WORKSPACE_NAME),
        "the change made just before the close never reached the store: {workspaces}"
    );
    let log = shell_log(&one.config);
    let flush = first_event(&log, "store_flush");
    assert_eq!(flush["outcome"], "flushed", "{flush}");
    assert!(
        position_of(&log, "store_flush") < position_of(&log, "supervise_shutdown"),
        "the flush must come before the backend is stopped: {log:?}"
    );
    let shutdown = first_event(&log, "supervise_shutdown");
    assert_eq!(shutdown["stopped_in_grace"], true, "{shutdown}");
    let first_port = first_event(&log, "supervise_ready")["port"].clone();

    // Launch 2: a new backend on a new port, an origin with empty storage, the same state folder: the page is
    // handed the workspace the first launch saved (03 section 10.1).
    let two = Dirs::new(&run, "two", "state", false);
    let (mut shell, port) = launch_to_restored_page(exe, &lab, &two);
    let cached = wait_until(
        "the saved workspace in the page",
        Duration::from_secs(30),
        || {
            let out = drive(port, &json!([{ "eval": WORKSPACES_CACHE }]));
            out[0]
                .as_str()
                .filter(|t| t.contains(WORKSPACE_NAME))
                .map(str::to_owned)
        },
    );
    assert!(cached.contains(WORKSPACE_NAME));
    // No save folder in a test build: the save dialog fails closed, the shell reports a cancel, and the page says
    // no file was written (it must not say saved).
    let cancelled = drive(
        port,
        &json!([{ "eval": FOCUS_COMMAND_LINE }, { "insert": "GRAB" }, { "key": "Enter", "vk": 13 }]),
    );
    assert_eq!(
        cancelled[0], true,
        "the command line could not be focused: {cancelled:?}"
    );
    wait_for_message(port, "Save cancelled: no file was written.");
    assert!(
        !two.saved.exists() || listing(&two.saved).is_empty(),
        "a cancelled save left a file"
    );
    assert!(close_shell(&mut shell), "the second shell did not close");
    drop(shell);
    let log_two = shell_log(&two.config);
    let second_port = first_event(&log_two, "supervise_ready")["port"].clone();
    assert_ne!(
        first_port, second_port,
        "both launches used the same backend port, so the origin did not change"
    );
    scan.finish();
}

/// Requests with no session cookie and with a cookie no session stands behind, from outside the page (plain
/// `node:http`, so no browser cookie jar and no page origin rides along). Prints a JSON array of [case, status].
const REFUSAL_JS: &str = r#"import http from 'node:http';
const port = Number(process.argv[1]);
const wrong = `nqt_s_${port}=` + '00'.repeat(32);
const origin = `http://127.0.0.1:${port}`;
const ask = (method, path, headers, body) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) });
  req.on('error', (e) => resolve(`error: ${e.message}`));
  req.end(body);
});
const out = [];
for (const [label, cookie] of [['no cookie', null], ['wrong cookie', wrong]]) {
  const extra = cookie ? { Cookie: cookie } : {};
  out.push([`${label} GET /api/health`, await ask('GET', '/api/health', extra)]);
  out.push([`${label} GET /api/workspaces/prefs`, await ask('GET', '/api/workspaces/prefs', extra)]);
  out.push([`${label} PUT /api/workspaces/prefs`, await ask('PUT', '/api/workspaces/prefs', { ...extra, Origin: origin, 'X-NQT': '1', 'Content-Type': 'application/json' }, '{}')]);
}
out.push(['control: GET /api/desktop/proof without a cookie', await ask('GET', `/api/desktop/proof?nonce=${'ab'.repeat(32)}`, {})]);
console.log(JSON.stringify(out));
"#;
/// What the backend answers a request that holds no live session (SessionMiddleware, 03 section 4.2).
const REFUSED_STATUS: u64 = 401;

/// The same real `python -m nq_terminal` the shell supervises refuses every door without a live session cookie. The
/// refusals are shown on the TestClient app (test_route_refusal_walk) and on fixture backends, so this closes the
/// gap a launch-time wiring difference (a middleware not mounted under the real entry point) would leave.
fn assert_real_backend_refuses_sessionless(port: u16) {
    let out = Command::new("node")
        .args(["--input-type=module", "-e", REFUSAL_JS, &port.to_string()])
        .stdin(Stdio::null())
        .creation_flags(launch_support::CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node for the refusal walk: {e}"));
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let answers: Vec<Value> = serde_json::from_str(text.trim())
        .unwrap_or_else(|e| panic!("the refusal walk gave no results ({e}): {text}"));
    let control = answers
        .iter()
        .find(|a| a[0].as_str().is_some_and(|c| c.starts_with("control")))
        .map_or(Value::Null, |a| a[1].clone());
    assert_eq!(
        control, 200,
        "the walk did not reach the backend: {answers:?}"
    );
    let refused: Vec<_> = answers
        .iter()
        .filter(|a| !a[0].as_str().is_some_and(|c| c.starts_with("control")))
        .collect();
    assert_eq!(refused.len(), 6, "the walk lost a case: {answers:?}");
    for answer in refused {
        assert_eq!(
            answer[1], REFUSED_STATUS,
            "the real backend did not refuse without a live session: {answer} in {answers:?}"
        );
    }
}

/// A real backend started the way a launcher starts it (the lock, the stdin secrets, port 0), with its state folder
/// shared with the shell that is to attach to it.
struct LiveBackend {
    child: Owned,
    stdin: Option<std::process::ChildStdin>,
}

fn start_live_backend(lab: &Path, state: &Path) -> LiveBackend {
    use std::io::{BufRead, BufReader, Write};
    let python = lab.join(".venv").join("Scripts").join("python.exe");
    let mut cmd = Command::new(python);
    cmd.args([
        "-E",
        "-s",
        "-X",
        "utf8",
        "-X",
        "faulthandler",
        "-m",
        "nq_terminal",
    ])
    .current_dir(lab.join("terminal").join("backend"))
    .env("NQT_DESKTOP", "1")
    .env("NQT_PORT", "0")
    .env("NQT_JOBS", "off")
    .env("NQT_STATE_DIR", state)
    .env("PYTHONIOENCODING", "utf-8")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(log_file(&state.with_extension("backend.err.log")))
    .creation_flags(launch_support::CREATE_NO_WINDOW);
    let mut child = cmd
        .spawn()
        .unwrap_or_else(|e| panic!("cannot start the backend: {e}"));
    let mut stdin = child.stdin.take().expect("backend stdin");
    let stdout = child.stdout.take().expect("backend stdout");
    // Any 64 hex characters are a token and a nonce.
    let secrets = format!("TOKEN {}\nNONCE {}\n", "ab".repeat(32), "cd".repeat(32));
    stdin.write_all(secrets.as_bytes()).expect("the secrets");
    stdin.flush().expect("flush the secrets");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with("NQT-") {
                let _ = tx.send(line);
            }
        }
    });
    let line = rx
        .recv_timeout(Duration::from_secs(90))
        .unwrap_or_else(|_| panic!("the real backend gave no handshake line"));
    assert!(line.starts_with("NQT-READY"), "not a ready line: {line}");
    LiveBackend {
        child: Owned(child),
        stdin: Some(stdin),
    }
}

/// What the shell's attach path (link::session, link::proof and verify_mac) does against a real backend when the
/// secret it holds is wrong, or the answer it checks was made for another nonce, kind or token. The attach is built on
/// exactly these calls, so each refusal here is a refused attach. (The lock cannot be forged for a shell run: the
/// backend holds it open, shared for reading only.)
fn assert_real_backend_refuses_wrong_secrets(state: &Path) {
    let lock: Value = serde_json::from_str(
        &std::fs::read_to_string(state.join("backend.lock")).expect("read the lock"),
    )
    .expect("the lock is JSON");
    let port = u16::try_from(lock["port"].as_u64().expect("lock port")).expect("lock port range");
    let pid = u32::try_from(lock["pid"].as_u64().expect("lock pid")).expect("lock pid range");
    let (token, wrong) = ("ab".repeat(32), "11".repeat(32));
    let owner_ok = |p: u32| p == pid;
    let wait = Duration::from_secs(10);

    let mut sessions = Vec::new();
    for (what, secret) in [
        ("the wrong token", wrong.as_str()),
        ("a token that is not hex", "zz"),
        ("an empty token", ""),
    ] {
        sessions.push((
            what,
            link::session(port, secret, &owner_ok, wait).unwrap_err(),
        ));
    }
    for (what, err) in &sessions {
        assert_eq!(
            *err,
            link::LinkError::Status(401),
            "{what} must be refused with 401 by the real backend"
        );
    }
    assert!(
        link::session(port, &token, &owner_ok, wait).is_ok(),
        "control: the right token must buy a session"
    );

    let bare = link::get(
        &link::Get::loopback(port, "/api/health", &[], wait),
        &owner_ok,
    )
    .expect("a cookie-less health request is answered");
    assert_eq!(bare.status, 401, "no cookie on /api/health");
    let forged = link::with_session(port, "/api/health", &"00".repeat(32), &owner_ok, wait)
        .expect("a forged-cookie health request is answered");
    assert_eq!(forged.status, 401, "a cookie no session stands behind");

    let nonce = link::fresh_secret();
    let proof = link::proof(port, &nonce, &owner_ok, wait).expect("the proof of the real backend");
    assert_eq!(proof.pid, pid, "the proof names another process");
    let (ready, kind) = (link::READY_KIND, link::PROOF_KIND);
    assert!(
        link::verify_mac(&token, kind, &nonce, port, pid, &proof.proof),
        "control: the right token must verify its own proof"
    );
    let other_nonce = link::fresh_secret();
    let verifies = |secret: &str, kind: &str, asked: &str, port: u16, pid: u32| {
        link::verify_mac(secret, kind, asked, port, pid, &proof.proof)
    };
    let (next_port, next_pid) = (port.wrapping_add(1), pid.wrapping_add(1));
    for (what, passed) in [
        (
            "a token the backend does not hold",
            verifies(&wrong, kind, &nonce, port, pid),
        ),
        (
            "another nonce than the one asked",
            verifies(&token, kind, &other_nonce, port, pid),
        ),
        (
            "the ready kind in place of proof",
            verifies(&token, ready, &nonce, port, pid),
        ),
        (
            "another port",
            verifies(&token, kind, &nonce, next_port, pid),
        ),
        (
            "another pid",
            verifies(&token, kind, &nonce, port, next_pid),
        ),
    ] {
        assert!(!passed, "the real backend's proof verified for {what}");
    }
    let malformed = link::proof(port, "not-a-nonce", &owner_ok, wait).unwrap_err();
    assert!(
        matches!(malformed, link::LinkError::Status(s) if (400..500).contains(&s)),
        "a malformed nonce must be refused by the real backend: {malformed:?}"
    );
}

#[test]
fn a_shell_attaches_to_a_real_backend_and_never_stops_it() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(lab) = lab_or_skip() else {
        return;
    };
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let run = run_folder();
    let scan = Scan::begin(&lab);
    let dirs = Dirs::new(&run, "attach", "state-live", true);
    std::fs::create_dir_all(&dirs.state).expect("the state folder");
    let mut live = start_live_backend(&lab, &dirs.state);
    assert!(
        dirs.state.join("backend.lock").exists(),
        "the real backend wrote no lock file"
    );
    assert_real_backend_refuses_wrong_secrets(&dirs.state);

    let (mut shell, _port) = launch_to_home(exe, &lab, &dirs);
    assert!(
        close_shell(&mut shell),
        "the attached shell did not close on WM_CLOSE"
    );
    drop(shell);
    let log = shell_log(&dirs.config);
    let ready = first_event(&log, "supervise_ready");
    assert_eq!(
        ready["attached"], true,
        "the shell spawned a second backend instead of attaching to the live one: {log:?}"
    );
    assert!(
        log.iter().all(|e| e["event"] != "supervise_spawned"),
        "an attach must not spawn: {log:?}"
    );
    assert!(
        matches!(live.child.0.try_wait(), Ok(None)),
        "closing an attached shell stopped the backend it did not start"
    );

    // The backend ends only when its own parent (this test) lets go of its stdin.
    drop(live.stdin.take());
    wait_until(
        "the backend to end on end of file",
        Duration::from_secs(15),
        || live.child.0.try_wait().ok().flatten(),
    );
    scan.finish();
}
