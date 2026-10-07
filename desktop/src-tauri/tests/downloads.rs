//! Page downloads land only where the owner chose, and a refused place keeps no file (03 sections 4.5 and 6;
//! 04 D4.4; 02 C3-1).
//!
//! `cargo test --features smoke --test downloads` builds the smoke exe and, for each case, serves a plain page from
//! a run folder on 127.0.0.1:8812 (the w4b writes-downloads row of the port table, with the lab venv python's
//! http.server), starts the shell hidden with `--attach-url`, `--lab <fake lab>`, `--save-dir`, and its WebView2
//! and config folders under D:\dev\tmp\w4b-writes, then makes the page download a blob through an object-URL
//! anchor (the bridge's `saveFile`) over the debugging protocol. A GLOBAL window and foreground watch runs during
//! every launch (any new drawn window anywhere, any undrawn one but tao's event target, or any change of the
//! foreground window fails the run). Cases:
//!
//! - a save folder outside the lab: the file lands there with the exact bytes, nothing else appears;
//! - a save folder that is a junction into `<fake lab>/results`: refused before the engine writes, no file anywhere;
//! - a save folder inside the lab outside terminal/state (`experiments/exports`): refused, no file;
//! - a save folder named inside `<fake lab>/results`: the smoke switch parser already refuses it; no file.
//!
//! In every case the engine's default folders stay untouched: the backstop under the config folder and the owner's
//! Downloads folder (listed read-only). Nothing is written on C:.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it builds its own run folders and fake lab, reads them back and starts its own processes"
)]

#[path = "hidden_support/scope.rs"]
mod scope;

use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetLayeredWindowAttributes,
    GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    LAYERED_WINDOW_ATTRIBUTES_FLAGS, PostMessageW, WM_CLOSE, WS_EX_LAYERED,
};
use windows::core::BOOL;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The w4b writes-downloads row of the port table.
const PAGE_PORT: u16 = 8812;
const RUN_ROOT: &str = r"D:\dev\tmp\w4b-writes";
const TAO_CLASS: &str = "Tao Thread Event Target";
const SAMPLE: Duration = Duration::from_millis(100);
const WAIT: Duration = Duration::from_secs(60);
/// How long a refused case keeps watching for a late file after the refusal is logged.
const SETTLE: Duration = Duration::from_secs(3);
/// main.rs EXIT_USAGE: a smoke switch the parser refuses.
const EXIT_USAGE: i32 = 2;
const PAGE: &str = "<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>export page</title></head><body><main><h1>export page</h1></main></body></html>\n";

/// One launch at a time: the page port and the watch are shared by the tests of this file.
static ONE_RUN: Mutex<()> = Mutex::new(());

// ------------------------------------------------------------------------------------------------ global watch

