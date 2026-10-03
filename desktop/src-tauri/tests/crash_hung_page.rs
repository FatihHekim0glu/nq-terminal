//! The hung-page watch (03 section 17): the backend answers but HOME has not painted. The hidden smoke exe loads a
//! loopback page whose `#root` stays empty; 15 s after the page is the backend's, the shell must offer a reload,
//! which under smoke is only logged (`hung_page_offer`, `shown: false`, answer Cancel) because every native dialog
//! fails closed. The global window and foreground watch runs throughout, so an offer that opened a dialog fails the
//! run.
//!
//! Born failing: a watch that never offers, or one that offers before 15 s, fails the timing assertions.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the run folder of the shell it started"
)]

mod crash_support;

use crash_support::{Page, Spec, launch, one_run};
use std::path::Path;
use std::time::{Duration, Instant};

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"))
}

#[test]
fn a_page_that_never_paints_gets_a_logged_reload_offer_after_15_seconds() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "hung",
            page: Page::Blank,
            args: &[],
            envs: &[],
        },
    );
    run.wait_page_finished();
    let loaded = Instant::now();
    let offer = run.wait_event("hung_page_offer", 1, Duration::from_secs(60));
    let waited = loaded.elapsed();
    assert_eq!(
        offer["shown"], false,
        "a test build must not show the offer: {offer}"
    );
    assert_eq!(offer["answer"], "Cancel", "{offer}");
    assert!(
        offer["waited_s"].as_u64().is_some_and(|s| s >= 15),
        "{offer}"
    );
    assert!(
        waited >= Duration::from_secs(10),
        "the offer came after only {waited:?}"
    );
    assert_eq!(
        run.count("home_painted"),
        0,
        "a blank page was reported as painted"
    );
    assert_eq!(
        run.count("hung_page_reload"),
        0,
        "a cancelled offer must not reload"
    );
    run.finish().assert_clean("hung page");
}
