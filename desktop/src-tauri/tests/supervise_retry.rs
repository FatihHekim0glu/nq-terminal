//! A slow proof is not a swapped backend (05 G08; review finding on the navigation check): a timeout or a transport
//! failure of the fresh proof is "unverified", which cancels the navigation, retries the proof off the UI thread with
//! a longer budget and goes on when it passes; only a proof that answers wrongly (or from the wrong process) is a
//! refusal that shows the swapped section. The stopped page's unverified section carries a Retry link.
//!
//! Born failing: before `supervise::retry` existed a timeout was `Mismatch::Proof`, so a busy backend turned into the
//! "failed its identity check" page with no way back except a restart of the app.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: reads the bundled stopped page"
)]

#[allow(dead_code)]
#[path = "../src/link.rs"]
mod link;
/// Only the pure parts of the supervisor: the refusals and the retry rules need no window and no backend.
#[allow(dead_code, unused_imports)]
mod supervise {
    #[path = "../../src/supervise_check.rs"]
    pub mod check;
    #[path = "../../src/supervise_retry.rs"]
    pub mod retry;
}

use link::LinkError;
use std::time::{Duration, Instant};
use supervise::check::Mismatch;
use supervise::retry::{self, APPROVAL_TTL, Approval, RETRY_ATTEMPTS};

fn unverified() -> Mismatch {
    Mismatch::Unverified("slow".into())
}

#[test]
fn a_timeout_or_a_transport_failure_is_unverified_not_swapped() {
    for slow in [LinkError::Timeout, LinkError::Io("reset".into())] {
        let m = retry::link_refusal(slow);
        assert!(matches!(m, Mismatch::Unverified(_)), "{m:?}");
        assert_eq!(m.code(), "unverified");
    }
}

#[test]
fn a_wrong_answer_or_a_wrong_owner_is_still_a_refusal() {
    let owner = LinkError::NotOwned {
        port: 1,
        owner: Some(7),
    };
    assert_eq!(retry::link_refusal(owner), Mismatch::Listener(Some(7)));
    let odd = retry::link_refusal(LinkError::Protocol("odd".into()));
    assert_eq!(odd.code(), "swapped");
}

#[test]
fn a_check_over_its_budget_is_unverified_and_one_inside_it_passes() {
    let late = retry::within(Duration::from_millis(50), || {
        std::thread::sleep(Duration::from_millis(400));
        Ok(())
    });
    assert!(matches!(late, Err(Mismatch::Unverified(_))), "{late:?}");
    assert_eq!(retry::within(Duration::from_secs(2), || Ok(())), Ok(()));
    let wrong = retry::within(Duration::from_secs(2), || Err(Mismatch::Hmac));
    assert_eq!(wrong, Err(Mismatch::Hmac));
}

#[test]
fn a_slow_proof_is_retried_until_it_answers() {
    let mut answers = vec![Ok(()), Err(unverified()), Err(unverified())];
    let mut calls = 0;
    let done = retry::retry(
        RETRY_ATTEMPTS,
        || {
            calls += 1;
            answers.pop().expect("an answer")
        },
        || false,
    );
    assert_eq!((done, calls), (Ok(()), 3));
}

#[test]
fn a_wrong_answer_ends_the_retries_at_once() {
    let mut calls = 0;
    let done = retry::retry(
        RETRY_ATTEMPTS,
        || {
            calls += 1;
            if calls == 1 {
                Err(unverified())
            } else {
                Err(Mismatch::Proof("no".into()))
            }
        },
        || false,
    );
    assert_eq!((done, calls), (Err(Mismatch::Proof("no".into())), 2));
}

#[test]
fn retries_are_bounded_and_end_unverified() {
    let mut calls = 0;
    let done = retry::retry(
        RETRY_ATTEMPTS,
        || {
            calls += 1;
            Err(unverified())
        },
        || false,
    );
    assert!(matches!(done, Err(Mismatch::Unverified(_))), "{done:?}");
    assert_eq!(calls, RETRY_ATTEMPTS);
}

#[test]
fn a_stop_request_ends_the_retries() {
    let mut calls = 0;
    let done = retry::retry(
        RETRY_ATTEMPTS,
        || {
            calls += 1;
            Err(unverified())
        },
        || true,
    );
    assert!(done.is_err());
    assert_eq!(calls, 1);
}

#[test]
fn an_approval_is_for_one_navigation_to_one_port_for_a_short_time() {
    let now = Instant::now();
    let approval = Approval::default();
    assert!(!approval.take(8000, now), "nothing was granted");
    approval.grant(8000, now);
    assert!(!approval.take(8001, now), "another port");
    assert!(approval.take(8000, now), "the granted port");
    assert!(!approval.take(8000, now), "an approval is used once");
    approval.grant(8000, now);
    let later = now + APPROVAL_TTL + Duration::from_secs(1);
    assert!(!approval.take(8000, later), "an old approval");
}

#[test]
fn the_retry_link_is_recognised_and_nothing_else_is() {
    assert!(retry::is_retry_request(retry::RETRY_URI));
    assert!(!retry::is_retry_request(
        "http://tauri.localhost/stopped.html"
    ));
    assert!(!retry::is_retry_request("http://127.0.0.1:9/retry-backend"));
}

#[test]
fn the_stopped_page_has_an_unverified_section_with_a_retry_link() {
    let page = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/stopped.html"))
        .expect("page");
    let start = page
        .find("id=\"unverified\"")
        .expect("an unverified section");
    let section = &page[start..];
    let section = &section[..section.find("</section>").expect("its end")];
    assert!(section.contains("href=\"retry-backend\""), "{section}");
    assert!(
        unverified().message().contains("in time"),
        "its own message"
    );
}

/// Born failing (found in a real-backend launch): setup read the window's URL, which is `about:blank` before the
/// first page loads, and joined the stopped page onto it, so a refusal at start-up could never show its page
/// ("relative URL with a cannot-be-a-base base").
#[test]
fn the_stopped_page_base_is_the_shell_origin_whatever_the_window_url_was_at_setup() {
    let base = |url: Option<&str>| {
        retry::pages_base(url.map(|u| u.parse().expect("url"))).expect("a base")
    };
    for current in [None, Some("about:blank"), Some("http://127.0.0.1:9/")] {
        let joined = base(current).join("stopped.html#root").expect("joins");
        assert_eq!(joined.as_str(), "http://tauri.localhost/stopped.html#root");
    }
    let own = base(Some("http://tauri.localhost/splash.html"));
    assert_eq!(own.as_str(), "http://tauri.localhost/splash.html");
}
