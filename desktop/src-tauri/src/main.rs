//! nq-lab terminal: the Windows shell (03 sections 2 and 3; 04 D4).
//!
//! One framed window, hidden and unfocused until the splash is ready, over the page the lab's own backend serves.
//! The page gets no shell command (capabilities/main.json grants nothing). Every builder hook below is called in
//! the order 04 D4.1 fixes, each into the module that owns it, so a stage B slice never needs to edit this file:
//!
//! 1. `window::scrub_env` first, before any thread exists (edition 2024 makes `remove_var` unsafe);
//! 2. `window::policy_check`;
//! 3. `keys::install`, 4. `window::setup`, 5. `supervise::start` (with the stale-page hook of stale_page.rs),
//!    6. `writes::on_download_starting`, 7. `crash::install` on the built window;
//! 8. `smoke::browser_args`, which can only take effect on the window builder, so it is evaluated just before the
//!    build;
//! 9. `smoke::after_build` last.
//!
//! Every window event first passes through `memory_target::on_window_event` (the WebView2 memory target: Low while
//! the window is minimised or hidden, Normal otherwise).
//!
//! Build identities: the release (`dev.nqlab.terminal`), the smoke test build (`--no-default-features --features
//! smoke`, `dev.nqlab.terminal.smoke`) and the measure build (`--no-default-features --features measure`,
//! `dev.nqlab.terminal.measure`). build.rs merges the test identity's file over tauri.conf.json, so a plain
//! `cargo build` with a test feature already carries the test identity. Under smoke and measure the window's `show()` is never called
//! and no native dialog opens.
#![windows_subsystem = "windows"]

#[cfg(all(feature = "smoke", feature = "measure"))]
compile_error!("smoke and measure are separate builds: enable at most one of them");

mod crash;
mod dialogs;
mod flush;
mod guard;
mod keys;
mod link;
mod memory_target;
mod reads;
mod save_outcome;
mod smoke;
#[cfg(feature = "smoke")]
mod smoke_options;
mod stale_page;
mod supervise;
mod window;
mod window_fit;
mod writes;

use serde_json::json;
use std::fmt;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Wry};

/// The label of the one window.
pub const MAIN_LABEL: &str = "main";
/// The bundled splash page (assets/), shown until the backend's page is ready.
pub const SPLASH_PAGE: &str = "splash.html";
/// Minimum inner size in logical pixels (O12); window_fit.rs lowers it on a display too small for it.
pub const MIN_WIDTH: f64 = 1024.0;
pub const MIN_HEIGHT: f64 = 640.0;
/// A test build: smoke or measure. Native dialogs fail closed and `show()` is never called.
pub const TEST_BUILD: bool = cfg!(any(feature = "smoke", feature = "measure"));
/// Whether this build registers the single-instance and window-state plugins (the release only).
pub const RELEASE_PLUGINS: bool = cfg!(all(
    feature = "shell-plugins",
    not(any(feature = "smoke", feature = "measure"))
));

// A test build never registers the release plugins, and the release always does: checked at compile time.
const _: () = assert!(!(TEST_BUILD && RELEASE_PLUGINS));
const _: () = assert!(TEST_BUILD || RELEASE_PLUGINS || !cfg!(feature = "shell-plugins"));

/// Exit codes for a start that never reaches the event loop.
const EXIT_POLICY: i32 = 3;
const EXIT_USAGE: i32 = 2;
const EXIT_RUN: i32 = 1;

/// An error that stops a shell step, with words fit for the log and a dialog.
#[derive(Debug)]
pub enum ShellError {
    /// A guard refused the step.
    Refused(String),
    /// A file or process operation failed.
    Io(String),
    /// Tauri or the webview failed.
    Tauri(String),
    /// A part that stage B fills is not there yet.
    NotReady(&'static str),
}

impl fmt::Display for ShellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(why) => write!(f, "refused: {why}"),
            Self::Io(why) => write!(f, "input or output failed: {why}"),
            Self::Tauri(why) => write!(f, "the window failed: {why}"),
            Self::NotReady(what) => write!(f, "not ready: {what}"),
        }
    }
}

