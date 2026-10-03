//! Every native dialog of the shell, and the only module that calls rfd (04 D4.2 item 14).
//!
//! Under smoke and measure every entry point FAILS CLOSED: it opens nothing, logs `dialog_refused` with its name and
//! returns the safe answer (Quit, Cancel or no path), so no automated run can ever put a dialog on screen. In the
//! release each one is a plain native dialog. They block, so callers on the UI thread hand them to a worker thread
//! (window.rs does for the browser update offer and the rebuild confirm).
//!
//! Entry points: the lab picker (`pick_lab`), the lab refusal (`folder_refused`), the WebView2 data folder choice
//! (`choose_webview_dir`), the policy refusal (`policy_refused`), the fatal stop (`fatal`), Restart or Quit
//! (`restart_or_quit`), the close confirm (`confirm_close_running_job`), the browser update (`browser_update_restart`),
//! the rebuild confirm (`confirm_rebuild`), the reload offer for a page that never painted (`offer_reload`) and the
//! two save dialogs (`save_diagnostics`, `save_download`).

#![allow(
    dead_code,
    reason = "each build uses a different part: the release picks and asks, the test builds fail closed, and the download dialog belongs to the non-test download handler; the unit test calls every entry point"
)]
use crate::TEST_BUILD;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{Runtime, WebviewWindow};

const TITLE: &str = "nq-lab terminal";

/// The window a dialog belongs to. A dialog with an owner is modal to it, opens in front of it and takes the focus
/// from it, so it cannot sit behind the app while the page says it is waiting for an answer. `None` is for the
/// dialogs that open before the main window exists (the lab picker, the setup refusals, the fatal stop) and for the
/// unit test, which has no window.
pub type Owner<'a, R> = Option<&'a WebviewWindow<R>>;

/// The two custom buttons of a question in the order they are drawn: the first one is the dialog's default (what
/// Enter answers). A destructive question puts Cancel first, so a stray Enter or Space never confirms it.
fn button_order<'a>(yes: &'a str, no: &'a str, cancel_default: bool) -> (&'a str, &'a str) {
    if cancel_default { (no, yes) } else { (yes, no) }
}

/// The answer to the "backend stopped" dialog after three crashes in 60 s.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RestartOrQuit {
    Restart,
    Quit,
}

/// The answer to a yes-or-cancel question.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Confirm {
    Proceed,
    Cancel,
}

fn refused(dialog: &str) {
    crate::crash::log(
        "dialog_refused",
        json!({ "dialog": dialog, "reason": "test build: dialogs fail closed" }),
    );
}

#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn message(level: rfd::MessageLevel, text: &str) {
    rfd::MessageDialog::new()
        .set_title(TITLE)
        .set_level(level)
        .set_description(text)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn ask<R: Runtime>(
    owner: Owner<'_, R>,
    text: &str,
    (yes, no): (&str, &str),
    cancel_default: bool,
) -> bool {
    let (first, second) = button_order(yes, no, cancel_default);
    let buttons = rfd::MessageButtons::OkCancelCustom(first.to_string(), second.to_string());
    let dialog = rfd::MessageDialog::new()
        .set_title(TITLE)
        .set_level(rfd::MessageLevel::Warning)
        .set_description(text)
        .set_buttons(buttons);
    let dialog = match owner {
        Some(window) => dialog.set_parent(window),
        None => dialog,
    };
    let answer = dialog.show();
    answer == rfd::MessageDialogResult::Custom(yes.to_string())
}

#[cfg(not(any(feature = "smoke", feature = "measure")))]
fn pick_folder(title: &str, start: Option<&Path>) -> Option<PathBuf> {
    let dialog = rfd::FileDialog::new().set_title(title);
    let dialog = match start {
        Some(dir) => dialog.set_directory(dir),
        None => dialog,
    };
    dialog.pick_folder()
}

/// The first-run lab picker, opening at `proposed` (`%USERPROFILE%\nq-lab` when it exists). Test builds: no path
/// (smoke takes `--lab`, measure its settings file).
pub fn pick_lab(proposed: Option<&Path>) -> Option<PathBuf> {
    if TEST_BUILD {
        refused("pick_lab");
        return None;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        pick_folder("Choose the nq-lab folder", proposed)
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = proposed;
        None
    }
}

