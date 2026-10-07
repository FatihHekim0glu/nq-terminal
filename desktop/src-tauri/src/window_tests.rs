//! The unit tests of window.rs, kept in their own file for size. It is a child module of window.rs, so it sees the
//! private items the tests exercise.

use super::*;

#[test]
fn a_failed_bridge_registration_is_a_refusal_and_a_good_one_is_not() {
    let failed: windows::core::Result<()> = Err(windows::core::Error::from_hresult(
        windows::core::HRESULT(0x8000_4005_u32 as i32),
    ));
    let text = bridge_script_refusal(&failed).expect("a failure is a refusal");
    assert!(text.contains("bridge"), "{text}");
    assert_eq!(bridge_script_refusal(&Ok(())), None);
}

#[test]
fn only_the_attribution_address_is_opened() {
    for good in [
        "https://www.tradingview.com/",
        "https://www.tradingview.com/?utm_medium=lwc-link&utm_campaign=lwc-chart&utm_source=127.0.0.1",
    ] {
        assert!(is_attribution(good), "refused {good}");
    }
    for bad in [
        "http://www.tradingview.com/",
        "https://www.tradingview.com.evil.example/",
        "https://evil.example/?https://www.tradingview.com/",
        "https://user@www.tradingview.com/",
        "https://www.tradingview.com:8443/",
        "https://www.tradingview.com/chart/",
        "https://www.tradingview.com/?q=1",
        "https://www.tradingview.com/#x",
        "https://tradingview.com/",
        "file:///C:/Windows/System32/calc.exe",
        "not a url",
        "",
    ] {
        assert!(!is_attribution(bad), "accepted {bad}");
    }
}

#[test]
fn settings_default_and_round_trip() {
    let empty: Settings = serde_json::from_str("{}").expect("an empty file parses");
    assert_eq!(empty, Settings::default());
    assert_eq!(
        (empty.zoom, empty.ib_snapshot, empty.lab),
        (100, false, None)
    );
    let full = Settings {
        lab: Some(PathBuf::from(r"C:\Users\Owner\nq-lab")),
        webview_data_dir: Some(PathBuf::from(PROPOSED_WEBVIEW_DIR)),
        zoom: 150,
        ib_snapshot: true,
    };
    let text = serde_json::to_string(&full).expect("serialises");
    assert_eq!(serde_json::from_str::<Settings>(&text).ok(), Some(full));
}

#[test]
fn the_title_names_the_lab() {
    let lab = Path::new(r"C:\Users\Owner\nq-lab");
    assert_eq!(
        title_for("nq-lab terminal", Some(lab)),
        r"nq-lab terminal (C:\Users\Owner\nq-lab)"
    );
    assert_eq!(title_for("nq-lab terminal", None), "nq-lab terminal");
}

#[test]
fn a_missing_lab_is_a_hard_error_only_when_needed() {
    assert!(matches!(
        check_lab_setting(None, true),
        Err(ShellError::Refused(_))
    ));
    assert!(check_lab_setting(None, false).is_ok());
    assert!(check_lab_setting(Some(Path::new(r"D:\dev\tmp\no-such-lab")), false).is_err());
}

#[test]
fn measure_needs_an_absolute_run_folder() {
    assert!(matches!(measure_paths(None), Err(ShellError::NotReady(_))));
    assert!(matches!(
        measure_paths(Some(r"runs\one".into())),
        Err(ShellError::Refused(_))
    ));
    let dir = PathBuf::from(r"D:\dev\tmp\nqt-measure-run");
    let (wv, config) = measure_paths(Some(dir.clone().into())).expect("absolute");
    assert_eq!((wv, config), (dir.join("wv"), dir.join("config")));
}

#[test]
fn measure_run_folder_stays_on_d_and_out_of_research_folders() {
    for bad in [
        r"C:\Users\someone\nq-lab\results\run1",
        r"C:\runs\one",
        r"D:\nq-lab\results\run1",
        r"D:\nq-lab\DATA\run1",
        r"D:\nq-lab\live\run1",
        r"D:\nq-lab\backtests\run1",
        r"D:\nq-lab\results.\run1",
        r"D:\dev\tmp\..\results\run1",
    ] {
        assert!(
            matches!(measure_paths(Some(bad.into())), Err(ShellError::Refused(_))),
            "{bad} must be refused"
        );
    }
    assert!(measure_paths(Some(r"D:\dev\tmp\run-results-data".into())).is_ok());
}

