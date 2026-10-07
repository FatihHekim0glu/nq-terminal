//! The window, its settings and the guards that run before anything else (03 sections 7.1, 10.5, 11.1, 12;
//! 04 D4.2; 02 C3-8 and C3-12; 05 X04).
//!
//! - `scrub_env` removes every `WEBVIEW2_*` variable first in main; `policy_check` (window_policy.rs) refuses to
//!   start when a WebView2 policy in HKCU or HKLM applies to this exe.
//! - `resolve` fixes the lab, the WebView2 data folder (created with a protected DACL, window_folders.rs) and the
//!   zoom before the window exists: the release from its settings file and, on first run, the lab picker; smoke from
//!   its switches; measure from `NQT_MEASURE_DIR` and the settings file in its config folder. Test builds never get a
//!   picker.
//! - `setup` refuses a missing or invalid lab, writes first-run settings, and installs the webview hooks: the bridge
//!   script, new windows denied except the attribution link (system browser; logged and mocked in test builds) and
//!   the browser update offer (logged only in test builds).
//! - `on_stale_dist` (window_rebuild.rs) shows rebuild.html and rebuilds the page in the release only after the
//!   explicit click.

#[path = "window_folders.rs"]
pub mod folders;
#[path = "window_policy.rs"]
pub mod policy;
#[path = "window_rebuild.rs"]
pub mod rebuild;
#[cfg(not(feature = "smoke"))]
#[path = "window_settings.rs"]
pub mod settings_file;
#[path = "window_start.rs"]
pub mod start;

#[cfg(any(test, feature = "measure"))]
use folders::check_test_folder;
use folders::{Tools, check_data_dir, check_lab};
pub use policy::policy_check;

use crate::dialogs::{self, Confirm};
use crate::{Launch, ShellError, TEST_BUILD, keys, writes};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Environment,
    ICoreWebView2NewWindowRequestedEventArgs,
};
use webview2_com::{
    AddScriptToExecuteOnDocumentCreatedCompletedHandler, NewBrowserVersionAvailableEventHandler,
    NewWindowRequestedEventHandler, take_pwstr,
};
use windows::core::{HSTRING, PWSTR};

/// The prefix of every WebView2 override variable (05 X04). The four the plan names are among them:
/// WEBVIEW2_BROWSER_EXECUTABLE_FOLDER, WEBVIEW2_USER_DATA_FOLDER, WEBVIEW2_RELEASE_CHANNEL_PREFERENCE and
/// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
pub const WEBVIEW2_PREFIX: &str = "WEBVIEW2_";
/// Default inner size in logical pixels when nothing is stored.
pub const DEFAULT_WIDTH: f64 = 1280.0;
pub const DEFAULT_HEIGHT: f64 = 800.0;
/// The settings file in the build identity's config folder (or the smoke `--config-dir`).
pub const SETTINGS_FILE: &str = "settings.json";
/// The measure build's one switch: an absolute run folder, normally under D:\dev (`wv` and `config` beneath it).
#[cfg(any(test, feature = "measure"))]
pub const MEASURE_DIR_VAR: &str = "NQT_MEASURE_DIR";
/// The proposed WebView2 data folder on this PC (O7), used when a D: drive exists.
#[cfg(any(test, not(any(feature = "smoke", feature = "measure"))))]
pub const PROPOSED_WEBVIEW_DIR: &str = r"D:\nq-terminal\webview";
#[cfg(not(any(feature = "smoke", feature = "measure")))]
const PICK_ATTEMPTS: usize = 5;
/// The one link that may leave the app (the chart library's attribution, 02 C3-12), opened in the system browser.
pub const ATTRIBUTION_URL: &str = "https://www.tradingview.com/";
const ATTRIBUTION_HOST: &str = "www.tradingview.com";
const ATTRIBUTION_QUERY: &str = "utm_medium=lwc-link&utm_campaign=lwc-chart";
/// The bridge version the shell object states. 2: the shell reports how each save ended (writes_download.rs). 3: it
/// also states whether the read-only IB snapshot is on in this session (`ibSnapshot`, for the Options switch).
pub const BRIDGE_VERSION: u32 = 3;

