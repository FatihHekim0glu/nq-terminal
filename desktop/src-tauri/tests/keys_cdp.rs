//! Keys in a hidden smoke window driven over the debugging protocol (03 sections 11.1 and 11.3; 04 D4.2 items 4 to 6;
//! W0A P1).
//!
//! The smoke exe loads the static test page from 127.0.0.1:8810 with `--attach-url` and `--zoom 150`. The test reads
//! the shell's own read-back of the engine settings (`keys_installed`: browser accelerators off, the engine's zoom
//! control off, devtools on only because this is smoke, the zoom factor restored to 1.5), then sends F5, F12, Ctrl+F,
//! Ctrl+P and Ctrl+R (no reload, no print, no devtools, no new target) and F1 and F8 to F11 (each reaches the page),
//! all under the global window and foreground watch. Key events sent over the protocol do not pass the host's
//! accelerator path (W0A P1), so the real-keyboard effect stays an owner check; the shell's key-to-zoom mapping is
//! covered without a window by the unit tests in src/keys.rs.
//!
//! Born failing: the stage A shell installs nothing, so `keys_installed` is absent and the test fails.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::{Value, json};
use std::time::Duration;

const KEYS_BODY: &str = r#"const out = {};
out.marker = await evaluate('window.__marker');
out.url = await evaluate('location.href');
const blocked = [
  { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 },
  { key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 },
  { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 },
  { key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, modifiers: 2 },
  { key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 2 },
];
for (const k of blocked) { await key(k); await sleep(400) }
await sleep(1000);
out.after_blocked = await evaluate('({ marker: window.__marker, prints: window.__prints, url: location.href })');
await evaluate('window.__keys.length = 0');
for (const vk of [112, 119, 120, 121, 122]) { const name = 'F' + (vk - 111); await key({ key: name, code: name, windowsVirtualKeyCode: vk }); await sleep(200) }
await sleep(500);
out.page_keys = await evaluate('window.__keys.slice()');
out.targets = (await targets()).map((t) => ({ type: t.type, url: t.url }));
out.dpr = await evaluate('window.devicePixelRatio');
console.log(JSON.stringify(out));
"#;

fn page_targets(result: &Value) -> Vec<String> {
    result["targets"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|t| format!("{} {}", t["type"], t["url"]))
                .collect()
        })
        .unwrap_or_default()
}

/// The shell's own read-back of the engine settings.
fn check_read_back(read_back: &Value) {
    assert_eq!(read_back["accelerator_keys"], json!(false), "{read_back}");
    assert_eq!(read_back["zoom_control"], json!(false), "{read_back}");
    assert_eq!(
        read_back["devtools"],
        json!(true),
        "smoke keeps devtools: {read_back}"
    );
    assert_eq!(
        read_back["zoom_factor"],
        json!(1.5),
        "the --zoom level: {read_back}"
    );
}

/// The browser keys did nothing; the page keys reached the page.
fn check_keys(result: &Value) {
    let after = &result["after_blocked"];
    assert_eq!(
        after["marker"], result["marker"],
        "the page reloaded: {result}"
    );
    assert_eq!(after["url"], result["url"], "the page navigated: {result}");
    assert_eq!(after["prints"], json!(0), "a print started: {result}");
    let targets = page_targets(result);
    assert_eq!(
        targets.len(),
        1,
        "a new target appeared (devtools, find or print): {targets:?}"
    );
    let page_keys = result["page_keys"].as_array().cloned().unwrap_or_default();
    for name in ["F1", "F8", "F9", "F10", "F11"] {
        assert!(
            page_keys.contains(&json!(name)),
            "{name} did not reach the page: {result}"
        );
    }
}

#[test]
fn browser_keys_do_nothing_and_page_keys_reach_the_page() {
    let _one = one_run();
    let run = run_dir("keys");
    let before_c = c_drive_folders();
    let _page = start_page_server(&run);
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend([
        "--attach-url".into(),
        page_url().into(),
        "--zoom".into(),
        "150".into(),
    ]);
    let mut shell = launch(&run, &args, &[]);
    let port = devtools_port(&run, &mut shell);
    let result = cdp(port, &page_url(), KEYS_BODY);
    let installed = wait_for_event(&run, "keys_installed", Duration::from_secs(10));
    let closed = close_shell(&mut shell);
    drop(shell);
    let report = watch.finish();
    std::fs::write(run.join("result.json"), result.to_string()).expect("record");
    let read_back = installed.unwrap_or_else(|| panic!("no keys_installed: {:?}", shell_log(&run)));
    check_read_back(&read_back);
    check_keys(&result);
    assert!(closed, "the shell did not close on WM_CLOSE");
    assert_clean(&report);
    let new_c: Vec<_> = c_drive_folders().difference(&before_c).cloned().collect();
    assert!(new_c.is_empty(), "new folders on C: {new_c:?}");
}
