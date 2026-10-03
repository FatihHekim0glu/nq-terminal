//! The one sanctioned read module (03 section 6 item 2). The shell has no data path: clippy.toml bans the std::fs
//! read functions everywhere else, and this module reads only three small things, each with a size cap: the
//! backend's lock file, the shell's settings file and the tail of a log file. It never lists or reads lab data.
//!
//! The lock file is trusted only as `backend/nq_terminal/desktop/lock.py` trusts it (05 X02): the owner and the
//! DACL are read from the very handle the text is read through, so a swapped name cannot change the answer. The
//! owner must be this user, SYSTEM or Administrators; the DACL must be protected and allow only those three, with
//! no inherited entry. Anything else is `ReadError::Untrusted`, and a caller treats it as "no attach".

use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
use windows::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW, GetSecurityInfo,
    SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows::Win32::Security::{
    DACL_SECURITY_INFORMATION, GetTokenInformation, OWNER_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::core::{HSTRING, PWSTR};

/// The lock file is one line of JSON.
pub const LOCK_MAX_BYTES: u64 = 64 * 1024;
/// The settings file is small JSON.
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes its settings from its switches, not from a file"
    )
)]
pub const SETTINGS_MAX_BYTES: u64 = 64 * 1024;
/// The most a log tail may ask for.
pub const LOG_TAIL_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    Missing(PathBuf),
    TooLarge {
        path: PathBuf,
        size: u64,
        max: u64,
    },
    NotText(PathBuf),
    Io {
        path: PathBuf,
        why: String,
    },
    /// The file's owner or rights are not the owner-only ones the backend gives its lock (05 X02).
    Untrusted {
        path: PathBuf,
        why: String,
    },
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
            Self::Untrusted { path, why } => {
                write!(f, "{} is not trusted: {why}", path.display())
            }
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
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes its settings from its switches, not from a file"
    )
)]
fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, ReadError> {
    let file = File::open(path).map_err(|e| io_error(path, &e))?;
    read_open(file, path, max)
}

/// Reads an already open file of at most `max` bytes.
fn read_open(file: File, path: &Path, max: u64) -> Result<Vec<u8>, ReadError> {
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

/// The SID of the user this process runs as, as text (S-1-5-21-...).
pub fn current_user_sid() -> Result<String, String> {
    // SAFETY: a query of this process's own token into a buffer that outlives the calls; the token handle and the
    // string the system allocates are each freed once.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| e.to_string())?;
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
        let got = GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            len,
            &mut len,
        );
        let _ = CloseHandle(token);
        got.map_err(|e| e.to_string())?;
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(|e| e.to_string())?;
        let sid = text.to_string().map_err(|e| e.to_string());
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        sid
    }
}

/// The owner and the DACL of an open file as SDDL text (`O:...D:...`), read from the handle itself.
fn handle_sddl(file: &File) -> Result<String, String> {
    let mut sd = PSECURITY_DESCRIPTOR::default();
    let mut text = PWSTR::null();
    let what = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    // SAFETY: reads the security of a handle the caller keeps open; the descriptor and the text the system
    // allocates are read while alive and each freed once.
    unsafe {
        let got = GetSecurityInfo(
            HANDLE(file.as_raw_handle()),
            SE_FILE_OBJECT,
            what,
            None,
            None,
            None,
            None,
            Some(&mut sd),
        );
        got.ok().map_err(|e| e.to_string())?;
        let made = ConvertSecurityDescriptorToStringSecurityDescriptorW(
            sd,
            SDDL_REVISION_1,
            what,
            &mut text,
            None,
        );
        let sddl = made
            .map_err(|e| e.to_string())
            .and_then(|()| text.to_string().map_err(|e| e.to_string()));
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        let _ = LocalFree(Some(HLOCAL(sd.0)));
        sddl
    }
}

const SYSTEM_SID: &str = "SY";
const ADMINISTRATORS_SID: &str = "BA";

/// Why an `O:...D:...` descriptor is not an owner-only one, or None when it is: the owner is the user, SYSTEM or
/// Administrators, and the DACL is protected with only allow entries for those three and no inherited entry. The
/// same two rules as lock.py's `is_trusted_owner` and `is_owner_only`.
fn untrusted_reason(sddl: &str, user_sid: &str) -> Option<String> {
    let allowed = [
        user_sid.to_uppercase(),
        SYSTEM_SID.to_string(),
        ADMINISTRATORS_SID.to_string(),
    ];
    let Some((owner_part, dacl)) = sddl.split_once("D:") else {
        return Some("it has no DACL".into());
    };
    let owner = owner_part.strip_prefix("O:").unwrap_or("");
    let owner = owner.split("G:").next().unwrap_or("").to_uppercase();
    if !allowed.contains(&owner) {
        return Some("its owner is not this user".into());
    }
    let head = dacl.split('(').next().unwrap_or("");
    if !head.contains('P') {
        return Some("its rights are not protected".into());
    }
    let mut entries = 0usize;
    for ace in dacl.split('(').skip(1) {
        let parts: Vec<&str> = ace.trim_end_matches(')').split(';').collect();
        let sid = parts.get(5).map_or(String::new(), |p| p.to_uppercase());
        let bad = parts.len() < 6
            || parts[0] != "A"
            || parts[1].contains("ID")
            || !allowed.contains(&sid);
        if bad {
            return Some("its rights are not owner-only".into());
        }
        entries += 1;
    }
    (entries == 0).then(|| "its rights are not owner-only".into())
}

