//! The rebuild's tool runner (03 section 7.1; 04 D4.2 item 12): one hidden process in a kill-on-close job, started
//! with the exact command line the caller gives, in the folder and environment the caller gives, its output kept in a
//! log, its exit code returned, and whatever it left running ended when the run is over.
//!
//! Born failing: against the supervisor before `run_tool` existed nothing here compiles; the straggler test fails for
//! a runner that waits for the tool but does not close its job.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it makes its own run folder and reads the log the runner wrote"
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

use std::path::{Path, PathBuf};
use std::time::Duration;
use support::{RUN_ROOT, Tracked, lab_python, wait_until, watch};

/// A limit no test tool comes near; the one test of the limit itself passes its own.
const TOOL_LIMIT: Duration = Duration::from_secs(120);

fn run_folder(name: &str) -> PathBuf {
    let dir = Path::new(RUN_ROOT).join(format!("tool-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("run folder");
    dir
}

/// The tool: the lab's interpreter running `code`, as the exact line CreateProcessW gets.
fn python_line(code: &str) -> (PathBuf, String) {
    let python = lab_python();
    let line = format!("\"{}\" -c \"{code}\"", python.display());
    (python, line)
}

fn log_text(log: &Path) -> String {
    std::fs::read_to_string(log).unwrap_or_default()
}

#[test]
fn a_tool_runs_where_and_how_it_is_told_and_its_exit_code_comes_back() {
    let watching = watch();
    let dir = run_folder("exit");
    let log = dir.join("rebuild.log");
    let code = "import os,sys; print('cwd=' + os.getcwd()); print('marker=' + os.environ['NQT_TOOL_MARKER']); sys.exit(3)";
    let (python, line) = python_line(code);
    let env = vec![("NQT_TOOL_MARKER".to_string(), "from-the-caller".to_string())];
    let exit = supervise::run_tool(&python, &line, &dir, &env, &log, TOOL_LIMIT);
    assert_eq!(exit, Ok(3), "the exit code is the tool's own");
    let text = log_text(&log);
    assert!(text.contains("marker=from-the-caller"), "log: {text}");
    let want = format!("cwd={}", dir.display()).to_lowercase();
    assert!(text.to_lowercase().contains(&want), "log: {text}");
    watching.assert_clean();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_program_is_an_error_not_a_panic() {
    let dir = run_folder("missing");
    let missing = dir.join("no-such-tool.exe");
    let line = format!("\"{}\" --version", missing.display());
    let log = dir.join("rebuild.log");
    let exit = supervise::run_tool(&missing, &line, &dir, &[], &log, TOOL_LIMIT);
    assert!(exit.is_err(), "got {exit:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn what_the_tool_leaves_running_ends_with_the_run() {
    let watching = watch();
    let dir = run_folder("straggler");
    let log = dir.join("rebuild.log");
    let code = "import subprocess,sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], creationflags=0x08000000); print('straggler=%d' % p.pid)";
    let (python, line) = python_line(code);
    assert_eq!(
        supervise::run_tool(&python, &line, &dir, &[], &log, TOOL_LIMIT),
        Ok(0)
    );
    let text = log_text(&log);
    let pid: u32 = text
        .lines()
        .find_map(|l| l.strip_prefix("straggler="))
        .and_then(|p| p.trim().parse().ok())
        .expect("the tool printed its straggler's pid");
    if let Some(straggler) = Tracked::open(pid) {
        wait_until(
            Duration::from_secs(5),
            "the straggler ends with the job",
            || straggler.ended_within(Duration::from_millis(100)),
        );
    }
    watching.assert_clean();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_tool_that_outlives_its_limit_is_stopped_and_the_run_says_so() {
    let watching = watch();
    let dir = run_folder("timeout");
    let log = dir.join("rebuild.log");
    let code = "import os,subprocess,sys,time; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], creationflags=0x08000000); print('pid=%d' % os.getpid()); print('straggler=%d' % p.pid); sys.stdout.flush(); time.sleep(120)";
    let (python, line) = python_line(code);
    let started = std::time::Instant::now();
    let exit = supervise::run_tool(&python, &line, &dir, &[], &log, Duration::from_secs(3));
    let took = started.elapsed();
    let why = exit.expect_err("a tool that never ends is an error, not an exit code");
    assert!(why.contains("did not finish within 3 s"), "why: {why}");
    assert!(
        took < Duration::from_secs(30),
        "the wait is bounded, took {took:?}"
    );
    let text = log_text(&log);
    for key in ["pid=", "straggler="] {
        let pid: u32 = text
            .lines()
            .find_map(|l| l.strip_prefix(key))
            .and_then(|p| p.trim().parse().ok())
            .unwrap_or_else(|| panic!("the tool printed {key}: {text}"));
        if let Some(process) = Tracked::open(pid) {
            wait_until(
                Duration::from_secs(5),
                "the stopped tool and what it started end with the run",
                || process.ended_within(Duration::from_millis(100)),
            );
        }
    }
    watching.assert_clean();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_tool_that_ends_inside_its_limit_keeps_its_exit_code() {
    let dir = run_folder("inside");
    let log = dir.join("rebuild.log");
    let (python, line) = python_line("import sys; sys.exit(7)");
    let exit = supervise::run_tool(&python, &line, &dir, &[], &log, Duration::from_secs(60));
    assert_eq!(exit, Ok(7));
    let _ = std::fs::remove_dir_all(&dir);
}