#[derive(Clone, Debug)]
struct Seen {
    pid: u32,
    class: String,
    drawn: bool,
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that all_windows keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

fn all_windows() -> Vec<isize> {
    let mut list: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `list`, which outlives the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
    list
}

fn visible_windows() -> HashSet<isize> {
    // SAFETY: a plain query on window handles EnumWindows just listed.
    let visible = |h: &isize| unsafe { IsWindowVisible(HWND(*h as *mut _)) }.as_bool();
    all_windows().into_iter().filter(visible).collect()
}

/// Drawn: visible, not cloaked, an area, and not a layered window that never got its attributes (tao's target).
fn describe(handle: isize) -> Seen {
    let hwnd = HWND(handle as *mut _);
    // SAFETY: read-only queries on a window handle; a handle that died in between just yields zeros.
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut class = [0u16; 256];
        let n = GetClassNameW(hwnd, &mut class) as usize;
        let mut r = RECT::default();
        let _ = GetWindowRect(hwnd, &mut r);
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
        let layered = (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_LAYERED.0 != 0;
        let (mut key, mut alpha, mut flags) =
            (Default::default(), 0u8, LAYERED_WINDOW_ATTRIBUTES_FLAGS(0));
        let attrs = layered
            && GetLayeredWindowAttributes(hwnd, Some(&mut key), Some(&mut alpha), Some(&mut flags))
                .is_ok();
        let area = i64::from((r.right - r.left).max(0)) * i64::from((r.bottom - r.top).max(0));
        let undrawn_layer = layered && (!attrs || alpha == 0);
        let drawn = IsWindowVisible(hwnd).as_bool() && cloaked == 0 && area > 0 && !undrawn_layer;
        let class = String::from_utf16_lossy(&class[..n]);
        Seen { pid, class, drawn }
    }
}

fn foreground() -> isize {
    // SAFETY: a plain query.
    unsafe { GetForegroundWindow() }.0 as isize
}

struct Watch {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<Vec<String>>,
}

/// Samples every top-level window of every process and the foreground window every 100 ms.
fn start_watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = Arc::clone(&stop);
    let (baseline, first_fg) = (visible_windows(), foreground());
    let root = scope::root_pid();
    let handle = std::thread::spawn(move || {
        let (mut failures, mut seen, mut fg) = (Vec::new(), HashSet::new(), first_fg);
        let mut hosts = scope::HostWindows::default();
        while !stop2.load(Ordering::SeqCst) {
            failures.extend(first_sightings(
                visible_windows(),
                &baseline,
                &mut seen,
                &mut hosts,
                root,
                &describe,
                &scope::chain_of,
            ));
            if foreground() != fg {
                fg = foreground();
                let now = describe(fg);
                if hosts.foreground_counts(fg, &scope::chain_of(now.pid), &now.class, root) {
                    failures.push(format!("foreground changed to {now:?}"));
                }
            }
            std::thread::sleep(SAMPLE);
        }
        failures
    });
    Watch { stop, handle }
}

/// One sample of the new-window rule. A window in the baseline or already handled is skipped before anything is
/// looked up: the owner chain takes a full Toolhelp process snapshot, and taking one per seen window on every 100 ms
/// tick slowed the watch on a loaded machine (V032 review). A first sighting is described, its chain read once, noted
/// for the host rule, and reported when it counts (drawn, or not tao's event target, and not another program's).
fn first_sightings(
    windows: impl IntoIterator<Item = isize>,
    baseline: &HashSet<isize>,
    seen: &mut HashSet<isize>,
    hosts: &mut scope::HostWindows,
    root: u32,
    describe: &dyn Fn(isize) -> Seen,
    chain_of: &dyn Fn(u32) -> Vec<scope::Link>,
) -> Vec<String> {
    let mut failures = Vec::new();
    for h in windows {
        if baseline.contains(&h) || !seen.insert(h) {
            continue;
        }
        let w = describe(h);
        let chain = chain_of(w.pid);
        hosts.note_new(h, &chain, &w.class);
        if (w.drawn || w.class != TAO_CLASS) && !scope::is_foreign_window(&chain, &w.class, root) {
            failures.push(format!("new window: {w:?}"));
        }
    }
    failures
}

#[test]
fn a_window_already_seen_is_not_looked_up_again() {
    let lookups = std::cell::Cell::new(0);
    let chain_of = |_: u32| {
        lookups.set(lookups.get() + 1);
        Vec::new()
    };
    let describe = |h: isize| Seen {
        pid: 1,
        class: if h == 3 {
            "drawn".into()
        } else {
            TAO_CLASS.into()
        },
        drawn: h == 3,
    };
    let (baseline, mut seen) = (HashSet::from([1_isize]), HashSet::new());
    let mut hosts = scope::HostWindows::default();
    let mut failures = Vec::new();
    for _tick in 0..3 {
        failures.extend(first_sightings(
            [1, 2, 3],
            &baseline,
            &mut seen,
            &mut hosts,
            0,
            &describe,
            &chain_of,
        ));
    }
    assert_eq!(
        lookups.get(),
        2,
        "one owner lookup per new window, not per tick"
    );
    assert_eq!(
        failures.len(),
        1,
        "the drawn new window is reported once: {failures:?}"
    );
}

impl Watch {
    fn finish(self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        self.handle
            .join()
            .unwrap_or_else(|_| vec!["the watch thread failed".into()])
    }
}

// ------------------------------------------------------------------------------------------------ processes

/// A child this test started, ended with its tree when dropped unless it already exited.
struct Owned(Child);

