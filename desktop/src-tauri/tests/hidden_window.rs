//! Under smoke and measure the window's `show()` is never called (04 standing rule 4; 04 D4.1).
//!
//! The same file runs for both test builds. Under `--features measure` the exe takes no switch, so the run folder
//! reaches it as `NQT_MEASURE_DIR` (webview data and config under D:\dev), no backend is started (the measure build
//! stays on its splash until stage B's spawn path exists, so HOME is an open item for measure), and the run is ready
//! when the shell log holds `page_finished` and `controller_visible`; the same watch, the same checks for new windows,
//! foreground changes and folders on C:, and the same born-failing show() copy (built with the measure feature).
//!
//! `cargo test --no-default-features --features smoke --test hidden_window` builds the smoke exe (Cargo builds the
//! package's binary with the test's features), starts the fixture backend on port 8796 (the W0A probe row of the
//! port table, never 8765) with its own state folder and NQT_JOBS=off, launches the shell with `--attach-url`,
//! `--webview-data-dir` and `--config-dir` under D:\dev\d4\hw\<run>, and samples a GLOBAL window and foreground
//! watch every 100 ms (EnumWindows over every process, plus GetForegroundWindow) until HOME has loaded (read over
//! the debugging protocol by a Node script) and the app has closed. It asserts: no new drawn window anywhere, no
//! foreground change, no new undrawn window other than tao's never-drawn event target (W0A), the smoke identity
//! and no release plugin in the shell's start record, the WEBVIEW2_* canaries scrubbed, and no new EBWebView or
//! dev.nqlab.* folder in the local or roaming app-data folders on C:.
//!
//! Born failing (`--ignored`): a temporary copy of the crate whose main.rs calls `show()` (sized and placed inside
//! the work area of the second monitor first, shown without activation, closed at once) must be caught by the same
//! watch. It refuses to run unless that monitor exists and is not the primary one.
#![cfg(any(feature = "smoke", feature = "measure"))]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files, copies the crate and starts processes it owns"
)]

use serde_json::Value;
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetLayeredWindowAttributes,
    GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    LAYERED_WINDOW_ATTRIBUTES_FLAGS, MONITORINFOF_PRIMARY, PostMessageW, WM_CLOSE, WS_EX_LAYERED,
};
use windows::core::BOOL;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(feature = "smoke")]
const FIXTURE_PORT: u16 = 8796;
const RUN_ROOT: &str = r"D:\dev\d4\hw";
const SAMPLE: Duration = Duration::from_millis(100);
#[cfg(feature = "smoke")]
const HOME_TIMEOUT: Duration = Duration::from_secs(120);
const TAO_CLASS: &str = "Tao Thread Event Target";
/// The feature this run of the file was built with, and the identity that build must carry.
const BUILD: &str = if cfg!(feature = "measure") {
    "measure"
} else {
    "smoke"
};
const BUILD_ID: &str = if cfg!(feature = "measure") {
    "dev.nqlab.terminal.measure"
} else {
    "dev.nqlab.terminal.smoke"
};
/// The measure build's one switch (src/window.rs MEASURE_DIR_VAR).
#[cfg(feature = "measure")]
const MEASURE_DIR_VAR: &str = "NQT_MEASURE_DIR";
/// How long a measure run keeps watching after the splash has loaded, so a reveal that follows it is caught.
#[cfg(feature = "measure")]
const SETTLE: Duration = Duration::from_millis(2_000);
#[cfg(feature = "measure")]
const READY_TIMEOUT_MEASURE: Duration = Duration::from_secs(60);
/// Screen 2 of this PC (the owner's secondary monitor): the born-failing window goes only here.
const SCREEN2_PROBE: (i32, i32) = (-1040, 268);
const SHOW_SIZE: (i32, i32) = (800, 600); // physical pixels, as in SHOW_PATCH
/// Room for the window frame around the planted physical size.
const FRAME_MARGIN: i32 = 64;
const CANARY_ARGS: &str = "--nqt-scrub-canary";

/// One launch at a time: the port, the watch and the debugging profile are shared by the tests of this file.
static ONE_RUN: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug)]
struct Seen {
    pid: u32,
    class: String,
    title: String,
    rect: (i32, i32, i32, i32),
    drawn: bool,
}

