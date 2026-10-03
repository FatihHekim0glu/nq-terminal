//! DownloadStarting with a deferral (W0A P2). The handler takes the deferral and returns at once; a worker thread
//! asks for the path (the smoke `--save-dir`, else the save dialog through dialogs.rs) and checks it with `choose`;
//! back on the UI thread the event gets `put_ResultFilePath`, `put_Handled(TRUE)` and `Complete`, or
//! `put_Cancel(TRUE)` on a refusal or a cancel. After DownloadCompleted the file is checked again by handle and
//! deleted if refused. The profile's default download folder is moved under the config folder, so a download that
//! skipped the handler cannot land in the Downloads folder on C:.
//!
//! The page is told how each save ended (bridgeVersion 2, web/src/bridge/browser.ts): one `nqt:save-outcome` event on
//! its window, `detail: { uri, outcome }`, where `uri` is the download's own address (the object URL of the link the
//! page clicked) and `outcome` is `saved` (the engine finished and the file passed its check), `cancelled` (no path:
//! the dialog was cancelled, or a test build had no save folder) or `failed` (the policy refused the path, the write was
//! interrupted or the saved file failed its check and was deleted). The shell calls the page; the page calls nothing.

use crate::save_outcome::{NO_PATH, outcome_script, refusal_outcome};
use crate::{Launch, ShellError};
use serde_json::json;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_DOWNLOAD_STATE, COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED as COMPLETED,
    COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED as INTERRUPTED, ICoreWebView2_4, ICoreWebView2_13,
    ICoreWebView2Controller, ICoreWebView2Deferral, ICoreWebView2DownloadOperation as Operation,
    ICoreWebView2DownloadStartingEventArgs as Args,
};
use webview2_com::{DownloadStartingEventHandler, StateChangedEventHandler, take_pwstr};
use windows::core::{HSTRING, Interface, PWSTR};

const BACKSTOP_DIR: &str = "downloads";
const FALLBACK_NAME: &str = "download";

thread_local! {
    /// Downloads waiting for their decision, kept on the UI thread (COM objects are not Send).
    static PENDING: RefCell<HashMap<u64, Waiting>> = RefCell::new(HashMap::new());
    static NEXT_ID: Cell<u64> = const { Cell::new(1) };
}

/// A download between its start and the decision: the event arguments, the deferral and the download's address.
struct Waiting {
    args: Args,
    deferral: ICoreWebView2Deferral,
    uri: String,
}

/// Tells the main window's page how the save of `uri` ended; logged either way.
fn report(app: &AppHandle, uri: &str, outcome: &str) {
    let told = app
        .get_webview_window(crate::MAIN_LABEL)
        .map(|window| window.eval(outcome_script(uri, outcome)));
    let error = told.and_then(Result::err).map(|e| e.to_string());
    log(
        "download_outcome",
        json!({ "uri": uri, "outcome": outcome, "told_error": error }),
    );
}

fn log(event: &str, detail: serde_json::Value) {
    crate::crash::log(event, detail);
}

/// The smoke `--save-dir`; `None` in the release, where the save dialog answers.
fn save_dir(launch: &Launch) -> Option<PathBuf> {
    #[cfg(feature = "smoke")]
    return launch.smoke.save_dir.clone();
    #[cfg(not(feature = "smoke"))]
    {
        let _ = launch;
        None
    }
}

/// Registers the handler on the window's webview (runs on the UI thread through with_webview).
pub fn on_download_starting(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let (dir, app) = (save_dir(launch), window.app_handle().clone());
    let backstop = super::POLICY.get().map(|p| p.config_dir.join(BACKSTOP_DIR));
    crate::guard::guarded("download", |report| {
        window.with_webview(move |webview| {
            // SAFETY: COM calls on the controller Tauri hands to this closure on the UI thread, while it is alive.
            let installed =
                unsafe { install(&webview.controller(), dir, app, backstop.as_deref()) };
            let error = installed.as_ref().err().map(|e| e.to_string());
            log("download_hook", json!({ "error": error }));
            let _ = report.send(installed.map_err(|e| e.to_string()));
        })?;
        Ok(())
    })
}

unsafe fn install(
    controller: &ICoreWebView2Controller,
    dir: Option<PathBuf>,
    app: AppHandle,
    backstop: Option<&Path>,
) -> windows::core::Result<()> {
    // SAFETY: COM calls on live interfaces on the UI thread.
    let core = unsafe { controller.CoreWebView2()? };
    // SAFETY (both closures): COM calls on live interfaces on the UI thread, run before `install` returns.
    let guard = || unsafe {
        let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
            args.map_or(Ok(()), |args| starting(&args, dir.clone(), &app))
        }));
        core.cast::<ICoreWebView2_4>()?
            .add_DownloadStarting(&handler, &mut 0i64)
    };
    let folder = || unsafe {
        let Some(backstop) = backstop else {
            return Ok(());
        };
        let made = super::global().and_then(|p| p.make_parents(&backstop.join(FALLBACK_NAME)));
        if made.is_err() {
            return Ok(());
        }
        let profile = core.cast::<ICoreWebView2_13>()?.Profile()?;
        profile.SetDefaultDownloadFolderPath(&HSTRING::from(backstop.as_os_str()))
    };
    let skipped = super::install_guard_first(guard, folder)?;
    if let Some(why) = skipped {
        log("download_backstop_skipped", json!({ "error": why }));
    }
    Ok(())
}

