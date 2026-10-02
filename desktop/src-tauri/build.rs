//! Build script: the build identity, and Tauri's resources with ONE combined manifest (W0A P4).
//!
//! Identity. A build with the `smoke` or `measure` feature carries that identity's configuration file
//! (`tauri.smoke.conf.json`, `tauri.measure.conf.json`) as Tauri's `TAURI_CONFIG` merge, both for tauri-build here
//! and for `generate_context!` in main.rs, so even a plain `cargo build --features smoke` gets the smoke identifier,
//! never the release one. `cargo tauri build --config <file>` passes the same file, so the two routes agree.
//!
//! Manifest. On the GNU host, gcc links MinGW's own `default-manifest.o` (asInvoker plus longPathAware) through its
//! `endfile` spec, beside the manifest tauri-build embeds, and ld prints `.rsrc merge failure: multiple non-default
//! manifests`; Windows then honours only the first leaf. The fix carried over from the probe: the combined manifest
//! `windows/app.manifest` (Common-Controls 6.0, PerMonitorV2, true/pm, asInvoker) given to tauri-build, and an empty
//! COFF object named `default-manifest.o` that gcc finds first through its `-B` prefix, so the link holds exactly
//! one manifest and prints no warning. `desktop/scripts/check.ps1` greps the build log and reads the exe with
//! `pe-info.mjs` to prove both.
#![allow(
    clippy::disallowed_methods,
    reason = "build-time reads of the crate's own files and output into OUT_DIR, never part of the shipped shell"
)]

use std::path::PathBuf;

/// A COFF object with no sections and no symbols: an x86-64 IMAGE_FILE_HEADER and nothing else.
const EMPTY_COFF_X64: [u8; 20] = [
    0x64, 0x86, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const IDENTITY_FILES: [&str; 3] = [
    "tauri.conf.json",
    "tauri.smoke.conf.json",
    "tauri.measure.conf.json",
];

fn shadow_mingw_default_manifest() -> Result<(), String> {
    let out = std::env::var("OUT_DIR").map_err(|e| format!("OUT_DIR: {e}"))?;
    let dir = PathBuf::from(out).join("nodefman");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let object = dir.join("default-manifest.o");
    std::fs::write(&object, EMPTY_COFF_X64).map_err(|e| format!("{}: {e}", object.display()))?;
    let prefix = format!("{}/", dir.display().to_string().replace('\\', "/"));
    println!("cargo:rustc-link-arg-bins=-B{prefix}");
    Ok(())
}

/// The identity file of a test build, if this is one.
fn test_identity() -> Option<&'static str> {
    let smoke = std::env::var_os("CARGO_FEATURE_SMOKE").is_some();
    let measure = std::env::var_os("CARGO_FEATURE_MEASURE").is_some();
    match (smoke, measure) {
        (true, false) => Some(IDENTITY_FILES[1]),
        (false, true) => Some(IDENTITY_FILES[2]),
        _ => None,
    }
}

/// Hands a test identity's configuration to tauri-build (this process) and to generate_context! (rustc).
fn apply_test_identity(file: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
    // JSON needs no line breaks between tokens and these files have none inside strings, so one line is the same
    // document, as a `cargo:rustc-env` line requires.
    let line: String = text
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect();
    // SAFETY: a build script is single-threaded at this point; nothing else reads the environment concurrently.
    unsafe { std::env::set_var("TAURI_CONFIG", &line) };
    println!("cargo:rustc-env=TAURI_CONFIG={line}");
    Ok(())
}

fn main() {
    println!("cargo:rerun-if-changed=windows/app.manifest");
    for file in IDENTITY_FILES {
        println!("cargo:rerun-if-changed={file}");
    }
    if let Some(file) = test_identity()
        && let Err(e) = apply_test_identity(file)
    {
        panic!("cannot apply the test identity: {e}");
    }
    let gnu = std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|env| env == "gnu");
    if gnu && let Err(e) = shadow_mingw_default_manifest() {
        panic!("cannot shadow MinGW's default manifest: {e}");
    }
    let windows =
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows/app.manifest"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    if let Err(e) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {e:#}");
    }
}