#[test]
fn a_resolved_folder_may_sit_on_another_data_drive_but_never_on_c_or_in_a_research_folder() {
    // D:\dev is a junction to E:\dev on a PC whose big folders moved: the name is on D:, the real folder is not.
    for ok in [r"E:\dev\tmp\run-results-data", r"D:\dev\tmp\run1"] {
        assert_eq!(folders::resolved_fault(Path::new(ok)), None, "{ok}");
    }
    for bad in [
        r"C:\Users\someone\run1",
        r"c:\runs\one",
        r"E:\nq-lab\results\run1",
        r"E:\nq-lab\Data\run1",
        r"D:\nq-lab\live.\run1",
    ] {
        assert!(
            folders::resolved_fault(Path::new(bad)).is_some(),
            "{bad} must be refused"
        );
    }
}

#[test]
fn the_shell_script_freezes_the_fields_and_states_the_ib_snapshot() {
    for (ib, word) in [(true, "ibSnapshot: true"), (false, "ibSnapshot: false")] {
        let script = shell_script(ib);
        for part in [
            "bridgeVersion: 3",
            "platform: 'windows'",
            "keys: 'pc'",
            word,
            "Object.freeze",
            "writable: false",
            "configurable: false",
        ] {
            assert!(script.contains(part), "missing {part}: {script}");
        }
    }
}

/// The very script the webview registers, run by node against a stand-in window: the object the page reads.
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a unit test runs node on the shell's own script"
)]
fn the_shell_script_gives_the_page_a_frozen_object() {
    for ib in [true, false] {
        let harness = format!(
            "const window = {{}}; window.top = window; {script} \
             const d = Object.getOwnPropertyDescriptor(window, '__NQT_SHELL__'); \
             console.log(JSON.stringify({{ value: d.value, frozen: Object.isFrozen(d.value), \
             writable: d.writable, configurable: d.configurable }}));",
            script = shell_script(ib)
        );
        let out = std::process::Command::new("node")
            .args(["-e", &harness])
            .output()
            .unwrap_or_else(|e| panic!("cannot run node: {e}"));
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let got: serde_json::Value = serde_json::from_slice(&out.stdout).expect("JSON");
        let value =
            json!({ "bridgeVersion": 3, "platform": "windows", "keys": "pc", "ibSnapshot": ib });
        assert_eq!(
            got,
            json!({ "value": value, "frozen": true, "writable": false, "configurable": false })
        );
    }
}

fn install_shell(shell: Option<Shell>) {
    let cell = SHELL.get_or_init(|| Mutex::new(None));
    *cell
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = shell;
}

fn scratch_settings(name: &str, settings: &Settings) -> (PathBuf, Vec<u8>) {
    let dir = crate::crash::test_support::fresh(name);
    let file = dir.join(SETTINGS_FILE);
    let bytes = serde_json::to_vec_pretty(settings).expect("serialises");
    #[allow(
        clippy::disallowed_methods,
        reason = "a unit test writes its own scratch settings file under D:\\dev"
    )]
    std::fs::write(&file, &bytes).expect("scratch settings");
    install_shell(Some(Shell {
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

/// The switch's write changes only `ib_snapshot`, keeps the old file as settings.json.1, and needs settings.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a unit test reads back its own scratch settings files under D:\\dev"
)]
fn the_ib_switch_writes_only_its_own_key_and_keeps_the_old_file() {
    install_shell(None);
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
    install_shell(None);
}

/// A test build never writes the switch, whatever asks: the file keeps its bytes and the stored value stays.
#[cfg(any(feature = "smoke", feature = "measure"))]
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a unit test reads back its own scratch settings file under D:\\dev"
)]
fn a_test_build_never_writes_the_ib_switch() {
    let (file, old_bytes) = scratch_settings("ib-switch-test-build", &saved_settings());
    assert!(store_ib_snapshot(true).is_err());
    assert_eq!(std::fs::read(&file).expect("read back"), old_bytes);
    assert_eq!(ib_snapshot_stored(), Some(false));
    install_shell(None);
}

#[test]
fn policy_refusal_names_the_hive() {
    let r = policy::PolicyRefusal {
        hive: "HKLM",
        value: "AdditionalBrowserArguments".into(),
    };
    assert!(r.to_string().contains("HKLM"));
}
