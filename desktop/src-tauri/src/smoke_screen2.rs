//! Screen 2 placement for the smoke build (owner decision 10; 04 D4.5; plan W4B). Pure rectangle rules plus the one
//! guarded show helper. Nothing here can put the window on the primary monitor: the window is placed while it is
//! still hidden, a guard compares its DWM frame bounds with the work area of the NON-PRIMARY monitor that holds the
//! screen 2 anchor, and only then is it shown, with `SW_SHOWNOACTIVATE` and `WS_EX_NOACTIVATE`. After the show the
//! guard runs again and the foreground window must be unchanged, or the window is hidden at once.
//!
//! The file is self-contained (std and the `windows` crate only) so that `tests/screen2_guard.rs` includes it by
//! path and tests the very code the smoke build runs, with rectangles computed from `GetMonitorInfo`.
#![allow(
    dead_code,
    reason = "the screen2 helper is reached only with --screen2; tests/screen2_guard.rs includes this file whole"
)]

use std::fmt;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::WindowsAndMessaging as wm;
use windows::core::BOOL;

/// The top-left corner of screen 2 on the owner's PC (X=-1080, Y=228, 1080 x 1872): the monitor that contains this
/// point, if it is not the primary one, is the only place a smoke window may be shown.
pub const ANCHOR: (i32, i32) = (-1080, 228);
/// Room kept between the window and the work area's edge, which also covers the invisible resize border.
pub const MARGIN: i32 = 16;
/// A frame that comes within this many pixels of a primary monitor counts as touching it.
pub const PRIMARY_GRACE: i32 = 8;
/// `MONITORINFOF_PRIMARY`.
const PRIMARY_FLAG: u32 = 1;

/// A rectangle in physical pixels, right and bottom exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl From<RECT> for Rect {
    fn from(r: RECT) -> Self {
        Self {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        }
    }
}

impl Rect {
    pub const fn width(&self) -> i32 {
        self.right - self.left
    }

    pub const fn height(&self) -> i32 {
        self.bottom - self.top
    }

    pub const fn is_empty(&self) -> bool {
        self.width() <= 0 || self.height() <= 0
    }

    /// Whether the two share at least one pixel.
    pub const fn intersects(&self, other: &Self) -> bool {
        self.left < other.right
            && other.left < self.right
            && self.top < other.bottom
            && other.top < self.bottom
    }

    /// Whether `self` lies entirely inside `outer`.
    pub const fn inside(&self, outer: &Self) -> bool {
        self.left >= outer.left
            && self.top >= outer.top
            && self.right <= outer.right
            && self.bottom <= outer.bottom
    }

    pub const fn contains_point(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    /// The rectangle grown by `by` pixels on every side, so that touching counts as meeting.
    pub const fn grown(&self, by: i32) -> Self {
        Self {
            left: self.left - by,
            top: self.top - by,
            right: self.right + by,
            bottom: self.bottom + by,
        }
    }
}

/// One monitor as `GetMonitorInfo` reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Monitor {
    pub bounds: Rect,
    pub work: Rect,
    pub primary: bool,
}

/// Why the guard refused to show the window. Every refusal leaves the window hidden.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    NoMonitors(String),
    NoMonitorAtAnchor,
    TargetIsPrimary,
    TouchesPrimary(Rect),
    OutsideWorkArea {
        frame: Rect,
        work: Rect,
    },
    FrameBounds(String),
    TooBigForWorkArea {
        window: (i32, i32),
        work: (i32, i32),
    },
    ForegroundMoved,
    Win32(String),
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoMonitors(why) => write!(f, "no monitor list: {why}"),
            Self::NoMonitorAtAnchor => write!(f, "no monitor holds the screen 2 anchor point"),
            Self::TargetIsPrimary => write!(f, "the monitor at the anchor is the primary monitor"),
            Self::TouchesPrimary(r) => {
                write!(f, "the window frame {r:?} touches the primary monitor")
            }
            Self::OutsideWorkArea { frame, work } => {
                write!(
                    f,
                    "the window frame {frame:?} leaves the work area {work:?}"
                )
            }
            Self::FrameBounds(why) => write!(f, "frame bounds unavailable: {why}"),
            Self::TooBigForWorkArea { window, work } => {
                write!(
                    f,
                    "the window {window:?} does not fit the work area {work:?}"
                )
            }
            Self::ForegroundMoved => write!(f, "the foreground window changed"),
            Self::Win32(why) => write!(f, "win32 call failed: {why}"),
        }
    }
}

