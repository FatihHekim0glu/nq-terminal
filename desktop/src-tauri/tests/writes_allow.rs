//! The write allow list holds through every bypass of 04 D4.4 and 05 X05, for each of `append`, `write_new` and
//! `rotate` (03 section 6 item 3; 02 C3-7).
//!
//! Inside the lab only `terminal/state/**` is writable; outside it, the config folder, the save folders and a file
//! the owner chose. Every case below is a path that a NAIVE check lets through (03's first deny list, compared by
//! case-sensitive path components): the test asserts that first, so each case is born failing against a prefix
//! check, then asserts that writes.rs refuses it AND that nothing changed on disk (every guarded file keeps its
//! bytes and its link count, and no new file appears under the fake lab's research folders).
//!
//! Everything happens in a fake lab tree under D:\dev\tmp\w4b-writes, never the real lab. A directory symlink needs
//! developer mode and an 8.3 alias needs short names on D:; when either cannot be made, that case is SKIPPED with
//! its reason printed, never silently. The 8.3 expansion is also proved on C:\PROGRA~1 by the check alone (no
//! write is attempted there).
//!
//! writes.rs is part of the bin crate, so it is compiled into this test through `#[path]`, with the two crate items
//! its test-build signature names (`Launch`, `ShellError`) stood in for below. The download half is tested through
//! the smoke exe by tests/downloads.rs.
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it builds and inspects its own fake lab tree under D:\\dev\\tmp\\w4b-writes"
)]

#[allow(
    dead_code,
    reason = "the download half of the module is driven by tests/downloads.rs through the smoke exe"
)]
#[path = "../src/writes.rs"]
mod writes;

use std::collections::BTreeMap;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle, GetShortPathNameW,
};
use windows::core::HSTRING;
use writes::{WriteError, WritePolicy};

/// Stand-ins for the two bin crate items that writes.rs names in a test build (where its WebView2 download half is
/// left out, because a test exe carries MinGW's default manifest and cannot load the Common-Controls 6 imports the
/// webview code pulls in).
#[allow(
    dead_code,
    reason = "named only by the signature of the test-build on_download_starting"
)]
pub struct Launch;

#[allow(
    dead_code,
    reason = "named only by the signature of the test-build on_download_starting"
)]
#[derive(Debug)]
pub struct ShellError;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const RUN_ROOT: &str = r"D:\dev\tmp\w4b-writes";
const LEDGER: &[u8] = b"run_id,sharpe\nr1,0.5\n";
const PLANTED: &[u8] = b"planted by writes_allow\n";
/// 03's first deny list, which the naive check compares by case-sensitive components.
const NAIVE_DENY: [&[&str]; 6] = [
    &["results"],
    &["data"],
    &["live"],
    &["backtests", "output"],
    &[".venv"],
    &["src"],
];
static RUN: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Append,
    WriteNew,
    Rotate,
}

/// One fake lab tree and the policy over it.
struct Tree {
    root: PathBuf,
    lab: PathBuf,
    policy: WritePolicy,
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn mkdir(path: &Path) {
    std::fs::create_dir_all(path).unwrap_or_else(|e| panic!("mkdir {}: {e}", path.display()));
}

fn put(path: &Path, bytes: &[u8]) {
    std::fs::write(path, bytes).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
}

fn tree(tag: &str) -> Tree {
    let n = RUN.fetch_add(1, Ordering::SeqCst);
    let root = PathBuf::from(RUN_ROOT).join(format!("allow-{tag}-{}-{n}", stamp()));
    let lab = root.join("fake-nq-lab-tree");
    for dir in [
        r".git\hooks",
        "experiments",
        "scripts",
        "strategies",
        "src",
        r".venv\Scripts",
        "results",
        "data",
        "live",
        r"backtests\output",
        r"terminal\state\logs",
        r"terminal\backend",
    ] {
        mkdir(&lab.join(dir));
    }
    put(&lab.join(r"results\ledger.csv"), LEDGER);
    put(&lab.join(r".git\hooks\pre-commit"), b"#!/bin/sh\n");
    for dir in ["config", "saves", "outside"] {
        mkdir(&root.join(dir));
    }
    let policy = WritePolicy {
        lab: Some(lab.clone()),
        config_dir: root.join("config"),
        save_dirs: vec![root.join("saves")],
    };
    Tree { root, lab, policy }
}

fn quiet(cmd: &mut Command) -> bool {
    cmd.stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .is_ok_and(|s| s.success())
}

fn junction(link: &Path, target: &Path) {
    let made = quiet(
        Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link)
            .arg(target),
    );
    assert!(made, "cannot make the junction {}", link.display());
}

