//! The window side of supervision (03 sections 2.2, 2.3 and 7.1; 04 D4.3): which lab and spec a build starts, the
//! session cookie set into the webview, the navigations, the stopped page, the navigation check on every top-level
//! navigation, and the close.

use super::STOP_GRACE_S;
#[allow(
    clippy::duplicate_mod,
    reason = "the pure announce script is shared with the rebuild window and with the hidden-window tests by path"
)]
#[path = "window_rebuild_announce.rs"]
mod announce;
use super::check::{self, CONFIG_KEY, Expect, Spec};
use super::retry;
use super::run::{self, AfterStop, Backend, IbGate, Shared, Sink, Verdict};
use crate::link;
use crate::{Launch, ShellError, crash};
use serde_json::json;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use windows::core::PWSTR;

/// The shell page every refusal and every exit shows; the fragment names the section that explains it.
pub const STOPPED_PAGE: &str = "stopped.html";

/// How this window reaches its page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Nothing started (no lab, a refusal, or a stop).
    Idle,
    /// A backend this shell spawned; it ends with the shell.
    Spawned { port: u16 },
    /// A live backend found through its lock; never stopped by this shell.
    Attached { port: u16 },
    /// Smoke only: a page server named by `--attach-url`, with no backend and no handshake.
    PageServer { url: String },
}

/// What the window does when the backend reports a stale or missing page build: rebuild it (after the owner's
/// click) and say whether the backend should start again. Built by main.rs, because the rebuild is the window's.
pub type StaleHook = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// The window side of the loop.
struct WindowSink<R: Runtime> {
    window: WebviewWindow<R>,
    pages: tauri::Url,
    stale: Option<StaleHook>,
}

fn navigate<R: Runtime>(
    window: &WebviewWindow<R>,
    page: Result<tauri::Url, String>,
) -> Result<(), String> {
    page.and_then(|url| window.navigate(url).map_err(|e| e.to_string()))
}

/// How many times, and how far apart, the exit code script is evaluated again after the first time.
const EXIT_NOTE_REPEATS: u32 = 12;
const EXIT_NOTE_PAUSE: Duration = Duration::from_millis(250);
/// The number of the latest "exited" report; a repeat loop of an older one stops.
static EXIT_NOTE_GENERATION: AtomicU64 = AtomicU64::new(0);
/// The number of the latest stopped page; the announcement repeats of an older one stop.
static ANNOUNCE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The number of a new "exited" report, which also ends every repeat loop of an older one.
fn next_exit_generation(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::SeqCst) + 1
}

/// Runs `eval` again `repeats` times, `pause` apart, while `counter` still holds `generation`; returns how many times
/// it ran. A newer exit bumps the counter, which ends this loop before its next eval, so an earlier exit's code can
/// never overwrite a later one.
fn repeat_exit_note(
    generation: u64,
    counter: &AtomicU64,
    repeats: u32,
    pause: Duration,
    mut eval: impl FnMut(),
) -> u32 {
    let mut ran = 0;
    for _ in 0..repeats {
        std::thread::sleep(pause);
        if counter.load(Ordering::SeqCst) != generation {
            return ran;
        }
        eval();
        ran += 1;
    }
    ran
}

/// The scripts evaluated after the navigation to the stopped page's `code` section, in order: the exit code line
/// first when there is one, so the reason line already holds this exit's code (or none) when the announcement focuses
/// it and a screen reader reads it out; an earlier exit's code, still in the line on a fragment-only navigation, is
/// never read (V032 review). Then the announcement.
fn stopped_evals(code: &str, exit_note: Option<&str>) -> Vec<String> {
    let mut evals: Vec<String> = exit_note.map(str::to_string).into_iter().collect();
    evals.push(announce::announce_script(code));
    evals
}

/// Evaluates `script` again off this thread while `counter` holds `generation`; a failed eval is logged as `failed`.
fn eval_again<R: Runtime>(
    window: &WebviewWindow<R>,
    counter: &'static AtomicU64,
    generation: u64,
    script: String,
    failed: &'static str,
) {
    let window = window.clone();
    std::thread::spawn(move || {
        let eval = || {
            if let Err(e) = window.eval(&script) {
                crash::log(failed, json!({ "error": e.to_string() }));
            }
        };
        repeat_exit_note(
            generation,
            counter,
            EXIT_NOTE_REPEATS,
            EXIT_NOTE_PAUSE,
            eval,
        );
    });
}