/// The picked folder cannot be used (not a lab, or no place for the page engine's data); `text` says why. The
/// picker opens again afterwards.
pub fn folder_refused(text: &str) {
    show_error("folder_refused", text);
}

/// Where the page engine keeps its data: `proposed` (D:\nq-terminal\webview on this PC, O7), or a folder the
/// owner picks instead. Test builds: no path (smoke takes `--webview-data-dir`, measure its run folder).
pub fn choose_webview_dir(proposed: &Path) -> Option<PathBuf> {
    if TEST_BUILD {
        refused("choose_webview_dir");
        return None;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        let text = format!(
            "The page engine keeps its data in a folder of its own. Use {}?",
            proposed.display()
        );
        if ask(
            None::<&WebviewWindow>,
            &text,
            ("Use this folder", "Choose another"),
            false,
        ) {
            return Some(proposed.to_path_buf());
        }
        pick_folder("Choose a folder for the page engine's data", None)
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = proposed;
        None
    }
}

/// A WebView2 policy applies to this app, so it will not start.
pub fn policy_refused(text: &str) {
    show_error("policy_refused", text);
}

fn show_error(dialog: &str, text: &str) {
    if TEST_BUILD {
        refused(dialog);
        eprintln!("{text}");
    } else {
        #[cfg(not(any(feature = "smoke", feature = "measure")))]
        message(rfd::MessageLevel::Error, text);
    }
}

/// The shell cannot go on.
pub fn fatal(text: &str) {
    show_error("fatal", text);
}

/// Three backend crashes within 60 s. Test builds: Quit.
pub fn restart_or_quit<R: Runtime>(owner: Owner<'_, R>, log_path: &Path) -> RestartOrQuit {
    if TEST_BUILD {
        refused("restart_or_quit");
        return RestartOrQuit::Quit;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        let text = format!(
            "The backend stopped three times in a minute. Its log is at {}.",
            log_path.display()
        );
        if ask(owner, &text, ("Restart", "Quit"), false) {
            RestartOrQuit::Restart
        } else {
            RestartOrQuit::Quit
        }
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = (owner, log_path);
        RestartOrQuit::Quit
    }
}

fn confirm<R: Runtime>(
    owner: Owner<'_, R>,
    dialog: &str,
    text: &str,
    yes: &str,
    destructive: bool,
) -> Confirm {
    if TEST_BUILD {
        refused(dialog);
        return Confirm::Cancel;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        if ask(owner, text, (yes, "Cancel"), destructive) {
            Confirm::Proceed
        } else {
            Confirm::Cancel
        }
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = (owner, text, yes, destructive);
        Confirm::Cancel
    }
}

/// Closing while a backtest runs (O11). Test builds: Cancel.
pub fn confirm_close_running_job<R: Runtime>(owner: Owner<'_, R>) -> Confirm {
    confirm(
        owner,
        "confirm_close_running_job",
        "A backtest is running. Closing stops it. Close anyway?",
        "Close",
        true,
    )
}

/// A new WebView2 runtime is ready. Test builds: Cancel (logged only).
pub fn browser_update_restart<R: Runtime>(owner: Owner<'_, R>) -> Confirm {
    confirm(
        owner,
        "browser_update_restart",
        "A new version of the page engine is ready. Restart the app now to use it?",
        "Restart",
        false,
    )
}

/// The page has not painted HOME 15 s after the backend answered (crash.rs). Test builds: Cancel (logged only).
pub fn offer_reload<R: Runtime>(owner: Owner<'_, R>) -> Confirm {
    confirm(
        owner,
        "offer_reload",
        "The page has not finished loading. Reload it?",
        "Reload",
        false,
    )
}

/// The page build is stale; rebuilding runs package install scripts, so it needs this explicit click. Test builds:
/// Cancel.
pub fn confirm_rebuild<R: Runtime>(owner: Owner<'_, R>, command: &str) -> Confirm {
    let text = format!(
        "The terminal page is out of date and needs a rebuild. The app will run:\n\n{command}\n\n\
         This runs the page's package install scripts. Rebuild now?"
    );
    confirm(owner, "confirm_rebuild", &text, "Rebuild", true)
}

fn save(dialog: &str, suggested_name: &str) -> Option<PathBuf> {
    if TEST_BUILD {
        refused(dialog);
        return None;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        rfd::FileDialog::new()
            .set_title("Save")
            .set_file_name(suggested_name)
            .save_file()
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = suggested_name;
        None
    }
}

