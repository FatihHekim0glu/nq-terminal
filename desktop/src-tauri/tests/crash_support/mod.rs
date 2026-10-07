//! Shared harness of the crash and smoke process tests: a tiny loopback page server on the W4B port 8813, the
//! hidden smoke exe launched against it, the GLOBAL window and foreground watch (EnumWindows over every process plus
//! GetForegroundWindow, every 100 ms), the shell log reader, the debugging-protocol helpers and the renderer kill.
//!
//! Nothing here shows a window: the smoke exe is launched hidden (it never calls `show()` without `--screen2`),
//! every child uses CREATE_NO_WINDOW, and the watch fails any run that put a drawn window or a foreground change on
//! the machine. Everything the harness writes lives under `D:\dev\d4\cs`. It never touches port 8765.
#![allow(
    dead_code,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it runs its own page server, reads its own run files and starts processes it owns"
)]

use serde_json::Value;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetLayeredWindowAttributes,
    GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    LAYERED_WINDOW_ATTRIBUTES_FLAGS, PostMessageW, WM_CLOSE, WS_EX_LAYERED,
};
use windows::core::BOOL;

#[path = "../hidden_support/scope.rs"]
pub mod scope;
use scope::Link;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The W4B crash-smoke slice's fixture port (never 8765).
pub const PAGE_PORT: u16 = 8813;
pub const RUN_ROOT: &str = r"D:\dev\d4\cs";
const SAMPLE: Duration = Duration::from_millis(100);
const TAO_CLASS: &str = "Tao Thread Event Target";
pub const READY_TIMEOUT: Duration = Duration::from_secs(90);

/// One launch at a time per test binary: the port, the watch and the profile are shared.
pub static ONE_RUN: Mutex<()> = Mutex::new(());

pub fn one_run() -> std::sync::MutexGuard<'static, ()> {
    ONE_RUN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ---------------------------------------------------------------------------------------------------------------
// The loopback page server
// ---------------------------------------------------------------------------------------------------------------

/// What the served page looks like.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    /// `#root` holds content: HOME has painted.
    Painted,
    /// `#root` stays empty: the page loads but never paints HOME.
    Blank,
}

const PAINTED_HTML: &str = "<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>smoke page</title></head><body><div id=\"root\"><h1>HOME</h1><p>The smoke page has painted.</p></div></body></html>";
const BLANK_HTML: &str = "<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>smoke page</title></head><body><div id=\"root\"></div></body></html>";

pub struct PageServer {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    /// How many times `/` was fetched (a reload fetches it again).
    pub page_hits: Arc<AtomicUsize>,
    pub health_hits: Arc<AtomicUsize>,
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

/// Every request the page server saw (first line and fetch metadata), for failure messages.
static REQUESTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn request_log() -> Vec<String> {
    REQUESTS.lock().map(|r| r.clone()).unwrap_or_default()
}

fn serve_one(
    mut stream: TcpStream,
    page: Page,
    page_hits: &AtomicUsize,
    health_hits: &AtomicUsize,
) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).unwrap_or(0);
    if n == 0 {
        // A speculative connection that never sent a request.
        return;
    }
    let head = String::from_utf8_lossy(&buf[..n]).into_owned();
    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
    let meta: Vec<&str> = head
        .lines()
        .filter(|l| {
            let l = l.to_ascii_lowercase();
            l.starts_with("sec-fetch") || l.starts_with("purpose")
        })
        .collect();
    if let Ok(mut list) = REQUESTS.lock() {
        list.push(format!("{} {meta:?}", head.lines().next().unwrap_or("")));
    }
    match path.split('?').next().unwrap_or("/") {
        "/" | "/index.html" => {
            page_hits.fetch_add(1, Ordering::SeqCst);
            let html = if page == Page::Painted {
                PAINTED_HTML
            } else {
                BLANK_HTML
            };
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", html);
        }
        "/api/health" => {
            health_hits.fetch_add(1, Ordering::SeqCst);
            respond(
                &mut stream,
                "200 OK",
                "application/json",
                "{\"status\":\"ok\"}",
            );
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", "not found"),
    }
}