/// The shell object the page reads (03 section 4.5), frozen and not writable. `ib_snapshot` is the value in force for
/// this start (the settings read before the window was built); a change made with the switch applies at the next start.
pub fn shell_script(ib_snapshot: bool) -> String {
    format!(
        "(() => {{ if (window.top !== window) return; \
const shell = Object.freeze({{ bridgeVersion: {BRIDGE_VERSION}, platform: 'windows', keys: 'pc', ibSnapshot: {ib_snapshot} }}); \
Object.defineProperty(window, '__NQT_SHELL__', {{ value: shell, writable: false, configurable: false, enumerable: false }}); }})();"
    )
}

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
    /// The read-only IB snapshot checkbox (O10): the backend gets the switch and the IB names only when it is set.
    #[cfg_attr(
        feature = "smoke",
        allow(dead_code, reason = "a smoke build never turns the IB snapshot on")
    )]
    pub ib_snapshot: bool,
}

/// The shell's settings file (03 section 10.5): nothing the page can read or write.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub lab: Option<PathBuf>,
    pub webview_data_dir: Option<PathBuf>,
    pub zoom: u16,
    /// The read-only IB snapshot (O10), off unless the owner ticks it.
    pub ib_snapshot: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            lab: None,
            webview_data_dir: None,
            zoom: keys::ZOOM_DEFAULT,
            ib_snapshot: false,
        }
    }
}

struct Shell {
    settings: Settings,
    file: PathBuf,
    /// First-run choices not yet written (writes.rs is configured only after `resolve`).
    pending: bool,
    created_data_dir: bool,
}

static SHELL: OnceLock<Mutex<Option<Shell>>> = OnceLock::new();
static SAVING: Mutex<()> = Mutex::new(());

fn with_shell<T>(f: impl FnOnce(&mut Shell) -> T) -> Option<T> {
    let cell = SHELL.get_or_init(|| Mutex::new(None));
    let mut guard = cell
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.as_mut().map(f)
}

/// The settings in force (defaults before `resolve`).
pub fn settings() -> Settings {
    with_shell(|s| s.settings.clone()).unwrap_or_default()
}

/// The app zoom in force, on the 25% grid.
pub fn zoom_percent() -> u16 {
    keys::snap(settings().zoom)
}

/// Keeps a new zoom level and writes the settings file on a worker thread.
pub fn store_zoom(percent: u16) {
    if with_shell(|s| s.settings.zoom = keys::snap(percent)).is_some() {
        std::thread::spawn(save_settings);
    }
}

/// The stored read-only IB snapshot value (the next start's), or None before the settings are read.
pub fn ib_snapshot_stored() -> Option<bool> {
    with_shell(|s| s.settings.ib_snapshot)
}

/// The IB snapshot switch (ib_switch.rs, after the owner's native confirm): changes only `ib_snapshot` in the settings
/// and writes the file now, rotate first. The window options and the running backend keep the value they started with.
/// A test build never writes (its dialogs fail closed before this, and this refuses too); a failed write puts the old
/// value back in memory, so a later zoom save cannot write a value the owner was told was not saved.
pub fn store_ib_snapshot(on: bool) -> Result<(), String> {
    if TEST_BUILD {
        return Err("a test build never changes the IB snapshot setting".into());
    }
    let Some(before) = with_shell(|s| std::mem::replace(&mut s.settings.ib_snapshot, on)) else {
        return Err("no settings are loaded".into());
    };
    let written = write_settings();
    if written.is_err() {
        with_shell(|s| s.settings.ib_snapshot = before);
    }
    written
}

/// `write_settings` for a caller that only logs the outcome.
fn save_settings() {
    let _ = write_settings();
}

/// Writes the current settings through writes.rs: the old file moves to `settings.json.1` (rotate), then the new
/// one is written with `write_new`, so a crash in between leaves the old copy readable. One write at a time.
fn write_settings() -> Result<(), String> {
    let _one = SAVING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some((settings, file)) = with_shell(|s| (s.settings.clone(), s.file.clone())) else {
        return Err("no settings are loaded".into());
    };
    let result = serde_json::to_vec_pretty(&settings)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            writes::rotate(&file, 0, 1).map_err(|e| e.to_string())?;
            writes::write_new(&file, &bytes).map_err(|e| e.to_string())
        });
    let detail = json!({ "file": file.display().to_string(), "error": result.as_ref().err() });
    crate::crash::log("settings_saved", detail);
    result
}

