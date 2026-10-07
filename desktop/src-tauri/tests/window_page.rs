//! The window over a page, in a hidden smoke window driven over the debugging protocol (04 D4.2 items 3, 7, 10 and
//! 11; 02 C3-12; 03 section 4.5).
//!
//! The smoke exe starts with `--lab` naming a complete fake lab under the run folder (never the real lab) and
//! `--attach-url` naming the static test page on 127.0.0.1:8810, with a WebView2 data folder that does not exist yet.
//! Checked under the global window and foreground watch:
//! - `window.__NQT_SHELL__` is `{bridgeVersion: 3, platform: 'windows', keys: 'pc', ibSnapshot: false}` (a smoke build states the IB
//!   snapshot off), frozen and not writable;
//! - `window.open` and a look-alike link are refused (logged `new_window_denied`, no new target, no window);
//! - the attribution link reaches the system-browser handler, which the smoke build mocks (logged, nothing launched);
//! - the title shows the lab path;
//! - the data folder the shell created has a protected DACL (owner, SYSTEM, Administrators only).
//!
//! Born failing: the stage A shell injects no shell object, logs no new-window decision, titles the window without
//! the lab and leaves the data folder to WebView2 with an inherited DACL.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it reads its own run files and starts processes it owns"
)]

#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::{Value, json};
use std::path::Path;

const PAGE_BODY: &str = r#"const out = {};
out.shell = await evaluate(`(() => { const d = Object.getOwnPropertyDescriptor(window, '__NQT_SHELL__');
  return { value: window.__NQT_SHELL__ ?? null, frozen: Object.isFrozen(window.__NQT_SHELL__ ?? {}) && window.__NQT_SHELL__ !== undefined,
    writable: d ? d.writable : null, configurable: d ? d.configurable : null } })()`);
out.after_overwrite = await evaluate(`(() => { try { window.__NQT_SHELL__ = { platform: 'x' } } catch { }
  try { window.__NQT_SHELL__.platform = 'x' } catch { } try { delete window.__NQT_SHELL__ } catch { }
  return window.__NQT_SHELL__ ?? null })()`);
out.open = await evaluate(`(() => { const w = window.open('https://example.invalid/popup', '_blank'); return w === null ? 'null' : 'proxy' })()`, { userGesture: true });
await sleep(500);
await evaluate("document.getElementById('lookalike').click()", { userGesture: true });
await sleep(500);
await evaluate("document.getElementById('attr').click()", { userGesture: true });
await sleep(1500);
out.targets = (await targets()).map((t) => ({ type: t.type, url: t.url }));
console.log(JSON.stringify(out));
"#;

fn events<'a>(log: &'a [Value], name: &str) -> Vec<&'a Value> {
    log.iter().filter(|e| e["event"] == name).collect()
}

/// The shell object: the three fields, frozen, not writable, not configurable, and unchanged by the page.
fn check_shell_object(result: &Value) {
    let expected =
        json!({ "bridgeVersion": 3, "platform": "windows", "keys": "pc", "ibSnapshot": false });
    assert_eq!(result["shell"]["value"], expected, "{result}");
    assert_eq!(result["shell"]["frozen"], json!(true), "{result}");
    assert_eq!(result["shell"]["writable"], json!(false), "{result}");
    assert_eq!(result["shell"]["configurable"], json!(false), "{result}");
    assert_eq!(
        result["after_overwrite"], expected,
        "the page changed it: {result}"
    );
}

/// Every new window denied; the attribution link alone reached the mocked system-browser handler.
fn check_new_windows(result: &Value, log: &[Value]) {
    let denied: Vec<String> = events(log, "new_window_denied")
        .iter()
        .map(|e| e["url"].as_str().unwrap_or_default().to_string())
        .collect();
    assert!(
        denied
            .iter()
            .any(|u| u.starts_with("https://example.invalid/popup")),
        "{denied:?}"
    );
    assert!(
        denied
            .iter()
            .any(|u| u.contains("tradingview.com.evil.example")),
        "{denied:?}"
    );
    let opened = events(log, "external_open");
    assert_eq!(
        opened.len(),
        1,
        "the attribution link must reach the handler once: {log:?}"
    );
    assert_eq!(opened[0]["url"], json!("https://www.tradingview.com/"));
    assert_eq!(
        opened[0]["mocked"],
        json!(true),
        "the smoke build never launches a browser"
    );
    let pages = result["targets"].as_array().map_or(0, Vec::len);
    assert_eq!(pages, 1, "a new target appeared: {result}");
}

/// The data folder the shell created: a protected DACL with three entries, owner, SYSTEM and Administrators.
fn check_data_folder(run: &Path, log: &[Value]) {
    let sddl = dacl_sddl(&run.join("wv"));
    assert!(
        sddl.starts_with("D:P"),
        "the created data folder is not protected: {sddl}"
    );
    assert_eq!(
        sddl.split('(').skip(1).count(),
        3,
        "owner, SYSTEM and Administrators only: {sddl}"
    );
    for trustee in [";SY)", ";BA)"] {
        assert!(sddl.contains(trustee), "{trustee} missing: {sddl}");
    }
    let made = events(log, "data_dir")
        .first()
        .map(|e| e["created"].clone());
    assert_eq!(made, Some(json!(true)), "{log:?}");
}

#[test]
fn the_page_gets_the_shell_object_and_no_new_window() {
    let _one = one_run();
    let run = run_dir("page");
    let lab = fake_lab(&run, true);
    let _page = start_page_server(&run);
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend([
        "--lab".into(),
        lab.clone().into(),
        "--attach-url".into(),
        page_url().into(),
    ]);
    let mut shell = launch(&run, &args, &[]);
    let pid = shell.0.id();
    let port = devtools_port(&run, &mut shell);
    let result = cdp(port, &page_url(), PAGE_BODY);
    let title = shell_title(pid).unwrap_or_default();
    let closed = close_shell(&mut shell);
    drop(shell);
    let report = watch.finish();
    std::fs::write(run.join("result.json"), result.to_string()).expect("record");
    let log = shell_log(&run);
    check_shell_object(&result);
    check_new_windows(&result, &log);
    check_data_folder(&run, &log);
    assert!(
        title.contains(&lab.display().to_string()),
        "title {title:?} lacks {}",
        lab.display()
    );
    assert!(
        events(&log, "setup_failed").is_empty(),
        "a complete fake lab was refused: {log:?}"
    );
    assert!(closed, "the shell did not close on WM_CLOSE");
    assert_clean(&report);
}
