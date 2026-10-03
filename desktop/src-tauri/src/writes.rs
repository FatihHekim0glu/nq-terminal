//! The one write module (03 section 6 item 3; 04 D4.4; 02 C3-7; 05 X05). Every file the shell writes goes through
//! `append`, `rotate` or `write_new`, and each through the ONE check below; clippy.toml bans the other write calls.
//! Page downloads are written by WebView2, so they are checked before and after (`on_download_starting`).
//! An ALLOW list: inside the picked lab only `terminal/state/**` is writable; outside it, the config folder, the
//! save folders and the files the owner chose (`choose`: the save dialog's answer or the smoke `--save-dir`).
//!
//! Path stage: `\\?\` is stripped; UNC paths (`\\localhost\C$` is mapped to its drive only to word the refusal),
//! `\\.\` device paths, alternate data streams (a colon after the drive), device names (`NUL`, `con.txt`), names
//! ending in a dot or a space, wildcards and relative parts are refused outright; the deepest existing folder is
//! expanded from 8.3 names (GetLongPathNameW) and resolved through junctions and symlinks; the comparison is
//! case-insensitive, by whole components. Handle stage, which closes the gap between check and use: the REAL path
//! is opened with FILE_FLAG_OPEN_REPARSE_POINT; a reparse point, a folder or a second hard link is refused; the
//! handle's final path (GetFinalPathNameByHandleW) is checked again; a file this call created and then refused is
//! deleted through the handle; the bytes go through that handle. `rotate` checks every source and target first. No
//! clipboard command exists: the W0A probes found the page's Clipboard API working (02 C3-1).

use std::ffi::OsString;
use std::fmt;
use std::fs::File;
use std::io::Write;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::{Mutex, OnceLock, PoisonError};
use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError, HANDLE};
use windows::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CREATE_NEW, CreateDirectoryW, CreateFileW, DELETE,
    FILE_ACCESS_RIGHTS, FILE_APPEND_DATA, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_CREATION_DISPOSITION, FILE_DISPOSITION_INFO,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_WRITE, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FileDispositionInfo,
    GetFileInformationByHandle, GetFinalPathNameByHandleW, GetLongPathNameW,
    MOVEFILE_WRITE_THROUGH, MoveFileExW, OPEN_ALWAYS, OPEN_EXISTING, SYNCHRONIZE,
    SetFileInformationByHandle,
};
use windows::core::HSTRING;

/// The one writable subtree inside the lab.
pub const LAB_WRITABLE: [&str; 2] = ["terminal", "state"];
const LAB_ONLY: &str = "inside the lab only terminal/state is writable";
/// Names Windows maps to a device in any folder, with or without an extension (and COM0 to LPT9, below).
const DEVICE_NAMES: [&str; 6] = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
const BAD_CHARS: [char; 8] = ['<', '>', '"', '/', '\\', '|', '?', '*'];
const FINAL_PATH_CAP: usize = 32_768;

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
/// Files the owner chose (real paths, folded): each is writable on its own, never its folder.
static CHOSEN: Mutex<Vec<Vec<String>>> = Mutex::new(Vec::new());

/// Sets the policy once, before the first write.
pub fn configure(policy: WritePolicy) -> Result<(), WriteError> {
    POLICY
        .set(policy)
        .map_err(|_| WriteError::AlreadyConfigured)
}

fn global() -> Result<&'static WritePolicy, WriteError> {
    POLICY.get().ok_or(WriteError::NotConfigured)
}

/// Appends bytes to a file, creating it (and its folders) when absent.
pub fn append(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    global()?.append(path, bytes)
}

/// Writes a new file; refuses one that already exists.
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    global()?.write_new(path, bytes)
}

/// Rotates a log (see [`WritePolicy::rotate`]).
pub fn rotate(path: &Path, max_bytes: u64, keep: u32) -> Result<bool, WriteError> {
    global()?.rotate(path, max_bytes, keep)
}

/// Makes one file the owner chose (save dialog answer) writable; returns its real path.
pub fn choose(path: &Path) -> Result<PathBuf, WriteError> {
    global()?.choose(path)
}