fn symlink_dir(link: &Path, target: &Path) -> Result<(), String> {
    std::os::windows::fs::symlink_dir(target, link).map_err(|e| {
        format!("a directory symlink needs developer mode or the symlink privilege ({e})")
    })
}

fn hardlink(link: &Path, target: &Path) {
    std::fs::hard_link(target, link)
        .unwrap_or_else(|e| panic!("hard link {}: {e}", link.display()));
}

/// The 8.3 alias of a path, when the volume makes short names.
fn short_name(path: &Path) -> Option<PathBuf> {
    let mut buf = vec![0u16; 1024];
    // SAFETY: a read-only query into a buffer that outlives the call.
    let n = unsafe { GetShortPathNameW(&HSTRING::from(path.as_os_str()), Some(&mut buf)) } as usize;
    let short = PathBuf::from(String::from_utf16_lossy(buf.get(..n)?));
    (n > 0 && n < buf.len() && short != path).then_some(short)
}

/// 03's first deny list by case-sensitive components: what a prefix check would have refused.
fn naive_allows(lab: &Path, path: &Path) -> bool {
    let parts: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let lab_parts: Vec<String> = lab
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.len() < lab_parts.len() || parts[..lab_parts.len()] != lab_parts[..] {
        return true;
    }
    let inside = &parts[lab_parts.len()..];
    !NAIVE_DENY
        .iter()
        .any(|deny| inside.len() >= deny.len() && deny.iter().zip(inside).all(|(d, p)| d == p))
}

fn links_of(path: &Path) -> u32 {
    let Ok(file) = std::fs::File::open(path) else {
        return 0;
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the handle belongs to `file`, alive for the call.
    let handle =
        windows::Win32::Foundation::HANDLE(std::os::windows::io::AsRawHandle::as_raw_handle(&file));
    unsafe { GetFileInformationByHandle(handle, &mut info) }.map_or(0, |()| info.nNumberOfLinks)
}

/// Every file under a folder (not following links), with its bytes and link count.
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, (Vec<u8>, u32)> {
    let mut out = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let kind = entry.file_type().expect("file type");
            if kind.is_dir() && !kind.is_symlink() {
                stack.push(path);
            } else if kind.is_file() {
                let bytes = std::fs::read(&path).unwrap_or_default();
                out.insert(path.clone(), (bytes, links_of(&path)));
            } else {
                out.insert(path, (Vec::new(), 0));
            }
        }
    }
    out
}

/// The guarded folders: every research and code folder of the fake lab (everything but terminal/state).
fn guarded(t: &Tree) -> BTreeMap<PathBuf, (Vec<u8>, u32)> {
    let mut all = BTreeMap::new();
    for dir in [
        "results",
        "data",
        "live",
        "backtests",
        ".git",
        "experiments",
        "scripts",
        "src",
        ".venv",
    ] {
        all.extend(snapshot(&t.lab.join(dir)));
    }
    all.extend(snapshot(&t.root.join("outside")));
    all
}

fn run_op(policy: &WritePolicy, op: Op, path: &Path) -> Result<(), WriteError> {
    match op {
        Op::Append => policy.append(path, PLANTED),
        Op::WriteNew => policy.write_new(path, PLANTED),
        Op::Rotate => policy.rotate(path, 0, 2).map(|_| ()),
    }
}

