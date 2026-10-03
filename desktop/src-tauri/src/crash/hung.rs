//! The hung-page watch (03 section 17): if the backend answers but the page has not painted HOME within 15 s, the
//! shell offers a reload. Under smoke and measure the offer is only logged (`hung_page_offer`), because no native
//! dialog may open there (dialogs.rs fails closed).
//!
//! "Painted" is read from the page itself with one small script: the origin is a loopback page (not the bundled
//! splash or stopped page), the tab is visible, `#root` holds content and the engine has recorded a first
//! contentful paint. The script, not the e2e harness's `nqt:home-ready` mark (which exists only in the Playwright
//! runs), is the shell's signal.
//!
//! "The backend answers" is a check supervise.rs registers with `set_health_check` once it knows the backend (an
//! owner-checked GET of `/api/health`, through link.rs). Until one is registered, a page served from a loopback
//! origin counts as the backend answering, because that page came from it.

use crate::dialogs::{self, Confirm};
use serde_json::json;
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

/// How often the watch looks.
const POLL: Duration = Duration::from_millis(500);
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// A reload is offered at most this many times per run, so a page that never paints cannot nag for ever.
const MAX_OFFERS: u32 = 3;
/// Consecutive failed script calls (the window is gone) after which the watch ends.
const MAX_PROBE_FAILURES: u32 = 20;

/// What one probe of the page found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageState {
    Painted,
    Blank,
    /// The tab is not visible (minimised or hidden): the clock does not run.
    Hidden,
    /// Not the backend's page yet (the splash or the stopped page): the clock does not run.
    Elsewhere,
}

/// What the watch does after one tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Wait,
    Painted,
    Offer,
    GiveUp,
}

/// The clock of the watch: it starts when `/api/health` first answers and runs only while the backend's page is
/// visible and still blank.
#[derive(Debug, Default)]
pub struct HungWatch {
    health_since: Option<Instant>,
    offers: u32,
}

impl HungWatch {
    pub fn tick(
        &mut self,
        now: Instant,
        health_answered: bool,
        page: PageState,
        limit: Duration,
    ) -> Verdict {
        if !health_answered {
            self.health_since = None;
            return Verdict::Wait;
        }
        let since = *self.health_since.get_or_insert(now);
        match page {
            PageState::Painted => Verdict::Painted,
            PageState::Hidden | PageState::Elsewhere => {
                self.health_since = Some(now);
                Verdict::Wait
            }
            PageState::Blank if now.saturating_duration_since(since) < limit => Verdict::Wait,
            PageState::Blank if self.offers >= MAX_OFFERS => Verdict::GiveUp,
            PageState::Blank => {
                self.offers += 1;
                self.health_since = Some(now);
                Verdict::Offer
            }
        }
    }
}

/// The script run in the page. Its value comes back as a JSON string.
pub const PROBE_JS: &str = "(() => {     if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return 'elsewhere';     if (document.visibilityState !== 'visible') return 'hidden';     const root = document.getElementById('root');     const painted = performance.getEntriesByName('first-contentful-paint').length > 0;     return root !== null && root.childElementCount > 0 && painted ? 'painted' : 'blank'; })()";

/// Reads the script's JSON result (`"painted"` and so on). Anything else counts as not painted.
pub fn parse_probe(raw: &str) -> PageState {
    match raw.trim().trim_matches('"') {
        "painted" => PageState::Painted,
        "hidden" => PageState::Hidden,
        "elsewhere" => PageState::Elsewhere,
        _ => PageState::Blank,
    }
}

type HealthCheck = Box<dyn Fn() -> bool + Send + Sync>;

static HEALTH_CHECK: OnceLock<HealthCheck> = OnceLock::new();

/// Registers the check that says whether the backend answers (supervise.rs, once it has spawned or attached). The
/// first registration wins; a check must answer within a couple of seconds.
pub fn set_health_check(check: impl Fn() -> bool + Send + Sync + 'static) {
    let _ = HEALTH_CHECK.set(Box::new(check));
}

/// Whether the backend answers: the registered check, or true while none is registered.
fn backend_answers() -> bool {
    HEALTH_CHECK.get().is_none_or(|check| check())
}

/// None only when the script could not be sent at all (the window is gone).
fn probe(window: &WebviewWindow) -> Option<PageState> {
    let (tx, rx) = mpsc::channel();
    window
        .eval_with_callback(PROBE_JS, move |raw| {
            let _ = tx.send(raw);
        })
        .ok()?;
    // A page whose script never answers is exactly the hung page this watch is for: it counts as not painted.
    Some(
        rx.recv_timeout(PROBE_TIMEOUT)
            .map_or(PageState::Blank, |raw| parse_probe(&raw)),
    )
}