impl std::error::Error for Refusal {}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    // SAFETY: lparam is the address of the Vec that `monitors` keeps alive for the whole EnumDisplayMonitors call.
    unsafe { &mut *(lparam.0 as *mut Vec<HMONITOR>) }.push(monitor);
    BOOL(1)
}

/// Every monitor, with its bounds and work area from `GetMonitorInfo`.
pub fn monitors() -> Result<Vec<Monitor>, Refusal> {
    let mut handles: Vec<HMONITOR> = Vec::new();
    // SAFETY: the callback only pushes into `handles`, which outlives the call.
    let listed = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor),
            LPARAM(&mut handles as *mut _ as isize),
        )
    };
    if !listed.as_bool() {
        return Err(Refusal::NoMonitors("EnumDisplayMonitors failed".into()));
    }
    let mut out = Vec::with_capacity(handles.len());
    for handle in handles {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        // SAFETY: info is a valid, sized MONITORINFO and the handle was just listed.
        if !unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool() {
            return Err(Refusal::NoMonitors("GetMonitorInfoW failed".into()));
        }
        out.push(Monitor {
            bounds: info.rcMonitor.into(),
            work: info.rcWork.into(),
            primary: info.dwFlags & PRIMARY_FLAG != 0,
        });
    }
    if out.is_empty() {
        return Err(Refusal::NoMonitors("the list is empty".into()));
    }
    Ok(out)
}

/// The non-primary monitor that contains the anchor point.
pub fn target(all: &[Monitor], anchor: (i32, i32)) -> Result<Monitor, Refusal> {
    let found = all
        .iter()
        .find(|m| m.bounds.contains_point(anchor.0, anchor.1))
        .ok_or(Refusal::NoMonitorAtAnchor)?;
    if found.primary {
        return Err(Refusal::TargetIsPrimary);
    }
    Ok(*found)
}

/// The guard. A frame is accepted only when it lies entirely inside the work area of the non-primary `target`
/// monitor and neither overlaps nor comes within `PRIMARY_GRACE` pixels of the bounds of any primary monitor.
pub fn judge(frame: Rect, target: &Monitor, all: &[Monitor]) -> Result<(), Refusal> {
    if target.primary {
        return Err(Refusal::TargetIsPrimary);
    }
    if frame.is_empty() {
        return Err(Refusal::FrameBounds("the frame is empty".into()));
    }
    if all
        .iter()
        .any(|m| m.primary && frame.grown(PRIMARY_GRACE).intersects(&m.bounds))
    {
        return Err(Refusal::TouchesPrimary(frame));
    }
    if !frame.inside(&target.work) {
        return Err(Refusal::OutsideWorkArea {
            frame,
            work: target.work,
        });
    }
    Ok(())
}

/// The window's size and position that fit `work` with the margin, or a refusal when it cannot fit.
pub fn placement(window: (i32, i32), work: &Rect) -> Result<Rect, Refusal> {
    let room = (work.width() - 2 * MARGIN, work.height() - 2 * MARGIN);
    if window.0 > room.0 || window.1 > room.1 || window.0 <= 0 || window.1 <= 0 {
        return Err(Refusal::TooBigForWorkArea {
            window,
            work: (work.width(), work.height()),
        });
    }
    Ok(Rect {
        left: work.left + MARGIN,
        top: work.top + MARGIN,
        right: work.left + MARGIN + window.0,
        bottom: work.top + MARGIN + window.1,
    })
}

