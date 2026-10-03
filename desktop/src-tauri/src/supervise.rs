//! Supervision (03 sections 2.2 to 2.4, 8 and 17; 04 D4.3; 05 T08, T09 and G08): attach to a live backend or spawn
//! one in a kill-on-close Job Object, check its handshake, buy the session cookie, navigate, watch the backend's
//! exit, restart with back-off, and refuse a backend swapped in behind the window.
//!
//! This file holds the spawn, and with it the shell's one CreateProcessW: `<lab>/.venv/Scripts/python.exe -E -s -X
//! utf8 -X faulthandler -m nq_terminal` from `<lab>/terminal/backend`, the allow-listed environment,
//! CREATE_NO_WINDOW, and PROC_THREAD_ATTRIBUTE_JOB_LIST, so the venv launcher, the real interpreter and every
//! grandchild are in the job from their first instruction (fallback: CREATE_SUSPENDED, assign, resume). TOKEN and
//! NONCE go on stdin; a reader thread drains stdout and stderr into backend.log through writes.rs from the first byte,
//! and the handshake is the first `NQT-` line only. The checks are in supervise_check.rs, the attach, the watch and
//! the restarts in supervise_run.rs, and the window side in supervise_shell.rs.

#[path = "supervise_check.rs"]
pub mod check;
#[path = "supervise_retry.rs"]
pub mod retry;
#[path = "supervise_run.rs"]
pub mod run;
#[path = "supervise_shell.rs"]
pub mod shell;

pub use shell::{StaleHook, start};

