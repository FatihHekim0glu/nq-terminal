//! Page and engine crash (03 section 17; W0A P3): killing the renderer reloads the page once; killing it again
//! shows the bundled stopped page. The hidden smoke exe runs against the loopback page server on port 8813, the
//! test ends only this run's `msedgewebview2.exe --type=renderer` processes (found by the run's profile folder), and
//! the global window and foreground watch runs for the whole launch.
//!
//! Born failing: a handler that reloads every time (never showing the stopped page), or that never reloads, fails
//! the sequence below, because the server counts how often `/` was fetched.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the run folder of the shell it started"
)]

mod crash_support;

use crash_support::{Page, Run, Spec, kill_renderers, launch, one_run, page_urls, request_log};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"))
}

/// Ends the run's renderer, retrying while the engine is still starting a new one.
fn kill_until_one_dies(run: &Run) -> Vec<u32> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        let killed = kill_renderers(&run.dir.join("wv"));
        if !killed.is_empty() {
            return killed;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    panic!("no renderer of this run could be ended");
}

fn wait_for(what: &str, timeout: Duration, mut condition: impl FnMut() -> bool) {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if condition() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("timed out waiting for {what}");
}

#[test]
fn killing_the_renderer_reloads_once_then_shows_the_stopped_page() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "renderer",
            page: Page::Painted,
            args: &[],
            envs: &[],
        },
    );
    run.wait_page_finished();
    run.wait_event("process_failed_watch", 1, Duration::from_secs(30));
    let port = run.devtools_port();
    let hits_before = run.server.page_hits.load(Ordering::SeqCst);
    assert!(hits_before >= 1, "the page was never fetched");

    // First failure: one reload, the page comes back.
    let killed = kill_until_one_dies(&run);
    println!("first kill ended pids {killed:?}");
    let first = run.wait_event("process_failed", 1, Duration::from_secs(30));
    assert_eq!(first["kind"], 1, "render process exited: {first}");
    assert_eq!(first["action"], "Reload");
    run.wait_event("reload", 1, Duration::from_secs(30));
    wait_for(
        "the reloaded page to be fetched",
        Duration::from_secs(30),
        || run.server.page_hits.load(Ordering::SeqCst) > hits_before,
    );
    let hits_after_reload = run.server.page_hits.load(Ordering::SeqCst);

    // Second failure inside the stable period: the stopped page, no second reload.
    wait_for(
        "the reloaded page to finish loading",
        Duration::from_secs(30),
        || {
            run.events()
                .iter()
                .filter(|e| e["event"] == "page_finished")
                .count()
                >= 2
        },
    );
    let killed = kill_until_one_dies(&run);
    println!("second kill ended pids {killed:?}");
    let second = run.wait_event("process_failed", 2, Duration::from_secs(30));
    assert_eq!(second["action"], "ShowStopped", "{second}");
    let stopped = run.wait_event("stopped_page", 1, Duration::from_secs(30));
    assert!(
        stopped["url"]
            .as_str()
            .is_some_and(|u| u.ends_with("/stopped.html#renderer")),
        "{stopped}"
    );
    wait_for(
        "the stopped page in the window",
        Duration::from_secs(30),
        || {
            page_urls(port)
                .iter()
                .any(|u| u.ends_with("/stopped.html#renderer"))
        },
    );
    assert_eq!(
        run.count("reload"),
        1,
        "the page was reloaded more than once"
    );
    assert_eq!(
        run.server.page_hits.load(Ordering::SeqCst),
        hits_after_reload,
        "the backend page was fetched again after the stopped page was shown: {:#?}",
        request_log()
    );
    run.finish().assert_clean("renderer kill");
}
