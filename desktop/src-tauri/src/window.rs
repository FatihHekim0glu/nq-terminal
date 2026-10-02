//! The window, its settings and the guards that run before anything else (03 sections 7.1, 11.1, 12; 04 D4.2).
//!
//! STAGE A: `scrub_env` is complete; the rest are stubs with their final signatures. Stage B (slice
//! w4b-window-keys) fills the lab picker, the settings file, the WebView2 data folder with its protected DACL, the
//! policy check over HKCU and HKLM, the title with the lab path, the new-window rule and the bridge script, without
//! changing a signature.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError};
use std::fmt;
use std::path::PathBuf;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, WebviewWindow};

/// The prefix of every WebView2 override variable (05 X04). The four the plan names are among them:
/// WEBVIEW2_BROWSER_EXECUTABLE_FOLDER, WEBVIEW2_USER_DATA_FOLDER, WEBVIEW2_RELEASE_CHANNEL_PREFERENCE and
/// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
pub const WEBVIEW2_PREFIX: &str = "WEBVIEW2_";
/// Default inner size in logical pixels when nothing is stored.
pub const DEFAULT_WIDTH: f64 = 1280.0;
pub const DEFAULT_HEIGHT: f64 = 800.0;
/// The settings file in the build identity's config folder (or the smoke `--config-dir`).
pub const SETTINGS_FILE: &str = "settings.json";
/// The measure build's one switch: an absolute run folder, normally under D:\dev. The measure exe takes no argument
/// and has no picker, so without this its WebView2 profile and shell settings would fall to the identity's folders
/// on C:. Read once, in `resolve`, and compiled into the measure build only.
pub const MEASURE_DIR_VAR: &str = "NQT_MEASURE_DIR";

/// Everything the window builder needs before the window exists.
#[derive(Clone, Debug)]
pub struct WindowOptions {
    pub title: String,
    pub width: f64,
    pub height: f64,
    /// The WebView2 profile folder, never left to Tauri's default on C: (03 section 7.1).
    pub webview_data_dir: PathBuf,
    /// The shell's own settings and logs.
    pub config_dir: PathBuf,
    /// The picked lab, once known.
    pub lab: Option<PathBuf>,
    /// The app zoom in percent (50 to 300).
    pub zoom_percent: u16,
}

/// A WebView2 policy value that applies to this exe, so the shell refuses to start.
#[derive(Debug)]
pub struct PolicyRefusal {
    pub hive: &'static str,
    pub value: String,
}

impl fmt::Display for PolicyRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "a WebView2 policy in {} sets {} for this app, so it will not start",
            self.hive, self.value
        )
    }
}

/// Removes every `WEBVIEW2_*` variable from this process, so only the builder's settings reach the engine and
/// none is inherited by the backend child (05 X04). Returns the names removed.
///
/// Called first in `main`, before Tauri or anything else starts a thread: under edition 2024 `remove_var` is
/// unsafe because another thread could read the environment at the same time.
pub fn scrub_env() -> Vec<String> {
    let names: Vec<String> = std::env::vars_os()
        .filter_map(|(name, _)| name.into_string().ok())
        .filter(|name| name.to_ascii_uppercase().starts_with(WEBVIEW2_PREFIX))
        .collect();
    for name in &names {
        // SAFETY: main calls this before any other thread of the process exists, so nothing reads or writes the
        // environment concurrently.
        unsafe { std::env::remove_var(name) };
    }
    names
}

/// Refuses to start when a WebView2 policy (HKCU or HKLM `Software\Policies\Microsoft\Edge\WebView2`) sets
/// AdditionalBrowserArguments, BrowserExecutableFolder, ReleaseChannelPreference or UserDataFolder for this exe or
/// for '*'. STUB: allows every start until stage B reads the two hives.
pub fn policy_check() -> Result<(), PolicyRefusal> {
    Ok(())
}

