//! The memory target (release 0.2.0, perf-3) is wired where it must be, checked statically: the window event handler
//! of the shell calls it first, and the smoke harness's simulated minimise reaches it, so a smoke run logs
//! `memory_target` when the controller is hidden or shown. The behaviour itself is unit tested in memory_target.rs.
#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own sources"
)]

use std::path::PathBuf;

fn source(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

#[test]
fn the_window_event_handler_tells_the_memory_target_first() {
    let main = source("main.rs");
    assert!(main.contains("mod memory_target;"));
    let call = main
        .find("memory_target::on_window_event(")
        .expect("main.rs calls memory_target::on_window_event");
    let handler = main
        .find(".on_window_event(")
        .expect("main.rs registers a window event handler");
    assert!(
        handler < call,
        "the call sits inside the window event closure"
    );
}

#[test]
fn the_simulated_minimise_reaches_the_memory_target() {
    let smoke = source("smoke.rs");
    assert!(
        smoke.contains("crate::memory_target::on_simulated_visibility(window, visible)"),
        "smoke.rs must tell the memory target about a simulated minimise"
    );
}

#[test]
fn the_memory_target_asks_for_nothing_but_the_two_levels() {
    let module = source("memory_target.rs");
    assert!(module.contains("COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW"));
    assert!(module.contains("COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL"));
    assert!(
        !module.contains("TrySuspend("),
        "the page is never suspended, only given a lower memory target"
    );
}
