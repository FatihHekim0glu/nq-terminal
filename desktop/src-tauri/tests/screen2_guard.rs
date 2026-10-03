//! The screen 2 guard (owner decision 10; plan W4B): the smoke build may show its window only on the non-primary
//! monitor, inside its work area, and only after a guard has compared the DWM frame bounds with that work area.
//! This file includes `src/smoke_screen2.rs` whole, so the code under test is the code the smoke build runs, and it
//! builds every rectangle from `GetMonitorInfo` (through `monitors()`), never from constants.
//!
//! Born failing: a naive guard that only asks "is the frame inside the target monitor's bounds" ACCEPTS the cases
//! below that the real guard refuses, and each of those cases is asserted both ways. No window is shown here: the
//! one real window the file makes is a never-shown STATIC window, used to see what DWM reports for a hidden window.
#![allow(
    dead_code,
    clippy::disallowed_methods,
    reason = "test: it includes the helper module whole and makes one never-shown window"
)]

#[path = "../src/smoke_screen2.rs"]
mod screen2;

use screen2::{Monitor, Rect, Refusal, judge, monitors, placement, target};

/// The naive guard of the plan's first draft: inside the target monitor's bounds, nothing else.
fn naive(frame: Rect, target: &Monitor) -> bool {
    frame.inside(&target.bounds)
}

/// The real monitors, and a screen 2 to test against: the real non-primary monitor holding the anchor when there is
/// one, otherwise a neighbour computed from the real primary monitor's `GetMonitorInfo` rectangles (placed to its
/// left, with the same work-area offsets). The second element says which it is.
fn setup() -> (Vec<Monitor>, Monitor, bool) {
    let all = monitors().expect("GetMonitorInfo");
    if let Ok(real) = target(&all, screen2::ANCHOR) {
        return (all, real, true);
    }
    let primary = *all.iter().find(|m| m.primary).expect("a primary monitor");
    let shift = |r: Rect| Rect {
        left: r.left - primary.bounds.width(),
        right: r.right - primary.bounds.width(),
        ..r
    };
    let neighbour = Monitor {
        bounds: shift(primary.bounds),
        work: shift(primary.work),
        primary: false,
    };
    println!(
        "NOTE: no non-primary monitor holds the anchor {:?}; using a neighbour computed from the primary monitor's rectangles",
        screen2::ANCHOR
    );
    let mut all = all;
    all.push(neighbour);
    (all, neighbour, false)
}

fn inset(r: Rect, by: i32) -> Rect {
    Rect {
        left: r.left + by,
        top: r.top + by,
        right: r.right - by,
        bottom: r.bottom - by,
    }
}

#[test]
fn monitor_rectangles_come_from_getmonitorinfo() {
    let all = monitors().expect("monitors");
    assert!(!all.is_empty());
    assert_eq!(
        all.iter().filter(|m| m.primary).count(),
        1,
        "exactly one primary monitor"
    );
    for m in &all {
        assert!(!m.bounds.is_empty() && m.work.inside(&m.bounds), "{m:?}");
    }
    println!("monitors: {all:#?}");
}

#[test]
fn a_frame_inside_the_work_area_and_clear_of_the_primary_is_accepted() {
    let (all, screen2, real) = setup();
    let frame = inset(screen2.work, screen2::MARGIN * 2);
    assert_eq!(
        judge(frame, &screen2, &all),
        Ok(()),
        "real screen 2: {real}"
    );
    let wanted = placement((600, 400), &screen2.work).expect("it fits");
    assert_eq!(judge(wanted, &screen2, &all), Ok(()));
}

#[test]
fn a_rectangle_touching_the_primary_monitor_is_refused() {
    let (all, screen2, _) = setup();
    let primary = all.iter().find(|m| m.primary).expect("primary");
    let overlapping = Rect {
        left: primary.bounds.left + 10,
        top: primary.bounds.top + 10,
        right: primary.bounds.left + 810,
        bottom: primary.bounds.top + 610,
    };
    // Flush with the work area's edge that faces the primary monitor: inside screen 2's work area, so a guard that
    // only asks for the work area accepts it, but it touches the primary monitor.
    let flush = Rect {
        right: screen2.work.right,
        left: screen2.work.right - 400,
        top: screen2.work.top + 40,
        bottom: screen2.work.top + 440,
    };
    let cases = [
        ("overlapping the primary", overlapping),
        ("flush against the primary", flush),
    ];
    for (name, frame) in cases {
        assert!(
            matches!(
                judge(frame, &screen2, &all),
                Err(Refusal::TouchesPrimary(_))
            ),
            "{name} was accepted: {frame:?}"
        );
    }
    assert!(
        flush.inside(&screen2.work) && naive(flush, &screen2),
        "born failing: the naive guard must accept the flush case, which is what the real guard exists to refuse"
    );
}