#[derive(Debug, Default)]
struct WatchReport {
    samples: u64,
    max_gap_ms: u128,
    new_visible: Vec<Seen>,
    foreground_changes: Vec<Seen>,
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that all_windows keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

/// Every top-level window of every process.
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

/// A window counts as drawn when it is visible, not cloaked, has an area, and is not a layered window that never
/// got its attributes (or has alpha 0), which is how tao keeps its event-target window unseen (W0A).
fn describe(handle: isize) -> Seen {
    let hwnd = HWND(handle as *mut _);
    // SAFETY: read-only queries on a window handle; a handle that died in between just yields zeros.
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut class = [0u16; 256];
        let n = GetClassNameW(hwnd, &mut class) as usize;
        let mut title = [0u16; 256];
        let m = GetWindowTextW(hwnd, &mut title) as usize;
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
        let undrawn_layer = layered && (!attrs || alpha == 0);
        let area = i64::from((r.right - r.left).max(0)) * i64::from((r.bottom - r.top).max(0));
        let drawn = IsWindowVisible(hwnd).as_bool() && cloaked == 0 && area > 0 && !undrawn_layer;
        Seen {
            pid,
            class: String::from_utf16_lossy(&class[..n]),
            title: String::from_utf16_lossy(&title[..m]),
            rect: (r.left, r.top, r.right, r.bottom),
            drawn,
        }
    }
}

fn foreground() -> isize {
    // SAFETY: a plain query.
    unsafe { GetForegroundWindow() }.0 as isize
}

struct Watch {
    stop: Arc<AtomicBool>,
    drawn_seen: Arc<AtomicBool>,
    handle: JoinHandle<WatchReport>,
}

fn start_watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let drawn_seen = Arc::new(AtomicBool::new(false));
    let (stop2, drawn2) = (Arc::clone(&stop), Arc::clone(&drawn_seen));
    let baseline = visible_windows();
    let first_fg = foreground();
    let handle = std::thread::spawn(move || {
        let mut report = WatchReport::default();
        let (mut seen, mut fg, mut last) = (HashSet::new(), first_fg, Instant::now());
        while !stop2.load(Ordering::SeqCst) {
            for h in visible_windows() {
                if !baseline.contains(&h) && seen.insert(h) {
                    let w = describe(h);
                    drawn2.fetch_or(w.drawn, Ordering::SeqCst);
                    report.new_visible.push(w);
                }
            }
            let now = foreground();
            if now != fg {
                report.foreground_changes.push(describe(now));
                fg = now;
            }
            report.samples += 1;
            report.max_gap_ms = report.max_gap_ms.max(last.elapsed().as_millis());
            last = Instant::now();
            std::thread::sleep(SAMPLE);
        }
        report
    });
    Watch {
        stop,
        drawn_seen,
        handle,
    }
}

impl Watch {
    fn finish(self) -> WatchReport {
        self.stop.store(true, Ordering::SeqCst);
        self.handle.join().unwrap_or_default()
    }
}

/// What fails a run: any drawn new window from any process, any foreground change, and any undrawn new window
/// that is not tao's event target.
fn failures(report: &WatchReport) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in &report.new_visible {
        if w.drawn {
            out.push(format!("drawn window titled {:?}: {w:?}", w.title));
        } else if w.class != TAO_CLASS {
            out.push(format!("unexpected undrawn window: {w:?}"));
        }
    }
    for w in &report.foreground_changes {
        out.push(format!("foreground changed to: {w:?}"));
    }
    out
}

fn seen(class: &str, drawn: bool) -> Seen {
    let (title, rect) = (String::new(), (0, 0, 1, 1));
    Seen {
        pid: 1,
        class: class.into(),
        title,
        rect,
        drawn,
    }
}

fn report(new_visible: Vec<Seen>, foreground_changes: Vec<Seen>) -> WatchReport {
    WatchReport {
        samples: 10,
        max_gap_ms: 100,
        new_visible,
        foreground_changes,
    }
}

