//! Test hooks (03 sections 15.4 and 17; 04 D4.5). `browser_args` and every other switch exist only in smoke builds
//! (the release gets Tauri's default engine switches and no debugging port); `after_build` serves smoke and measure
//! and does nothing in the release. `tests/smoke_feature_absent.rs` builds without the feature and checks that none
//! of it is in the exe.
//!
//! Smoke builds implement the frozen `SmokeOptions` (smoke_options.rs):
//!
//! - `remote_debugging_port` (default 0) and a fixed device scale factor become engine switches in `browser_args`,
//!   beside Tauri's own defaults (re-added as ONE `--disable-features` list: the engine keeps only the last copy of
//!   a repeated switch, W0A). The real port is the first line of `<webview_data_dir>\EBWebView\DevToolsActivePort`;
//!   the harness reads it there, and `after_build` also logs it (`devtools_port`) once the engine has written it;
//! - `zoom` is applied to the page in `after_build`, `size` is logged as the window's real inner size and scale
//!   factor (window.rs builds the window at that size), `screen2` places and shows the window through the guarded
//!   helper in smoke_screen2.rs;
//! - `fixture`, `attach_url`, `state_dir` and `save_dir` are read by supervise.rs, writes.rs and crash.rs through the
//!   accessors below, so each switch has one place that decides what it means;
//! - the controller is made visible behind the hidden window (W0A P0: the page then runs at the display rate with
//!   no window on screen; the three Chromium fallback switches are not needed).
//!
//! Under smoke and measure `show()` is never called. The only thing that can show the window is `--screen2`, and
//! it shows it on the non-primary monitor, inside its work area, without activation, after the guard.
#![allow(
    dead_code,
    reason = "the accessors are read by supervise.rs, writes.rs and main.rs when those slices are merged (04 D4)"
)]

use crate::{Launch, ShellError};
use tauri::WebviewWindow;

#[cfg(feature = "smoke")]
#[path = "smoke_screen2.rs"]
mod screen2;

/// Tauri's own engine switches (wry 0.57), which `additional_browser_args` replaces. They must be re-added as ONE
/// `--disable-features` list: the engine keeps only the last copy of a repeated switch (W0A).
pub const TAURI_DEFAULT_FEATURES: &str = "msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// Fixes CSS pixels to device pixels, so the debugging harness measures at a known scale.
pub const SCALE_SWITCH: &str = "--force-device-scale-factor=1";
/// Where the engine writes its debugging port, below the profile folder.
pub const DEVTOOLS_PORT_FILE: [&str; 2] = ["EBWebView", "DevToolsActivePort"];

/// The engine switches of a smoke build: the debugging port (0 lets the engine pick one and write
/// DevToolsActivePort in the profile folder), the fixed scale factor and Tauri's defaults.
#[cfg(feature = "smoke")]
pub fn browser_args(launch: &Launch) -> Option<String> {
    let port = launch.smoke.remote_debugging_port;
    Some(format!(
        "--remote-debugging-port={port} {SCALE_SWITCH} --disable-features={TAURI_DEFAULT_FEATURES}"
    ))
}

/// No extra switch outside smoke: the release and measure builds keep Tauri's defaults and have no debugging port.
#[cfg(not(feature = "smoke"))]
pub fn browser_args(launch: &Launch) -> Option<String> {
    let _ = launch;
    None
}

/// `--state-dir`: the backend's state folder instead of `<lab>/terminal/state`.
#[cfg(feature = "smoke")]
pub fn state_dir(launch: &Launch) -> Option<&std::path::Path> {
    launch.smoke.state_dir.as_deref()
}

/// `--save-dir`: where downloads and the diagnostics zip land, with no save dialog.
#[cfg(feature = "smoke")]
pub fn save_dir(launch: &Launch) -> Option<&std::path::Path> {
    launch.smoke.save_dir.as_deref()
}

/// `--fixture`: start the fixture backend through the full handshake.
#[cfg(feature = "smoke")]
pub fn fixture(launch: &Launch) -> bool {
    launch.smoke.fixture
}

/// `--attach-url`: a page server that is already running, with no backend and no handshake.
#[cfg(feature = "smoke")]
pub fn attach_url(launch: &Launch) -> Option<&str> {
    launch.smoke.attach_url.as_deref()
}

/// The folders the write module allows beside the config folder: smoke's `--save-dir` (downloads and the diagnostics
/// zip) and `--state-dir` (the backend's log goes there), and none in any other build (the release adds the folder
/// the owner picks in a save dialog; its backend log lives in the lab's state folder). main.rs hands this to
/// `writes::configure`.
#[cfg(feature = "smoke")]
pub fn save_dirs(launch: &Launch) -> Vec<std::path::PathBuf> {
    let (save, state) = (&launch.smoke.save_dir, &launch.smoke.state_dir);
    save.iter().chain(state.iter()).cloned().collect()
}