impl Drop for Owned {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = Command::new("taskkill")
                .args(["/PID", &self.0.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            let _ = self.0.wait();
        }
    }
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn mkdir(path: &Path) {
    std::fs::create_dir_all(path).unwrap_or_else(|e| panic!("mkdir {}: {e}", path.display()));
}

fn log_file(path: &Path) -> Stdio {
    Stdio::from(std::fs::File::create(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

fn lab_python() -> PathBuf {
    let lab = std::env::var_os("NQT_LAB").map_or_else(
        || PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab"),
        PathBuf::from,
    );
    lab.join(r".venv\Scripts\python.exe")
}

/// The plain page on 127.0.0.1:8812, served from the run folder; ready when the port answers through Node.
fn start_page(run: &Path) -> Owned {
    let site = run.join("site");
    mkdir(&site);
    std::fs::write(site.join("index.html"), PAGE).expect("page");
    let mut cmd = Command::new(lab_python());
    cmd.args([
        "-E",
        "-s",
        "-m",
        "http.server",
        &PAGE_PORT.to_string(),
        "--bind",
        "127.0.0.1",
    ])
    .arg("--directory")
    .arg(&site)
    .stdin(Stdio::null())
    .stdout(log_file(&run.join("page.out.log")))
    .stderr(log_file(&run.join("page.err.log")))
    .creation_flags(CREATE_NO_WINDOW);
    let mut page = Owned(cmd.spawn().expect("the page server"));
    let started = Instant::now();
    while started.elapsed() < WAIT {
        if node(&[
            "--input-type=module",
            "-e",
            PAGE_UP_JS,
            &PAGE_PORT.to_string(),
        ])
        .trim()
            == "up"
        {
            return page;
        }
        if let Ok(Some(status)) = page.0.try_wait() {
            panic!("the page server exited ({status}); is port {PAGE_PORT} taken?");
        }
    }
    panic!("the page server was not up within 60 s");
}

const PAGE_UP_JS: &str = "try { const r = await fetch(`http://127.0.0.1:${process.argv[1]}/index.html`); console.log(r.ok ? 'up' : 'down') } catch { await new Promise((r) => setTimeout(r, 200)); console.log('down') }";

fn node(args: &[&str]) -> String {
    let out = Command::new("node")
        .args(args)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node: {e}"));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// The launch prelude's PATH: no build tools, so a hidden MinGW runtime dependency fails here too.
fn clean_path() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    path.split(';')
        .filter(|p| {
            let lower = p.to_ascii_lowercase();
            !lower.starts_with(r"d:\dev\mingw") && !lower.starts_with(r"d:\dev\cargo")
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn launch_shell(run: &Path, lab: &Path, save_dir: &Path) -> Owned {
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let mut cmd = Command::new(exe);
    cmd.arg("--attach-url")
        .arg(format!("http://127.0.0.1:{PAGE_PORT}/index.html"))
        .arg("--lab")
        .arg(lab)
        .arg("--save-dir")
        .arg(save_dir)
        .arg("--webview-data-dir")
        .arg(run.join("wv"))
        .arg("--config-dir")
        .arg(run.join("config"))
        .env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(log_file(&run.join("shell.out.log")))
        .stderr(log_file(&run.join("shell.err.log")))
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
    Owned(
        cmd.spawn()
            .unwrap_or_else(|e| panic!("cannot start {}: {e}", exe.display())),
    )
}

/// The engine's debugging port (port 0) from DevToolsActivePort in the profile folder.
fn devtools_port(run: &Path, shell: &mut Owned) -> u16 {
    let file = run.join(r"wv\EBWebView\DevToolsActivePort");
    let started = Instant::now();
    while started.elapsed() < WAIT {
        let port = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| t.lines().next()?.trim().parse().ok());
        if let Some(port) = port {
            return port;
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            panic!("the shell exited ({status}) before its debugging port was up");
        }
        std::thread::sleep(SAMPLE);
    }
    panic!("no DevToolsActivePort under {}", file.display());
}

/// Evaluates an expression in the page whose URL starts with the prefix, as a user gesture, once it exists.
const EVAL_JS: &str = r#"const [port, prefix, timeoutMs, expression] = process.argv.slice(1);
const evaluate = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); ws.onerror = rej;
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== 1) return; ws.close(); res(m.result) };
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } })) });
let last = { error: 'no page target' };
for (const end = Date.now() + Number(timeoutMs); Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
  try { const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith(prefix));
    if (!page) continue; const r = await evaluate(page.webSocketDebuggerUrl);
    last = r.exceptionDetails ? { error: JSON.stringify(r.exceptionDetails) } : { value: r.result.value }; if (last.value !== undefined) break } catch (e) { last = { error: String(e) } }
}
console.log(JSON.stringify(last));
"#;

