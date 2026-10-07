//! The scope rule of the global window watches (hidden_support/scope.rs): a window or a foreground change counts only
//! when its owner is the test process or runs under it. Other programs' windows (a Logitech Options+ helper program, a chat or overlay
//! program) are filed apart and named; a window whose owner cannot be traced still counts (fail closed).
//!
//! Born failing: the first three cases hold the pure rule; the last starts a real child of this test process and reads its
//! ancestry from the live process table, so a table reader that returns nothing, or a rule that ignores the root, fails.
#![allow(
    clippy::disallowed_methods,
    reason = "test: it starts one child process of its own to read its ancestry"
)]

#[path = "hidden_support/scope.rs"]
mod scope;

use scope::{
    HostWindows, KNOWN_FOREIGN, KNOWN_FOREIGN_ENV, Link, chain_in, chain_of, extra_known_foreign,
    foreign_note, is_foreign, is_foreign_window, is_known_foreign, is_known_foreign_with, root_pid,
};
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn link(pid: u32, exe: &str) -> Link {
    Link {
        pid,
        exe: exe.into(),
    }
}

fn table() -> HashMap<u32, (u32, String)> {
    HashMap::from([
        (10, (1, "cargo.exe".to_string())),
        (20, (10, "watch_scope.exe".to_string())),
        (30, (20, "nq-lab-terminal.exe".to_string())),
        (40, (30, "msedgewebview2.exe".to_string())),
        (900, (1, "logioptionsplus_agent.exe".to_string())),
        (901, (902, "loop_a.exe".to_string())),
        (902, (901, "loop_b.exe".to_string())),
    ])
}

#[test]
fn a_window_of_the_test_process_tree_counts_and_another_programs_window_does_not() {
    let own = chain_in(&table(), 40);
    assert_eq!(
        own.iter().map(|l| l.pid).collect::<Vec<_>>(),
        [40, 30, 20, 10]
    );
    assert!(
        !is_foreign(&own, 20),
        "a planted own-tree window must count"
    );
    assert!(
        !is_foreign(&chain_in(&table(), 20), 20),
        "the test process's own window counts"
    );
    let logi = chain_in(&table(), 900);
    assert!(is_foreign(&logi, 20), "a foreign window must not count");
    assert!(is_known_foreign(&logi));
    assert!(
        !is_foreign(&[], 20),
        "an owner that cannot be traced counts (fail closed)"
    );
}

#[test]
fn the_named_list_is_matched_without_case_and_only_by_the_owner_image() {
    assert_eq!(KNOWN_FOREIGN, ["logioptionsplus_agent.exe"]);
    assert!(is_known_foreign(&[link(5, "LogiOptionsPlus_Agent.exe")]));
    assert!(!is_known_foreign(&[link(5, "notepad.exe")]));
    assert!(!is_known_foreign(&[
        link(5, "notepad.exe"),
        link(6, "logioptionsplus_agent.exe")
    ]));
    assert!(!is_known_foreign(&[]));
    let note = foreign_note(&[link(5, "logioptionsplus_agent.exe")], "LogiAgent", "Logi");
    assert!(
        note.contains("logioptionsplus_agent.exe") && note.contains("known foreign program"),
        "{note}"
    );
    let other = foreign_note(&[link(5, "notepad.exe")], "Notepad", "x");
    assert!(other.contains("not on the list"), "{other}");
}

#[test]
fn a_pc_adds_known_programs_through_the_environment_name_not_through_the_repository() {
    assert_eq!(KNOWN_FOREIGN_ENV, "NQT_KNOWN_FOREIGN");
    let extra = vec!["ChatClient.exe".to_string()];
    assert!(is_known_foreign_with(&[link(5, "chatclient.EXE")], &extra));
    assert!(!is_known_foreign_with(&[link(5, "chatclient.exe")], &[]));
    assert!(is_known_foreign_with(
        &[link(5, "logioptionsplus_agent.exe")],
        &extra
    ));
    // The variable itself is read, not written, here: this test never sets it (set_var is unsafe and races other tests).
    let named = extra_known_foreign();
    assert!(
        named
            .iter()
            .all(|name| !name.is_empty() && name.trim() == name)
    );
}

#[test]
fn an_ancestry_stops_at_a_loop_a_missing_parent_and_the_depth_limit() {
    assert_eq!(
        chain_in(&table(), 901).len(),
        2,
        "a recycled parent id closes a loop"
    );
    assert_eq!(
        chain_in(&table(), 12_345),
        vec![],
        "an unknown process has no ancestry"
    );
    let deep: HashMap<u32, (u32, String)> = (1..=40)
        .map(|pid| (pid, (pid + 1, format!("p{pid}.exe"))))
        .collect();
    assert_eq!(chain_in(&deep, 1).len(), 8);
}

