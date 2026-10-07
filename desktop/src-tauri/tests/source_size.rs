//! No source file of the shell grows past the 800-line soft ceiling without a recorded reason (V032 audit: window.rs
//! and supervise_check.rs had both passed it with the IB switch and the minimised start). A cohesive unit that
//! outgrows its file moves into its own module (supervise_ib_faults.rs, window_tests.rs), as ib_switch.rs did.
//!
//! A deliberate exception is a line in `EXCEPTIONS`: the file name and the reason it stays whole. There are none.
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the crate's own source files to count their lines"
)]

use std::path::Path;

const CEILING: usize = 800;

/// File name and the reason it may stay over the ceiling.
const EXCEPTIONS: [(&str, &str); 0] = [];

#[test]
fn every_source_file_is_under_the_soft_ceiling_or_has_a_recorded_reason() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut over = Vec::new();
    let mut seen = 0;
    for entry in std::fs::read_dir(&src).expect("the src folder") {
        let path = entry.expect("a directory entry").path();
        if path.extension().is_none_or(|e| e != "rs") {
            continue;
        }
        seen += 1;
        let name = path
            .file_name()
            .expect("a file name")
            .to_string_lossy()
            .into_owned();
        let lines = std::fs::read_to_string(&path)
            .expect("a source file")
            .lines()
            .count();
        let excused = EXCEPTIONS
            .iter()
            .any(|(file, reason)| *file == name && !reason.is_empty());
        if lines > CEILING && !excused {
            over.push(format!("{name}: {lines} lines"));
        }
    }
    assert!(
        seen > 20,
        "the scan must see the crate's sources, saw {seen}"
    );
    assert!(
        over.is_empty(),
        "over {CEILING} lines with no recorded reason: {over:?}"
    );
}
