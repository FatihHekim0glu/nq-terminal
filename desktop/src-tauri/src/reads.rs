//! The one sanctioned read module (03 section 6 item 2). The shell has no data path: clippy.toml bans the std::fs
//! read functions everywhere else, and this module reads only three small things, each with a size cap: the
//! backend's lock file, the shell's settings file and the tail of a log file. It never lists or reads lab data.
#![allow(
    dead_code,
    reason = "read_lock and read_log_tail are wired by stage B (supervise.rs, crash.rs)"
)]

use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// The lock file is one line of JSON.
pub const LOCK_MAX_BYTES: u64 = 64 * 1024;
/// The settings file is small JSON.
pub const SETTINGS_MAX_BYTES: u64 = 64 * 1024;
/// The most a log tail may ask for.
pub const LOG_TAIL_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    Missing(PathBuf),
    TooLarge { path: PathBuf, size: u64, max: u64 },
    NotText(PathBuf),
    Io { path: PathBuf, why: String },
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(p) => write!(f, "{} does not exist", p.display()),
            Self::TooLarge { path, size, max } => {
                write!(f, "{} is {size} bytes, more than {max}", path.display())
            }
            Self::NotText(p) => write!(f, "{} is not UTF-8 text", p.display()),
            Self::Io { path, why } => write!(f, "cannot read {}: {why}", path.display()),
        }
    }
}

impl std::error::Error for ReadError {}

fn io_error(path: &Path, e: &std::io::Error) -> ReadError {
    if e.kind() == std::io::ErrorKind::NotFound {
        ReadError::Missing(path.to_path_buf())
    } else {
        ReadError::Io {
            path: path.to_path_buf(),
            why: e.to_string(),
        }
    }
}

/// Reads a whole file of at most `max` bytes, refusing a bigger one without reading it.
#[allow(
    clippy::disallowed_methods,
    reason = "one of the two functions allowed to open a file for reading (03 section 6 item 2)"
)]
fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, ReadError> {
    let file = File::open(path).map_err(|e| io_error(path, &e))?;
    let size = file.metadata().map_err(|e| io_error(path, &e))?.len();
    if size > max {
        return Err(ReadError::TooLarge {
            path: path.to_path_buf(),
            size,
            max,
        });
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error(path, &e))?;
    if bytes.len() as u64 > max {
        return Err(ReadError::TooLarge {
            path: path.to_path_buf(),
            size: bytes.len() as u64,
            max,
        });
    }
    Ok(bytes)
}

fn text(path: &Path, bytes: Vec<u8>) -> Result<String, ReadError> {
    String::from_utf8(bytes).map_err(|_| ReadError::NotText(path.to_path_buf()))
}

/// The backend's lock file (`<state>/backend.lock`). The backend holds it open sharing read only, which a plain
/// read open allows. Parsing belongs to supervise.rs.
pub fn read_lock(path: &Path) -> Result<String, ReadError> {
    let bytes = read_capped(path, LOCK_MAX_BYTES)?;
    text(path, bytes)
}

/// The shell's settings file, or None when there is none yet (first run).
pub fn read_settings(path: &Path) -> Result<Option<String>, ReadError> {
    match read_capped(path, SETTINGS_MAX_BYTES) {
        Ok(bytes) => text(path, bytes).map(Some),
        Err(ReadError::Missing(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// The last `max_bytes` (capped at 1 MiB) of a log file, for the stopped page and the diagnostics.
#[allow(
    clippy::disallowed_methods,
    reason = "one of the two functions allowed to open a file for reading (03 section 6 item 2)"
)]
pub fn read_log_tail(path: &Path, max_bytes: u64) -> Result<Vec<u8>, ReadError> {
    let want = max_bytes.min(LOG_TAIL_MAX_BYTES);
    let mut file = File::open(path).map_err(|e| io_error(path, &e))?;
    let size = file.metadata().map_err(|e| io_error(path, &e))?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(want)))
        .map_err(|e| io_error(path, &e))?;
    let mut bytes = Vec::new();
    file.take(want)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error(path, &e))?;
    Ok(bytes)
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests make and remove fixture files; not shipped code"
)]
mod tests {
    use super::*;

    /// A fresh folder under the process's temporary folder (D:\dev\tmp under the build prelude).
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nqt-reads-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    #[test]
    fn lock_and_settings_read_back() {
        let dir = scratch("back");
        std::fs::write(dir.join("backend.lock"), "{\"port\":53117}\n").expect("write");
        assert_eq!(
            read_lock(&dir.join("backend.lock")).as_deref(),
            Ok("{\"port\":53117}\n")
        );
        assert_eq!(read_settings(&dir.join("settings.json")), Ok(None));
        assert!(matches!(
            read_lock(&dir.join("absent.lock")),
            Err(ReadError::Missing(_))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_or_binary_files_are_refused() {
        let dir = scratch("big");
        let big = dir.join("settings.json");
        std::fs::write(&big, vec![b'x'; (SETTINGS_MAX_BYTES + 1) as usize]).expect("write");
        assert!(matches!(
            read_settings(&big),
            Err(ReadError::TooLarge { .. })
        ));
        std::fs::write(dir.join("backend.lock"), [0xff, 0xfe, 0x00]).expect("write");
        assert!(matches!(
            read_lock(&dir.join("backend.lock")),
            Err(ReadError::NotText(_))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_returns_the_end_only() {
        let dir = scratch("tail");
        let log = dir.join("backend.log");
        std::fs::write(&log, b"0123456789").expect("write");
        assert_eq!(read_log_tail(&log, 4), Ok(b"6789".to_vec()));
        assert_eq!(read_log_tail(&log, 100), Ok(b"0123456789".to_vec()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
