//! A slow proof is not a swapped backend (05 G08). The navigation check answers within a short budget on the UI
//! thread; when the backend is only busy, the proof times out or the connection is reset, and that is "unverified":
//! the navigation is cancelled, the proof is retried off the UI thread with a longer budget, and the navigation is
//! repeated once it passes (the pass is an approval for that one navigation). Only a proof that answers wrongly, or
//! from a process that is not the backend's, is a refusal.

use super::check::Mismatch;
use crate::link::LinkError;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// The shell page's Retry link; WebView2 raises NavigationStarting for it and the shell answers it, so the page
/// needs no script.
pub const RETRY_URI: &str = "http://tauri.localhost/retry-backend";
/// How many times a slow proof is tried again before the stopped page offers the Retry link.
pub const RETRY_ATTEMPTS: usize = 3;
/// One retried proof's budget (the navigation check's own is shorter, because the UI thread waits for it).
pub const RETRY_BUDGET: Duration = Duration::from_secs(5);
/// The pause between two retried proofs.
pub const RETRY_PAUSE: Duration = Duration::from_millis(500);
/// How long a passed proof lets the repeated navigation through.
pub const APPROVAL_TTL: Duration = Duration::from_secs(10);

/// Shown in the stopped page's status paragraph the moment the Retry link is followed (a polite live region, so it is
/// announced); the proof can take up to about 16 s and the page must not look dead meanwhile.
pub const CHECKING: &str = "Checking the backend again.";
/// Shown in place when every attempt failed again; the page is not reloaded, so the Retry link keeps its focus.
pub const STILL_UNVERIFIED: &str =
    "Still not verified. The backend did not answer its identity check in time.";

/// A script that sets the unverified section's status paragraph to `text`, and only on the stopped page.
pub fn status_script(text: &str) -> String {
    let text = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into());
    format!(
        "(function(){{var e=document.getElementById('unverified-text');\
         if(e&&location.pathname.endsWith('stopped.html')){{e.textContent={text};}}}})();"
    )
}

/// The shell's own page origin; the stopped page is joined onto it.
pub const PAGES_ORIGIN: &str = "http://tauri.localhost/";

/// The URL the shell pages are joined onto: the window's own when it already shows a shell page, else the shell
/// origin. At setup the window still shows `about:blank`, which cannot be a base, so it must not be used.
pub fn pages_base(current: Option<tauri::Url>) -> Result<tauri::Url, String> {
    let own = current.filter(|u| u.host_str().is_some_and(|h| h.ends_with("tauri.localhost")));
    match own {
        Some(url) => Ok(url),
        None => PAGES_ORIGIN
            .parse::<tauri::Url>()
            .map_err(|e| e.to_string()),
    }
}

pub fn is_retry_request(uri: &str) -> bool {
    uri == RETRY_URI
}

/// What a failed proof request means: a wrong owner is a refusal, a slow or reset connection is unverified.
pub fn link_refusal(e: LinkError) -> Mismatch {
    match e {
        LinkError::NotOwned { owner, .. } => Mismatch::Listener(owner),
        LinkError::Timeout | LinkError::Io(_) => Mismatch::Unverified(e.to_string()),
        other => Mismatch::Proof(other.to_string()),
    }
}

/// `check` on its own thread, unverified when it takes longer than `budget`.
pub fn within<F>(budget: Duration, check: F) -> Result<(), Mismatch>
where
    F: FnOnce() -> Result<(), Mismatch> + Send + 'static,
{
    let (tx, rx) = mpsc::sync_channel(1);
    let started = std::thread::Builder::new()
        .name("nqt-navigation-check".into())
        .spawn(move || tx.send(check()));
    if started.is_err() {
        return Err(Mismatch::Unverified("the check could not start".into()));
    }
    let late = || Err(Mismatch::Unverified("no proof within the budget".into()));
    rx.recv_timeout(budget).unwrap_or_else(|_| late())
}

/// Runs `once` up to `attempts` times while it stays unverified; any other answer ends it. `stop_after_pause` waits
/// out the pause and says whether the shell is closing.
pub fn retry<F, W>(attempts: usize, mut once: F, mut stop_after_pause: W) -> Result<(), Mismatch>
where
    F: FnMut() -> Result<(), Mismatch>,
    W: FnMut() -> bool,
{
    let mut last = Mismatch::Unverified("no attempt was made".into());
    for n in 0..attempts {
        match once() {
            Ok(()) => return Ok(()),
            Err(m @ Mismatch::Unverified(_)) => last = m,
            Err(other) => return Err(other),
        }
        if n + 1 < attempts && stop_after_pause() {
            break;
        }
    }
    Err(last)
}

/// A passed retry, good for one navigation to its port within `APPROVAL_TTL`.
#[derive(Default)]
pub struct Approval(Mutex<Option<(u16, Instant)>>);

impl Approval {
    pub fn grant(&self, port: u16, now: Instant) {
        if let Ok(mut held) = self.0.lock() {
            *held = Some((port, now));
        }
    }

    /// Uses the approval when it is for `port`: it is gone after that, and counts only within the limit.
    pub fn take(&self, port: u16, now: Instant) -> bool {
        let Ok(mut held) = self.0.lock() else {
            return false;
        };
        match *held {
            Some((p, at)) if p == port => {
                *held = None;
                now.saturating_duration_since(at) <= APPROVAL_TTL
            }
            _ => false,
        }
    }
}
