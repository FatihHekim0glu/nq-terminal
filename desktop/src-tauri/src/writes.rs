//! The one write module (03 section 6 item 3; 04 D4.4). Every file the shell writes (its settings, its logs, the
//! backend's log, panic reports, the diagnostics zip, downloads) goes through `append`, `rotate` or `write_new`,
//! and each of them through the ONE check below. clippy.toml bans the std::fs write functions everywhere else.
//!
//! STAGE A: the interface is final and the check is the simple stub the plan fixes: inside the lab, refuse
//! everything except `terminal/state/**`, by prefix, case-insensitively. Stage B (slice w4b-writes-downloads)
//! hardens it without changing a signature: canonical paths through junctions and symlinks, 8.3 names, the `\\?\`
//! prefix, UNC forms, alternate data streams, device names, the handle stage (no reparse point, final path re-checked,
//! one link only) and the outside-the-lab allow list (the config folder and the chosen save folders). It also
//! fills `on_download_starting` (DownloadStarting with a deferral).
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError};
use std::fmt;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use tauri::WebviewWindow;

/// The one writable subtree inside the lab.
pub const LAB_WRITABLE: [&str; 2] = ["terminal", "state"];

/// What the check allows, fixed once at start-up.
#[derive(Clone, Debug)]
pub struct WritePolicy {
    /// The picked lab; inside it only `terminal/state/**` is writable.
    pub lab: Option<PathBuf>,
    /// The build identity's config folder (or the smoke `--config-dir`).
    pub config_dir: PathBuf,
    /// Folders the owner chose for downloads and the diagnostics zip (or the smoke `--save-dir`).
    pub save_dirs: Vec<PathBuf>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WriteError {
    /// `configure` has not run (or ran twice).
    NotConfigured,
    AlreadyConfigured,
    Refused {
        path: PathBuf,
        why: &'static str,
    },
    Exists(PathBuf),
    Io {
        path: PathBuf,
        why: String,
    },
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConfigured => write!(f, "the write policy is not set"),
            Self::AlreadyConfigured => write!(f, "the write policy is already set"),
            Self::Refused { path, why } => write!(f, "write to {} refused: {why}", path.display()),
            Self::Exists(path) => write!(f, "{} already exists", path.display()),
            Self::Io { path, why } => write!(f, "cannot write {}: {why}", path.display()),
        }
    }
}

impl std::error::Error for WriteError {}

static POLICY: OnceLock<WritePolicy> = OnceLock::new();

/// Sets the policy once, before the first write.
pub fn configure(policy: WritePolicy) -> Result<(), WriteError> {
    POLICY
        .set(policy)
        .map_err(|_| WriteError::AlreadyConfigured)
}

fn folded(component: Component<'_>) -> String {
    component.as_os_str().to_string_lossy().to_lowercase()
}

/// Whether the folded path parts lie strictly below the folder, by whole components.
fn below(parts: &[String], dir: &Path) -> bool {
    let dir_parts: Vec<String> = dir.components().map(folded).collect();
    parts.len() > dir_parts.len() && parts[..dir_parts.len()] == dir_parts[..]
}

/// The single check. STUB rule: the path must be absolute; inside the lab only `terminal/state/**` passes.
fn check(policy: &WritePolicy, path: &Path) -> Result<PathBuf, WriteError> {
    let refuse = |why| {
        Err(WriteError::Refused {
            path: path.to_path_buf(),
            why,
        })
    };
    if !path.is_absolute() {
        return refuse("not an absolute path");
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return refuse("relative parts in the path");
    }
    let parts: Vec<String> = path.components().map(folded).collect();
    let Some(lab) = &policy.lab else {
        // Fail closed: with no lab only the config folder and the chosen save folders are writable.
        let allowed = std::iter::once(&policy.config_dir).chain(&policy.save_dirs);
        return if allowed.into_iter().any(|dir| below(&parts, dir)) {
            Ok(path.to_path_buf())
        } else {
            refuse("outside the config and save folders")
        };
    };
    let lab_parts: Vec<String> = lab.components().map(folded).collect();
    if parts.len() < lab_parts.len() || parts[..lab_parts.len()] != lab_parts[..] {
        return Ok(path.to_path_buf());
    }
    let inside = &parts[lab_parts.len()..];
    let writable = inside.len() > LAB_WRITABLE.len()
        && inside[..LAB_WRITABLE.len()] == LAB_WRITABLE.map(str::to_string);
    if writable {
        Ok(path.to_path_buf())
    } else {
        refuse("inside the lab only terminal/state is writable")
    }
}

fn checked(path: &Path) -> Result<PathBuf, WriteError> {
    let policy = POLICY.get().ok_or(WriteError::NotConfigured)?;
    check(policy, path)
}

fn io(path: &Path, e: &std::io::Error) -> WriteError {
    WriteError::Io {
        path: path.to_path_buf(),
        why: e.to_string(),
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "one of the four functions allowed to write files (03 section 6 item 3)"
)]
fn parent_folder(path: &Path) -> Result<(), WriteError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent).map_err(|e| io(parent, &e))
}

