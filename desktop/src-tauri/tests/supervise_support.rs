//! Shared support for tests/supervise_*.rs and tests/link_*.rs. Each of those files includes src/link.rs and
//! src/supervise.rs by path and this file as `support`, then re-exports the crate-root names the two modules use
//! (`crash`, `writes`, `reads`, `dialogs`, `window`, `Launch`, `ShellError`), so the supervision core runs in the
//! test process with no window. reads.rs is the real module; the others are small stand-ins that write only under
//! D:\dev\tmp\w4b-supervise and fail every dialog closed.
//!
//! It also holds the GLOBAL window watch (every visible top-level window of every process, sampled every 100 ms, plus
//! the foreground window: anything new in the test process tree, or a system host's window that appeared during the run, fails
//! the test that started it; another program's window does not, see `scope` below) and the fake lab: a folder under
//! D:\dev\tmp\w4b-supervise whose `.venv` is a junction to the nq-lab venv (so the spawned interpreter is the nq-lab
//! venv's python.exe) and whose `terminal/backend/nq_terminal` package is tests/fixtures/fake_backend.py.
//!
//! Compiled on its own too (cargo builds every file in tests/), where it holds no test.
#![allow(
    dead_code,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test support: shims and fixtures for the supervision tests; not shipped"
)]

use serde_json::Value;
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    TerminateProcess, WaitForSingleObject,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};
use windows::core::BOOL;

/// Every file a test writes lives under this folder.
pub const RUN_ROOT: &str = r"D:\dev\tmp\w4b-supervise";
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const TEST_BUILD: bool = true;
pub const MAIN_LABEL: &str = "main";
/// The class of tao's hidden event-target window, which reports visible but has no size and is never drawn.
const TAO_EVENT_TARGET: &str = "class \"Tao Thread Event Target\"";

// ---------------------------------------------------------------- crate-root stand-ins

#[derive(Debug)]
pub enum ShellError {
    Refused(String),
    Io(String),
    Tauri(String),
    NotReady(&'static str),
}

impl From<tauri::Error> for ShellError {
    fn from(e: tauri::Error) -> Self {
        Self::Tauri(e.to_string())
    }
}

#[cfg(feature = "smoke")]
pub mod smoke_options {
    use std::path::PathBuf;
    /// The SmokeOptions fields supervise.rs reads.
    pub struct SmokeOptions {
        pub fixture: bool,
        pub attach_url: Option<String>,
        pub state_dir: Option<PathBuf>,
        pub lab: Option<PathBuf>,
        pub config_dir: PathBuf,
    }
}

pub struct Launch {
    #[cfg(feature = "smoke")]
    pub smoke: smoke_options::SmokeOptions,
}

pub mod window {
    /// The WindowOptions fields supervise.rs reads.
    pub struct WindowOptions {
        pub lab: Option<std::path::PathBuf>,
        pub ib_snapshot: bool,
    }

    /// No settings file in the supervision tests: the IB switch has nothing to compare with.
    pub fn ib_snapshot_stored() -> Option<bool> {
        None
    }

    /// Never writes: the supervision tests have no settings file.
    pub fn store_ib_snapshot(_on: bool) -> Result<(), String> {
        Err("test support: no settings file".into())
    }
}

#[path = "../src/reads.rs"]
pub mod reads;

pub mod crash {
    use serde_json::Value;
    use std::sync::Mutex;
    use std::time::Instant;

    pub const BACKEND_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
    pub const BACKEND_LOG_KEEP: u32 = 5;
    static EVENTS: Mutex<Vec<(Instant, String, Value)>> = Mutex::new(Vec::new());

    pub fn log(event: &str, detail: Value) {
        eprintln!("shell log: {event} {detail}");
        if let Ok(mut events) = EVENTS.lock() {
            events.push((Instant::now(), event.to_string(), detail));
        }
    }

