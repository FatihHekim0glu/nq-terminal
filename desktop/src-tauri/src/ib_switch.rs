//! The on-screen switch for the read-only IB snapshot (O10; V032): the owner turns it on or off from Options in the
//! page, never by editing the settings file. It opens no page-to-shell channel and adds no order path.
//!
//! - The page asks by navigating to one of two exact addresses, `IB_ON_URI` or `IB_OFF_URI` (web/src/bridge/ibSwitch.ts
//!   holds the same two). The navigation check (supervise_run.rs `navigation_verdict`) recognises them by exact string
//!   equality before the shell's own pages are allowed, cancels the navigation always, and honours it only while a
//!   backend is current and the page that asked is that backend's own page (supervise_shell.rs reads the webview's
//!   source). There is no command, no invoke handler, no permission and no capability.
//! - A native confirmation (dialogs.rs) is the only path to a write, and the write changes only `ib_snapshot` in the
//!   settings file (window.rs `store_ib_snapshot`). Turning it on is refused, with the names of the faults only, when an
//!   IB value the backend would refuse is set (supervise_ib_faults.rs `ib_switch_faults`); turning it off is never refused.
//! - The change applies when the terminal next starts: the running backend keeps the environment it was started with.
//! - A backend this app attached to (one started outside it, such as the browser terminal) is not the app's to set: its
//!   snapshot follows its own environment, so the switch only says so natively and writes nothing (V032 review).
//! - One dialog at a time: a request while one is open is logged as `ib_switch_busy` and dropped.
//! - Logs: `ib_switch_request`, `ib_switch_busy`, `ib_switch_refused` (fault names, or the reason `origin`,
//!   `attached` or `no_settings`) and `ib_switch_saved` (the save path only, with its error when the write failed). No
//!   account id or host value is ever logged or shown.

use super::ib_faults::{self, IbFault};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};

/// The page's request to turn the snapshot on for the next start.
pub const IB_ON_URI: &str = "http://tauri.localhost/ib-snapshot/on";
/// The page's request to turn the snapshot off for the next start.
pub const IB_OFF_URI: &str = "http://tauri.localhost/ib-snapshot/off";

/// Whether one native dialog of the switch is open.
static OPEN: AtomicBool = AtomicBool::new(false);

/// The requested value for one of the two exact addresses, None for anything else (no parsing, no normalising).
pub fn request(uri: &str) -> Option<bool> {
    match uri {
        IB_ON_URI => Some(true),
        IB_OFF_URI => Some(false),
        _ => None,
    }
}

/// What a request leads to, before any dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    /// The stored value already is the one asked for: say so, write nothing.
    Info,
    /// Turning it on is refused for these faults: say which names, write nothing.
    Refused(Vec<IbFault>),
    /// Ask the owner to confirm, then write.
    AskConfirm,
    /// A dialog of the switch is already open: drop the request.
    Busy,
}

/// The pure rule: busy first, then nothing to change, then the refusals (turning on only), then the question.
pub fn decide(on: bool, stored: bool, faults: &[IbFault], busy: bool) -> Decision {
    if busy {
        return Decision::Busy;
    }
    if on == stored {
        return Decision::Info;
    }
    if on && !faults.is_empty() {
        return Decision::Refused(faults.to_vec());
    }
    Decision::AskConfirm
}

/// How a request ended, for the log and the tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Busy,
    Unchanged,
    Refused(Vec<IbFault>),
    Cancelled,
    Saved,
    SaveFailed(String),
    /// No settings are loaded (no stored value to compare with).
    NoSettings,
    /// The window is on a backend this app attached to: told why, nothing written.
    Attached,
}

