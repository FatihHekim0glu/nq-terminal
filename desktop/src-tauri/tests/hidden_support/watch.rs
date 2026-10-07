//! The global window and foreground watch every hidden-window run uses (04 standing rule 4): EnumWindows over every
//! process every 100 ms plus GetForegroundWindow, and the judge that decides what fails a run.
#![allow(
    dead_code,
    reason = "each test binary that includes this file uses a part of it"
)]

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetLayeredWindowAttributes,
    GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    LAYERED_WINDOW_ATTRIBUTES_FLAGS, WS_EX_LAYERED,
};
use windows::core::BOOL;

#[path = "scope.rs"]
pub mod scope;
use scope::Link;

const SAMPLE: Duration = Duration::from_millis(100);
pub const TAO_CLASS: &str = "Tao Thread Event Target";

#[derive(Clone, Debug)]
pub struct Seen {
    /// The window handle (0 when not known, as in a planted test window).
    pub hwnd: isize,
    pub pid: u32,
    pub class: String,
    pub title: String,
    pub rect: (i32, i32, i32, i32),
    pub drawn: bool,
    /// The owner process and its ancestors, nearest first, read when the event was seen (empty: not traced).
    pub chain: Vec<Link>,
}

/// `new_visible` and `foreground_changes` hold what can fail a run: events of the test process tree and events whose
/// owner was not traced. Events of other programs are in `foreign` (see scope.rs).
#[derive(Debug, Default)]
pub struct WatchReport {
    pub samples: u64,
    pub max_gap_ms: u128,
    pub new_visible: Vec<Seen>,
    pub foreground_changes: Vec<Seen>,
    pub foreign: Vec<Seen>,
    /// The host windows that appeared during the run (see `scope::HostWindows`).
    pub hosts: scope::HostWindows,
}

impl WatchReport {
    /// Files a new window by its owner; true when it counts against the run.
    pub fn record_window(&mut self, w: Seen, root: u32) -> bool {
        self.hosts.note_new(w.hwnd, &w.chain, &w.class);
        let counts = !scope::is_foreign_window(&w.chain, &w.class, root);
        if counts {
            self.new_visible.push(w);
        } else {
            self.foreign.push(w);
        }
        counts
    }

    /// Files a foreground change by the owner of the window that took the foreground; a host window that was already open
    /// when the watch started (the owner's own terminal) does not count (`scope::HostWindows`).
    pub fn record_foreground(&mut self, w: Seen, root: u32) {
        if self
            .hosts
            .foreground_counts(w.hwnd, &w.chain, &w.class, root)
        {
            self.foreground_changes.push(w);
        } else {
            self.foreign.push(w);
        }
    }

    /// One line per foreign event: its owner, whether the owner is on the named list, and what was seen.
    pub fn foreign_notes(&self) -> Vec<String> {
        let note = |w: &Seen| scope::foreign_note(&w.chain, &w.class, &w.title);
        self.foreign.iter().map(note).collect()
    }
}

pub unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the address of the Vec that all_windows keeps alive for the whole EnumWindows call.
    unsafe { &mut *(lparam.0 as *mut Vec<isize>) }.push(hwnd.0 as isize);
    BOOL(1)
}

/// Every top-level window of every process.
pub fn all_windows() -> Vec<isize> {
    let mut list: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `list`, which outlives the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
    list
}

pub fn visible_windows() -> HashSet<isize> {
    // SAFETY: a plain query on window handles EnumWindows just listed.
    let visible = |h: &isize| unsafe { IsWindowVisible(HWND(*h as *mut _)) }.as_bool();
    all_windows().into_iter().filter(visible).collect()
}