/// Where the diagnostics zip goes. Test builds: no path (smoke uses `--save-dir`).
pub fn save_diagnostics(suggested_name: &str) -> Option<PathBuf> {
    save("save_diagnostics", suggested_name)
}

/// Where a page download goes. Test builds: no path (smoke uses `--save-dir`).
pub fn save_download(suggested_name: &str) -> Option<PathBuf> {
    save("save_download", suggested_name)
}

#[cfg(all(test, any(feature = "smoke", feature = "measure")))]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsWindowVisible,
    };
    use windows::core::BOOL;

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam is the address of the Vec that visible_windows keeps alive for the whole EnumWindows call.
        unsafe { &mut *(lparam.0 as *mut Vec<(isize, u32)>) }.push((hwnd.0 as isize, 0));
        BOOL(1)
    }

    /// Every visible top-level window of every process, with its owner pid (the global watch, one sample).
    fn visible_windows() -> HashSet<(isize, u32)> {
        let mut list: Vec<(isize, u32)> = Vec::new();
        // SAFETY: the callback only pushes into `list`, which outlives the call.
        let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
        list.into_iter()
            .map(|(h, _)| {
                let mut pid = 0u32;
                // SAFETY: read-only queries on a handle EnumWindows just listed.
                unsafe { GetWindowThreadProcessId(HWND(h as *mut _), Some(&mut pid)) };
                (h, pid)
            })
            // SAFETY: as above.
            .filter(|(h, _)| unsafe { IsWindowVisible(HWND(*h as *mut _)) }.as_bool())
            .collect()
    }

    fn foreground() -> isize {
        // SAFETY: a plain query.
        unsafe { GetForegroundWindow() }.0 as isize
    }

    /// Runs one entry point and fails if any new visible window of this process appeared or the foreground moved.
    fn without_ui<T>(name: &str, call: impl FnOnce() -> T) -> T {
        let (before, fg) = (visible_windows(), foreground());
        let answer = call();
        let me = std::process::id();
        let new: Vec<_> = visible_windows()
            .difference(&before)
            .filter(|(_, pid)| *pid == me)
            .copied()
            .collect();
        assert!(new.is_empty(), "{name} opened windows: {new:?}");
        assert_eq!(foreground(), fg, "{name} moved the foreground");
        answer
    }

    #[test]
    fn every_dialog_fails_closed_in_a_test_build() {
        let lab = Path::new(r"D:\nowhere");
        assert_eq!(without_ui("pick_lab", || pick_lab(Some(lab))), None);
        assert_eq!(
            without_ui("choose_webview_dir", || choose_webview_dir(lab)),
            None
        );
        let log = Path::new(r"D:\nowhere\backend.log");
        let none: Owner<'_, tauri::Wry> = None;
        assert_eq!(
            without_ui("restart_or_quit", || restart_or_quit(none, log)),
            RestartOrQuit::Quit
        );
        let close = without_ui("confirm_close", || confirm_close_running_job(none));
        assert_eq!(close, Confirm::Cancel);
        let update = without_ui("browser_update", || browser_update_restart(none));
        assert_eq!(update, Confirm::Cancel);
        let rebuild = without_ui("confirm_rebuild", || confirm_rebuild(none, "pnpm build"));
        assert_eq!(rebuild, Confirm::Cancel);
        let reload = without_ui("offer_reload", || offer_reload(none));
        assert_eq!(reload, Confirm::Cancel);
        let diagnostics = without_ui("save_diagnostics", || save_diagnostics("diag.zip"));
        assert_eq!(diagnostics, None);
        let download = without_ui("save_download", || save_download("export.csv"));
        assert_eq!(download, None);
        without_ui("policy_refused", || policy_refused("planted policy"));
        without_ui("folder_refused", || {
            folder_refused("planted folder refusal")
        });
        without_ui("fatal", || fatal("planted fatal"));
    }
}

#[cfg(test)]
mod order_tests {
    use super::button_order;

    #[test]
    fn a_destructive_question_draws_cancel_first_so_it_is_the_default() {
        assert_eq!(button_order("Close", "Cancel", true), ("Cancel", "Close"));
    }

    #[test]
    fn an_ordinary_question_keeps_its_yes_first() {
        assert_eq!(
            button_order("Reload", "Cancel", false),
            ("Reload", "Cancel")
        );
    }
}
