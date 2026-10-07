//! The page gets no shell command: every Tauri 2.12 core command and every command of the plugins compiled into the
//! build, called from the page through the internal IPC, is refused, and the count is printed (03 sections 2.1, 4.5
//! and 15.2; 02 C3-1; 04 D4.4).
//!
//! The command list is not typed by hand: it is read from the LOCKED sources in the cargo registry, the core
//! table (`PLUGINS` in tauri's build.rs, every core plugin and command) and the `COMMANDS` list of every
//! `tauri-plugin-*` crate in Cargo.lock; a plugin crate whose commands cannot be listed fails the test. Three
//! made-up app commands are added. Core plugin commands are invoked as `plugin:<plugin>|<command>`.
//!
//! `cargo test --features smoke --test ipc_refusal -- --nocapture` builds the smoke exe, serves a plain page on
//! 127.0.0.1:8812 (the w4b writes-downloads row of the port table), starts the shell hidden with `--attach-url`, and
//! over the debugging protocol calls every command at once through `window.__TAURI_INTERNALS__.invoke`, first from
//! the backend's page (a remote origin) and then from the shell's own origin (`http://tauri.localhost`), each with
//! a 5 s limit. A command counts as refused when its promise rejects with "not allowed" (the ACL) or, for a
//! made-up app command, "not found". A resolved call, any other error, or a call left unanswered fails the test,
//! except that a page which has no IPC object at all refuses by absence, which is printed. A control call to the
//! channel fetch command (the one command tauri answers without the ACL) proves each page's IPC answers at all.
//! Every window and webview call names a label that does not exist, so even a wrongly granted command could not
//! touch the window. A GLOBAL window and foreground watch runs during the launch.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads the locked crate sources and its own run files, and starts its own processes"
)]

#[path = "hidden_support/scope.rs"]
mod scope;

use serde_json::{Value, json};
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
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
const PAGE_PORT: u16 = 8812;
const RUN_ROOT: &str = r"D:\dev\tmp\w4b-writes";
const TAO_CLASS: &str = "Tao Thread Event Target";
const SAMPLE: Duration = Duration::from_millis(100);
const WAIT: Duration = Duration::from_secs(60);
const APP_ORIGIN: &str = "http://tauri.localhost/";
const SPLASH: &str = "http://tauri.localhost/splash.html";
/// Made-up app commands: the shell registers no command of its own.
const APP_PROBES: [&str; 3] = ["save_file", "write_file", "nqt_probe"];
/// The one command tauri 2 answers without the ACL (webview/mod.rs): the control call.
const CONTROL: &str = "plugin:__TAURI_CHANNEL__|fetch";
/// The core table of tauri 2.12.1 holds 165 commands in 9 plugins (counted independently of this parser); a newer
/// tauri may add some, never fewer.
const TAURI_2_12_CORE_COMMANDS: usize = 165;
const PAGE: &str = "<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>ipc page</title></head><body><main><h1>ipc page</h1></main></body></html>\n";

// ------------------------------------------------------------------------------------------------ the command list

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every locked package: (name, version).
fn locked_packages() -> Vec<(String, String)> {
    let lock = std::fs::read_to_string(crate_dir().join("Cargo.lock")).expect("Cargo.lock");
    let mut out = Vec::new();
    let mut name = None;
    for line in lock.lines() {
        if let Some(n) = line.strip_prefix("name = ") {
            name = Some(n.trim_matches('"').to_string());
        } else if let (Some(v), Some(n)) = (line.strip_prefix("version = "), name.take()) {
            out.push((n, v.trim_matches('"').to_string()));
        }
    }
    out
}

/// The unpacked source folder of a locked crate in the cargo registry.
fn crate_source(name: &str, version: &str) -> PathBuf {
    let home = std::env::var_os("CARGO_HOME")
        .map_or_else(|| PathBuf::from(r"D:\dev\cargo"), PathBuf::from);
    let registry = home.join(r"registry\src");
    let found = std::fs::read_dir(&registry)
        .into_iter()
        .flatten()
        .flatten()
        .map(|index| index.path().join(format!("{name}-{version}")))
        .find(|dir| dir.is_dir());
    found.unwrap_or_else(|| panic!("no source of {name} {version} under {}", registry.display()))
}

/// The string literals of one line of Rust, outside a line comment.
fn literals(line: &str) -> Vec<String> {
    let code = line.trim_start();
    if code.starts_with("//") {
        return Vec::new();
    }
    code.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect()
}