impl std::error::Error for ShellError {}

impl From<tauri::Error> for ShellError {
    fn from(e: tauri::Error) -> Self {
        Self::Tauri(e.to_string())
    }
}

/// What this process was started to do, fixed before the event loop starts and managed as app state.
pub struct Launch {
    /// The `WEBVIEW2_*` names removed from this process by `window::scrub_env`.
    pub scrubbed: Vec<String>,
    /// The test switches. They exist only in smoke builds.
    #[cfg(feature = "smoke")]
    pub smoke: smoke_options::SmokeOptions,
}

impl Launch {
    /// Reads the command line. The release and measure builds take no argument at all (a second launch's
    /// arguments are ignored too); the smoke build parses the frozen `SmokeOptions` switches.
    fn from_process(scrubbed: Vec<String>) -> Result<Self, ShellError> {
        #[cfg(feature = "smoke")]
        {
            let smoke = smoke_options::parse(std::env::args_os().skip(1))
                .map_err(|e| ShellError::Refused(e.to_string()))?;
            Ok(Self { scrubbed, smoke })
        }
        #[cfg(not(feature = "smoke"))]
        {
            Ok(Self { scrubbed })
        }
    }

    /// The stale-page rebuild runs package install scripts, so it is never allowed in a test build.
    pub const fn rebuild_allowed(&self) -> bool {
        !TEST_BUILD
    }
}

/// The build identity's configuration: tauri.conf.json, with the smoke or measure file merged over it by build.rs
/// (TAURI_CONFIG) in a test build.
fn context() -> tauri::Context<Wry> {
    tauri::generate_context!()
}

/// The release plugins: a second launch focuses the first window and its arguments are ignored (02 C3-12); the
/// window's size and position come back, never its visibility (the window stays hidden until ready).
#[cfg(all(
    feature = "shell-plugins",
    not(any(feature = "smoke", feature = "measure"))
))]
fn release_plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    use tauri_plugin_window_state::StateFlags;
    let restored = StateFlags::all() - StateFlags::VISIBLE;
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::focus_existing(app)
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(restored)
                .build(),
        )
}

#[cfg(not(all(
    feature = "shell-plugins",
    not(any(feature = "smoke", feature = "measure"))
)))]
fn release_plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
}

/// The first line of the shell log: which identity and which test hooks this process runs with.
fn start_record(app: &tauri::App, launch: &Launch) -> serde_json::Value {
    json!({
        "identifier": app.config().identifier,
        "product": app.config().product_name,
        "pid": std::process::id(),
        "release_plugins": RELEASE_PLUGINS,
        "test_build": TEST_BUILD,
        "smoke": cfg!(feature = "smoke"),
        "measure": cfg!(feature = "measure"),
        "devtools": cfg!(feature = "smoke"),
        "scrubbed": launch.scrubbed,
    })
}

fn setup(app: &mut tauri::App, launch: Launch) -> Result<(), ShellError> {
    let options = window::resolve(app.handle(), &launch)?;
    app.manage(options.clone());
    writes::configure(writes::WritePolicy {
        lab: options.lab.clone(),
        config_dir: options.config_dir.clone(),
        save_dirs: smoke::save_dirs(&launch),
    })
    .map_err(|e| ShellError::Refused(e.to_string()))?;
    crash::set_log_dir(&options.config_dir);
    crash::log("start", start_record(app, &launch));
    let fitted = fitted_size(app, &options);
    #[allow(
        clippy::disallowed_methods,
        reason = "the one window build: visible(false), the window is revealed only by window::reveal in the release"
    )]
    let mut builder =
        WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App(SPLASH_PAGE.into()))
            .title(&options.title)
            .inner_size(fitted.width, fitted.height)
            .min_inner_size(fitted.min_width, fitted.min_height)
            .decorations(true)
            .visible(false)
            .focused(false)
            .devtools(cfg!(feature = "smoke"))
            .zoom_hotkeys_enabled(false)
            .data_directory(options.webview_data_dir.clone())
            .on_page_load(window::on_page_load);
    if let Some(args) = smoke::browser_args(&launch) {
        builder = builder.additional_browser_args(&args);
    }
    let main = builder.build()?;
    window_fit::refit(&main);
    keys::install(&main, &launch)?;
    window::setup(&main, &launch)?;
    let rebuild_log = options.config_dir.join(crash::LOG_DIR).join("rebuild.log");
    let stale = options
        .lab
        .clone()
        .map(|lab| stale_page::hook(&main, launch.rebuild_allowed(), lab, rebuild_log));
    let supervisor = supervise::start(&main, &launch, stale)?;
    writes::on_download_starting(&main, &launch)?;
    crash::install(&main, &launch)?;
    smoke::after_build(&main, &launch)?;
    app.manage(supervisor);
    app.manage(launch);
    Ok(())
}