#[test]
fn the_live_process_table_traces_this_process_and_its_child() {
    let me = root_pid();
    let own = chain_of(me);
    assert_eq!(own.first().map(|l| l.pid), Some(me), "{own:?}");
    let mut child = Command::new("cmd")
        .args(["/C", "ping -n 6 127.0.0.1 >nul"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("start a hidden child");
    let chain = chain_of(child.id());
    let _ = child.kill();
    let _ = child.wait();
    assert!(
        chain.iter().any(|l| l.pid == me),
        "the child's ancestry must hold this process: {chain:?}"
    );
    assert!(!is_foreign(&chain, me));
}

/// Born failing: a window a run causes can be drawn by a system host outside its process tree. Each planted case must count.
#[test]
fn a_window_drawn_for_the_run_by_a_system_host_outside_its_tree_still_counts() {
    let mut planted = table();
    planted.insert(800, (1, "svchost.exe".to_string()));
    planted.insert(810, (800, "WerFault.exe".to_string()));
    planted.insert(820, (1, "explorer.exe".to_string()));
    planted.insert(830, (820, "WindowsTerminal.exe".to_string()));
    planted.insert(840, (830, "OpenConsole.exe".to_string()));
    planted.insert(850, (1, "conhost.exe".to_string()));
    let root = 20;
    for pid in [810, 830, 840, 850] {
        let chain = chain_in(&planted, pid);
        assert!(
            !is_foreign(&chain, root),
            "a host-drawn window must count: {chain:?}"
        );
        assert!(!is_foreign_window(&chain, "Any", root), "{chain:?}");
    }
    assert!(
        !is_foreign(&[link(5, "CSRSS.EXE")], root),
        "case-insensitive image match"
    );
    assert!(!is_foreign(&[link(5, "dllhost.exe")], root));
    // Only the owner's image is judged: a foreign program that merely runs under a console host stays foreign.
    let under_host = [link(6, "notepad.exe"), link(7, "conhost.exe")];
    assert!(is_foreign(&under_host, root));
    // The window classes of the same hosts count whatever process draws them.
    let other = chain_in(&planted, 900);
    assert!(
        is_foreign(&other, root),
        "a plain foreign program is still filed apart"
    );
    for class in ["ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"] {
        assert!(!is_foreign_window(&other, class, root), "{class}");
    }
    assert!(is_foreign_window(&other, "LogiAgent", root));
    assert!(!is_foreign_window(
        &[link(5, "werfault.exe")],
        "#32770",
        root
    ));
    // An own-tree window stays own, and a plain foreign dialog class alone does not count.
    assert!(!is_foreign_window(
        &chain_in(&planted, 40),
        "Chrome_WidgetWin_1",
        root
    ));
    assert!(is_foreign_window(&other, "#32770", root));
}

// ------------------------------------------------------------------------------------------------ the owner's own terminal

/// Born failing (V032, 0.3.1 audit; owner decision of 3 October 2026): a host window that was already open when the watch
/// started (the owner's own Windows Terminal) is not the run's doing, so a focus change to it is filed apart. A host window
/// that appeared during the run, and a focus change to it, still count.
#[test]
fn a_focus_change_to_a_host_window_open_before_the_run_does_not_count() {
    let hosts = HostWindows::default();
    let terminal = [link(830, "WindowsTerminal.exe"), link(820, "explorer.exe")];
    assert!(
        !hosts.foreground_counts(500, &terminal, "CASCADIA_HOSTING_WINDOW_CLASS", 20),
        "the owner's own terminal was there before the run"
    );
    let console = [link(850, "conhost.exe")];
    assert!(!hosts.foreground_counts(501, &console, "ConsoleWindowClass", 20));
    // By class alone: a foreign program drawing a console frame is a host window too.
    let other = [link(6, "notepad.exe")];
    assert!(!hosts.foreground_counts(502, &other, "ConsoleWindowClass", 20));
}

#[test]
fn a_host_window_that_appeared_during_the_run_counts_and_so_does_a_focus_change_to_it() {
    let mut hosts = HostWindows::default();
    let terminal = [link(830, "WindowsTerminal.exe"), link(820, "explorer.exe")];
    // The window itself is judged by the rule that was already there.
    assert!(!is_foreign_window(
        &terminal,
        "CASCADIA_HOSTING_WINDOW_CLASS",
        20
    ));
    hosts.note_new(500, &terminal, "CASCADIA_HOSTING_WINDOW_CLASS");
    assert!(hosts.foreground_counts(500, &terminal, "CASCADIA_HOSTING_WINDOW_CLASS", 20));
    assert!(
        !hosts.foreground_counts(777, &terminal, "CASCADIA_HOSTING_WINDOW_CLASS", 20),
        "another window of the same terminal process is judged by its own handle"
    );
}

#[test]
fn a_focus_change_that_cannot_be_traced_or_dated_counts_fail_closed() {
    let hosts = HostWindows::default();
    let terminal = [link(830, "WindowsTerminal.exe")];
    assert!(
        hosts.foreground_counts(500, &[], "Any", 20),
        "no owner traced"
    );
    assert!(
        hosts.foreground_counts(0, &terminal, "CASCADIA_HOSTING_WINDOW_CLASS", 20),
        "no handle: it cannot be shown to be older than the run"
    );
}

#[test]
fn the_run_tree_counts_and_another_program_does_not_whatever_the_host_list() {
    let mut hosts = HostWindows::default();
    let under_run = [link(850, "conhost.exe"), link(20, "watch_scope.exe")];
    assert!(hosts.foreground_counts(1, &under_run, "ConsoleWindowClass", 20));
    let chat = [link(902, "chatclient.exe"), link(1, "explorer.exe")];
    assert!(!hosts.foreground_counts(2, &chat, "Chrome_WidgetWin_1", 20));
    hosts.note_new(2, &chat, "Chrome_WidgetWin_1"); // not a host window: nothing is kept
    assert!(!hosts.foreground_counts(2, &chat, "Chrome_WidgetWin_1", 20));
}