/// The window's settings before it is built. Smoke builds take them from their switches; the measure build takes
/// them from `NQT_MEASURE_DIR` (`wv` and `config` beneath it); the release reads the settings file of its identity.
/// STUB: no picker yet, so a release without a settings file stops with a message (stage B adds the picker; smoke
/// and measure never get one).
pub fn resolve(app: &AppHandle, launch: &Launch) -> Result<WindowOptions, ShellError> {
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "nq-lab terminal".to_string());
    #[cfg(feature = "smoke")]
    {
        let _ = app;
        let s = &launch.smoke;
        let (width, height) = s.size.map_or((DEFAULT_WIDTH, DEFAULT_HEIGHT), |(w, h)| {
            (f64::from(w), f64::from(h))
        });
        Ok(WindowOptions {
            title: product,
            width,
            height,
            webview_data_dir: s.webview_data_dir.clone(),
            config_dir: s.config_dir.clone(),
            lab: s.lab.clone(),
            zoom_percent: s.zoom.unwrap_or(100),
        })
    }
    #[cfg(feature = "measure")]
    {
        let _ = (app, launch);
        measure_options(product, std::env::var_os(MEASURE_DIR_VAR))
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        let _ = (launch, product);
        let config_dir = app.path().app_config_dir().map_err(ShellError::from)?;
        match crate::reads::read_settings(&config_dir.join(SETTINGS_FILE)) {
            Ok(Some(_)) => Err(ShellError::NotReady(
                "reading the settings file comes in stage B",
            )),
            Ok(None) => Err(ShellError::NotReady(
                "the lab and the WebView2 data folder are not chosen yet",
            )),
            Err(e) => Err(ShellError::Io(e.to_string())),
        }
    }
}

/// The measure build's window settings from the value of `NQT_MEASURE_DIR`. A missing or relative folder stops the
/// start: a relative one would land wherever the exe was launched from.
#[cfg(feature = "measure")]
fn measure_options(
    title: String,
    dir: Option<std::ffi::OsString>,
) -> Result<WindowOptions, ShellError> {
    let dir = PathBuf::from(dir.ok_or(ShellError::NotReady(
        "NQT_MEASURE_DIR names the measure run folder",
    ))?);
    if !dir.is_absolute() {
        return Err(ShellError::Refused(format!(
            "{MEASURE_DIR_VAR} must be an absolute path"
        )));
    }
    Ok(WindowOptions {
        title,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        webview_data_dir: dir.join("wv"),
        config_dir: dir.join("config"),
        lab: None,
        zoom_percent: 100,
    })
}

/// Window setup once the window exists: title with the lab path, new windows denied except the attribution link,
/// the bridge script, the zoom restored. STUB.
pub fn setup(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}

/// Page-load hook of the main window. The window becomes visible once the splash has loaded, in the release only.
pub fn on_page_load(window: WebviewWindow, payload: PageLoadPayload<'_>) {
    let event = match payload.event() {
        PageLoadEvent::Started => "page_started",
        PageLoadEvent::Finished => "page_finished",
    };
    crate::crash::log(event, serde_json::json!({ "url": payload.url().as_str() }));
    if matches!(payload.event(), PageLoadEvent::Finished) {
        reveal(&window);
    }
}

/// Shows the window the owner just started. The only `show()` in the crate, compiled only into
/// the release: under smoke and measure this function does nothing, so no test or measurement run can ever put
/// the window on screen (04 standing rule 4).
#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn reveal(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(true) {
        return;
    }
    #[allow(
        clippy::disallowed_methods,
        reason = "the one sanctioned show(), release only"
    )]
    let shown = window.show();
    if let Err(e) = shown {
        crate::crash::log("show_failed", serde_json::json!({ "error": e.to_string() }));
    }
}

#[cfg(any(feature = "smoke", feature = "measure"))]
fn reveal(_window: &WebviewWindow) {
    const _: () = assert!(crate::TEST_BUILD);
}

/// A second launch (release only, single-instance plugin): bring the existing window forward if it is showing;
/// its arguments are ignored (02 C3-12).
pub fn focus_existing(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(crate::MAIN_LABEL)
        && window.is_visible().unwrap_or(false)
    {
        #[allow(
            clippy::disallowed_methods,
            reason = "release only (single-instance plugin): the second launch restores the window that is already showing"
        )]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "measure")]
    #[test]
    fn measure_needs_an_absolute_run_folder() {
        let title = || "measure".to_string();
        assert!(matches!(
            measure_options(title(), None),
            Err(ShellError::NotReady(_))
        ));
        assert!(matches!(
            measure_options(title(), Some("runs\\one".into())),
            Err(ShellError::Refused(_))
        ));
    }

    #[cfg(feature = "measure")]
    #[test]
    fn measure_puts_profile_and_config_under_the_run_folder() {
        let dir = std::env::temp_dir().join("nqt-measure-run");
        let options = measure_options("measure".into(), Some(dir.clone().into()))
            .expect("an absolute folder is accepted");
        assert_eq!(options.webview_data_dir, dir.join("wv"));
        assert_eq!(options.config_dir, dir.join("config"));
        assert_eq!(options.lab, None);
    }

    #[test]
    fn policy_refusal_names_the_hive() {
        let r = PolicyRefusal {
            hive: "HKLM",
            value: "AdditionalBrowserArguments".into(),
        };
        assert!(r.to_string().contains("HKLM"));
    }
}