fn refused<T>(path: &Path, why: &'static str) -> Result<T, WriteError> {
    Err(WriteError::Refused {
        path: path.to_path_buf(),
        why,
    })
}

fn io(path: &Path, e: &dyn fmt::Display) -> WriteError {
    WriteError::Io {
        path: path.to_path_buf(),
        why: e.to_string(),
    }
}

/// Whether a name is a reserved device name (`NUL`, `con.txt`, `COM1.log`, `LPT¹` ...).
pub(crate) fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default();
    let stem = stem.trim_end_matches(' ').to_uppercase();
    if DEVICE_NAMES.contains(&stem.as_str()) {
        return true;
    }
    let chars: Vec<char> = stem.chars().collect();
    let numbered = matches!(chars.get(3), Some('0'..='9' | '¹' | '²' | '³'));
    chars.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && numbered
}

/// One path component: refuses a name Windows would read differently from how the policy reads it.
fn check_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("relative parts (. or ..) in the path");
    }
    if name.contains(':') {
        return Err("an NTFS alternate data stream (a colon after the drive)");
    }
    if name.contains(BAD_CHARS) || name.chars().any(|c| u32::from(c) < 0x20) {
        return Err("a character no file name may hold");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("a name ending in a dot or a space (Windows strips it)");
    }
    if is_device_name(name) {
        return Err("a reserved device name (NUL, CON, COM1 and the rest)");
    }
    Ok(())
}

/// The drive letter a UNC path to this PC's own admin share stands for (`\\localhost\D$` is `D:\`).
pub(crate) fn local_share(server: &std::ffi::OsStr, share: &std::ffi::OsStr) -> Option<u8> {
    let server = server.to_string_lossy().to_lowercase();
    let computer = std::env::var("COMPUTERNAME")
        .unwrap_or_default()
        .to_lowercase();
    let local =
        ["localhost", "127.0.0.1", "::1", "."].contains(&server.as_str()) || server == computer;
    let share = share.to_string_lossy();
    let bytes = share.as_bytes();
    let drive =
        (bytes.len() == 2 && bytes[1] == b'$' && bytes[0].is_ascii_alphabetic()).then(|| bytes[0]);
    drive.filter(|_| local)
}

/// The plain drive form of a path (`D:\a\b`), refusing every spelling the policy cannot read as written.
pub(crate) fn lexical(path: &Path) -> Result<PathBuf, &'static str> {
    let mut parts = path.components();
    let drive = match parts.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d.to_ascii_uppercase(),
            // Refused either way; this PC's own share is mapped to its drive only to word the refusal.
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
                return Err(match local_share(server, share) {
                    Some(_) => {
                        "a UNC path to this PC's own drive (the same folder by another name)"
                    }
                    None => "a UNC (network) path",
                });
            }
            Prefix::DeviceNS(_) => return Err("a device path (\\\\.\\)"),
            Prefix::Verbatim(_) => return Err("a \\\\?\\ path that names no drive letter"),
        },
        _ => return Err("not an absolute path with a drive letter"),
    };
    if parts.next() != Some(Component::RootDir) {
        return Err("not an absolute path with a drive letter");
    }
    let mut out = PathBuf::from(format!("{}:\\", char::from(drive)));
    for part in parts {
        let Component::Normal(name) = part else {
            return Err("relative parts (. or ..) in the path");
        };
        let name = name.to_str().ok_or("a name that is not valid Unicode")?;
        check_name(name)?;
        out.push(name);
    }
    Ok(out)
}

/// GetLongPathNameW: the 8.3 parts of an existing path written out in full (the path itself when it fails).
fn long_name(path: &Path) -> PathBuf {
    let wide = HSTRING::from(path.as_os_str());
    let mut buf = vec![0u16; FINAL_PATH_CAP];
    // SAFETY: a read-only query into a buffer that outlives the call.
    let n = unsafe { GetLongPathNameW(&wide, Some(&mut buf)) } as usize;
    match buf.get(..n) {
        Some(long) if n > 0 => PathBuf::from(String::from_utf16_lossy(long)),
        _ => path.to_path_buf(),
    }
}

