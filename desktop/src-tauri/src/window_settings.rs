//! Reading the shell's settings file (03 section 10.5), a part of window.rs kept in its own file for size.
//!
//! The settings file, or its backup (`settings.json.1`, which holds the older copy when the last save stopped between
//! the rotate and the write). A file that is there but does not parse is not the same as a first run: the owner is
//! asked for the lab again either way (never a default lab), but each unreadable file is recorded here with where the
//! parser stopped (never what the file says), and `log_notes` writes the records to the shell log once the log folder
//! is known (`window::setup`), so an owner who sees the lab picker again can find out why (AUD-7).
use super::Settings;
use crate::{ShellError, reads};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One settings file that exists and could not be used.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unreadable {
    pub file: PathBuf,
    /// `syntax` (not JSON), `truncated` (JSON that ends too soon), `data` (JSON of the wrong shape) or `io`.
    pub kind: &'static str,
    pub line: usize,
    pub column: usize,
}

/// What reading the settings found: the settings of the first usable file, if any, and every file that was skipped.
#[derive(Debug, PartialEq, Eq)]
pub struct Stored {
    pub settings: Option<Settings>,
    pub unreadable: Vec<Unreadable>,
}

/// Records waiting for the shell log, which does not exist yet while the settings are read.
static NOTES: Mutex<Vec<Value>> = Mutex::new(Vec::new());

pub fn backup_of(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(".1");
    PathBuf::from(name)
}

fn kind_of(error: &serde_json::Error) -> &'static str {
    match error.classify() {
        serde_json::error::Category::Syntax => "syntax",
        serde_json::error::Category::Eof => "truncated",
        serde_json::error::Category::Data => "data",
        serde_json::error::Category::Io => "io",
    }
}

/// The settings file, or its backup when the file does not parse; None on first run. A file that does not parse counts
/// as absent (the owner is asked again), never as a default lab, and is listed in `unreadable`.
pub fn read_stored(file: &Path) -> Result<Stored, ShellError> {
    let mut unreadable = Vec::new();
    for path in [file.to_path_buf(), backup_of(file)] {
        let text = reads::read_settings(&path).map_err(|e| ShellError::Io(e.to_string()))?;
        let Some(text) = text else { continue };
        match serde_json::from_str::<Settings>(&text) {
            Ok(settings) => {
                return Ok(Stored {
                    settings: Some(settings),
                    unreadable,
                });
            }
            Err(error) => unreadable.push(Unreadable {
                file: path,
                kind: kind_of(&error),
                line: error.line(),
                column: error.column(),
            }),
        }
    }
    Ok(Stored {
        settings: None,
        unreadable,
    })
}

/// The log record of one unreadable file: its name, the kind of fault and where the parser stopped; `then` says what
/// the shell did about it.
pub fn note(unreadable: &Unreadable, then: &str) -> Value {
    json!({
        "file": unreadable.file.display().to_string(),
        "kind": unreadable.kind,
        "line": unreadable.line,
        "column": unreadable.column,
        "then": then,
    })
}

/// `read_stored`, with a record kept for every unreadable file until `log_notes` writes it.
pub fn load(file: &Path) -> Result<Option<Settings>, ShellError> {
    let stored = read_stored(file)?;
    let then = if stored.settings.is_some() {
        "the older copy of the settings was used"
    } else {
        "the settings were treated as a first run and the lab is asked for again"
    };
    let mut pending = NOTES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    pending.extend(stored.unreadable.iter().map(|u| note(u, then)));
    Ok(stored.settings)
}

/// Writes the records `load` kept to the shell log (call once the log folder is set).
pub fn log_notes() {
    let pending = std::mem::take(
        &mut *NOTES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for record in pending {
        crate::crash::log("settings_unreadable", record);
    }
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests write settings files into their own scratch folder; not shipped code"
)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"lab": "D:\\lab", "zoom": 125}"#;
    const BACKUP_GOOD: &str = r#"{"lab": "D:\\older-lab", "zoom": 100}"#;

    /// A scratch folder under D:\dev\tmp\plumbing-settings, never the real config folder.
    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(r"D:\dev\tmp\plumbing-settings")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    fn put(dir: &Path, name: &str, text: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, text).expect("write");
        path
    }

    #[test]
    fn a_missing_file_is_a_quiet_first_run() {
        let dir = scratch("missing");
        let stored = read_stored(&dir.join("settings.json")).expect("read");
        assert_eq!(stored.settings, None);
        assert!(stored.unreadable.is_empty(), "{:?}", stored.unreadable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_good_file_is_read_and_says_nothing() {
        let dir = scratch("good");
        let file = put(&dir, "settings.json", GOOD);
        let stored = read_stored(&file).expect("read");
        assert_eq!(stored.settings.expect("settings").zoom, 125);
        assert!(stored.unreadable.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_with_no_backup_is_a_first_run_that_names_the_file() {
        let dir = scratch("corrupt");
        let file = put(&dir, "settings.json", "{ this is not json");
        let stored = read_stored(&file).expect("read");
        assert_eq!(stored.settings, None, "never a default lab");
        assert_eq!(stored.unreadable.len(), 1, "{:?}", stored.unreadable);
        let one = &stored.unreadable[0];
        assert_eq!((one.file.as_path(), one.kind), (file.as_path(), "syntax"));
        assert_eq!(one.line, 1);
        assert!(one.column > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_with_a_good_backup_uses_the_backup_and_still_names_the_file() {
        let dir = scratch("backup");
        let file = put(&dir, "settings.json", "\u{0}\u{0}garbage");
        put(&dir, "settings.json.1", BACKUP_GOOD);
        let stored = read_stored(&file).expect("read");
        assert_eq!(stored.settings.expect("the backup").zoom, 100);
        assert_eq!(stored.unreadable.len(), 1);
        assert_eq!(stored.unreadable[0].file, file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_corrupt_files_are_both_named() {
        let dir = scratch("both");
        let file = put(&dir, "settings.json", r#"{"lab": "#);
        let backup = put(&dir, "settings.json.1", r#"{"zoom": "wide"}"#);
        let stored = read_stored(&file).expect("read");
        assert_eq!(stored.settings, None);
        let kinds: Vec<_> = stored
            .unreadable
            .iter()
            .map(|u| (&u.file, u.kind))
            .collect();
        assert_eq!(kinds, [(&file, "truncated"), (&backup, "data")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_record_holds_the_place_and_the_outcome_but_never_the_content() {
        let dir = scratch("content");
        let marker = "MARKER-the-owners-private-text";
        let file = put(&dir, "settings.json", &format!("{{ {marker}"));
        let stored = read_stored(&file).expect("read");
        let record = note(&stored.unreadable[0], "the lab is asked for again").to_string();
        for part in [
            "settings.json",
            "syntax",
            "\"line\":1",
            "the lab is asked for again",
        ] {
            assert!(record.contains(part), "{part} missing from {record}");
        }
        assert!(!record.contains(marker), "{record}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_keeps_a_record_until_the_log_takes_it() {
        let dir = scratch("load");
        let file = put(&dir, "settings.json", "not json at all");
        assert_eq!(load(&file).expect("load"), None);
        let kept = NOTES.lock().expect("notes").clone();
        let mine: Vec<_> = kept
            .iter()
            .filter(|n| {
                n["file"]
                    .as_str()
                    .is_some_and(|f| f.contains("plumbing-settings"))
            })
            .collect();
        assert_eq!(mine.len(), 1, "{kept:?}");
        assert!(
            mine[0]["then"]
                .as_str()
                .expect("then")
                .contains("first run")
        );
        NOTES.lock().expect("notes").clear();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
