//! The shell panic hook (03 section 17): a text report at `<config>/logs/shell-panic-<time>.txt`, written through
//! `writes::write_new` (so it can never overwrite a file and always passes the one write check), then the shell log
//! gets a `panic_report` line naming the file (the diagnostics zip finds the reports through those lines).
//!
//! Release builds keep `panic = "abort"` (Cargo.toml; tests/crash_release_profile.rs reads it): the process aborts
//! after the hook has returned, so the report is on disk first.

use crate::writes::{self, WriteError};
use serde_json::json;
use std::backtrace::Backtrace;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const REPORT_PREFIX: &str = "shell-panic-";
const REPORT_SUFFIX: &str = ".txt";
/// How many name variants are tried when two reports land in the same millisecond.
const ATTEMPTS: u32 = 10;
const MS_PER_DAY: u128 = 86_400_000;

static IN_HOOK: AtomicBool = AtomicBool::new(false);

/// What a report says about one panic.
pub struct PanicFacts {
    pub time_ms: u128,
    pub thread: String,
    pub location: String,
    pub message: String,
    pub backtrace: String,
}

/// Days since 1970-01-01 to a civil date (proleptic Gregorian), after Howard Hinnant's algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = u32::try_from(day_of_year - (153 * month_part + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if month_part < 10 {
        month_part + 3
    } else {
        month_part - 9
    })
    .unwrap_or(1);
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// `YYYYMMDD-HHMMSS-mmm` in UTC.
pub fn stamp(time_ms: u128) -> String {
    let days = i64::try_from(time_ms / MS_PER_DAY).unwrap_or(0);
    let (year, month, day) = civil_from_days(days);
    let in_day = time_ms % MS_PER_DAY;
    let (hours, minutes, seconds, millis) = (
        in_day / 3_600_000,
        in_day / 60_000 % 60,
        in_day / 1_000 % 60,
        in_day % 1_000,
    );
    format!("{year:04}{month:02}{day:02}-{hours:02}{minutes:02}{seconds:02}-{millis:03}")
}

/// `shell-panic-<stamp>.txt`, or `shell-panic-<stamp>-<n>.txt` for the n-th variant.
pub fn file_name(time_ms: u128, attempt: u32) -> String {
    let base = format!("{REPORT_PREFIX}{}", stamp(time_ms));
    if attempt == 0 {
        format!("{base}{REPORT_SUFFIX}")
    } else {
        format!("{base}-{attempt}{REPORT_SUFFIX}")
    }
}

/// The report text.
pub fn report_text(facts: &PanicFacts) -> String {
    format!(
        "nq-lab terminal: shell panic\nversion: {}\ntime: {} (epoch ms {})\nthread: {}\nlocation: {}\nmessage: {}\n\nbacktrace:\n{}\n",
        env!("CARGO_PKG_VERSION"),
        stamp(facts.time_ms),
        facts.time_ms,
        facts.thread,
        facts.location,
        facts.message,
        facts.backtrace
    )
}

/// Writes the report into `logs_dir` through `writes::write_new` and returns the file's path. A name that is
/// already taken moves on to the next variant; any other refusal is returned as it is.
pub fn write_report(logs_dir: &Path, facts: &PanicFacts) -> Result<PathBuf, WriteError> {
    let text = report_text(facts);
    let mut last = None;
    for attempt in 0..ATTEMPTS {
        let path = logs_dir.join(file_name(facts.time_ms, attempt));
        match writes::write_new(&path, text.as_bytes()) {
            Ok(()) => return Ok(path),
            Err(WriteError::Exists(taken)) => last = Some(WriteError::Exists(taken)),
            Err(other) => return Err(other),
        }
    }
    Err(last.unwrap_or(WriteError::NotConfigured))
}

fn message_of(info: &PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic with a payload that is not text".to_string())
}

fn facts_of(info: &PanicHookInfo<'_>) -> PanicFacts {
    PanicFacts {
        time_ms: super::epoch_ms(),
        thread: std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string(),
        location: info.location().map_or_else(
            || "unknown".to_string(),
            |l| format!("{}:{}:{}", l.file(), l.line(), l.column()),
        ),
        message: message_of(info),
        backtrace: Backtrace::force_capture().to_string(),
    }
}

/// Arms the hook. The earlier hook still runs afterwards (it prints to stderr, which a test harness captures).
pub fn install_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // A panic inside the hook itself must not recurse.
        if !IN_HOOK.swap(true, Ordering::SeqCst) {
            report(info);
            IN_HOOK.store(false, Ordering::SeqCst);
        }
        previous(info);
    }));
}

fn report(info: &PanicHookInfo<'_>) {
    let facts = facts_of(info);
    let written = super::logs_dir()
        .ok_or_else(|| "the log folder is not set".to_string())
        .and_then(|dir| write_report(&dir, &facts).map_err(|e| e.to_string()));
    match written {
        Ok(path) => super::log(
            "panic_report",
            json!({
                "file": path.file_name().map(|n| n.to_string_lossy().into_owned()),
                "thread": facts.thread,
                "location": facts.location,
                "message": facts.message,
            }),
        ),
        Err(why) => super::log(
            "panic_report_failed",
            json!({ "error": why, "location": facts.location, "message": facts.message }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_are_utc_civil_time() {
        assert_eq!(stamp(0), "19700101-000000-000");
        // 2026-10-02 22:34:41.668 UTC
        assert_eq!(stamp(1_790_980_481_668), "20261002-223441-668");
        // a leap day
        assert_eq!(stamp(1_709_164_800_000 + 3_661_001), "20240229-010101-001");
    }

    #[test]
    fn names_carry_the_prefix_and_a_variant() {
        assert_eq!(file_name(0, 0), "shell-panic-19700101-000000-000.txt");
        assert_eq!(file_name(0, 3), "shell-panic-19700101-000000-000-3.txt");
    }

    #[test]
    fn the_report_names_where_and_why() {
        let text = report_text(&PanicFacts {
            time_ms: 0,
            thread: "main".into(),
            location: "src/x.rs:1:2".into(),
            message: "boom".into(),
            backtrace: "frames".into(),
        });
        for needle in [
            "shell panic",
            "thread: main",
            "src/x.rs:1:2",
            "message: boom",
            "frames",
        ] {
            assert!(text.contains(needle), "missing {needle}");
        }
    }
}