#[cfg(not(feature = "smoke"))]
pub const fn save_dirs(launch: &Launch) -> Vec<std::path::PathBuf> {
    let _ = launch;
    Vec::new()
}

/// The file the engine writes its debugging port to.
pub fn devtools_port_file(webview_data_dir: &std::path::Path) -> std::path::PathBuf {
    DEVTOOLS_PORT_FILE
        .iter()
        .fold(webview_data_dir.to_path_buf(), |dir, part| dir.join(part))
}

/// The port on the first line of DevToolsActivePort. Zero and anything that is not a port give None.
pub fn parse_devtools_port(text: &str) -> Option<u16> {
    text.lines()
        .next()?
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
}

/// Every switch of the run, for the first lines of the shell log.
#[cfg(feature = "smoke")]
pub fn options_record(launch: &Launch) -> serde_json::Value {
    let s = &launch.smoke;
    serde_json::json!({
        "fixture": s.fixture,
        "attach_url": s.attach_url,
        "state_dir": s.state_dir,
        "save_dir": s.save_dir,
        "lab": s.lab,
        "webview_data_dir": s.webview_data_dir,
        "config_dir": s.config_dir,
        "zoom": s.zoom,
        "size": s.size,
        "remote_debugging_port": s.remote_debugging_port,
        "screen2": s.screen2,
    })
}

/// Smoke: the page's zoom, the real window size and the optional screen 2 placement, each reported in the log.
#[cfg(feature = "smoke")]
fn apply_smoke_options(window: &WebviewWindow, launch: &Launch) {
    use crate::crash::log;
    use serde_json::json;
    log("smoke_options", options_record(launch));
    if let Some(percent) = launch.smoke.zoom {
        let applied = window.set_zoom(f64::from(percent) / 100.0);
        log(
            "smoke_zoom",
            json!({ "percent": percent, "applied": applied.is_ok(), "error": applied.err().map(|e| e.to_string()) }),
        );
    }
    log("smoke_window", window_record(window));
    watch_devtools_port(&launch.smoke.webview_data_dir);
    if launch.smoke.screen2 {
        log("smoke_screen2", place_on_screen2(window));
        log("smoke_window", window_record(window));
    }
}

#[cfg(feature = "smoke")]
fn window_record(window: &WebviewWindow) -> serde_json::Value {
    let size = window.inner_size().ok();
    serde_json::json!({
        "inner_physical": size.map(|s| [s.width, s.height]),
        "scale_factor": window.scale_factor().ok(),
        "visible": window.is_visible().ok(),
    })
}

/// The guarded show on screen 2. A refusal leaves the window hidden and is logged with its reason.
#[cfg(feature = "smoke")]
fn place_on_screen2(window: &WebviewWindow) -> serde_json::Value {
    use serde_json::json;
    let hwnd = match window.hwnd() {
        Ok(handle) => windows::Win32::Foundation::HWND(handle.0),
        Err(e) => return json!({ "shown": false, "refused": e.to_string() }),
    };
    match screen2::show_guarded(hwnd, screen2::ANCHOR) {
        Ok(frame) => json!({
            "shown": true,
            "frame": [frame.left, frame.top, frame.right, frame.bottom],
        }),
        Err(refusal) => json!({ "shown": false, "refused": refusal.to_string() }),
    }
}

/// How long the engine gets to write DevToolsActivePort, and how often it is looked for.
#[cfg(feature = "smoke")]
const PORT_WAIT: std::time::Duration = std::time::Duration::from_secs(60);
#[cfg(feature = "smoke")]
const PORT_POLL: std::time::Duration = std::time::Duration::from_millis(200);

/// Logs the real debugging port once the engine has written it. The file is two short lines, so reads.rs's tail
/// reader is the sanctioned way to look at it.
#[cfg(feature = "smoke")]
fn watch_devtools_port(webview_data_dir: &std::path::Path) {
    let file = devtools_port_file(webview_data_dir);
    let spawned = std::thread::Builder::new()
        .name("nqt-devtools-port".into())
        .spawn(move || {
            let started = std::time::Instant::now();
            while started.elapsed() < PORT_WAIT {
                let text = crate::reads::read_log_tail(&file, 64)
                    .ok()
                    .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
                if let Some(port) = text.as_deref().and_then(parse_devtools_port) {
                    crate::crash::log("devtools_port", serde_json::json!({ "port": port }));
                    return;
                }
                std::thread::sleep(PORT_POLL);
            }
            crate::crash::log("devtools_port_missing", serde_json::json!({ "file": file }));
        });
    if let Err(e) = spawned {
        crate::crash::log(
            "devtools_port_watch_failed",
            serde_json::json!({ "error": e.to_string() }),
        );
    }
}