/// A window counts as drawn when it is visible, not cloaked, has an area, and is not a layered window that never
/// got its attributes (or has alpha 0), which is how tao keeps its event-target window unseen (W0A).
pub fn describe(handle: isize) -> Seen {
    let hwnd = HWND(handle as *mut _);
    // SAFETY: read-only queries on a window handle; a handle that died in between just yields zeros.
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut class = [0u16; 256];
        let n = GetClassNameW(hwnd, &mut class) as usize;
        let mut title = [0u16; 256];
        let m = GetWindowTextW(hwnd, &mut title) as usize;
        let mut r = RECT::default();
        let _ = GetWindowRect(hwnd, &mut r);
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
        let layered = (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_LAYERED.0 != 0;
        let (mut key, mut alpha, mut flags) =
            (Default::default(), 0u8, LAYERED_WINDOW_ATTRIBUTES_FLAGS(0));
        let attrs = layered
            && GetLayeredWindowAttributes(hwnd, Some(&mut key), Some(&mut alpha), Some(&mut flags))
                .is_ok();
        let undrawn_layer = layered && (!attrs || alpha == 0);
        let area = i64::from((r.right - r.left).max(0)) * i64::from((r.bottom - r.top).max(0));
        let drawn = IsWindowVisible(hwnd).as_bool() && cloaked == 0 && area > 0 && !undrawn_layer;
        Seen {
            hwnd: handle,
            pid,
            class: String::from_utf16_lossy(&class[..n]),
            title: String::from_utf16_lossy(&title[..m]),
            rect: (r.left, r.top, r.right, r.bottom),
            drawn,
            chain: Vec::new(),
        }
    }
}

/// `describe` plus the owner's ancestry, read now (the owner may be gone when the verdict is made).
pub fn describe_traced(handle: isize) -> Seen {
    let mut w = describe(handle);
    w.chain = scope::chain_of(w.pid);
    w
}

pub fn foreground() -> isize {
    // SAFETY: a plain query.
    unsafe { GetForegroundWindow() }.0 as isize
}

pub struct Watch {
    pub stop: Arc<AtomicBool>,
    pub drawn_seen: Arc<AtomicBool>,
    pub handle: JoinHandle<WatchReport>,
}

pub fn start_watch() -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let drawn_seen = Arc::new(AtomicBool::new(false));
    let (stop2, drawn2) = (Arc::clone(&stop), Arc::clone(&drawn_seen));
    let baseline = visible_windows();
    let first_fg = foreground();
    let root = scope::root_pid();
    let handle = std::thread::spawn(move || {
        let mut report = WatchReport::default();
        let (mut seen, mut fg, mut last) = (HashSet::new(), first_fg, Instant::now());
        while !stop2.load(Ordering::SeqCst) {
            for h in visible_windows() {
                if !baseline.contains(&h) && seen.insert(h) {
                    let w = describe_traced(h);
                    let drawn = w.drawn;
                    if report.record_window(w, root) {
                        drawn2.fetch_or(drawn, Ordering::SeqCst);
                    }
                }
            }
            let now = foreground();
            if now != fg {
                report.record_foreground(describe_traced(now), root);
                fg = now;
            }
            report.samples += 1;
            report.max_gap_ms = report.max_gap_ms.max(last.elapsed().as_millis());
            last = Instant::now();
            std::thread::sleep(SAMPLE);
        }
        report
    });
    Watch {
        stop,
        drawn_seen,
        handle,
    }
}

impl Watch {
    pub fn finish(self) -> WatchReport {
        self.stop.store(true, Ordering::SeqCst);
        let report = self.handle.join().unwrap_or_default();
        for note in report.foreign_notes() {
            eprintln!("watch: ignored a foreign window: {note}");
        }
        report
    }
}

/// What fails a run: any drawn new window of the test process tree (or of an owner not traced), any foreground
/// change to one, and any undrawn new window that is not tao's event target. Other programs' events are in `foreign`.
pub fn failures(report: &WatchReport) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in &report.new_visible {
        if w.drawn {
            out.push(format!("drawn window titled {:?}: {w:?}", w.title));
        } else if w.class != TAO_CLASS {
            out.push(format!("unexpected undrawn window: {w:?}"));
        }
    }
    for w in &report.foreground_changes {
        out.push(format!("foreground changed to: {w:?}"));
    }
    out
}