/// One bypass case: the path (or why it is skipped) and the file each op aims at.
struct Case {
    name: &'static str,
    path: Result<PathBuf, String>,
}

/// What one case came to.
enum Outcome {
    Passed,
    Skipped,
    Failed(String),
}

/// Checks the naive check lets the case through, then that writes.rs refuses it and nothing changed.
fn check_refused(t: &Tree, op: Op, case: &Case) -> Outcome {
    let path = match &case.path {
        Ok(path) => path,
        Err(reason) => {
            println!("SKIP {op:?} {}: {reason}", case.name);
            return Outcome::Skipped;
        }
    };
    if !naive_allows(&t.lab, path) {
        return Outcome::Failed(format!(
            "{}: not a bypass, the naive check refuses it",
            case.name
        ));
    }
    let before = guarded(t);
    let result = run_op(&t.policy, op, path);
    let changed = before != guarded(t);
    let refused = matches!(result, Err(WriteError::Refused { .. }));
    if !refused || changed {
        let what = format!("{} gave {result:?}, lab changed: {changed}", path.display());
        println!("FAIL {op:?} {}: {what}", case.name);
        return Outcome::Failed(format!("{}: {what}", case.name));
    }
    println!("PASS {op:?} {}: refused ({result:?})", case.name);
    Outcome::Passed
}

/// Each op aims at a file whose change would show: append and rotate at the existing ledger, write_new at a new
/// name beside it.
fn target(op: Op, folder: &Path) -> PathBuf {
    match op {
        Op::WriteNew => folder.join("planted.csv"),
        Op::Append | Op::Rotate => folder.join("ledger.csv"),
    }
}

fn link_cases(t: &Tree, op: Op) -> Vec<Case> {
    let state = t.lab.join(r"terminal\state");
    let results = t.lab.join("results");
    junction(&state.join("j-results"), &results);
    let symlink = symlink_dir(&state.join("s-results"), &results)
        .map(|()| target(op, &state.join("s-results")));
    let hard = state.join("ledger-link.csv");
    hardlink(&hard, &results.join("ledger.csv"));
    vec![
        Case {
            name: "junction",
            path: Ok(target(op, &state.join("j-results"))),
        },
        Case {
            name: "directory symlink",
            path: symlink,
        },
        Case {
            name: "hardlink in terminal/state",
            path: Ok(hard),
        },
    ]
}

fn short_case(t: &Tree, op: Op) -> Case {
    let output = t.lab.join(r"backtests\output");
    put(&output.join("ledger.csv"), LEDGER);
    let path = short_name(&t.lab.join("backtests"))
        .map(|short| target(op, &short.join("output")))
        .ok_or_else(|| {
            "the D: volume makes no 8.3 names (GetShortPathNameW returned the long name); the expansion is \
             proved on C:\\PROGRA~1 by eight_dot_three_aliases_are_expanded"
                .to_string()
        });
    Case {
        name: "8.3 alias",
        path,
    }
}