/// Removes every `WEBVIEW2_*` variable from this process, so only the builder's settings reach the engine and
/// none is inherited by the backend child (05 X04). Returns the names removed.
///
/// Called first in `main`, before Tauri or anything else starts a thread: under edition 2024 `remove_var` is
/// unsafe because another thread could read the environment at the same time.
pub fn scrub_env() -> Vec<String> {
    let names = webview2_names();
    for name in &names {
        // SAFETY: main calls this before any other thread of the process exists, so nothing reads or writes the
        // environment concurrently.
        unsafe { std::env::remove_var(name) };
    }
    names
}

fn webview2_names() -> Vec<String> {
    std::env::vars_os()
        .filter_map(|(name, _)| name.into_string().ok())
        .filter(|name| name.to_ascii_uppercase().starts_with(WEBVIEW2_PREFIX))
        .collect()
}

/// The window's settings before it is built. Smoke builds take them from their switches; the measure build from
/// `NQT_MEASURE_DIR` and the settings file of its config folder; the release from the settings file of its identity,
/// asking for the lab and the WebView2 data folder on first run.
pub fn resolve(app: &AppHandle, launch: &Launch) -> Result<WindowOptions, ShellError> {
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "nq-lab terminal".to_string());
    #[cfg(feature = "smoke")]
    {
        smoke_options(&product, &launch.smoke)
    }
    #[cfg(feature = "measure")]
    {
        let _ = launch;
        let (wv, config) = measure_paths(std::env::var_os(MEASURE_DIR_VAR))?;
        let stored = settings_file::load(&config.join(SETTINGS_FILE))?.unwrap_or_default();
        let settings = Settings {
            webview_data_dir: Some(wv),
            ..stored
        };
        finish(&product, config, settings, false, None)
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        let _ = launch;
        release_options(app, &product)
    }
}

#[cfg(feature = "smoke")]
fn smoke_options(
    product: &str,
    s: &crate::smoke_options::SmokeOptions,
) -> Result<WindowOptions, ShellError> {
    let settings = Settings {
        lab: s.lab.clone(),
        webview_data_dir: Some(s.webview_data_dir.clone()),
        zoom: s.zoom.unwrap_or(keys::ZOOM_DEFAULT),
        ib_snapshot: false,
    };
    let size = s.size.map(|(w, h)| (f64::from(w), f64::from(h)));
    finish(product, s.config_dir.clone(), settings, false, size)
}

/// The measure run folder's `wv` and `config`. A missing or relative folder stops the start: a relative one would
/// land wherever the exe was launched from.
#[cfg(any(test, feature = "measure"))]
fn measure_paths(dir: Option<std::ffi::OsString>) -> Result<(PathBuf, PathBuf), ShellError> {
    let dir = PathBuf::from(dir.ok_or(ShellError::NotReady(
        "NQT_MEASURE_DIR names the measure run folder",
    ))?);
    check_test_folder(&dir, MEASURE_DIR_VAR)?;
    Ok((dir.join("wv"), dir.join("config")))
}

#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn release_options(app: &AppHandle, product: &str) -> Result<WindowOptions, ShellError> {
    let config_dir = app.path().app_config_dir().map_err(ShellError::from)?;
    let stored = settings_file::load(&config_dir.join(SETTINGS_FILE))?;
    let mut settings = stored.clone().unwrap_or_default();
    let tools = Tools::from_env();
    if settings
        .lab
        .as_deref()
        .is_none_or(|lab| check_lab(lab, &tools).is_err())
    {
        settings.lab = Some(pick_valid_lab(&tools)?);
    }
    let lab = settings.lab.clone();
    if settings
        .webview_data_dir
        .as_deref()
        .is_none_or(|dir| check_data_dir(dir, lab.as_deref()).is_err())
    {
        let fallback = app.path().app_local_data_dir().map_err(ShellError::from)?;
        settings.webview_data_dir = Some(choose_data_dir(&fallback, lab.as_deref())?);
    }
    let pending = stored.as_ref() != Some(&settings);
    finish(product, config_dir, settings, pending, None)
}

