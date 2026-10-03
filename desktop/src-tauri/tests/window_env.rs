//! 05 X04: `WEBVIEW2_*` variables set in the parent never reach the engine, the shell's own environment after the
//! scrub, or the backend child (04 D4.2 item 8; 02 C3-8).
//!
//! The smoke exe starts with canaries for the four variables the plan names, plus one lower-case name, and loads the
//! static test page from 127.0.0.1:8810. A browser folder canary that WebView2 honoured would point the engine at an
//! empty folder, and an arguments canary would show in the engine's command line, so the test checks the engine's
//! own processes (descendants of the shell): the system runtime, the run's own profile folder, no canary switch. The
//! shell logs what it removed (`scrubbed`, in its start record) and what is left after start (`shell_env`).
//!
//! The backend child half runs through supervise.rs's spawn: a fake lab (never the real lab) whose venv launcher is a
//! copy of the lab's, and whose `nq_terminal` entry writes its environment to a file and exits.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

const ARGS_CANARY: &str = "--nqt-canary-switch";

/// The canaries: the four named variables and a lower-case one.
fn canaries(run: &Path) -> Vec<(&'static str, OsString)> {
    let folder = run.join("canary-runtime");
    std::fs::create_dir_all(&folder).expect("canary folder");
    vec![
        ("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", ARGS_CANARY.into()),
        ("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", folder.into()),
        ("WEBVIEW2_RELEASE_CHANNEL_PREFERENCE", "1".into()),
        ("WEBVIEW2_USER_DATA_FOLDER", run.join("canary-udf").into()),
        ("webview2_lower_case_canary", "1".into()),
    ]
}

/// Every msedgewebview2.exe in the shell's process tree, from WMI (read-only, through a hidden PowerShell).
fn engine_processes(shell_pid: u32) -> Vec<Value> {
    let query = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", query])
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .expect("run the process query");
    let all: Vec<Value> = serde_json::from_slice(&out.stdout).unwrap_or_default();
    let mut tree: HashSet<u64> = HashSet::from([u64::from(shell_pid)]);
    for _ in 0..6 {
        for p in &all {
            if tree.contains(&p["ParentProcessId"].as_u64().unwrap_or(0)) {
                tree.insert(p["ProcessId"].as_u64().unwrap_or(0));
            }
        }
    }
    all.into_iter()
        .filter(|p| tree.contains(&p["ProcessId"].as_u64().unwrap_or(0)))
        .filter(|p| {
            p["Name"]
                .as_str()
                .is_some_and(|n| n.eq_ignore_ascii_case("msedgewebview2.exe"))
        })
        .collect()
}

/// Every canary is in the start record's `scrubbed`, and nothing named WEBVIEW2_ is left after start.
fn check_shell(run: &Path, log: &[Value], shell_env: Option<Value>) {
    let start = log
        .iter()
        .find(|e| e["event"] == "start")
        .expect("start record");
    let scrubbed: Vec<String> = start["scrubbed"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|n| n.as_str().map(str::to_ascii_uppercase))
                .collect()
        })
        .unwrap_or_default();
    for (name, _) in canaries(run) {
        assert!(
            scrubbed.contains(&name.to_ascii_uppercase()),
            "{name} not scrubbed: {scrubbed:?}"
        );
    }
    let left = shell_env.unwrap_or_else(|| panic!("no shell_env line: {log:?}"));
    assert_eq!(
        left["webview2_left"],
        json!([]),
        "the shell kept WEBVIEW2_ variables: {left}"
    );
}

