//! The lab check, the tools on PATH and the WebView2 data folder with its protected DACL (03 section 7.1; 04 D4.2
//! items 1 and 3), a part of window.rs kept in its own file for size.

use crate::ShellError;
use std::ffi::OsStr;
use std::fmt;
use std::path::{Component, Path, PathBuf, Prefix};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1, SE_FILE_OBJECT,
    SetNamedSecurityInfoW,
};
use windows::Win32::Security::{
    DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR,
};
use windows::core::{BOOL, HSTRING};

/// What a lab folder must hold (03 section 7.1), and the page build or the tools that make it.
pub const LAB_REQUIRED: [&str; 3] = [
    r".venv\Scripts\python.exe",
    r"src\nq_lab\config.py",
    r"terminal\backend\nq_terminal\__main__.py",
];
pub const LAB_DIST: &str = r"terminal\web\dist\index.html";

fn folded(path: &Path) -> Vec<String> {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

/// The WebView2 data folder: absolute, on a local drive, no relative parts, and never inside the lab.
pub fn check_data_dir(dir: &Path, lab: Option<&Path>) -> Result<(), ShellError> {
    let local = matches!(dir.components().next(), Some(Component::Prefix(p))
        if matches!(p.kind(), Prefix::Disk(_)));
    let relative = dir
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir));
    let (parts, inside_lab) = (folded(dir), lab.map(folded));
    let in_lab = inside_lab.is_some_and(|l| parts.len() >= l.len() && parts[..l.len()] == l[..]);
    if !dir.is_absolute() || !local || relative || in_lab {
        return Err(ShellError::Refused(format!(
            "{} cannot hold the page engine's data: it must be an absolute folder on a local drive, outside the lab",
            dir.display()
        )));
    }
    Ok(())
}

/// The research folders no test folder may sit in or under (the same list as the smoke switches).
#[cfg(any(test, feature = "measure"))]
const RESEARCH_FOLDERS: [&str; 4] = ["results", "data", "live", "backtests"];

#[cfg(any(test, feature = "measure"))]
fn on_drive(path: &Path, is_letter: fn(u8) -> bool) -> bool {
    matches!(path.components().next(), Some(Component::Prefix(p))
        if matches!(p.kind(), Prefix::Disk(b) | Prefix::VerbatimDisk(b) if is_letter(b)))
}

/// The rule for the folder as written: on the D: drive, no relative parts, not in a research folder.
#[cfg(any(test, feature = "measure"))]
fn test_folder_fault(path: &Path) -> Option<String> {
    if !on_drive(path, |b| b.eq_ignore_ascii_case(&b'D')) {
        return Some("it must be on the D: drive".into());
    }
    research_folder_fault(path)
}

/// The rule for where the folder really points. The name stays on D:, but the big folders may live on another data
/// drive behind a junction (D:\dev to E:\dev), so the real folder only has to stay off the system drive C:; the research
/// folder rule applies to it in full.
#[cfg(any(test, feature = "measure"))]
pub(super) fn resolved_fault(path: &Path) -> Option<String> {
    if on_drive(path, |b| b.eq_ignore_ascii_case(&b'C'))
        || !on_drive(path, |b| b.is_ascii_alphabetic())
    {
        return Some("it must resolve to a data drive, never the system drive C:".into());
    }
    research_folder_fault(path)
}

#[cfg(any(test, feature = "measure"))]
fn research_folder_fault(path: &Path) -> Option<String> {
    for part in path.components() {
        if matches!(part, Component::ParentDir | Component::CurDir) {
            return Some("it may not contain relative parts".into());
        }
        let text = part.as_os_str().to_string_lossy().to_lowercase();
        // Windows ignores trailing dots and spaces in a name, so `results.` is the results folder.
        let text = text.trim_end_matches(['.', ' ']);
        if RESEARCH_FOLDERS.contains(&text) {
            return Some(format!("it may not sit in a research folder ({text})"));
        }
    }
    None
}