/// The lab picker until a folder passes the lab check (release only; test builds get no picker).
#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn pick_valid_lab(tools: &Tools) -> Result<PathBuf, ShellError> {
    let proposed = std::env::var_os("USERPROFILE")
        .map(|home| PathBuf::from(home).join("nq-lab"))
        .filter(|dir| dir.is_dir());
    for _ in 0..PICK_ATTEMPTS {
        let Some(dir) = dialogs::pick_lab(proposed.as_deref()) else {
            break;
        };
        match check_lab(&dir, tools) {
            Ok(()) => return Ok(dir),
            Err(refusal) => dialogs::folder_refused(&refusal.to_string()),
        }
    }
    Err(ShellError::Refused("no nq-lab folder was chosen".into()))
}

/// The WebView2 data folder: D:\nq-terminal\webview proposed when a D: drive exists (O7), else the identity's
/// local data folder.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn choose_data_dir(fallback: &Path, lab: Option<&Path>) -> Result<PathBuf, ShellError> {
    let proposed = if Path::new(r"D:\").is_dir() {
        PathBuf::from(PROPOSED_WEBVIEW_DIR)
    } else {
        fallback.join("webview")
    };
    for _ in 0..PICK_ATTEMPTS {
        let Some(dir) = dialogs::choose_webview_dir(&proposed) else {
            break;
        };
        match check_data_dir(&dir, lab) {
            Ok(()) => return Ok(dir),
            Err(e) => dialogs::folder_refused(&e.to_string()),
        }
    }
    Err(ShellError::Refused(
        "no folder was chosen for the page engine's data".into(),
    ))
}

fn finish(
    product: &str,
    config_dir: PathBuf,
    settings: Settings,
    pending: bool,
    size: Option<(f64, f64)>,
) -> Result<WindowOptions, ShellError> {
    let Some(webview_data_dir) = settings.webview_data_dir.clone() else {
        return Err(ShellError::Refused("no WebView2 data folder is set".into()));
    };
    check_data_dir(&webview_data_dir, settings.lab.as_deref())?;
    let created_data_dir = folders::ensure_data_dir(&webview_data_dir)?;
    let (width, height) = size.unwrap_or((DEFAULT_WIDTH, DEFAULT_HEIGHT));
    let options = WindowOptions {
        title: title_for(product, settings.lab.as_deref()),
        width,
        height,
        webview_data_dir,
        config_dir: config_dir.clone(),
        lab: settings.lab.clone(),
        ib_snapshot: settings.ib_snapshot,
    };
    let shell = Shell {
        settings,
        file: config_dir.join(SETTINGS_FILE),
        pending,
        created_data_dir,
    };
    let cell = SHELL.get_or_init(|| Mutex::new(None));
    *cell
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(shell);
    Ok(options)
}

/// The window title shows the lab path (04 D4.2 item 10).
pub fn title_for(product: &str, lab: Option<&Path>) -> String {
    match lab {
        Some(lab) => format!("{product} ({})", lab.display()),
        None => product.to_string(),
    }
}

/// Whether this start needs a lab: smoke with `--attach-url` loads a page server and needs none.
fn lab_needed(launch: &Launch) -> bool {
    #[cfg(feature = "smoke")]
    {
        launch.smoke.attach_url.is_none()
    }
    #[cfg(not(feature = "smoke"))]
    {
        let _ = launch;
        true
    }
}

/// A test build never gets a picker: a missing lab is a hard error with a log line; a lab given is checked as the
/// picker would.
fn check_lab_setting(lab: Option<&Path>, needed: bool) -> Result<(), ShellError> {
    match lab {
        None if needed => {
            crate::crash::log("lab_missing", json!({ "picker": !TEST_BUILD }));
            Err(ShellError::Refused(
                "no lab is set (smoke takes --lab, measure the settings file in its config folder)"
                    .into(),
            ))
        }
        None => Ok(()),
        Some(lab) => check_lab(lab, &Tools::from_env()).map_err(|refusal| {
            let detail = json!({ "lab": lab.display().to_string(), "missing": refusal.missing });
            crate::crash::log("lab_refused", detail);
            ShellError::Refused(refusal.to_string())
        }),
    }
}

