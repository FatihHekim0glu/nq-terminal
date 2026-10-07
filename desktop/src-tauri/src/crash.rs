//! Crash handling and the shell log (03 section 17; 04 D4.5).
//!
//! The shell log (`<config>/logs/shell.log`, one JSON object per line, written through writes.rs) is complete from
//! stage A, because every module logs through it. This module adds, in its submodules:
//!
//! - `panic_report`: the panic hook, `<config>/logs/shell-panic-<time>.txt` through `writes::write_new` (release
//!   builds keep `panic = "abort"`, which runs after the hook);
//! - `recovery`: WebView2 `ProcessFailed` through `with_webview`: reload once, then the stopped page;
//! - `hung`: the backend answers but HOME has not painted within 15 s: offer a reload (logged only in test builds);
//! - `diagnostics`: the zip of the shell logs, `backend.log` and the WebView2 version, written only where the owner
//!   picks through dialogs.rs (smoke: `--save-dir`).
//!
//! `backend.log` rotation (5 MB, 5 kept, through `writes::rotate`) lives here too: the backend reader thread in
//! supervise.rs appends through `append_backend_log`.
#![allow(
    dead_code,
    reason = "append_backend_log, rotate_backend_log, backend_log_path and export_diagnostics are wired by supervise.rs and the Help entry (04 D4.3)"
)]

mod diagnostics;
mod hung;
mod panic_report;
mod recovery;

use crate::{Launch, ShellError, writes};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::WebviewWindow;

#[allow(
    unused_imports,
    reason = "the Help entry that calls it waits for the owner to decide on a menu bar, which changes F10 and Alt handling (04 D4.5)"
)]
pub use diagnostics::export as export_diagnostics;
pub use hung::set_health_check;

pub const LOG_DIR: &str = "logs";
pub const SHELL_LOG: &str = "shell.log";
/// The backend's log under the state folder (03 section 17): `<state>/logs/backend.log`.
pub const BACKEND_LOG: &str = "backend.log";
/// backend.log rotation (03 section 17).
pub const BACKEND_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const BACKEND_LOG_KEEP: u32 = 5;
/// How long HOME may take to paint after /api/health answers before a reload is offered.
pub const HUNG_PAGE_S: u64 = 15;
/// Smoke only: a forced panic on a helper thread, so a test can see the report (the hook runs, then the thread ends
/// in debug builds and the process aborts in release builds).
#[cfg(feature = "smoke")]
pub const FORCE_PANIC_VAR: &str = "NQT_SMOKE_FORCE_PANIC";

static SHELL_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Points the shell log at `<config_dir>/logs/shell.log` and arms the panic hook. The first call wins.
pub fn set_log_dir(config_dir: &Path) {
    if SHELL_LOG_PATH
        .set(config_dir.join(LOG_DIR).join(SHELL_LOG))
        .is_ok()
    {
        panic_report::install_hook();
    }
}

/// The folder of the shell log, once `set_log_dir` has run.
fn logs_dir() -> Option<PathBuf> {
    SHELL_LOG_PATH
        .get()
        .and_then(|log| log.parent().map(Path::to_path_buf))
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

/// `<state_dir>/logs/backend.log`.
pub fn backend_log_path(state_dir: &Path) -> PathBuf {
    state_dir.join(LOG_DIR).join(BACKEND_LOG)
}

/// Rotates `path` when it is over 5 MB, keeping 5 old files (`path.1` to `path.5`), through `writes::rotate`.
/// Returns whether it rotated.
pub fn rotate_backend_log(path: &Path) -> Result<bool, writes::WriteError> {
    writes::rotate(path, BACKEND_LOG_MAX_BYTES, BACKEND_LOG_KEEP)
}

/// Appends backend output to `path`, rotating first when the file is already over its cap, so the size is checked on
/// the file itself and a log left over the cap by an earlier session rotates at once. The bytes are appended even
/// when the rotation fails (nothing is lost); that failure is then returned.
pub fn append_backend_log(path: &Path, bytes: &[u8]) -> Result<(), writes::WriteError> {
    let rotated = rotate_backend_log(path);
    writes::append(path, bytes)?;
    rotated.map(|_| ())
}

/// Bytes read from the backend's pipe per call.
const DRAIN_CHUNK: usize = 64 * 1024;

/// Drains `reader` (the backend's stdout and stderr) into `log` until the pipe closes: every chunk goes to
/// `on_chunk` (the handshake scan), then through [`append_backend_log`], so the 5 MB cap with 5 kept copies holds
/// across sessions and the file never runs more than one chunk past it. A refused write is logged once.
pub fn drain_backend_output<R: std::io::Read>(
    mut reader: R,
    log: &Path,
    mut on_chunk: impl FnMut(&[u8]),
) {
    let (mut chunk, mut refused) = (vec![0u8; DRAIN_CHUNK], false);
    while let Ok(n @ 1..) = reader.read(&mut chunk) {
        on_chunk(&chunk[..n]);
        if let Err(e) = append_backend_log(log, &chunk[..n])
            && !std::mem::replace(&mut refused, true)
        {
            self::log("backend_log_refused", json!({ "error": e.to_string() }));
        }
    }
}

/// The shell log's own rotation, with the same cap, so it can never grow without bound.
fn rotate_shell_log() {
    let Some(path) = SHELL_LOG_PATH.get() else {
        return;
    };
    match writes::rotate(path, BACKEND_LOG_MAX_BYTES, BACKEND_LOG_KEEP) {
        Ok(true) => log("shell_log_rotated", json!({})),
        Ok(false) => {}
        Err(e) => log("shell_log_rotate_failed", json!({ "error": e.to_string() })),
    }
}

/// Smoke only: when `NQT_SMOKE_FORCE_PANIC` is set, a helper thread panics shortly after start, which is how the
/// panic report is proved end to end.
#[cfg(feature = "smoke")]
fn force_panic_if_asked() {
    if std::env::var_os(FORCE_PANIC_VAR).is_none() {
        return;
    }
    log("force_panic_armed", json!({}));
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(300));
        panic!("forced smoke panic");
    });
}