    /// Mirrors crash.rs: rotate on the file's own size, then append; the bytes land even if the rotation fails.
    pub fn append_backend_log(
        path: &std::path::Path,
        bytes: &[u8],
    ) -> Result<(), super::writes::WriteError> {
        let rotated = super::writes::rotate(path, BACKEND_LOG_MAX_BYTES, BACKEND_LOG_KEEP);
        super::writes::append(path, bytes)?;
        rotated.map(|_| ())
    }

    /// Mirrors crash.rs: every chunk goes to `on_chunk`, then through `append_backend_log`.
    pub fn drain_backend_output<R: std::io::Read>(
        mut reader: R,
        log: &std::path::Path,
        mut on_chunk: impl FnMut(&[u8]),
    ) {
        let mut chunk = vec![0u8; 64 * 1024];
        while let Ok(n @ 1..) = reader.read(&mut chunk) {
            on_chunk(&chunk[..n]);
            let _ = append_backend_log(log, &chunk[..n]);
        }
    }

    /// The hung-page watch's health check (crash.rs registers it for real; a test ignores it).
    pub fn set_health_check(_check: impl Fn() -> bool + Send + Sync + 'static) {}

    /// Every event logged so far in this test process, with the time it was logged.
    pub fn events() -> Vec<(Instant, String, Value)> {
        EVENTS.lock().map(|e| e.clone()).unwrap_or_default()
    }
}

pub mod writes {
    use std::fmt;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    #[derive(Debug)]
    pub struct WriteError(pub String);

    impl fmt::Display for WriteError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{}", self.0)
        }
    }

    fn inside_run_root(path: &Path) -> Result<(), WriteError> {
        let text = path.to_string_lossy().to_lowercase();
        if text.starts_with(&super::RUN_ROOT.to_lowercase()) && !text.contains("..") {
            Ok(())
        } else {
            Err(WriteError(format!(
                "test writes stay under {}: {}",
                super::RUN_ROOT,
                path.display()
            )))
        }
    }

    pub fn append(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
        inside_run_root(path)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| WriteError(e.to_string()))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(path);
        file.as_mut()
            .map_err(|e| WriteError(e.to_string()))?
            .write_all(bytes)
            .map_err(|e| WriteError(e.to_string()))
    }

    fn numbered(path: &Path, n: u32) -> PathBuf {
        let mut name = path.as_os_str().to_owned();
        name.push(format!(".{n}"));
        PathBuf::from(name)
    }

    pub fn rotate(path: &Path, max_bytes: u64, keep: u32) -> Result<bool, WriteError> {
        inside_run_root(path)?;
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size <= max_bytes || keep == 0 {
            return Ok(false);
        }
        let _ = std::fs::remove_file(numbered(path, keep));
        for n in (1..keep).rev() {
            let _ = std::fs::rename(numbered(path, n), numbered(path, n + 1));
        }
        std::fs::rename(path, numbered(path, 1)).map_err(|e| WriteError(e.to_string()))?;
        Ok(true)
    }
}

/// Stand-in for src/guard.rs: waits for the install result a `with_webview` closure reports.
pub mod guard {
    use super::ShellError;
    use std::sync::mpsc::{self, SyncSender};
    use std::time::Duration;

    pub type Report = SyncSender<Result<(), String>>;

    pub fn guarded(
        name: &'static str,
        dispatch: impl FnOnce(Report) -> Result<(), ShellError>,
    ) -> Result<(), ShellError> {
        let (report, answer) = mpsc::sync_channel(1);
        dispatch(report)?;
        match answer.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(ShellError::Refused(format!(
                "the {name} guard is not installed: {e}"
            ))),
            Err(_) => Err(ShellError::Refused(format!(
                "the {name} guard is not installed: no report"
            ))),
        }
    }
}

pub mod dialogs {
    use std::path::Path;
    use tauri::{Runtime, WebviewWindow};