/// Window setup once the window exists: the lab check, the environment check, first-run settings, and the webview
/// hooks (bridge script, new windows, browser update).
pub fn setup(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    // The settings were read before the log folder was known: write what that read found (AUD-7).
    #[cfg(not(feature = "smoke"))]
    settings_file::log_notes();
    let settings = settings();
    check_lab_setting(settings.lab.as_deref(), lab_needed(launch))?;
    let left = webview2_names();
    crate::crash::log("shell_env", json!({ "webview2_left": left }));
    if !left.is_empty() {
        return Err(ShellError::Refused(format!(
            "WEBVIEW2_ variables came back: {left:?}"
        )));
    }
    let (created, pending) = with_shell(|s| (s.created_data_dir, s.pending)).unwrap_or_default();
    let dir = settings.webview_data_dir.map(|d| d.display().to_string());
    crate::crash::log(
        "data_dir",
        json!({ "path": dir, "created": created, "protected": created }),
    );
    if pending && with_shell(|s| s.pending = false).is_some() {
        save_settings();
    }
    install_webview_hooks(window)
}

fn install_webview_hooks(window: &WebviewWindow) -> Result<(), ShellError> {
    let app = window.app_handle().clone();
    crate::guard::guarded("new_window", |report| {
        window.with_webview(move |webview| {
            let (controller, environment) = (webview.controller(), webview.environment());
            // SAFETY: COM calls on the controller and environment Tauri hands to this closure on the UI thread.
            let hooked = unsafe { webview_hooks(&controller, &environment, app) };
            match &hooked {
                Ok(()) => crate::crash::log(
                    "window_hooks",
                    json!({ "bridge_script": true, "new_windows": "denied", "attribution": ATTRIBUTION_URL }),
                ),
                Err(e) => {
                    crate::crash::log("window_hooks_failed", json!({ "error": e.to_string() }));
                }
            }
            let _ = report.send(hooked.map_err(|e| e.to_string()));
        })?;
        Ok(())
    })
}

/// SAFETY: call on the UI thread with a live controller and environment.
unsafe fn webview_hooks(
    controller: &ICoreWebView2Controller,
    environment: &ICoreWebView2Environment,
    app: AppHandle,
) -> windows::core::Result<()> {
    let script = HSTRING::from(shell_script(ib_in_force(&app)));
    let failing = app.clone();
    let script_done = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
        move |result, _id| {
            if let Some(refusal) = bridge_script_refusal(&result) {
                crate::crash::log("bridge_script_failed", json!({ "error": refusal }));
                end_without_bridge(&failing, refusal);
            }
            Ok(())
        },
    ));
    let opener = app.clone();
    let new_window = NewWindowRequestedEventHandler::create(Box::new(move |core, args| {
        on_new_window(core, args, &opener)
    }));
    let update = NewBrowserVersionAvailableEventHandler::create(Box::new(move |_, _| {
        on_browser_update(&app);
        Ok(())
    }));
    let mut token = 0i64;
    // SAFETY: the caller's contract; the handlers live as long as the webview holds them.
    unsafe {
        let core = controller.CoreWebView2()?;
        core.AddScriptToExecuteOnDocumentCreated(&script, &script_done)?;
        core.add_NewWindowRequested(&new_window, &mut token)?;
        environment.add_NewBrowserVersionAvailable(&update, &mut token)?;
    }
    Ok(())
}

/// The IB snapshot value in force for this start, as the shell object states it: the window options' (read from the
/// settings before the window was built, and what the backend's environment follows). A smoke build always says off.
fn ib_in_force(app: &AppHandle) -> bool {
    !cfg!(feature = "smoke")
        && app
            .try_state::<WindowOptions>()
            .is_some_and(|options| options.ib_snapshot)
}