#[cfg(not(feature = "smoke"))]
const fn force_panic_if_asked() {}

/// Panic hook (armed by `set_log_dir`), ProcessFailed handling and the hung-page watch for the built window.
pub fn install(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = launch;
    rotate_shell_log();
    recovery::register(window)?;
    hung::spawn(window.clone());
    force_panic_if_asked();
    log(
        "crash_installed",
        json!({ "hung_page_s": HUNG_PAGE_S, "log_dir": logs_dir() }),
    );
    Ok(())
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests make and remove fixture files under D:\\dev; not shipped code"
)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::Once;

    /// One scratch folder per test process, set as the write policy's config folder (the policy is set once).
    pub fn scratch() -> PathBuf {
        static ONCE: Once = Once::new();
        let root =
            PathBuf::from(r"D:\dev\tmp").join(format!("nqt-crash-unit-{}", std::process::id()));
        ONCE.call_once(|| {
            std::fs::create_dir_all(&root).expect("scratch folder");
            let _ = writes::configure(writes::WritePolicy {
                lab: None,
                config_dir: root.clone(),
                save_dirs: vec![root.join("saved")],
            });
        });
        root
    }

    /// An empty folder of that name under the scratch folder.
    pub fn fresh(name: &str) -> PathBuf {
        let dir = scratch().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("test folder");
        dir
    }
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests make and remove fixture files under D:\\dev; not shipped code"
)]
mod tests {
    use super::test_support::{fresh, scratch};
    use super::*;

    fn fill(path: &Path, bytes: usize) {
        std::fs::write(path, vec![b'x'; bytes]).expect("fill");
    }

    #[test]
    fn backend_log_lives_under_state_logs() {
        assert_eq!(
            backend_log_path(Path::new(r"D:\s")),
            PathBuf::from(r"D:\s\logs\backend.log")
        );
    }