    /// The window a dialog is owned by, as src/dialogs.rs defines it.
    pub type Owner<'a, R> = Option<&'a WebviewWindow<R>>;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum RestartOrQuit {
        Restart,
        Quit,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Confirm {
        Proceed,
        Cancel,
    }

    /// Fails closed, as every dialog of a test build does.
    pub fn restart_or_quit<R: Runtime>(_owner: Owner<'_, R>, log_path: &Path) -> RestartOrQuit {
        super::crash::log(
            "dialog_refused",
            serde_json::json!({ "dialog": "restart_or_quit", "log": log_path }),
        );
        RestartOrQuit::Quit
    }

    pub fn confirm_close_running_job<R: Runtime>(_owner: Owner<'_, R>) -> Confirm {
        super::crash::log(
            "dialog_refused",
            serde_json::json!({ "dialog": "confirm_close_running_job" }),
        );
        Confirm::Cancel
    }

    /// Fails closed, as src/dialogs.rs does in a test build: the IB switch is never confirmed.
    pub fn confirm_ib_snapshot<R: Runtime>(
        _owner: Owner<'_, R>,
        _on: bool,
        _text: &str,
    ) -> Confirm {
        super::crash::log(
            "dialog_refused",
            serde_json::json!({ "dialog": "confirm_ib_snapshot" }),
        );
        Confirm::Cancel
    }

    pub fn ib_snapshot_note<R: Runtime>(_owner: Owner<'_, R>, _text: &str) {
        super::crash::log(
            "dialog_refused",
            serde_json::json!({ "dialog": "ib_snapshot_note" }),
        );
    }
}

// ---------------------------------------------------------------- the global window watch

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that `top_level` keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

fn describe(hwnd: HWND) -> String {
    let (mut pid, mut class, mut title) = (0u32, [0u16; 256], [0u16; 256]);
    // SAFETY: read-only queries into buffers that outlive the calls.
    let (n, t) = unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        (
            GetClassNameW(hwnd, &mut class) as usize,
            GetWindowTextW(hwnd, &mut title) as usize,
        )
    };
    let class = String::from_utf16_lossy(&class[..n]);
    format!(
        "pid {pid} class {class:?} title {:?}",
        String::from_utf16_lossy(&title[..t])
    )
}

/// The visible top-level windows of every process.
fn visible_windows() -> HashSet<isize> {
    let mut list: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `list`, which outlives the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
    // SAFETY: a plain query on handles EnumWindows just listed.
    list.into_iter()
        .filter(|h| unsafe { IsWindowVisible(HWND(*h as *mut _)) }.as_bool())
        .collect()
}

/// The owner process and the class of a window.
fn owner_and_class(hwnd: HWND) -> (u32, String) {
    let (mut pid, mut class) = (0u32, [0u16; 256]);
    // SAFETY: read-only queries into buffers that outlive the calls.
    let n = unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        GetClassNameW(hwnd, &mut class) as usize
    };
    (pid, String::from_utf16_lossy(&class[..n]))
}

/// The scope rule of every global watch (hidden_support/scope.rs): another program's window, or a focus change to one,
/// is the owner's own use of the PC and never fails a run; a window of the test process or its tree, a system host's
/// window that appeared during the run, or one whose owner cannot be traced counts.
#[path = "hidden_support/scope.rs"]
mod scope;

/// The global watch: any new visible top-level window of the test's own tree (or a system host's, or an untraced
/// owner's), or a change of the foreground window to one, is recorded. Another program's windows are not.
pub struct Watch {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Vec<String>>>,
}