fn hwnd_value(hwnd: HWND) -> isize {
    hwnd.0 as isize
}

/// The window's visible frame (`DWMWA_EXTENDED_FRAME_BOUNDS`).
pub fn frame_bounds(hwnd: HWND) -> Result<Rect, Refusal> {
    let mut r = RECT::default();
    // SAFETY: r is a valid RECT and the size passed is its size; the handle is this process's window.
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut r as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        )
    }
    .map_err(|e| Refusal::FrameBounds(e.to_string()))?;
    Ok(r.into())
}

pub fn window_rect(hwnd: HWND) -> Result<Rect, Refusal> {
    let mut r = RECT::default();
    // SAFETY: a read-only query into a valid RECT.
    unsafe { wm::GetWindowRect(hwnd, &mut r) }.map_err(|e| Refusal::Win32(e.to_string()))?;
    Ok(r.into())
}

/// Moves the still-hidden window into the work area, with no show flag and no activation.
#[allow(
    clippy::disallowed_methods,
    reason = "the one smoke screen-2 helper (SetWindowPos without SWP_SHOWWINDOW, on a hidden window)"
)]
pub fn place_hidden(hwnd: HWND, target: &Rect) -> Result<(), Refusal> {
    // SAFETY: a placement call on this process's own hidden window; no show flag, no activation.
    unsafe {
        wm::SetWindowPos(
            hwnd,
            None,
            target.left,
            target.top,
            target.width(),
            target.height(),
            wm::SWP_NOACTIVATE | wm::SWP_NOZORDER | wm::SWP_NOOWNERZORDER,
        )
    }
    .map_err(|e| Refusal::Win32(e.to_string()))
}

/// Moves the still-hidden window's corner onto screen 2 and keeps its size, so the window's DPI settles on the new
/// monitor before its size is judged (a window built on a 125% monitor is smaller in logical terms on a 100% one).
#[allow(
    clippy::disallowed_methods,
    reason = "the one smoke screen-2 helper (SetWindowPos without SWP_SHOWWINDOW, on a hidden window)"
)]
pub fn move_hidden(hwnd: HWND, left: i32, top: i32) -> Result<(), Refusal> {
    // SAFETY: a placement call on this process's own hidden window; no show flag, no activation, no resize.
    unsafe {
        wm::SetWindowPos(
            hwnd,
            None,
            left,
            top,
            0,
            0,
            wm::SWP_NOACTIVATE | wm::SWP_NOZORDER | wm::SWP_NOOWNERZORDER | wm::SWP_NOSIZE,
        )
    }
    .map_err(|e| Refusal::Win32(e.to_string()))
}

fn add_no_activate(hwnd: HWND) {
    // SAFETY: style change on this process's own window; WS_EX_NOACTIVATE only removes activation.
    unsafe {
        let ex = wm::GetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE);
        wm::SetWindowLongPtrW(hwnd, wm::GWL_EXSTYLE, ex | wm::WS_EX_NOACTIVATE.0 as isize);
    }
}

/// Shows (or hides again) without activation: the second `ShowWindow` site of the screen 2 helper.
#[allow(
    clippy::disallowed_methods,
    reason = "the one smoke screen-2 helper (SW_SHOWNOACTIVATE after the guard, SW_HIDE on any doubt)"
)]
pub fn show_state(hwnd: HWND, show: bool) {
    let command = if show {
        wm::SW_SHOWNOACTIVATE
    } else {
        wm::SW_HIDE
    };
    // SAFETY: a show call on this process's own window.
    let _ = unsafe { wm::ShowWindow(hwnd, command) };
}

