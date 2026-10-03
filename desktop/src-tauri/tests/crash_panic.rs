//! A shell panic writes its report (03 section 17; 04 D4.5): `<config>/logs/shell-panic-<time>.txt` through
//! `writes::write_new`, and the shell log names the file. The smoke exe is launched hidden against the loopback page
//! server on port 8813 with `NQT_SMOKE_FORCE_PANIC=1`, which makes a helper thread panic 300 ms after the window is
//! built; the global window and foreground watch runs for the whole launch.
//!
//! Born failing: without the hook (or without the switch) there is no report, and the second test proves that a
//! run without the switch leaves no report behind, so the first test cannot pass by accident.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test: it reads the run folder of the shell it started"
)]

mod crash_support;

use crash_support::{Page, Spec, launch, one_run};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_nq-lab-terminal"))
}

fn reports(config: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(config.join("logs"))
        .map(|dir| {
            dir.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("shell-panic-"))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_forced_panic_writes_its_report_through_write_new() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "panic",
            page: Page::Painted,
            args: &[],
            envs: &[("NQT_SMOKE_FORCE_PANIC", "1")],
        },
    );
    run.wait_event("force_panic_armed", 1, Duration::from_secs(90));
    let named = run.wait_event("panic_report", 1, Duration::from_secs(30));
    let config = run.dir.join("config");
    let file = named["file"]
        .as_str()
        .expect("the log names the report")
        .to_string();
    assert!(
        file.starts_with("shell-panic-") && file.ends_with(".txt"),
        "{file}"
    );
    assert_eq!(named["message"], "forced smoke panic");
    let found = reports(&config);
    assert_eq!(found.len(), 1, "exactly one report expected: {found:?}");
    assert_eq!(found[0].file_name().expect("name").to_string_lossy(), file);
    let text = std::fs::read_to_string(&found[0]).expect("the report is readable text");
    for needle in [
        "shell panic",
        "message: forced smoke panic",
        "thread: ",
        "location: ",
        "crash.rs",
        "backtrace:",
    ] {
        assert!(
            text.contains(needle),
            "the report lacks {needle:?}:\n{text}"
        );
    }
    assert_eq!(run.count("panic_report_failed"), 0);
    run.finish().assert_clean("forced panic");
}

#[test]
fn without_the_switch_no_report_is_written() {
    let _one = one_run();
    let mut run = launch(
        exe(),
        &Spec {
            tag: "nopanic",
            page: Page::Painted,
            args: &[],
            envs: &[],
        },
    );
    run.wait_event("crash_installed", 1, Duration::from_secs(90));
    run.wait_page_finished();
    std::thread::sleep(Duration::from_secs(3));
    assert!(
        reports(&run.dir.join("config")).is_empty(),
        "a report appeared with no panic"
    );
    assert_eq!(run.count("force_panic_armed"), 0);
    run.finish().assert_clean("no panic");
}