/// The refusal text when the engine reports that the bridge script was not registered, or None when it was. The
/// registration completes asynchronously, after `webview_hooks` has returned, so a failure cannot refuse the setup
/// any more: the shell ends instead (fail closed), because a page without the bridge would run without the shell's
/// keys, zoom and download guards.
fn bridge_script_refusal<T>(result: &windows::core::Result<T>) -> Option<String> {
    result
        .as_ref()
        .err()
        .map(|e| format!("the page bridge could not be registered: {e}"))
}

/// Ends the shell after a failed bridge registration, off the UI thread (a dialog must not block the engine's own
/// callback). Test builds show no dialog and just end.
fn end_without_bridge(app: &AppHandle, refusal: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        dialogs::fatal(&refusal);
        app.exit(1);
    });
}

/// Whether a new-window request is the chart library's attribution link (https://www.tradingview.com/, with or
/// without the library's own query), and nothing that only looks like it.
pub fn is_attribution(uri: &str) -> bool {
    let Ok(url) = tauri::Url::parse(uri) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some(ATTRIBUTION_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.fragment().is_none()
        && url.query().is_none_or(|q| q.starts_with(ATTRIBUTION_QUERY))
}

/// Every new window is denied (Handled with no new window); the attribution link alone goes to the system
/// browser, always as the fixed address, never as the page's text.
fn on_new_window(
    _core: Option<ICoreWebView2>,
    args: Option<ICoreWebView2NewWindowRequestedEventArgs>,
    app: &AppHandle,
) -> windows::core::Result<()> {
    let Some(args) = args else {
        return Ok(());
    };
    let mut uri = PWSTR::null();
    // SAFETY: getters and a setter on the live event arguments, inside the handler on the UI thread.
    unsafe {
        args.SetHandled(true)?;
        args.Uri(&mut uri)?;
    }
    let uri = take_pwstr(uri);
    if is_attribution(&uri) {
        open_external(app);
    } else {
        let shown: String = uri.chars().take(200).collect();
        crate::crash::log("new_window_denied", json!({ "url": shown }));
    }
    Ok(())
}

/// Test builds: the system browser is mocked (logged, nothing launched).
#[cfg(any(feature = "smoke", feature = "measure"))]
fn open_external(app: &AppHandle) {
    let _ = app;
    crate::crash::log(
        "external_open",
        json!({ "url": ATTRIBUTION_URL, "mocked": true }),
    );
}

/// The release: the attribution address in the system browser, after the event handler has returned.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn open_external(app: &AppHandle) {
    let queued = app.run_on_main_thread(|| {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let url = HSTRING::from(ATTRIBUTION_URL);
        // SAFETY: a shell open of a constant https address with no parameters.
        let done = unsafe {
            ShellExecuteW(
                None,
                &HSTRING::from("open"),
                &url,
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        let ok = done.0 as isize > 32;
        crate::crash::log(
            "external_open",
            json!({ "url": ATTRIBUTION_URL, "mocked": false, "ok": ok }),
        );
    });
    if let Err(e) = queued {
        crate::crash::log("external_open_failed", json!({ "error": e.to_string() }));
    }
}

/// A new WebView2 runtime is ready: the release offers a restart (off the UI thread); test builds log it only.
fn on_browser_update(app: &AppHandle) {
    crate::crash::log(
        "browser_update_available",
        json!({ "offered": !TEST_BUILD }),
    );
    if TEST_BUILD {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.get_webview_window(crate::MAIN_LABEL);
        if dialogs::browser_update_restart(main.as_ref()) == Confirm::Proceed {
            app.request_restart();
        }
    });
}

/// Page-load hook of the main window (the load event, not a painted frame: nothing here can observe first paint in
/// a smoke or measure build): the zoom is applied again on each page, and the window becomes visible once
/// the splash has loaded, in the release only.
pub fn on_page_load(window: WebviewWindow, payload: PageLoadPayload<'_>) {
    let event = match payload.event() {
        PageLoadEvent::Started => "page_started",
        PageLoadEvent::Finished => "page_finished",
    };
    crate::crash::log(event, json!({ "url": payload.url().as_str() }));
    if matches!(payload.event(), PageLoadEvent::Started) {
        let zoom = zoom_percent();
        if zoom != keys::ZOOM_DEFAULT
            && let Err(e) = window.set_zoom(keys::factor(zoom))
        {
            crate::crash::log("zoom_failed", json!({ "error": e.to_string() }));
        }
    }
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
    if start::this_start() == start::Reveal::Minimised {
        match reveal_minimised(window) {
            Ok(maximised) => {
                start::mark_pending();
                let detail = json!({ "minimised": true, "restore_maximised": maximised });
                crate::crash::log("window_revealed", detail);
                return;
            }
            // A window left hidden would be lost: fall back to the ordinary show.
            Err(e) => crate::crash::log("show_minimised_failed", json!({ "error": e })),
        }
    }
    #[allow(
        clippy::disallowed_methods,
        reason = "the one sanctioned show(), release only"
    )]
    let shown = window.show();
    if let Err(e) = shown {
        crate::crash::log("show_failed", json!({ "error": e.to_string() }));
    }
}