use crate::link;
use crate::{crash, writes};
use check::{Expect, Failure, Mismatch, Ready, Spec};
use serde_json::json;
use std::fs::File;
use std::io::{Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::FromRawHandle;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use windows::Win32::Foundation::{
    CloseHandle, HANDLE, HANDLE_FLAG_INHERIT, HANDLE_FLAGS, SetHandleInformation, WAIT_OBJECT_0,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, OpenProcess,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, ResumeThread, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute, WaitForMultipleObjects,
    WaitForSingleObject,
};
use windows::core::{BOOL, PCWSTR, PWSTR};

/// How long a closed stdin gets before the Job Object ends the tree (03 section 2.3).
pub const STOP_GRACE_S: u64 = 5;
/// Cold first start after a reboot included; the budget is 1.5 s with a 2.5 s ceiling (02 T3).
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
/// The backend's exit code for a lock this user did not make (backend/nq_terminal/__main__.py, EXIT_UNTRUSTED_LOCK).
const EXIT_UNTRUSTED_LOCK: u32 = 4;
/// How long a backend whose output closed gets to finish ending, so that its exit code can be read.
const EXIT_CODE_WAIT_MS: u32 = 3000;
const MAX_HANDSHAKE_LINE: usize = 64 * 1024;
const READ_CHUNK: usize = 64 * 1024;
const MAX_JOB_PIDS: usize = 256;

// ---------------------------------------------------------------- handles

/// An owned kernel handle, closed once.
#[derive(Debug)]
pub struct Owned(HANDLE);

// SAFETY: a kernel handle is valid on every thread of the process, and `Owned` closes it exactly once.
unsafe impl Send for Owned {}
// SAFETY: as above; the handles here are only waited on, queried or closed.
unsafe impl Sync for Owned {}

impl Owned {
    pub fn raw(&self) -> HANDLE {
        self.0
    }

    /// The handle as a File (a pipe end); the File closes it.
    fn into_file(self) -> File {
        let raw = self.0;
        std::mem::forget(self);
        // SAFETY: `raw` is an open pipe handle this process owns; ownership moves to the File.
        unsafe { File::from_raw_handle(raw.0) }
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: the handle is open and owned here; it is closed once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

fn win(what: &str) -> impl Fn(windows::core::Error) -> Failure + '_ {
    move |e| Failure::Spawn(format!("{what}: {e}"))
}

/// Whether any of the handles is signalled within `wait` (a process that ended, or the stop event).
pub fn signalled_within(handles: &[HANDLE], wait: Duration) -> bool {
    let millis = u32::try_from(wait.as_millis()).unwrap_or(u32::MAX - 1);
    // SAFETY: a bounded wait on open handles.
    let at = unsafe { WaitForMultipleObjects(handles, false, millis) };
    at.0 < WAIT_OBJECT_0.0 + handles.len() as u32
}

// ---------------------------------------------------------------- the job

fn kill_on_close_job() -> Result<Owned, Failure> {
    // SAFETY: a new unnamed job, owned at once.
    let job =
        Owned(unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(win("CreateJobObjectW"))?);
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let size = size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    let class = JobObjectExtendedLimitInformation;
    // SAFETY: `info` outlives the call that reads it; the job handle is open.
    unsafe { SetInformationJobObject(job.raw(), class, (&raw const info).cast(), size) }
        .map_err(win("SetInformationJobObject"))?;
    Ok(job)
}

/// Every process id in the job (the launcher, the real interpreter and their children).
pub fn job_pids(job: HANDLE) -> Vec<u32> {
    let mut words = vec![0usize; 2 + MAX_JOB_PIDS];
    let size = (words.len() * size_of::<usize>()) as u32;
    let class = JobObjectBasicProcessIdList;
    // SAFETY: the buffer is `size` writable bytes, aligned for JOBOBJECT_BASIC_PROCESS_ID_LIST.
    let queried = unsafe {
        QueryInformationJobObject(Some(job), class, words.as_mut_ptr().cast(), size, None)
    };
    if queried.is_err() {
        return Vec::new();
    }
    let listed = (words[0] >> 32) & 0xffff_ffff;
    let ids = words[1..].iter().take(listed.min(MAX_JOB_PIDS));
    ids.map(|p| *p as u32).collect()
}

/// A handle on a process that is in the job (checked on the handle, so a reused pid cannot pass).
fn open_in_job(job: &Owned, pid: u32) -> Option<Owned> {
    let access = PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION;
    // SAFETY: opens a process for waiting and a job query; the handle is owned at once.
    let handle = Owned(unsafe { OpenProcess(access, false, pid) }.ok()?);
    let mut inside = BOOL(0);
    // SAFETY: both handles are open; `inside` is a valid out-pointer.
    unsafe { IsProcessInJob(handle.raw(), Some(job.raw()), &mut inside) }.ok()?;
    inside.as_bool().then_some(handle)
}

// ---------------------------------------------------------------- pipes and the attribute list

/// One pipe: our end is not inheritable, the child's end is.
fn pipe(child_reads: bool) -> Result<(Owned, Owned), Failure> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        bInheritHandle: true.into(),
        ..Default::default()
    };
    let (mut read, mut write) = (HANDLE::default(), HANDLE::default());
    // SAFETY: both out-pointers and the attributes are valid for the call.
    unsafe { CreatePipe(&mut read, &mut write, Some(&sa), 0) }.map_err(win("CreatePipe"))?;
    let (read, write) = (Owned(read), Owned(write));
    let (ours, theirs) = if child_reads {
        (write, read)
    } else {
        (read, write)
    };
    // SAFETY: clears the inherit flag on a handle this process owns.
    unsafe { SetHandleInformation(ours.raw(), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) }
        .map_err(win("SetHandleInformation"))?;
    Ok((ours, theirs))
}

/// A process-thread attribute list naming the two inherited pipe ends and, on the first route, the job.
struct Attributes {
    words: Vec<usize>,
    initialised: bool,
    handles: Box<[HANDLE; 2]>,
    job: Box<HANDLE>,
}