fn offer(window: &WebviewWindow, waited: Duration) {
    let answer = dialogs::offer_reload(Some(window));
    super::log(
        "hung_page_offer",
        json!({
            "waited_s": waited.as_secs(),
            "shown": !crate::TEST_BUILD,
            "answer": format!("{answer:?}"),
        }),
    );
    if answer == Confirm::Proceed {
        match window.reload() {
            Ok(()) => super::log("hung_page_reload", json!({})),
            Err(e) => super::log("hung_page_reload_failed", json!({ "error": e.to_string() })),
        }
    }
}

/// Runs the watch on its own thread until HOME has painted, the offers are spent or the window is gone.
pub fn spawn(window: WebviewWindow) {
    let limit = Duration::from_secs(super::HUNG_PAGE_S);
    let built = std::thread::Builder::new()
        .name("nqt-hung-watch".into())
        .spawn(move || run(&window, limit));
    if let Err(e) = built {
        super::log("hung_watch_failed", json!({ "error": e.to_string() }));
    }
}

fn run(window: &WebviewWindow, limit: Duration) {
    let (mut watch, mut failures, started) = (HungWatch::default(), 0u32, Instant::now());
    loop {
        std::thread::sleep(POLL);
        let answered = backend_answers();
        let page = if answered {
            probe(window)
        } else {
            Some(PageState::Elsewhere)
        };
        let Some(page) = page else {
            failures += 1;
            if failures >= MAX_PROBE_FAILURES {
                return;
            }
            continue;
        };
        failures = 0;
        match watch.tick(Instant::now(), answered, page, limit) {
            Verdict::Wait => {}
            Verdict::Painted => {
                let ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
                super::log("home_painted", json!({ "since_watch_start_ms": ms }));
                return;
            }
            Verdict::Offer => offer(window, limit),
            Verdict::GiveUp => {
                super::log("hung_page_gave_up", json!({ "offers": MAX_OFFERS }));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMIT: Duration = Duration::from_secs(15);

    #[test]
    fn a_blank_page_after_the_limit_gets_an_offer() {
        let mut watch = HungWatch::default();
        let t0 = Instant::now();
        assert_eq!(watch.tick(t0, true, PageState::Blank, LIMIT), Verdict::Wait);
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(14), true, PageState::Blank, LIMIT),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(15), true, PageState::Blank, LIMIT),
            Verdict::Offer
        );
    }

    #[test]
    fn a_painted_page_never_gets_an_offer() {
        let mut watch = HungWatch::default();
        let t0 = Instant::now();
        assert_eq!(watch.tick(t0, true, PageState::Blank, LIMIT), Verdict::Wait);
        assert_eq!(
            watch.tick(
                t0 + Duration::from_secs(10),
                true,
                PageState::Painted,
                LIMIT
            ),
            Verdict::Painted
        );
    }

    #[test]
    fn the_clock_runs_only_while_health_answers_and_the_page_is_the_backends_and_visible() {
        let mut watch = HungWatch::default();
        let t0 = Instant::now();
        assert_eq!(watch.tick(t0, true, PageState::Blank, LIMIT), Verdict::Wait);
        // health drops: the clock restarts when it comes back
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(10), false, PageState::Blank, LIMIT),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(20), true, PageState::Blank, LIMIT),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(30), true, PageState::Hidden, LIMIT),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(
                t0 + Duration::from_secs(40),
                true,
                PageState::Elsewhere,
                LIMIT
            ),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(54), true, PageState::Blank, LIMIT),
            Verdict::Wait
        );
        assert_eq!(
            watch.tick(t0 + Duration::from_secs(55), true, PageState::Blank, LIMIT),
            Verdict::Offer
        );
    }

    #[test]
    fn offers_are_capped() {
        let mut watch = HungWatch::default();
        let mut now = Instant::now();
        let mut offers = 0;
        for _ in 0..40 {
            now += Duration::from_secs(15);
            match watch.tick(now, true, PageState::Blank, LIMIT) {
                Verdict::Offer => offers += 1,
                Verdict::GiveUp => break,
                _ => {}
            }
        }
        assert_eq!(offers, MAX_OFFERS);
    }

    #[test]
    fn the_probe_result_is_read_from_its_json_string() {
        assert_eq!(parse_probe("\"painted\""), PageState::Painted);
        assert_eq!(parse_probe("\"hidden\""), PageState::Hidden);
        assert_eq!(parse_probe("\"elsewhere\""), PageState::Elsewhere);
        assert_eq!(parse_probe("\"blank\""), PageState::Blank);
        assert_eq!(parse_probe("null"), PageState::Blank);
        assert!(PROBE_JS.contains("first-contentful-paint") && PROBE_JS.contains("'127.0.0.1'"));
    }

    #[test]
    fn without_a_registered_check_the_page_itself_counts_as_the_backend_answering() {
        assert!(backend_answers());
    }
}
