//! Launching and closing the shell for the hidden-window runs: the process wrapper that ends a tree when dropped, the
//! launch prelude (a PATH without the build tools, no WEBVIEW2_* variable but the two canaries), the debugging port
//! the engine picked, the HOME probe read over the protocol, the WM_CLOSE close, and the folders a default profile
//! would have made on C:.
#![allow(
    dead_code,
    reason = "each test binary that includes this file uses a part of it"
)]

use super::watch::{TAO_CLASS, all_windows, describe};
#[cfg(feature = "smoke")]
use serde_json::Value;
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const RUN_ROOT: &str = r"D:\dev\d4\hw";
pub const CANARY_ARGS: &str = "--nqt-scrub-canary";
pub const HOME_TIMEOUT: Duration = Duration::from_secs(120);
/// The measure build's one switch (src/window.rs MEASURE_DIR_VAR).
pub const MEASURE_DIR_VAR: &str = "NQT_MEASURE_DIR";

pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn terminal_dir() -> PathBuf {
    crate_dir().join("..").join("..")
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

/// The real debugging port the engine picked (port 0) from DevToolsActivePort in the profile folder.
#[cfg(feature = "smoke")]
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

/// HOME is ready when the four panels of the e2e HOME probe (web/e2e/perf/pages.ts) hold their content.
#[cfg(feature = "smoke")]
pub const HOME_PROBE_JS: &str = r#"const [port, prefix, timeoutMs] = process.argv.slice(1);
const R = [['NQ GP 1d', ['[role="img"][aria-label^="NQ1 Index: "]']], ['27F MON', ['[role="grid"]:not([aria-rowcount="1"])']], ['volmanaged_v0 EQ', ['ul[aria-label^="Key figures for "] .kpi-value', '[role="img"]']], ['REG', ['[role="grid"]:not([aria-rowcount="1"])']]];
const expr = `(() => { const R = ${JSON.stringify(R)}; const ok = (p) => { const el = document.querySelector('[data-nqt-title="' + p[0] + '"]'); return el !== null && p[1].every((s) => el.querySelector(s) !== null) };
  const quiet = document.querySelector('p.ws-empty') === null && document.querySelector('[aria-busy="true"]:not(td):not([role="gridcell"])') === null;
  return JSON.stringify({ ready: quiet && R.every(ok), panels: document.querySelectorAll('[data-nqt-title]').length, visibility: document.visibilityState, url: location.href }) })()`;
const evaluate = (url) => new Promise((res, rej) => { const ws = new WebSocket(url);
  ws.onerror = () => rej(new Error('debugging socket error')); ws.onclose = () => rej(new Error('debugging socket closed'));
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id !== 1) return; ws.close();
    const v = m.result?.result?.value; if (typeof v !== 'string') throw new Error(JSON.stringify(m.error ?? m.result?.exceptionDetails ?? m)); res(JSON.parse(v)) } catch (e) { ws.close(); rej(e) } };
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })) });
let last = { ready: false, reason: 'no page target' };
for (const end = Date.now() + Number(timeoutMs); Date.now() < end && !last.ready; await new Promise((r) => setTimeout(r, 250))) {
  try { const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith(prefix));
    if (page) last = await evaluate(page.webSocketDebuggerUrl) } catch (e) { last = { ready: false, reason: String(e) } }
}
console.log(JSON.stringify(last));
"#;

#[cfg(feature = "smoke")]
pub fn wait_for_home(port: u16, prefix: &str) -> Value {
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
pub fn close_shell(shell: &mut Owned) -> bool {
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

/// The shell's launch, per build: the smoke exe takes the frozen switches (`--fixture` over the lab, so the real
/// backend of this worktree starts through the whole handshake), the measure exe takes none and finds its folders
/// through NQT_MEASURE_DIR and its lab through the settings file the run planted.
pub fn shell_command(exe: &Path, run: &Path, lab: &Path) -> Command {
    let mut cmd = Command::new(exe);
    if cfg!(feature = "smoke") {
        cmd.arg("--lab")
            .arg(lab)
            .arg("--fixture")
            .arg("--webview-data-dir")
            .arg(run.join("wv"))
            .arg("--config-dir")
            .arg(run.join("config"));
    } else {
        cmd.env(MEASURE_DIR_VAR, run);
    }
    cmd
}

pub fn launch_shell(exe: &Path, run: &Path, lab: &Path) -> Owned {
    let mut cmd = shell_command(exe, run, lab);
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

/// Whether the stand-in backend of a measure lab (its pid is in `stand-in.pid`) has ended within `wait`.
pub fn stand_in_ended(lab: &Path, wait: Duration) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
    };
    let file = lab.join(super::labs::STAND_IN_PID_FILE);
    let started = Instant::now();
    let pid = loop {
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        if let Ok(pid) = text.trim().parse::<u32>() {
            break pid;
        }
        assert!(
            started.elapsed() < wait,
            "the stand-in never wrote {}",
            file.display()
        );
        std::thread::sleep(Duration::from_millis(100));
    };
    // SAFETY: opens a process for waiting only; a process that is gone cannot be opened, which counts as ended.
    let Ok(handle) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }) else {
        return true;
    };
    let millis = u32::try_from(wait.as_millis()).unwrap_or(u32::MAX - 1);
    // SAFETY: a bounded wait on the handle just opened, closed once.
    let ended = unsafe { WaitForSingleObject(handle, millis) } == WAIT_OBJECT_0;
    // SAFETY: the handle is open and owned here.
    let _ = unsafe { CloseHandle(handle) };
    ended
}

/// When a live process started, in milliseconds since the Unix epoch (the shell log's `t` is in the same unit).
pub fn process_started_ms(pid: u32) -> Option<u128> {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const UNIX_EPOCH_AS_FILETIME_MS: u128 = 11_644_473_600_000;
    // SAFETY: opens a process for a query only and closes the handle once.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: the handle is open and the four out-pointers are valid for the call.
    let got = unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) };
    // SAFETY: the handle is open and owned here.
    let _ = unsafe { CloseHandle(handle) };
    got.ok()?;
    let ticks = (u128::from(created.dwHighDateTime) << 32) | u128::from(created.dwLowDateTime);
    (ticks / 10_000).checked_sub(UNIX_EPOCH_AS_FILETIME_MS)
}