impl Attributes {
    fn new(handles: [HANDLE; 2], job: Option<HANDLE>) -> Result<Self, Failure> {
        let count = if job.is_some() { 2 } else { 1 };
        let mut size = 0usize;
        // SAFETY: the size query; it fails by design and only writes `size`.
        let _ = unsafe { InitializeProcThreadAttributeList(None, count, None, &mut size) };
        let mut this = Self {
            words: vec![0usize; size.div_ceil(size_of::<usize>())],
            initialised: false,
            handles: Box::new(handles),
            job: Box::new(job.unwrap_or_default()),
        };
        let list = this.list();
        // SAFETY: the buffer holds at least `size` bytes.
        unsafe { InitializeProcThreadAttributeList(Some(list), count, None, &mut size) }
            .map_err(win("attribute list"))?;
        this.initialised = true;
        let handles: *const [HANDLE; 2] = &*this.handles;
        this.update(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handles.cast(),
            size_of::<[HANDLE; 2]>(),
        )?;
        if job.is_some() {
            let job: *const HANDLE = &*this.job;
            this.update(
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                job.cast(),
                size_of::<HANDLE>(),
            )?;
        }
        Ok(this)
    }

    /// Sets one attribute; `value` points into a box this list owns, so it lives as long as the list.
    fn update(
        &mut self,
        attribute: u32,
        value: *const std::ffi::c_void,
        size: usize,
    ) -> Result<(), Failure> {
        let list = self.list();
        // SAFETY: the list is initialised and `value` stays valid for the list's life.
        unsafe {
            UpdateProcThreadAttribute(list, 0, attribute as usize, Some(value), size, None, None)
        }
        .map_err(win("UpdateProcThreadAttribute"))
    }

    fn list(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        LPPROC_THREAD_ATTRIBUTE_LIST(self.words.as_mut_ptr().cast())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        if self.initialised {
            // SAFETY: the list was initialised and is deleted once.
            unsafe { DeleteProcThreadAttributeList(self.list()) };
        }
    }
}

// ---------------------------------------------------------------- the one CreateProcessW

fn wide(text: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    text.as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn env_block(env: &[(String, std::ffi::OsString)]) -> Vec<u16> {
    let mut block = Vec::new();
    for (name, value) in env {
        let mut pair = std::ffi::OsString::from(name);
        pair.push("=");
        pair.push(value);
        block.extend(wide(pair));
    }
    block.push(0);
    block
}

/// What one CreateProcessW call starts: the program, its exact command line, its folder and its environment.
struct ProcessLine<'a> {
    application: &'a Path,
    command_line: String,
    cwd: &'a Path,
    env: Vec<u16>,
}

/// The shell's one CreateProcessW: a hidden process in a kill-on-close Job Object with the given environment (the
/// backend, or one rebuild tool).
#[allow(
    clippy::disallowed_methods,
    reason = "the one place the shell starts a process: the backend and the rebuild tools, in a kill-on-close Job Object (03 section 2.1)"
)]
fn create_launch(
    launch: &ProcessLine<'_>,
    job: &Owned,
    child: [HANDLE; 2],
    in_job_list: bool,
) -> Result<PROCESS_INFORMATION, Failure> {
    let mut attributes = Attributes::new(child, in_job_list.then(|| job.raw()))?;
    let mut info = STARTUPINFOEXW::default();
    info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    (info.StartupInfo.hStdInput, info.StartupInfo.hStdOutput) = (child[0], child[1]);
    info.StartupInfo.hStdError = child[1];
    info.lpAttributeList = attributes.list();
    let mut flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
    if !in_job_list {
        flags |= CREATE_SUSPENDED;
    }
    let (app, cwd) = (wide(launch.application), wide(launch.cwd));
    let mut line = wide(&launch.command_line);
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: every pointer refers to a buffer that outlives the call; the attribute list is initialised.
    unsafe {
        CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            true,
            flags,
            Some(launch.env.as_ptr().cast()),
            PCWSTR(cwd.as_ptr()),
            &info.StartupInfo,
            &mut process,
        )
    }
    .map_err(win("CreateProcessW"))?;
    Ok(process)
}