fn eval_in_page(port: u16, prefix: &str, expression: &str) -> Value {
    let (port, timeout) = (port.to_string(), WAIT.as_millis().to_string());
    let args = [
        "--input-type=module",
        "-e",
        EVAL_JS,
        &port,
        prefix,
        &timeout,
        expression,
    ];
    let text = node(&args);
    serde_json::from_str(text.trim()).unwrap_or_else(|_| panic!("CDP gave no JSON: {text}"))
}

/// Asks the app to close (WM_CLOSE to its own top-level windows), then waits; ends it only if it hangs.
fn close_shell(shell: &mut Owned) {
    for h in all_windows() {
        let w = describe(h);
        if w.pid == shell.0.id() && w.class != TAO_CLASS {
            // SAFETY: posting a message to a window of a process this test started.
            let _ =
                unsafe { PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) && matches!(shell.0.try_wait(), Ok(None)) {
        std::thread::sleep(SAMPLE);
    }
}

// ------------------------------------------------------------------------------------------------ the cases

/// Every file under a folder (not through links), by path and bytes.
fn files(dir: &Path) -> BTreeSet<(PathBuf, Vec<u8>)> {
    let mut out = BTreeSet::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).into_iter().flatten().flatten() {
            let kind = entry.file_type().expect("file type");
            if kind.is_dir() && !kind.is_symlink() {
                stack.push(entry.path());
            } else {
                out.insert((
                    entry.path(),
                    std::fs::read(entry.path()).unwrap_or_default(),
                ));
            }
        }
    }
    out
}