/// The path with its deepest existing ancestor resolved (junctions, symlinks and 8.3 names), so a harmless-looking
/// name cannot lead into a research folder. The part that does not exist yet is appended as written.
#[cfg(any(test, feature = "measure"))]
fn resolved(path: &Path) -> PathBuf {
    let mut tail = Vec::new();
    let mut head = path;
    loop {
        if let Ok(real) = head.canonicalize() {
            return tail.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (head.parent(), head.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                head = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// A folder a test build writes into (the measure run folder): absolute, on the D: drive, no relative parts and
/// never a research folder, by its name and by where it really points, so a mistyped variable cannot make the shell
/// or WebView2 write under the lab's results, data, live or backtests folders. The smoke switches apply the same rule.
#[cfg(any(test, feature = "measure"))]
pub fn check_test_folder(dir: &Path, name: &str) -> Result<(), ShellError> {
    let fault = if dir.is_absolute() {
        test_folder_fault(dir).or_else(|| resolved_fault(&resolved(dir)))
    } else {
        Some("it must be an absolute path".into())
    };
    match fault {
        Some(why) => Err(ShellError::Refused(format!("{name} is refused: {why}"))),
        None => Ok(()),
    }
}

/// Creates the WebView2 data folder when it does not exist yet and gives it a protected DACL (owner, SYSTEM and
/// Administrators, inherited by everything WebView2 puts inside). A folder that already exists is left as it is.
/// Returns whether this call created it.
#[allow(
    clippy::disallowed_methods,
    reason = "the WebView2 data folder must exist with its protected DACL before the engine starts (04 D4.2 item 3); \
              writes.rs has no folder call and is not configured until resolve returns"
)]
pub(super) fn ensure_data_dir(dir: &Path) -> Result<bool, ShellError> {
    let io = |e: std::io::Error| ShellError::Io(format!("{}: {e}", dir.display()));
    if dir.is_dir() {
        return Ok(false);
    }
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    match std::fs::create_dir(dir) {
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && dir.is_dir() => {
            return Ok(false);
        }
        Err(e) => return Err(io(e)),
        Ok(()) => {}
    }
    if let Err(why) = protect_folder(dir) {
        let _ = std::fs::remove_dir(dir);
        return Err(ShellError::Refused(format!(
            "cannot protect {}: {why}",
            dir.display()
        )));
    }
    Ok(true)
}

/// Replaces the folder's DACL with a protected one: full control for the current user, SYSTEM and Administrators,
/// inherited by files and folders, and nothing inherited from the parent.
fn protect_folder(dir: &Path) -> Result<(), String> {
    let sid = crate::reads::current_user_sid()?;
    let sddl = HSTRING::from(format!(
        "D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
    ));
    let what = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    let mut sd = PSECURITY_DESCRIPTOR::default();
    // SAFETY: the descriptor the system allocates is read while alive and freed once; the DACL pointer points into
    // it.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut sd, None)
            .map_err(|e| e.to_string())?;
        let (mut present, mut defaulted, mut dacl) = (BOOL(0), BOOL(0), std::ptr::null_mut());
        let set = GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted)
            .map_err(|e| e.to_string())
            .and_then(|()| {
                let name = HSTRING::from(dir.as_os_str());
                SetNamedSecurityInfoW(&name, SE_FILE_OBJECT, what, None, None, Some(dacl), None)
                    .ok()
                    .map_err(|e| e.to_string())
            });
        let _ = LocalFree(Some(HLOCAL(sd.0)));
        set
    }
}

/// node and pnpm as found on PATH (absolute folders only).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tools {
    pub node: Option<PathBuf>,
    pub pnpm: Option<PathBuf>,
}

impl Tools {
    pub fn from_env() -> Self {
        Self::from_path(std::env::var_os("PATH").as_deref())
    }

    pub fn from_path(path: Option<&OsStr>) -> Self {
        let find = |name: &str, exts: &[&str]| -> Option<PathBuf> {
            let dirs = std::env::split_paths(path?).filter(|d| d.is_absolute());
            dirs.flat_map(|dir| exts.iter().map(move |ext| dir.join(format!("{name}{ext}"))))
                .find(|candidate| candidate.is_file())
        };
        Self {
            node: find("node", &[".exe"]),
            pnpm: find("pnpm", &[".exe", ".cmd"]),
        }
    }
}

/// Why a folder is not a lab: the parts it lacks.
#[derive(Debug, PartialEq, Eq)]
pub struct LabRefusal {
    pub lab: PathBuf,
    pub missing: Vec<String>,
}

impl fmt::Display for LabRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} is not an nq-lab folder: it lacks {}",
            self.lab.display(),
            self.missing.join("; ")
        )
    }
}

