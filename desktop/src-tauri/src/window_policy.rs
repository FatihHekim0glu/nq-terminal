//! The WebView2 policy check (02 C3-8; 05 X04; 04 D4.2 item 9), a part of window.rs kept in its own file for size.
//!
//! WebView2 reads `Software\Policies\Microsoft\Edge\WebView2\<policy>` in HKCU and HKLM, one value per exe name (or
//! '*'), and the four policies below would change the engine under the shell: extra browser switches (a debugging
//! port), another browser build, another release channel or another profile folder. If any applies to this exe the
//! shell refuses to start. Both keys are readable without admin. Smoke builds can point the two roots at test keys
//! under `HKCU\Software\nq-terminal-test` (never the real policy keys) through `NQT_TEST_POLICY_ROOT`.

use std::fmt;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY, RegCloseKey,
    RegEnumValueW, RegOpenKeyExW,
};
use windows::core::{HSTRING, PWSTR};

/// WebView2 policies that would change the engine under the shell, under HKCU and HKLM.
pub const POLICY_KEY: &str = r"Software\Policies\Microsoft\Edge\WebView2";
pub const POLICY_NAMES: [&str; 4] = [
    "AdditionalBrowserArguments",
    "BrowserExecutableFolder",
    "ReleaseChannelPreference",
    "UserDataFolder",
];
/// Smoke only: the policy check reads `HKCU\<this>\hkcu` and `HKCU\<this>\hklm` instead of the two real keys.
#[cfg(feature = "smoke")]
pub const TEST_POLICY_VAR: &str = "NQT_TEST_POLICY_ROOT";
#[cfg(feature = "smoke")]
pub const TEST_POLICY_PREFIX: &str = r"Software\nq-terminal-test\";

/// A WebView2 policy value that applies to this exe, so the shell refuses to start.
#[derive(Debug)]
pub struct PolicyRefusal {
    pub hive: &'static str,
    pub value: String,
}

impl fmt::Display for PolicyRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "a WebView2 policy in {} sets {} for this app, so it will not start",
            self.hive, self.value
        )
    }
}

/// One registry place the policy check reads.
struct PolicyRoot {
    hive: &'static str,
    root: HKEY,
    path: String,
}

fn real_policy_roots() -> Vec<PolicyRoot> {
    [("HKCU", HKEY_CURRENT_USER), ("HKLM", HKEY_LOCAL_MACHINE)]
        .into_iter()
        .map(|(hive, root)| PolicyRoot {
            hive,
            root,
            path: POLICY_KEY.to_string(),
        })
        .collect()
}

/// Two test keys under HKCU standing in for the HKCU and HKLM policy keys.
#[cfg(any(test, feature = "smoke"))]
fn test_policy_roots(base: &str) -> Vec<PolicyRoot> {
    [("HKCU", "hkcu"), ("HKLM", "hklm")]
        .into_iter()
        .map(|(hive, leaf)| PolicyRoot {
            hive,
            root: HKEY_CURRENT_USER,
            path: format!(r"{base}\{leaf}"),
        })
        .collect()
}

#[cfg(feature = "smoke")]
fn policy_roots() -> Result<Vec<PolicyRoot>, PolicyRefusal> {
    match std::env::var(TEST_POLICY_VAR) {
        Err(_) => Ok(real_policy_roots()),
        Ok(base) if base.starts_with(TEST_POLICY_PREFIX) && !base.contains("..") => {
            Ok(test_policy_roots(&base))
        }
        Ok(other) => Err(PolicyRefusal {
            hive: "HKCU",
            value: format!("{TEST_POLICY_VAR} outside {TEST_POLICY_PREFIX} ({other})"),
        }),
    }
}

#[cfg(not(feature = "smoke"))]
fn policy_roots() -> Result<Vec<PolicyRoot>, PolicyRefusal> {
    Ok(real_policy_roots())
}

/// Refuses to start when a WebView2 policy (HKCU or HKLM `Software\Policies\Microsoft\Edge\WebView2`) sets
/// AdditionalBrowserArguments, BrowserExecutableFolder, ReleaseChannelPreference or UserDataFolder for this exe or
/// for '*'. Both keys are readable without admin; a key that exists but cannot be read also refuses (fail closed).
pub fn policy_check() -> Result<(), PolicyRefusal> {
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();
    check_policy(&policy_roots()?, &exe)
}

fn check_policy(roots: &[PolicyRoot], exe: &str) -> Result<(), PolicyRefusal> {
    for root in roots {
        for name in POLICY_NAMES {
            let path = format!(r"{}\{name}", root.path);
            let values = value_names(root.root, &path).map_err(|why| PolicyRefusal {
                hive: root.hive,
                value: format!("{name}, which could not be read ({why})"),
            })?;
            if let Some(hit) = values
                .iter()
                .find(|v| v.as_str() == "*" || v.eq_ignore_ascii_case(exe))
            {
                return Err(PolicyRefusal {
                    hive: root.hive,
                    value: format!("{name} (value {hit:?})"),
                });
            }
        }
    }
    Ok(())
}