impl<R: Runtime> WindowSink<R> {
    /// Sets the stopped page's status paragraph in place (no navigation, so the focus stays on the Retry link).
    fn status(&self, text: &str) {
        if let Err(e) = self.window.eval(retry::status_script(text)) {
            crash::log("supervise_status_failed", json!({ "error": e.to_string() }));
        }
    }

    /// The first announcement can run in the outgoing document (the navigation from the app page is a full load) and
    /// die with it, taking its wait along. It is evaluated again a few times, off this thread, like the exit note;
    /// the again-script changes nothing on a page that already holds the announcement or whose focus moved on, and a
    /// newer stopped page ends the older repeats.
    fn announce_again(&self, code: &str) {
        let generation = next_exit_generation(&ANNOUNCE_GENERATION);
        let script = announce::announce_again_script(code);
        let log = "supervise_announce_failed";
        eval_again(&self.window, &ANNOUNCE_GENERATION, generation, script, log);
    }

    /// The stopped page's `code` section: the navigation, then `stopped_evals` (the exit code line, if any, then the
    /// announcement), then the announcement's repeats.
    fn show_stopped(&self, code: &str, exit_note: Option<&str>) {
        let page = self.pages.join(&format!("{STOPPED_PAGE}#{code}"));
        // A second reason is a fragment-only navigation: no load, no focus move, no new title. Announce it to screen
        // readers the way the rebuild page does (WCAG 4.1.3).
        let shown = navigate(&self.window, page.map_err(|e| e.to_string())).and_then(|()| {
            stopped_evals(code, exit_note)
                .into_iter()
                .try_for_each(|script| self.window.eval(script).map_err(|e| e.to_string()))
        });
        if let Err(e) = shown {
            crash::log("supervise_stopped_page_failed", json!({ "error": e }));
            return;
        }
        self.announce_again(code);
    }

    /// Whether the window already shows the stopped page's unverified section.
    fn shows_unverified(&self) -> bool {
        self.window
            .url()
            .is_ok_and(|u| u.path().ends_with(STOPPED_PAGE) && u.fragment() == Some("unverified"))
    }
}

impl<R: Runtime> Sink for WindowSink<R> {
    /// The cookie `nqt_s_<port>` (HttpOnly, SameSite=Strict, Path=/api) goes into the webview, then the page loads.
    fn ready(&self, port: u16, session: &str) {
        use tauri::webview::cookie::{Cookie, SameSite};
        let cookie = Cookie::build((link::cookie_name(port), session.to_string()))
            .domain("127.0.0.1")
            .path("/api")
            .http_only(true)
            .same_site(SameSite::Strict)
            .build();
        let page = format!("{}/", link::origin(port)).parse::<tauri::Url>();
        let done = self.window.set_cookie(cookie).map_err(|e| e.to_string());
        if let Err(e) = done.and_then(|()| navigate(&self.window, page.map_err(|e| e.to_string())))
        {
            crash::log("supervise_navigate_failed", json!({ "error": e }));
        }
    }

    fn stopped(&self, code: &str) {
        self.show_stopped(code, None);
    }

    /// The "exited" reason with the exit code in words on the page (nothing when the code is unknown; an earlier
    /// exit's code is cleared). The code line is written before the announcement (`stopped_evals`), so what a screen
    /// reader hears is this exit's line, never an earlier exit's code.
    ///
    /// The webview can still be on the outgoing page when the first eval runs (the navigation is a full load), and a
    /// script that ran there dies with that document. The same script is therefore evaluated again a few times, off
    /// this thread; it is idempotent and waits for the stopped page itself. A newer exit ends the older repeats, so an
    /// earlier code can never overwrite a later one.
    fn exited(&self, exit_code: Option<u32>) {
        let generation = next_exit_generation(&EXIT_NOTE_GENERATION);
        let script = check::exit_note_script(exit_code);
        self.show_stopped("exited", Some(&script));
        let log = "supervise_exit_note_failed";
        eval_again(&self.window, &EXIT_NOTE_GENERATION, generation, script, log);
    }

    /// Off the UI thread (the navigation handler spawned this call): the native question, then the settings write;
    /// for a backend this app attached to, only the native note that the switch does not apply.
    fn ib_switch(&self, on: bool, attached: bool) {
        let outcome = super::ib_switch::ask(&self.window, on, attached);
        crash::log(
            "ib_switch_done",
            json!({ "on": on, "outcome": format!("{outcome:?}") }),
        );
    }

