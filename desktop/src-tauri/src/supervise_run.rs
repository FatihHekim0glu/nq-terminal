//! Attach, the identity proof on demand, the exit watch and the restart loop (03 sections 2.2 and 17; 05 G08).
//!
//! - Attach: `<state>/backend.lock` is read through reads.rs (which checks the handle's owner and DACL as the backend's
//!   lock.py does); the listener on 127.0.0.1:<port> must belong to the lock's pid and a fresh-nonce proof must
//!   verify with the lock's token. Any doubt means no attach, and the caller spawns. An attached backend is never
//!   stopped by this shell.
//! - Watch: the loop thread waits on the spawned launcher and interpreter (or the attached pid) and on the stop event,
//!   so an exit sends the window to stopped.html at once.
//! - Navigation: `Shared::navigation_verdict` re-runs the ownership check and a fresh proof off the UI thread within
//!   500 ms; a backend swapped in behind the port is refused and the token never goes to it. A proof that is only
//!   late is unverified, not swapped: the navigation is cancelled and retried off the UI thread (supervise_retry.rs).
//! - Restarts at 1, 2 and 4 s; three crashes within 60 s stop the retries and ask Restart or Quit.
//! - A backend that ends while its spawn-time proof is retried is an exit (with its exit code in the log), not a
//!   refusal, when the failed proof carries no checked answer (`proof_failure`); a checked answer stays a refusal.
//! - A refusal ends the loop and leaves no backend; the stopped page's Retry link then starts the loop again through
//!   the same supervised spawn and checks (`retry_without_backend`), and one loop at most runs at a time.

use super::check::{Expect, Failure, Mismatch, Spec};
use super::retry::{self, Approval};
use super::{Owned, Spawned, signalled_within};
use crate::link;
use crate::{ShellError, crash};
use serde::Deserialize;
use serde_json::json;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    CreateEventW, GetExitCodeProcess, INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, SetEvent, WaitForMultipleObjects, WaitForSingleObject,
};
use windows::core::PCWSTR;

/// Restart back-off in seconds, and the crash window that stops retries (03 section 17).
pub const RESTART_BACKOFF_S: [u64; 3] = [1, 2, 4];
pub const CRASHES_BEFORE_STOP: usize = 3;
pub const CRASH_WINDOW_S: u64 = 60;
/// The navigation check's budget, off the UI thread (02 C3-4).
pub const NAVIGATION_CHECK: Duration = Duration::from_millis(500);
/// One request to the backend's shell routes.
pub const LINK_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a spawn-time proof that got no checked answer waits for the backend to finish ending, so that an ending
/// backend is told from a live one that has lost its port (a process's port can close a little before it ends).
pub const EXIT_SETTLE: Duration = Duration::from_secs(3);
/// The wrong-key answer to a fresh proof: a checked answer, never the sign of an ending backend.
pub const PROOF_MISMATCH: &str = "the proof does not match the token";

/// A live backend found through its lock. Dropping it only closes this shell's handle: it is never stopped.
pub struct Attached {
    process: Owned,
    pid: u32,
    port: u16,
    token: String,
    session: String,
}

/// The token and the session value are the backend's secrets: never in a debug print or a log line.
impl std::fmt::Debug for Attached {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Attached {{ port: {}, pid: {} }}", self.port, self.pid)
    }
}

impl Attached {
    pub fn port(&self) -> u16 {
        self.port
    }
    #[allow(
        dead_code,
        reason = "read by tests/supervise_*.rs, which include this module by path"
    )]
    pub fn pid(&self) -> u32 {
        self.pid
    }
}

/// The checked backend the window is on.
#[derive(Debug)]
pub enum Backend {
    Spawned(Spawned),
    Attached(Attached),
}

