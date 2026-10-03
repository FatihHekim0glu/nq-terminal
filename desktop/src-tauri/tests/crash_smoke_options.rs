//! The smoke hooks behind the frozen `SmokeOptions` (03 section 15.4; 04 D4.5), read back from a real hidden
//! launch against the loopback page server on port 8813: the debugging port read from DevToolsActivePort is
//! non-zero and is the one the shell logs, the page runs `visible` behind the hidden window (the controller route),
//! `--force-device-scale-factor=1` and `--zoom` reach the page (`devicePixelRatio`), `--size` reaches the window,
//! and the hung-page watch sees the painted page. The global window and foreground watch runs for each launch.
//!
//! Born failing: dropping the scale switch, the zoom call or the controller call fails the matching assertion.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the run folder of the shell it started"
)]

mod crash_support;

use crash_support::{Page, PageServer, Spec, cdp_eval, launch, one_run};
use std::path::Path;
use std::time::Duration;

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"))
}

const LONG: Duration = Duration::from_secs(90);

#[test]
fn the_debugging_port_is_read_from_devtools_active_port_and_is_not_zero() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "port",
            page: Page::Painted,
            args: &["--remote-debugging-port", "0"],
            envs: &[],
        },
    );
    run.wait_page_finished();
    let port = run.devtools_port();
    assert_ne!(port, 0, "DevToolsActivePort holds port 0");
    assert_ne!(port, 8765, "the engine must never use the owner's port");
    let logged = run.wait_event("devtools_port", 1, LONG);
    assert_eq!(
        logged["port"], port,
        "the shell logs the port the engine wrote"
    );
    let visibility = cdp_eval(port, &PageServer::url(), "document.visibilityState");
    assert_eq!(
        visibility, "visible",
        "the page must run behind the hidden window (controller route)"
    );
    let ratio = cdp_eval(port, &PageServer::url(), "window.devicePixelRatio");
    assert_eq!(
        ratio, 1,
        "--force-device-scale-factor=1 must give a device pixel ratio of 1"
    );
    let record = run.wait_event("smoke_options", 1, LONG);
    assert_eq!(record["remote_debugging_port"], 0);
    assert_eq!(record["screen2"], false);
    let painted = run.wait_event("home_painted", 1, Duration::from_secs(30));
    println!("home_painted: {painted}");
    assert_eq!(
        run.count("hung_page_offer"),
        0,
        "a painted page got a reload offer"
    );
    run.finish().assert_clean("debugging port");
}

#[test]
fn zoom_and_size_reach_the_page_and_the_window() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "zoom",
            page: Page::Painted,
            args: &["--zoom", "200", "--size", "1280x800"],
            envs: &[],
        },
    );
    run.wait_page_finished();
    let port = run.devtools_port();
    let zoom = run.wait_event("smoke_zoom", 1, LONG);
    assert_eq!(zoom["applied"], true, "{zoom}");
    let ratio = cdp_eval(port, &PageServer::url(), "window.devicePixelRatio");
    assert_eq!(
        ratio, 2,
        "--zoom 200 with the scale factor forced to 1 must give a device pixel ratio of 2"
    );
    let window = run.wait_event("smoke_window", 1, LONG);
    let scale = window["scale_factor"].as_f64().expect("scale factor");
    let size = window["inner_physical"].as_array().expect("inner size");
    let (w, h) = (size[0].as_f64().expect("w"), size[1].as_f64().expect("h"));
    assert!(
        (w - 1280.0 * scale).abs() <= 2.0 && (h - 800.0 * scale).abs() <= 2.0,
        "{window}"
    );
    assert_eq!(
        window["visible"], false,
        "a smoke window must stay hidden: {window}"
    );
    run.finish().assert_clean("zoom and size");
}