/// Where an existing path really is: 8.3 names expanded, junctions and symlinks followed, in the plain drive form.
fn real_existing(path: &Path) -> std::io::Result<Result<PathBuf, &'static str>> {
    let real = std::fs::canonicalize(long_name(path))?;
    Ok(lexical(&real))
}

/// The path stage: the real path a write to `path` would reach. Missing trailing parts are kept as written (they
/// cannot be links); the deepest existing folder is resolved.
fn resolve(path: &Path) -> Result<PathBuf, WriteError> {
    let plain = lexical(path).or_else(|why| refused(path, why))?;
    let mut existing = plain.as_path();
    let mut missing: Vec<OsString> = Vec::new();
    loop {
        match real_existing(existing) {
            Ok(Ok(mut real)) => {
                real.extend(missing.iter().rev());
                return Ok(real);
            }
            Ok(Err(why)) => return refused(path, why),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let (Some(name), Some(parent)) = (existing.file_name(), existing.parent()) else {
                    return refused(path, "no part of the path exists");
                };
                missing.push(name.to_os_string());
                existing = parent;
            }
            Err(e) => return Err(io(path, &e)),
        }
    }
}

/// Path parts folded for a case-insensitive comparison.
fn folded(path: &Path) -> Vec<String> {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

fn starts(parts: &[String], root: &[String]) -> bool {
    parts.len() >= root.len() && parts[..root.len()] == root[..]
}

fn below(parts: &[String], root: &[String]) -> bool {
    parts.len() > root.len() && starts(parts, root)
}

/// A policy folder in its real, folded form; `None` when it cannot be read as a plain drive path.
fn root(dir: &Path) -> Option<Vec<String>> {
    resolve(dir).ok().map(|real| folded(&real))
}

impl WritePolicy {
    /// The folded real path of the lab's writable subtree.
    fn lab_state(lab: &[String]) -> Vec<String> {
        [lab.to_vec(), LAB_WRITABLE.map(String::from).to_vec()].concat()
    }

    /// The lab rule for a folded real path: `None` outside the lab (or with no lab), else the answer.
    fn lab_rule(&self, parts: &[String]) -> Option<Result<(), &'static str>> {
        let Some(lab) = root(self.lab.as_deref()?) else {
            return Some(Err("the lab folder cannot be resolved"));
        };
        let writable = below(parts, &Self::lab_state(&lab));
        starts(parts, &lab).then_some(if writable { Ok(()) } else { Err(LAB_ONLY) })
    }

    /// The decision on a REAL path. `extra` is one more allowed folder (a download's chosen folder).
    fn decide(&self, real: &Path, extra: Option<&[String]>) -> Result<(), &'static str> {
        let parts = folded(real);
        if let Some(rule) = self.lab_rule(&parts) {
            return rule;
        }
        let roots = std::iter::once(&self.config_dir).chain(&self.save_dirs);
        if roots.filter_map(|dir| root(dir)).any(|r| below(&parts, &r))
            || extra.is_some_and(|r| below(&parts, r))
        {
            return Ok(());
        }
        let chosen = CHOSEN.lock().unwrap_or_else(PoisonError::into_inner);
        chosen
            .contains(&parts)
            .then_some(())
            .ok_or("outside the config folder, the save folders and the files the owner chose")
    }

    /// The path stage and the policy: the real path a write would reach, or the refusal.
    pub fn check(&self, path: &Path) -> Result<PathBuf, WriteError> {
        let real = resolve(path)?;
        self.decide(&real, None).or_else(|why| refused(path, why))?;
        Ok(real)
    }

    /// A file the owner chose: inside the lab the lab rule holds; outside it any file is the owner's choice. The
    /// real path is remembered, so the file itself (never its folder) passes later checks.
    pub fn choose(&self, path: &Path) -> Result<PathBuf, WriteError> {
        let real = resolve(path)?;
        if let Some(Err(why)) = self.lab_rule(&folded(&real)) {
            return refused(path, why);
        }
        let mut chosen = CHOSEN.lock().unwrap_or_else(PoisonError::into_inner);
        if !chosen.contains(&folded(&real)) {
            chosen.push(folded(&real));
        }
        Ok(real)
    }

    /// A folder may be created only at or below an allowed root (never a lab folder outside terminal/state).
    fn may_create(&self, folder: &Path) -> bool {
        let parts = folded(folder);
        let lab_state = self
            .lab
            .as_deref()
            .and_then(root)
            .map(|lab| Self::lab_state(&lab));
        let roots = std::iter::once(&self.config_dir).chain(&self.save_dirs);
        lab_state
            .into_iter()
            .chain(roots.filter_map(|dir| root(dir)))
            .any(|r| starts(&parts, &r))
    }

    /// Creates the missing folders above a checked real path, top down.
    #[allow(
        clippy::disallowed_methods,
        reason = "the write module's own folder creation (03 section 6 item 3), on a checked real path"
    )]
    fn make_parents(&self, real: &Path) -> Result<(), WriteError> {
        let Some(parent) = real.parent() else {
            return Ok(());
        };
        let missing: Vec<&Path> = parent.ancestors().take_while(|a| !a.exists()).collect();
        for folder in missing.into_iter().rev() {
            if !self.may_create(folder) {
                return refused(folder, "a folder outside the writable places");
            }
            // SAFETY: a plain call with a path string that outlives it.
            let made = unsafe { CreateDirectoryW(&HSTRING::from(folder.as_os_str()), None) };
            // SAFETY: GetLastError right after the failed call on this thread.
            if made.is_err() && unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
                return Err(io(folder, &std::io::Error::last_os_error()));
            }
        }
        Ok(())
    }
}