/// The effects one request may have, so the rule runs without a window in the tests.
pub struct Effects<'a> {
    /// The stored value, or None when no settings are loaded.
    pub stored: Option<bool>,
    /// What turning it on would be refused for, as the shell's environment has it.
    pub faults: Vec<IbFault>,
    /// The native confirmation: true only on the owner's explicit yes (a test build answers no).
    pub confirm: &'a dyn Fn(bool, &str) -> bool,
    /// A native message (the value is unchanged, or the refusal).
    pub tell: &'a dyn Fn(&str),
    /// Writes `ib_snapshot` and nothing else.
    pub save: &'a dyn Fn(bool) -> Result<(), String>,
    /// Whether the current backend is one this app attached to rather than started.
    pub attached: bool,
    /// The shell log (`crash::log`).
    pub log: &'a dyn Fn(&str, Value),
}

/// Lets the one-dialog hold go however the request ends.
struct Hold<'a>(&'a AtomicBool);

impl Drop for Hold<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// One request, with `open` as the one-dialog hold: busy first, then an attached backend (said, nothing written), then
/// no settings (refused, no dialog), then the rule of `decide`.
pub fn handle(on: bool, effects: &Effects<'_>, open: &AtomicBool) -> Outcome {
    let log = effects.log;
    let free = open
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok();
    if !free {
        log("ib_switch_busy", json!({ "on": on }));
        return Outcome::Busy;
    }
    let _hold = Hold(open);
    if effects.attached {
        log(
            "ib_switch_refused",
            json!({ "on": on, "reason": "attached" }),
        );
        (effects.tell)(ATTACHED_TEXT);
        return Outcome::Attached;
    }
    let Some(stored) = effects.stored else {
        log(
            "ib_switch_refused",
            json!({ "on": on, "reason": "no_settings" }),
        );
        return Outcome::NoSettings;
    };
    match decide(on, stored, &effects.faults, false) {
        Decision::Busy => Outcome::Busy,
        Decision::Info => {
            (effects.tell)(&unchanged_text(on));
            Outcome::Unchanged
        }
        Decision::Refused(faults) => {
            let names: Vec<&str> = faults.iter().map(|f| f.code()).collect();
            log("ib_switch_refused", json!({ "on": on, "faults": names }));
            (effects.tell)(&refusal_text(&faults));
            Outcome::Refused(faults)
        }
        Decision::AskConfirm => {
            if !(effects.confirm)(
                on,
                &confirm_text(on, &ib_faults::ib_names_set(std::env::vars_os())),
            ) {
                return Outcome::Cancelled;
            }
            let saved = (effects.save)(on);
            log(
                "ib_switch_saved",
                json!({ "on": on, "error": saved.as_ref().err() }),
            );
            match saved {
                Ok(()) => Outcome::Saved,
                Err(e) => Outcome::SaveFailed(e),
            }
        }
    }
}

/// The request from the page, on a worker thread: the stored value, the refusals and the native dialogs of this build
/// (a test build fails every dialog closed, so it never writes). `attached`: the current backend is one this app
/// attached to.
pub fn ask<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    on: bool,
    attached: bool,
) -> Outcome {
    let owner = Some(window);
    let confirm = |on: bool, text: &str| {
        crate::dialogs::confirm_ib_snapshot(owner, on, text) == crate::dialogs::Confirm::Proceed
    };
    let tell = |text: &str| crate::dialogs::ib_snapshot_note(owner, text);
    let save = |on: bool| crate::window::store_ib_snapshot(on);
    let effects = Effects {
        stored: crate::window::ib_snapshot_stored(),
        faults: ib_faults::ib_switch_faults(std::env::vars_os()),
        confirm: &confirm,
        tell: &tell,
        save: &save,
        attached,
        log: &|event: &str, detail: Value| crate::crash::log(event, detail),
    };
    handle(on, &effects, &OPEN)
}

/// The note for a backend this app attached to: why the switch does not apply, and what to do; nothing is written.
pub const ATTACHED_TEXT: &str = "The read-only IB snapshot cannot be set from this window. The terminal is using a \
     backend that this app did not start (for example the browser terminal started with start.ps1), and that backend \
     reads TWS or not as its own environment says; the LIVE screen shows what it reads. Close that backend and open \
     the app again, so that the app starts its own backend, to use the switch. Nothing was changed.";

