//! The WebView2 policy check refuses to start (04 D4.2 item 9; 02 C3-8; 05 X04).
//!
//! The smoke exe is pointed at two test keys under `HKCU\Software\nq-terminal-test\<run>` standing in for the HKCU
//! and HKLM policy keys (`NQT_TEST_POLICY_ROOT`, smoke only; the real policy keys are never written). A planted
//! AdditionalBrowserArguments value for this exe in the HKCU stand-in, and a planted BrowserExecutableFolder value for
//! '*' in the HKLM stand-in, must each stop the start with exit code 3 and the policy refusal (which fails closed in a
//! test build: logged, no dialog), with no window and no foreground change.
//!
//! Born failing: the stage A `policy_check` allows every start, so the shell keeps running and the test fails.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use std::ffi::OsString;
use std::time::Duration;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_ALL_ACCESS, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
    RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW,
};
use windows::core::HSTRING;

/// A test tree under HKCU\Software\nq-terminal-test, removed when dropped.
struct TestTree(String);

impl TestTree {
    fn new(tag: &str) -> Self {
        let tree = Self(format!(
            r"Software\nq-terminal-test\{tag}-{}",
            std::process::id()
        ));
        tree.remove();
        tree
    }

    fn plant(&self, leaf: &str, policy: &str, value: &str) {
        let path = HSTRING::from(format!(r"{}\{leaf}\{policy}", self.0));
        let data: Vec<u8> = "--remote-debugging-port=9222\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let mut key = HKEY::default();
        // SAFETY: creates and writes one key of the test tree, then closes it.
        unsafe {
            let made = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &path,
                None,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_ALL_ACCESS,
                None,
                &mut key,
                None,
            );
            assert_eq!(made, ERROR_SUCCESS, "create {path}");
            let set = RegSetValueExW(key, &HSTRING::from(value), None, REG_SZ, Some(&data));
            assert_eq!(set, ERROR_SUCCESS, "set {value}");
            let _ = RegCloseKey(key);
        }
    }

    fn remove(&self) {
        // SAFETY: removes the test tree only.
        let _ = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(self.0.as_str())) };
    }
}

impl Drop for TestTree {
    fn drop(&mut self) {
        self.remove();
    }
}

fn refused_start(tag: &str, leaf: &str, policy: &str, value: &str, hive: &str) {
    let tree = TestTree::new(tag);
    tree.plant(leaf, policy, value);
    let run = run_dir(tag);
    let watch = start_watch();
    let env: [(&str, OsString); 1] = [("NQT_TEST_POLICY_ROOT", tree.0.clone().into())];
    let mut shell = launch(&run, &base_args(&run), &env);
    let code = wait_for_exit(&mut shell, Duration::from_secs(30));
    drop(shell);
    let report = watch.finish();
    let stderr = std::fs::read_to_string(run.join("shell.err.log")).unwrap_or_default();
    assert_eq!(
        code,
        Some(EXIT_POLICY),
        "{policy} in the {hive} stand-in: exit {code:?}; {stderr}"
    );
    assert!(
        stderr.contains(hive) && stderr.contains(policy),
        "the refusal names neither: {stderr}"
    );
    assert!(
        stderr.contains("\"dialog\":\"policy_refused\""),
        "the dialog did not fail closed: {stderr}"
    );
    assert!(
        !run.join("wv").exists(),
        "the engine started before the policy check"
    );
    assert_clean(&report);
}

#[test]
fn a_planted_policy_in_the_hkcu_stand_in_refuses_to_start() {
    let _one = one_run();
    refused_start(
        "policy-hkcu",
        "hkcu",
        "AdditionalBrowserArguments",
        "nq-lab-terminal.exe",
        "HKCU",
    );
}

#[test]
fn a_planted_policy_in_the_hklm_stand_in_refuses_to_start() {
    let _one = one_run();
    refused_start(
        "policy-hklm",
        "hklm",
        "BrowserExecutableFolder",
        "*",
        "HKLM",
    );
}

#[test]
fn a_test_root_outside_the_test_tree_is_refused() {
    let _one = one_run();
    let run = run_dir("policy-root");
    let env: [(&str, OsString); 1] = [("NQT_TEST_POLICY_ROOT", r"Software\Policies".into())];
    let watch = start_watch();
    let mut shell = launch(&run, &base_args(&run), &env);
    let code = wait_for_exit(&mut shell, Duration::from_secs(30));
    drop(shell);
    let report = watch.finish();
    assert_eq!(code, Some(EXIT_POLICY));
    assert_clean(&report);
}