/// The value names of one registry key; none when the key does not exist.
fn value_names(root: HKEY, path: &str) -> Result<Vec<String>, String> {
    let mut key = HKEY::default();
    let flags = KEY_READ | KEY_WOW64_64KEY;
    // SAFETY: opens a key for reading into a local handle that is closed below.
    let opened = unsafe { RegOpenKeyExW(root, &HSTRING::from(path), Some(0), flags, &mut key) };
    if opened == ERROR_FILE_NOT_FOUND {
        return Ok(Vec::new());
    }
    if opened != ERROR_SUCCESS {
        return Err(format!("error {}", opened.0));
    }
    let (mut names, mut buffer) = (Vec::new(), vec![0u16; 16_384]);
    let mut outcome = Ok(());
    for index in 0u32.. {
        let mut len = buffer.len() as u32;
        let name = PWSTR(buffer.as_mut_ptr());
        // SAFETY: the buffer outlives the call and `len` holds its size in characters.
        let read =
            unsafe { RegEnumValueW(key, index, Some(name), &mut len, None, None, None, None) };
        if read == ERROR_NO_MORE_ITEMS {
            break;
        }
        if read != ERROR_SUCCESS {
            outcome = Err(format!("error {}", read.0));
            break;
        }
        names.push(String::from_utf16_lossy(&buffer[..len as usize]));
    }
    // SAFETY: the handle was opened above and is closed once.
    let _ = unsafe { RegCloseKey(key) };
    outcome.map(|()| names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Registry::{
        KEY_ALL_ACCESS, REG_OPTION_NON_VOLATILE, REG_SZ, RegCreateKeyExW, RegDeleteTreeW,
        RegSetValueExW,
    };

    /// A fresh test tree under HKCU\Software\nq-terminal-test, removed when dropped. Never the real policy keys.
    struct TestTree(String);

    impl TestTree {
        fn new(tag: &str) -> Self {
            let base = format!(
                r"Software\nq-terminal-test\unit-{tag}-{}",
                std::process::id()
            );
            let tree = Self(base);
            tree.clear();
            tree
        }

        fn plant(&self, leaf: &str, policy: &str, value: &str) {
            let path = HSTRING::from(format!(r"{}\{leaf}\{policy}", self.0));
            let mut key = HKEY::default();
            let data: Vec<u8> = "planted\0"
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect();
            // SAFETY: creates and writes a key under the test tree, then closes it.
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

        fn clear(&self) {
            // SAFETY: removes the test tree only.
            let _ = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(self.0.as_str())) };
        }
    }

    impl Drop for TestTree {
        fn drop(&mut self) {
            self.clear();
        }
    }

    const EXE: &str = "nq-lab-terminal.exe";

    #[test]
    fn no_policy_lets_the_shell_start() {
        let tree = TestTree::new("none");
        assert!(check_policy(&test_policy_roots(&tree.0), EXE).is_ok());
    }

    #[test]
    fn a_planted_policy_in_either_root_refuses() {
        for (leaf, hive) in [("hkcu", "HKCU"), ("hklm", "HKLM")] {
            for policy in POLICY_NAMES {
                for value in [EXE, "NQ-LAB-TERMINAL.EXE", "*"] {
                    let tree = TestTree::new(&format!("{leaf}-{policy}"));
                    tree.plant(leaf, policy, value);
                    let refusal = check_policy(&test_policy_roots(&tree.0), EXE)
                        .expect_err("a planted policy must refuse");
                    assert_eq!(refusal.hive, hive);
                    assert!(refusal.value.contains(policy), "{refusal}");
                }
            }
        }
    }

    #[test]
    fn a_policy_for_another_exe_or_an_unlisted_policy_is_ignored() {
        let tree = TestTree::new("other");
        tree.plant("hkcu", "AdditionalBrowserArguments", "msedge.exe");
        tree.plant("hklm", "ChannelSearchKind", EXE);
        assert!(check_policy(&test_policy_roots(&tree.0), EXE).is_ok());
    }

    #[test]
    fn the_real_roots_are_the_two_policy_keys() {
        let roots = real_policy_roots();
        let hives: Vec<_> = roots.iter().map(|r| (r.hive, r.path.as_str())).collect();
        assert_eq!(hives, [("HKCU", POLICY_KEY), ("HKLM", POLICY_KEY)]);
        assert_eq!(roots[1].root, HKEY_LOCAL_MACHINE);
    }
}