    fn reload(&self, uri: &str) {
        if let Err(e) = navigate(
            &self.window,
            uri.parse::<tauri::Url>().map_err(|e| e.to_string()),
        ) {
            crash::log("supervise_reload_failed", json!({ "error": e }));
        }
    }

    fn checking(&self) {
        self.status(retry::CHECKING);
    }

    fn still_unverified(&self) {
        if self.shows_unverified() {
            self.status(retry::STILL_UNVERIFIED);
        } else {
            self.stopped("unverified");
        }
    }

    fn stale_dist(&self, state: &str) -> bool {
        if let Some(rebuild) = &self.stale {
            return rebuild(state);
        }
        self.stopped("dist");
        false
    }

    fn gave_up(&self, log: &Path) -> AfterStop {
        match crate::dialogs::restart_or_quit(Some(&self.window), log) {
            crate::dialogs::RestartOrQuit::Restart => AfterStop::Restart,
            crate::dialogs::RestartOrQuit::Quit => {
                self.window.app_handle().exit(0);
                AfterStop::Quit
            }
        }
    }
}

/// The address the webview shows, empty when it cannot be read.
fn page_source(webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2) -> String {
    let mut source = PWSTR::null();
    // SAFETY: a COM getter on the webview WebView2 hands the handler on the UI thread; the string is taken and freed.
    match unsafe { webview.Source(&mut source) } {
        Ok(()) => webview2_com::take_pwstr(source),
        Err(_) => String::new(),
    }
}

/// Every top-level navigation passes `navigation_verdict` (NavigationStarting, which WebView2 raises for the main
/// frame only); a refused one is cancelled and the stopped page shown from another thread, and one whose proof was
/// only late is cancelled and retried from another thread (the UI thread waits at most the 500 ms budget). An IB
/// switch address is cancelled too, and goes to the native question from another thread only when the page that
/// asked is the current backend's own page.
fn install_navigation_check<R: Runtime>(
    window: &WebviewWindow<R>,
    shared: Arc<Shared>,
    sink: Arc<dyn Sink>,
) -> Result<(), ShellError> {
    use webview2_com::{NavigationStartingEventHandler, take_pwstr};
    crate::guard::guarded("navigation", |report| {
        window.with_webview(move |platform| {
            let handler = NavigationStartingEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut uri = PWSTR::null();
                // SAFETY: a COM call on the event arguments WebView2 hands this handler on the UI thread.
                unsafe { args.Uri(&mut uri)? };
                let verdict = shared.navigation_verdict(&take_pwstr(uri));
                if verdict != Verdict::Allow {
                    // SAFETY: as above.
                    unsafe { args.SetCancel(true)? };
                    crash::log(
                        "navigation_refused",
                        json!({ "verdict": format!("{verdict:?}") }),
                    );
                }
                match verdict {
                    Verdict::Refuse(m) => {
                        let sink = sink.clone();
                        std::thread::spawn(move || sink.stopped(m.code()));
                    }
                    Verdict::Retry(uri) => {
                        let (shared, sink) = (shared.clone(), sink.clone());
                        std::thread::spawn(move || shared.retry_navigation(sink.as_ref(), &uri));
                    }
                    Verdict::Gone => {
                        // No backend is left (a refusal ended the loop): Retry starts the supervised loop again.
                        let (shared, sink) = (shared.clone(), sink.clone());
                        let spawned = std::thread::Builder::new()
                            .name("nqt-supervise".into())
                            .spawn(move || run::retry_without_backend(shared, sink));
                        if let Err(e) = spawned {
                            crash::log("supervise_retry_failed", json!({ "error": e.to_string() }));
                        }
                    }
                    Verdict::IbSwitch(on) => {
                        // The page that asked is the webview's address now (NavigationStarting comes before the
                        // address changes): only the current backend's own page reaches the dialog.
                        let source = sender.as_ref().map(page_source).unwrap_or_default();
                        let gate = shared.ib_switch_gate(&source);
                        if gate != IbGate::Refused {
                            // Logged, never relied on: whether a button's location.assign counts as user initiated.
                            let mut user = windows::core::BOOL(0);
                            // SAFETY: as above.
                            let read = unsafe { args.IsUserInitiated(&mut user) }.is_ok();
                            let initiated = read.then_some(user.as_bool());
                            let attached = gate == IbGate::Attached;
                            crash::log(
                                "ib_switch_request",
                                json!({ "on": on, "user_initiated": initiated, "attached": attached }),
                            );
                            let sink = sink.clone();
                            std::thread::spawn(move || sink.ib_switch(on, attached));
                        } else {
                            crash::log(
                                "ib_switch_refused",
                                json!({ "on": on, "reason": "origin" }),
                            );
                        }
                    }
                    Verdict::Allow | Verdict::Cancel => {}
                }
                Ok(())
            }));
            let mut token = 0i64;
            // SAFETY: COM calls on the controller Tauri hands this closure on the UI thread, while it is alive.
            let added = unsafe {
                let webview = platform.controller().CoreWebView2();
                webview.and_then(|w| w.add_NavigationStarting(&handler, &mut token))
            };
            if let Err(e) = &added {
                crash::log("navigation_check_failed", json!({ "error": e.to_string() }));
            }
            let _ = report.send(added.map_err(|e| e.to_string()));
        })?;
        Ok(())
    })
}

