//! Without the `smoke` feature the debugging port and every test switch do not exist (02 C3-8; 03 sections 15.4 and
//! 17; 04 D4.5), and the feature list shows no `smoke` or `measure`. The test is built with the feature set it runs
//! under: `cargo test` (the release features) and `--no-default-features --features measure` must find nothing in
//! the shell exe, and `--features smoke` must find every needle (the positive control that makes the scan mean
//! something). The exe is only READ here, never launched: the release build would show its window.
//!
//! `cargo tree -e features` lists a package's own features only when asked about the package itself
//! (`-i nq-lab-terminal`); without `-i` a feature that enables no dependency is invisible, so the plan's plain
//! `cargo tree | Select-String 'smoke|measure'` cannot fail a build that has `smoke`. This test uses `-i`.
#![allow(
    dead_code,
    clippy::disallowed_methods,
    reason = "test: it reads the shell exe and runs `cargo tree` on the crate itself; some needles serve one feature set only"
)]

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Strings that exist only in smoke builds: the debugging port and scale switches, every smoke switch of the frozen
/// SmokeOptions, the forced-panic variable and the port file the harness reads.
const SMOKE_ONLY: [&str; 12] = [
    "remote-debugging-port",
    "force-device-scale-factor",
    "--attach-url",
    "--fixture",
    "--screen2",
    "--webview-data-dir",
    "--config-dir",
    "--save-dir",
    "--state-dir",
    "NQT_SMOKE_FORCE_PANIC",
    "DevToolsActivePort",
    "smoke switches refused",
];
const SMOKE_IDENTITY: &str = "dev.nqlab.terminal.smoke";
const MEASURE_IDENTITY: &str = "dev.nqlab.terminal.measure";

/// The exe's text as one ASCII-ish string with every zero byte removed, so UTF-16 strings (the Windows API ones)
/// read like UTF-8 ones. The std string search is the optimised one, which keeps this fast in a debug test build.
fn text_of(bytes: &[u8]) -> String {
    let stripped: Vec<u8> = bytes.iter().copied().filter(|b| *b != 0).collect();
    String::from_utf8_lossy(&stripped).into_owned()
}

fn found_in(text: &str, needles: &[&str]) -> Vec<String> {
    needles
        .iter()
        .filter(|needle| text.contains(**needle))
        .map(|needle| (*needle).to_string())
        .collect()
}

fn exe_text() -> String {
    let exe = Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"));
    text_of(&std::fs::read(exe).unwrap_or_else(|e| panic!("cannot read {}: {e}", exe.display())))
}

fn utf16le(text: &str) -> Vec<u8> {
    text.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

/// `cargo tree -e features -i nq-lab-terminal` with the given feature flags, run in the crate folder.
fn cargo_tree(flags: &[&str]) -> String {
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let out = Command::new(cargo)
        .args([
            "tree",
            "-e",
            "features",
            "--locked",
            "--offline",
            "-i",
            "nq-lab-terminal",
        ])
        .args(flags)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run cargo tree: {e}"));
    assert!(
        out.status.success(),
        "cargo tree failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn the_scan_finds_planted_switches_in_either_encoding() {
    let planted_utf8 = [
        b"junk\0".as_slice(),
        b"--remote-debugging-port=0",
        b"\0junk",
    ]
    .concat();
    let planted_utf16 = [
        b"junk\0\0".to_vec(),
        utf16le("--attach-url"),
        b"\0\0junk".to_vec(),
    ]
    .concat();
    assert_eq!(
        found_in(&text_of(&planted_utf8), &SMOKE_ONLY),
        vec!["remote-debugging-port"]
    );
    assert_eq!(
        found_in(&text_of(&planted_utf16), &SMOKE_ONLY),
        vec!["--attach-url"]
    );
    assert!(found_in(&text_of(b"nothing to see here\0\0"), &SMOKE_ONLY).is_empty());
}

#[test]
fn cargo_tree_lists_the_features_it_is_asked_for() {
    // The positive control: the check below would be worthless if `cargo tree -i` could not see the feature.
    assert!(
        cargo_tree(&["--no-default-features", "--features", "smoke"]).contains("feature \"smoke\"")
    );
    assert!(
        cargo_tree(&["--no-default-features", "--features", "measure"])
            .contains("feature \"measure\"")
    );
}

#[test]
fn the_release_features_show_no_smoke_or_measure() {
    let tree = cargo_tree(&[]);
    assert!(
        !tree.contains("\"smoke\"") && !tree.contains("\"measure\""),
        "the release feature set enables a test feature:\n{tree}"
    );
}

#[cfg(not(feature = "smoke"))]
#[test]
fn the_exe_has_no_debugging_port_and_no_test_switch() {
    let text = exe_text();
    let hits = found_in(&text, &SMOKE_ONLY);
    assert!(
        hits.is_empty(),
        "a non-smoke exe carries smoke-only strings: {hits:?}"
    );
    assert!(
        !text.contains(SMOKE_IDENTITY),
        "a non-smoke exe carries the smoke identity"
    );
    #[cfg(not(feature = "measure"))]
    assert!(
        !text.contains(MEASURE_IDENTITY),
        "the release exe carries the measure identity"
    );
    #[cfg(feature = "measure")]
    assert!(
        text.contains(MEASURE_IDENTITY),
        "the measure exe lacks its identity"
    );
}

#[cfg(feature = "smoke")]
#[test]
fn the_smoke_exe_does_carry_the_hooks() {
    let text = exe_text();
    let missing: Vec<&str> = SMOKE_ONLY
        .iter()
        .copied()
        .filter(|n| !text.contains(*n))
        .collect();
    assert!(
        missing.is_empty(),
        "the positive control failed, the scan does not see: {missing:?}"
    );
    assert!(text.contains(SMOKE_IDENTITY));
}
