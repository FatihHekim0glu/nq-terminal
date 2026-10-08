//! The flush before the close (03 sections 2.3 and 10.3; integration INT1). The page keeps a change for 500 ms before
//! it sends it to the workspace store, and a window that closes at once would take that change with it, or stop the
//! backend while the page's last request is still on its way. So the close is held until the page says nothing is
//! pending, and only then does the supervisor close the backend's stdin.
//!
//! The page calls no shell command (capabilities/main.json grants nothing). The shell calls the page: it runs one
//! small script that calls `window.__NQT_STORE_SYNC__` (defined once, read only, by `web/src/state/remoteStore.ts`),
//! which sends what is pending at once and answers a JSON text `{"status": ..., "pending": n}`. The shell asks again,
//! a few times a second, until the page reports nothing pending, the store is off or unavailable (nothing more can
//! be done) or the budget is spent. Under a budget the close always goes on: a hung page cannot hold the app open.
//!
//! This runs on its own thread, never the UI thread: the script's answer comes back through the event loop.

use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

/// How long the close waits for the page in all.
pub const BUDGET: Duration = Duration::from_secs(4);
/// The pause between two questions.
const POLL: Duration = Duration::from_millis(150);
/// How many times in a row an `unavailable` store with changes pending is asked again before it is given up. The page
/// answers at once, before its last-moment start (which re-reads the store and sends) has finished, so the first
/// answers after a failed send say `unavailable` while the change is already on its way.
const UNAVAILABLE_ASKS: u32 = 3;
/// How long one answer may take; a page that does not answer within it counts as gone.
const ANSWER_WAIT: Duration = Duration::from_millis(1_500);

/// The script run in the page: the backend's own page only (a loopback origin), and only if the hook exists.
pub const ASK_JS: &str = "(() => { try { const f = window.__NQT_STORE_SYNC__; if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || typeof f !== 'function') return 'none'; return f() } catch (e) { return 'none' } })()";

/// What the page said about its store.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Answer {
    pub status: String,
    pub pending: u32,
}

/// How the wait ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// There was nothing to flush: no hook (a splash, the stopped page, a demo page), no store on the backend, or no
    /// change pending.
    Nothing,
    /// Changes were pending and the store took them.
    Flushed,
    /// The store could not take `pending` changes: they are lost with the page.
    Unavailable(u32),
    /// The budget ran out with `pending` changes still on their way.
    TimedOut(u32),
    /// The page did not answer.
    Silent,
}

impl Outcome {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Nothing => "nothing",
            Self::Flushed => "flushed",
            Self::Unavailable(_) => "unavailable",
            Self::TimedOut(_) => "timed_out",
            Self::Silent => "silent",
        }
    }

    pub const fn pending(self) -> u32 {
        match self {
            Self::Unavailable(n) | Self::TimedOut(n) => n,
            _ => 0,
        }
    }
}

/// What to do after one answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Done(Outcome),
    Ask,
}

/// Reads the callback's text: the JSON of the script's value, which is a string holding another JSON text, or the
/// word `none`. Anything else is no answer.
pub fn parse_answer(raw: &str) -> Option<Answer> {
    let inner: String = serde_json::from_str(raw.trim()).ok()?;
    serde_json::from_str(&inner).ok()
}

/// The decision after an answer. `seen_pending` says whether an earlier answer had changes pending, so a store that
/// reports nothing pending after that is a flush that worked, not a page that had nothing to say. `unavailable_asks`
/// counts the earlier `unavailable` answers with changes pending: the store is tried again for a few questions (the
/// backend may be back, and the page's last-moment send is on its way) before the changes are given up.
pub fn judge(answer: Option<&Answer>, seen_pending: bool, unavailable_asks: u32) -> Step {
    let Some(answer) = answer else {
        return Step::Done(if seen_pending {
            Outcome::Flushed
        } else {
            Outcome::Nothing
        });
    };
    match (answer.status.as_str(), answer.pending) {
        ("ready", 0) => Step::Done(if seen_pending {
            Outcome::Flushed
        } else {
            Outcome::Nothing
        }),
        ("ready", _) => Step::Ask,
        (_, 0) => Step::Done(Outcome::Nothing),
        ("unavailable", _) if unavailable_asks < UNAVAILABLE_ASKS => Step::Ask,
        ("unavailable", n) => Step::Done(Outcome::Unavailable(n)),
        // Before its first read has ended the page starts the store on this very question: ask again.
        ("idle", _) => Step::Ask,
        _ => Step::Done(Outcome::Nothing),
    }
}

/// Asks the page once. `None` when the script could not be sent or the page did not answer in time; the inner option
/// is the parsed answer (`None` for the word `none`).
fn ask(window: &WebviewWindow) -> Option<Option<Answer>> {
    let (tx, rx) = mpsc::channel();
    window
        .eval_with_callback(ASK_JS, move |raw| {
            let _ = tx.send(raw);
        })
        .ok()?;
    rx.recv_timeout(ANSWER_WAIT)
        .ok()
        .map(|raw| parse_answer(&raw))
}

