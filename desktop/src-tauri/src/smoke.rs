//! Test hooks (03 sections 15.4 and 17; 04 D4.5). `browser_args` exists only in smoke builds (the release gets
//! Tauri's default engine switches and no debugging port); `after_build` serves smoke and measure, and does nothing
//! in the release.
//!
//! STAGE A: the debugging port with Tauri's defaults re-added, and the controller made visible behind the hidden
//! window (W0A P0: a visible controller gives a running page with no window on screen, so the three Chromium
//! fallback switches are not needed). Stage B (slice w4b-crash-smoke) adds `--force-device-scale-factor=1`, the
//! DevToolsActivePort read-back, the zoom and size switches and the optional screen 2 placement, behind the frozen
//! SmokeOptions.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError};
use tauri::WebviewWindow;

/// Tauri's own engine switches (wry 0.57), which `additional_browser_args` replaces. They must be re-added as ONE
/// `--disable-features` list: the engine keeps only the last copy of a repeated switch (W0A).
pub const TAURI_DEFAULT_FEATURES: &str = "msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// The engine switches of a smoke build: the debugging port (0 lets the engine pick one and write
/// DevToolsActivePort in the profile folder) plus Tauri's defaults.
#[cfg(feature = "smoke")]
pub fn browser_args(launch: &Launch) -> Option<String> {
    let port = launch.smoke.remote_debugging_port;
    Some(format!(
        "--remote-debugging-port={port} --disable-features={TAURI_DEFAULT_FEATURES}"
    ))
}

/// No extra switch outside smoke: the release and measure builds keep Tauri's defaults and have no debugging port.
#[cfg(not(feature = "smoke"))]
pub fn browser_args(launch: &Launch) -> Option<String> {
    let _ = launch;
    None
}

/// Smoke and measure: make the WebView2 controller visible behind the hidden window, so the page runs at the
/// display rate with nothing on screen. `show()` is never called here.
#[cfg(any(feature = "smoke", feature = "measure"))]
pub fn after_build(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = launch;
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
    Ok(())
}

/// The release shows its window once ready (window.rs) and needs nothing here.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
pub fn after_build(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}

#[cfg(all(test, feature = "smoke"))]
mod tests {
    use super::*;

    #[test]
    fn smoke_args_carry_the_port_and_one_merged_feature_list() {
        let mut launch = Launch {
            scrubbed: Vec::new(),
            smoke: crate::smoke_options::SmokeOptions::for_tests(),
        };
        let args = browser_args(&launch).expect("smoke builds pass switches");
        assert_eq!(
            args,
            "--remote-debugging-port=0 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
        assert_eq!(args.matches("--disable-features").count(), 1);
        launch.smoke.remote_debugging_port = 9352;
        assert!(
            browser_args(&launch).is_some_and(|a| a.starts_with("--remote-debugging-port=9352 "))
        );
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