/// tauri's core table: every `core:<plugin>` and its commands, as `plugin:<plugin>|<command>`.
fn core_commands(tauri_build_rs: &str) -> Vec<String> {
    let start = tauri_build_rs
        .find("const PLUGINS")
        .expect("the PLUGINS table");
    let mut plugin = String::new();
    let mut out = Vec::new();
    for line in tauri_build_rs[start..].lines().skip(1) {
        if line.trim() == "];" {
            break;
        }
        for text in literals(line) {
            match text.strip_prefix("core:") {
                Some(name) => plugin = name.to_string(),
                None => out.push(format!("plugin:{plugin}|{text}")),
            }
        }
    }
    out
}

/// A plugin crate's commands from its build.rs `COMMANDS` list; a crate with commands it does not list fails.
fn plugin_commands(name: &str, dir: &Path) -> Vec<String> {
    let plugin = name.trim_start_matches("tauri-plugin-");
    let build = std::fs::read_to_string(dir.join("build.rs")).unwrap_or_default();
    if let Some(at) = build.find("const COMMANDS") {
        let list = &build[at..at + build[at..].find(';').expect("the end of COMMANDS")];
        return literals(list)
            .into_iter()
            .map(|c| format!("plugin:{plugin}|{c}"))
            .collect();
    }
    let source = std::fs::read_to_string(dir.join(r"src\lib.rs")).unwrap_or_default();
    assert!(
        !source.contains("invoke_handler") && !source.contains("tauri::command"),
        "{name} has commands this test cannot list"
    );
    Vec::new()
}

/// (core commands, plugin commands, app probes) of this build, from the locked sources.
fn every_command() -> (Vec<String>, Vec<String>, Vec<String>) {
    let packages = locked_packages();
    let version = |n: &str| {
        packages
            .iter()
            .find(|(p, _)| p == n)
            .map(|(_, v)| v.clone())
    };
    let tauri = version("tauri").expect("tauri is locked");
    let build = std::fs::read_to_string(crate_source("tauri", &tauri).join("build.rs"))
        .expect("tauri build.rs");
    let core = core_commands(&build);
    let plugins = packages
        .iter()
        .filter(|(n, _)| n.starts_with("tauri-plugin-"))
        .flat_map(|(n, v)| plugin_commands(n, &crate_source(n, v)))
        .collect();
    (core, plugins, APP_PROBES.map(String::from).to_vec())
}

#[test]
fn the_command_list_covers_the_core_table() {
    let (core, plugins, _) = every_command();
    for expected in [
        "plugin:window|show",
        "plugin:webview|create_webview_window",
        "plugin:path|resolve",
        "plugin:event|emit",
        "plugin:app|exit",
        "plugin:resources|close",
        "plugin:menu|new",
        "plugin:tray|new",
        "plugin:image|from_path",
    ] {
        assert!(
            core.contains(&expected.to_string()),
            "{expected} missing from {} core commands",
            core.len()
        );
    }
    assert!(
        core.len() >= TAURI_2_12_CORE_COMMANDS,
        "only {} core commands parsed",
        core.len()
    );
    assert!(
        plugins.contains(&"plugin:window-state|save_window_state".to_string()),
        "{plugins:?}"
    );
    assert!(
        !core.iter().any(|c| c.contains("channel")),
        "the commented-out channel row was parsed"
    );
}

// ------------------------------------------------------------------------------------------------ global watch

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

/// (pid, class, drawn): drawn means visible, not cloaked, an area, and not an unattributed layered window.
fn describe(handle: isize) -> (u32, String, bool) {
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
        let drawn = IsWindowVisible(hwnd).as_bool()
            && cloaked == 0
            && area > 0
            && !(layered && (!attrs || alpha == 0));
        (pid, String::from_utf16_lossy(&class[..n]), drawn)
    }
}

fn foreground() -> isize {
    // SAFETY: a plain query.
    unsafe { GetForegroundWindow() }.0 as isize
}