pub fn watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::spawn(move || {
        let mut known = visible_windows();
        // SAFETY: a plain query.
        let mut foreground = unsafe { GetForegroundWindow() }.0 as isize;
        let mut seen = Vec::new();
        let root = scope::root_pid();
        let mut hosts = scope::HostWindows::default();
        while !flag.load(Ordering::SeqCst) {
            for hwnd in visible_windows().difference(&known.clone()) {
                let handle = HWND(*hwnd as *mut _);
                let (pid, class) = owner_and_class(handle);
                // The owner is read when the window is first seen: it may be gone by the time the verdict is made.
                let chain = scope::chain_of(pid);
                hosts.note_new(*hwnd, &chain, &class);
                let what = describe(handle);
                // tao's event target reports visible but is never drawn (W0A); the stage A tests exempt it too.
                if !what.contains(TAO_EVENT_TARGET)
                    && !scope::is_foreign_window(&chain, &class, root)
                {
                    seen.push(format!("new visible window: {what}"));
                }
                known.insert(*hwnd);
            }
            // SAFETY: a plain query.
            let now = unsafe { GetForegroundWindow() }.0 as isize;
            if now != foreground {
                let handle = HWND(now as *mut _);
                let (pid, class) = owner_and_class(handle);
                if hosts.foreground_counts(now, &scope::chain_of(pid), &class, root) {
                    seen.push(format!("foreground changed to {}", describe(handle)));
                }
                foreground = now;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        seen
    });
    Watch {
        stop,
        thread: Some(thread),
    }
}

impl Watch {
    pub fn finish(mut self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        self.thread
            .take()
            .map(|t| t.join().unwrap_or_default())
            .unwrap_or_default()
    }

    /// Fails the test on any new visible window or foreground change during the watch.
    pub fn assert_clean(self) {
        let seen = self.finish();
        assert!(seen.is_empty(), "the global window watch saw: {seen:#?}");
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------- the fake lab

/// The nq-lab venv (NQT_LAB_VENV, else %USERPROFILE%\nq-lab\.venv): the only interpreter these tests run.
pub fn lab_venv() -> PathBuf {
    std::env::var_os("NQT_LAB_VENV")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var_os("USERPROFILE").expect("USERPROFILE is set");
            PathBuf::from(home).join("nq-lab").join(".venv")
        })
}

pub fn lab_python() -> PathBuf {
    lab_venv().join("Scripts").join("python.exe")
}

pub fn fake_source() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("fake_backend.py")
}

pub struct FakeLab {
    pub run: PathBuf,
    pub lab: PathBuf,
    pub state: PathBuf,
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos())
}

fn junction(link: &Path, target: &Path) {
    let status = Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .expect("run mklink");
    assert!(status.success(), "mklink /J {} failed", link.display());
}

/// A fake lab under D:\dev\tmp\w4b-supervise\<name>-<stamp>: the venv junction, the fake package and its mode file.
pub fn fake_lab(name: &str, mode: &Value) -> FakeLab {
    let run = PathBuf::from(RUN_ROOT).join(format!("{name}-{}", stamp()));
    let lab = run.join("lab");
    let package = lab.join("terminal").join("backend").join("nq_terminal");
    std::fs::create_dir_all(package.join("desktop")).expect("fake package folders");
    junction(&lab.join(".venv"), &lab_venv());
    let source = std::fs::read(fake_source()).expect("read the fake backend");
    std::fs::write(package.join("__init__.py"), b"").expect("package");
    std::fs::write(package.join("__main__.py"), &source).expect("fake main");
    std::fs::write(package.join("fake_backend.py"), &source).expect("the worker's importable copy");
    std::fs::write(package.join("desktop").join("__init__.py"), b"").expect("desktop package");
    std::fs::write(package.join("desktop").join("fixture_main.py"), &source)
        .expect("fake fixture entry");
    // What the shell's lab check accepts besides the interpreter and the backend entry: the research config and the
    // page build (both empty files; the fake backend never reads them).
    let config = lab.join("src").join("nq_lab").join("config.py");
    let dist = lab
        .join("terminal")
        .join("web")
        .join("dist")
        .join("index.html");
    for file in [&config, &dist] {
        std::fs::create_dir_all(file.parent().expect("a parent folder")).expect("lab folders");
        std::fs::write(file, b"").expect("lab marker file");
    }
    let mode_file = lab.join("terminal").join("backend").join("fake_mode.json");
    std::fs::write(mode_file, mode.to_string()).expect("mode file");
    let state = lab.join("terminal").join("state");
    std::fs::create_dir_all(&state).expect("state folder");
    FakeLab { run, lab, state }
}