/// Appends bytes to a file, creating it (and its folder) when absent.
#[allow(
    clippy::disallowed_methods,
    reason = "one of the four functions allowed to write files (03 section 6 item 3)"
)]
pub fn append(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let path = checked(path)?;
    parent_folder(&path)?;
    let mut file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path)
        .map_err(|e| io(&path, &e))?;
    file.write_all(bytes).map_err(|e| io(&path, &e))
}

/// Writes a new file; refuses one that already exists.
#[allow(
    clippy::disallowed_methods,
    reason = "one of the four functions allowed to write files (03 section 6 item 3)"
)]
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let path = checked(path)?;
    parent_folder(&path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => WriteError::Exists(path.clone()),
            _ => io(&path, &e),
        })?;
    file.write_all(bytes).map_err(|e| io(&path, &e))
}

fn numbered(path: &Path, n: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

/// When `path` is larger than `max_bytes`, shifts `path.1 .. path.<keep-1>` up by one, moves `path` to `path.1`
/// and drops the oldest, so at most `keep` old files remain. Every source and target passes the check. Returns
/// whether it rotated.
#[allow(
    clippy::disallowed_methods,
    reason = "one of the four functions allowed to write files (03 section 6 item 3)"
)]
pub fn rotate(path: &Path, max_bytes: u64, keep: u32) -> Result<bool, WriteError> {
    let path = checked(path)?;
    let size = match std::fs::metadata(&path) {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(io(&path, &e)),
    };
    if size <= max_bytes || keep == 0 {
        return Ok(false);
    }
    let oldest = checked(&numbered(&path, keep))?;
    if let Err(e) = std::fs::remove_file(&oldest)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        return Err(io(&oldest, &e));
    }
    for n in (1..keep).rev() {
        let (from, to) = (
            checked(&numbered(&path, n))?,
            checked(&numbered(&path, n + 1))?,
        );
        if from.exists() {
            std::fs::rename(&from, &to).map_err(|e| io(&from, &e))?;
        }
    }
    let first = checked(&numbered(&path, 1))?;
    std::fs::rename(&path, &first).map_err(|e| io(&path, &e))?;
    Ok(true)
}

/// Registers the WebView2 DownloadStarting handler (deferral, save dialog through dialogs.rs or the smoke
/// `--save-dir`, the path checked before and after). STUB: registers nothing yet.
pub fn on_download_starting(window: &WebviewWindow, launch: &Launch) -> Result<(), ShellError> {
    let _ = (window, launch);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> WritePolicy {
        WritePolicy {
            lab: Some(PathBuf::from(r"C:\Users\Owner\nq-lab")),
            config_dir: PathBuf::from(r"D:\cfg"),
            save_dirs: Vec::new(),
        }
    }

    #[test]
    fn inside_the_lab_only_terminal_state_passes() {
        let p = policy();
        assert!(
            check(
                &p,
                Path::new(r"C:\Users\Owner\nq-lab\terminal\state\logs\backend.log")
            )
            .is_ok()
        );
        assert!(
            check(
                &p,
                Path::new(r"c:\users\owner\NQ-LAB\Terminal\STATE\x.json")
            )
            .is_ok()
        );
        for refused in [
            r"C:\Users\Owner\nq-lab\results\ledger.csv",
            r"C:\Users\Owner\nq-lab\RESULTS\ledger.csv",
            r"C:\Users\Owner\nq-lab\data\x.parquet",
            r"C:\Users\Owner\nq-lab\.git\hooks\pre-commit",
            r"C:\Users\Owner\nq-lab\terminal\backend\app.py",
            r"C:\Users\Owner\nq-lab\terminal\state",
            r"C:\Users\Owner\nq-lab\terminal\state\..\..\results\x",
            r"C:\Users\Owner\nq-lab\x.txt",
            r"relative\file.txt",
        ] {
            assert!(check(&p, Path::new(refused)).is_err(), "accepted {refused}");
        }
    }

    #[test]
    fn outside_the_lab_passes_in_the_stub() {
        assert!(check(&policy(), Path::new(r"D:\cfg\logs\shell.log")).is_ok());
    }

    fn labless() -> WritePolicy {
        WritePolicy {
            lab: None,
            config_dir: PathBuf::from(r"D:\cfg"),
            save_dirs: vec![PathBuf::from(r"D:\out")],
        }
    }

    #[test]
    fn without_a_lab_only_the_config_and_save_folders_pass() {
        let p = labless();
        for allowed in [r"D:\cfg\logs\shell.log", r"d:\CFG\x.txt", r"D:\out\a.zip"] {
            assert!(check(&p, Path::new(allowed)).is_ok(), "refused {allowed}");
        }
        for refused in [
            r"C:\Users\Owner\nq-lab\results\x\shell.log",
            r"D:\cfgx\shell.log",
            r"D:\other\x.txt",
            r"D:\cfg",
            r"D:\cfg\..\other\x.txt",
        ] {
            assert!(check(&p, Path::new(refused)).is_err(), "accepted {refused}");
        }
    }
}
