//! The shell's settings in memory and their writes (03 section 10.5), a part of window.rs kept in its own file for
//! size: the zoom (`store_zoom`, saved on a worker thread) and the IB snapshot switch (`store_ib_snapshot`, saved at
//! once after the owner's native confirm, ib_switch.rs).
//!
//! Every write goes through writes.rs, one at a time under `SAVING`: the old file moves to `settings.json.1`
//! (rotate), then the new one is written with `write_new`, so a crash in between leaves the old copy readable. The
//! switch holds `SAVING` from before it reads the settings until after its write and any rollback, and changes the
//! value in memory only after its write has succeeded: a zoom save, which waits for `SAVING`, can therefore never
//! write a value the owner was told was not saved (V032 review).

use super::Settings;
use crate::{TEST_BUILD, keys, writes};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(super) struct Shell {
    pub(super) settings: Settings,
    pub(super) file: PathBuf,
    /// First-run choices not yet written (writes.rs is configured only after `resolve`).
    pub(super) pending: bool,
    pub(super) created_data_dir: bool,
}

static SHELL: OnceLock<Mutex<Option<Shell>>> = OnceLock::new();
/// Held by every settings write, and by the IB switch across its whole change.
static SAVING: Mutex<()> = Mutex::new(());

/// The settings file writer: rotate, then write the new file (`write_file`; the tests pass their own).
type SettingsWriter<'a> = &'a dyn Fn(&Settings, &Path) -> Result<(), String>;
/// The settings as the next start would read them from `file` (the file, else its backup), None when neither reads.
type ReadBack<'a> = &'a dyn Fn(&Path) -> Option<Settings>;

pub(super) fn with_shell<T>(f: impl FnOnce(&mut Shell) -> T) -> Option<T> {
    let cell = SHELL.get_or_init(|| Mutex::new(None));
    let mut guard = cell
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.as_mut().map(f)
}

/// Puts the settings read by `resolve` in force (or none, in the tests).
pub(super) fn install(shell: Option<Shell>) {
    let cell = SHELL.get_or_init(|| Mutex::new(None));
    *cell
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = shell;
}

fn lock_saving() -> MutexGuard<'static, ()> {
    SAVING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The settings in force (defaults before `resolve`).
pub fn settings() -> Settings {
    with_shell(|s| s.settings.clone()).unwrap_or_default()
}

/// The app zoom in force, on the 25% grid.
pub fn zoom_percent() -> u16 {
    keys::snap(settings().zoom)
}

/// Keeps a new zoom level and writes the settings file on a worker thread.
pub fn store_zoom(percent: u16) {
    if with_shell(|s| s.settings.zoom = keys::snap(percent)).is_some() {
        std::thread::spawn(save_settings);
    }
}

/// The stored read-only IB snapshot value (the next start's), or None before the settings are read.
pub fn ib_snapshot_stored() -> Option<bool> {
    with_shell(|s| s.settings.ib_snapshot)
}

/// The IB snapshot switch (ib_switch.rs, after the owner's native confirm): changes only `ib_snapshot` in the settings
/// and writes the file now, rotate first. The window options and the running backend keep the value they started with.
/// A test build never writes (its dialogs fail closed before this, and this refuses too). A failed write changes
/// nothing in memory and leaves the old value on disk (`store_ib_with`).
pub fn store_ib_snapshot(on: bool) -> Result<(), String> {
    if TEST_BUILD {
        return Err("a test build never changes the IB snapshot setting".into());
    }
    store_ib_with(on, &write_file, &stored_on_disk)
}

/// The switch's change, under `SAVING` from start to end: a copy of the settings with the new value is written, and
/// the value in memory changes only once that write has succeeded. After a failed write the file is read back as the
/// next start would read it; when the old value is not what it finds (the write failed after the new file was
/// written), the old settings are written again. Either way the owner, who is told the change was not saved, finds
/// the old value at the next start.
fn store_ib_with(
    on: bool,
    write: SettingsWriter<'_>,
    read_back: ReadBack<'_>,
) -> Result<(), String> {
    let _one = lock_saving();
    let Some((before, file)) = with_shell(|s| (s.settings.clone(), s.file.clone())) else {
        return Err("no settings are loaded".into());
    };
    let after = Settings {
        ib_snapshot: on,
        ..before.clone()
    };
    match write(&after, &file) {
        Ok(()) => {
            with_shell(|s| s.settings.ib_snapshot = on);
            Ok(())
        }
        Err(e) => {
            roll_back(&before, &file, write, read_back);
            Err(e)
        }
    }
}

