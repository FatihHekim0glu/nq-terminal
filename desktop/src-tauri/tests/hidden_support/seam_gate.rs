//! The check of what a seam run appended to the gate's access log (research rules: caller `terminal`, nothing after
//! 2021-12-31, never the sealed door), kept apart so `int1_seams.rs` stays under the 800-line ceiling. Included
//! with `#[path]`; it only reads the log.

use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// The gate's own access log gains caller `terminal` lines whenever HOME reads prices (the research rules).
pub const GATE_LOG: &str = "oos_access_log.jsonl";

/// The last day the research rules let a served read touch, and the exclusive end of the in-sample window.
pub const LAST_SERVED_DAY: &str = "2021-12-31";
pub const WINDOW_END: &str = "2022-01-01 00:00:00";

/// The first 19 characters of a log timestamp as "YYYY-MM-DD HH:MM:SS" (the log writes a space, an ISO form a T).
pub fn log_instant(value: &Value) -> Option<String> {
    let text = value.as_str()?.replace('T', " ");
    (text.len() >= 19 && text.is_char_boundary(19)).then(|| text[..19].to_owned())
}

/// What is wrong with the lines a run appended to the gate's access log (empty when nothing is): every line must be
/// JSON with caller `terminal`, a window that starts on or before 2021-12-31 and ends by 2022-01-01 00:00, and no
/// mark of the sealed door (`serve_sealed` writes `"sealed": true` and its opening's keys). A line the run wrote
/// that cannot be read is a violation too: nothing may hide in it.
pub fn gate_log_violations(appended: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in appended.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            found.push(format!("not JSON: {line}"));
            continue;
        };
        if entry["caller"] != "terminal" {
            found.push(format!("caller is not \"terminal\": {line}"));
        }
        if entry
            .get("sealed")
            .is_some_and(|v| v != &Value::Bool(false))
        {
            found.push(format!("comes from the sealed door: {line}"));
        }
        let start = log_instant(&entry["start"]);
        if start.is_none_or(|s| s.get(..10).is_none_or(|day| day > LAST_SERVED_DAY)) {
            found.push(format!(
                "starts after {LAST_SERVED_DAY} or has no start: {line}"
            ));
        }
        if log_instant(&entry["end"]).is_none_or(|e| e.as_str() > WINDOW_END) {
            found.push(format!("ends after {WINDOW_END} or has no end: {line}"));
        }
    }
    found
}

pub fn terminal_line(start: &str, end: &str) -> String {
    json!({ "ts_utc": "2026-10-03T06:58:22+00:00", "caller": "terminal", "reason": "terminal display", "start": start, "end": end, "rows": 1, "symbol": "NQ.V.0" }).to_string()
}

#[test]
pub fn gate_log_accepts_terminal_reads_inside_the_window() {
    let lines = [
        terminal_line("2021-01-01 00:00:00+00:00", "2022-01-01 00:00:00+00:00"),
        terminal_line("2010-01-01T00:00:00+00:00", "2010-02-01T00:00:00+00:00"),
        String::new(),
    ]
    .join("\n");
    assert_eq!(gate_log_violations(&lines), Vec::<String>::new());
    assert_eq!(gate_log_violations(""), Vec::<String>::new());
}

#[test]
pub fn gate_log_refuses_another_caller() {
    let line = terminal_line("2021-01-01 00:00:00+00:00", "2022-01-01 00:00:00+00:00")
        .replace("\"terminal\"", "\"run_base\"");
    assert_eq!(gate_log_violations(&line).len(), 1);
}

#[test]
pub fn gate_log_refuses_a_date_after_2021_12_31() {
    let past_end = terminal_line("2021-06-01 00:00:00+00:00", "2022-03-01 00:00:00+00:00");
    let past_start = terminal_line("2022-01-02 00:00:00+00:00", "2022-01-03 00:00:00+00:00");
    let just_over = terminal_line("2021-12-01 00:00:00+00:00", "2022-01-01 00:00:01+00:00");
    for (line, wanted) in [(past_end, 1), (past_start, 2), (just_over, 1)] {
        assert_eq!(gate_log_violations(&line).len(), wanted, "{line}");
    }
}

#[test]
pub fn gate_log_refuses_the_sealed_door_and_unreadable_lines() {
    let sealed = terminal_line("2021-01-01 00:00:00+00:00", "2022-01-01 00:00:00+00:00")
        .replace("\"rows\":1", "\"rows\":1,\"sealed\":true");
    assert_eq!(gate_log_violations(&sealed).len(), 1);
    assert_eq!(gate_log_violations("{\"caller\": \"terminal\"").len(), 1);
    let no_window = json!({ "caller": "terminal" }).to_string();
    assert_eq!(gate_log_violations(&no_window).len(), 2);
}

/// The gate's access log of this lab: the one file `Scan` lets grow, and only here.
pub fn gate_log_path(lab: &Path) -> PathBuf {
    lab.join("results").join(GATE_LOG)
}

pub fn gate_log_len(lab: &Path) -> u64 {
    std::fs::metadata(gate_log_path(lab)).map_or(0, |m| m.len())
}

/// The lines the gate's log gained since it was `before` bytes long (read only), or why they cannot be read: a log
/// that shrank was rewritten, which an append-only log never is.
pub fn gate_log_appended(lab: &Path, before: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = gate_log_path(lab);
    let mut file = std::fs::File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let now = file.metadata().map_err(|e| e.to_string())?.len();
    if now < before {
        return Err(format!("the gate log shrank from {before} to {now} bytes"));
    }
    file.seek(SeekFrom::Start(before))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