#[test]
fn watch_judge_catches_planted_windows() {
    assert!(failures(&report(vec![seen(TAO_CLASS, false)], vec![])).is_empty());
    for planted in [
        report(vec![seen("Tauri Window", true)], vec![]),
        report(vec![seen(TAO_CLASS, true)], vec![]),
        report(vec![seen("Chrome_WidgetWin_1", false)], vec![]),
        report(vec![], vec![seen("Tauri Window", false)]),
    ] {
        assert!(
            !failures(&planted).is_empty(),
            "a planted window passed: {planted:?}"
        );
    }
}

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[cfg(feature = "smoke")]
fn terminal_dir() -> PathBuf {
    crate_dir().join("..").join("..")
}

/// The lab's venv interpreter: NQT_LAB, or %USERPROFILE%\nq-lab.
#[cfg(feature = "smoke")]
fn lab_python() -> PathBuf {
    let lab = std::env::var_os("NQT_LAB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab")
        });
    lab.join(".venv").join("Scripts").join("python.exe")
}

fn run_dir(tag: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let dir = PathBuf::from(RUN_ROOT).join(format!("{tag}-{stamp}"));
    std::fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    dir
}

/// A child process that is ended (with its tree) when dropped, unless it already exited.
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

fn log_file(path: &Path) -> Stdio {
    let file = std::fs::File::create(path)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", path.display()));
    Stdio::from(file)
}

/// The launch prelude's PATH: no build tools, so a hidden MinGW runtime dependency fails here.
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

fn without_webview2_vars(cmd: &mut Command) {
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
        {
            cmd.env_remove(name);
        }
    }
}

#[cfg(feature = "smoke")]
fn start_fixture(run: &Path) -> Owned {
    let python = lab_python();
    assert!(
        python.exists(),
        "the lab interpreter is missing: {}",
        python.display()
    );
    let terminal = terminal_dir();
    let backend = terminal.join("backend");
    for folder in ["state", "gate"] {
        std::fs::create_dir_all(run.join(folder))
            .unwrap_or_else(|e| panic!("cannot create {folder}: {e}"));
    }
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "fixture_app:app", "--app-dir"])
        .arg(backend.join("tests"))
        .args(["--host", "127.0.0.1", "--port", &FIXTURE_PORT.to_string()])
        .current_dir(&backend)
        .env("NQT_FIXTURE_DIR", backend.join("tests").join("fixtures"))
        .env("NQT_FIXTURE_LOG_DIR", run.join("gate"))
        .env("NQT_STATE_DIR", run.join("state"))
        .env("NQT_PORT", FIXTURE_PORT.to_string())
        .env("NQT_JOBS", "off")
        .env("NQT_PREWARM", "0")
        .env("PYTHONPATH", &backend)
        .stdin(Stdio::null())
        .stdout(log_file(&run.join("fixture.out.log")))
        .stderr(log_file(&run.join("fixture.err.log")))
        .creation_flags(CREATE_NO_WINDOW);
    without_webview2_vars(&mut cmd);
    let child = Owned(
        cmd.spawn()
            .unwrap_or_else(|e| panic!("cannot start the fixture backend: {e}")),
    );
    wait_for_fixture(child, &run.join("fixture.err.log"))
}

