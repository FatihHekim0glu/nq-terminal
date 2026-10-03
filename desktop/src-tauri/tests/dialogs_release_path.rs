//! The release confirmation dialogs can answer yes (04 D4.2 item 14; review issue: custom button labels).
//!
//! rfd draws `OkCancelCustom` with a task dialog only when its `common-controls-v6` feature is on. Without it rfd
//! falls back to a plain message box with OK and Cancel, drops the labels and never returns the custom answer, so
//! `dialogs::ask` could never see "yes": the rebuild, the restart, the reload and the webview folder could never be
//! accepted and a running backtest could never be closed. Test builds fail closed before rfd, so no other test
//! reaches this path. This test reads the manifest the release is built from and fails when the feature is missing.
//!
//! Born failing: it failed against the manifest that took rfd with `default-features = false` alone.

#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own manifest"
)]

use std::path::Path;

fn manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    std::fs::read_to_string(path).expect("read Cargo.toml")
}

fn rfd_line(text: &str) -> String {
    text.lines()
        .find(|l| l.trim_start().starts_with("rfd"))
        .expect("an rfd dependency line")
        .to_string()
}

#[test]
fn rfd_draws_custom_buttons_with_common_controls_v6() {
    let line = rfd_line(&manifest());
    assert!(
        line.contains("common-controls-v6"),
        "rfd needs common-controls-v6 or OkCancelCustom loses its labels and answers: {line}"
    );
}

#[test]
fn rfd_keeps_the_linux_portal_and_wayland_defaults_off() {
    let line = rfd_line(&manifest());
    assert!(line.contains("default-features = false"), "{line}");
}