impl PageServer {
    pub fn start(page: Page) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", PAGE_PORT))
            .unwrap_or_else(|e| panic!("cannot bind 127.0.0.1:{PAGE_PORT}: {e}"));
        listener
            .set_nonblocking(true)
            .expect("non-blocking listener");
        if let Ok(mut list) = REQUESTS.lock() {
            list.clear();
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (page_hits, health_hits) =
            (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let (stop2, p2, h2) = (
            Arc::clone(&stop),
            Arc::clone(&page_hits),
            Arc::clone(&health_hits),
        );
        let handle = std::thread::spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (p, h) = (Arc::clone(&p2), Arc::clone(&h2));
                        std::thread::spawn(move || serve_one(stream, page, &p, &h));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        });
        Self {
            stop,
            handle: Some(handle),
            page_hits,
            health_hits,
        }
    }

    pub fn url() -> String {
        format!("http://127.0.0.1:{PAGE_PORT}/")
    }
}

impl Drop for PageServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The global window and foreground watch
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Seen {
    /// The window handle (0 when not known, as in a planted test window).
    pub hwnd: isize,
    pub pid: u32,
    pub class: String,
    pub title: String,
    pub rect: (i32, i32, i32, i32),
    pub drawn: bool,
    /// The owner process and its ancestors, nearest first, read when the event was seen (empty: not traced).
    pub chain: Vec<Link>,
}

/// `new_visible` and `foreground_changes` hold what can fail a run: events of the test process tree and events whose
/// owner was not traced. Events of other programs are in `foreign` (see hidden_support/scope.rs).
#[derive(Debug, Default)]
pub struct WatchReport {
    pub samples: u64,
    pub max_gap_ms: u128,
    pub new_visible: Vec<Seen>,
    pub foreground_changes: Vec<Seen>,
    pub foreign: Vec<Seen>,
    /// The host windows that appeared during the run (see `scope::HostWindows`).
    pub hosts: scope::HostWindows,
}

impl WatchReport {
    /// Files a new window by its owner; true when it counts against the run.
    pub fn record_window(&mut self, w: Seen, root: u32) -> bool {
        self.hosts.note_new(w.hwnd, &w.chain, &w.class);
        let counts = !scope::is_foreign_window(&w.chain, &w.class, root);
        if counts {
            self.new_visible.push(w);
        } else {
            self.foreign.push(w);
        }
        counts
    }

    /// Files a foreground change by the owner of the window that took the foreground; a host window that was already open
    /// when the watch started (the owner's own terminal) does not count (`scope::HostWindows`).
    pub fn record_foreground(&mut self, w: Seen, root: u32) {
        if self
            .hosts
            .foreground_counts(w.hwnd, &w.chain, &w.class, root)
        {
            self.foreground_changes.push(w);
        } else {
            self.foreign.push(w);
        }
    }

    /// One line per foreign event: its owner, whether the owner is on the named list, and what was seen.
    pub fn foreign_notes(&self) -> Vec<String> {
        let note = |w: &Seen| scope::foreign_note(&w.chain, &w.class, &w.title);
        self.foreign.iter().map(note).collect()
    }
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that all_windows keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

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
            hwnd: handle,
            pid,
            class: String::from_utf16_lossy(&class[..n]),
            title: String::from_utf16_lossy(&title[..m]),
            rect: (r.left, r.top, r.right, r.bottom),
            drawn,
            chain: Vec::new(),
        }
    }
}

/// `describe` plus the owner's ancestry, read now (the owner may be gone when the verdict is made).
pub fn describe_traced(handle: isize) -> Seen {
    let mut w = describe(handle);
    w.chain = scope::chain_of(w.pid);
    w
}

fn foreground() -> isize {
    // SAFETY: a plain query.
    unsafe { GetForegroundWindow() }.0 as isize
}

pub struct Watch {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<WatchReport>,
}

