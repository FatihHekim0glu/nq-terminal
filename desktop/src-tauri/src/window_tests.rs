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

#[test]
fn policy_refusal_names_the_hive() {
    let r = policy::PolicyRefusal {
        hive: "HKLM",
        value: "AdditionalBrowserArguments".into(),
    };
    assert!(r.to_string().contains("HKLM"));
}

fn options_with(ib_snapshot: bool) -> WindowOptions {
    WindowOptions {
        title: "nq-lab terminal".into(),
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        webview_data_dir: PathBuf::from(r"D:\dev\tmp\wv"),
        config_dir: PathBuf::from(r"D:\dev\tmp\config"),
        lab: Some(PathBuf::from(r"D:\dev\tmp\lab")),
        ib_snapshot,
    }
}

/// V032 review: the shell object said off whenever the window options were missing, while the backend could have
/// been started with the snapshot on. The value in force is the options' own (on included); missing options refuse
/// the setup; a smoke build says off.
#[test]
fn the_ib_snapshot_in_force_is_the_options_value_and_missing_options_refuse() {
    assert!(matches!(
        ib_in_force(Some(&options_with(true)), false),
        Ok(true)
    ));
    assert!(matches!(
        ib_in_force(Some(&options_with(false)), false),
        Ok(false)
    ));
    let missing = ib_in_force(None, false);
    assert!(
        matches!(&missing, Err(ShellError::Refused(why)) if why.contains("IB snapshot")),
        "{missing:?}"
    );
    assert!(matches!(
        ib_in_force(Some(&options_with(true)), true),
        Ok(false)
    ));
    assert!(matches!(ib_in_force(None, true), Ok(false)));
}