pub fn seen(class: &str, drawn: bool) -> Seen {
    let (title, rect) = (String::new(), (0, 0, 1, 1));
    Seen {
        hwnd: 0,
        pid: 1,
        class: class.into(),
        title,
        rect,
        drawn,
        chain: Vec::new(),
    }
}

/// A window planted by `exe` (owner pid `pid`), whose parent process is `parent`, if any.
pub fn seen_by(class: &str, drawn: bool, pid: u32, exe: &str, parent: Option<(u32, &str)>) -> Seen {
    let mut w = seen(class, drawn);
    w.pid = pid;
    w.chain.push(Link {
        pid,
        exe: exe.into(),
    });
    if let Some((parent_pid, parent_exe)) = parent {
        w.chain.push(Link {
            pid: parent_pid,
            exe: parent_exe.into(),
        });
    }
    w
}

pub fn report(new_visible: Vec<Seen>, foreground_changes: Vec<Seen>) -> WatchReport {
    WatchReport {
        samples: 10,
        max_gap_ms: 100,
        new_visible,
        foreground_changes,
        foreign: Vec::new(),
        hosts: scope::HostWindows::default(),
    }
}

#[test]
pub fn watch_judge_catches_planted_windows() {
    assert!(failures(&report(vec![seen(TAO_CLASS, false)], vec![])).is_empty());
    for planted in [
        report(vec![seen("Tauri Window", true)], vec![]),
        report(vec![seen(TAO_CLASS, true)], vec![]),
        report(vec![seen("Chrome_WidgetWin_1", false)], vec![]),
        report(vec![], vec![seen("Tauri Window", false)]),
    ] {
        assert!(
            !failures(&planted).is_empty(),
            "a planted window passed: {planted:?}"
        );
    }
}

/// The scope rule (born failing: before it, a foreign window failed every run). Windows go through the same
/// `record_*` calls the watch thread makes, with a root of 500 standing for the test process.
#[test]
pub fn watch_ignores_foreign_windows_and_still_fails_a_planted_own_window() {
    const ROOT: u32 = 500;
    let mut report = WatchReport::default();
    let logi = seen_by("Logi", true, 900, "logioptionsplus_agent.exe", None);
    let chat = seen_by(
        "Chrome_WidgetWin_1",
        true,
        901,
        "chatclient.exe",
        Some((1, "explorer.exe")),
    );
    let stranger = seen_by(
        "Notepad",
        true,
        902,
        "notepad.exe",
        Some((1, "explorer.exe")),
    );
    assert!(!report.record_window(logi, ROOT));
    assert!(!report.record_window(chat.clone(), ROOT));
    assert!(!report.record_window(stranger, ROOT));
    report.record_foreground(chat, ROOT);
    assert!(
        failures(&report).is_empty(),
        "foreign events failed the run: {:?}",
        failures(&report)
    );
    let notes = report.foreign_notes();
    assert_eq!(notes.len(), 4, "{notes:?}");
    assert!(
        notes[0].contains("logioptionsplus_agent.exe")
            && notes[0].contains("known foreign program")
    );
    assert!(notes[2].contains("not on the list"), "{notes:?}");

    let own = seen_by(
        "Tauri Window",
        true,
        777,
        "nq-lab-terminal.exe",
        Some((ROOT, "test.exe")),
    );
    assert!(report.record_window(own.clone(), ROOT));
    assert_eq!(
        failures(&report).len(),
        1,
        "a planted own-tree window must still fail"
    );
    report.record_foreground(own, ROOT);
    assert_eq!(
        failures(&report).len(),
        2,
        "a foreground change to an own-tree window must still fail"
    );

    let mut gone = WatchReport::default();
    assert!(
        gone.record_window(seen("Tauri Window", true), ROOT),
        "an untraced owner counts (fail closed)"
    );
    assert_eq!(failures(&gone).len(), 1);
}