/// The word for a value.
fn word(on: bool) -> &'static str {
    if on { "on" } else { "off" }
}

/// The confirmation: what will change, when, and which IB names would be passed (names only, never a value).
pub fn confirm_text(on: bool, set: &[(&'static str, bool)]) -> String {
    let when = "The change takes effect when the terminal next starts; the backend running now keeps its setting.";
    if !on {
        return format!(
            "Turn the read-only IB snapshot off?\n\n{when} With it off the terminal does not connect to TWS. \
             There is no order path either way."
        );
    }
    let passed: Vec<&str> = set.iter().filter(|(_, s)| *s).map(|(n, _)| *n).collect();
    let unset: Vec<&str> = set.iter().filter(|(_, s)| !*s).map(|(n, _)| *n).collect();
    let list = |names: &[&str]| {
        if names.is_empty() {
            "none".to_string()
        } else {
            names.join(", ")
        }
    };
    format!(
        "Turn the read-only IB snapshot on?\n\n{when} The terminal will then read a paper account from TWS or IB \
         Gateway on this machine. It has no order path.\n\nPassed from this app's environment: {}.\nNot set: {}.\n\
         An unset IB_PORT means TWS paper on port 7497 on this machine. IB names set after the app started are seen \
         only after a fresh start.",
        list(&passed),
        list(&unset)
    )
}

/// The value asked for is already stored.
pub fn unchanged_text(on: bool) -> String {
    format!(
        "The read-only IB snapshot is already set to {} for the next start. The switch shows the setting the \
         terminal started with; the change takes effect when the terminal next starts.",
        word(on)
    )
}

/// Turning it on is refused: the names and why, never a value.
pub fn refusal_text(faults: &[IbFault]) -> String {
    let lines: Vec<String> = faults
        .iter()
        .map(|f| format!("- {}", f.message()))
        .collect();
    format!(
        "The read-only IB snapshot was not turned on, because the backend would refuse these settings:\n\n{}\n\n\
         Change them in your environment and start the app again (IB names set after the app started are seen only \
         after a fresh start). Nothing was changed.",
        lines.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn only_the_two_exact_addresses_are_requests() {
        assert_eq!(request(IB_ON_URI), Some(true));
        assert_eq!(request(IB_OFF_URI), Some(false));
        assert_eq!(request("http://tauri.localhost/ib-snapshot/on"), Some(true));
        for bad in [
            "http://tauri.localhost/ib-snapshot/on/",
            "http://tauri.localhost/ib-snapshot/off/",
            "http://tauri.localhost/ib-snapshot/on?on=1",
            "http://tauri.localhost/ib-snapshot/on#x",
            "http://tauri.localhost/ib-snapshot/ON",
            "http://tauri.localhost/ib-snapshot/1",
            "http://tauri.localhost/ib-snapshot/true",
            "https://tauri.localhost/ib-snapshot/on",
            "http://tauri.localhost.evil/ib-snapshot/on",
            "http://tauri.localhost/ib-snapshot/%6Fn",
            "http://tauri.localhost/ib%2Dsnapshot/on",
            "HTTP://tauri.localhost/ib-snapshot/on",
            " http://tauri.localhost/ib-snapshot/on",
            "http://tauri.localhost/ib-snapshot/",
            "",
        ] {
            assert_eq!(request(bad), None, "accepted {bad:?}");
        }
    }

    #[test]
    fn the_web_side_names_the_same_two_addresses() {
        let ts = include_str!("../../../web/src/bridge/ibSwitch.ts");
        for uri in [IB_ON_URI, IB_OFF_URI] {
            assert!(
                ts.contains(&format!("'{uri}'")),
                "web/src/bridge/ibSwitch.ts lacks {uri}"
            );
        }
    }

    #[test]
    fn decide_says_info_refused_ask_or_busy() {
        let faults = [IbFault::PortLive];
        assert_eq!(decide(true, true, &[], false), Decision::Info);
        assert_eq!(decide(false, false, &faults, false), Decision::Info);
        assert_eq!(
            decide(true, false, &faults, false),
            Decision::Refused(faults.to_vec())
        );
        assert_eq!(decide(true, false, &[], false), Decision::AskConfirm);
        // Turning it off is never refused.
        assert_eq!(decide(false, true, &faults, false), Decision::AskConfirm);
        assert_eq!(decide(true, false, &[], true), Decision::Busy);
        assert_eq!(decide(true, true, &[], true), Decision::Busy);
    }

    /// Records what a request did.
    #[derive(Default)]
    struct Seen {
        confirms: RefCell<Vec<(bool, String)>>,
        told: RefCell<Vec<String>>,
        saved: RefCell<Vec<bool>>,
        logs: RefCell<Vec<(String, Value)>>,
    }

    impl Seen {
        fn events(&self) -> Vec<String> {
            self.logs.borrow().iter().map(|(e, _)| e.clone()).collect()
        }
    }

    fn run(
        on: bool,
        stored: Option<bool>,
        faults: Vec<IbFault>,
        yes: bool,
        seen: &Seen,
        open: &AtomicBool,
    ) -> Outcome {
        run_on(on, stored, faults, yes, false, seen, open)
    }

    fn run_on(
        on: bool,
        stored: Option<bool>,
        faults: Vec<IbFault>,
        yes: bool,
        attached: bool,
        seen: &Seen,
        open: &AtomicBool,
    ) -> Outcome {
        let confirm = |on: bool, text: &str| {
            seen.confirms.borrow_mut().push((on, text.to_string()));
            yes
        };
        let tell = |text: &str| seen.told.borrow_mut().push(text.to_string());
        let save = |on: bool| {
            seen.saved.borrow_mut().push(on);
            Ok(())
        };
        let log = |event: &str, detail: Value| {
            seen.logs.borrow_mut().push((event.to_string(), detail));
        };
        let effects = Effects {
            stored,
            faults,
            confirm: &confirm,
            tell: &tell,
            save: &save,
            attached,
            log: &log,
        };
        handle(on, &effects, open)
    }

    #[test]
    fn a_confirmed_request_saves_only_after_the_yes() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        assert_eq!(
            run(true, Some(false), vec![], true, &seen, &open),
            Outcome::Saved
        );
        assert_eq!(*seen.saved.borrow(), [true]);
        assert_eq!(seen.confirms.borrow().len(), 1);
        assert!(!open.load(Ordering::SeqCst), "the hold must be let go");
    }

    #[test]
    fn a_cancelled_request_writes_nothing() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        assert_eq!(
            run(false, Some(true), vec![], false, &seen, &open),
            Outcome::Cancelled
        );
        assert!(seen.saved.borrow().is_empty());
    }

    #[test]
    fn a_refused_request_tells_the_names_and_writes_nothing() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        let faults = vec![IbFault::AccountNotPaper, IbFault::HostNotLocal];
        let out = run(true, Some(false), faults.clone(), true, &seen, &open);
        assert_eq!(out, Outcome::Refused(faults));
        assert!(seen.saved.borrow().is_empty() && seen.confirms.borrow().is_empty());
        let told = seen.told.borrow();
        assert!(
            told[0].contains("IB_ACCOUNT_ID") && told[0].contains("IB_HOST"),
            "{told:?}"
        );
    }

    #[test]
    fn an_unchanged_value_is_said_and_not_written() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        assert_eq!(
            run(true, Some(true), vec![], true, &seen, &open),
            Outcome::Unchanged
        );
        assert!(seen.saved.borrow().is_empty() && seen.confirms.borrow().is_empty());
        assert!(seen.told.borrow()[0].contains("next start"));
    }

    #[test]
    fn a_second_request_while_a_dialog_is_open_is_dropped() {
        let (seen, open) = (Seen::default(), AtomicBool::new(true));
        assert_eq!(
            run(true, Some(false), vec![], true, &seen, &open),
            Outcome::Busy
        );
        assert!(
            seen.saved.borrow().is_empty()
                && seen.confirms.borrow().is_empty()
                && seen.told.borrow().is_empty()
        );
        assert!(
            open.load(Ordering::SeqCst),
            "a dropped request must not let go of the open dialog's hold"
        );
    }

    #[test]
    fn no_settings_means_no_dialog_and_no_write() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        assert_eq!(
            run(true, None, vec![], true, &seen, &open),
            Outcome::NoSettings
        );
        assert!(seen.saved.borrow().is_empty() && seen.confirms.borrow().is_empty());
        assert!(!open.load(Ordering::SeqCst), "the hold must be let go");
    }

    /// V032 review: the no-settings case was logged as `ib_switch_saved` although nothing was saved. It is a refusal
    /// with its reason; `ib_switch_saved` is the save path's alone.
    #[test]
    fn no_settings_is_logged_as_a_refusal_and_never_as_saved() {
        let (seen, open) = (Seen::default(), AtomicBool::new(false));
        run(false, None, vec![], true, &seen, &open);
        assert_eq!(seen.events(), ["ib_switch_refused"]);
        assert_eq!(
            seen.logs.borrow()[0].1,
            json!({ "on": false, "reason": "no_settings" })
        );
        let saved = Seen::default();
        run(true, Some(false), vec![], true, &saved, &open);
        assert_eq!(saved.events(), ["ib_switch_saved"]);
        assert_eq!(
            saved.logs.borrow()[0].1,
            json!({ "on": true, "error": null })
        );
    }

    /// V032 review: on a backend this app attached to (one started outside it), the switch said off while that
    /// backend could be reading TWS, and the off confirm said the terminal would not connect. The switch now says
    /// natively why it does not apply, never asks to confirm and never writes, whichever way and whatever is stored.
    #[test]
    fn an_attached_backend_is_told_why_and_nothing_is_written() {
        for (on, stored) in [(false, Some(true)), (true, Some(false)), (true, None)] {
            let (seen, open) = (Seen::default(), AtomicBool::new(false));
            assert_eq!(
                run_on(on, stored, vec![], true, true, &seen, &open),
                Outcome::Attached
            );
            assert!(seen.saved.borrow().is_empty() && seen.confirms.borrow().is_empty());
            assert_eq!(*seen.told.borrow(), [ATTACHED_TEXT]);
            assert_eq!(seen.events(), ["ib_switch_refused"]);
            assert_eq!(seen.logs.borrow()[0].1["reason"], json!("attached"));
            assert!(!open.load(Ordering::SeqCst), "the hold must be let go");
        }
        assert!(
            ATTACHED_TEXT.contains("did not start")
                && ATTACHED_TEXT.contains("Nothing was changed"),
            "{ATTACHED_TEXT}"
        );
        assert!(!ATTACHED_TEXT.contains("  "), "{ATTACHED_TEXT}");
    }

    #[test]
    fn the_confirm_text_lists_names_never_values_and_says_next_start() {
        let set = [
            ("IB_HOST", false),
            ("IB_PORT", true),
            ("IB_ACCOUNT_ID", true),
            ("IB_BASE_USD_RATE", true),
        ];
        let on = confirm_text(true, &set);
        assert!(
            on.contains(
                "Passed from this app's environment: IB_PORT, IB_ACCOUNT_ID, IB_BASE_USD_RATE."
            ),
            "{on}"
        );
        assert!(on.contains("Not set: IB_HOST."), "{on}");
        assert!(on.contains("7497") && on.contains("next starts"), "{on}");
        let off = confirm_text(false, &set);
        assert!(
            off.contains("off") && off.contains("next starts") && !off.contains("IB_PORT"),
            "{off}"
        );
        for text in [
            on,
            off,
            unchanged_text(true),
            refusal_text(&[IbFault::PortLive]),
            ATTACHED_TEXT.to_string(),
        ] {
            assert!(!text.contains(['\u{2013}', '\u{2014}']), "{text}");
        }
    }
}