/// The lab check of the picker and of every start (03 section 7.1): the venv interpreter, the research package's
/// config, the backend entry, and the page build or node and pnpm on PATH to make it.
pub fn check_lab(lab: &Path, tools: &Tools) -> Result<(), LabRefusal> {
    let mut missing: Vec<String> = Vec::new();
    if !lab.is_absolute() || !lab.is_dir() {
        missing.push("an existing absolute folder".into());
    }
    for part in LAB_REQUIRED {
        if !lab.join(part).is_file() {
            missing.push(part.into());
        }
    }
    if !lab.join(LAB_DIST).is_file() && (tools.node.is_none() || tools.pnpm.is_none()) {
        missing.push(format!("{LAB_DIST}, or node and pnpm on PATH to build it"));
    }
    if missing.is_empty() {
        return Ok(());
    }
    Err(LabRefusal {
        lab: lab.to_path_buf(),
        missing,
    })
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests build fake labs and read back a folder's DACL; not shipped code"
)]
mod tests {
    use super::*;
    use windows::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW,
    };
    use windows::core::PWSTR;

    /// A fresh folder under D:\dev\tmp\w4b-window-keys, never the real lab.
    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(r"D:\dev\tmp\w4b-window-keys")
            .join(format!("unit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("parent");
        std::fs::write(path, b"").expect("file");
    }

    /// A fake lab holding every required file, with or without the page build.
    fn fake_lab(name: &str, dist: bool) -> PathBuf {
        let lab = scratch(name);
        for part in LAB_REQUIRED {
            touch(&lab.join(part));
        }
        if dist {
            touch(&lab.join(LAB_DIST));
        }
        lab
    }

    fn with_tools() -> Tools {
        Tools {
            node: Some(PathBuf::from(r"D:\fake\node.exe")),
            pnpm: Some(PathBuf::from(r"D:\fake\pnpm.cmd")),
        }
    }

    #[test]
    fn a_complete_lab_passes() {
        let lab = fake_lab("complete", true);
        assert_eq!(check_lab(&lab, &Tools::default()), Ok(()));
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn the_picker_refuses_a_folder_missing_any_required_file() {
        for (index, part) in LAB_REQUIRED.iter().enumerate() {
            let lab = fake_lab(&format!("missing-{index}"), true);
            std::fs::remove_file(lab.join(part)).expect("remove one file");
            let refusal = check_lab(&lab, &with_tools()).expect_err("must refuse");
            assert_eq!(refusal.missing, vec![(*part).to_string()]);
            assert!(refusal.to_string().contains(part));
            let _ = std::fs::remove_dir_all(&lab);
        }
        assert!(check_lab(Path::new(r"relative\lab"), &with_tools()).is_err());
    }

    #[test]
    fn no_page_build_needs_node_and_pnpm() {
        let lab = fake_lab("nodist", false);
        assert_eq!(check_lab(&lab, &with_tools()), Ok(()));
        for tools in [
            Tools::default(),
            Tools {
                pnpm: None,
                ..with_tools()
            },
            Tools {
                node: None,
                ..with_tools()
            },
        ] {
            let refusal = check_lab(&lab, &tools).expect_err("no build and no tools");
            assert!(refusal.missing[0].contains("node and pnpm"), "{refusal}");
        }
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn tools_are_found_on_absolute_path_folders_only() {
        let bin = scratch("bin");
        touch(&bin.join("node.exe"));
        touch(&bin.join("pnpm.cmd"));
        let path = std::env::join_paths([PathBuf::from("relative"), bin.clone()]).expect("join");
        let found = Tools::from_path(Some(&path));
        assert_eq!(found.node, Some(bin.join("node.exe")));
        assert_eq!(found.pnpm, Some(bin.join("pnpm.cmd")));
        assert_eq!(Tools::from_path(None), Tools::default());
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn the_data_folder_must_be_local_absolute_and_outside_the_lab() {
        let lab = Path::new(r"C:\Users\Owner\nq-lab");
        assert!(check_data_dir(Path::new(r"D:\nq-terminal\webview"), Some(lab)).is_ok());
        for bad in [
            r"C:\Users\Owner\nq-lab\webview",
            r"c:\users\owner\NQ-LAB\terminal\state\wv",
            r"webview",
            r"D:\nq-terminal\..\webview",
            r"\server\share\webview",
        ] {
            assert!(
                check_data_dir(Path::new(bad), Some(lab)).is_err(),
                "accepted {bad}"
            );
        }
    }

    /// The folder's DACL as SDDL text.
    fn dacl_sddl(dir: &Path) -> String {
        let mut sd = PSECURITY_DESCRIPTOR::default();
        let mut text = PWSTR::null();
        let name = HSTRING::from(dir.as_os_str());
        // SAFETY: reads the folder's security into a descriptor the system allocates, converts it and frees both.
        unsafe {
            let got = GetNamedSecurityInfoW(
                &name,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                None,
                None,
                &mut sd,
            );
            assert!(got.is_ok(), "read the DACL of {}", dir.display());
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                sd,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                None,
            )
            .expect("SDDL");
            let sddl = text.to_string().expect("UTF-16");
            let _ = LocalFree(Some(HLOCAL(text.0.cast())));
            let _ = LocalFree(Some(HLOCAL(sd.0)));
            sddl
        }
    }

    #[test]
    fn a_created_data_folder_gets_a_protected_dacl() {
        let root = scratch("dacl");
        let dir = root.join("made").join("wv");
        assert_eq!(ensure_data_dir(&dir).ok(), Some(true));
        let sddl = dacl_sddl(&dir);
        let sid = crate::reads::current_user_sid().expect("user SID");
        assert!(sddl.starts_with("D:P"), "not protected: {sddl}");
        let aces: Vec<&str> = sddl.split('(').skip(1).collect();
        assert_eq!(aces.len(), 3, "{sddl}");
        for trustee in [sid.as_str(), "SY", "BA"] {
            assert!(
                aces.iter().any(|a| a.ends_with(&format!(";{trustee})"))),
                "{trustee} in {sddl}"
            );
        }
        assert_eq!(
            ensure_data_dir(&dir).ok(),
            Some(false),
            "an existing folder is left alone"
        );
        let parent = dacl_sddl(&root);
        assert!(
            !parent.starts_with("D:P"),
            "the parent was changed: {parent}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
