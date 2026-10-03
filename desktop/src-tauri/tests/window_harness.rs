//! Shared launch harness for the window, keys and dialog tests of the smoke build (04 D4.2), included by each of
//! them with `#[path = "window_harness.rs"] mod harness;` and also run on its own for its self-check.
//!
//! Every launch: the hidden smoke exe (`CARGO_BIN_EXE_nq-lab-terminal`), no build tools on PATH, CREATE_NO_WINDOW,
//! its WebView2 profile and config under `D:\dev\tmp\w4b-window-keys\runs\<tag>-<ms>`, and the GLOBAL window and
//! foreground watch (EnumWindows over every process plus GetForegroundWindow every 100 ms). The page is a static test
//! page served by the lab's venv python on 127.0.0.1:8810 (the w4b-window-keys row of the port table, never 8765)
//! and driven over the debugging protocol by a Node script (Node built-ins only).
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    dead_code,
    reason = "test harness: it writes and reads its own run files, starts processes it owns, and each including test \
              uses a part of it"
)]

use serde_json::Value;
use std::collections::HashSet;
use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HLOCAL, HWND, LPARAM, LocalFree, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW, SDDL_REVISION_1,
    SE_FILE_OBJECT,
};
use windows::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetLayeredWindowAttributes,
    GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    LAYERED_WINDOW_ATTRIBUTES_FLAGS, PostMessageW, WM_CLOSE, WS_EX_LAYERED,
};
use windows::core::{BOOL, HSTRING, PWSTR};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const RUN_ROOT: &str = r"D:\dev\tmp\w4b-window-keys\runs";
pub const PAGE_PORT: u16 = 8810;
pub const TAO_CLASS: &str = "Tao Thread Event Target";
const SAMPLE: Duration = Duration::from_millis(100);
const SETTLE: Duration = Duration::from_millis(1_000);
/// main.rs exit codes.
pub const EXIT_RUN: i32 = 1;
pub const EXIT_POLICY: i32 = 3;

/// One launch at a time per test binary: they share port 8810.
pub static ONE_RUN: Mutex<()> = Mutex::new(());

pub fn one_run() -> std::sync::MutexGuard<'static, ()> {
    ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Clone, Debug)]
pub struct Seen {
    pub pid: u32,
    pub class: String,
    pub title: String,
    pub rect: (i32, i32, i32, i32),
    pub drawn: bool,
}