/// The smoke spec: the `--lab`, the `--state-dir` (or, when it is absent, a temporary folder under the config
/// folder, fixture or not), NQT_STATE_DIR and NQT_JOBS=off always, and the fixture module with NQT_FIXTURE_DIR.
/// A smoke backend never uses the lab's own state folder and never runs jobs (03 section 8).
#[cfg(feature = "smoke")]
fn plan<R: Runtime>(app: &AppHandle<R>, launch: &Launch) -> Option<Spec> {
    let _ = app;
    let s = &launch.smoke;
    let lab = s.lab.clone()?;
    let (dir, config, fixture) = (s.state_dir.clone(), &s.config_dir, s.fixture);
    Some(check::smoke_spec(
        lab,
        dir,
        config,
        fixture,
        std::process::id(),
    ))
}

/// The release and measure spec: the lab of the window options main.rs manages, `<lab>/terminal/state`, and the
/// fixed module; no test name reaches the environment. The IB names go along only when the owner ticked the
/// read-only snapshot in the settings.
#[cfg(not(feature = "smoke"))]
fn plan<R: Runtime>(app: &AppHandle<R>, launch: &Launch) -> Option<Spec> {
    let _ = launch;
    let options = app.try_state::<crate::window::WindowOptions>()?;
    let lab = options.lab.clone()?;
    let state_dir = lab.join("terminal").join("state");
    let extra_env = if options.ib_snapshot {
        check::ib_snapshot_env(std::env::vars_os())
    } else {
        Vec::new()
    };
    Some(Spec {
        lab,
        state_dir,
        module: check::BACKEND_MODULE,
        extra_env,
    })
}

/// What one call of `Supervisor::shutdown` does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShutdownGate {
    /// An earlier call went past the question and shut down: nothing is asked, logged or stopped again.
    Done,
    /// The owner kept the window (a running backtest, Cancel): the guard stays open and the next close asks again.
    Kept,
    /// This call shuts down; the guard is now closed.
    Go,
}

/// The once guard (V033B review): main.rs shuts down from the close and again on RunEvent::Exit, when the backend can
/// be gone but still current, its job count unreadable and so read as running. `may_close` (the count and the
/// question) runs only while no call has gone past it, and only a call that gets past it closes the guard.
fn shutdown_gate(done: &AtomicBool, may_close: impl FnOnce() -> bool) -> ShutdownGate {
    if done.load(Ordering::SeqCst) {
        return ShutdownGate::Done;
    }
    if !may_close() {
        return ShutdownGate::Kept;
    }
    if done.swap(true, Ordering::SeqCst) {
        ShutdownGate::Done
    } else {
        ShutdownGate::Go
    }
}

/// What the shutdown found and ended, for its one `supervise_shutdown` record; a spawned backend says whether it
/// stopped within its grace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ended {
    Spawned(bool),
    Attached,
    Nothing,
}

fn shutdown_record(ended: Ended) -> serde_json::Value {
    match ended {
        Ended::Spawned(grace) => json!({ "mode": "spawned", "stopped_in_grace": grace }),
        Ended::Attached => json!({ "mode": "attached" }),
        Ended::Nothing => json!({ "mode": "none" }),
    }
}