fn spelling_cases(t: &Tree, op: Op) -> Vec<Case> {
    let lab = t.lab.to_string_lossy().into_owned();
    let tail = lab.trim_start_matches(r"D:\");
    let name = target(op, Path::new(""));
    let name = name.to_string_lossy();
    let file = format!(r"results\{name}");
    let table: [(&'static str, String); 8] = [
        (r"\\?\ prefix", format!(r"\\?\{lab}\{file}")),
        (
            "alternate data stream on results",
            format!(r"{lab}\results:s"),
        ),
        (
            "alternate data stream in terminal/state",
            format!(r"{lab}\terminal\state\ok.log:hidden"),
        ),
        ("case (RESULTS)", format!(r"{lab}\RESULTS\{name}")),
        (
            r"UNC \\localhost\D$",
            format!(r"\\localhost\D$\{tail}\{file}"),
        ),
        (
            r"UNC \\127.0.0.1\D$",
            format!(r"\\127.0.0.1\D$\{tail}\{file}"),
        ),
        (
            r"\\?\UNC\localhost\D$",
            format!(r"\\?\UNC\localhost\D$\{tail}\{file}"),
        ),
        ("trailing dot (results.)", format!(r"{lab}\results.\{name}")),
    ];
    table
        .into_iter()
        .map(|(name, path)| Case {
            name,
            path: Ok(PathBuf::from(path)),
        })
        .collect()
}

fn device_cases(t: &Tree) -> Vec<Case> {
    let state = t.lab.join(r"terminal\state");
    vec![
        Case {
            name: "NUL",
            path: Ok(state.join("NUL")),
        },
        Case {
            name: "CON",
            path: Ok(state.join("CON")),
        },
        Case {
            name: "con.txt",
            path: Ok(state.join("con.txt")),
        },
        Case {
            name: "COM1.log",
            path: Ok(state.join("COM1.log")),
        },
        Case {
            name: r"\\.\ device path",
            path: Ok(PathBuf::from(r"\\.\NUL")),
        },
    ]
}

fn folder_cases(t: &Tree) -> Vec<Case> {
    vec![
        Case {
            name: ".git/hooks",
            path: Ok(t.lab.join(r".git\hooks\pre-commit")),
        },
        Case {
            name: "experiments/",
            path: Ok(t.lab.join(r"experiments\x.py")),
        },
        Case {
            name: "scripts/",
            path: Ok(t.lab.join(r"scripts\x.ps1")),
        },
        Case {
            name: "terminal sources",
            path: Ok(t.lab.join(r"terminal\backend\app.py")),
        },
        Case {
            name: "the lab root",
            path: Ok(t.lab.join("x.txt")),
        },
        Case {
            name: "outside every allowed folder",
            path: Ok(t.root.join(r"outside\x.txt")),
        },
    ]
}

fn every_case(t: &Tree, op: Op) -> Vec<Case> {
    let mut cases = link_cases(t, op);
    cases.push(short_case(t, op));
    cases.extend(spelling_cases(t, op));
    cases.extend(device_cases(t));
    cases.extend(folder_cases(t));
    cases
}

fn assert_every_case_refused(op: Op) {
    let t = tree(&format!("{op:?}").to_lowercase());
    let cases = every_case(&t, op);
    let (mut passed, mut skipped, mut failed) = (0, 0, Vec::new());
    for case in &cases {
        match check_refused(&t, op, case) {
            Outcome::Passed => passed += 1,
            Outcome::Skipped => skipped += 1,
            Outcome::Failed(why) => failed.push(why),
        }
    }
    println!(
        "{op:?}: {passed} of {} cases refused, {skipped} skipped with the reason above, {} failed",
        cases.len(),
        failed.len()
    );
    assert!(
        failed.is_empty(),
        "{op:?} let bypasses through:\n{}",
        failed.join("\n")
    );
    assert!(
        skipped <= 2,
        "{op:?}: more skipped cases than the symlink and the D: 8.3 alias"
    );
}

#[test]
fn append_refuses_every_bypass() {
    assert_every_case_refused(Op::Append);
}

#[test]
fn write_new_refuses_every_bypass() {
    assert_every_case_refused(Op::WriteNew);
}

#[test]
fn rotate_refuses_every_bypass() {
    assert_every_case_refused(Op::Rotate);
}

fn big_log(path: &Path) {
    put(path, &[b'x'; 64]);
}

/// Plants a refused numbered target beside a log.
type Plant<'a> = Box<dyn Fn(&Path) + 'a>;

/// A rotate whose source is fine but one of its numbered targets is refused changes nothing.
#[test]
fn rotate_with_a_refused_target_changes_nothing() {
    let t = tree("rotate-target");
    let state = t.lab.join(r"terminal\state");
    let ledger = t.lab.join(r"results\ledger.csv");
    let cases: [(&str, Plant<'_>); 2] = [
        (
            "numbered target is a hard link to results",
            Box::new(|log: &Path| {
                hardlink(&PathBuf::from(format!("{}.1", log.display())), &ledger)
            }),
        ),
        (
            "numbered target is a junction to results",
            Box::new(|log: &Path| {
                junction(
                    &PathBuf::from(format!("{}.2", log.display())),
                    &t.lab.join("results"),
                )
            }),
        ),
    ];
    for (n, (name, plant)) in cases.iter().enumerate() {
        let log = state.join(format!("rot{n}.log"));
        big_log(&log);
        plant(&log);
        assert!(naive_allows(&t.lab, &log), "{name}: not a bypass");
        let before = (guarded(&t), snapshot(&state));
        let result = t.policy.rotate(&log, 0, 3);
        assert!(
            matches!(result, Err(WriteError::Refused { .. })),
            "{name}: {result:?}"
        );
        assert_eq!(
            before,
            (guarded(&t), snapshot(&state)),
            "{name}: something moved"
        );
        println!("PASS rotate {name}: refused ({result:?})");
    }
}

/// The 8.3 stage on a volume that has short names: C:\PROGRA~1 is C:\Program Files. Check only, no write.
#[test]
fn eight_dot_three_aliases_are_expanded() {
    let Some(short) = short_name(Path::new(r"C:\Program Files")) else {
        println!("SKIP 8.3 on C:: C:\\Program Files has no short name on this PC");
        return;
    };
    let policy = WritePolicy {
        lab: Some(PathBuf::from(r"C:\Program Files")),
        config_dir: PathBuf::from(r"D:\dev\tmp\w4b-writes\no-config"),
        save_dirs: Vec::new(),
    };
    let lab = PathBuf::from(r"C:\Program Files");
    let refused = short.join(r"results\ledger.csv");
    assert!(naive_allows(&lab, &refused), "not a bypass");
    let checked = policy.check(&refused);
    assert!(
        matches!(checked, Err(WriteError::Refused { .. })),
        "{}: {checked:?}",
        refused.display()
    );
    let allowed = short.join(r"terminal\state\x.log");
    let checked = policy
        .check(&allowed)
        .expect("terminal/state through the alias");
    assert_eq!(
        checked,
        lab.join(r"terminal\state\x.log"),
        "the alias is expanded"
    );
    println!(
        "PASS 8.3: {} refused, {} expanded to {}",
        refused.display(),
        allowed.display(),
        checked.display()
    );
}

fn read(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

/// The allowed places still work: terminal/state (folders made on the way), the config folder, a save folder,
/// and a file the owner chose outside every allowed folder.
#[test]
fn allowed_places_take_every_op() {
    let t = tree("allowed");
    let log = t.lab.join(r"terminal\state\logs\deep\shell.log");
    t.policy
        .append(&log, b"one\n")
        .expect("append in terminal/state");
    t.policy.append(&log, b"two\n").expect("append again");
    assert_eq!(read(&log), b"one\ntwo\n");
    assert!(
        t.policy
            .rotate(&log, 4, 2)
            .expect("rotate in terminal/state")
    );
    assert_eq!(
        read(&PathBuf::from(format!("{}.1", log.display()))),
        b"one\ntwo\n"
    );
    let config = t.root.join(r"config\logs\shell-panic-1.txt");
    t.policy
        .write_new(&config, b"panic")
        .expect("write_new in the config folder");
    assert!(matches!(
        t.policy.write_new(&config, b"again"),
        Err(WriteError::Exists(_))
    ));
    t.policy
        .write_new(&t.root.join(r"saves\diag.zip"), b"zip")
        .expect("a save folder");
    let chosen = t.root.join(r"outside\chosen.csv");
    assert!(t.policy.write_new(&chosen, b"x").is_err(), "not chosen yet");
    t.policy.choose(&chosen).expect("the owner chose it");
    t.policy
        .write_new(&chosen, b"chosen")
        .expect("a chosen file");
    assert_eq!(read(&chosen), b"chosen");
    let neighbour = t.root.join(r"outside\neighbour.csv");
    assert!(
        t.policy.write_new(&neighbour, b"x").is_err(),
        "choosing one file allows only that file"
    );
    println!("PASS allowed places");
}

/// Choosing a file inside the lab follows the lab rule; a chosen file in terminal/state is fine.
#[test]
fn a_chosen_file_inside_the_lab_is_refused() {
    let t = tree("chosen");
    for path in [
        t.lab.join(r"results\export.csv"),
        t.lab.join(r"experiments\export.csv"),
        t.lab.join(r"RESULTS\export.csv"),
    ] {
        assert!(
            matches!(t.policy.choose(&path), Err(WriteError::Refused { .. })),
            "{}",
            path.display()
        );
    }
    t.policy
        .choose(&t.lab.join(r"terminal\state\export.csv"))
        .expect("terminal/state");
    println!("PASS chosen inside the lab");
}

/// Without a lab only the config folder, the save folders and chosen files are writable.
#[test]
fn without_a_lab_the_allow_list_still_holds() {
    let t = tree("nolab");
    let policy = WritePolicy {
        lab: None,
        ..t.policy
    };
    policy
        .append(&t.root.join(r"config\logs\shell.log"), b"x")
        .expect("config folder");
    for refused in [
        t.root.join(r"outside\x.txt"),
        t.lab.join(r"results\x.csv"),
        t.root.join("config"),
    ] {
        assert!(
            matches!(
                policy.append(&refused, b"x"),
                Err(WriteError::Refused { .. })
            ),
            "{}",
            refused.display()
        );
    }
    println!("PASS without a lab");
}

#[test]
fn device_names_are_refused_with_or_without_an_extension() {
    for name in [
        "NUL", "nul", "CON", "con.txt", "COM1.log", "LPT9", "AUX ", "CONOUT$", "COM¹",
    ] {
        assert!(writes::is_device_name(name), "{name}");
    }
    for name in ["null", "console.log", "COM10", "COM", "lpt", "shell.log"] {
        assert!(!writes::is_device_name(name), "{name}");
    }
}

#[test]
fn the_path_stage_reads_a_path_as_windows_would_or_refuses_it() {
    for (input, plain) in [
        (
            r"\\?\D:\lab\terminal\state\x.log",
            r"D:\lab\terminal\state\x.log",
        ),
        (r"d:\Lab\x.log", r"D:\Lab\x.log"),
        ("D:/lab/x.log", r"D:\lab\x.log"),
    ] {
        assert_eq!(
            writes::lexical(Path::new(input)),
            Ok(PathBuf::from(plain)),
            "{input}"
        );
    }
    for input in [
        r"\\localhost\C$\lab\results\x",
        r"\\?\UNC\localhost\C$\lab\x",
        r"\\server\share\x",
        r"\\.\NUL",
        r"\\?\GLOBALROOT\Device\x",
        r"\lab\no-drive\x",
        r"D:\lab\results:s",
        r"D:\lab\x.log::$DATA",
        r"D:\lab\results.\x",
        r"D:\lab\results \x",
        r"D:\lab\..\x",
        r"D:\lab\terminal\state\NUL",
        r"D:\lab\a*b",
        r"D:lab\x",
        r"lab\x",
    ] {
        assert!(writes::lexical(Path::new(input)).is_err(), "{input}");
    }
}

#[test]
fn a_local_admin_share_maps_to_its_drive() {
    use std::ffi::OsStr;
    let (server, share) = (OsStr::new("LocalHost"), OsStr::new("c$"));
    assert_eq!(writes::local_share(server, share), Some(b'c'));
    assert_eq!(writes::local_share(OsStr::new("fileserver"), share), None);
    assert_eq!(writes::local_share(server, OsStr::new("data")), None);
}

/// No other test here configures the global policy, so the free functions must refuse to write.
#[test]
fn writes_need_a_policy() {
    let never = Path::new(r"D:\dev\tmp\w4b-writes\never.log");
    assert_eq!(writes::append(never, b"x"), Err(WriteError::NotConfigured));
    assert!(!never.exists());
}