/// The backend: the venv launcher with the allow-listed environment.
fn create_process(
    spec: &Spec,
    job: &Owned,
    child: [HANDLE; 2],
    in_job_list: bool,
) -> Result<PROCESS_INFORMATION, Failure> {
    let python = spec.python();
    let backend_dir = spec.backend_dir();
    let launch = ProcessLine {
        command_line: check::command_line(&python, spec.module),
        application: &python,
        cwd: &backend_dir,
        env: env_block(&check::backend_env(std::env::vars_os(), spec)),
    };
    create_launch(&launch, job, child, in_job_list)
}

/// A started process: the launcher's handle and pid, and our ends of its pipes (stdout until the reader takes it).
struct Started {
    job: Arc<Owned>,
    launcher: Owned,
    launcher_pid: u32,
    stdin: File,
    stdout: Option<File>,
}

/// The suspended fallback: put the process in the job, then let it run.
fn assign_and_resume(job: &Owned, process: &PROCESS_INFORMATION) -> Result<(), Failure> {
    // SAFETY: the suspended process's own handle; it runs only after it is in the job.
    unsafe { AssignProcessToJobObject(job.raw(), process.hProcess) }
        .map_err(win("AssignProcessToJobObject"))?;
    // SAFETY: the thread handle CreateProcessW returned.
    unsafe { ResumeThread(process.hThread) };
    Ok(())
}

/// Creates a process in the job: through the job-list attribute, or (when that fails) suspended, assigned and
/// resumed. `create` makes the process for the given route; the route's name is returned for the log.
fn start_in_job(
    job: &Owned,
    create: impl Fn(bool) -> Result<PROCESS_INFORMATION, Failure>,
) -> Result<(PROCESS_INFORMATION, &'static str), Failure> {
    match create(true) {
        Ok(p) => Ok((p, "job_list")),
        Err(first) => {
            crash::log(
                "supervise_job_list_failed",
                json!({ "error": format!("{first:?}") }),
            );
            let p = create(false)?;
            if let Err(e) = assign_and_resume(job, &p) {
                // SAFETY: the suspended process this call created; it never ran, and is ended before its handles close.
                let _ = unsafe { TerminateProcess(p.hProcess, 1) };
                drop((Owned(p.hProcess), Owned(p.hThread)));
                return Err(e);
            }
            Ok((p, "suspended_assign"))
        }
    }
}

/// Starts the backend in the job: the job-list attribute, or the suspended fallback.
fn start_process(spec: &Spec) -> Result<Started, Failure> {
    if !spec.python().is_file() {
        let missing = format!("{} does not exist", spec.python().display());
        return Err(Failure::Spawn(missing));
    }
    let job = kill_on_close_job()?;
    let (stdin_ours, stdin_theirs) = pipe(true)?;
    let (stdout_ours, stdout_theirs) = pipe(false)?;
    let child = [stdin_theirs.raw(), stdout_theirs.raw()];
    let (process, route) =
        start_in_job(&job, |in_list| create_process(spec, &job, child, in_list))?;
    drop((Owned(process.hThread), stdin_theirs, stdout_theirs));
    let launcher_pid = process.dwProcessId;
    crash::log(
        "supervise_spawned",
        json!({ "launcher_pid": launcher_pid, "route": route }),
    );
    Ok(Started {
        job: Arc::new(job),
        launcher: Owned(process.hProcess),
        launcher_pid,
        stdin: stdin_ours.into_file(),
        stdout: Some(stdout_ours.into_file()),
    })
}

// ---------------------------------------------------------------- the reader thread (05 T08)

/// Splits the stream into lines only until the first `NQT-` line, which it hands over once.
#[derive(Default)]
pub struct FirstNqt {
    pending: Vec<u8>,
    skipping: bool,
    found: bool,
}