/// With a running backtest in a spawned backend, or a count that cannot be read, the owner is asked (O11; a test
/// build answers Cancel); true lets the close go on. Any other backend, or none, goes on unasked.
fn may_close<R: Runtime>(current: Option<&Backend>, owner: crate::dialogs::Owner<'_, R>) -> bool {
    let Some(Backend::Spawned(s)) = current else {
        return true;
    };
    let owner_ok = |pid| s.job_pids().contains(&pid);
    let running = link::running_jobs(s.port(), s.session(), &owner_ok, run::LINK_TIMEOUT);
    if let Err(e) = &running {
        let error = e.to_string();
        crash::log("supervise_close_count_unread", json!({ "error": error }));
    }
    if !link::close_needs_confirm(&running) {
        return true;
    }
    // A close parked on the question (a minimised window may leave it unseen) shows in the log.
    crash::log(
        "close_confirm_asked",
        json!({ "count_read": running.is_ok() }),
    );
    let answer = crate::dialogs::confirm_close_running_job(owner);
    // The answer is logged after the dialog returns, so a log with an ask and no answer after it is a question still
    // open, whenever it was asked (close-app.ps1 never stops a shell in that state).
    crash::log("close_confirm_answered", answered_record(answer));
    answer != crate::dialogs::Confirm::Cancel
}

/// The fields of the `close_confirm_answered` record: the owner's choice at the backtest question.
fn answered_record(answer: crate::dialogs::Confirm) -> serde_json::Value {
    let choice = match answer {
        crate::dialogs::Confirm::Proceed => "close",
        crate::dialogs::Confirm::Cancel => "cancel",
    };
    json!({ "choice": choice })
}

/// Ends a spawned backend: its stdin closed, STOP_GRACE_S to stop, then its job. An attached one is left running.
fn end_backend(current: Option<&Backend>) -> Ended {
    match current {
        Some(Backend::Spawned(s)) => {
            s.close_stdin();
            let stopped_in_grace = s.wait_exit(Duration::from_secs(STOP_GRACE_S));
            s.end();
            Ended::Spawned(stopped_in_grace)
        }
        Some(Backend::Attached(_)) => Ended::Attached,
        None => Ended::Nothing,
    }
}

/// Why a close the owner cancelled keeps the window.
const CLOSE_KEPT: &str = "a backtest is running and the close was cancelled";

/// The supervisor's handle, kept as app state for the life of the window.
pub struct Supervisor {
    page_server: Option<String>,
    shared: Option<Arc<Shared>>,
    /// Set by the one shutdown that got past the question (`shutdown_gate`).
    done: AtomicBool,
}

impl Supervisor {
    const fn new(page_server: Option<String>, shared: Option<Arc<Shared>>) -> Self {
        Self {
            page_server,
            shared,
            done: AtomicBool::new(false),
        }
    }

    #[allow(
        dead_code,
        reason = "the mode is read by the tests and by the diagnostics once a menu item exists"
    )]
    pub fn mode(&self) -> Mode {
        if let Some(url) = &self.page_server {
            return Mode::PageServer { url: url.clone() };
        }
        match self.shared.as_ref().and_then(|s| s.current()).as_deref() {
            Some(Backend::Spawned(s)) => Mode::Spawned { port: s.port() },
            Some(Backend::Attached(a)) => Mode::Attached { port: a.port() },
            None => Mode::Idle,
        }
    }

    /// Window closing (03 section 2.3), once (`shutdown_gate`): `may_close` asks about a running backtest (Err keeps
    /// the window and the next close asks again); then the loop stops, a spawned backend ends (`end_backend`), an
    /// attached one stays up for whoever owns it, and one `supervise_shutdown` record names the mode. A later call
    /// (RunEvent::Exit after the close) returns Ok at once, unasked and unlogged.
    pub fn shutdown<R: Runtime>(
        &self,
        owner: crate::dialogs::Owner<'_, R>,
    ) -> Result<(), ShellError> {
        self.run_shutdown(
            ShutdownKind::Close,
            |current| may_close(current, owner),
            end_backend,
        )
    }

    /// The shell is exiting (RunEvent::Exit) and the process goes on regardless, so there is nothing to keep and
    /// nothing to ask (an exit with no close before it, from a lost engine or a failed bridge, must not put the
    /// backtest question to an owner who may have no window left). A close that already shut down returns Ok at once;
    /// otherwise the backend ends the same way and the one `supervise_shutdown` record is written.
    pub fn shutdown_on_exit(&self) -> Result<(), ShellError> {
        self.run_shutdown(ShutdownKind::Exit, |_| true, end_backend)
    }

    /// The one shutdown: the gate, then the stop, the end and the record. `ask` is called only for a `Close`.
    fn run_shutdown(
        &self,
        kind: ShutdownKind,
        ask: impl FnOnce(Option<&Backend>) -> bool,
        end: impl FnOnce(Option<&Backend>) -> Ended,
    ) -> Result<(), ShellError> {
        let current = self.shared.as_ref().and_then(|s| s.current());
        let may_go = || match kind {
            ShutdownKind::Close => ask(current.as_deref()),
            ShutdownKind::Exit => true,
        };
        match shutdown_gate(&self.done, may_go) {
            ShutdownGate::Done => Ok(()),
            ShutdownGate::Kept => Err(ShellError::Refused(CLOSE_KEPT.into())),
            ShutdownGate::Go => {
                if let Some(shared) = &self.shared {
                    shared.stop();
                }
                let ended = end(current.as_deref());
                crash::log("supervise_shutdown", shutdown_record(ended));
                Ok(())
            }
        }
    }
}