/// The final path of an open handle, in the plain drive form.
fn final_path(file: &File) -> Result<PathBuf, &'static str> {
    let mut buf = vec![0u16; FINAL_PATH_CAP];
    let handle = HANDLE(file.as_raw_handle());
    // SAFETY: a read-only query on a handle `file` keeps open, into a buffer that outlives the call.
    let n = unsafe { GetFinalPathNameByHandleW(handle, &mut buf, FILE_NAME_NORMALIZED) } as usize;
    let text = buf
        .get(..n)
        .filter(|_| n > 0)
        .ok_or("the final path cannot be read")?;
    lexical(&PathBuf::from(String::from_utf16_lossy(text)))
}

fn file_info(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION, &'static str> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: a read-only query on a handle `file` keeps open.
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|_| "the file's information cannot be read")?;
    Ok(info)
}

/// Marks an open file for deletion; it goes when the last handle closes.
#[allow(
    clippy::disallowed_methods,
    reason = "the handle stage deletes by the handle it opened"
)]
fn delete_by_handle(file: &File) -> windows::core::Result<()> {
    let info = FILE_DISPOSITION_INFO { DeleteFile: true };
    let size = u32::try_from(std::mem::size_of::<FILE_DISPOSITION_INFO>()).unwrap_or(1);
    // SAFETY: the handle was opened with DELETE access and `info` outlives the call.
    unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            std::ptr::from_ref(&info).cast(),
            size,
        )
    }
}

/// An open file and whether this call created it.
struct Opened(File, bool);

/// Opens a REAL path without following a reparse point in its last part.
#[allow(
    clippy::disallowed_methods,
    reason = "the handle stage of the write module (03 section 6 item 3): one open by the checked real path"
)]
fn open(
    real: &Path,
    access: FILE_ACCESS_RIGHTS,
    how: FILE_CREATION_DISPOSITION,
) -> std::io::Result<Opened> {
    let access = access | DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
    let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    let flags = FILE_FLAG_OPEN_REPARSE_POINT | FILE_ATTRIBUTE_NORMAL;
    let name = HSTRING::from(real.as_os_str());
    // SAFETY: a plain open with a path string that outlives the call; the handle is owned at once below.
    let handle = unsafe { CreateFileW(&name, access.0, share, None, how, flags, None) }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0 & 0xFFFF))?;
    // SAFETY: GetLastError right after the successful call on this thread (OPEN_ALWAYS reports an existing file).
    let existed = how == OPEN_EXISTING
        || (how == OPEN_ALWAYS && unsafe { GetLastError() } == ERROR_ALREADY_EXISTS);
    // SAFETY: CreateFileW returned a valid handle that nothing else owns.
    let file = File::from(unsafe { OwnedHandle::from_raw_handle(handle.0) });
    Ok(Opened(file, !existed))
}

