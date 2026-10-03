//! The diagnostics zip (03 section 17): the shell logs, the panic reports they name, the tail of `backend.log` and
//! the WebView2 version, in one zip that is written only where the owner picks (dialogs.rs; smoke: `--save-dir`),
//! through `writes::write_new`. Nothing is uploaded and nothing is collected beyond those files.
//!
//! Files are read through reads.rs (`read_log_tail`, which caps each read at 1 MiB, so a log larger than that
//! contributes its last mebibyte). The shell never lists a folder, so panic reports are found through the
//! `panic_report` lines of the shell log, which name each file.

use super::panic_report::{REPORT_PREFIX, stamp};
use crate::{Launch, ShellError, dialogs, reads, writes};
use serde_json::{Value, json};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

pub const ZIP_PREFIX: &str = "nqt-diagnostics-";
const INFO_ENTRY: &str = "info.txt";
/// How many old copies of a rotated log are collected (the rotation keeps 5).
const COPIES: u32 = 5;
/// At most this many panic reports go into one zip.
const MAX_REPORTS: usize = 20;
/// Each read is capped by reads.rs at its own maximum; this is the size asked for.
const READ_BYTES: u64 = reads::LOG_TAIL_MAX_BYTES;

/// One file of the zip.
#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// `nqt-diagnostics-<stamp>.zip`.
pub fn zip_name(time_ms: u128) -> String {
    format!("{ZIP_PREFIX}{}.zip", stamp(time_ms))
}

/// The zip file's bytes.
pub fn zip_bytes(entries: &[Entry]) -> Result<Vec<u8>, ShellError> {
    let io = |e: &dyn std::fmt::Display| ShellError::Io(format!("diagnostics zip: {e}"));
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in entries {
        writer
            .start_file(entry.name.as_str(), options)
            .map_err(|e| io(&e))?;
        writer.write_all(&entry.bytes).map_err(|e| io(&e))?;
    }
    writer.finish().map(Cursor::into_inner).map_err(|e| io(&e))
}

/// A report name taken from the log is used only when it is a plain file name of the shape the hook writes.
fn plain_report_name(name: &str) -> bool {
    name.starts_with(REPORT_PREFIX)
        && name.ends_with(".txt")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// The panic report names the shell log text mentions.
pub fn report_names(shell_log_text: &str) -> Vec<String> {
    let mut names: Vec<String> = shell_log_text
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|v| v["event"] == "panic_report")
        .filter_map(|v| v["file"].as_str().map(str::to_string))
        .filter(|name| plain_report_name(name))
        .collect();
    names.dedup();
    names.truncate(MAX_REPORTS);
    names
}

fn tail(path: &Path) -> Option<Vec<u8>> {
    reads::read_log_tail(path, READ_BYTES).ok()
}

fn numbered(path: &Path, n: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

/// `<path>`, then `<path>.1` to `<path>.5`, each as `<folder>/<file name>` in the zip when it exists.
fn log_with_copies(folder: &str, path: &Path, entries: &mut Vec<Entry>) -> String {
    let Some(file) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return String::new();
    };
    let mut live_text = String::new();
    for n in 0..=COPIES {
        let source = if n == 0 {
            path.to_path_buf()
        } else {
            numbered(path, n)
        };
        let Some(bytes) = tail(&source) else { continue };
        if n == 0 {
            live_text = String::from_utf8_lossy(&bytes).into_owned();
        }
        let name = if n == 0 {
            format!("{folder}/{file}")
        } else {
            format!("{folder}/{file}.{n}")
        };
        entries.push(Entry { name, bytes });
    }
    live_text
}

/// The text of info.txt: what produced the zip.
pub fn info_text(webview_version: &str, time_ms: u128) -> String {
    format!(
        "nq-lab terminal diagnostics\napp version: {}\nwebview2 runtime: {webview_version}\nwritten: {} (epoch ms {time_ms})\n",
        env!("CARGO_PKG_VERSION"),
        stamp(time_ms),
    )
}