/// The DownloadStarting handler: take the deferral, hand the decision to a worker thread, return at once.
fn starting(args: &Args, dir: Option<PathBuf>, app: &AppHandle) -> windows::core::Result<()> {
    let mut proposed = PWSTR::null();
    // SAFETY: COM calls on the live event arguments on the UI thread; take_pwstr frees the string.
    let (proposed, deferral, uri) = unsafe {
        args.ResultFilePath(&mut proposed)?;
        (take_pwstr(proposed), args.GetDeferral()?, uri_of(args))
    };
    let name = Path::new(&proposed)
        .file_name()
        .map_or(FALLBACK_NAME.into(), |n| n.to_string_lossy().into_owned());
    let id = NEXT_ID.with(|n| n.replace(n.get() + 1));
    let waiting = Waiting {
        args: args.clone(),
        deferral,
        uri: uri.clone(),
    };
    PENDING.with(|p| p.borrow_mut().insert(id, waiting));
    log(
        "download_starting",
        json!({ "id": id, "name": name, "uri": uri }),
    );
    let (app, app_for_error) = (app.clone(), app.clone());
    let spawned = std::thread::Builder::new()
        .name("download-decision".into())
        .spawn(move || decide(id, &name, dir, &app));
    if let Err(e) = spawned {
        complete(id, Err(format!("no worker thread: {e}")), &app_for_error);
    }
    Ok(())
}

/// The download's own address (for a page's save, the object URL of its link); empty when the engine gives none.
unsafe fn uri_of(args: &Args) -> String {
    let mut uri = PWSTR::null();
    // SAFETY: COM calls on the live event arguments on the UI thread; take_pwstr frees the string.
    unsafe {
        match args.DownloadOperation().and_then(|op| op.Uri(&mut uri)) {
            Ok(()) => take_pwstr(uri),
            Err(_) => String::new(),
        }
    }
}

/// Off the UI thread: the save path (`--save-dir` or the dialog) and the policy's answer.
fn decide(id: u64, name: &str, dir: Option<PathBuf>, app: &AppHandle) {
    let picked = match dir {
        Some(dir) => Some(dir.join(name)),
        None => crate::dialogs::save_download(name),
    };
    let decision = match picked {
        Some(path) => super::choose(&path).map_err(|e| e.to_string()),
        None => Err(NO_PATH.to_string()),
    };
    let on_main = app.clone();
    if let Err(e) = app.run_on_main_thread(move || complete(id, decision, &on_main)) {
        let detail = json!({ "id": id, "error": e.to_string() });
        log("download_undecided", detail);
    }
}

/// Back on the UI thread: set the checked path, or cancel; then complete the deferral.
fn complete(id: u64, decision: Result<PathBuf, String>, app: &AppHandle) {
    let Some(Waiting {
        args,
        deferral,
        uri,
    }) = PENDING.with(|p| p.borrow_mut().remove(&id))
    else {
        return;
    };
    // SAFETY: COM calls on the event arguments and deferral kept alive in PENDING, on the UI thread; a path that
    // could not be set is cancelled.
    let (finished, completed) = unsafe {
        let finished = finish(&args, &decision, app, &uri);
        if finished.is_err() {
            let _ = args.SetCancel(true);
        }
        (finished, deferral.Complete())
    };
    let event = match (&decision, &finished) {
        (Ok(_), Ok(())) => "download_allowed",
        _ => "download_refused",
    };
    let errors = [
        finished.as_ref().err().map(ToString::to_string),
        completed.err().map(|e| e.to_string()),
    ];
    let detail = json!({ "id": id, "decision": format!("{decision:?}"), "errors": errors });
    log(event, detail);
    // A save that goes on is reported when the engine finishes it (see `watch`); every other end is known now.
    match (&decision, &finished) {
        (Err(reason), _) => report(app, &uri, refusal_outcome(reason)),
        (Ok(_), Err(_)) => report(app, &uri, "failed"),
        (Ok(_), Ok(())) => {}
    }
}

unsafe fn finish(
    args: &Args,
    decision: &Result<PathBuf, String>,
    app: &AppHandle,
    uri: &str,
) -> windows::core::Result<()> {
    // SAFETY: COM calls on live event arguments on the UI thread.
    unsafe {
        let Ok(path) = decision else {
            args.SetCancel(true)?;
            return args.SetHandled(true);
        };
        args.SetResultFilePath(&HSTRING::from(path.as_os_str()))?;
        args.SetHandled(true)?;
        watch(
            &args.DownloadOperation()?,
            path.clone(),
            app.clone(),
            uri.to_owned(),
        )
    }
}

/// After the engine finishes: the written file is checked again by handle and deleted if refused.
unsafe fn watch(
    op: &Operation,
    chosen: PathBuf,
    app: AppHandle,
    uri: String,
) -> windows::core::Result<()> {
    let handler = StateChangedEventHandler::create(Box::new(move |op, _| {
        let Some(op) = op else { return Ok(()) };
        let (mut state, mut written) = (COREWEBVIEW2_DOWNLOAD_STATE::default(), PWSTR::null());
        // SAFETY: COM calls on the live operation on the UI thread; take_pwstr frees the string.
        let written = unsafe {
            op.State(&mut state)?;
            op.ResultFilePath(&mut written)?;
            PathBuf::from(take_pwstr(written))
        };
        if state == COMPLETED {
            let checked = super::verify_download(&written, &chosen);
            let detail = json!({ "path": written, "check": format!("{checked:?}") });
            let event = if checked.is_ok() {
                "download_saved"
            } else {
                "download_deleted"
            };
            log(event, detail);
            report(&app, &uri, if checked.is_ok() { "saved" } else { "failed" });
        } else if state == INTERRUPTED {
            log("download_interrupted", json!({ "path": written }));
            report(&app, &uri, "failed");
        }
        Ok(())
    }));
    // SAFETY: COM call on the live operation on the UI thread.
    unsafe { op.add_StateChanged(&handler, &mut 0i64) }
}