impl Backend {
    pub fn port(&self) -> u16 {
        match self {
            Self::Spawned(s) => s.port,
            Self::Attached(a) => a.port,
        }
    }
    fn token(&self) -> &str {
        match self {
            Self::Spawned(s) => &s.token,
            Self::Attached(a) => &a.token,
        }
    }
    pub fn session(&self) -> &str {
        match self {
            Self::Spawned(s) => &s.session,
            Self::Attached(a) => &a.session,
        }
    }
    /// Who may answer on its port: a process in the job, or the attached pid.
    pub fn owner_ok(&self, pid: u32) -> bool {
        match self {
            Self::Spawned(s) => s.job_pids().contains(&pid),
            Self::Attached(a) => a.pid == pid,
        }
    }
    fn exit_handles(&self) -> Vec<HANDLE> {
        match self {
            Self::Spawned(s) => s.exit_handles(),
            Self::Attached(a) => vec![a.process.raw()],
        }
    }
    /// Whether the checked process has ended (the main defence of 05 G08).
    pub fn exited(&self) -> bool {
        signalled_within(&self.exit_handles(), Duration::ZERO)
    }
}

/// The ownership check and a fresh-nonce proof against one port: the proof carries no secret; its answer is checked
/// with the token, the port and an accepted pid.
pub(super) fn verify_target(
    port: u16,
    token: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    expect: &Expect,
) -> Result<(), Mismatch> {
    verify_target_for(port, token, owner_ok, expect, LINK_TIMEOUT)
}

/// `verify_target` with its own link budget (a retried proof at spawn gets the retry's longer one).
pub(super) fn verify_target_for(
    port: u16,
    token: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    expect: &Expect,
    budget: Duration,
) -> Result<(), Mismatch> {
    let nonce = link::fresh_secret();
    let body = link::proof(port, &nonce, owner_ok, budget).map_err(retry::link_refusal)?;
    if !owner_ok(body.pid) {
        return Err(Mismatch::PidOutsideJob(body.pid));
    }
    if !link::verify_mac(token, link::PROOF_KIND, &nonce, port, body.pid, &body.proof) {
        return Err(Mismatch::Proof(PROOF_MISMATCH.into()));
    }
    super::check::check_place(&body.root, &body.prefix, body.contract, expect)
}

/// Whether a failed spawn-time proof carries no checked answer, so that a backend which is ending can be its cause: it
/// was late or cut off, found no listener, could not be read, or named one of the backend's `own` pids (which leave
/// the job as they end). A foreign owner, a wrong proof and a wrong place are checked answers and stay refusals.
pub fn unanswered(m: &Mismatch, own: &[u32]) -> bool {
    match m {
        Mismatch::Unverified(_) | Mismatch::Listener(None) => true,
        Mismatch::Listener(Some(pid)) | Mismatch::PidOutsideJob(pid) => own.contains(pid),
        Mismatch::Proof(why) => why != PROOF_MISMATCH,
        _ => false,
    }
}

/// The exit code of the first of `processes` (in the order given) that has ended within `settle`, or None while
/// every one still runs.
pub fn ended_code(processes: &[HANDLE], settle: Duration) -> Option<u32> {
    if !signalled_within(processes, settle) {
        return None;
    }
    processes.iter().find_map(|&process| {
        // SAFETY: a zero wait on an open process handle.
        let ended = unsafe { WaitForSingleObject(process, 0) } == WAIT_OBJECT_0;
        let mut code = 0u32;
        // SAFETY: the process has ended when `ended` holds; the handle is open and `code` is a valid out-pointer.
        (ended && unsafe { GetExitCodeProcess(process, &mut code) }.is_ok()).then_some(code)
    })
}

/// How a failed spawn-time proof on `port` ends: an exit, its exit code logged, when the reason carries no checked
/// answer (`unanswered`) and one of the backend's `processes` has ended or ends within `EXIT_SETTLE`; the refusal
/// itself otherwise, with its own reason.
pub fn proof_failure(m: Mismatch, port: u16, processes: &[HANDLE], own: &[u32]) -> Failure {
    let ended = unanswered(&m, own)
        .then(|| ended_code(processes, EXIT_SETTLE))
        .flatten();
    let Some(code) = ended else {
        return Failure::Refused(m);
    };
    crash::log(
        "supervise_exit_during_proof",
        json!({ "port": port, "code": code, "after": m.code() }),
    );
    Failure::Exited(Some(code))
}