    #[test]
    fn backend_log_rotates_at_5_mb_and_keeps_five() {
        let dir = fresh("rotate");
        let log = dir.join("backend.log");
        let cap = usize::try_from(BACKEND_LOG_MAX_BYTES).expect("cap fits");
        fill(&log, cap);
        assert_eq!(
            rotate_backend_log(&log),
            Ok(false),
            "exactly 5 MB is not over"
        );
        fill(&log, cap + 1);
        assert_eq!(rotate_backend_log(&log), Ok(true));
        assert!(!log.exists() && dir.join("backend.log.1").exists());
        for round in 2u8..=7 {
            std::fs::write(&log, vec![b'a' + round; cap + 1]).expect("fill");
            assert_eq!(rotate_backend_log(&log), Ok(true), "round {round}");
        }
        for n in 1..=5 {
            assert!(
                dir.join(format!("backend.log.{n}")).exists(),
                "missing .{n}"
            );
        }
        assert!(!dir.join("backend.log.6").exists(), "a sixth file was kept");
        let newest = std::fs::read(dir.join("backend.log.1")).expect("read");
        assert_eq!(newest.first(), Some(&(b'a' + 7)));
        // 30 MB of fixture files: removed again when the test passed.
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn appending_to_a_full_log_rotates_first() {
        let dir = fresh("append");
        let log = dir.join("backend.log");
        let cap = usize::try_from(BACKEND_LOG_MAX_BYTES).expect("cap fits");
        fill(&log, cap + 10);
        append_backend_log(&log, b"fresh line\n").expect("append");
        assert_eq!(std::fs::read(&log).expect("read"), b"fresh line\n");
        let old = std::fs::metadata(dir.join("backend.log.1"))
            .expect("old")
            .len();
        assert_eq!(old, (cap + 10) as u64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A reader that hands out one prepared piece per call, like a pipe that delivers in bursts.
    struct Pieces(std::collections::VecDeque<Vec<u8>>);

    impl std::io::Read for Pieces {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let Some(piece) = self.0.pop_front() else {
                return Ok(0);
            };
            buf[..piece.len()].copy_from_slice(&piece);
            Ok(piece.len())
        }
    }

    #[test]
    fn a_new_session_rotates_a_log_left_over_the_cap_by_an_earlier_one() {
        let dir = fresh("drain-session");
        let log = dir.join("backend.log");
        let cap = usize::try_from(BACKEND_LOG_MAX_BYTES).expect("cap fits");
        fill(&log, cap + 10);
        let mut seen = Vec::new();
        let reader = Pieces(vec![b"hello\n".to_vec()].into());
        drain_backend_output(reader, &log, |chunk| seen.extend_from_slice(chunk));
        assert_eq!(seen, b"hello\n");
        assert_eq!(std::fs::read(&log).expect("read"), b"hello\n");
        let old = std::fs::metadata(dir.join("backend.log.1")).expect("old");
        assert_eq!(old.len(), (cap + 10) as u64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_long_session_never_runs_far_past_the_cap() {
        let dir = fresh("drain-long");
        let log = dir.join("backend.log");
        let cap = usize::try_from(BACKEND_LOG_MAX_BYTES).expect("cap fits");
        fill(&log, cap - 5);
        let pieces = vec![vec![b'a'; 10], vec![b'b'; 10]];
        drain_backend_output(Pieces(pieces.into()), &log, |_| {});
        assert_eq!(std::fs::read(&log).expect("read"), vec![b'b'; 10]);
        let old = std::fs::metadata(dir.join("backend.log.1")).expect("old");
        assert_eq!(old.len(), (cap + 5) as u64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_outside_the_config_and_save_folders_is_refused() {
        let _ = scratch();
        let outside = Path::new(r"D:\dev\tmp\nqt-crash-outside\backend.log");
        assert!(matches!(
            rotate_backend_log(outside),
            Err(writes::WriteError::Refused { .. })
        ));
    }

    fn facts(time_ms: u128) -> panic_report::PanicFacts {
        panic_report::PanicFacts {
            time_ms,
            thread: "main".into(),
            location: "src/x.rs:1:1".into(),
            message: "planted".into(),
            backtrace: "none".into(),
        }
    }

    #[test]
    fn a_panic_report_is_written_through_write_new_and_never_overwrites() {
        let dir = fresh("panic");
        let first = panic_report::write_report(&dir, &facts(5)).expect("first report");
        let second =
            panic_report::write_report(&dir, &facts(5)).expect("second report, same millisecond");
        assert_ne!(first, second);
        assert!(
            std::fs::read_to_string(&first)
                .expect("read")
                .contains("message: planted")
        );
        let name = second
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        assert!(name.ends_with("-1.txt"), "{name}");
    }

    #[test]
    fn a_panic_report_outside_the_config_folder_is_refused() {
        let _ = scratch();
        let outside = Path::new(r"D:\dev\tmp\nqt-crash-outside");
        assert!(matches!(
            panic_report::write_report(outside, &facts(5)),
            Err(writes::WriteError::Refused { .. })
        ));
    }

    #[test]
    fn gather_collects_the_shell_logs_the_named_reports_and_the_backend_log() {
        let root = fresh("gather");
        let (logs, backend) = (root.join("logs"), root.join("backend"));
        std::fs::create_dir_all(&logs).expect("logs");
        std::fs::create_dir_all(&backend).expect("backend");
        std::fs::write(
            logs.join("shell.log"),
            "{\"event\":\"panic_report\",\"file\":\"shell-panic-1.txt\"}\n",
        )
        .expect("shell log");
        std::fs::write(logs.join("shell.log.2"), "old").expect("rotated");
        std::fs::write(logs.join("shell-panic-1.txt"), "report").expect("report");
        std::fs::write(backend.join("backend.log"), "backend").expect("backend log");
        let entries = diagnostics::gather(&logs, Some(&backend.join("backend.log")), "154.0.1", 0);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        for expected in [
            "info.txt",
            "shell/shell.log",
            "shell/shell.log.2",
            "shell/shell-panic-1.txt",
            "backend/backend.log",
        ] {
            assert!(names.contains(&expected), "missing {expected} in {names:?}");
        }
    }

    #[cfg(feature = "smoke")]
    #[test]
    fn the_zip_lands_only_in_the_smoke_save_folder() {
        let root = scratch();
        set_log_dir(&root);
        let saved = root.join("saved");
        let mut launch = Launch {
            scrubbed: Vec::new(),
            smoke: crate::smoke_options::SmokeOptions::for_tests(),
        };
        launch.smoke.save_dir = Some(saved.clone());
        let path = export_diagnostics(&launch, None)
            .expect("export")
            .expect("a path");
        assert!(path.starts_with(&saved) && path.exists());
        launch.smoke.save_dir = Some(PathBuf::from(r"D:\dev\tmp\nqt-crash-outside"));
        assert!(matches!(
            export_diagnostics(&launch, None),
            Err(ShellError::Refused(_))
        ));
        launch.smoke.save_dir = None;
        assert!(
            matches!(export_diagnostics(&launch, None), Ok(None)),
            "no folder: the dialog fails closed"
        );
    }
}
