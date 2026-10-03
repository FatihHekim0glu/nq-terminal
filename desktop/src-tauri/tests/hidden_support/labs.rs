//! The labs the hidden-window runs start the shell on (03 section 7.1; 04 D4.6).
//!
//! The shell accepts a lab only when the backend it starts reports that lab as its ROOT and its venv as `sys.prefix`
//! (02 C3-2), and ROOT is read from where `nq_lab` is installed. So a run that must spawn the REAL backend from this
//! worktree cannot use the owner's lab (its `terminal` folder is another tree, with its own page build). It uses a
//! derived lab under the run folder instead:
//!
//! - `.venv` holds the owner's venv launcher and `pyvenv.cfg`, copied, and one `.pth` file that puts the lab's own
//!   `src` first and then adds the owner's site-packages as a site folder, so every installed package is found and
//!   `nq_lab` is the copy in the derived lab (its ROOT is the derived lab, as the shell requires);
//! - `src\nq_lab` is a copy of the owner's package sources (read only use, never written back);
//! - `terminal` is a directory junction to this worktree, so the backend, its fixtures and its page build are the ones
//!   under test.
//!
//! The measure build takes a much smaller lab: the owner's venv through a junction, and a stand-in backend that only
//! waits for its stdin to close, so the run reaches the splash and the shell's close path without any data or state.
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it builds labs under its own run folder and never writes outside it"
)]

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The stand-in backend of the measure lab: it writes its pid beside the lab's folders, gives no handshake and waits
/// until its stdin closes (the shell's close, or the job ending the tree).
pub const STAND_IN_PID_FILE: &str = "stand-in.pid";
const STAND_IN_MAIN: &str = "import os, pathlib, sys\n\
pathlib.Path(__file__).parents[3].joinpath('stand-in.pid').write_text(str(os.getpid()))\n\
sys.stdin.buffer.read()\n";

/// The owner's lab (NQT_LAB, or %USERPROFILE%\nq-lab): its venv and package sources are read, nothing else.
pub fn real_lab() -> PathBuf {
    std::env::var_os("NQT_LAB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("nq-lab")
        })
}

fn make(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
}

fn put(file: &Path, bytes: &[u8]) {
    make(file.parent().expect("a parent folder"));
    std::fs::write(file, bytes).unwrap_or_else(|e| panic!("cannot write {}: {e}", file.display()));
}

fn copy_file(from: &Path, to: &Path) {
    make(to.parent().expect("a parent folder"));
    std::fs::copy(from, to)
        .unwrap_or_else(|e| panic!("cannot copy {} to {}: {e}", from.display(), to.display()));
}

/// `link` as a directory junction to `target`; it needs no privilege and no developer mode.
pub fn junction(link: &Path, target: &Path) {
    make(link.parent().expect("a parent folder"));
    let status = Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .unwrap_or_else(|e| panic!("cannot run mklink: {e}"));
    assert!(
        status.success(),
        "mklink /J {} {} failed",
        link.display(),
        target.display()
    );
}

/// Copies a folder of package sources, leaving out bytecode caches.
fn copy_sources(from: &Path, to: &Path) {
    make(to);
    let entries =
        std::fs::read_dir(from).unwrap_or_else(|e| panic!("cannot list {}: {e}", from.display()));
    for entry in entries.flatten() {
        let (source, target) = (entry.path(), to.join(entry.file_name()));
        if entry.file_name() == "__pycache__" {
            continue;
        }
        if source.is_dir() {
            copy_sources(&source, &target);
        } else {
            copy_file(&source, &target);
        }
    }
}

/// The venv of a derived lab: the owner's launcher and `pyvenv.cfg`, and the `.pth` that makes the lab's own `src`
/// win over the owner's installed `nq_lab`.
fn derived_venv(lab: &Path, real: &Path) {
    let venv = lab.join(".venv");
    copy_file(
        &real.join(r".venv\Scripts\python.exe"),
        &venv.join(r"Scripts\python.exe"),
    );
    copy_file(&real.join(r".venv\pyvenv.cfg"), &venv.join("pyvenv.cfg"));
    let packages = real.join(r".venv\Lib\site-packages");
    let pth = format!(
        "{}\nimport site; site.addsitedir(r\"{}\")\n",
        lab.join("src").display(),
        packages.display()
    );
    put(
        &venv.join(r"Lib\site-packages\nqt_derived.pth"),
        pth.as_bytes(),
    );
}

/// A lab for the smoke build's `--fixture`: the real backend of `terminal` (this worktree) runs under it.
pub fn derived_lab(run: &Path, terminal: &Path) -> PathBuf {
    let (lab, real) = (run.join("lab"), real_lab());
    derived_venv(&lab, &real);
    copy_sources(&real.join(r"src\nq_lab"), &lab.join(r"src\nq_lab"));
    junction(&lab.join("terminal"), terminal);
    lab
}

/// A lab for the measure build: the owner's venv through a junction and a stand-in backend. Its page build is an
/// empty file (the stand-in never reports a build state), and its state folder is its own.
pub fn stand_in_lab(run: &Path) -> PathBuf {
    let (lab, real) = (run.join("lab"), real_lab());
    junction(&lab.join(".venv"), &real.join(".venv"));
    put(&lab.join(r"src\nq_lab\config.py"), b"");
    put(
        &lab.join(r"terminal\backend\nq_terminal\__main__.py"),
        STAND_IN_MAIN.as_bytes(),
    );
    put(&lab.join(r"terminal\web\dist\index.html"), b"");
    lab
}

/// Removes the junctions of a lab before its folder is deleted, so a recursive delete never follows one.
pub fn drop_junctions(lab: &Path) {
    for link in [lab.join(".venv"), lab.join("terminal")] {
        let is_link = std::fs::symlink_metadata(&link).is_ok_and(|m| m.file_type().is_symlink());
        if is_link {
            let _ = std::fs::remove_dir(&link);
        }
    }
}