/// The navigation check (05 G08): the backend has not ended, and its port passes the ownership check and a fresh
/// proof.
pub fn verify_now(backend: &Backend, expect: &Expect) -> Result<(), Mismatch> {
    if backend.exited() {
        let ended = "the backend this window was checked against has ended";
        return Err(Mismatch::Proof(ended.into()));
    }
    verify_target(
        backend.port(),
        backend.token(),
        &|pid| backend.owner_ok(pid),
        expect,
    )
}

/// `verify_now` on its own thread, unverified when it takes longer than `budget`.
pub fn verify_within(
    backend: Arc<Backend>,
    expect: Arc<Expect>,
    budget: Duration,
) -> Result<(), Mismatch> {
    retry::within(budget, move || verify_now(&backend, &expect))
}

#[derive(Deserialize)]
struct LockFile {
    v: u32,
    pid: u32,
    port: u16,
    token: String,
}

fn skip<T>(why: &str) -> Option<T> {
    crash::log("supervise_attach_skipped", json!({ "why": why }));
    None
}

/// Attaches to the backend named by a live lock, or None (with the reason logged) so the caller spawns.
pub fn try_attach(spec: &Spec, expect: &Expect) -> Option<Attached> {
    let text = match crate::reads::read_lock(&spec.lock_path()) {
        Ok(text) => text,
        Err(crate::reads::ReadError::Missing(_)) => return None,
        Err(e) => return skip(&format!("the lock was not trusted or not read: {e}")),
    };
    let Ok(lock) = serde_json::from_str::<LockFile>(&text) else {
        return skip("the lock is not valid");
    };
    if lock.v != 1 || link::listener_owner(lock.port).ok() != Some(lock.pid) {
        return skip("the lock's port is not served by the lock's process");
    }
    let access = PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION;
    // SAFETY: opens the lock's process for waiting only; the handle is owned at once.
    let Ok(raw) = (unsafe { OpenProcess(access, false, lock.pid) }) else {
        return skip("the lock's process is gone");
    };
    let process = Owned(raw);
    let owner_ok = |p| p == lock.pid;
    if let Err(m) = verify_target(lock.port, &lock.token, &owner_ok, expect) {
        return skip(&m.message());
    }
    match link::session(lock.port, &lock.token, &owner_ok, LINK_TIMEOUT) {
        Ok(session) => {
            let (pid, port, token) = (lock.pid, lock.port, lock.token);
            Some(Attached {
                process,
                pid,
                port,
                token,
                session,
            })
        }
        Err(e) => skip(&e.to_string()),
    }
}

/// Attach to a live lock, or spawn.
pub fn connect(spec: &Spec, expect: &Expect) -> Result<Backend, Failure> {
    if let Some(attached) = try_attach(spec, expect) {
        crash::log(
            "supervise_attached",
            json!({ "port": attached.port, "pid": attached.pid }),
        );
        return Ok(Backend::Attached(attached));
    }
    super::spawn(spec, expect).map(Backend::Spawned)
}

// ---------------------------------------------------------------- restarts

/// What to do after a backend exit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Next {
    Retry(Duration),
    GiveUp,
}

/// 1, 2 and 4 s between restarts within a streak (a run of 60 s or more ends the streak); three crashes within 60 s
/// stop the retries (03 section 17).
#[derive(Debug, Default)]
pub struct RestartPolicy {
    crashes: VecDeque<Instant>,
    streak: usize,
}