/// Whether a shutdown may put the backtest question: a close does, the exit of the process does not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShutdownKind {
    Close,
    Exit,
}

/// The smoke `--attach-url`: a page server with no backend and no handshake (03 section 7.1).
#[cfg(feature = "smoke")]
fn page_server(launch: &Launch) -> Option<String> {
    launch.smoke.attach_url.clone()
}

#[cfg(not(feature = "smoke"))]
fn page_server(launch: &Launch) -> Option<String> {
    let _ = launch;
    None
}

/// Loads the page server's address once the window exists.
fn show_page_server<R: Runtime>(
    window: &WebviewWindow<R>,
    url: String,
) -> Result<Supervisor, ShellError> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| ShellError::Refused(format!("page server address: {e}")))?;
    window.navigate(parsed)?;
    crash::log("supervise_attach_url", json!({ "url": url }));
    Ok(Supervisor::new(Some(url), None))
}

/// Where the loop's calls wait until the window exists (startup.md 7.2): READY, a refusal or an exit made earlier goes
/// on to the window's sink once `give` hands it over, in the order the loop thread made them. A start that never gets
/// its window (`abandon`) answers fail closed: nothing shown, no rebuild, Quit. The first `give` or `abandon` counts.
#[derive(Default)]
pub struct Handoff {
    held: Mutex<Held>,
    settled: Condvar,
}

#[derive(Default)]
enum Held {
    #[default]
    Waiting,
    Given(Arc<dyn Sink>),
    Abandoned,
}

impl Handoff {
    pub fn give(&self, sink: Arc<dyn Sink>) {
        self.settle(Held::Given(sink));
    }

    pub fn abandon(&self) {
        self.settle(Held::Abandoned);
    }

    fn settle(&self, to: Held) {
        if let Ok(mut held) = self.held.lock()
            && matches!(*held, Held::Waiting)
        {
            *held = to;
        }
        self.settled.notify_all();
    }

    /// The window's sink, waited for until it is given; None once abandoned.
    fn sink(&self) -> Option<Arc<dyn Sink>> {
        let held = self.held.lock().ok()?;
        let waiting = |h: &mut Held| matches!(h, Held::Waiting);
        match &*self.settled.wait_while(held, waiting).ok()? {
            Held::Given(sink) => Some(sink.clone()),
            _ => None,
        }
    }

    fn with(&self, call: impl FnOnce(&dyn Sink)) {
        if let Some(sink) = self.sink() {
            call(sink.as_ref());
        }
    }
}

impl Sink for Handoff {
    fn ready(&self, port: u16, session: &str) {
        self.with(|s| s.ready(port, session));
    }
    fn stopped(&self, code: &str) {
        self.with(|s| s.stopped(code));
    }
    fn exited(&self, exit_code: Option<u32>) {
        self.with(|s| s.exited(exit_code));
    }
    fn gave_up(&self, log: &Path) -> AfterStop {
        self.sink().map_or(AfterStop::Quit, |s| s.gave_up(log))
    }
    fn stale_dist(&self, state: &str) -> bool {
        self.sink().is_some_and(|s| s.stale_dist(state))
    }
    fn reload(&self, uri: &str) {
        self.with(|s| s.reload(uri));
    }
    fn checking(&self) {
        self.with(|s| s.checking());
    }
    fn still_unverified(&self) {
        self.with(|s| s.still_unverified());
    }
    fn ib_switch(&self, on: bool, attached: bool) {
        self.with(|s| s.ib_switch(on, attached));
    }
}