/// The release reveal of a minimised start (window_start.rs): the window's own placement set to minimised without
/// activation, so tao's show (which applies a saved maximised state with SW_MAXIMIZE and takes the focus) is not used.
/// A saved maximised state comes back when the owner restores the window. Ok(whether it restores maximised).
#[cfg(not(any(feature = "smoke", feature = "measure")))]
#[allow(
    clippy::disallowed_methods,
    reason = "release only: the minimised start's reveal, shown minimised and never activated"
)]
fn reveal_minimised(window: &WebviewWindow) -> Result<bool, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SW_SHOWMINNOACTIVE, SetWindowPlacement, WINDOWPLACEMENT,
    };
    let maximised = window.is_maximized().unwrap_or(false);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    // SAFETY: reads and sets the placement of this process's own live window with a correctly sized structure.
    unsafe {
        GetWindowPlacement(hwnd, &mut placement).map_err(|e| e.to_string())?;
        placement.showCmd = SW_SHOWMINNOACTIVE.0 as u32;
        placement.flags = start::placement_flags(placement.flags, maximised);
        SetWindowPlacement(hwnd, &placement).map_err(|e| e.to_string())?;
    }
    // The minimise message has just made tao read "not maximised"; the window-state plugin would save that at close.
    start::keep_maximised_flag(hwnd, maximised);
    Ok(maximised)
}

#[cfg(any(feature = "smoke", feature = "measure"))]
fn reveal(_window: &WebviewWindow) {
    const _: () = assert!(crate::TEST_BUILD);
}

/// A second launch after a minimised start (release only): the window was put on screen outside tao, so it is
/// restored natively first and only then shown through tao (whose own restore would hide a window tao thinks hidden).
#[cfg(not(any(feature = "smoke", feature = "measure")))]
#[allow(
    clippy::disallowed_methods,
    reason = "release only (single-instance plugin): restores the window a minimised start revealed, for focus_existing"
)]
fn restore_minimised_start(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{IsIconic, SW_RESTORE, ShowWindow};
    if let Ok(hwnd) = window.hwnd() {
        // SAFETY: plain calls on this process's own live window.
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
        }
    }
    let shown = window.show();
    if let Err(e) = shown {
        crate::crash::log("show_failed", json!({ "error": e.to_string() }));
    }
}

#[cfg(any(feature = "smoke", feature = "measure"))]
#[allow(
    dead_code,
    reason = "called only by the release's single-instance plugin, through focus_existing"
)]
fn restore_minimised_start(_window: &WebviewWindow) {
    const _: () = assert!(crate::TEST_BUILD);
}

/// A second launch (release only, single-instance plugin): bring the existing window forward if it is showing;
/// its arguments are ignored (02 C3-12).
#[cfg_attr(
    any(feature = "smoke", feature = "measure"),
    allow(
        dead_code,
        reason = "called only by the release's single-instance plugin"
    )
)]
pub fn focus_existing(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(crate::MAIN_LABEL)
        && window.is_visible().unwrap_or(false)
    {
        if start::take_pending() {
            restore_minimised_start(&window);
        }
        #[allow(
            clippy::disallowed_methods,
            reason = "release only (single-instance plugin): the second launch restores the window that is already showing"
        )]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod tests;
