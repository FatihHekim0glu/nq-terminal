//! The DownloadStarting guard is installed before, and regardless of, the best-effort backstop download folder
//! (03 section 6 item 3; 02 C3-7). A runtime too old for the profile interface, or a refused folder call, must
//! never leave downloads going through the engine's own UI and landing folder.
//!
//! writes.rs is part of the bin crate, so it is compiled into this test through `#[path]`, with the two crate items
//! its test-build signature names stood in for below.

#[allow(
    dead_code,
    reason = "only the install-order helper of the module is driven here"
)]
#[path = "../src/writes.rs"]
mod writes;

use std::cell::RefCell;
use writes::install_guard_first;

#[allow(
    dead_code,
    reason = "named only by the signature of the test-build on_download_starting"
)]
pub struct Launch;

#[allow(
    dead_code,
    reason = "named only by the signature of the test-build on_download_starting"
)]
#[derive(Debug)]
pub struct ShellError;

#[test]
fn guard_is_added_before_the_backstop_is_tried() {
    let order = RefCell::new(Vec::new());
    let result = install_guard_first(
        || {
            order.borrow_mut().push("guard");
            Ok::<(), String>(())
        },
        || {
            order.borrow_mut().push("backstop");
            Ok(())
        },
    );
    assert_eq!(result, Ok(None));
    assert_eq!(*order.borrow(), ["guard", "backstop"]);
}

#[test]
fn failed_backstop_keeps_the_guard_and_is_reported() {
    let guard_added = RefCell::new(false);
    let result = install_guard_first(
        || {
            *guard_added.borrow_mut() = true;
            Ok::<(), String>(())
        },
        || Err("no profile interface".to_string()),
    );
    assert!(*guard_added.borrow(), "the guard must be added");
    assert_eq!(result, Ok(Some("no profile interface".to_string())));
}

#[test]
fn failed_guard_fails_the_install_and_skips_the_backstop() {
    let backstop_tried = RefCell::new(false);
    let result = install_guard_first(
        || Err::<(), String>("add_DownloadStarting refused".to_string()),
        || {
            *backstop_tried.borrow_mut() = true;
            Ok(())
        },
    );
    assert_eq!(result, Err("add_DownloadStarting refused".to_string()));
    assert!(!*backstop_tried.borrow(), "no backstop without the guard");
}
