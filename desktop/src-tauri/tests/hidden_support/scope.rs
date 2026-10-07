//! Whose window is it? The scope rule of every global window watch in these tests (04 standing rule 4, owner decision of
//! 3 October 2026, and its Rust half: 0.3.1 test-infra).
//!
//! The watches see every process on the PC. A run fails on a new window or a foreground change only when the process
//! that owns it is the test process or runs under it (the smoke exe, its backend stand-in, WebView2). Another program's
//! window (the Logitech Options+ helper program, a chat or overlay program, anything the owner opens) is filed apart in the
//! report's `foreign` list and never fails a run. The owner's process is read when the event is seen, from one Toolhelp
//! snapshot, because the window may be gone by the time the verdict is made. Windows that system hosts draw for a run from
//! outside its tree (WerFault, Windows Terminal, conhost, csrss, dllhost; a console or Windows Terminal window class) always
//! count (`SYSTEM_HOST_IMAGES`, `SYSTEM_HOST_CLASSES`). An event whose owner cannot be traced (the
//! process has already gone, or the foreground is nobody's) fails closed: it is counted like an own window.
//!
//! `KNOWN_FOREIGN` names the programs seen on this PC so far, and NQT_KNOWN_FOREIGN (image names separated by semicolons)
//! adds the ones that should not be named in this repository; the report says which foreign windows were on the list
//! and which were not, so a new neighbour is visible in the run's output without failing it.
#![allow(
    dead_code,
    reason = "each test binary that includes this file uses a part of it"
)]

use std::collections::HashMap;

/// Foreign programs known to put windows up during a run, by image name (compared without case).
pub const KNOWN_FOREIGN: [&str; 1] = ["logioptionsplus_agent.exe"];
/// More image names for this PC, separated by semicolons.
pub const KNOWN_FOREIGN_ENV: &str = "NQT_KNOWN_FOREIGN";
/// How many links of the ancestry one event keeps.
const ANCESTRY_DEPTH: usize = 8;

/// One process of an ancestry: its id and image name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Link {
    pub pid: u32,
    pub exe: String,
}

/// The process the watch judges for: the test process. Everything the test starts is under it.
pub fn root_pid() -> u32 {
    std::process::id()
}

/// System host images that draw windows on behalf of other processes. WerFault is started by the WER service for a
/// crashing process; Windows Terminal, OpenConsole and conhost draw the console of a child spawned without
/// CREATE_NO_WINDOW (Windows Terminal is started by COM activation, outside the tree); csrss draws loader and
/// hard-error boxes; dllhost hosts shell and COM dialogs. Their windows can be the run's own doing, so they always count.
pub const SYSTEM_HOST_IMAGES: [&str; 6] = [
    "werfault.exe",
    "windowsterminal.exe",
    "openconsole.exe",
    "conhost.exe",
    "csrss.exe",
    "dllhost.exe",
];
/// Window classes of the same hosts (a console, the Windows Terminal frame), counted whichever process draws them.
pub const SYSTEM_HOST_CLASSES: [&str; 2] = ["ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"];

/// Whether the window's owner (the nearest link) is a system host image (compared without case).
fn is_system_host(chain: &[Link]) -> bool {
    chain.first().is_some_and(|owner| {
        SYSTEM_HOST_IMAGES
            .iter()
            .any(|name| owner.exe.eq_ignore_ascii_case(name))
    })
}

/// True when the ancestry was traced, does not hold `root`, and its owner is not a system host: another program's window
/// or foreground. An empty ancestry (owner gone, or no owner) is not foreign, so it still counts against the run, and so
/// does a window a system host draws (see `SYSTEM_HOST_IMAGES`): the run may have caused it from outside its tree.
pub fn is_foreign(chain: &[Link], root: u32) -> bool {
    !chain.is_empty() && !is_system_host(chain) && chain.iter().all(|link| link.pid != root)
}

/// `is_foreign` for a window whose class is known: a console or Windows Terminal frame counts whoever draws it.
pub fn is_foreign_window(chain: &[Link], class: &str, root: u32) -> bool {
    is_foreign(chain, root)
        && !SYSTEM_HOST_CLASSES
            .iter()
            .any(|name| class.eq_ignore_ascii_case(name))
}

/// The image names this PC adds through NQT_KNOWN_FOREIGN.
pub fn extra_known_foreign() -> Vec<String> {
    let text = std::env::var(KNOWN_FOREIGN_ENV).unwrap_or_default();
    text.split(';')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// Whether the owner's image is on the named list, or among `extra` (compared without case).
pub fn is_known_foreign_with(chain: &[Link], extra: &[String]) -> bool {
    chain.first().is_some_and(|owner| {
        let listed = KNOWN_FOREIGN.iter().copied();
        listed
            .chain(extra.iter().map(String::as_str))
            .any(|name| owner.exe.eq_ignore_ascii_case(name))
    })
}

/// Whether the owner's image is on the named list of known foreign programs (this PC's additions included).
pub fn is_known_foreign(chain: &[Link]) -> bool {
    is_known_foreign_with(chain, &extra_known_foreign())
}

/// The line the report keeps for one foreign event: the owner, whether it is on the list, and what was seen.
pub fn foreign_note(chain: &[Link], class: &str, title: &str) -> String {
    let owner = chain.first().map_or("?", |link| link.exe.as_str());
    let listed = if is_known_foreign(chain) {
        "known foreign program"
    } else {
        "foreign program not on the list"
    };
    format!("{owner} ({listed}): class {class:?}, title {title:?}")
}

/// The ancestry of `pid` in a process table (pid to parent pid and image), nearest first. It stops at the table's edge,
/// at a repeated pid (a recycled parent id can close a loop) and after `ANCESTRY_DEPTH` links.
pub fn chain_in(table: &HashMap<u32, (u32, String)>, pid: u32) -> Vec<Link> {
    let mut links: Vec<Link> = Vec::new();
    let mut next = pid;
    while next != 0 && links.len() < ANCESTRY_DEPTH && links.iter().all(|link| link.pid != next) {
        let Some((parent, exe)) = table.get(&next) else {
            break;
        };
        links.push(Link {
            pid: next,
            exe: exe.clone(),
        });
        next = *parent;
    }
    links
}

/// The ancestry of `pid` now; empty when the process is gone.
pub fn chain_of(pid: u32) -> Vec<Link> {
    chain_in(&process_table(), pid)
}

#[repr(C)]
struct ProcessEntry32W {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    parent: u32,
    priority: i32,
    flags: u32,
    exe: [u16; 260],
}

const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
const INVALID_HANDLE: isize = -1;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> isize;
    fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

/// pid to (parent pid, image name) of every process, from one snapshot; empty when the snapshot fails.
pub fn process_table() -> HashMap<u32, (u32, String)> {
    let mut table = HashMap::new();
    // SAFETY: a plain snapshot query; the handle is checked and closed below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == 0 || snapshot == INVALID_HANDLE {
        return table;
    }
    let mut entry = ProcessEntry32W {
        size: size_of::<ProcessEntry32W>() as u32,
        usage: 0,
        pid: 0,
        heap: 0,
        module: 0,
        threads: 0,
        parent: 0,
        priority: 0,
        flags: 0,
        exe: [0; 260],
    };
    // SAFETY: `entry` is a live ProcessEntry32W with its size set; the snapshot handle is valid until closed here.
    unsafe {
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let len = entry.exe.iter().position(|c| *c == 0).unwrap_or(260);
            table.insert(
                entry.pid,
                (entry.parent, String::from_utf16_lossy(&entry.exe[..len])),
            );
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    table
}
