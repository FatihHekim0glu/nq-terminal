//! Every native dialog of the shell, and the only module that calls rfd (04 D4.2 item 14).
//!
//! Under smoke and measure every entry point FAILS CLOSED: it opens nothing, logs the event and returns the safe
//! answer (Quit, Cancel or no path), so no automated run can ever put a dialog on screen. In the release each one
//! is a plain native dialog. STAGE A: final signatures; stage B (slice w4b-window-keys) words them, parents them on
//! the main window and moves them off the UI thread where needed.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::TEST_BUILD;
use serde_json::json;
use std::path::{Path, PathBuf};

const TITLE: &str = "nq-lab terminal";

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
fn ask(text: &str, yes: &str, no: &str) -> bool {
    let buttons = rfd::MessageButtons::OkCancelCustom(yes.to_string(), no.to_string());
    let answer = rfd::MessageDialog::new()
        .set_title(TITLE)
        .set_level(rfd::MessageLevel::Warning)
        .set_description(text)
        .set_buttons(buttons)
        .show();
    answer == rfd::MessageDialogResult::Custom(yes.to_string())
}

/// The first-run lab picker, proposing `%USERPROFILE%\nq-lab` when it exists. Test builds: no path.
pub fn pick_lab(proposed: Option<&Path>) -> Option<PathBuf> {
    if TEST_BUILD {
        refused("pick_lab");
        return None;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        let dialog = rfd::FileDialog::new().set_title("Choose the nq-lab folder");
        let dialog = match proposed {
            Some(dir) => dialog.set_directory(dir),
            None => dialog,
        };
        dialog.pick_folder()
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
pub fn restart_or_quit(log_path: &Path) -> RestartOrQuit {
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
        if ask(&text, "Restart", "Quit") {
            RestartOrQuit::Restart
        } else {
            RestartOrQuit::Quit
        }
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = log_path;
        RestartOrQuit::Quit
    }
}

fn confirm(dialog: &str, text: &str, yes: &str) -> Confirm {
    if TEST_BUILD {
        refused(dialog);
        return Confirm::Cancel;
    }
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    {
        if ask(text, yes, "Cancel") {
            Confirm::Proceed
        } else {
            Confirm::Cancel
        }
    }
    #[cfg(any(feature = "smoke", feature = "measure"))]
    {
        let _ = (text, yes);
        Confirm::Cancel
    }
}

/// Closing while a backtest runs (O11). Test builds: Cancel.
pub fn confirm_close_running_job() -> Confirm {
    confirm(
        "confirm_close_running_job",
        "A backtest is running. Closing stops it. Close anyway?",
        "Close",
    )
}

/// A new WebView2 runtime is ready. Test builds: Cancel (logged only).
pub fn browser_update_restart() -> Confirm {
    confirm(
        "browser_update_restart",
        "A new version of the page engine is ready. Restart the app now?",
        "Restart",
    )
}

/// The page build is stale; rebuilding runs package install scripts. Test builds: Cancel.
pub fn confirm_rebuild(command: &str) -> Confirm {
    let text = format!("The page needs a rebuild. The app will run:\n{command}\nRebuild now?");
    confirm("confirm_rebuild", &text, "Rebuild")
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

    #[test]
    fn every_dialog_fails_closed_in_a_test_build() {
        assert_eq!(pick_lab(Some(Path::new(r"D:\nowhere"))), None);
        assert_eq!(
            restart_or_quit(Path::new(r"D:\nowhere\backend.log")),
            RestartOrQuit::Quit
        );
        assert_eq!(confirm_close_running_job(), Confirm::Cancel);
        assert_eq!(browser_update_restart(), Confirm::Cancel);
        assert_eq!(confirm_rebuild("pnpm build"), Confirm::Cancel);
        assert_eq!(save_diagnostics("diag.zip"), None);
        assert_eq!(save_download("export.csv"), None);
        policy_refused("planted policy");
        fatal("planted fatal");
    }
}