/// Smoke and measure: make the WebView2 controller visible behind the hidden window, so the page runs at the
/// display rate with nothing on screen. Smoke then applies its options. `show()` is never called here.
#[cfg(any(feature = "smoke", feature = "measure"))]
pub fn after_build(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    window.with_webview(|webview| {
        let controller = webview.controller();
        // SAFETY: a COM call on the controller Tauri hands to this closure on the UI thread, while it is alive.
        let set = unsafe { controller.SetIsVisible(true) };
        if let Err(e) = set {
            crate::crash::log(
                "controller_visible_failed",
                serde_json::json!({ "error": e.to_string() }),
            );
        } else {
            crate::crash::log("controller_visible", serde_json::json!({}));
        }
    })?;
    #[cfg(feature = "smoke")]
    apply_smoke_options(window, launch);
    #[cfg(not(feature = "smoke"))]
    let _ = launch;
    Ok(())
}

/// The release shows its window once ready (window.rs) and needs nothing here.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
pub fn after_build(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}

#[cfg(test)]
mod common_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn the_port_file_sits_in_the_engine_folder() {
        assert_eq!(
            devtools_port_file(Path::new(r"D:\run\wv")),
            PathBuf::from(r"D:\run\wv\EBWebView\DevToolsActivePort")
        );
    }

    #[test]
    fn the_port_is_the_first_line_and_never_zero() {
        assert_eq!(
            parse_devtools_port("9352\n/devtools/browser/abc"),
            Some(9352)
        );
        assert_eq!(parse_devtools_port("  41234  \r\nx"), Some(41234));
        for bad in ["", "0\nx", "x\n9", "70000\n", "-1\n"] {
            assert_eq!(parse_devtools_port(bad), None, "accepted {bad:?}");
        }
    }

    #[test]
    fn no_save_folder_outside_smoke() {
        #[cfg(not(feature = "smoke"))]
        assert!(
            save_dirs(&Launch {
                scrubbed: Vec::new()
            })
            .is_empty()
        );
    }
}

#[cfg(all(test, feature = "smoke"))]
mod tests {
    use super::*;

    fn launch() -> Launch {
        Launch {
            scrubbed: Vec::new(),
            smoke: crate::smoke_options::SmokeOptions::for_tests(),
        }
    }

    #[test]
    fn smoke_args_carry_the_port_the_scale_switch_and_one_merged_feature_list() {
        let mut launch = launch();
        let args = browser_args(&launch).expect("smoke builds pass switches");
        assert_eq!(
            args,
            "--remote-debugging-port=0 --force-device-scale-factor=1 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
        assert_eq!(args.matches("--disable-features").count(), 1);
        launch.smoke.remote_debugging_port = 9352;
        assert!(
            browser_args(&launch).is_some_and(|a| a.starts_with("--remote-debugging-port=9352 "))
        );
    }

    #[test]
    fn every_option_has_an_accessor_and_a_log_field() {
        let mut launch = launch();
        launch.smoke.fixture = true;
        launch.smoke.state_dir = Some(r"D:\s".into());
        launch.smoke.save_dir = Some(r"D:\o".into());
        assert!(fixture(&launch));
        assert_eq!(state_dir(&launch), Some(std::path::Path::new(r"D:\s")));
        assert_eq!(save_dir(&launch), Some(std::path::Path::new(r"D:\o")));
        // The write module allows the save folder and the state folder (the backend's log goes there).
        let both = vec![r"D:\o".into(), r"D:\s".into()];
        assert_eq!(save_dirs(&launch), both as Vec<std::path::PathBuf>);
        assert_eq!(attach_url(&launch), None);
        let record = options_record(&launch);
        for field in [
            "fixture",
            "attach_url",
            "state_dir",
            "save_dir",
            "lab",
            "webview_data_dir",
            "config_dir",
            "zoom",
            "size",
            "remote_debugging_port",
            "screen2",
        ] {
            assert!(record.get(field).is_some(), "the log record lacks {field}");
        }
    }
}

#[cfg(all(test, not(feature = "smoke")))]
mod tests {
    use super::*;

    #[test]
    fn no_switch_outside_smoke() {
        let launch = Launch {
            scrubbed: Vec::new(),
        };
        assert_eq!(browser_args(&launch), None);
    }
}