/// The `FAKE-RECORD` values among some lines.
pub fn records_in(lines: &[String]) -> Vec<Value> {
    let tagged = lines.iter().filter_map(|l| l.strip_prefix("FAKE-RECORD "));
    tagged
        .filter_map(|j| serde_json::from_str(j).ok())
        .collect()
}

/// The `FAKE-REQUEST` values of one fake among some lines: its path and every header.
pub fn requests_in(lines: &[String], pid: u32) -> Vec<Value> {
    let tagged = lines.iter().filter_map(|l| l.strip_prefix("FAKE-REQUEST "));
    let values = tagged.filter_map(|j| serde_json::from_str::<Value>(j).ok());
    values
        .filter(|v| v["pid"].as_u64() == Some(u64::from(pid)))
        .collect()
}

/// Every line of backend.log and its rotated files in a state folder (what the shell drained from its backend).
pub fn backend_log_lines(state: &Path) -> Vec<String> {
    let logs = state.join("logs");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&logs)
        .map(|d| d.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    files.retain(|p| {
        p.file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("backend.log"))
    });
    let bytes = files.iter().filter_map(|p| std::fs::read(p).ok());
    bytes
        .flat_map(|b| {
            String::from_utf8_lossy(&b)
                .lines()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

impl FakeLab {
    /// What the shell drained from this lab's backends.
    pub fn lines(&self) -> Vec<String> {
        backend_log_lines(&self.state)
    }

    /// The record of the fake with this pid, once the shell has drained it into backend.log.
    pub fn record(&self, pid: u32) -> Value {
        let mut found = None;
        wait_until(
            Duration::from_secs(10),
            "the fake's record in backend.log",
            || {
                found = records_in(&self.lines())
                    .into_iter()
                    .find(|r| r["pid"].as_u64() == Some(u64::from(pid)));
                found.is_some()
            },
        );
        found.unwrap_or_default()
    }

    /// Every request the fake with this pid reported, as drained into backend.log.
    pub fn requests(&self, pid: u32) -> Vec<Value> {
        requests_in(&self.lines(), pid)
    }
}

/// The current user's SID as text (the owner and first ACE of the lock's protected DACL).
fn user_sid() -> String {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    let mut token = HANDLE::default();
    // SAFETY: queries this process's own token into buffers that outlive the calls; every handle is closed.
    unsafe {
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).expect("the process token");
        let mut size = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            size,
            &mut size,
        )
        .expect("user");
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text = windows::core::PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).expect("SID text");
        let sid = text.to_string().unwrap_or_default();
        let _ = windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            text.0.cast(),
        )));
        let _ = CloseHandle(token);
        sid
    }
}