impl WritePolicy {
    /// The handle checks: no reparse point, no folder, one link only, and the final path allowed again.
    fn verify(&self, file: &File, extra: Option<&[String]>) -> Result<(), &'static str> {
        let info = file_info(file)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Err("a reparse point (junction or symlink)");
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0 {
            return Err("a folder, not a file");
        }
        if info.nNumberOfLinks != 1 {
            return Err("a file with another hard link");
        }
        self.decide(&final_path(file)?, extra)
    }

    /// Opens a checked real path and runs the handle checks; a file this call created and then refused is deleted.
    fn open_checked(
        &self,
        path: &Path,
        real: &Path,
        access: FILE_ACCESS_RIGHTS,
        how: FILE_CREATION_DISPOSITION,
    ) -> Result<File, WriteError> {
        let opened = open(real, access, how).map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => WriteError::Exists(path.to_path_buf()),
            _ => io(path, &e),
        })?;
        match self.verify(&opened.0, None) {
            Ok(()) => Ok(opened.0),
            Err(why) => {
                if opened.1 {
                    let _ = delete_by_handle(&opened.0);
                }
                refused(path, why)
            }
        }
    }

    /// Appends bytes to a file, creating it (and its folders) when absent.
    pub fn append(&self, path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
        let real = self.check(path)?;
        self.make_parents(&real)?;
        let mut file = self.open_checked(path, &real, FILE_APPEND_DATA, OPEN_ALWAYS)?;
        file.write_all(bytes).map_err(|e| io(path, &e))
    }

    /// Writes a new file; refuses one that already exists (with the refusal's reason when the existing name is a
    /// link, a hard link or a folder).
    pub fn write_new(&self, path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
        let real = self.check(path)?;
        self.make_parents(&real)?;
        let mut file = match self.open_checked(path, &real, FILE_GENERIC_WRITE, CREATE_NEW) {
            Err(WriteError::Exists(_)) => return Err(self.why_exists(path, &real)),
            other => other?,
        };
        file.write_all(bytes).map_err(|e| io(path, &e))
    }

    /// For an existing name: the refusal when it is not a plain one-link file in an allowed place, else Exists.
    fn why_exists(&self, path: &Path, real: &Path) -> WriteError {
        match self.open_checked(path, real, FILE_READ_ATTRIBUTES, OPEN_EXISTING) {
            Err(refusal @ WriteError::Refused { .. }) => refusal,
            _ => WriteError::Exists(path.to_path_buf()),
        }
    }
}

fn numbered(path: &Path, n: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{n}"));
    PathBuf::from(name)
}

impl WritePolicy {
    /// Opens an existing file for a rename or delete and checks it by handle; `None` when it does not exist.
    fn existing(&self, path: &Path) -> Result<Option<File>, WriteError> {
        let real = self.check(path)?;
        let opened = match open(&real, FILE_READ_ATTRIBUTES, OPEN_EXISTING) {
            Ok(opened) => opened,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(io(path, &e)),
        };
        self.verify(&opened.0, None)
            .or_else(|why| refused(path, why))?;
        Ok(Some(opened.0))
    }

