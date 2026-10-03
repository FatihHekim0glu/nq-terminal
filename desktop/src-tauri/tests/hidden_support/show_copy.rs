//! The born-failing proof's helpers (04 D4.1): a copy of the crate whose main.rs calls the window's show, built with
//! the feature under test, and the check that screen 2 can take the planted window.
#![allow(
    dead_code,
    reason = "each test binary that includes this file uses a part of it"
)]

use super::launch_support::{CREATE_NO_WINDOW, crate_dir, log_file};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

/// Screen 2 of this PC (the owner's secondary monitor): the born-failing window goes only here.
const SCREEN2_PROBE: (i32, i32) = (-1040, 268);
const SHOW_SIZE: (i32, i32) = (800, 600); // physical pixels, as in SHOW_PATCH
/// Room for the window frame around the planted physical size.
const FRAME_MARGIN: i32 = 64;
const BUILD: &str = if cfg!(feature = "measure") {
    "measure"
} else {
    "smoke"
};

pub const SHOW_ANCHOR: &str = "    smoke::after_build(&main, &launch)?;\n";
/// What the born-failing copy adds after the build: the window made visible. Not through tauri's `show()`, which
/// activates a window once tao has dropped its created-unfocused marker, but as `show()` would with no activation:
/// sized and placed inside screen 2 first, WS_EX_NOACTIVATE, then SW_SHOWNOACTIVATE.
pub const SHOW_PATCH: &str = r#"    main.set_min_size(None::<tauri::Size>)?;
    main.set_size(tauri::PhysicalSize::new(800u32, 600u32))?;
    main.set_position(tauri::PhysicalPosition::new(-1040i32, 268i32))?;
    {
        use windows::Win32::UI::WindowsAndMessaging as wm;
        let hwnd = main.hwnd()?;
        // SAFETY: style and show calls on the window this process just built.
        unsafe {
            let ex = wm::GetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE);
            wm::SetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE, ex | wm::WS_EX_NOACTIVATE.0 as isize);
            let _ = wm::ShowWindow(hwnd, wm::SW_SHOWNOACTIVATE);
        }
    }
"#;

/// The second monitor's work area, if (-1040, 268) lies on a monitor that is not the primary one.
pub fn screen2_work_area() -> Result<RECT, String> {
    let point = POINT {
        x: SCREEN2_PROBE.0,
        y: SCREEN2_PROBE.1,
    };
    // SAFETY: plain monitor queries.
    let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONULL) };
    if monitor.is_invalid() {
        return Err("no monitor at the screen 2 point".into());
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: info is a valid, sized MONITORINFO.
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err("GetMonitorInfoW failed".into());
    }
    if info.dwFlags & MONITORINFOF_PRIMARY != 0 {
        return Err("the screen 2 point lies on the primary monitor".into());
    }
    let w = info.rcWork;
    let (right, bottom) = (
        SCREEN2_PROBE.0 + SHOW_SIZE.0 + FRAME_MARGIN,
        SCREEN2_PROBE.1 + SHOW_SIZE.1 + FRAME_MARGIN,
    );
    if SCREEN2_PROBE.0 < w.left || SCREEN2_PROBE.1 < w.top || right > w.right || bottom > w.bottom {
        return Err(format!(
            "the planted window and its frame would leave the work area {w:?}"
        ));
    }
    Ok(w)
}

pub fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap_or_else(|e| panic!("cannot create {}: {e}", to.display()));
    let entries =
        std::fs::read_dir(from).unwrap_or_else(|e| panic!("cannot list {}: {e}", from.display()));
    for entry in entries.flatten() {
        let (source, target) = (entry.path(), to.join(entry.file_name()));
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "gen" || name == "target" {
            continue;
        }
        if source.is_dir() {
            copy_tree(&source, &target);
        } else {
            std::fs::copy(&source, &target)
                .unwrap_or_else(|e| panic!("cannot copy {}: {e}", source.display()));
        }
    }
}

pub fn build_show_copy(run: &Path) -> PathBuf {
    let copy = run.join("src-tauri");
    copy_tree(&crate_dir(), &copy);
    let main = copy.join("src").join("main.rs");
    let source = std::fs::read_to_string(&main).unwrap_or_default();
    assert!(
        source.contains(SHOW_ANCHOR),
        "the patch anchor is missing from main.rs"
    );
    let planted = format!("{SHOW_ANCHOR}{SHOW_PATCH}");
    std::fs::write(&main, source.replacen(SHOW_ANCHOR, &planted, 1))
        .unwrap_or_else(|e| panic!("patch: {e}"));
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let target = PathBuf::from(format!(r"D:\dev\targets\w4a-showcopy-{BUILD}"));
    let status = Command::new(cargo)
        .args([
            "build",
            "--locked",
            "--offline",
            "--no-default-features",
            "--features",
            BUILD,
        ])
        .current_dir(&copy)
        .env("CARGO_TARGET_DIR", &target)
        .stdout(log_file(&run.join("build.out.log")))
        .stderr(log_file(&run.join("build.err.log")))
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .unwrap_or_else(|e| panic!("cannot build the show() copy: {e}"));
    assert!(
        status.success(),
        "the show() copy did not build; see {}",
        run.join("build.err.log").display()
    );
    target.join("debug").join("nq-lab-terminal.exe")
}