/// The loop on its own thread, its calls held in a handoff; its first line places the time before `supervise_spawned`.
pub fn start_loop(shared: Arc<Shared>) -> Result<Arc<Handoff>, ShellError> {
    let handoff = Arc::new(Handoff::default());
    let sink: Arc<dyn Sink> = handoff.clone();
    let body = move || {
        crash::log("supervise_thread_began", json!({}));
        run::run(shared, sink);
    };
    let thread = std::thread::Builder::new().name("nqt-supervise".into());
    thread
        .spawn(body)
        .map_err(|e| ShellError::Io(e.to_string()))?;
    Ok(handoff)
}

/// The supervisor before its window exists: None when idle (no lab, or a lab the lab check refused in main.rs).
#[derive(Default)]
pub struct Early(Option<Started>);

enum Started {
    /// Smoke only: a page server, loaded once the window exists.
    PageServer(String),
    /// The loop runs; its calls wait in the handoff.
    Running(Arc<Shared>, Arc<Handoff>),
}

/// Starts the supervisor before the window is built (startup.md 7.2; 03 section 2.2 step 4): the attach or spawn, the
/// handshake and the restarts run on the loop thread while WebView2 is built, from the settings alone (window options
/// or smoke switches). A lab without the venv interpreter is refused here, before any thread.
pub fn begin<R: Runtime>(app: &AppHandle<R>, launch: &Launch) -> Result<Early, ShellError> {
    if let Some(url) = page_server(launch) {
        return Ok(Early(Some(Started::PageServer(url))));
    }
    let Some(spec) = plan(app, launch) else {
        let note = json!({ "note": "no lab is set; the splash stays" });
        crash::log("supervise_idle", note);
        return Ok(Early::default());
    };
    if !spec.python().is_file() {
        let missing = format!(r"{} has no .venv\Scripts\python.exe", spec.lab.display());
        return Err(ShellError::Refused(missing));
    }
    let contract = check::contract_range(app.config().plugins.0.get(CONFIG_KEY));
    let shared = Shared::new(spec.clone(), Expect::for_lab(&spec.lab, contract))?;
    let handoff = start_loop(shared.clone())?;
    Ok(Early::running(shared, handoff))
}

impl Early {
    /// An early start holding a running loop and its handoff.
    pub fn running(shared: Arc<Shared>, handoff: Arc<Handoff>) -> Self {
        Self(Some(Started::Running(shared, handoff)))
    }

    /// The window exists: the navigation check goes in, then the loop's held calls (READY, or a refusal made meanwhile)
    /// go on to the window's sink. A step that fails drops `self` still holding the loop, which stops it (Drop).
    pub fn attach<R: Runtime>(
        mut self,
        window: &WebviewWindow<R>,
        stale: Option<StaleHook>,
    ) -> Result<Supervisor, ShellError> {
        let (shared, handoff) = match &self.0 {
            None => return Ok(Supervisor::new(None, None)),
            Some(Started::PageServer(url)) => return show_page_server(window, url.clone()),
            Some(Started::Running(shared, handoff)) => (shared.clone(), handoff.clone()),
        };
        let pages = retry::pages_base(window.url().ok()).map_err(ShellError::Tauri)?;
        let sink: Arc<dyn Sink> = Arc::new(WindowSink {
            window: window.clone(),
            pages,
            stale,
        });
        install_navigation_check(window, shared.clone(), sink.clone())?;
        crash::set_health_check(run::health_check(shared.clone()));
        handoff.give(sink);
        self.0 = None;
        Ok(Supervisor::new(None, Some(shared)))
    }
}

/// A start that never reached its window: the loop stops and its calls are answered fail closed.
impl Drop for Early {
    fn drop(&mut self) {
        if let Some(Started::Running(shared, handoff)) = &self.0 {
            shared.stop();
            handoff.abandon();
        }
    }
}

#[cfg(test)]
#[path = "supervise_shell_exit_note_tests.rs"]
mod exit_note_tests;

#[cfg(test)]
#[path = "supervise_shell_shutdown_tests.rs"]
mod shutdown_tests;