/// The guarded show. Places the hidden window on screen 2, judges its DWM frame bounds, shows it without
/// activation, then judges again and checks that the foreground window did not move; on any doubt after the show
/// the window is hidden at once. Returns the frame bounds that were accepted.
pub fn show_guarded(hwnd: HWND, anchor: (i32, i32)) -> Result<Rect, Refusal> {
    let all = monitors()?;
    let screen2 = target(&all, anchor)?;
    move_hidden(hwnd, screen2.work.left + MARGIN, screen2.work.top + MARGIN)?;
    let settled = window_rect(hwnd)?;
    let wanted = placement((settled.width(), settled.height()), &screen2.work)?;
    place_hidden(hwnd, &wanted)?;
    judge(frame_bounds(hwnd)?, &screen2, &all)?;
    add_no_activate(hwnd);
    // SAFETY: a plain query.
    let before = hwnd_value(unsafe { wm::GetForegroundWindow() });
    show_state(hwnd, true);
    let verdict = frame_bounds(hwnd).and_then(|frame| {
        judge(frame, &screen2, &all)?;
        // SAFETY: a plain query.
        if hwnd_value(unsafe { wm::GetForegroundWindow() }) != before {
            return Err(Refusal::ForegroundMoved);
        }
        Ok(frame)
    });
    if verdict.is_err() {
        show_state(hwnd, false);
    }
    verdict
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect {
            left,
            top,
            right,
            bottom,
        }
    }

    fn pair() -> (Vec<Monitor>, Monitor) {
        let primary = Monitor {
            bounds: r(0, 0, 1920, 1080),
            work: r(0, 0, 1920, 1040),
            primary: true,
        };
        let second = Monitor {
            bounds: r(-1080, 228, 0, 2100),
            work: r(-1080, 228, 0, 2060),
            primary: false,
        };
        (vec![primary, second], second)
    }

    #[test]
    fn rectangles_overlap_and_contain_as_expected() {
        assert!(r(0, 0, 10, 10).intersects(&r(9, 9, 20, 20)));
        assert!(!r(0, 0, 10, 10).intersects(&r(10, 0, 20, 10)));
        assert!(r(1, 1, 9, 9).inside(&r(0, 0, 10, 10)));
        assert!(!r(1, 1, 11, 9).inside(&r(0, 0, 10, 10)));
        assert!(r(0, 0, 10, 10).contains_point(0, 0));
        assert!(!r(0, 0, 10, 10).contains_point(10, 5));
    }

    #[test]
    fn target_is_the_non_primary_monitor_holding_the_anchor() {
        let (all, second) = pair();
        assert_eq!(target(&all, ANCHOR), Ok(second));
        assert_eq!(target(&all, (100, 100)), Err(Refusal::TargetIsPrimary));
        assert_eq!(target(&all, (9000, 0)), Err(Refusal::NoMonitorAtAnchor));
    }

    #[test]
    fn guard_accepts_only_a_frame_inside_the_work_area() {
        let (all, second) = pair();
        assert_eq!(judge(r(-1000, 300, -200, 900), &second, &all), Ok(()));
        assert_eq!(judge(r(-500, 300, -8, 900), &second, &all), Ok(()));
        // spills by one pixel on each side, and into the taskbar strip
        for spill in [
            r(-1081, 300, -200, 900),
            r(-1000, 227, -200, 900),
            r(-1000, 300, 1, 900),
            r(-1000, 300, -200, 2061),
        ] {
            assert!(judge(spill, &second, &all).is_err(), "accepted {spill:?}");
        }
    }

    #[test]
    fn guard_refuses_a_frame_that_overlaps_or_touches_the_primary_monitor() {
        let (all, second) = pair();
        for frame in [
            r(100, 100, 900, 700),
            r(-500, 300, 0, 900),
            r(-500, 300, -1, 900),
            r(-500, 300, -7, 900),
        ] {
            assert!(
                matches!(judge(frame, &second, &all), Err(Refusal::TouchesPrimary(_))),
                "accepted {frame:?}"
            );
        }
    }

    #[test]
    fn placement_keeps_the_margin_or_refuses() {
        let work = r(-1080, 228, 0, 2100);
        assert_eq!(placement((800, 600), &work), Ok(r(-1064, 244, -264, 844)));
        assert!(placement((1080, 600), &work).is_err());
        assert!(placement((1048, 600), &work).is_ok());
        assert!(placement((1049, 600), &work).is_err());
    }
}
