//! Crash handling and the shell log (03 section 17; 04 D4.5).
//!
//! STAGE A: the shell log (`<config>/logs/shell.log`, one JSON object per line, written through writes.rs) is
//! complete, because every module logs through it from the start; `install` is a stub with its final signature.
//! Stage B (slice w4b-crash-smoke) adds the panic hook (`shell-panic-<time>.txt` through `writes::write_new`), the
//! rotation of backend.log at 5 MB with 5 kept through `writes::rotate`, ProcessFailed (reload once, then the
//! stopped page), the hung-page reload offer and the diagnostics zip.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError, writes};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::WebviewWindow;

pub const LOG_DIR: &str = "logs";
pub const SHELL_LOG: &str = "shell.log";
/// backend.log rotation (03 section 17).
pub const BACKEND_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const BACKEND_LOG_KEEP: u32 = 5;
/// How long HOME may take to paint after /api/health answers before a reload is offered.
pub const HUNG_PAGE_S: u64 = 15;

static SHELL_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Points the shell log at `<config_dir>/logs/shell.log`. The first call wins.
pub fn set_log_dir(config_dir: &Path) {
    let _ = SHELL_LOG_PATH.set(config_dir.join(LOG_DIR).join(SHELL_LOG));
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Appends one event to the shell log. Before the log folder is known, and if the write is refused, the line goes
/// to stderr (which a test harness may capture); logging never stops the shell.
pub fn log(event: &str, detail: Value) {
    let mut line = json!({ "t": epoch_ms(), "event": event });
    if let (Value::Object(target), Value::Object(extra)) = (&mut line, detail) {
        target.extend(extra);
    }
    let mut text = line.to_string();
    text.push('\n');
    let written = SHELL_LOG_PATH
        .get()
        .map(|path| writes::append(path, text.as_bytes()));
    match written {
        Some(Ok(())) => {}
        Some(Err(e)) => eprint!("shell log refused ({e}): {text}"),
        None => eprint!("{text}"),
    }
}

/// Panic hook, ProcessFailed handling and the hung-page watch for the built window. STUB.
pub fn install(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}