/// Runs the wait on the calling thread (never the UI thread) for at most `budget`.
pub fn run(window: &WebviewWindow, budget: Duration) -> Outcome {
    let (started, mut seen_pending, mut unavailable_asks) = (Instant::now(), false, 0);
    loop {
        let Some(answer) = ask(window) else {
            return Outcome::Silent;
        };
        match judge(answer.as_ref(), seen_pending, unavailable_asks) {
            Step::Done(outcome) => return outcome,
            Step::Ask => seen_pending = true,
        }
        if answer.as_ref().is_some_and(|a| a.status == "unavailable") {
            unavailable_asks += 1;
        }
        if started.elapsed() >= budget {
            let pending = answer.map_or(0, |a| a.pending);
            return Outcome::TimedOut(pending);
        }
        std::thread::sleep(POLL);
    }
}

/// Set while a flush runs, so a second close request during it does not start another.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Set when a flush has finished and the close it held may go on (the next close request passes straight through).
static DONE: AtomicBool = AtomicBool::new(false);

/// What a close request does about the flush.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnClose {
    /// Hold the close: a flush has been started and will close the window again when it is done.
    Hold,
    /// A flush is already running: keep holding.
    StillHolding,
    /// The flush has been done: go on to stop the backend.
    Proceed,
}

/// The gate a close request goes through. The first request starts the flush on its own thread and is held; the
/// flush ends by closing the window again, and that second request proceeds. Cancelling the close later (the
/// running-backtest question) rearms the gate through `rearm`, so the next close flushes again.
pub fn on_close(window: &WebviewWindow) -> OnClose {
    if DONE.load(Ordering::SeqCst) {
        return OnClose::Proceed;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return OnClose::StillHolding;
    }
    // Read on the UI thread, before the flush thread starts: the handle the fallback posts to.
    let hwnd = window.hwnd().ok().map(|h| h.0 as isize);
    let window = window.clone();
    let spawned = std::thread::Builder::new()
        .name("nqt-flush".into())
        .spawn(move || {
            let started = Instant::now();
            let outcome = run(&window, BUDGET);
            crate::crash::log(
                "store_flush",
                json!({
                    "outcome": outcome.name(),
                    "pending": outcome.pending(),
                    "ms": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                }),
            );
            DONE.store(true, Ordering::SeqCst);
            RUNNING.store(false, Ordering::SeqCst);
            let close = || window.close().map_err(|e| e.to_string());
            let (route, error) = reclose(close, || hwnd.is_some_and(post_close));
            if let Some(error) = error {
                crate::crash::log(
                    "store_flush_close_failed",
                    json!({ "error": error, "fallback": route.name() }),
                );
            }
        });
    if let Err(e) = spawned {
        crate::crash::log("store_flush_failed", json!({ "error": e.to_string() }));
        RUNNING.store(false, Ordering::SeqCst);
        return OnClose::Proceed;
    }
    OnClose::Hold
}

/// The close went on (or was cancelled): the next close request flushes again.
pub fn rearm() {
    DONE.store(false, Ordering::SeqCst);
}

/// How the held close went on after the flush.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reclose {
    /// The window was closed again through the event loop.
    Closed,
    /// The event loop's route failed, and WM_CLOSE was posted to the window itself.
    Posted,
    /// Neither worked: the close is lost, and only a new close request ends the app.
    Lost,
}

impl Reclose {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Posted => "posted",
            Self::Lost => "lost",
        }
    }
}

/// Closes the window again after the flush. The event loop's route can fail (for example once tao's event target
/// window is gone), and the close it held would then be swallowed, so the fallback posts WM_CLOSE to the window
/// itself; `DONE` is already set, so that request goes straight on. The error is the event loop's, when it failed.
pub fn reclose(
    close: impl FnOnce() -> Result<(), String>,
    post: impl FnOnce() -> bool,
) -> (Reclose, Option<String>) {
    match close() {
        Ok(()) => (Reclose::Closed, None),
        Err(error) if post() => (Reclose::Posted, Some(error)),
        Err(error) => (Reclose::Lost, Some(error)),
    }
}

