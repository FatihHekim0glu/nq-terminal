//! The shell log events that desktop/scripts/close-app.ps1 reads are the ones the shell writes (V033B review, finding
//! 8). The script decides "graceful", "forced" and "a backtest question is open, do not force" from three event
//! names; a rename on either side would leave every test green on its own side and break the contract between them.
//! The script's names are read from its source and each must be a quoted event name in the Rust source that logs it.
//! The live half (a running backtest makes the shell write `close_confirm_asked`) is tests/close_confirm_event.rs.
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads this crate's own sources and the script beside it"
)]

use std::path::PathBuf;

const SCRIPT: &str = "../scripts/close-app.ps1";

fn read(relative: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The single-quoted strings in a text.
fn quoted(text: &str) -> Vec<&str> {
    text.split('\'').skip(1).step_by(2).collect()
}

/// The event names the script waits for: `$RequiredEvents = @(...)`, `$ConfirmEvent = '...'` and the
/// `-eq '...'` the mode reader compares an entry's event with.
fn script_events(script: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in script.lines().map(str::trim) {
        let wanted = line.starts_with("$RequiredEvents =") || line.starts_with("$ConfirmEvent =");
        if wanted {
            names.extend(quoted(line).into_iter().map(String::from));
        }
        if let Some(at) = line.find("$entry.event -eq '") {
            names.extend(quoted(&line[at..]).into_iter().take(1).map(String::from));
        }
    }
    names.sort();
    names.dedup();
    names
}

/// The script's events that no Rust source writes as a quoted event name.
fn unwritten(events: &[String], sources: &[String]) -> Vec<String> {
    events
        .iter()
        .filter(|e| !sources.iter().any(|s| s.contains(&format!("\"{e}\""))))
        .cloned()
        .collect()
}

fn shell_sources() -> Vec<String> {
    ["src/supervise_shell.rs", "src/flush.rs"]
        .into_iter()
        .map(read)
        .collect()
}

#[test]
fn the_script_reads_exactly_the_three_events_the_close_contract_names() {
    assert_eq!(
        script_events(&read(SCRIPT)),
        ["close_confirm_asked", "store_flush", "supervise_shutdown"],
        "the script's event names changed; update the shell, this test and the hand-over together"
    );
}

#[test]
fn every_event_the_script_reads_is_one_the_shell_writes() {
    let missing = unwritten(&script_events(&read(SCRIPT)), &shell_sources());
    assert!(
        missing.is_empty(),
        "close-app.ps1 waits for events the shell never writes: {missing:?}"
    );
}

#[test]
fn a_renamed_event_on_either_side_is_caught() {
    let renamed_script = read(SCRIPT).replace("close_confirm_asked", "close_question_open");
    let missing = unwritten(&script_events(&renamed_script), &shell_sources());
    assert_eq!(missing, ["close_question_open"]);
    let renamed_shell: Vec<String> = shell_sources()
        .iter()
        .map(|s| s.replace("\"close_confirm_asked\"", "\"close_question_open\""))
        .collect();
    let missing = unwritten(&script_events(&read(SCRIPT)), &renamed_shell);
    assert_eq!(missing, ["close_confirm_asked"]);
}