/// The protected owner-only DACL of backend desktop/lock.py: this user, SYSTEM and Administrators, nothing inherited.
fn owner_only_descriptor() -> windows::Win32::Security::PSECURITY_DESCRIPTOR {
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    let sddl = format!("D:P(A;;FA;;;{})(A;;FA;;;SY)(A;;FA;;;BA)", user_sid());
    let sddl = windows::core::HSTRING::from(sddl);
    let mut descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
    // SAFETY: converts a literal descriptor into memory that lives for the rest of the test process.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            &sddl,
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
    }
    .expect("the owner-only descriptor");
    descriptor
}
/// A lock file as backend desktop/lock.py makes it: created new with a protected owner-only DACL (this user, SYSTEM,
/// Administrators) and held open sharing read only, until the returned file is dropped.
pub fn hold_lock(state: &Path, contents: &Value) -> std::fs::File {
    use std::io::Write;
    use std::os::windows::io::FromRawHandle;
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    use windows::Win32::Storage::FileSystem::{
        CREATE_NEW, CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ,
    };
    let path = windows::core::HSTRING::from(state.join("backend.lock").as_os_str());
    let descriptor = owner_only_descriptor();
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    let access = 0x8000_0000 | 0x4000_0000 | 0x0001_0000; // GENERIC_READ, GENERIC_WRITE, DELETE, as lock.py asks
    // SAFETY: a new file under the test's own state folder; the handle is owned by the File below.
    let handle = unsafe {
        CreateFileW(
            &path,
            access,
            FILE_SHARE_READ,
            Some(&attributes),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .expect("create the lock");
    // SAFETY: the open handle moves into the File, which closes it once.
    let mut file = unsafe { std::fs::File::from_raw_handle(handle.0) };
    file.write_all(contents.to_string().as_bytes())
        .expect("write the lock");
    file
}

// ---------------------------------------------------------------- processes the tests own

/// A process handle the test owns, opened while the process is alive, for waiting and (only for what the test
/// started) terminating.
pub struct Tracked(pub HANDLE);

// SAFETY: a kernel handle is valid on every thread.
unsafe impl Send for Tracked {}

impl Tracked {
    pub fn open(pid: u32) -> Option<Self> {
        let access = PROCESS_SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION;
        // SAFETY: opens a process this test started (or its child), for waiting and ending.
        unsafe { OpenProcess(access, false, pid) }.ok().map(Self)
    }

    /// True when the process ended within `wait`.
    pub fn ended_within(&self, wait: Duration) -> bool {
        // SAFETY: a bounded wait on an open handle.
        (unsafe { WaitForSingleObject(self.0, wait.as_millis() as u32) }) == WAIT_OBJECT_0
    }

    /// Ends a survivor the test started, through its own handle.
    pub fn end(&self) {
        // SAFETY: the handle carries PROCESS_TERMINATE and names a process this test started.
        let _ = unsafe { TerminateProcess(self.0, 1) };
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        // SAFETY: closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// What a fake started by a test prints, collected line by line on a thread (it writes no file of its own).
#[derive(Clone, Default)]
pub struct Collector {
    lines: Arc<Mutex<Vec<String>>>,
}

impl Collector {
    /// Takes the child's piped stdout and keeps every line of it.
    pub fn of(child: &mut std::process::Child) -> Self {
        let collector = Self::default();
        let lines = collector.lines.clone();
        let stdout = child.stdout.take().expect("the fake's stdout is piped");
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
            {
                if let Ok(mut all) = lines.lock() {
                    all.push(line);
                }
            }
        });
        collector
    }

    pub fn lines(&self) -> Vec<String> {
        self.lines.lock().map(|l| l.clone()).unwrap_or_default()
    }
}

/// The G08 impostor: the fake in swapped mode, bound to `port`, reporting every header it receives on stdout.
pub fn start_swapped(lab: &FakeLab, port: u16) -> (std::process::Child, Collector) {
    let backend = lab.lab.join("terminal").join("backend");
    let script = backend.join("nq_terminal").join("__main__.py");
    let mut child = Command::new(lab_python())
        .args(["-E", "-s"])
        .arg(script)
        .arg("--swapped")
        .arg(port.to_string())
        .current_dir(backend)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("start the swapped fake");
    let collector = Collector::of(&mut child);
    (child, collector)
}

/// Waits until `check` holds, or fails with `what` after `limit`.
pub fn wait_until(limit: Duration, what: &str, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// A recording sink for the supervision loop: every call with the time it came.
#[derive(Default)]
pub struct Recorder {
    pub calls: Mutex<Vec<(Instant, String)>>,
}

impl Recorder {
    pub fn push(&self, what: String) {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push((Instant::now(), what));
        }
    }

    pub fn calls(&self) -> Vec<(Instant, String)> {
        self.calls.lock().map(|c| c.clone()).unwrap_or_default()
    }
}