pub fn start_watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = Arc::clone(&stop);
    let baseline = visible_windows();
    let first_fg = foreground();
    let root = scope::root_pid();
    let handle = std::thread::spawn(move || {
        let mut report = WatchReport::default();
        let (mut seen, mut fg, mut last) = (HashSet::new(), first_fg, Instant::now());
        while !stop2.load(Ordering::SeqCst) {
            for h in visible_windows() {
                if !baseline.contains(&h) && seen.insert(h) {
                    report.record_window(describe_traced(h), root);
                }
            }
            let now = foreground();
            if now != fg {
                report.record_foreground(describe_traced(now), root);
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
    pub fn finish(self) -> WatchReport {
        self.stop.store(true, Ordering::SeqCst);
        let report = self.handle.join().unwrap_or_default();
        for note in report.foreign_notes() {
            eprintln!("watch: ignored a foreign window: {note}");
        }
        report
    }
}

/// What fails a run: any drawn new window of the test process tree (or of an owner not traced), any foreground change
/// to one, and any undrawn new window that is not tao's event target. Other programs' events are in `foreign`.
pub fn failures(report: &WatchReport) -> Vec<String> {
    failures_allowing(report, |_| false)
}

/// `failures`, except that a drawn window for which `allowed` says yes is not a failure (the guarded screen 2 run).
pub fn failures_allowing(report: &WatchReport, allowed: impl Fn(&Seen) -> bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in &report.new_visible {
        if w.drawn && allowed(w) {
            continue;
        }
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

/// The scope rule of the watch (born failing: before it, another program's window failed every run).
#[test]
fn the_crash_watch_ignores_foreign_windows_and_fails_a_planted_own_one() {
    const ROOT: u32 = 500;
    let window = |class: &str, pid: u32, exe: &str, parent: u32| Seen {
        hwnd: 0,
        pid,
        class: class.into(),
        title: String::new(),
        rect: (0, 0, 1, 1),
        drawn: true,
        chain: vec![
            Link {
                pid,
                exe: exe.into(),
            },
            Link {
                pid: parent,
                exe: "parent.exe".into(),
            },
        ],
    };
    let mut report = WatchReport::default();
    assert!(!report.record_window(window("Logi", 900, "logioptionsplus_agent.exe", 1), ROOT));
    report.record_foreground(window("Overlay", 901, "chatclient.exe", 1), ROOT);
    assert!(failures(&report).is_empty(), "{:?}", failures(&report));
    assert_eq!(report.foreign_notes().len(), 2);
    assert!(report.record_window(
        window("Tauri Window", 777, "nq-lab-terminal.exe", ROOT),
        ROOT
    ));
    assert_eq!(
        failures(&report).len(),
        1,
        "a planted own-tree window must fail"
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Processes and folders
// ---------------------------------------------------------------------------------------------------------------

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

fn log_file(path: &Path) -> Stdio {
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

pub fn run_dir(tag: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let dir = PathBuf::from(RUN_ROOT).join(format!("{tag}-{stamp}"));
    std::fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    dir
}

/// Folders a WebView2 or Tauri default would create on C: for this identity.
pub fn c_drive_folders() -> HashSet<PathBuf> {
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

// ---------------------------------------------------------------------------------------------------------------
// One launch
// ---------------------------------------------------------------------------------------------------------------

/// What a test asks of a launch.
pub struct Spec<'a> {
    pub tag: &'a str,
    pub page: Page,
    /// Extra smoke switches after the three the harness always passes.
    pub args: &'a [&'a str],
    pub envs: &'a [(&'a str, &'a str)],
}

pub struct Run {
    pub dir: PathBuf,
    pub shell: Owned,
    pub server: PageServer,
    watch: Watch,
    before_c: HashSet<PathBuf>,
}

/// How a run ended.
pub struct Outcome {
    pub closed: bool,
    pub report: WatchReport,
    pub new_c_folders: Vec<PathBuf>,
}

impl Outcome {
    /// Fails the test on anything the watch or the folder check saw.
    pub fn assert_clean(&self, what: &str) {
        let verdict = failures(&self.report);
        assert!(verdict.is_empty(), "{what}: the watch saw {verdict:#?}");
        assert!(
            self.closed,
            "{what}: the shell did not close on WM_CLOSE within 20 s"
        );
        assert!(
            self.report.samples >= 10,
            "{what}: the watch took only {} samples",
            self.report.samples
        );
        assert!(
            self.new_c_folders.is_empty(),
            "{what}: new folders on C: {:?}",
            self.new_c_folders
        );
    }
}

pub fn launch(exe: &Path, spec: &Spec<'_>) -> Run {
    let dir = run_dir(spec.tag);
    let before_c = c_drive_folders();
    let server = PageServer::start(spec.page);
    let watch = start_watch();
    let mut cmd = Command::new(exe);
    cmd.args(["--attach-url", &PageServer::url(), "--webview-data-dir"])
        .arg(dir.join("wv"))
        .arg("--config-dir")
        .arg(dir.join("config"))
        .args(spec.args)
        .env("PATH", clean_path())
        .stdin(Stdio::null())
        .stdout(log_file(&dir.join("shell.out.log")))
        .stderr(log_file(&dir.join("shell.err.log")))
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
    for (name, value) in spec.envs {
        cmd.env(name, value);
    }
    let child = cmd
        .spawn()
        .unwrap_or_else(|e| panic!("cannot start {}: {e}", exe.display()));
    Run {
        dir,
        shell: Owned(child),
        server,
        watch,
        before_c,
    }
}

impl Run {
    /// Every JSON line of the shell log so far.
    pub fn events(&self) -> Vec<Value> {
        let path = self.dir.join("config").join("logs").join("shell.log");
        std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }

    pub fn count(&self, event: &str) -> usize {
        self.events().iter().filter(|e| e["event"] == event).count()
    }

    /// Waits for the n-th (1-based) event of that name; fails with the whole log if the shell exits or time runs out.
    pub fn wait_event(&mut self, event: &str, nth: usize, timeout: Duration) -> Value {
        let started = Instant::now();
        while started.elapsed() < timeout {
            let found: Vec<Value> = self
                .events()
                .into_iter()
                .filter(|e| e["event"] == event)
                .collect();
            if found.len() >= nth {
                return found[nth - 1].clone();
            }
            if let Ok(Some(status)) = self.shell.0.try_wait() {
                panic!(
                    "the shell exited ({status}) before {event} #{nth}:\n{:#?}",
                    self.events()
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!(
            "no {event} #{nth} within {timeout:?}:\n{:#?}",
            self.events()
        );
    }

    /// Waits until the backend page (our loopback server) has finished loading in the window.
    pub fn wait_page_finished(&mut self) {
        let started = Instant::now();
        while started.elapsed() < READY_TIMEOUT {
            let loaded = self.events().iter().any(|e| {
                e["event"] == "page_finished"
                    && e["url"]
                        .as_str()
                        .is_some_and(|u| u.starts_with(&PageServer::url()))
            });
            if loaded {
                return;
            }
            if let Ok(Some(status)) = self.shell.0.try_wait() {
                panic!(
                    "the shell exited ({status}) before its page loaded:\n{:#?}",
                    self.events()
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("the page never finished loading:\n{:#?}", self.events());
    }

    /// The real debugging port from DevToolsActivePort in the profile folder.
    pub fn devtools_port(&mut self) -> u16 {
        let file = self
            .dir
            .join("wv")
            .join("EBWebView")
            .join("DevToolsActivePort");
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(60) {
            if let Some(port) = std::fs::read_to_string(&file)
                .ok()
                .and_then(|t| t.lines().next()?.trim().parse().ok())
            {
                return port;
            }
            if let Ok(Some(status)) = self.shell.0.try_wait() {
                panic!("the shell exited ({status}) before its debugging port was up");
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("no DevToolsActivePort under {} within 60 s", file.display());
    }

    /// Asks the app to close (WM_CLOSE to its own top-level windows), stops the page server and the watch, and
    /// reports what they saw.
    pub fn finish(mut self) -> Outcome {
        let closed = close_shell(&mut self.shell);
        drop(self.shell);
        drop(self.server);
        std::thread::sleep(Duration::from_millis(800));
        let report = self.watch.finish();
        let new_c_folders = c_drive_folders()
            .difference(&self.before_c)
            .cloned()
            .collect();
        Outcome {
            closed,
            report,
            new_c_folders,
        }
    }
}

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

// ---------------------------------------------------------------------------------------------------------------
// The debugging protocol and the renderer
// ---------------------------------------------------------------------------------------------------------------

/// GET on 127.0.0.1:<port> with the std socket (the harness may; the shell may not).
pub fn http_get(port: u16, path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .unwrap_or_else(|e| panic!("cannot connect to 127.0.0.1:{port}: {e}"));
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("timeout");
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .expect("request");
    let mut raw = String::new();
    let _ = stream.read_to_string(&mut raw);
    raw.split_once("\r\n\r\n")
        .map_or_else(String::new, |(_, body)| body.to_string())
}

/// The URLs of the page targets the debugging protocol lists.
pub fn page_urls(port: u16) -> Vec<String> {
    let body = http_get(port, "/json/list");
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter(|t| t["type"] == "page")
        .filter_map(|t| t["url"].as_str().map(str::to_string))
        .collect()
}

/// Evaluates an expression in the page whose URL starts with `prefix`, through Node's WebSocket.
const EVAL_JS: &str = r#"const [port, prefix, expr] = process.argv.slice(1);
const out = (v) => { console.log(JSON.stringify(v)); process.exit(0) };
setTimeout(() => out({ error: 'timeout' }), 20000);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.startsWith(prefix));
if (!page) out({ error: 'no page', urls: list.map((t) => t.url) });
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onerror = (e) => out({ error: String(e.message || e) });
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) out(m.result && m.result.result ? m.result.result : m) };
"#;

pub fn cdp_eval(port: u16, prefix: &str, expression: &str) -> Value {
    let out = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            EVAL_JS,
            &port.to_string(),
            prefix,
            expression,
        ])
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node: {e}"));
    let text = String::from_utf8_lossy(&out.stdout);
    let value: Value = serde_json::from_str(text.trim()).unwrap_or_else(|_| {
        panic!(
            "no JSON from the evaluation: {text} {}",
            String::from_utf8_lossy(&out.stderr)
        )
    });
    assert!(
        value.get("error").is_none(),
        "the evaluation failed: {value}"
    );
    value["value"].clone()
}

/// Ends the renderer processes of THIS run's profile (the `msedgewebview2.exe --type=renderer` children whose
/// command line names the run's data folder) and returns their pids.
pub fn kill_renderers(data_dir: &Path) -> Vec<u32> {
    let needle = data_dir
        .display()
        .to_string()
        .to_ascii_lowercase()
        .replace('\'', "''");
    let script = format!(
        "$n = '{needle}'; Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | \
         Where-Object {{ $_.CommandLine -like '*--type=renderer*' -and $_.CommandLine.ToLower().Contains($n) }} | \
         ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }}"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run powershell: {e}"));
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect()
}

/// Born failing (V032, 0.3.1 audit): the crash watch had no host-window rule, so the owner's alt-tab to a Windows
/// Terminal that was already open failed a crash run. Same rule as hidden_support/watch.rs.
#[test]
fn the_crash_watch_ignores_a_focus_change_to_a_host_window_open_before_the_run() {
    const ROOT: u32 = 500;
    let terminal = |hwnd: isize| Seen {
        hwnd,
        pid: 880,
        class: "CASCADIA_HOSTING_WINDOW_CLASS".into(),
        title: String::new(),
        rect: (0, 0, 1, 1),
        drawn: true,
        chain: vec![
            Link {
                pid: 880,
                exe: "windowsterminal.exe".into(),
            },
            Link {
                pid: 1,
                exe: "explorer.exe".into(),
            },
        ],
    };
    let mut report = WatchReport::default();
    report.record_foreground(terminal(700), ROOT);
    assert!(
        failures(&report).is_empty(),
        "a host window older than the run failed it: {:?}",
        failures(&report)
    );
    assert_eq!(report.foreign.len(), 1);
    // A host window that appeared during the run still counts, and so does a focus change to it.
    let mut born = WatchReport::default();
    born.record_window(terminal(701), ROOT);
    born.record_foreground(terminal(701), ROOT);
    assert_eq!(failures(&born).len(), 2, "{:?}", failures(&born));
}