impl FirstNqt {
    /// Feeds bytes; returns the first `NQT-` line once. A line longer than 64 KiB is never a handshake.
    pub fn feed(&mut self, chunk: &[u8]) -> Option<String> {
        if self.found {
            return None;
        }
        for &byte in chunk {
            if byte != b'\n' {
                if !self.skipping {
                    self.pending.push(byte);
                }
                if self.pending.len() > MAX_HANDSHAKE_LINE {
                    (self.pending, self.skipping) = (Vec::new(), true);
                }
                continue;
            }
            let line = std::mem::take(&mut self.pending);
            let was_skipping = std::mem::replace(&mut self.skipping, false);
            if !was_skipping && line.starts_with(b"NQT-") {
                self.found = true;
                return Some(String::from_utf8_lossy(&line).trim_end().to_string());
            }
        }
        None
    }
}

/// Drains the backend's output into backend.log from the first byte, rotating it through writes.rs at 5 MB with 5
/// kept, and sends the first `NQT-` line. It reads for as long as the pipe is open, so a noisy backend never blocks
/// on its own output (05 T08).
fn start_reader(stdout: File, log: PathBuf, first: mpsc::SyncSender<String>) {
    let spawned = std::thread::Builder::new()
        .name("nqt-backend-reader".into())
        .spawn(move || {
            let mut scan = FirstNqt::default();
            crash::drain_backend_output(stdout, &log, |chunk| {
                if let Some(line) = scan.feed(chunk) {
                    let _ = first.try_send(line);
                }
            });
        });
    if let Err(e) = spawned {
        crash::log("backend_reader_failed", json!({ "error": e.to_string() }));
    }
}

// ---------------------------------------------------------------- a spawned, checked backend

/// A backend this shell spawned. Dropping it closes stdin and ends the job's tree.
pub struct Spawned {
    job: Arc<Owned>,
    launcher: Owned,
    interpreter: Owned,
    launcher_pid: u32,
    pid: u32,
    port: u16,
    token: String,
    session: String,
    stdin: Mutex<Option<File>>,
}

impl Spawned {
    pub fn port(&self) -> u16 {
        self.port
    }
    /// The real interpreter's pid (the venv launcher's child), as checked against the job.
    #[allow(
        dead_code,
        reason = "read by tests/supervise_*.rs, which include this module by path"
    )]
    pub fn pid(&self) -> u32 {
        self.pid
    }
    #[allow(
        dead_code,
        reason = "read by tests/supervise_*.rs, which include this module by path"
    )]
    pub fn launcher_pid(&self) -> u32 {
        self.launcher_pid
    }
    pub fn job_pids(&self) -> Vec<u32> {
        job_pids(self.job.raw())
    }
    #[allow(
        dead_code,
        reason = "read by tests/supervise_*.rs, which include this module by path"
    )]
    pub fn token(&self) -> &str {
        &self.token
    }
    pub fn session(&self) -> &str {
        &self.session
    }
    fn exit_handles(&self) -> Vec<HANDLE> {
        vec![self.launcher.raw(), self.interpreter.raw()]
    }
    /// The backend's watchdog sees end of file and stops (03 section 2.3).
    pub fn close_stdin(&self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
    }
    /// Waits for the launcher and the interpreter to end; true when both ended in time.
    pub fn wait_exit(&self, timeout: Duration) -> bool {
        let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1);
        // SAFETY: a bounded wait on open process handles.
        let at = unsafe { WaitForMultipleObjects(&self.exit_handles(), true, millis) };
        at == WAIT_OBJECT_0
    }
    /// Ends every process in the job now.
    pub fn end(&self) {
        // SAFETY: the job handle is open; terminating an empty job is harmless.
        let _ = unsafe { TerminateJobObject(self.job.raw(), 1) };
    }
}

/// The token and the session value are the backend's secrets: never in a debug print or a log line.
impl std::fmt::Debug for Spawned {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (port, pid, launcher_pid) = (self.port, self.pid, self.launcher_pid);
        write!(
            f,
            "Spawned {{ port: {port}, pid: {pid}, launcher_pid: {launcher_pid} }}"
        )
    }
}