/// Posts WM_CLOSE to the app window.
fn post_close(hwnd: isize) -> bool {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
    // SAFETY: posting a message to the app window's handle; a handle that is gone only makes the post fail.
    unsafe { PostMessageW(Some(HWND(hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) }.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(status: &str, pending: u32) -> Answer {
        Answer {
            status: status.into(),
            pending,
        }
    }

    #[test]
    fn the_callback_text_is_a_json_string_holding_the_pages_json() {
        let raw = r#""{\"status\":\"ready\",\"pending\":2}""#;
        assert_eq!(parse_answer(raw), Some(answer("ready", 2)));
        assert_eq!(parse_answer(r#""none""#), None);
        assert_eq!(parse_answer("null"), None);
        assert_eq!(parse_answer("{}"), None);
        assert_eq!(parse_answer(""), None);
        assert_eq!(
            parse_answer(r#""{\"status\":\"ready\",\"pending\":-1}""#),
            None
        );
    }

    #[test]
    fn a_ready_store_with_changes_pending_is_asked_again() {
        assert_eq!(judge(Some(&answer("ready", 3)), false, 0), Step::Ask);
        assert_eq!(judge(Some(&answer("ready", 1)), true, 0), Step::Ask);
    }

    #[test]
    fn a_ready_store_with_nothing_pending_is_done_and_says_whether_it_flushed() {
        assert_eq!(
            judge(Some(&answer("ready", 0)), false, 0),
            Step::Done(Outcome::Nothing)
        );
        assert_eq!(
            judge(Some(&answer("ready", 0)), true, 0),
            Step::Done(Outcome::Flushed)
        );
    }

    #[test]
    fn a_store_that_cannot_take_the_changes_is_asked_again_a_few_times_before_it_is_given_up() {
        for asked in 0..UNAVAILABLE_ASKS {
            assert_eq!(
                judge(Some(&answer("unavailable", 2)), false, asked),
                Step::Ask,
                "ask {asked}"
            );
        }
        assert_eq!(
            judge(Some(&answer("unavailable", 2)), true, UNAVAILABLE_ASKS),
            Step::Done(Outcome::Unavailable(2))
        );
        assert_eq!(
            judge(Some(&answer("unavailable", 0)), false, 0),
            Step::Done(Outcome::Nothing)
        );
    }

    #[test]
    fn a_page_still_starting_its_store_with_changes_pending_is_asked_again() {
        assert_eq!(judge(Some(&answer("idle", 1)), false, 0), Step::Ask);
        assert_eq!(
            judge(Some(&answer("idle", 0)), false, 0),
            Step::Done(Outcome::Nothing)
        );
    }

    #[test]
    fn a_page_without_a_store_or_without_the_hook_has_nothing_to_flush() {
        assert_eq!(
            judge(Some(&answer("off", 0)), false, 0),
            Step::Done(Outcome::Nothing)
        );
        assert_eq!(
            judge(Some(&answer("idle", 0)), false, 0),
            Step::Done(Outcome::Nothing)
        );
        assert_eq!(judge(None, false, 0), Step::Done(Outcome::Nothing));
    }

    #[test]
    fn a_page_that_goes_away_after_a_flush_counts_as_flushed() {
        assert_eq!(judge(None, true, 0), Step::Done(Outcome::Flushed));
    }

    #[test]
    fn an_unknown_status_with_changes_pending_never_holds_the_close() {
        assert_eq!(
            judge(Some(&answer("surprise", 4)), false, 0),
            Step::Done(Outcome::Nothing)
        );
    }

    #[test]
    fn outcomes_have_log_names_and_pending_counts() {
        assert_eq!(Outcome::Flushed.name(), "flushed");
        assert_eq!(Outcome::TimedOut(3).name(), "timed_out");
        assert_eq!(Outcome::TimedOut(3).pending(), 3);
        assert_eq!(Outcome::Unavailable(2).pending(), 2);
        assert_eq!(Outcome::Nothing.pending(), 0);
    }

    #[test]
    fn a_reclose_through_the_event_loop_needs_no_fallback() {
        let mut posted = false;
        let route = reclose(
            || Ok(()),
            || {
                posted = true;
                true
            },
        );
        assert_eq!(route, (Reclose::Closed, None));
        assert!(!posted, "the fallback ran although the close worked");
    }

    #[test]
    fn a_failed_reclose_posts_the_close_to_the_window_itself() {
        let route = reclose(|| Err("event loop gone".into()), || true);
        assert_eq!(route, (Reclose::Posted, Some("event loop gone".into())));
        assert_eq!(route.0.name(), "posted");
    }

    #[test]
    fn a_reclose_with_no_route_left_is_reported_lost() {
        let route = reclose(|| Err("event loop gone".into()), || false);
        assert_eq!(route, (Reclose::Lost, Some("event loop gone".into())));
        assert_eq!(Reclose::Lost.name(), "lost");
    }

    #[test]
    fn the_script_asks_only_the_backends_own_loopback_page_and_never_throws() {
        assert!(ASK_JS.contains("location.hostname !== '127.0.0.1'"));
        assert!(ASK_JS.contains("__NQT_STORE_SYNC__"));
        assert!(ASK_JS.contains("catch"));
        assert!(!ASK_JS.contains("fetch"));
    }
}
