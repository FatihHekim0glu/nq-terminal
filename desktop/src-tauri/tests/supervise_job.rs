//! The kill-on-close Job Object (03 sections 2.1 and 2.3; 05 T09; W0A P6): when the shell dies, the venv launcher,
//! the real interpreter and a JOBS-style grandchild all end within 5 s, because the backend is put in the job by
//! PROC_THREAD_ATTRIBUTE_JOB_LIST before its first instruction.
//!
//! The shell is played by this test binary itself, started again (hidden) to run only the ignored helper test, which
//! spawns the fake backend through `supervise::spawn` and waits; the test then kills that helper outright. Born
//! failing: `late_assignment_lets_the_grandchild_escape` shows the assign-after-spawn route the shell must never use
//! (the interpreter's child escapes the job and survives its close).
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: it starts its own helper and the fake backends, and ends only what it started"
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

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use supervise::check::{self, BACKEND_MODULE, Expect, Spec};
use support::{CREATE_NO_WINDOW, Collector, FakeLab, Tracked, fake_lab, records_in, watch};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows::core::PCWSTR;

const HELPER_ENV: &str = "NQT_SUPERVISE_HELPER_LAB";
const DEATH_LIMIT: Duration = Duration::from_secs(5);

fn spec_at(lab: PathBuf) -> Spec {
    let state_dir = lab.join("terminal").join("state");
    Spec {
        lab,
        state_dir,
        module: BACKEND_MODULE,
        extra_env: Vec::new(),
    }
}

/// Run only by the helper process: spawn the backend through the shell's code, report the three pids, wait to die.
#[test]
#[ignore = "the helper side of the_job_ends_the_tree_within_5s_of_the_shell_death; it runs only in that helper"]
fn helper_spawns_and_waits() {
    let Some(lab) = std::env::var_os(HELPER_ENV).map(PathBuf::from) else {
        return;
    };
    let spec = spec_at(lab.clone());
    let spawned = supervise::spawn(&spec, &Expect::for_lab(&lab, check::CONTRACT_RANGE))
        .expect("the helper spawns");
    let record: Value = support::FakeLab {
        run: lab.clone(),
        lab: lab.clone(),
        state: spec.state_dir.clone(),
    }
    .record(spawned.pid());
    let grandchild = record["grandchild_pid"]
        .as_u64()
        .expect("the fake started a grandchild");
    println!(
        "PIDS {} {} {grandchild}",
        spawned.launcher_pid(),
        spawned.pid()
    );
    let _ = std::io::stdout().flush();
    std::thread::sleep(Duration::from_secs(120));
    drop(spawned);
}

fn helper(lab: &FakeLab) -> std::process::Child {
    Command::new(std::env::current_exe().expect("this test binary"))
        .args([
            "--exact",
            "helper_spawns_and_waits",
            "--ignored",
            "--nocapture",
            "--test-threads",
            "1",
        ])
        .env(HELPER_ENV, &lab.lab)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("start the helper shell")
}

fn read_pids(child: &mut std::process::Child) -> Vec<u32> {
    let stdout = child.stdout.take().expect("piped stdout");
    // libtest may print the test's name on the same line first, so the report is found anywhere in a line.
    let lines = BufReader::new(stdout).lines().map_while(Result::ok);
    let line = lines
        .filter_map(|l| l.find("PIDS ").map(|at| l[at..].to_string()))
        .next();
    let line = line.expect("the helper reported its pids");
    line.split_whitespace()
        .skip(1)
        .filter_map(|p| p.parse().ok())
        .collect()
}

#[test]
fn the_job_ends_the_tree_within_5s_of_the_shell_death() {
    let watch = watch();
    let lab = fake_lab("job-death", &json!({ "grandchild": true }));
    let mut shell = helper(&lab);
    let pids = read_pids(&mut shell);
    assert_eq!(pids.len(), 3, "launcher, interpreter, grandchild: {pids:?}");
    let tracked: Vec<Tracked> = pids
        .iter()
        .map(|p| Tracked::open(*p).expect("alive before the death"))
        .collect();
    let running = tracked.iter().all(|t| !t.ended_within(Duration::ZERO));
    assert!(
        running,
        "all three must be running before the shell dies, or the test proves nothing"
    );
    shell.kill().expect("the shell dies");
    let died = Instant::now();
    let _ = shell.wait();
    let survivors: Vec<u32> = pids
        .iter()
        .zip(&tracked)
        .filter(|(_, t)| !t.ended_within(DEATH_LIMIT.saturating_sub(died.elapsed())))
        .map(|(p, _)| *p)
        .collect();
    for t in &tracked {
        t.end();
    }
    assert!(
        survivors.is_empty(),
        "outlived the shell by 5 s (launcher, interpreter, grandchild): {survivors:?}"
    );
    watch.assert_clean();
}

fn kill_on_close_job() -> HANDLE {
    // SAFETY: a new unnamed job configured before use; `info` outlives the call.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).expect("job");
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            size,
        )
        .expect("kill on close");
        job
    }
}

#[test]
fn late_assignment_lets_the_grandchild_escape() {
    let lab = fake_lab("job-late", &json!({ "grandchild": true }));
    let spec = spec_at(lab.lab.clone());
    let mut launcher = Command::new(spec.python())
        .args(check::SPAWN_ARGS)
        .arg(BACKEND_MODULE)
        .current_dir(spec.backend_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("a plain spawn");
    let output = Collector::of(&mut launcher);
    let secrets = format!(
        "TOKEN {}\nNONCE {}\n",
        link::fresh_secret(),
        link::fresh_secret()
    );
    launcher
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(secrets.as_bytes())
        .expect("secrets");
    let has_record = || !records_in(&output.lines()).is_empty();
    support::wait_until(Duration::from_secs(20), "the fake's record", has_record);
    let record = records_in(&output.lines()).remove(0);
    let interpreter =
        Tracked::open(record["pid"].as_u64().expect("pid") as u32).expect("interpreter");
    let grandchild = Tracked::open(record["grandchild_pid"].as_u64().expect("grandchild") as u32)
        .expect("grandchild");
    let job = kill_on_close_job();
    // SAFETY: the launcher's own handle, held by its Child; this is the route the shell must never take.
    unsafe { AssignProcessToJobObject(job, HANDLE(launcher.as_raw_handle())) }
        .expect("late assignment");
    // SAFETY: closing the job handle ends what is in the job: the launcher only.
    unsafe { CloseHandle(job) }.expect("close the job");
    let escaped = !grandchild.ended_within(Duration::from_secs(3));
    interpreter.end();
    grandchild.end();
    let _ = launcher.wait();
    assert!(
        escaped,
        "born failing: with assign-after-spawn the grandchild should outlive the job's close"
    );
}