/// Ready when uvicorn reports its own start; refused when it exits (a taken port ends it at once).
#[cfg(feature = "smoke")]
fn wait_for_fixture(mut child: Owned, err_log: &Path) -> Owned {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(90) {
        let text = std::fs::read_to_string(err_log).unwrap_or_default();
        if text.contains("Application startup complete")
            && text.contains(&format!("127.0.0.1:{FIXTURE_PORT}"))
        {
            return child;
        }
        if let Ok(Some(status)) = child.0.try_wait() {
            panic!("the fixture backend exited ({status}) before it was ready:\n{text}");
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("the fixture backend was not ready within 90 s");
}

/// The shell's launch, per build: the smoke exe takes the frozen switches, the measure exe takes none and finds its
/// D: folders through NQT_MEASURE_DIR.
fn shell_command(exe: &Path, run: &Path, attach: &str) -> Command {
    let mut cmd = Command::new(exe);
    #[cfg(feature = "smoke")]
    cmd.args(["--attach-url", attach, "--webview-data-dir"])
        .arg(run.join("wv"))
        .arg("--config-dir")
        .arg(run.join("config"));
    #[cfg(feature = "measure")]
    {
        let _ = attach;
        cmd.env(MEASURE_DIR_VAR, run);
    }
    cmd
}

fn launch_shell(exe: &Path, run: &Path, attach: &str) -> Owned {
    let mut cmd = shell_command(exe, run, attach);
    cmd.env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(log_file(&run.join("shell.out.log")))
        .stderr(log_file(&run.join("shell.err.log")))
        .creation_flags(CREATE_NO_WINDOW);
    without_webview2_vars(&mut cmd);
    cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", CANARY_ARGS)
        .env("WEBVIEW2_USER_DATA_FOLDER", run.join("canary-udf"));
    Owned(
        cmd.spawn()
            .unwrap_or_else(|e| panic!("cannot start {}: {e}", exe.display())),
    )
}

/// The real debugging port the engine picked (port 0) from DevToolsActivePort in the profile folder.
#[cfg(feature = "smoke")]
fn devtools_port(run: &Path, shell: &mut Owned) -> u16 {
    let file = run.join("wv").join("EBWebView").join("DevToolsActivePort");
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if let Some(port) = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| t.lines().next()?.trim().parse().ok())
        {
            return port;
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            panic!("the shell exited ({status}) before its debugging port was up");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("no DevToolsActivePort under {} within 60 s", file.display());
}

/// HOME is ready when the four panels of the e2e HOME probe (web/e2e/perf/pages.ts) hold their content.
#[cfg(feature = "smoke")]
const HOME_PROBE_JS: &str = r#"const [port, prefix, timeoutMs] = process.argv.slice(1);
const R = [['NQ GP 1d', ['[role="img"][aria-label^="NQ1 Index: "]']], ['27F MON', ['[role="grid"]:not([aria-rowcount="1"])']], ['volmanaged_v0 EQ', ['ul[aria-label^="Key figures for "] .kpi-value', '[role="img"]']], ['REG', ['[role="grid"]:not([aria-rowcount="1"])']]];
const expr = `(() => { const R = ${JSON.stringify(R)}; const ok = (p) => { const el = document.querySelector('[data-nqt-title="' + p[0] + '"]'); return el !== null && p[1].every((s) => el.querySelector(s) !== null) };
  const quiet = document.querySelector('p.ws-empty') === null && document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') === null;
  return JSON.stringify({ ready: quiet && R.every(ok), panels: document.querySelectorAll('[data-nqt-title]').length, visibility: document.visibilityState, url: location.href }) })()`;
const evaluate = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); ws.onerror = rej;
  ws.onmessage = (ev) => { ws.close(); res(JSON.parse(JSON.parse(ev.data).result.result.value)) };
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })) });
let last = { ready: false, reason: 'no page target' };
for (const end = Date.now() + Number(timeoutMs); Date.now() < end && !last.ready; await new Promise((r) => setTimeout(r, 250))) {
  try { const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith(prefix));
    if (page) last = await evaluate(page.webSocketDebuggerUrl) } catch (e) { last = { ready: false, reason: String(e) } }
}
console.log(JSON.stringify(last));
"#;

#[cfg(feature = "smoke")]
fn wait_for_home(port: u16, prefix: &str) -> Value {
    let out = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            HOME_PROBE_JS,
            &port.to_string(),
            prefix,
        ])
        .arg(HOME_TIMEOUT.as_millis().to_string())
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node for the HOME probe: {e}"));
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(text.trim()).unwrap_or_else(|_| {
        panic!(
            "HOME probe gave no JSON: {text} {}",
            String::from_utf8_lossy(&out.stderr)
        )
    })
}

