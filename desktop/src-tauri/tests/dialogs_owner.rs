//! Every question the shell asks while its window exists is owned by that window (04 D4.2 item 14; review issue:
//! ownerless dialogs).
//!
//! A dialog with no owner is a separate top-level window: the main window stays usable beside it, and when another
//! application has the foreground Windows leaves it behind (taskbar flash only), while the page says it is waiting
//! for the answer. Test builds fail closed before rfd, so no run can see this; this test reads the sources:
//! `ask` must hand its owner to rfd with `set_parent`, no caller may pass `None`, and the two destructive
//! confirmations must put Cancel first (the default button).
//!
//! Born failing: the sources before the fix had no `set_parent` anywhere and the entry points took no owner.

#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own sources"
)]

use std::path::Path;

fn source(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

/// The text of the function that starts at `signature` up to the next top-level item.
fn body<'a>(text: &'a str, signature: &str) -> &'a str {
    let start = text.find(signature).expect("function present");
    let rest = &text[start..];
    let end = rest[1..].find("\n}\n").map_or(rest.len(), |i| i + 1);
    &rest[..end]
}

/// True when the function's text hands an owner to rfd.
fn sets_parent(function: &str) -> bool {
    function.contains(".set_parent(")
}

#[test]
fn the_check_itself_fails_on_an_ownerless_dialog() {
    let before_the_fix =
        "fn ask(text: &str) -> bool {\n    rfd::MessageDialog::new().set_title(TITLE).show();\n}\n";
    assert!(!sets_parent(body(before_the_fix, "fn ask(")));
}

#[test]
fn ask_parents_its_dialog_to_the_owner() {
    let text = source("dialogs.rs");
    assert!(
        sets_parent(body(&text, "fn ask<")),
        "ask must call set_parent"
    );
}

#[test]
fn every_owned_entry_point_takes_an_owner() {
    let text = source("dialogs.rs");
    for name in [
        "pub fn restart_or_quit<",
        "pub fn confirm_close_running_job<",
        "pub fn browser_update_restart<",
        "pub fn offer_reload<",
        "pub fn confirm_rebuild<",
    ] {
        let function = body(&text, name);
        let head = function.lines().take(3).collect::<String>();
        assert!(
            head.contains("owner: Owner<"),
            "{name} takes no owner: {head}"
        );
    }
}

#[test]
fn no_caller_passes_no_owner() {
    for file in [
        "window.rs",
        "window_rebuild.rs",
        "crash/hung.rs",
        "supervise_shell.rs",
    ] {
        let text = source(file);
        for call in text.lines().filter(|l| l.contains("dialogs::")) {
            for name in [
                "restart_or_quit(",
                "confirm_close_running_job(",
                "browser_update_restart(",
                "offer_reload(",
                "confirm_rebuild(",
            ] {
                if let Some(at) = call.find(name) {
                    let args = &call[at + name.len()..];
                    assert!(!args.trim_start().starts_with("None"), "{file}: {call}");
                    assert!(!args.trim_start().starts_with(')'), "{file}: {call}");
                }
            }
        }
    }
}

#[test]
fn destructive_confirmations_default_to_cancel() {
    let text = source("dialogs.rs");
    let close = body(&text, "pub fn confirm_close_running_job<");
    let rebuild = body(&text, "pub fn confirm_rebuild<");
    assert!(
        close.contains("true,"),
        "close confirm must be destructive: {close}"
    );
    assert!(
        rebuild.contains(", true)"),
        "rebuild confirm must be destructive: {rebuild}"
    );
}