/// Collects the zip's files: info, the shell log with its rotated copies, the panic reports it names and the
/// backend log with its copies.
pub fn gather(
    logs_dir: &Path,
    backend_log: Option<&Path>,
    webview_version: &str,
    time_ms: u128,
) -> Vec<Entry> {
    let mut entries = vec![Entry {
        name: INFO_ENTRY.to_string(),
        bytes: info_text(webview_version, time_ms).into_bytes(),
    }];
    let shell_text = log_with_copies("shell", &logs_dir.join(super::SHELL_LOG), &mut entries);
    for name in report_names(&shell_text) {
        if let Some(bytes) = tail(&logs_dir.join(&name)) {
            entries.push(Entry {
                name: format!("shell/{name}"),
                bytes,
            });
        }
    }
    if let Some(path) = backend_log {
        log_with_copies("backend", path, &mut entries);
    }
    entries
}

/// The owner's pick in the save dialog, made writable through `writes::choose` (the file itself, never its folder).
fn picked(name: &str) -> Result<Option<PathBuf>, ShellError> {
    match dialogs::save_diagnostics(name) {
        None => Ok(None),
        Some(path) => writes::choose(&path).map(Some).map_err(|e| write_error(&e)),
    }
}

/// Where the zip goes: smoke's `--save-dir` (already on the write policy's list), or the owner's pick in the save
/// dialog.
#[cfg(feature = "smoke")]
fn destination(launch: &Launch, name: &str) -> Result<Option<PathBuf>, ShellError> {
    match &launch.smoke.save_dir {
        Some(dir) => Ok(Some(dir.join(name))),
        None => picked(name),
    }
}

#[cfg(not(feature = "smoke"))]
fn destination(launch: &Launch, name: &str) -> Result<Option<PathBuf>, ShellError> {
    let _ = launch;
    picked(name)
}

fn write_error(e: &writes::WriteError) -> ShellError {
    match e {
        writes::WriteError::Refused { .. } => ShellError::Refused(e.to_string()),
        _ => ShellError::Io(e.to_string()),
    }
}

/// Zips the diagnostics into the place the owner picks. `Ok(None)` is a cancelled save (and what every test build
/// without `--save-dir` gets). `backend_log` is the backend's `<state>/logs/backend.log`.
pub fn export(launch: &Launch, backend_log: Option<&Path>) -> Result<Option<PathBuf>, ShellError> {
    let time_ms = super::epoch_ms();
    let Some(logs_dir) = super::logs_dir() else {
        return Err(ShellError::Refused("the log folder is not set".into()));
    };
    let name = zip_name(time_ms);
    let Some(path) = destination(launch, &name)? else {
        super::log("diagnostics_cancelled", json!({}));
        return Ok(None);
    };
    let version = tauri::webview_version().unwrap_or_else(|e| format!("unknown ({e})"));
    let entries = gather(&logs_dir, backend_log, &version, time_ms);
    let bytes = zip_bytes(&entries)?;
    writes::write_new(&path, &bytes).map_err(|e| write_error(&e))?;
    super::log(
        "diagnostics_written",
        json!({ "file": path.file_name().map(|n| n.to_string_lossy().into_owned()), "entries": entries.len(), "bytes": bytes.len() }),
    );
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_carry_the_prefix_and_a_stamp() {
        assert_eq!(zip_name(0), "nqt-diagnostics-19700101-000000-000.zip");
    }

    #[test]
    fn only_plain_report_names_are_followed() {
        let log = [
            r#"{"t":1,"event":"panic_report","file":"shell-panic-20260101-000000-000.txt"}"#,
            r#"{"t":2,"event":"panic_report","file":"..\\..\\results\\ledger.csv"}"#,
            r#"{"t":3,"event":"panic_report","file":"shell-panic-x/../y.txt"}"#,
            r#"{"t":4,"event":"start"}"#,
            "not json",
        ]
        .join("\n");
        assert_eq!(
            report_names(&log),
            vec!["shell-panic-20260101-000000-000.txt".to_string()]
        );
    }

    #[test]
    fn a_zip_holds_every_entry() {
        let entries = vec![
            Entry {
                name: "a/one.txt".into(),
                bytes: b"first".to_vec(),
            },
            Entry {
                name: "b.txt".into(),
                bytes: vec![b'z'; 10_000],
            },
        ];
        let bytes = zip_bytes(&entries).expect("zip");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("readable");
        assert_eq!(archive.len(), 2);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("a/one.txt").expect("entry"), &mut text)
            .expect("read");
        assert_eq!(text, "first");
    }

    #[test]
    fn info_names_the_webview_version() {
        assert!(info_text("154.0.4258.48", 0).contains("webview2 runtime: 154.0.4258.48"));
    }
}