/// After a failed switch write (`SAVING` held): writes `before` again only when the file, as the next start reads it,
/// does not hold its IB value. Logged as `ib_switch_rollback` (the values are on or off, never a path's content).
fn roll_back(before: &Settings, file: &Path, write: SettingsWriter<'_>, read_back: ReadBack<'_>) {
    let on_disk = read_back(file).map(|s| s.ib_snapshot);
    let rewritten = (on_disk != Some(before.ib_snapshot)).then(|| write(before, file));
    let error = rewritten.as_ref().and_then(|r| r.as_ref().err());
    let detail = json!({ "on_disk": on_disk, "rewritten": rewritten.is_some(), "error": error });
    crate::crash::log("ib_switch_rollback", detail);
}

/// The settings as the next start would read them (window_settings.rs); a smoke build has no settings file.
fn stored_on_disk(file: &Path) -> Option<Settings> {
    #[cfg(not(feature = "smoke"))]
    {
        super::settings_file::read_stored(file)
            .ok()
            .and_then(|stored| stored.settings)
    }
    #[cfg(feature = "smoke")]
    {
        let _ = file;
        None
    }
}

/// `write_settings` for a caller that only logs the outcome.
pub(super) fn save_settings() {
    let _ = write_settings();
}

/// Writes the settings in memory, one write at a time.
fn write_settings() -> Result<(), String> {
    let _one = lock_saving();
    let Some((settings, file)) = with_shell(|s| (s.settings.clone(), s.file.clone())) else {
        return Err("no settings are loaded".into());
    };
    write_file(&settings, &file)
}