impl Drop for Spawned {
    fn drop(&mut self) {
        self.close_stdin();
        self.end();
    }
}

/// The checks on a READY answer that need the job: the pid in the job, and the listener owned by a job pid.
fn admit(started: &Started, ready: &Ready) -> Result<Owned, Failure> {
    let refused = |m| Err(Failure::Refused(m));
    if !job_pids(started.job.raw()).contains(&ready.pid) {
        return refused(Mismatch::PidOutsideJob(ready.pid));
    }
    match link::listener_owner(ready.port) {
        Ok(owner) if job_pids(started.job.raw()).contains(&owner) => {}
        Ok(owner) => return refused(Mismatch::Listener(Some(owner))),
        Err(_) => return refused(Mismatch::Listener(None)),
    }
    open_in_job(&started.job, ready.pid)
        .map_or_else(|| refused(Mismatch::PidOutsideJob(ready.pid)), Ok)
}

/// What an end before the handshake means: the untrusted-lock exit code is a refusal that no restart can cure, any
/// other end (or one that has not finished in time) is an exit.
fn ended_before_handshake(launcher: &Owned) -> Failure {
    // SAFETY: the launcher's own process handle, open for the life of `Started`.
    let ended = unsafe { WaitForSingleObject(launcher.raw(), EXIT_CODE_WAIT_MS) } == WAIT_OBJECT_0;
    let mut code = 0u32;
    // SAFETY: the process has ended when `ended` holds; the handle is open and `code` is a valid out-pointer.
    let read = unsafe { GetExitCodeProcess(launcher.raw(), &mut code) };
    match (ended, read) {
        (true, Ok(())) if code == EXIT_UNTRUSTED_LOCK => Failure::Refused(Mismatch::LockUntrusted),
        _ => Failure::Exited,
    }
}

fn handshake(
    started: &mut Started,
    spec: &Spec,
    token: &str,
    nonce: &str,
) -> Result<Ready, Failure> {
    let (tx, rx) = mpsc::sync_channel(1);
    let stdout = started.stdout.take().ok_or(Failure::Exited)?;
    start_reader(stdout, spec.log_path(), tx);
    let secrets = format!("TOKEN {token}\nNONCE {nonce}\n");
    if started.stdin.write_all(secrets.as_bytes()).is_err() {
        return Err(ended_before_handshake(&started.launcher));
    }
    let line = rx.recv_timeout(HANDSHAKE_TIMEOUT).map_err(|e| match e {
        mpsc::RecvTimeoutError::Timeout => Failure::Timeout,
        mpsc::RecvTimeoutError::Disconnected => ended_before_handshake(&started.launcher),
    })?;
    check::parse_handshake(&line).map_err(Failure::Refused)
}

/// Spawns the backend in its job and checks it through the session (03 section 2.2 steps 4 to 6): the READY MAC,
/// ROOT, prefix, contract and page build, the reported pid in the job, the listener owned by a job pid, a fresh
/// proof, and only then the token goes out for the session. Any failure drops the job handle, ending the tree.
pub fn spawn(spec: &Spec, expect: &Expect) -> Result<Spawned, Failure> {
    crash::append_backend_log(&spec.log_path(), b"").map_err(|e| Failure::Spawn(e.to_string()))?;
    let (token, nonce) = (link::fresh_secret(), link::fresh_secret());
    let mut started = start_process(spec)?;
    let ready = handshake(&mut started, spec, &token, &nonce)?;
    check::check_ready(&ready, &token, &nonce, expect).map_err(Failure::Refused)?;
    let interpreter = admit(&started, &ready)?;
    let job = started.job.clone();
    let owner_ok = move |pid| job_pids(job.raw()).contains(&pid);
    run::verify_target(ready.port, &token, &owner_ok, expect).map_err(Failure::Refused)?;
    let session = link::session(ready.port, &token, &owner_ok, run::LINK_TIMEOUT)
        .map_err(|e| Failure::Link(e.to_string()))?;
    let Started {
        job,
        launcher,
        launcher_pid,
        stdin,
        ..
    } = started;
    let (pid, port) = (ready.pid, ready.port);
    crash::log(
        "supervise_checked",
        json!({ "port": port, "pid": pid, "launcher_pid": launcher_pid }),
    );
    let stdin = Mutex::new(Some(stdin));
    Ok(Spawned {
        job,
        launcher,
        interpreter,
        launcher_pid,
        pid,
        port,
        token,
        session,
        stdin,
    })
}

