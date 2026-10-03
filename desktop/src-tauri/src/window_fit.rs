//! Fitting the window to the display it opens on (low-vision users run 150% and 200% scaling, where the fixed
//! logical minimum and default sizes are larger than the logical screen).
//!
//! The release asks for at most 90% of the work area of the monitor, and lowers the minimum so it never exceeds
//! that either; a size restored by the window-state plugin is checked again against the current work area. Test
//! builds keep their exact sizes so a measurement is reproducible.

use tauri::{LogicalSize, PhysicalSize};
use tauri::{Monitor, WebviewWindow};

/// The share of the work area a window may take when it opens (the work area already excludes the taskbar; the
/// slack covers the title bar and frame, so the whole window stays reachable).
pub const WORK_AREA_SHARE: f64 = 0.9;

/// Logical sizes the window builder gets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fit {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

impl Fit {
    /// No monitor to read: the sizes as asked for.
    pub const fn unclamped(want: (f64, f64)) -> Self {
        Self {
            width: want.0,
            height: want.1,
            min_width: crate::MIN_WIDTH,
            min_height: crate::MIN_HEIGHT,
        }
    }
}

/// The sizes for a work area of `work_width` x `work_height` physical pixels at `scale` (1.0 is 100%).
pub fn fit(work_width: u32, work_height: u32, scale: f64, want: (f64, f64)) -> Fit {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let room_width = (f64::from(work_width) / scale * WORK_AREA_SHARE).floor();
    let room_height = (f64::from(work_height) / scale * WORK_AREA_SHARE).floor();
    Fit {
        width: want.0.min(room_width),
        height: want.1.min(room_height),
        min_width: crate::MIN_WIDTH.min(room_width),
        min_height: crate::MIN_HEIGHT.min(room_height),
    }
}

/// The sizes for the primary monitor, where a new window opens.
pub fn initial(monitor: Option<&Monitor>, want: (f64, f64)) -> Fit {
    match monitor {
        Some(monitor) => {
            let area = monitor.work_area().size;
            fit(area.width, area.height, monitor.scale_factor(), want)
        }
        None => Fit::unclamped(want),
    }
}

/// Re-checks the built window (a restored size included) against the work area of the monitor it is on.
pub fn refit(window: &WebviewWindow) {
    if crate::TEST_BUILD
        || window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let (Ok(Some(monitor)), Ok(size), Ok(scale)) = (
        window.current_monitor(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    let fitted = initial(Some(&monitor), (logical.width, logical.height));
    let _ = window.set_min_size(Some(LogicalSize::new(fitted.min_width, fitted.min_height)));
    if fitted.width < logical.width || fitted.height < logical.height {
        let _ = window.set_size(PhysicalSize::new(
            to_physical(fitted.width, scale),
            to_physical(fitted.height, scale),
        ));
    }
}

fn to_physical(logical: f64, scale: f64) -> u32 {
    // Rounded and bounded by a work area, so the cast cannot truncate or wrap.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let physical = (logical * scale).round().max(1.0) as u32;
    physical
}

#[cfg(test)]
mod tests {
    use super::*;

    const WANT: (f64, f64) = (1280.0, 800.0);

    /// A 1920 x 1080 panel with the 48 px taskbar out of the work area, at the given scale.
    fn panel(scale: f64) -> Fit {
        fit(1920, 1032, scale, WANT)
    }

    #[test]
    fn a_roomy_screen_keeps_the_defaults() {
        let f = panel(1.0);
        assert_eq!((f.width, f.height), WANT);
        assert_eq!((f.min_width, f.min_height), (1024.0, 640.0));
    }

    #[test]
    fn at_150_percent_the_default_height_fits() {
        let f = panel(1.5);
        // 1280 x 688 logical, 90% = 1152 x 619.
        assert_eq!((f.width, f.height), (1152.0, 619.0));
        assert_eq!((f.min_width, f.min_height), (1024.0, 619.0));
    }

    #[test]
    fn at_200_percent_the_minimum_fits_the_logical_screen() {
        let f = panel(2.0);
        // 960 x 516 logical, 90% = 864 x 464.
        assert_eq!((f.width, f.height), (864.0, 464.0));
        assert_eq!((f.min_width, f.min_height), (864.0, 464.0));
    }

    #[test]
    fn a_fit_never_exceeds_the_work_area_and_the_minimum_never_exceeds_the_size() {
        for (w, h) in [
            (1920, 1032),
            (2560, 1392),
            (1366, 728),
            (1280, 672),
            (3840, 2072),
        ] {
            for scale in [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] {
                let f = fit(w, h, scale, WANT);
                assert!(
                    f.width * scale <= f64::from(w) * WORK_AREA_SHARE + 1.0,
                    "{w}x{h}@{scale}"
                );
                assert!(
                    f.height * scale <= f64::from(h) * WORK_AREA_SHARE + 1.0,
                    "{w}x{h}@{scale}"
                );
                assert!(
                    f.min_width <= f.width && f.min_height <= f.height,
                    "{w}x{h}@{scale}"
                );
            }
        }
    }

    #[test]
    fn a_restored_size_is_clamped_to_a_smaller_screen() {
        let f = fit(1920, 1032, 2.0, (3000.0, 2000.0));
        assert_eq!((f.width, f.height), (864.0, 464.0));
    }

    #[test]
    fn a_bad_scale_is_read_as_100_percent() {
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(fit(1920, 1032, scale, WANT), panel(1.0));
        }
    }

    #[test]
    fn no_monitor_means_the_sizes_asked_for() {
        assert_eq!(initial(None, WANT), Fit::unclamped(WANT));
    }
}