/// The window sizes for the display it opens on (window_fit.rs); a test build keeps its exact sizes.
fn fitted_size(app: &tauri::App, options: &window::WindowOptions) -> window_fit::Fit {
    let want = (options.width, options.height);
    if TEST_BUILD {
        return window_fit::Fit::unclamped(want);
    }
    window_fit::initial(app.primary_monitor().ok().flatten().as_ref(), want)
}

/// A refused setup: the log line, the fatal dialog (fail closed in a test build), and the exit code. It must be
/// handled inside the setup hook, because Tauri 2.12 turns an error returned from the hook into a panic (app.rs),
/// which under the release's `panic = "abort"` and the windows subsystem would end the start with no word at all.
fn setup_failed(error: &ShellError) -> i32 {
    crash::log("setup_failed", json!({ "error": error.to_string() }));
    dialogs::fatal(&error.to_string());
    EXIT_RUN
}

fn main() {
    let scrubbed = window::scrub_env();
    if let Err(refusal) = window::policy_check() {
        dialogs::policy_refused(&refusal.to_string());
        std::process::exit(EXIT_POLICY);
    }
    let launch = match Launch::from_process(scrubbed) {
        Ok(launch) => launch,
        Err(e) => {
            dialogs::fatal(&e.to_string());
            std::process::exit(EXIT_USAGE);
        }
    };
    let builder = release_plugins(tauri::Builder::default());
    let built = builder
        .setup(move |app| {
            if let Err(e) = setup(app, launch) {
                std::process::exit(setup_failed(&e));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            memory_target::on_window_event(window, event);
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == MAIN_LABEL
                && !close_may_go_on(window.app_handle())
            {
                api.prevent_close();
            }
        })
        .build(context());
    match built {
        Ok(app) => app.run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let _ = shutdown_backend(app);
            }
        }),
        Err(e) => {
            crash::log("run_failed", json!({ "error": e.to_string() }));
            dialogs::fatal(&e.to_string());
            std::process::exit(EXIT_RUN);
        }
    }
}

/// A close request of the main window (03 section 2.3): the first one is held while the page's pending changes go to
/// the store (flush.rs), which closes the window again when it is done; that second request asks about a running
/// backtest and ends the backend. False keeps the window.
fn close_may_go_on(app: &tauri::AppHandle) -> bool {
    if let Some(main) = app.get_webview_window(MAIN_LABEL)
        && flush::on_close(&main) != flush::OnClose::Proceed
    {
        return false;
    }
    flush::rearm();
    shutdown_backend(app).is_ok()
}

/// Ends the backend this shell started (03 section 2.3): asks first when a backtest runs (Err keeps the window), then
/// closes its stdin, waits up to five seconds and ends the job. An attached backend is never touched.
fn shutdown_backend(app: &tauri::AppHandle) -> Result<(), ShellError> {
    match app.try_state::<supervise::shell::Supervisor>() {
        Some(supervisor) => supervisor.shutdown(app.get_webview_window(MAIN_LABEL).as_ref()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuild_is_refused_in_test_builds() {
        let launch = Launch {
            scrubbed: Vec::new(),
            #[cfg(feature = "smoke")]
            smoke: smoke_options::SmokeOptions::for_tests(),
        };
        assert_eq!(launch.rebuild_allowed(), !TEST_BUILD);
    }
}