// ---------------------------------------------------------------- the rebuild's tools

/// The most of a tool's output kept in its log.
const TOOL_LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Copies a tool's output into its log through writes.rs, up to a cap, and keeps draining so the tool never blocks.
fn drain_tool_output(mut output: File, log: PathBuf) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let (mut chunk, mut kept) = (vec![0u8; READ_CHUNK], 0u64);
        while let Ok(n @ 1..) = output.read(&mut chunk) {
            if kept < TOOL_LOG_MAX_BYTES {
                kept += n as u64;
                let _ = writes::append(&log, &chunk[..n]);
            }
        }
    })
}

/// The tool's own environment: this process's, with the caller's names set over it.
fn tool_env(extra: &[(String, String)]) -> Vec<u16> {
    let mut env: Vec<(String, std::ffi::OsString)> = std::env::vars_os()
        .map(|(n, v)| (n.to_string_lossy().into_owned(), v))
        .filter(|(n, _)| !extra.iter().any(|(e, _)| e.eq_ignore_ascii_case(n)))
        .collect();
    env.extend(extra.iter().map(|(n, v)| (n.clone(), v.into())));
    env.sort_by_key(|(n, _)| n.to_uppercase());
    env_block(&env)
}

/// Runs one tool of the page rebuild (window_rebuild.rs) to its end: `application` with `command_line` as given (the
/// exact CreateProcessW line), in `cwd`, with this process's environment plus `env`, hidden, in a kill-on-close job
/// that closes with the run (so nothing the tool left behind outlives it), its output appended to `log`. Returns the
/// tool's exit code.
pub fn run_tool(
    application: &Path,
    command_line: &str,
    cwd: &Path,
    env: &[(String, String)],
    log: &Path,
) -> Result<u32, String> {
    let text = |f: Failure| format!("{f:?}");
    let job = kill_on_close_job().map_err(text)?;
    let (stdin_ours, stdin_theirs) = pipe(true).map_err(text)?;
    let (out_ours, out_theirs) = pipe(false).map_err(text)?;
    let child = [stdin_theirs.raw(), out_theirs.raw()];
    let launch = ProcessLine {
        application,
        command_line: command_line.to_string(),
        cwd,
        env: tool_env(env),
    };
    let (process, _route) =
        start_in_job(&job, |in_list| create_launch(&launch, &job, child, in_list)).map_err(text)?;
    let (tool, _thread) = (Owned(process.hProcess), Owned(process.hThread));
    drop((stdin_ours, stdin_theirs, out_theirs));
    let reader = drain_tool_output(out_ours.into_file(), log.to_path_buf());
    // SAFETY: an unbounded wait on the tool's own process handle, which this function owns.
    let waited = unsafe { WaitForSingleObject(tool.raw(), INFINITE) };
    let mut code = 0u32;
    // SAFETY: the process has ended; the handle is open and `code` is a valid out-pointer.
    let read = unsafe { GetExitCodeProcess(tool.raw(), &mut code) };
    // SAFETY: the job handle is open; this ends anything the tool left running before the output drain waits.
    let _ = unsafe { TerminateJobObject(job.raw(), 1) };
    let _ = reader.join();
    if waited != WAIT_OBJECT_0 || read.is_err() {
        return Err("the tool's exit code could not be read".to_string());
    }
    Ok(code)
}