/// Writes `settings` to `file` through writes.rs: the old file moves to `settings.json.1` (rotate), then the new one
/// is written with `write_new`. The caller holds `SAVING`.
fn write_file(settings: &Settings, file: &Path) -> Result<(), String> {
    let result = serde_json::to_vec_pretty(settings)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            writes::rotate(file, 0, 1).map_err(|e| e.to_string())?;
            writes::write_new(file, &bytes).map_err(|e| e.to_string())
        });
    let detail = json!({ "file": file.display().to_string(), "error": result.as_ref().err() });
    crate::crash::log("settings_saved", detail);
    result
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests write and read back their own scratch settings files under D:\\dev; not shipped code"
)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// The settings in memory are one global: the tests that install them run one at a time.
    static ONE_TEST: Mutex<()> = Mutex::new(());

    fn one_test() -> MutexGuard<'static, ()> {
        ONE_TEST
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn scratch_settings(name: &str, settings: &Settings) -> (PathBuf, Vec<u8>) {
        let dir = crate::crash::test_support::fresh(name);
        let file = dir.join(super::super::SETTINGS_FILE);
        let bytes = serde_json::to_vec_pretty(settings).expect("serialises");
        std::fs::write(&file, &bytes).expect("scratch settings");
        install(Some(Shell {
            settings: settings.clone(),
            file: file.clone(),
            pending: false,
            created_data_dir: false,
        }));
        (file, bytes)
    }

    fn saved_settings() -> Settings {
        Settings {
            lab: Some(PathBuf::from(r"D:\dev\tmp\lab")),
            webview_data_dir: Some(PathBuf::from(r"D:\dev\tmp\wv")),
            zoom: 125,
            ib_snapshot: false,
        }
    }

    /// The settings file itself, parsed (the tests read the file the next start would read first).
    fn on_disk(file: &Path) -> Option<Settings> {
        let bytes = std::fs::read(file).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// The switch's write changes only `ib_snapshot`, keeps the old file as settings.json.1, and needs settings.
    #[cfg(not(any(feature = "smoke", feature = "measure")))]
    #[test]
    fn the_ib_switch_writes_only_its_own_key_and_keeps_the_old_file() {
        let _one = one_test();
        install(None);
        assert!(store_ib_snapshot(true).is_err(), "no settings, no write");
        let (file, old_bytes) = scratch_settings("ib-switch-settings", &saved_settings());
        store_ib_snapshot(true).expect("written");
        let read = |path: &Path| -> serde_json::Value {
            serde_json::from_slice(&std::fs::read(path).expect("read back")).expect("JSON")
        };
        let mut new = read(&file);
        let mut old: serde_json::Value = serde_json::from_slice(&old_bytes).expect("JSON");
        assert_eq!(new["ib_snapshot"], json!(true));
        for value in [&mut new, &mut old] {
            value
                .as_object_mut()
                .expect("an object")
                .remove("ib_snapshot");
        }
        assert_eq!(new, old, "only ib_snapshot may change");
        let kept = std::fs::read(file.with_file_name("settings.json.1")).expect("the old copy");
        assert_eq!(kept, old_bytes);
        assert_eq!(ib_snapshot_stored(), Some(true));
        assert_eq!(settings().zoom, 125);
        install(None);
    }

    /// A test build never writes the switch, whatever asks: the file keeps its bytes and the stored value stays.
    #[cfg(any(feature = "smoke", feature = "measure"))]
    #[test]
    fn a_test_build_never_writes_the_ib_switch() {
        let _one = one_test();
        let (file, old_bytes) = scratch_settings("ib-switch-test-build", &saved_settings());
        assert!(store_ib_snapshot(true).is_err());
        assert_eq!(std::fs::read(&file).expect("read back"), old_bytes);
        assert_eq!(ib_snapshot_stored(), Some(false));
        install(None);
    }

    /// V032 review: the value in memory changed outside `SAVING`, so a zoom save waiting for `SAVING` could write the
    /// new value although the switch's own write then failed and the owner was told it was not saved. Now, while
    /// another holder of `SAVING` waits, memory keeps the old value, and a zoom save queued behind a failed switch
    /// write keeps the old value on disk.
    #[test]
    fn a_failed_switch_write_never_reaches_memory_or_a_queued_save() {
        let _one = one_test();
        let (file, _) = scratch_settings("ib-switch-saving", &saved_settings());
        let held = lock_saving();
        let switch = std::thread::spawn(|| {
            let failing = |_: &Settings, _: &Path| Err("planted write failure".to_string());
            store_ib_with(true, &failing, &on_disk)
        });
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(
            ib_snapshot_stored(),
            Some(false),
            "the switch changed memory while another holder of SAVING could write it"
        );
        let zoom = std::thread::spawn(save_settings);
        std::thread::sleep(Duration::from_millis(100));
        drop(held);
        assert!(switch.join().expect("the switch thread").is_err());
        zoom.join().expect("the zoom save thread");
        assert_eq!(ib_snapshot_stored(), Some(false));
        let stored = on_disk(&file).expect("the queued save wrote the file");
        assert!(
            !stored.ib_snapshot,
            "the queued save wrote the unsaved value"
        );
        install(None);
    }

    /// A write that fails after the new file was written (a flush error) is rolled back on disk too: the old value is
    /// written again, so the next start reads what the owner was told is still set.
    #[test]
    fn a_write_that_failed_after_writing_is_rolled_back_on_disk() {
        let _one = one_test();
        let (file, _) = scratch_settings("ib-switch-rollback", &saved_settings());
        let calls = AtomicUsize::new(0);
        let late_failure = |settings: &Settings, path: &Path| {
            let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
            write_file(settings, path)?;
            if first {
                Err("planted failure after the write".to_string())
            } else {
                Ok(())
            }
        };
        assert!(store_ib_with(true, &late_failure, &on_disk).is_err());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "the old value is written again"
        );
        assert_eq!(on_disk(&file).map(|s| s.ib_snapshot), Some(false));
        assert_eq!(ib_snapshot_stored(), Some(false));
        install(None);
    }

    /// A write that failed before it changed the file (a refused rotate) leaves the old file alone: nothing is written
    /// again, and the old copy is not rotated away.
    #[test]
    fn a_write_that_changed_nothing_is_not_written_again() {
        let _one = one_test();
        let (file, old_bytes) = scratch_settings("ib-switch-untouched", &saved_settings());
        let calls = AtomicUsize::new(0);
        let refused = |_: &Settings, _: &Path| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("planted refusal".to_string())
        };
        assert!(store_ib_with(true, &refused, &on_disk).is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read(&file).expect("read back"), old_bytes);
        assert_eq!(ib_snapshot_stored(), Some(false));
        install(None);
    }

    /// A successful switch write puts the new value in memory and on disk and changes nothing else.
    #[test]
    fn a_successful_switch_write_changes_memory_after_the_file() {
        let _one = one_test();
        let (file, _) = scratch_settings("ib-switch-success", &saved_settings());
        let seen_in_memory = Mutex::new(None);
        let writer = |settings: &Settings, path: &Path| {
            *seen_in_memory.lock().expect("lock") =
                Some(with_shell(|s| s.settings.ib_snapshot).expect("settings are loaded"));
            write_file(settings, path)
        };
        store_ib_with(true, &writer, &on_disk).expect("written");
        assert_eq!(*seen_in_memory.lock().expect("lock"), Some(false));
        assert_eq!(ib_snapshot_stored(), Some(true));
        let stored = on_disk(&file).expect("the file");
        assert_eq!((stored.ib_snapshot, stored.zoom), (true, 125));
        install(None);
    }
}