    /// When `path` is larger than `max_bytes`, drops `path.<keep>`, shifts `path.1 .. path.<keep-1>` up by one and
    /// moves `path` to `path.1`, so at most `keep` old files remain. Every source and target is checked by path
    /// and by handle BEFORE anything is deleted or moved. Returns whether it rotated.
    pub fn rotate(&self, path: &Path, max_bytes: u64, keep: u32) -> Result<bool, WriteError> {
        let Some(source) = self.existing(path)? else {
            return Ok(false);
        };
        let info = file_info(&source).or_else(|why| refused(path, why))?;
        let size = (u64::from(info.nFileSizeHigh) << 32) | u64::from(info.nFileSizeLow);
        if size <= max_bytes || keep == 0 {
            return Ok(false);
        }
        let real = self.check(path)?;
        let mut olds: Vec<(PathBuf, Option<File>)> = Vec::new();
        for n in 1..=keep {
            let name = numbered(&real, n);
            olds.push((name.clone(), self.existing(&name)?));
        }
        drop(source);
        if let Some((_, Some(oldest))) = olds.last() {
            delete_by_handle(oldest).map_err(|e| io(path, &e))?;
        }
        let present: Vec<bool> = olds.iter().map(|(_, file)| file.is_some()).collect();
        drop(olds);
        for n in (1..keep).rev() {
            if present[n as usize - 1] {
                move_file(&numbered(&real, n), &numbered(&real, n + 1))?;
            }
        }
        move_file(&real, &numbered(&real, 1))?;
        Ok(true)
    }
}

/// MoveFileExW between two checked real paths in the same folder, never replacing a file.
#[allow(
    clippy::disallowed_methods,
    reason = "the rotation of the write module (03 section 6 item 3), between two checked real paths"
)]
fn move_file(from: &Path, to: &Path) -> Result<(), WriteError> {
    let (a, b) = (
        HSTRING::from(from.as_os_str()),
        HSTRING::from(to.as_os_str()),
    );
    // SAFETY: a plain call with two path strings that outlive it.
    unsafe { MoveFileExW(&a, &b, MOVEFILE_WRITE_THROUGH) }.map_err(|e| io(from, &e))
}

/// Checks a file WebView2 finished writing, by handle: it must be a plain one-link file inside the folder the owner
/// chose (the engine may rename it there), or otherwise allowed. A refused file is deleted through the handle.
fn verify_download(written: &Path, chosen: &Path) -> Result<PathBuf, WriteError> {
    let policy = global()?;
    let plain = lexical(written).or_else(|why| refused(written, why))?;
    let opened = open(&plain, FILE_READ_ATTRIBUTES, OPEN_EXISTING).map_err(|e| io(written, &e))?;
    let folder = resolve(chosen)?.parent().map(folded);
    match policy.verify(&opened.0, folder.as_deref()) {
        Ok(()) => Ok(plain),
        Err(why) => {
            delete_by_handle(&opened.0).map_err(|e| io(written, &e))?;
            refused(written, why)
        }
    }
}

/// Install order of the download guard: the DownloadStarting handler first, so it can never be skipped by the
/// backstop folder, which is best-effort (an older runtime lacks the profile interface). A refused guard fails the
/// install and the backstop is not tried; a refused backstop is returned as text for the log.
pub(crate) fn install_guard_first<E: fmt::Display>(
    guard: impl FnOnce() -> Result<(), E>,
    backstop: impl FnOnce() -> Result<(), E>,
) -> Result<Option<String>, E> {
    guard()?;
    Ok(backstop().err().map(|e| e.to_string()))
}

#[cfg(not(test))]
#[path = "writes_download.rs"]
mod download;

#[cfg(not(test))]
pub use download::on_download_starting;

/// The test-build stand-in: a test exe carries MinGW's default manifest, not the shell's Common-Controls 6 one,
/// so it cannot load the webview code; tests/downloads.rs proves the real handler through the smoke exe.
#[cfg(test)]
pub fn on_download_starting<W>(_: &W, _: &crate::Launch) -> Result<(), crate::ShellError> {
    type Check = fn(&Path, &Path) -> Result<PathBuf, WriteError>;
    type Choose = fn(&Path) -> Result<PathBuf, WriteError>;
    let _ = (verify_download as Check, choose as Choose);
    let _ = install_guard_first(|| Ok::<(), String>(()), || Ok(()));
    Ok(())
}
