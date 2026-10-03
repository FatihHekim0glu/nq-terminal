//! The splash reading is the page load event, not a painted frame (04 D4.6). The measure build never shows its
//! window, so first paint cannot be observed there; W5B measures it on screen 2 and keeps the load-event figure as a
//! separate row. This scan keeps the first-readings test from labelling the load-event figure "painted".
#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own sources"
)]

use std::path::PathBuf;

fn read(relative: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn the_first_readings_label_the_load_event_not_a_painted_frame() {
    let source = read("tests/hidden_window.rs");
    assert!(
        source.contains("READING splash_load_ms"),
        "the printed reading must be named splash_load_ms"
    );
    assert!(
        !source.contains("splash_ms"),
        "the old name splash_ms hides that the figure is a load event"
    );
    assert!(
        source.contains("painted deferred to W5B"),
        "the reading must say first paint is deferred to W5B"
    );
}

#[test]
fn the_roadmap_exit_line_says_load_event_and_defers_paint() {
    let roadmap = read("../../docs/desktop/04_roadmap.md");
    assert!(
        roadmap.contains("splash load event within 1,000 ms (target 500 ms)"),
        "04 D4.6 must name the load event"
    );
    assert!(
        roadmap.contains("painted deferred to W5B"),
        "04 D4.6 must defer the painted frame to W5B"
    );
    assert!(
        !roadmap.contains("splash painted within 1,000 ms"),
        "04 D4.6 still claims a painted reading"
    );
}
