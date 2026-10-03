//! Page and engine crash (03 section 17): the WebView2 `ProcessFailed` event, reached through `with_webview` (W0A
//! P3). A failed renderer is reloaded once; a second failure inside the stable period shows the bundled stopped
//! page. A browser-process failure cannot be recovered from inside the window, so it ends the app with a message.
//! GPU, utility and other helper processes are recovered by the engine itself and are only logged.

use crate::ShellError;
use serde_json::json;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PROCESS_FAILED_KIND, ICoreWebView2, ICoreWebView2ProcessFailedEventArgs2,
};
use webview2_com::ProcessFailedEventHandler;
use windows::core::{HSTRING, Interface, PWSTR};

/// A renderer that failed again after this long counts as a first failure (the reload worked).
pub const STABLE_AFTER: Duration = Duration::from_secs(60);
/// The bundled page of the stopped state (assets/stopped.html).
pub const STOPPED_PAGE: &str = "stopped.html";
/// Where the bundled pages live when the window has not loaded one yet (Tauri's Windows asset origin).
const FALLBACK_ORIGIN: &str = "http://tauri.localhost/";

/// COREWEBVIEW2_PROCESS_FAILED_KIND values the shell tells apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailedKind {
    BrowserExited,
    RenderExited,
    RenderUnresponsive,
    FrameRenderExited,
    Other(i32),
}

impl FailedKind {
    pub const fn from_raw(raw: i32) -> Self {
        match raw {
            0 => Self::BrowserExited,
            1 => Self::RenderExited,
            2 => Self::RenderUnresponsive,
            3 => Self::FrameRenderExited,
            other => Self::Other(other),
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::BrowserExited => "browser process exited",
            Self::RenderExited => "render process exited",
            Self::RenderUnresponsive => "render process unresponsive",
            Self::FrameRenderExited => "frame render process exited",
            Self::Other(_) => "helper process exited",
        }
    }
}

/// What the shell does about one failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recovery {
    Reload,
    ShowStopped,
    EngineGone,
    Ignore,
}

/// The reload-once rule.
#[derive(Debug, Default)]
pub struct RecoveryPolicy {
    last_reload: Option<Instant>,
}

impl RecoveryPolicy {
    pub fn on_failure(&mut self, kind: FailedKind, now: Instant) -> Recovery {
        match kind {
            FailedKind::BrowserExited => Recovery::EngineGone,
            FailedKind::RenderExited | FailedKind::RenderUnresponsive => {
                let recent = self
                    .last_reload
                    .is_some_and(|at| now.saturating_duration_since(at) < STABLE_AFTER);
                if recent {
                    Recovery::ShowStopped
                } else {
                    self.last_reload = Some(now);
                    Recovery::Reload
                }
            }
            FailedKind::FrameRenderExited | FailedKind::Other(_) => Recovery::Ignore,
        }
    }
}

/// The section of the stopped page that explains a page-engine failure (the default section blames the backend).
pub const RENDERER_SECTION: &str = "renderer";

/// The URL of the stopped page's renderer section: next to the page the window showed at start (the splash), so it
/// follows Tauri's own asset origin.
pub fn renderer_stopped_url(current: Option<tauri::Url>) -> String {
    let page = format!("{STOPPED_PAGE}#{RENDERER_SECTION}");
    current
        .filter(|u| u.host_str().is_some_and(|h| h.ends_with("tauri.localhost")))
        .and_then(|u| u.join(&page).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| format!("{FALLBACK_ORIGIN}{page}"))
}

/// The stopped page URL for this window.
pub fn stopped_url(window: &WebviewWindow) -> String {
    renderer_stopped_url(window.url().ok())
}

/// Registers the handler on the window's WebView2 (on the UI thread, through `with_webview`).
pub fn register(window: &WebviewWindow) -> Result<(), ShellError> {
    let stopped = stopped_url(window);
    let app = window.app_handle().clone();
    window.with_webview(move |webview| {
        let controller = webview.controller();
        // SAFETY: COM calls on the controller Tauri hands to this closure on the UI thread, while it is alive.
        let added = unsafe { controller.CoreWebView2() }
            .and_then(|core| unsafe { add_handler(&core, stopped, app) });
        match added {
            Ok(()) => super::log("process_failed_watch", json!({})),
            Err(e) => super::log(
                "process_failed_watch_failed",
                json!({ "error": e.to_string() }),
            ),
        }
    })?;
    Ok(())
}

/// The reason, exit code and description of a failure, when the engine knows them (WebView2 1.0.1072 and later).
unsafe fn detail_of(args: &ICoreWebView2ProcessFailedEventArgs2) -> serde_json::Value {
    let (mut reason, mut code, mut description) = (Default::default(), 0i32, PWSTR::null());
    // SAFETY: out-parameters of a live event-args object; each call fills its own variable.
    let _ = unsafe { args.Reason(&mut reason) };
    let _ = unsafe { args.ExitCode(&mut code) };
    let _ = unsafe { args.ProcessDescription(&mut description) };
    json!({
        "reason": reason.0,
        "exit_code": code,
        "description": webview2_com::take_pwstr(description),
    })
}