/// The owner's Downloads folder, by name only (read-only).
fn owner_downloads() -> BTreeSet<String> {
    let dir = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("Downloads");
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

/// A fresh run: the fake lab, a save folder outside it, and the folders the shell may use.
struct Run {
    root: PathBuf,
    lab: PathBuf,
}

fn new_run(tag: &str) -> Run {
    let root = PathBuf::from(RUN_ROOT).join(format!("dl-{tag}-{}", stamp()));
    let lab = root.join("fake-nq-lab-tree");
    for dir in [
        r"results",
        r"experiments\exports",
        r"terminal\state",
        r"src",
    ] {
        mkdir(&lab.join(dir));
    }
    // What the shell's lab check accepts (window::folders::check_lab): the venv interpreter, the research config,
    // the backend entry and the page build, as empty files. Without them setup refuses the lab before the window.
    for file in [
        r".venv\Scripts\python.exe",
        r"src\nq_lab\config.py",
        r"terminal\backend\nq_terminal\__main__.py",
        r"terminal\web\dist\index.html",
    ] {
        let path = lab.join(file);
        mkdir(path.parent().expect("a parent folder"));
        std::fs::write(&path, b"").expect("lab marker file");
    }
    std::fs::write(lab.join(r"results\ledger.csv"), b"run_id,sharpe\nr1,0.5\n").expect("ledger");
    mkdir(&root.join("saves"));
    Run { root, lab }
}

fn shell_log(run: &Path) -> Vec<Value> {
    std::fs::read_to_string(run.join(r"config\logs\shell.log"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn logged(run: &Path, event: &str) -> Option<Value> {
    shell_log(run).into_iter().find(|v| v["event"] == event)
}

/// The blob export the bridge's saveFile makes: an object-URL anchor with a download name.
fn export_js(name: &str, body: &str) -> String {
    format!(
        "(() => {{ window.__saveOutcomes = []; window.addEventListener('nqt:save-outcome', (ev) => window.__saveOutcomes.push(ev.detail)); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([{}], {{ type: 'text/csv' }})); a.download = {}; document.body.append(a); a.click(); return 'clicked' }})()",
        serde_json::to_string(body).expect("body"),
        serde_json::to_string(name).expect("name")
    )
}

/// Waits until the page's own document is committed and loaded. The debugging list names the target by its address
/// while the initial blank document can still be the one that answers; a click and a listener put there are lost
/// when the page replaces it (the download then carries a `blob:null` address and the page hears nothing).
fn wait_page_loaded(port: u16, prefix: &str) {
    let probe = format!(
        "(document.readyState === 'complete' && location.href.startsWith({})) ? 'loaded' : 'loading'",
        serde_json::to_string(prefix).expect("prefix")
    );
    let started = Instant::now();
    while started.elapsed() < WAIT {
        if eval_in_page(port, prefix, &probe)["value"] == "loaded" {
            return;
        }
        std::thread::sleep(SAMPLE);
    }
    panic!("the page did not finish loading within 60 s");
}

/// What one launch saw: the global watch, the shell log, and the `nqt:save-outcome` events the page received.
struct Outcome {
    watch: Vec<String>,
    log: Vec<Value>,
    page: Vec<Value>,
}

/// The `download_outcome` lines of the shell log (what `report` told the page, and whether the call failed).
fn outcome_lines(log: &[Value]) -> Vec<&Value> {
    log.iter()
        .filter(|v| v["event"] == "download_outcome")
        .collect()
}

/// The shell told the page exactly one outcome for the one download, and both views (the log and the page's own
/// event) agree on it. A refused or failed save must never read `saved`.
fn assert_told(outcome: &Outcome, want: &str) {
    let lines = outcome_lines(&outcome.log);
    assert_eq!(lines.len(), 1, "download_outcome lines: {:?}", outcome.log);
    assert_eq!(lines[0]["outcome"], want, "logged outcome: {:?}", lines[0]);
    assert!(
        lines[0]["told_error"].is_null(),
        "the page could not be told: {:?}",
        lines[0]
    );
    assert_eq!(outcome.page.len(), 1, "page events: {:?}", outcome.page);
    assert_eq!(outcome.page[0]["outcome"], want, "page event");
    assert!(
        outcome.page[0]["uri"]
            .as_str()
            .is_some_and(|u| u.starts_with("blob:")),
        "the page event carries the download's own address: {:?}",
        outcome.page[0]
    );
}

/// Launches the shell over the page, clicks the export, waits until `done` holds, settles, closes.
fn run_export(
    run: &Run,
    save_dir: &Path,
    name: &str,
    body: &str,
    done: &dyn Fn() -> bool,
) -> Outcome {
    let _page = start_page(&run.root);
    let watch = start_watch();
    let mut shell = launch_shell(&run.root, &run.lab, save_dir);
    let port = devtools_port(&run.root, &mut shell);
    let prefix = format!("http://127.0.0.1:{PAGE_PORT}/");
    wait_page_loaded(port, &prefix);
    let clicked = eval_in_page(port, &prefix, &export_js(name, body));
    assert_eq!(
        clicked["value"], "clicked",
        "the export did not run: {clicked}"
    );
    let started = Instant::now();
    while started.elapsed() < WAIT && !done() {
        std::thread::sleep(SAMPLE);
    }
    std::thread::sleep(SETTLE);
    let events = eval_in_page(
        port,
        &prefix,
        "JSON.stringify(window.__saveOutcomes ?? null)",
    );
    let page = events["value"]
        .as_str()
        .and_then(|text| serde_json::from_str::<Vec<Value>>(text).ok())
        .unwrap_or_else(|| panic!("the page's outcome events could not be read: {events}"));
    close_shell(&mut shell);
    drop(shell);
    Outcome {
        watch: watch.finish(),
        log: shell_log(&run.root),
        page,
    }
}

fn assert_clean(outcome: &Outcome, run: &Run) {
    assert!(
        outcome.watch.is_empty(),
        "the global watch saw: {:?}",
        outcome.watch
    );
    let hook = outcome.log.iter().find(|v| v["event"] == "download_hook");
    assert!(
        hook.is_some_and(|h| h["error"].is_null()),
        "the handler was not installed: {hook:?}"
    );
    let backstop = run.root.join(r"config\downloads");
    assert!(
        files(&backstop).is_empty(),
        "a file reached the backstop folder"
    );
}

#[test]
fn a_blob_export_lands_only_at_the_save_dir() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let run = new_run("saved");
    let (name, body) = (
        "export.csv",
        format!("date,close\n2021-12-30,16320.08\nrun,{}\n", stamp()),
    );
    let (saves, owner_before, lab_before) =
        (run.root.join("saves"), owner_downloads(), files(&run.lab));
    let target = saves.join(name);
    let done = || {
        std::fs::read(&target).is_ok_and(|b| b == body.as_bytes())
            && logged(&run.root, "download_saved").is_some()
    };
    let outcome = run_export(&run, &saves, name, &body, &done);
    assert_clean(&outcome, &run);
    assert_told(&outcome, "saved");
    assert_eq!(
        std::fs::read(&target).ok(),
        Some(body.clone().into_bytes()),
        "the file at the save path"
    );
    let only: BTreeSet<_> = [(target.clone(), body.into_bytes())].into();
    assert_eq!(files(&saves), only, "anything else in the save folder");
    assert_eq!(files(&run.lab), lab_before, "the lab changed");
    assert_eq!(
        owner_downloads(),
        owner_before,
        "the owner's Downloads folder changed"
    );
    println!(
        "PASS saved at {} ({:?})",
        target.display(),
        logged(&run.root, "download_saved")
    );
}

/// A refused save folder: the refusal is logged and no file appears in it, in the lab, in the backstop folder or
/// in the owner's Downloads folder.
fn assert_refused_export(tag: &str, save_dir: &dyn Fn(&Run) -> PathBuf) {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let run = new_run(tag);
    let save = save_dir(&run);
    let (owner_before, lab_before, save_before) =
        (owner_downloads(), files(&run.lab), files(&save));
    let done = || {
        logged(&run.root, "download_refused").is_some()
            || logged(&run.root, "download_deleted").is_some()
    };
    let outcome = run_export(&run, &save, "export.csv", "date,close\n", &done);
    assert_clean(&outcome, &run);
    let refused = outcome
        .log
        .iter()
        .find(|v| v["event"] == "download_refused");
    assert!(
        refused.is_some(),
        "no download_refused line: {:?}",
        outcome.log
    );
    // The page is told "failed" (never "saved") for a refused path, once, with no error telling it.
    assert_told(&outcome, "failed");
    assert_eq!(
        files(&save),
        save_before,
        "a file appeared in the refused save folder"
    );
    assert_eq!(files(&run.lab), lab_before, "the lab changed");
    assert_eq!(
        owner_downloads(),
        owner_before,
        "the owner's Downloads folder changed"
    );
    println!("PASS {tag}: refused ({refused:?})");
}

#[test]
fn a_save_dir_junction_into_results_is_refused_and_keeps_no_file() {
    assert_refused_export("junction", &|run| {
        let link = run.root.join("out-link");
        let made = Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(run.lab.join("results"))
            .stdout(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success());
        assert!(made, "cannot make the junction");
        link
    });
}

#[test]
fn a_save_dir_inside_the_lab_outside_terminal_state_is_refused() {
    assert_refused_export("experiments", &|run| run.lab.join(r"experiments\exports"));
}

/// The switch parser refuses a save folder in a research folder before anything starts.
#[test]
fn a_save_dir_inside_results_is_refused_at_the_switch() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let run = new_run("results");
    let save = run.lab.join(r"results\exports");
    let lab_before = files(&run.lab);
    let watch = start_watch();
    let mut shell = launch_shell(&run.root, &run.lab, &save);
    let started = Instant::now();
    let status = loop {
        if let Ok(Some(status)) = shell.0.try_wait() {
            break status;
        }
        assert!(
            started.elapsed() < WAIT,
            "the shell did not refuse its switches"
        );
        std::thread::sleep(SAMPLE);
    };
    let seen = watch.finish();
    assert!(seen.is_empty(), "the global watch saw: {seen:?}");
    assert_eq!(status.code(), Some(EXIT_USAGE), "exit code");
    assert!(!save.exists(), "the refused save folder was created");
    assert_eq!(files(&run.lab), lab_before, "the lab changed");
    println!("PASS results: refused at the switch (exit {status})");
}