impl RestartPolicy {
    pub fn crashed(&mut self, at: Instant, ran_for: Duration) -> Next {
        let window = Duration::from_secs(CRASH_WINDOW_S);
        if ran_for >= window {
            self.streak = 0;
        }
        self.streak += 1;
        self.crashes.push_back(at);
        while self
            .crashes
            .front()
            .is_some_and(|t| at.duration_since(*t) > window)
        {
            self.crashes.pop_front();
        }
        if self.crashes.len() >= CRASHES_BEFORE_STOP {
            return Next::GiveUp;
        }
        let step = RESTART_BACKOFF_S[(self.streak - 1).min(RESTART_BACKOFF_S.len() - 1)];
        Next::Retry(Duration::from_secs(step))
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

// ---------------------------------------------------------------- the loop

/// The answer after three crashes in 60 s.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AfterStop {
    Restart,
    Quit,
}

/// Where the loop sends the window: the backend's page, the stopped page, or the Restart or Quit question.
pub trait Sink: Send + Sync {
    fn ready(&self, port: u16, session: &str);
    fn stopped(&self, code: &str);
    /// The backend ended (the "exited" reason) with this exit code, None when it could not be read. The default only
    /// shows the reason; the window also writes the code into the stopped page in words.
    fn exited(&self, exit_code: Option<u32>) {
        let _ = exit_code;
        self.stopped("exited");
    }
    fn gave_up(&self, log: &Path) -> AfterStop;
    /// The backend reports the page build `state` (stale or missing). True when the page was rebuilt and the loop
    /// should start the backend again; false when the sink has shown why not. The default shows the stopped page.
    fn stale_dist(&self, state: &str) -> bool {
        let _ = state;
        self.stopped(Mismatch::Dist(String::new()).code());
        false
    }
    /// Sends the window on to `uri`, the backend page a retried proof has just passed for.
    fn reload(&self, uri: &str) {
        let _ = uri;
    }
    /// The Retry link was followed: show at once (and announce) that the proof is being tried again.
    fn checking(&self) {}
    /// Every retried proof was late again: say so in place when the stopped page is showing (a navigation to the
    /// address already shown would change and announce nothing); the default shows the stopped page.
    fn still_unverified(&self) {
        self.stopped(Mismatch::Unverified(String::new()).code());
    }
}

/// What a top-level navigation may do.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    /// Not the backend's origin: cancelled, and the page stays.
    Cancel,
    /// The backend's origin, but the backend failed the check: cancelled, and the stopped page shown.
    Refuse(Mismatch),
    /// The proof was only late (or the Retry link was followed): cancelled, the proof retried off the UI thread,
    /// and the window sent on to this address when it passes.
    Retry(String),
    /// The Retry link was followed with no backend to check: cancelled, and a new supervised backend started when no
    /// loop is running (`retry_without_backend`).
    Gone,
}

/// What the loop, the navigation check and the close share.
pub struct Shared {
    pub spec: Spec,
    pub expect: Arc<Expect>,
    current: Mutex<Option<Arc<Backend>>>,
    stop_event: Owned,
    stopping: AtomicBool,
    /// Held by the one running supervision loop.
    looping: AtomicBool,
    approved: Approval,
}

/// The running loop's hold on `Shared::looping`, let go when the loop ends however it ends.
struct LoopHold<'a>(&'a AtomicBool);

impl Drop for LoopHold<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Shared {
    pub fn new(spec: Spec, expect: Expect) -> Result<Arc<Self>, ShellError> {
        // SAFETY: a new unnamed manual-reset event, owned at once.
        let event = unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
            .map_err(|e| ShellError::Io(e.to_string()))?;
        Ok(Arc::new(Self {
            spec,
            expect: Arc::new(expect),
            current: Mutex::new(None),
            stop_event: Owned(event),
            stopping: AtomicBool::new(false),
            looping: AtomicBool::new(false),
            approved: Approval::default(),
        }))
    }

    pub fn current(&self) -> Option<Arc<Backend>> {
        self.current.lock().ok().and_then(|c| c.clone())
    }

    fn set_current(&self, backend: Option<Arc<Backend>>) {
        if let Ok(mut current) = self.current.lock() {
            *current = backend;
        }
    }

