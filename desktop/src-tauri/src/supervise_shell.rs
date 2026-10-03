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
use super::run::{self, AfterStop, Backend, Shared, Sink, Verdict};
use crate::link;
use crate::{Launch, ShellError, crash};
use serde_json::json;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, WebviewWindow};
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

impl<R: Runtime> WindowSink<R> {
    /// Sets the stopped page's status paragraph in place (no navigation, so the focus stays on the Retry link).
    fn status(&self, text: &str) {
        if let Err(e) = self.window.eval(retry::status_script(text)) {
            crash::log("supervise_status_failed", json!({ "error": e.to_string() }));
        }
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
        let page = self.pages.join(&format!("{STOPPED_PAGE}#{code}"));
        // A second reason is a fragment-only navigation: no load, no focus move, no new title. Announce it to screen
        // readers the way the rebuild page does (WCAG 4.1.3).
        let shown = navigate(&self.window, page.map_err(|e| e.to_string())).and_then(|()| {
            let script = announce::announce_script(code);
            self.window.eval(script).map_err(|e| e.to_string())
        });
        if let Err(e) = shown {
            crash::log("supervise_stopped_page_failed", json!({ "error": e }));
        }
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

/// Every top-level navigation passes `navigation_verdict` (NavigationStarting, which WebView2 raises for the main
/// frame only); a refused one is cancelled and the stopped page shown from another thread, and one whose proof was
/// only late is cancelled and retried from another thread (the UI thread waits at most the 500 ms budget).
fn install_navigation_check<R: Runtime>(
    window: &WebviewWindow<R>,
    shared: Arc<Shared>,
    sink: Arc<dyn Sink>,
) -> Result<(), ShellError> {
    use webview2_com::{NavigationStartingEventHandler, take_pwstr};
    crate::guard::guarded("navigation", |report| {
        window.with_webview(move |platform| {
            let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
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
                        let sink = sink.clone();
                        std::thread::spawn(move || sink.stopped("exited"));
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
fn plan<R: Runtime>(window: &WebviewWindow<R>, launch: &Launch) -> Option<Spec> {
    let _ = window;
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
fn plan<R: Runtime>(window: &WebviewWindow<R>, launch: &Launch) -> Option<Spec> {
    let _ = launch;
    let options = window
        .app_handle()
        .try_state::<crate::window::WindowOptions>()?;
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

/// The supervisor's handle, kept as app state for the life of the window.
pub struct Supervisor {
    page_server: Option<String>,
    shared: Option<Arc<Shared>>,
}

impl Supervisor {
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

    /// Window closing (03 section 2.3): with a running backtest in a spawned backend, ask first (O11; a test build
    /// answers Cancel, so the window stays); then close its stdin, give it STOP_GRACE_S to stop, and end the job.
    /// Attach mode only stops the loop: the backend stays up for whoever owns it.
    pub fn shutdown<R: Runtime>(
        &self,
        owner: crate::dialogs::Owner<'_, R>,
    ) -> Result<(), ShellError> {
        let Some(shared) = &self.shared else {
            return Ok(());
        };
        let current = shared.current();
        if let Some(Backend::Spawned(s)) = current.as_deref() {
            let owner_ok = |pid| s.job_pids().contains(&pid);
            let running = link::running_jobs(s.port(), s.session(), &owner_ok, run::LINK_TIMEOUT);
            if let Err(e) = &running {
                crash::log(
                    "supervise_close_count_unread",
                    json!({ "error": e.to_string() }),
                );
            }
            let cancel = crate::dialogs::Confirm::Cancel;
            if link::close_needs_confirm(&running)
                && crate::dialogs::confirm_close_running_job(owner) == cancel
            {
                let kept = "a backtest is running and the close was cancelled";
                return Err(ShellError::Refused(kept.into()));
            }
        }
        shared.stop();
        if let Some(Backend::Spawned(s)) = current.as_deref() {
            s.close_stdin();
            let stopped = s.wait_exit(Duration::from_secs(STOP_GRACE_S));
            crash::log("supervise_shutdown", json!({ "stopped_in_grace": stopped }));
            s.end();
        }
        Ok(())
    }
}

/// The smoke `--attach-url`: a page server with no backend and no handshake (03 section 7.1).
#[cfg(feature = "smoke")]
fn page_server<R: Runtime>(
    window: &WebviewWindow<R>,
    launch: &Launch,
) -> Result<Option<Supervisor>, ShellError> {
    let Some(url) = &launch.smoke.attach_url else {
        return Ok(None);
    };
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| ShellError::Refused(format!("--attach-url: {e}")))?;
    window.navigate(parsed)?;
    crash::log("supervise_attach_url", json!({ "url": url }));
    Ok(Some(Supervisor {
        page_server: Some(url.clone()),
        shared: None,
    }))
}

#[cfg(not(feature = "smoke"))]
fn page_server<R: Runtime>(
    window: &WebviewWindow<R>,
    launch: &Launch,
) -> Result<Option<Supervisor>, ShellError> {
    let _ = (window, launch);
    Ok(None)
}

/// The hung-page watch's question (crash.rs): does the backend the window is on answer `/api/health` (checked as
/// every other request, through the ownership check)? False while there is no backend.
fn health_check(shared: Arc<Shared>) -> impl Fn() -> bool + Send + Sync + 'static {
    move || {
        let Some(backend) = shared.current() else {
            return false;
        };
        let owner_ok = |pid| backend.owner_ok(pid);
        let answer = link::with_session(
            backend.port(),
            "/api/health",
            backend.session(),
            &owner_ok,
            run::LINK_TIMEOUT,
        );
        answer.is_ok_and(|r| r.status < 500)
    }
}

/// Starts or attaches to the backend and sends the window to its page. The attach, the spawn, the handshake and
/// every restart run on the loop thread, so the splash paints while the backend starts. A lab without the venv
/// interpreter is refused here, before any thread (tests/setup_refused.rs).
pub fn start<R: Runtime>(
    window: &WebviewWindow<R>,
    launch: &Launch,
    stale: Option<StaleHook>,
) -> Result<Supervisor, ShellError> {
    if let Some(supervisor) = page_server(window, launch)? {
        return Ok(supervisor);
    }
    let Some(spec) = plan(window, launch) else {
        crash::log(
            "supervise_idle",
            json!({ "note": "no lab is set; the splash stays" }),
        );
        return Ok(Supervisor {
            page_server: None,
            shared: None,
        });
    };
    if !spec.python().is_file() {
        let missing = format!("{} has no .venv\\Scripts\\python.exe", spec.lab.display());
        return Err(ShellError::Refused(missing));
    }
    let contract = check::contract_range(window.config().plugins.0.get(CONFIG_KEY));
    let shared = Shared::new(spec.clone(), Expect::for_lab(&spec.lab, contract))?;
    let pages = retry::pages_base(window.url().ok()).map_err(ShellError::Tauri)?;
    let sink: Arc<dyn Sink> = Arc::new(WindowSink {
        window: window.clone(),
        pages,
        stale,
    });
    install_navigation_check(window, shared.clone(), sink.clone())?;
    crash::set_health_check(health_check(shared.clone()));
    let loop_shared = shared.clone();
    std::thread::Builder::new()
        .name("nqt-supervise".into())
        .spawn(move || run::run(loop_shared, sink))
        .map_err(|e| ShellError::Io(e.to_string()))?;
    Ok(Supervisor {
        page_server: None,
        shared: Some(shared),
    })
}