#[test]
fn a_frame_that_spills_outside_the_work_area_is_refused() {
    let (all, screen2, _) = setup();
    let w = screen2.work;
    let inside = inset(w, screen2::MARGIN * 2);
    let spills = [
        (
            "left",
            Rect {
                left: w.left - 1,
                ..inside
            },
        ),
        (
            "top",
            Rect {
                top: w.top - 1,
                ..inside
            },
        ),
        (
            "right",
            Rect {
                right: w.right + 1,
                ..inside
            },
        ),
        (
            "bottom",
            Rect {
                bottom: w.bottom + 1,
                ..inside
            },
        ),
        (
            "all sides",
            Rect {
                left: w.left - 1,
                top: w.top - 1,
                right: w.right + 1,
                bottom: w.bottom + 1,
            },
        ),
    ];
    for (side, frame) in spills {
        let verdict = judge(frame, &screen2, &all);
        assert!(
            matches!(
                verdict,
                Err(Refusal::OutsideWorkArea { .. } | Refusal::TouchesPrimary(_))
            ),
            "a frame spilling past the {side} edge was accepted: {frame:?} -> {verdict:?}"
        );
    }
}

#[test]
fn the_taskbar_strip_is_outside_the_work_area() {
    let (all, screen2, _) = setup();
    if screen2.work == screen2.bounds {
        println!(
            "SKIPPED the taskbar-strip case: this monitor's work area equals its bounds (no taskbar or app bar)"
        );
        return;
    }
    let strip_frame = Rect {
        left: screen2.bounds.left + 20,
        top: screen2.bounds.top + 20,
        right: screen2.bounds.right - 20,
        bottom: screen2.bounds.bottom - 5,
    };
    let reaches_bar = !strip_frame.inside(&screen2.work);
    assert!(reaches_bar, "the frame was meant to reach into the bar");
    assert!(
        naive(strip_frame, &screen2),
        "born failing: the naive guard (bounds only) must accept a frame that reaches into the taskbar"
    );
    assert!(
        matches!(
            judge(strip_frame, &screen2, &all),
            Err(Refusal::OutsideWorkArea { .. } | Refusal::TouchesPrimary(_))
        ),
        "the guard accepted a frame that reaches into the taskbar"
    );
}

#[test]
fn the_primary_monitor_is_never_a_target() {
    let all = monitors().expect("monitors");
    let primary = *all.iter().find(|m| m.primary).expect("primary");
    let centre = (
        primary.bounds.left + primary.bounds.width() / 2,
        primary.bounds.top + primary.bounds.height() / 2,
    );
    assert_eq!(target(&all, centre), Err(Refusal::TargetIsPrimary));
    let frame = inset(primary.work, screen2::MARGIN * 2);
    assert_eq!(judge(frame, &primary, &all), Err(Refusal::TargetIsPrimary));
}

#[test]
fn a_window_too_big_for_the_work_area_is_never_placed() {
    let (_, screen2, _) = setup();
    let too_wide = (screen2.work.width() + 1, 300);
    assert!(matches!(
        placement(too_wide, &screen2.work),
        Err(Refusal::TooBigForWorkArea { .. })
    ));
}

/// What DWM reports for a window that was created and placed but never shown: the guard runs before the show, so
/// the answer decides whether the pre-show check is real or only the post-show one is.
#[test]
fn dwm_frame_bounds_of_a_hidden_window_are_inside_its_work_area() {
    use windows::Win32::UI::WindowsAndMessaging as wm;
    use windows::core::w;
    let (all, screen2, real) = setup();
    if !real {
        println!("SKIPPED the hidden-window DWM case: no real screen 2 to place a window on");
        return;
    }
    // SAFETY: a STATIC window created, queried and destroyed on this thread; it is never shown.
    unsafe {
        let hwnd = wm::CreateWindowExW(
            wm::WS_EX_TOOLWINDOW,
            w!("STATIC"),
            w!("nqt screen2 probe"),
            wm::WS_OVERLAPPEDWINDOW,
            0,
            0,
            600,
            400,
            None,
            None,
            None,
            None,
        )
        .expect("a hidden window");
        assert!(
            !wm::IsWindowVisible(hwnd).as_bool(),
            "the probe window must stay hidden"
        );
        let current = screen2::window_rect(hwnd).expect("window rect");
        let wanted = placement((current.width(), current.height()), &screen2.work).expect("fits");
        screen2::place_hidden(hwnd, &wanted).expect("placed while hidden");
        let rect = screen2::window_rect(hwnd).expect("window rect after placement");
        let frame = screen2::frame_bounds(hwnd);
        let still_hidden = !wm::IsWindowVisible(hwnd).as_bool();
        let _ = wm::DestroyWindow(hwnd);
        assert!(still_hidden, "placing must not show the window");
        println!("hidden window rect {rect:?}, DWM frame bounds {frame:?}");
        let frame = frame
            .expect("DWM must answer for a hidden window, or the guard cannot run before the show");
        assert_eq!(
            judge(frame, &screen2, &all),
            Ok(()),
            "placed window frame {frame:?}"
        );
    }
}