    /// Stops the loop and its waits at once.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        // SAFETY: the event handle is open for the life of `self`.
        let _ = unsafe { SetEvent(self.stop_event.raw()) };
    }

    pub fn stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    /// The hold for a new loop, or None while one runs.
    fn hold_loop(&self) -> Option<LoopHold<'_>> {
        let free = self
            .looping
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst);
        free.ok().map(|_| LoopHold(&self.looping))
    }

    /// The top-level navigation rule (05 G08): the shell's own pages pass; the backend's origin passes after a
    /// fresh ownership check and proof within 500 ms (or a retried proof that has just passed); a proof that is only
    /// late is retried; everything else is cancelled.
    pub fn navigation_verdict(&self, uri: &str) -> Verdict {
        if retry::is_retry_request(uri) {
            return self.retry_target(None);
        }
        if uri.starts_with("http://tauri.localhost/") || uri == "about:blank" {
            return Verdict::Allow;
        }
        let Some(backend) = self.current() else {
            return Verdict::Cancel;
        };
        let origin = link::origin(backend.port());
        if uri != origin && !uri.starts_with(&format!("{origin}/")) {
            return Verdict::Cancel;
        }
        if self.approved.take(backend.port(), Instant::now()) && !backend.exited() {
            return Verdict::Allow;
        }
        match verify_within(backend, self.expect.clone(), NAVIGATION_CHECK) {
            Ok(()) => Verdict::Allow,
            Err(Mismatch::Unverified(_)) => self.retry_target(Some(uri)),
            Err(m) => Verdict::Refuse(m),
        }
    }

    /// Where a retried proof sends the window: `uri`, or the backend's page for the Retry link.
    fn retry_target(&self, uri: Option<&str>) -> Verdict {
        match (uri, self.current()) {
            (Some(uri), _) => Verdict::Retry(uri.to_string()),
            (None, Some(b)) => Verdict::Retry(format!("{}/", link::origin(b.port()))),
            (None, None) => Verdict::Gone,
        }
    }

    /// Off the UI thread: the proof again, with a longer budget, a few times; when it passes the window goes on to
    /// `uri` (that one navigation is approved), and when it does not the stopped page says why.
    pub fn retry_navigation(&self, sink: &dyn Sink, uri: &str) {
        sink.checking();
        let once = || match self.current() {
            Some(b) => {
                let port = b.port();
                let passed = verify_within(b, self.expect.clone(), retry::RETRY_BUDGET);
                passed.inspect(|()| self.approved.grant(port, Instant::now()))
            }
            None => Err(Mismatch::Proof("the backend has ended".into())),
        };
        let pause = || signalled_within(&[self.stop_event.raw()], retry::RETRY_PAUSE);
        let done = retry::retry(retry::RETRY_ATTEMPTS, once, pause);
        if !self.stopping() {
            conclude_retry(sink, uri, done, self.current().is_none());
        }
    }
}

/// How a retry ends: on to `uri` when the proof passed; the "exited" section when the backend has ended meanwhile;
/// an announcement in place when it was late every time; the refusal's own section otherwise.
pub fn conclude_retry(sink: &dyn Sink, uri: &str, done: Result<(), Mismatch>, backend_gone: bool) {
    match done {
        Ok(()) => sink.reload(uri),
        Err(_) if backend_gone => sink.stopped("exited"),
        Err(Mismatch::Unverified(_)) => sink.still_unverified(),
        Err(m) => sink.stopped(m.code()),
    }
}