/// The engine runs from the system runtime with the run's own profile and no canary switch.
fn check_engines(run: &Path, engines: &[Value]) {
    assert!(
        !engines.is_empty(),
        "no engine process found under the shell"
    );
    let canary_folder = run
        .join("canary-runtime")
        .display()
        .to_string()
        .to_ascii_lowercase();
    let wv = run.join("wv").display().to_string().to_ascii_lowercase();
    for p in engines {
        let line = p["CommandLine"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let exe = p["ExecutablePath"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        assert!(
            !line.contains(ARGS_CANARY),
            "the arguments canary reached the engine: {line}"
        );
        assert!(
            !exe.starts_with(&canary_folder),
            "the browser folder canary was used: {exe}"
        );
        assert!(
            !line.contains("canary-udf"),
            "the profile canary was used: {line}"
        );
        if line.contains("--user-data-dir=") {
            assert!(
                line.contains(&wv),
                "the engine profile is not the run's own: {line}"
            );
        }
    }
    assert!(
        !run.join("canary-udf").exists(),
        "WEBVIEW2_USER_DATA_FOLDER reached the engine"
    );
}

#[test]
fn webview2_canaries_never_reach_the_engine_or_the_shell() {
    let _one = one_run();
    let run = run_dir("env");
    let _page = start_page_server(&run);
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend(["--attach-url".into(), page_url().into()]);
    let mut shell = launch(&run, &args, &canaries(&run));
    let pid = shell.0.id();
    let port = devtools_port(&run, &mut shell);
    let marker = "console.log(JSON.stringify({ marker: await evaluate('window.__marker') }));";
    let page = cdp(port, &page_url(), marker);
    let engines = engine_processes(pid);
    let shell_env = wait_for_event(&run, "shell_env", Duration::from_secs(10));
    let closed = close_shell(&mut shell);
    drop(shell);
    let report = watch.finish();
    assert!(page["marker"].is_string(), "the page never loaded: {page}");
    check_shell(&run, &shell_log(&run), shell_env);
    check_engines(&run, &engines);
    assert!(closed, "the shell did not close on WM_CLOSE");
    assert_clean(&report);
}

/// The fake backend entry: writes its environment beside the fake lab and exits.
const DUMP_ENV_PY: &str = r#"import json, os, pathlib
target = pathlib.Path(__file__).resolve().parents[2] / "state" / "child-env.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(dict(os.environ)), encoding="utf-8")
raise SystemExit(3)
"#;

#[test]
fn webview2_canaries_never_reach_the_backend_child() {
    let _one = one_run();
    let run = run_dir("child-env");
    let lab = fake_lab(&run, true);
    let venv = lab.join(".venv");
    let real_venv = lab_python()
        .parent()
        .and_then(Path::parent)
        .expect("venv")
        .to_path_buf();
    std::fs::copy(lab_python(), venv.join("Scripts").join("python.exe")).expect("launcher copy");
    std::fs::copy(real_venv.join("pyvenv.cfg"), venv.join("pyvenv.cfg")).expect("pyvenv.cfg copy");
    let entry = lab.join(r"terminal\backend\nq_terminal\__main__.py");
    std::fs::write(&entry, DUMP_ENV_PY).expect("fake entry");
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend([
        "--lab".into(),
        lab.clone().into(),
        "--state-dir".into(),
        run.join("state").into(),
    ]);
    let mut shell = launch(&run, &args, &canaries(&run));
    let dump = lab.join(r"terminal\state\child-env.json");
    let started = std::time::Instant::now();
    while !dump.is_file() && started.elapsed() < Duration::from_secs(60) {
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = close_shell(&mut shell);
    drop(shell);
    let report = watch.finish();
    let text =
        std::fs::read_to_string(&dump).unwrap_or_else(|_| panic!("the backend child never ran"));
    let env: Value = serde_json::from_str(&text).expect("child env JSON");
    let names: Vec<String> = env
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let leaked: Vec<&String> = names
        .iter()
        .filter(|n| n.to_ascii_uppercase().starts_with("WEBVIEW2_"))
        .collect();
    assert!(
        leaked.is_empty(),
        "WEBVIEW2_ variables reached the backend child: {leaked:?}"
    );
    assert_clean(&report);
}
