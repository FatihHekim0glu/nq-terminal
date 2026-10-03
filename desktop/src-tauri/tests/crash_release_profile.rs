//! The release build keeps `panic = "abort"` (03 section 17: the panic hook writes the report, then the process
//! aborts). The profile lives in Cargo.toml, which this slice does not edit, so a test reads it.
//!
//! Born failing: a manifest with the line removed (or set to "unwind") fails the check below, which is shown on
//! planted manifest texts first.
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the crate's own manifest"
)]

fn release_panics_abort(manifest: &str) -> bool {
    let mut in_release = false;
    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_release = line == "[profile.release]";
            continue;
        }
        if in_release && line.replace(' ', "") == "panic=\"abort\"" {
            return true;
        }
    }
    false
}

#[test]
fn the_check_catches_planted_manifests() {
    assert!(release_panics_abort(
        "[profile.release]\nopt-level = \"s\"\npanic = \"abort\"\n"
    ));
    for planted in [
        "[profile.release]\nopt-level = \"s\"\n",
        "[profile.release]\npanic = \"unwind\"\n",
        "[profile.dev]\npanic = \"abort\"\n[profile.release]\nlto = true\n",
        "",
    ] {
        assert!(!release_panics_abort(planted), "accepted {planted:?}");
    }
}

#[test]
fn the_release_profile_aborts_on_panic() {
    let manifest = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .expect("Cargo.toml is readable");
    assert!(
        release_panics_abort(&manifest),
        "[profile.release] must keep panic = \"abort\""
    );
}
