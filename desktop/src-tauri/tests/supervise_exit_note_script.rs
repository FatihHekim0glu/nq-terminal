//! The exit code line on the stopped page (V031B review finding): the script that writes it runs through the webview's
//! eval right after the navigation to stopped.html was started, and in the common case (the backend exits while the
//! window shows the app page) the webview is still on the outgoing page then. The script must wait for the stopped
//! page, bounded, and not give up on the first look at another page.
//!
//! Born failing: the script returned at once on any page but the stopped page, so the code never appeared. The script
//! is run here by node against a stubbed location, document and timer, so the very text the shell evals is executed.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: runs node on the shell's own script"
)]

#[allow(dead_code)]
#[path = "../src/link.rs"]
mod link;
#[allow(dead_code, unused_imports)]
mod supervise {
    #[path = "../../src/supervise_check.rs"]
    pub mod check;
}

use serde_json::Value;
use std::process::Command;
use supervise::check::{EXIT_NOTE_ID, exit_note_script};

/// Runs `script` against a page that is `before` (a path) until `switch_after` timer ticks have passed and is
/// `after` from then on; the element exists only on the stopped page. Reports the element's text and the tick count.
fn run(script: &str, before: &str, after: &str, switch_after: u32, loading_ticks: u32) -> Value {
    let harness = format!(
        r#"
const script = {script_json};
let ticks = 0;
const pending = [];
const el = {{ textContent: 'stale' }};
const location = {{ pathname: {before_json} }};
const document = {{
  get readyState() {{ return ticks < {loading_ticks} + {switch_after} ? 'loading' : 'complete'; }},
  getElementById: (id) => (location.pathname.endsWith('stopped.html') && id === {id_json} ? el : null),
}};
const setTimeout = (f) => {{ pending.push(f); }};
new Function('location', 'document', 'setTimeout', script)(location, document, setTimeout);
while (pending.length) {{
  ticks += 1;
  if (ticks >= {switch_after}) location.pathname = {after_json};
  if (ticks > 500) break;
  pending.shift()();
}}
console.log(JSON.stringify({{ text: el.textContent, ticks }}));
"#,
        script_json = serde_json::to_string(script).expect("script"),
        before_json = serde_json::to_string(before).expect("path"),
        after_json = serde_json::to_string(after).expect("path"),
        id_json = serde_json::to_string(EXIT_NOTE_ID).expect("id"),
    );
    let out = Command::new("node")
        .args(["-e", &harness])
        .output()
        .unwrap_or_else(|e| panic!("cannot run node: {e}"));
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("the harness prints JSON")
}

#[test]
fn the_script_waits_through_the_outgoing_page_and_writes_the_code_once_the_stopped_page_is_there() {
    let script = exit_note_script(Some(3));
    let r = run(&script, "/", "/stopped.html", 4, 1);
    assert_eq!(r["text"], "The backend ended with exit code 3.", "{r}");
}

#[test]
fn the_script_clears_an_earlier_code_on_the_stopped_page_even_after_a_wait() {
    let script = exit_note_script(None);
    let r = run(&script, "/", "/stopped.html", 6, 0);
    assert_eq!(r["text"], "", "{r}");
}

#[test]
fn the_script_on_the_stopped_page_at_once_writes_without_waiting() {
    let script = exit_note_script(Some(0));
    let r = run(&script, "/stopped.html", "/stopped.html", 0, 0);
    assert_eq!(r["text"], "The backend ended with exit code 0.", "{r}");
}

#[test]
fn the_wait_is_bounded_and_nothing_is_written_to_another_page() {
    let script = exit_note_script(Some(3));
    let r = run(&script, "/", "/", 0, 0);
    assert_eq!(r["text"], "stale", "{r}");
    let ticks = r["ticks"].as_u64().expect("ticks");
    assert!((1..=60).contains(&ticks), "the wait must stop: {r}");
}