/// Opens a file for reading with READ_CONTROL as well, sharing everything, so its owner and DACL can be read from the
/// same handle the text is read through (the backend's lock holder shares read only and keeps its handle open).
#[allow(
    clippy::disallowed_methods,
    reason = "the lock must be opened with READ_CONTROL so its owner and DACL can be read from the same handle"
)]
fn open_for_trust(path: &Path) -> Result<File, ReadError> {
    const GENERIC_READ: u32 = 0x8000_0000;
    const READ_CONTROL: u32 = 0x0002_0000;
    let name = HSTRING::from(path.as_os_str());
    let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    // SAFETY: opens an existing file by name; the handle moves into the File, which closes it once.
    let opened = unsafe {
        CreateFileW(
            &name,
            GENERIC_READ | READ_CONTROL,
            share,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    };
    match opened {
        // SAFETY: a handle this function just opened and owns.
        Ok(handle) => Ok(unsafe { File::from_raw_handle(handle.0) }),
        Err(e) => Err(io_error(
            path,
            &std::io::Error::from_raw_os_error(e.code().0 & 0xffff),
        )),
    }
}

/// The backend's lock file (`<state>/backend.lock`), trusted as lock.py trusts it: owner and DACL read through the
/// handle the text is read through. The backend holds it open sharing read only, which a plain read open allows.
/// Parsing belongs to supervise.rs.
pub fn read_lock(path: &Path) -> Result<String, ReadError> {
    let file = open_for_trust(path)?;
    let untrusted = |why: String| ReadError::Untrusted {
        path: path.to_path_buf(),
        why,
    };
    let user = current_user_sid().map_err(untrusted)?;
    let sddl = handle_sddl(&file).map_err(untrusted)?;
    if let Some(why) = untrusted_reason(&sddl, &user) {
        return Err(untrusted(why));
    }
    let bytes = read_open(file, path, LOCK_MAX_BYTES)?;
    text(path, bytes)
}

/// The shell's settings file, or None when there is none yet (first run).
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes its settings from its switches, not from a file"
    )
)]
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

    /// Gives a file the protected owner-only DACL the backend gives its lock (user, SYSTEM, Administrators).
    fn protect_like_the_backend(file: &Path) {
        use windows::Win32::Security::Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW,
        };
        use windows::Win32::Security::{
            GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
        };
        use windows::core::{BOOL, HSTRING};
        let sid = current_user_sid().expect("user SID");
        let sddl = HSTRING::from(format!("D:P(A;;FA;;;{sid})(A;;FA;;;SY)(A;;FA;;;BA)"));
        let what = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
        let mut sd = PSECURITY_DESCRIPTOR::default();
        // SAFETY: builds a descriptor, applies its DACL to a file the test owns, and frees the descriptor once.
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                &sddl,
                SDDL_REVISION_1,
                &mut sd,
                None,
            )
            .expect("descriptor");
            let (mut present, mut defaulted, mut dacl) = (BOOL(0), BOOL(0), std::ptr::null_mut());
            GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted).expect("DACL");
            let name = HSTRING::from(file.as_os_str());
            let set =
                SetNamedSecurityInfoW(&name, SE_FILE_OBJECT, what, None, None, Some(dacl), None);
            assert!(set.is_ok(), "protect {}", file.display());
            let _ = LocalFree(Some(HLOCAL(sd.0)));
        }
    }

    #[test]
    fn owner_only_descriptors_are_told_from_the_rest() {
        let me = "S-1-5-21-1-2-3-1001";
        let good = format!("O:{me}D:P(A;;FA;;;{me})(A;;FA;;;SY)(A;;FA;;;BA)");
        assert_eq!(untrusted_reason(&good, me), None);
        let admin_owner = format!("O:BAD:P(A;;FA;;;{me})");
        assert_eq!(untrusted_reason(&admin_owner, me), None);
        let others = [
            format!("O:S-1-5-21-9-9-9-500D:P(A;;FA;;;{me})"),
            format!("O:{me}D:(A;;FA;;;{me})"),
            format!("O:{me}D:P(A;;FA;;;{me})(A;;FA;;;WD)"),
            format!("O:{me}D:P(A;;FA;;;{me})(D;;FA;;;SY)"),
            format!("O:{me}D:P(A;ID;FA;;;{me})"),
            format!("O:{me}D:AI(A;ID;FA;;;{me})(A;ID;FA;;;SY)"),
            format!("O:{me}D:P"),
            format!("O:{me}"),
        ];
        for bad in &others {
            assert!(untrusted_reason(bad, me).is_some(), "accepted {bad}");
        }
    }

    #[test]
    fn a_lock_with_inherited_rights_is_untrusted() {
        let dir = scratch("inherit");
        let lock = dir.join("backend.lock");
        std::fs::write(&lock, "{\"port\":53117}\n").expect("write");
        assert!(matches!(read_lock(&lock), Err(ReadError::Untrusted { .. })));
        protect_like_the_backend(&lock);
        assert_eq!(read_lock(&lock).as_deref(), Ok("{\"port\":53117}\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lock_and_settings_read_back() {
        let dir = scratch("back");
        std::fs::write(dir.join("backend.lock"), "{\"port\":53117}\n").expect("write");
        protect_like_the_backend(&dir.join("backend.lock"));
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
        protect_like_the_backend(&dir.join("backend.lock"));
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