/// Asks the app to close (WM_CLOSE to its own top-level windows), then waits; ends it only if it hangs.
fn close_shell(shell: &mut Owned) -> bool {
    for h in all_windows() {
        let w = describe(h);
        if w.pid == shell.0.id() && w.class != TAO_CLASS {
            // SAFETY: posting a message to a window of a process this test started.
            let _ =
                unsafe { PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if matches!(shell.0.try_wait(), Ok(Some(_))) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Folders a WebView2 or Tauri default would create on C: for this identity.
fn c_drive_folders() -> HashSet<PathBuf> {
    let roots = ["LOCALAPPDATA", "APPDATA"]
        .into_iter()
        .filter_map(std::env::var_os);
    let entries = roots
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flat_map(|dir| dir.flatten());
    let ours = |name: &str| {
        name.starts_with("dev.nqlab") || name == "ebwebview" || name.starts_with("nq-lab-terminal")
    };
    entries
        .filter(|e| ours(&e.file_name().to_string_lossy().to_ascii_lowercase()))
        .map(|e| e.path())
        .collect()
}
struct RunResult {
    run: PathBuf,
    shell_pid: u32,
    home: Value,
    closed: bool,
    report: WatchReport,
    new_c_folders: Vec<PathBuf>,
}

fn run_once(exe: &Path, tag: &str, stop_on_drawn: bool) -> RunResult {
    let run = run_dir(tag);
    let before = c_drive_folders();
    #[cfg(feature = "smoke")]
    let _fixture = start_fixture(&run);
    #[cfg(feature = "smoke")]
    let attach = format!("http://127.0.0.1:{FIXTURE_PORT}/");
    #[cfg(feature = "measure")]
    let attach = String::new();
    let watch = start_watch();
    let mut shell = launch_shell(exe, &run, &attach);
    let shell_pid = shell.0.id();
    let home = if stop_on_drawn {
        wait_for_drawn(&watch, &mut shell)
    } else {
        wait_until_ready(&run, &mut shell, &attach)
    };
    let closed = close_shell(&mut shell);
    drop(shell);
    std::thread::sleep(Duration::from_millis(800));
    let report = watch.finish();
    let new_c_folders = c_drive_folders().difference(&before).cloned().collect();
    RunResult {
        run,
        shell_pid,
        home,
        closed,
        report,
        new_c_folders,
    }
}

/// Smoke: HOME loaded over the debugging protocol.
#[cfg(feature = "smoke")]
fn wait_until_ready(run: &Path, shell: &mut Owned, attach: &str) -> Value {
    let port = devtools_port(run, shell);
    wait_for_home(port, attach)
}

/// Measure: the splash has loaded and the controller is visible, then a settle time with the watch still running.
#[cfg(feature = "measure")]
fn wait_until_ready(run: &Path, shell: &mut Owned, attach: &str) -> Value {
    let _ = attach;
    let started = Instant::now();
    while started.elapsed() < READY_TIMEOUT_MEASURE {
        let log = shell_log_if_any(run);
        let has = |event: &str| log.iter().any(|e| e["event"] == event);
        if has("page_finished") && has("controller_visible") {
            std::thread::sleep(SETTLE);
            return serde_json::json!({ "ready": true });
        }
        if let Ok(Some(status)) = shell.0.try_wait() {
            return serde_json::json!({ "ready": false, "exited": status.to_string(), "log": log });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    serde_json::json!({ "ready": false, "reason": "timeout" })
}

/// Born-failing runs: stop as soon as a drawn window appears (or after 60 s), so it is closed at once.
fn wait_for_drawn(watch: &Watch, shell: &mut Owned) -> Value {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if watch.drawn_seen.load(Ordering::SeqCst) {
            return serde_json::json!({ "drawn_after_ms": started.elapsed().as_millis() });
        }
        if matches!(shell.0.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    serde_json::json!({ "drawn_after_ms": null })
}

fn shell_log_if_any(run: &Path) -> Vec<Value> {
    let path = run.join("config").join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn shell_log(run: &Path) -> Vec<Value> {
    let log = shell_log_if_any(run);
    assert!(
        !log.is_empty(),
        "no shell log under {}",
        run.join("config").display()
    );
    log
}

fn write_record(result: &RunResult, verdict: &[String]) {
    let record = serde_json::json!({
        "run": result.run.display().to_string(), "shell_pid": result.shell_pid, "home": result.home,
        "closed": result.closed, "samples": result.report.samples, "max_gap_ms": result.report.max_gap_ms as u64,
        "new_visible": result.report.new_visible.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>(),
        "foreground_changes": result.report.foreground_changes.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>(),
        "new_c_folders": result.new_c_folders, "failures": verdict,
    });
    let path = result.run.join("record.json");
    let text = serde_json::to_string_pretty(&record).unwrap_or_default();
    std::fs::write(&path, text).unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    println!("record: {}", path.display());
}

#[cfg(feature = "smoke")]
#[test]
fn smoke_build_stays_hidden_through_home_and_close() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let result = run_once(exe, "smoke", false);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let (r, home) = (&result.report, &result.home);
    let checks = [
        (
            home["ready"] == true,
            format!("HOME never became ready: {home}"),
        ),
        (
            home["visibility"] == "visible",
            "the page must run behind the hidden window".into(),
        ),
        (
            result.closed,
            "the shell did not close on WM_CLOSE within 20 s".into(),
        ),
        (verdict.is_empty(), format!("the watch saw: {verdict:#?}")),
        (
            r.samples >= 20 && r.max_gap_ms < 1_000,
            format!("watch gaps: {} samples, {} ms", r.samples, r.max_gap_ms),
        ),
        (
            result.new_c_folders.is_empty(),
            format!("new folders on C: {:?}", result.new_c_folders),
        ),
        (
            !result.run.join("canary-udf").exists(),
            "WEBVIEW2_USER_DATA_FOLDER reached the engine".into(),
        ),
    ];
    for (ok, why) in checks {
        assert!(ok, "{why}");
    }
    check_start_record(&shell_log(&result.run));
}

/// Measure: the build reaches its window (identity, controller visible, splash loaded) and stays hidden.
#[cfg(feature = "measure")]
#[test]
fn measure_build_stays_hidden_through_splash_and_close() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let result = run_once(exe, "measure", false);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let (r, home) = (&result.report, &result.home);
    let checks = [
        (
            home["ready"] == true,
            format!("the measure build never reached its window: {home}"),
        ),
        (
            result.closed,
            "the shell did not close on WM_CLOSE within 20 s".into(),
        ),
        (verdict.is_empty(), format!("the watch saw: {verdict:#?}")),
        (
            r.samples >= 20 && r.max_gap_ms < 1_000,
            format!("watch gaps: {} samples, {} ms", r.samples, r.max_gap_ms),
        ),
        (
            result.new_c_folders.is_empty(),
            format!("new folders on C: {:?}", result.new_c_folders),
        ),
        (
            !result.run.join("canary-udf").exists(),
            "WEBVIEW2_USER_DATA_FOLDER reached the engine".into(),
        ),
    ];
    for (ok, why) in checks {
        assert!(ok, "{why}");
    }
    check_start_record(&shell_log(&result.run));
}

fn check_start_record(log: &[Value]) {
    let start = log
        .iter()
        .find(|e| e["event"] == "start")
        .unwrap_or_else(|| panic!("no start record: {log:?}"));
    assert_eq!(start["identifier"], BUILD_ID);
    assert_eq!(
        start["release_plugins"], false,
        "a test build registered the release plugins"
    );
    assert_eq!(start[BUILD], true);
    assert_eq!(start["test_build"], true);
    let scrubbed: Vec<&str> = start["scrubbed"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    for canary in [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_USER_DATA_FOLDER",
    ] {
        assert!(
            scrubbed.contains(&canary),
            "{canary} was not scrubbed: {scrubbed:?}"
        );
    }
    assert!(
        log.iter().any(|e| e["event"] == "controller_visible"),
        "after_build never made the controller visible"
    );
    assert!(
        !log.iter().any(|e| e["event"] == "show_failed"),
        "show() was reached in a test build"
    );
}

const SHOW_ANCHOR: &str = "    smoke::after_build(&main, &launch)?;\n";
/// What the born-failing copy adds after the build: the window made visible. Not through tauri's `show()`, which
/// activates a window once tao has dropped its created-unfocused marker, but as `show()` would with no activation:
/// sized and placed inside screen 2 first, WS_EX_NOACTIVATE, then SW_SHOWNOACTIVATE.
const SHOW_PATCH: &str = r#"    main.set_min_size(None::<tauri::Size>)?;
    main.set_size(tauri::PhysicalSize::new(800u32, 600u32))?;
    main.set_position(tauri::PhysicalPosition::new(-1040i32, 268i32))?;
    {
        use windows::Win32::UI::WindowsAndMessaging as wm;
        let hwnd = main.hwnd()?;
        // SAFETY: style and show calls on the window this process just built.
        unsafe {
            let ex = wm::GetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE);
            wm::SetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE, ex | wm::WS_EX_NOACTIVATE.0 as isize);
            let _ = wm::ShowWindow(hwnd, wm::SW_SHOWNOACTIVATE);
        }
    }
"#;

/// The second monitor's work area, if (-1040, 268) lies on a monitor that is not the primary one.
fn screen2_work_area() -> Result<RECT, String> {
    let point = POINT {
        x: SCREEN2_PROBE.0,
        y: SCREEN2_PROBE.1,
    };
    // SAFETY: plain monitor queries.
    let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONULL) };
    if monitor.is_invalid() {
        return Err("no monitor at the screen 2 point".into());
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: info is a valid, sized MONITORINFO.
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err("GetMonitorInfoW failed".into());
    }
    if info.dwFlags & MONITORINFOF_PRIMARY != 0 {
        return Err("the screen 2 point lies on the primary monitor".into());
    }
    let w = info.rcWork;
    let (right, bottom) = (
        SCREEN2_PROBE.0 + SHOW_SIZE.0 + FRAME_MARGIN,
        SCREEN2_PROBE.1 + SHOW_SIZE.1 + FRAME_MARGIN,
    );
    if SCREEN2_PROBE.0 < w.left || SCREEN2_PROBE.1 < w.top || right > w.right || bottom > w.bottom {
        return Err(format!(
            "the planted window and its frame would leave the work area {w:?}"
        ));
    }
    Ok(w)
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap_or_else(|e| panic!("cannot create {}: {e}", to.display()));
    let entries =
        std::fs::read_dir(from).unwrap_or_else(|e| panic!("cannot list {}: {e}", from.display()));
    for entry in entries.flatten() {
        let (source, target) = (entry.path(), to.join(entry.file_name()));
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "gen" || name == "target" {
            continue;
        }
        if source.is_dir() {
            copy_tree(&source, &target);
        } else {
            std::fs::copy(&source, &target)
                .unwrap_or_else(|e| panic!("cannot copy {}: {e}", source.display()));
        }
    }
}

fn build_show_copy(run: &Path) -> PathBuf {
    let copy = run.join("src-tauri");
    copy_tree(&crate_dir(), &copy);
    let main = copy.join("src").join("main.rs");
    let source = std::fs::read_to_string(&main).unwrap_or_default();
    assert!(
        source.contains(SHOW_ANCHOR),
        "the patch anchor is missing from main.rs"
    );
    let planted = format!("{SHOW_ANCHOR}{SHOW_PATCH}");
    std::fs::write(&main, source.replacen(SHOW_ANCHOR, &planted, 1))
        .unwrap_or_else(|e| panic!("patch: {e}"));
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let target = PathBuf::from(format!(r"D:\dev\targets\w4a-showcopy-{BUILD}"));
    let status = Command::new(cargo)
        .args([
            "build",
            "--locked",
            "--offline",
            "--no-default-features",
            "--features",
            BUILD,
        ])
        .current_dir(&copy)
        .env("CARGO_TARGET_DIR", &target)
        .stdout(log_file(&run.join("build.out.log")))
        .stderr(log_file(&run.join("build.err.log")))
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .unwrap_or_else(|e| panic!("cannot build the show() copy: {e}"));
    assert!(
        status.success(),
        "the show() copy did not build; see {}",
        run.join("build.err.log").display()
    );
    target.join("debug").join("nq-lab-terminal.exe")
}

#[test]
#[ignore = "born-failing proof: builds a crate copy that calls show() and shows it on screen 2 for a moment"]
fn a_build_that_calls_show_is_caught() {
    let _one = ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let area = match screen2_work_area() {
        Ok(area) => area,
        Err(why) => {
            println!("SKIPPED: {why}; the born-failing window may only appear on screen 2");
            return;
        }
    };
    println!("screen 2 work area: {area:?}");
    let exe = build_show_copy(&run_dir("showcopy-build"));
    let result = run_once(&exe, "showcopy", true);
    let verdict = failures(&result.report);
    write_record(&result, &verdict);
    let ours: Vec<&Seen> = result
        .report
        .new_visible
        .iter()
        .filter(|w| w.drawn && w.pid == result.shell_pid)
        .collect();
    assert!(
        !ours.is_empty(),
        "the watch missed the shown window: {:?}",
        result.report
    );
    assert!(
        !verdict.is_empty(),
        "the judge passed a run that showed a window"
    );
    for w in &ours {
        let (l, t, r, b) = w.rect;
        let inside = l >= area.left && t >= area.top && r <= area.right && b <= area.bottom;
        assert!(inside, "window left screen 2: {w:?}");
    }
    assert!(
        result.report.foreground_changes.is_empty(),
        "the shown copy took the foreground"
    );
}