/// Samples every top-level window of every process and the foreground window every 100 ms until stopped.
fn start_watch() -> (Arc<AtomicBool>, JoinHandle<Vec<String>>) {
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
                if hosts.foreground_counts(fg, &scope::chain_of(now.0), &now.1, root) {
                    failures.push(format!("foreground changed to {now:?}"));
                }
            }
            std::thread::sleep(SAMPLE);
        }
        failures
    });
    (stop, handle)
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
    describe: &dyn Fn(isize) -> (u32, String, bool),
    chain_of: &dyn Fn(u32) -> Vec<scope::Link>,
) -> Vec<String> {
    let mut failures = Vec::new();
    for h in windows {
        if baseline.contains(&h) || !seen.insert(h) {
            continue;
        }
        let (pid, class, drawn) = describe(h);
        let chain = chain_of(pid);
        hosts.note_new(h, &chain, &class);
        if (drawn || class != TAO_CLASS) && !scope::is_foreign_window(&chain, &class, root) {
            failures.push(format!(
                "new window: pid {pid}, class {class}, drawn {drawn}"
            ));
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
    let describe = |h: isize| {
        let class = if h == 3 { "drawn" } else { TAO_CLASS };
        (1, class.to_string(), h == 3)
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

// ------------------------------------------------------------------------------------------------ processes

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
    Stdio::from(std::fs::File::create(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

fn node(args: &[&str]) -> String {
    let out = Command::new("node")
        .args(args)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node: {e}"));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

const PAGE_UP_JS: &str = "try { const r = await fetch(`http://127.0.0.1:${process.argv[1]}/index.html`); console.log(r.ok ? 'up' : 'down') } catch { await new Promise((r) => setTimeout(r, 200)); console.log('down') }";

/// The plain page on 127.0.0.1:8812 through the lab venv python's http.server.
fn start_page(run: &Path) -> Owned {
    let site = run.join("site");
    std::fs::create_dir_all(&site).expect("site");
    std::fs::write(site.join("index.html"), PAGE).expect("page");
    let lab = std::env::var_os("NQT_LAB").map_or_else(
        || PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab"),
        PathBuf::from,
    );
    let mut page = Owned(
        Command::new(lab.join(r".venv\Scripts\python.exe"))
            .args([
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
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("the page server"),
    );
    let started = Instant::now();
    while node(&[
        "--input-type=module",
        "-e",
        PAGE_UP_JS,
        &PAGE_PORT.to_string(),
    ])
    .trim()
        != "up"
    {
        assert!(
            matches!(page.0.try_wait(), Ok(None)),
            "the page server exited; is port {PAGE_PORT} taken?"
        );
        assert!(
            started.elapsed() < WAIT,
            "the page server was not up within 60 s"
        );
    }
    page
}

fn launch_shell(run: &Path) -> Owned {
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    let path = std::env::var("PATH").unwrap_or_default();
    let clean: Vec<&str> = path
        .split(';')
        .filter(|p| {
            !p.to_ascii_lowercase().starts_with(r"d:\dev\mingw")
                && !p.to_ascii_lowercase().starts_with(r"d:\dev\cargo")
        })
        .collect();
    let mut cmd = Command::new(exe);
    cmd.arg("--attach-url")
        .arg(format!("http://127.0.0.1:{PAGE_PORT}/index.html"))
        .arg("--webview-data-dir")
        .arg(run.join("wv"))
        .arg("--config-dir")
        .arg(run.join("config"))
        .env("PATH", clean.join(";"))
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

fn devtools_port(run: &Path, shell: &mut Owned) -> u16 {
    let file = run.join(r"wv\EBWebView\DevToolsActivePort");
    let started = Instant::now();
    while started.elapsed() < WAIT {
        if let Some(port) = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| t.lines().next()?.trim().parse().ok())
        {
            return port;
        }
        assert!(
            matches!(shell.0.try_wait(), Ok(None)),
            "the shell exited before its debugging port was up"
        );
        std::thread::sleep(SAMPLE);
    }
    panic!("no DevToolsActivePort under {}", file.display());
}

fn close_shell(shell: &mut Owned) {
    for h in all_windows() {
        let (pid, class, _) = describe(h);
        if pid == shell.0.id() && class != TAO_CLASS {
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

// ------------------------------------------------------------------------------------------------ the calls

/// Sends one CDP command to the page whose URL starts with the prefix, once that page exists.
const CDP_JS: &str = r#"const [port, prefix, timeoutMs, method, params] = process.argv.slice(1);
const send = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); ws.onerror = rej;
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== 1) return; ws.close(); res(m) };
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params: JSON.parse(params) })) });
let last = { error: 'no page target with that prefix' };
for (const end = Date.now() + Number(timeoutMs); Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
  try { const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith(prefix));
    if (page) { last = await send(page.webSocketDebuggerUrl); break } } catch (e) { last = { error: String(e) } }
}
console.log(JSON.stringify(last));
"#;

fn cdp(port: u16, prefix: &str, method: &str, params: &Value) -> Value {
    let (port, timeout, params) = (
        port.to_string(),
        WAIT.as_millis().to_string(),
        params.to_string(),
    );
    let text = node(&[
        "--input-type=module",
        "-e",
        CDP_JS,
        &port,
        prefix,
        &timeout,
        method,
        &params,
    ]);
    serde_json::from_str(text.trim()).unwrap_or_else(|_| panic!("CDP gave no JSON: {text}"))
}

/// Calls every command at once from the page, each with a 5 s limit and a label that names no window.
const INVOKE_JS: &str = r#"(async (cmds, control) => {
  const I = window.__TAURI_INTERNALS__;
  if (!I || typeof I.invoke !== 'function') return { ipc: false, origin: location.origin };
  const args = { label: 'nqt-no-such-window', webviewLabel: 'nqt-no-such-webview' };
  const one = (cmd) => Promise.race([
    I.invoke(cmd, args).then((v) => ({ cmd, outcome: 'resolved', message: JSON.stringify(v) ?? '' }), (e) => ({ cmd, outcome: 'rejected', message: String(e) })),
    new Promise((r) => setTimeout(() => r({ cmd, outcome: 'unanswered', message: '' }), 5000))]);
  const [results, check] = await Promise.all([Promise.all(cmds.map(one)), one(control)]);
  return { ipc: true, origin: location.origin, results, control: check };
})"#;

fn invoke_all(port: u16, prefix: &str, cmds: &[String]) -> Value {
    let expression = format!("{INVOKE_JS}({}, {})", json!(cmds), json!(CONTROL));
    let params = json!({ "expression": expression, "awaitPromise": true, "returnByValue": true });
    let reply = cdp(port, prefix, "Runtime.evaluate", &params);
    reply["result"]["result"]["value"].clone()
}

/// The verdict on one page: (refused count, failures). A page with no IPC object refuses by absence.
fn judge(page: &Value, probes: &[String]) -> (usize, Vec<String>) {
    if page["ipc"] == false {
        return (0, Vec::new());
    }
    let control = &page["control"];
    let mut failures = Vec::new();
    if control["outcome"] == "unanswered"
        || control["message"]
            .as_str()
            .is_some_and(|m| m.contains("not allowed"))
    {
        failures.push(format!(
            "the IPC did not answer the control call: {control}"
        ));
    }
    let results = page["results"].as_array().cloned().unwrap_or_default();
    let refused = results.iter().filter(|r| {
        let message = r["message"].as_str().unwrap_or_default();
        let probe = probes.iter().any(|p| r["cmd"] == p.as_str());
        r["outcome"] == "rejected"
            && (message.contains("not allowed") || (probe && message.contains("not found")))
    });
    let count = refused.count();
    for r in results.iter().filter(|r| {
        r["outcome"] != "rejected"
            || !r["message"]
                .as_str()
                .is_some_and(|m| m.contains("not allowed") || m.contains("not found"))
    }) {
        failures.push(format!("not refused: {r}"));
    }
    (count, failures)
}

fn report(name: &str, page: &Value, total: usize, probes: &[String]) -> Vec<String> {
    let (refused, failures) = judge(page, probes);
    if page["ipc"] == false {
        println!(
            "{name} ({}): no IPC object on the page, all {total} commands refused by absence",
            page["origin"]
        );
    } else {
        println!(
            "{name} ({}): {refused} of {total} commands refused; control call answered: {}",
            page["origin"], page["control"]["message"]
        );
    }
    failures
        .into_iter()
        .map(|f| format!("{name}: {f}"))
        .collect()
}

/// What one launch saw: the two pages' answers, the navigation reply and the watch's findings.
struct Seen {
    remote: Value,
    moved: Value,
    local: Value,
    watch: Vec<String>,
}

/// One hidden launch: every command from the backend page, then from the shell's own origin.
fn launch_and_invoke(cmds: &[String]) -> Seen {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let run = PathBuf::from(RUN_ROOT).join(format!("ipc-{stamp}"));
    std::fs::create_dir_all(&run).expect("run folder");
    let _page = start_page(&run);
    let (stop, watch) = start_watch();
    let mut shell = launch_shell(&run);
    let port = devtools_port(&run, &mut shell);
    let remote = invoke_all(port, &format!("http://127.0.0.1:{PAGE_PORT}/"), cmds);
    let navigate = json!({ "url": SPLASH });
    let moved = cdp(port, "http://127.0.0.1", "Page.navigate", &navigate);
    let local = invoke_all(port, APP_ORIGIN, cmds);
    close_shell(&mut shell);
    drop(shell);
    stop.store(true, Ordering::SeqCst);
    let watch = watch
        .join()
        .unwrap_or_else(|_| vec!["the watch thread failed".into()]);
    Seen {
        remote,
        moved,
        local,
        watch,
    }
}

#[test]
fn every_core_and_plugin_command_is_refused_from_the_page() {
    let (core, plugins, probes) = every_command();
    let cmds: Vec<String> = core
        .iter()
        .chain(&plugins)
        .chain(&probes)
        .cloned()
        .collect();
    let counts = (core.len(), plugins.len(), probes.len(), cmds.len());
    println!(
        "commands: {} core, {} plugin, {} app probes, {} in all",
        counts.0, counts.1, counts.2, counts.3
    );
    let Seen {
        remote,
        moved,
        local,
        watch: seen,
    } = launch_and_invoke(&cmds);
    let mut failures = report("backend page", &remote, cmds.len(), &probes);
    failures.extend(report("shell origin", &local, cmds.len(), &probes));
    assert!(seen.is_empty(), "the global watch saw: {seen:?}");
    assert_eq!(
        local["ipc"], true,
        "the shell origin was not reached or has no IPC (navigate: {moved}): {local}"
    );
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