/// Serves one backend until it exits or the loop stops; Some(how long it ran) after an exit.
fn serve(shared: &Shared, sink: &dyn Sink, backend: Backend) -> Option<Duration> {
    let started = Instant::now();
    let backend = Arc::new(backend);
    let attached = matches!(*backend, Backend::Attached(_));
    crash::log(
        "supervise_ready",
        json!({ "port": backend.port(), "attached": attached }),
    );
    shared.set_current(Some(backend.clone()));
    sink.ready(backend.port(), backend.session());
    let own_handles = backend.exit_handles();
    let mut handles = own_handles.clone();
    handles.push(shared.stop_event.raw());
    // SAFETY: an unbounded wait on open handles; the stop event ends it on close.
    let _ = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
    // The interpreter's own code is the backend's (its handle is the last of a spawned backend's).
    let interpreter_first: Vec<HANDLE> = own_handles.iter().rev().copied().collect();
    let exit_code = ended_code(&interpreter_first, Duration::ZERO);
    shared.set_current(None);
    if shared.stopping() {
        return None;
    }
    let ran = started.elapsed();
    crash::log(
        "supervise_exit",
        json!({ "port": backend.port(), "ran_ms": ran.as_millis(), "code": exit_code }),
    );
    sink.exited(exit_code);
    Some(ran)
}

/// One attempt: Some(how long it lasted) when it counts as a crash, None when the loop must end.
fn attempt(shared: &Shared, sink: &dyn Sink) -> Option<Duration> {
    let began = Instant::now();
    match connect(&shared.spec, &shared.expect) {
        Ok(backend) => serve(shared, sink, backend),
        Err(Failure::Refused(m)) => {
            crash::log(
                "supervise_refused",
                json!({ "code": m.code(), "message": m.message() }),
            );
            match &m {
                Mismatch::Dist(state) => return sink.stale_dist(state).then(|| began.elapsed()),
                // Said in place when the unverified section already shows (after its Retry link).
                Mismatch::Unverified(_) => sink.still_unverified(),
                _ => sink.stopped(m.code()),
            }
            None
        }
        Err(other) => {
            let error = format!("{other:?}");
            crash::log(
                "supervise_failed",
                json!({ "code": other.code(), "error": error }),
            );
            // Every failure that shows the "exited" reason says so through `exited`, with the code when it is known.
            if other.code() == "exited" {
                sink.exited(other.exit_code());
            } else {
                sink.stopped(other.code());
            }
            Some(began.elapsed())
        }
    }
}

/// The stopped page's Retry link with no backend left (a refusal at spawn ended the loop): show at once that the
/// backend is being checked again, then start the loop again on this thread, so a new backend goes through the same
/// supervised spawn, proof and owner checks, and a new refusal shows its own section. While a loop already runs (a
/// restart under way) it only says so: that loop sends the window on.
pub fn retry_without_backend(shared: Arc<Shared>, sink: Arc<dyn Sink>) {
    if shared.stopping() {
        return;
    }
    sink.checking();
    let Some(hold) = shared.hold_loop() else {
        crash::log("supervise_retry_loop_running", json!({}));
        return;
    };
    crash::log("supervise_retry_spawn", json!({}));
    run_held(&shared, sink.as_ref());
    drop(hold);
}

/// The supervision loop (03 section 17): connect and serve; after an exit restart with back-off; a refusal ends it.
/// One loop at most runs per `Shared`; a second start returns at once.
pub fn run(shared: Arc<Shared>, sink: Arc<dyn Sink>) {
    let Some(_hold) = shared.hold_loop() else {
        crash::log("supervise_loop_running", json!({}));
        return;
    };
    run_held(&shared, sink.as_ref());
}

fn run_held(shared: &Shared, sink: &dyn Sink) {
    let mut policy = RestartPolicy::default();
    while !shared.stopping() {
        let Some(ran_for) = attempt(shared, sink) else {
            return;
        };
        match policy.crashed(Instant::now(), ran_for) {
            Next::Retry(pause) => {
                crash::log(
                    "supervise_restart",
                    json!({ "after_ms": pause.as_millis() }),
                );
                if signalled_within(&[shared.stop_event.raw()], pause) {
                    return;
                }
            }
            Next::GiveUp => {
                let log = shared.spec.log_path();
                crash::log("supervise_gave_up", json!({ "log": log }));
                if sink.gave_up(&log) == AfterStop::Quit {
                    return;
                }
                policy.reset();
            }
        }
    }
}
