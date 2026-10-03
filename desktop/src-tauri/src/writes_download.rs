//! DownloadStarting with a deferral (W0A P2). The handler takes the deferral and returns at once; a worker thread
//! asks for the path (the smoke `--save-dir`, else the save dialog through dialogs.rs) and checks it with `choose`;
//! back on the UI thread the event gets `put_ResultFilePath`, `put_Handled(TRUE)` and `Complete`, or
//! `put_Cancel(TRUE)` on a refusal or a cancel. After DownloadCompleted the file is checked again by handle and
//! deleted if refused. The profile's default download folder is moved under the config folder, so a download that
//! skipped the handler cannot land in the Downloads folder on C:.

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
const NO_PATH: &str = "no save path: the dialog was cancelled, or a test build had no save folder";

thread_local! {
    /// Downloads waiting for their decision, kept on the UI thread (COM objects are not Send).
    static PENDING: RefCell<HashMap<u64, (Args, ICoreWebView2Deferral)>> = RefCell::new(HashMap::new());
    static NEXT_ID: Cell<u64> = const { Cell::new(1) };
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
    let (proposed, deferral) = unsafe {
        args.ResultFilePath(&mut proposed)?;
        (take_pwstr(proposed), args.GetDeferral()?)
    };
    let name = Path::new(&proposed)
        .file_name()
        .map_or(FALLBACK_NAME.into(), |n| n.to_string_lossy().into_owned());
    let id = NEXT_ID.with(|n| n.replace(n.get() + 1));
    PENDING.with(|p| p.borrow_mut().insert(id, (args.clone(), deferral)));
    log("download_starting", json!({ "id": id, "name": name }));
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("download-decision".into())
        .spawn(move || decide(id, &name, dir, &app));
    if let Err(e) = spawned {
        complete(id, Err(format!("no worker thread: {e}")));
    }
    Ok(())
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
    if let Err(e) = app.run_on_main_thread(move || complete(id, decision)) {
        let detail = json!({ "id": id, "error": e.to_string() });
        log("download_undecided", detail);
    }
}

/// Back on the UI thread: set the checked path, or cancel; then complete the deferral.
fn complete(id: u64, decision: Result<PathBuf, String>) {
    let Some((args, deferral)) = PENDING.with(|p| p.borrow_mut().remove(&id)) else {
        return;
    };
    // SAFETY: COM calls on the event arguments and deferral kept alive in PENDING, on the UI thread; a path that
    // could not be set is cancelled.
    let (finished, completed) = unsafe {
        let finished = finish(&args, &decision);
        if finished.is_err() {
            let _ = args.SetCancel(true);
        }
        (finished, deferral.Complete())
    };
    let event = match (&decision, &finished) {
        (Ok(_), Ok(())) => "download_allowed",
        _ => "download_refused",
    };
    let errors = [finished.err(), completed.err()].map(|e| e.map(|e| e.to_string()));
    let detail = json!({ "id": id, "decision": format!("{decision:?}"), "errors": errors });
    log(event, detail);
}

unsafe fn finish(args: &Args, decision: &Result<PathBuf, String>) -> windows::core::Result<()> {
    // SAFETY: COM calls on live event arguments on the UI thread.
    unsafe {
        let Ok(path) = decision else {
            args.SetCancel(true)?;
            return args.SetHandled(true);
        };
        args.SetResultFilePath(&HSTRING::from(path.as_os_str()))?;
        args.SetHandled(true)?;
        watch(&args.DownloadOperation()?, path.clone())
    }
}

/// After the engine finishes: the written file is checked again by handle and deleted if refused.
unsafe fn watch(op: &Operation, chosen: PathBuf) -> windows::core::Result<()> {
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
        } else if state == INTERRUPTED {
            log("download_interrupted", json!({ "path": written }));
        }
        Ok(())
    }));
    // SAFETY: COM call on the live operation on the UI thread.
    unsafe { op.add_StateChanged(&handler, &mut 0i64) }
}