unsafe fn add_handler(
    core: &ICoreWebView2,
    stopped: String,
    app: AppHandle,
) -> windows::core::Result<()> {
    let mut policy = RecoveryPolicy::default();
    let mut token = 0i64;
    let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
        let Some(args) = args else { return Ok(()) };
        let mut raw = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
        // SAFETY: an out-parameter of the live event args.
        unsafe { args.ProcessFailedKind(&mut raw) }?;
        let kind = FailedKind::from_raw(raw.0);
        let action = policy.on_failure(kind, Instant::now());
        let detail = args
            .cast::<ICoreWebView2ProcessFailedEventArgs2>()
            .ok()
            .map(|more| unsafe { detail_of(&more) });
        super::log(
            "process_failed",
            json!({
                "kind": raw.0,
                "kind_name": kind.name(),
                "action": format!("{action:?}"),
                "detail": detail,
            }),
        );
        act(action, sender.as_ref(), &stopped, &app);
        Ok(())
    }));
    // SAFETY: the handler is a COM object created above; the engine owns a reference after this call.
    unsafe { core.add_ProcessFailed(&handler, &mut token) }
}

/// Carries out one recovery step; a failing step is logged, never raised into the engine's callback.
fn act(action: Recovery, sender: Option<&ICoreWebView2>, stopped: &str, app: &AppHandle) {
    match (action, sender) {
        (Recovery::Reload, Some(core)) => {
            // SAFETY: a COM call on the engine's own webview from its UI-thread callback.
            if let Err(e) = unsafe { core.Reload() } {
                super::log("reload_failed", json!({ "error": e.to_string() }));
            } else {
                super::log("reload", json!({}));
            }
        }
        (Recovery::ShowStopped, Some(core)) => {
            // SAFETY: as above.
            match unsafe { core.Navigate(&HSTRING::from(stopped)) } {
                Ok(()) => super::log("stopped_page", json!({ "url": stopped })),
                Err(e) => super::log("stopped_page_failed", json!({ "error": e.to_string() })),
            }
        }
        (Recovery::EngineGone, _) => {
            super::log("engine_gone", json!({}));
            crate::dialogs::fatal(
                "The page engine stopped, so the app has to close. Start it again.",
            );
            app.exit(1);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_renderer_failure_reloads_and_the_second_shows_the_stopped_page() {
        let mut policy = RecoveryPolicy::default();
        let start = Instant::now();
        assert_eq!(
            policy.on_failure(FailedKind::RenderExited, start),
            Recovery::Reload
        );
        assert_eq!(
            policy.on_failure(FailedKind::RenderExited, start + Duration::from_secs(2)),
            Recovery::ShowStopped
        );
        assert_eq!(
            policy.on_failure(
                FailedKind::RenderUnresponsive,
                start + Duration::from_secs(30)
            ),
            Recovery::ShowStopped
        );
    }

    #[test]
    fn a_failure_after_a_stable_minute_counts_as_a_first_one() {
        let mut policy = RecoveryPolicy::default();
        let start = Instant::now();
        assert_eq!(
            policy.on_failure(FailedKind::RenderExited, start),
            Recovery::Reload
        );
        let later = start + STABLE_AFTER + Duration::from_secs(1);
        assert_eq!(
            policy.on_failure(FailedKind::RenderExited, later),
            Recovery::Reload
        );
    }

    #[test]
    fn the_renderer_stopped_url_names_the_renderer_section() {
        let base = tauri::Url::parse("http://tauri.localhost/index.html").unwrap();
        assert_eq!(
            renderer_stopped_url(Some(base)),
            "http://tauri.localhost/stopped.html#renderer"
        );
        assert_eq!(
            renderer_stopped_url(None),
            "http://tauri.localhost/stopped.html#renderer"
        );
        let foreign = tauri::Url::parse("http://127.0.0.1:9/x").unwrap();
        assert_eq!(
            renderer_stopped_url(Some(foreign)),
            "http://tauri.localhost/stopped.html#renderer"
        );
    }

    #[test]
    fn engine_and_helper_failures_are_told_apart() {
        let mut policy = RecoveryPolicy::default();
        let now = Instant::now();
        assert_eq!(
            policy.on_failure(FailedKind::BrowserExited, now),
            Recovery::EngineGone
        );
        assert_eq!(
            policy.on_failure(FailedKind::Other(6), now),
            Recovery::Ignore
        );
        assert_eq!(
            policy.on_failure(FailedKind::FrameRenderExited, now),
            Recovery::Ignore
        );
        assert_eq!(FailedKind::from_raw(0), FailedKind::BrowserExited);
        assert_eq!(FailedKind::from_raw(1), FailedKind::RenderExited);
        assert_eq!(FailedKind::from_raw(2), FailedKind::RenderUnresponsive);
        assert_eq!(FailedKind::from_raw(6), FailedKind::Other(6));
    }
}