#[derive(Debug, Default)]
pub struct WatchReport {
    pub samples: u64,
    pub max_gap_ms: u128,
    pub new_visible: Vec<Seen>,
    pub foreground_changes: Vec<Seen>,
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that all_windows keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

/// Every top-level window of every process.
pub fn all_windows() -> Vec<isize> {
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
pub fn describe(handle: isize) -> Seen {
    let hwnd = HWND(handle as *mut _);
    // SAFETY: read-only queries on a window handle; a handle that died in between just yields zeros.
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut class = [0u16; 256];
        let n = GetClassNameW(hwnd, &mut class) as usize;
        let mut title = [0u16; 512];
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

pub struct Watch {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<WatchReport>,
}

/// Starts the global watch: any new visible top-level window of any process, and any foreground change.
pub fn start_watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = Arc::clone(&stop);
    let (baseline, first_fg) = (visible_windows(), foreground());
    let handle = std::thread::spawn(move || {
        let mut report = WatchReport::default();
        let (mut seen, mut fg, mut last) = (HashSet::new(), first_fg, Instant::now());
        while !stop2.load(Ordering::SeqCst) {
            for h in visible_windows() {
                if !baseline.contains(&h) && seen.insert(h) {
                    report.new_visible.push(describe(h));
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
    Watch { stop, handle }
}

impl Watch {
    /// Stops the watch after a settle time, so a window that appears just after the shell exits is still seen.
    pub fn finish(self) -> WatchReport {
        std::thread::sleep(SETTLE);
        self.stop.store(true, Ordering::SeqCst);
        self.handle.join().unwrap_or_default()
    }
}

/// What fails a run: any drawn new window from any process, any foreground change, and any undrawn new window
/// that is not tao's event target.
pub fn failures(report: &WatchReport) -> Vec<String> {
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

/// Asserts a clean watch with enough samples.
pub fn assert_clean(report: &WatchReport) {
    let verdict = failures(report);
    assert!(verdict.is_empty(), "the global watch saw: {verdict:#?}");
    assert!(
        report.samples >= 5 && report.max_gap_ms < 1_000,
        "watch gaps: {} samples, {} ms",
        report.samples,
        report.max_gap_ms
    );
}

#[test]
fn the_watch_judge_catches_planted_windows() {
    let seen = |class: &str, drawn: bool| Seen {
        pid: 1,
        class: class.into(),
        title: String::new(),
        rect: (0, 0, 1, 1),
        drawn,
    };
    let report = |visible: Vec<Seen>, fg: Vec<Seen>| WatchReport {
        samples: 10,
        max_gap_ms: 100,
        new_visible: visible,
        foreground_changes: fg,
    };
    assert!(failures(&report(vec![seen(TAO_CLASS, false)], vec![])).is_empty());
    for planted in [
        report(vec![seen("Tauri Window", true)], vec![]),
        report(vec![seen("#32770", false)], vec![]),
        report(vec![], vec![seen("Tauri Window", true)]),
    ] {
        assert_eq!(failures(&planted).len(), 1, "a planted window passed");
    }
}

/// A fresh run folder under D:\dev\tmp\w4b-window-keys\runs.
pub fn run_dir(tag: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let dir = PathBuf::from(RUN_ROOT).join(format!("{tag}-{stamp}"));
    std::fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    dir
}

/// A child process that is ended (with its tree) when dropped, unless it already exited.
pub struct Owned(pub Child);

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

pub fn log_file(path: &Path) -> Stdio {
    let file = std::fs::File::create(path)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", path.display()));
    Stdio::from(file)
}

/// The launch prelude's PATH: no build tools, so a hidden MinGW runtime dependency fails here.
pub fn clean_path() -> String {
    let path = std::env::var("PATH").unwrap_or_default();
    path.split(';')
        .filter(|p| {
            let lower = p.to_ascii_lowercase();
            !lower.starts_with(r"d:\dev\mingw") && !lower.starts_with(r"d:\dev\cargo")
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// The test's own WEBVIEW2_* variables never reach a launch unless a test sets them on purpose.
pub fn without_webview2_vars(cmd: &mut Command) {
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

/// The lab's venv interpreter (NQT_LAB, or %USERPROFILE%\nq-lab), used only to serve the static test page.
pub fn lab_python() -> PathBuf {
    let lab = std::env::var_os("NQT_LAB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab")
        });
    lab.join(".venv").join("Scripts").join("python.exe")
}

/// The test page: key listeners in the capture phase, a reload marker, a print counter, the attribution link and a
/// look-alike of it.
pub const TEST_PAGE: &str = r#"<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><title>shell test page</title></head>
<body><h1>shell test page</h1>
<p><a id="attr" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a></p>
<p><a id="lookalike" href="https://www.tradingview.com.evil.example/" target="_blank">look-alike</a></p>
<script>
window.__keys = []; window.__prints = 0; window.__marker = Math.random().toString(36).slice(2);
addEventListener('keydown', (e) => { window.__keys.push((e.ctrlKey ? 'Ctrl+' : '') + e.key); }, true);
addEventListener('beforeprint', () => { window.__prints += 1; });
</script></body></html>
"#;

/// A static server that refuses to share its port (no SO_REUSEADDR), so a taken 8810 fails the test at once.
const SERVE_PY: &str = r#"import functools, http.server, sys
class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = False
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
with Server(("127.0.0.1", int(sys.argv[2])), handler) as server:
    print("READY", flush=True)
    server.serve_forever()
"#;

/// Starts the static page server on 8810 and waits for it.
pub fn start_page_server(run: &Path) -> Owned {
    let page = run.join("page");
    std::fs::create_dir_all(&page).expect("page folder");
    std::fs::write(page.join("index.html"), TEST_PAGE).expect("test page");
    serve_folder(run, &page)
}

/// Serves one folder on 8810 and waits for the server.
pub fn serve_folder(run: &Path, page: &Path) -> Owned {
    std::fs::write(run.join("serve.py"), SERVE_PY).expect("server script");
    let out = run.join("page-server.out.log");
    let mut cmd = Command::new(lab_python());
    cmd.args(["-E", "-s"])
        .arg(run.join("serve.py"))
        .arg(page)
        .arg(PAGE_PORT.to_string())
        .current_dir(run)
        .stdin(Stdio::null())
        .stdout(log_file(&out))
        .stderr(log_file(&run.join("page-server.err.log")))
        .creation_flags(CREATE_NO_WINDOW);
    let mut child = Owned(cmd.spawn().expect("start the page server"));
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(30) {
        if std::fs::read_to_string(&out)
            .unwrap_or_default()
            .contains("READY")
        {
            return child;
        }
        if let Ok(Some(status)) = child.0.try_wait() {
            let err = std::fs::read_to_string(run.join("page-server.err.log")).unwrap_or_default();
            panic!("the page server on {PAGE_PORT} exited ({status}): {err}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("the page server was not ready within 30 s");
}

pub fn page_url() -> String {
    format!("http://127.0.0.1:{PAGE_PORT}/index.html")
}

/// The smoke exe's required folders under the run folder.
pub fn base_args(run: &Path) -> Vec<OsString> {
    vec![
        "--webview-data-dir".into(),
        run.join("wv").into(),
        "--config-dir".into(),
        run.join("config").into(),
    ]
}

/// Launches the hidden smoke exe with these switches and extra variables (no build tools on PATH).
pub fn launch(run: &Path, args: &[OsString], env: &[(&str, OsString)]) -> Owned {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    cmd.args(args)
        .env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(log_file(&run.join("shell.out.log")))
        .stderr(log_file(&run.join("shell.err.log")))
        .creation_flags(CREATE_NO_WINDOW);
    without_webview2_vars(&mut cmd);
    for (name, value) in env {
        cmd.env(name, value);
    }
    Owned(cmd.spawn().expect("start the smoke exe"))
}

/// Waits for the shell to exit on its own; None when it is still running after the timeout.
pub fn wait_for_exit(shell: &mut Owned, timeout: Duration) -> Option<i32> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Ok(Some(status)) = shell.0.try_wait() {
            return status.code();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// The real debugging port the engine picked (port 0) from DevToolsActivePort in the profile folder.
pub fn devtools_port(run: &Path, shell: &mut Owned) -> u16 {
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

/// The Node prelude of every debugging-protocol script: the page target whose URL starts with the prefix, a
/// session, `evaluate`, `key` (raw key down then up), `targets` and `sleep`. The body ends by printing one JSON line.
const CDP_PRELUDE: &str = r#"const [port, prefix] = process.argv.slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
let target = null;
for (const end = Date.now() + 60000; Date.now() < end && !target; await sleep(200)) {
  try { target = (await targets()).find((t) => t.type === 'page' && t.url.startsWith(prefix)) ?? null } catch { }
}
if (!target) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(0) }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let next = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } };
const send = (method, params = {}) => new Promise((res) => { const id = ++next; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })) });
const evaluate = async (expression, extra = {}) => {
  const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...extra });
  if (m.error || m.result.exceptionDetails) return { error: JSON.stringify(m.error ?? m.result.exceptionDetails) };
  return m.result.result.value;
};
const key = async (k) => { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, ...k }); };
for (const end = Date.now() + 30000; Date.now() < end; await sleep(100)) {
  if (await evaluate("document.readyState === 'complete'") === true) break;
}
"#;

/// Runs a debugging-protocol script body against the page and returns its JSON line.
pub fn cdp(port: u16, prefix: &str, body: &str) -> Value {
    let script = format!("{CDP_PRELUDE}\n{body}\nws.close();\n");
    let out = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            &script,
            &port.to_string(),
            prefix,
        ])
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node: {e}"));
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text
        .lines()
        .rev()
        .find(|l| l.starts_with('{'))
        .unwrap_or("");
    serde_json::from_str(line).unwrap_or_else(|_| {
        panic!(
            "the script gave no JSON: {text} {}",
            String::from_utf8_lossy(&out.stderr)
        )
    })
}

/// Asks the app to close (WM_CLOSE to its own top-level windows), then waits; ends it only if it hangs.
pub fn close_shell(shell: &mut Owned) -> bool {
    for h in all_windows() {
        let w = describe(h);
        if w.pid == shell.0.id() && w.class != TAO_CLASS {
            // SAFETY: posting a message to a window of a process this test started.
            let _ =
                unsafe { PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
    }
    wait_for_exit(shell, Duration::from_secs(20)).is_some()
        || shell.0.try_wait().is_ok_and(|s| s.is_some())
}

/// The title of the shell's own window (hidden, but titled).
pub fn shell_title(pid: u32) -> Option<String> {
    all_windows()
        .into_iter()
        .map(describe)
        .find(|w| w.pid == pid && w.class != TAO_CLASS && !w.title.is_empty())
        .map(|w| w.title)
}

/// The shell log, one JSON object per line.
pub fn shell_log(run: &Path) -> Vec<Value> {
    let path = run.join("config").join("logs").join("shell.log");
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// The first log line of an event, waiting for it while the shell runs.
pub fn wait_for_event(run: &Path, event: &str, timeout: Duration) -> Option<Value> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(found) = shell_log(run).into_iter().find(|e| e["event"] == event) {
            return Some(found);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// The DACL of a folder as SDDL text.
pub fn dacl_sddl(dir: &Path) -> String {
    let mut sd = PSECURITY_DESCRIPTOR::default();
    let mut text = PWSTR::null();
    let name = HSTRING::from(dir.as_os_str());
    let what = DACL_SECURITY_INFORMATION;
    // SAFETY: reads the folder's security into a descriptor the system allocates, converts it and frees both.
    unsafe {
        let got =
            GetNamedSecurityInfoW(&name, SE_FILE_OBJECT, what, None, None, None, None, &mut sd);
        assert!(got.is_ok(), "cannot read the DACL of {}", dir.display());
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            sd,
            SDDL_REVISION_1,
            what,
            &mut text,
            None,
        )
        .expect("SDDL");
        let sddl = text.to_string().expect("UTF-16");
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        let _ = LocalFree(Some(HLOCAL(sd.0)));
        sddl
    }
}

/// Folders a WebView2 or Tauri default would create on C: for this identity.
pub fn c_drive_folders() -> HashSet<PathBuf> {
    let roots = ["LOCALAPPDATA", "APPDATA"]
        .into_iter()
        .filter_map(std::env::var_os);
    let entries = roots
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flat_map(|dir| dir.flatten());
    let ours = |name: &str| name.starts_with("dev.nqlab") || name == "ebwebview";
    entries
        .filter(|e| ours(&e.file_name().to_string_lossy().to_ascii_lowercase()))
        .map(|e| e.path())
        .collect()
}

/// A fake lab under the run folder (never the real lab): every required file, and the page build if asked.
pub fn fake_lab(run: &Path, dist: bool) -> PathBuf {
    let lab = run.join("fake-lab");
    let mut parts = vec![
        r".venv\Scripts\python.exe",
        r"src\nq_lab\config.py",
        r"terminal\backend\nq_terminal\__main__.py",
    ];
    if dist {
        parts.push(r"terminal\web\dist\index.html");
    }
    for part in parts {
        let path = lab.join(part);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("fake lab folder");
        std::fs::write(&path, b"").expect("fake lab file");
    }
    lab
}
