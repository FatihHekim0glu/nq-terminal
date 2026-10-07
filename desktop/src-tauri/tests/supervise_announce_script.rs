//! The stopped page's announcement on the common full-load path (V032 audit finding): the backend exits while the
//! window shows the app page, so the navigation to stopped.html is a full load and the first eval can run in the
//! outgoing document, where the script's own poll dies with it. The shell therefore evaluates the announcement again
//! (a few times, off its thread). The again-script must announce on the fresh page, leave a focus that moved on alone
//! (Retry link), and build the title from the reason's own text, never from an exit code written inside the line.
//!
//! Born failing: there was no again-script, and the title was the whole text content, so an exit code written into
//! the reason line before the repeat ran ended up in the title. The scripts are run by node against stubbed
//! document and location objects, so the very text the shell evals is executed.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: runs node on the shell's own script"
)]

#[path = "../src/window_rebuild_announce.rs"]
mod announce;

use serde_json::{Value, json};
use std::process::Command;

const REASON: &str = "The backend stopped.";
const CODE: &str = "The backend ended with exit code 3.";

/// The stubs: a document whose reason line holds a text node and, when `code` is set, the exit code span after it.
const HARNESS: &str = r#"
const scripts = SCRIPTS;
const doc = { title: 'nq-lab terminal: stopped', readyState: 'complete', activeElement: null, focusCalls: 0 };
const text = (t) => ({ nodeType: 3, textContent: t, nextSibling: null });
const span = (t) => ({ nodeType: 1, textContent: t, nextSibling: null });
function line(id, parts) {
  const h = { id, parts, setAttribute() {}, focus() { doc.activeElement = h; doc.focusCalls += 1; } };
  for (let i = 0; i < parts.length - 1; i++) parts[i].nextSibling = parts[i + 1];
  h.firstChild = parts[0];
  Object.defineProperty(h, 'textContent', { get: () => parts.map((p) => p.textContent).join('') });
  return h;
}
const body = { id: 'body' };
const link = { id: 'retry' };
const parts = [text(REASON)];
if (CODE_ON) parts.push(span(CODE));
const reason = line('exited-text', parts);
let present = PRESENT;
doc.body = body;
doc.activeElement = body;
doc.getElementById = (id) => (present && id === 'exited-text' ? reason : null);
const location = { hash: HASH };
const timers = [];
const setTimeout = (f) => { timers.push(f); };
const run = (script) => new Function('document', 'location', 'setTimeout', script)(doc, location, setTimeout);
STEPS
console.log(JSON.stringify({ title: doc.title, focus: doc.activeElement && doc.activeElement.id, focusCalls: doc.focusCalls, timers: timers.length }));
"#;

struct Page {
    code_written: bool,
    present: bool,
    hash: &'static str,
}

fn run_node(page: &Page, steps: &str) -> Value {
    let scripts = json!({
        "first": announce::announce_script("exited"),
        "again": announce::announce_again_script("exited"),
    });
    let harness = HARNESS
        .replace("SCRIPTS", &scripts.to_string())
        .replace("REASON", &json!(REASON).to_string())
        .replace("CODE_ON", &page.code_written.to_string())
        .replace("CODE", &json!(CODE).to_string())
        .replace("PRESENT", &page.present.to_string())
        .replace("HASH", &json!(page.hash).to_string())
        .replace("STEPS", steps);
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

fn expected_title() -> Value {
    json!(format!("nq-lab terminal: {REASON}"))
}

#[test]
fn the_title_is_the_reason_text_alone_even_when_the_exit_code_is_already_written_inside_the_line() {
    let page = Page {
        code_written: true,
        present: true,
        hash: "#exited",
    };
    let r = run_node(&page, "run(scripts.first);");
    assert_eq!(r["title"], expected_title(), "{r}");
    assert_eq!(r["focus"], "exited-text", "{r}");
}

#[test]
fn a_full_load_after_the_first_eval_is_announced_by_the_again_script_on_the_fresh_page() {
    // The first eval ran in the outgoing document (no stopped page there): its poll is a timer that dies with it.
    // The fresh document then gets the again-script, with the exit code already written.
    let page = Page {
        code_written: true,
        present: false,
        hash: "",
    };
    let steps = "run(scripts.first); timers.length = 0; present = true; location.hash = '#exited'; run(scripts.again);";
    let r = run_node(&page, steps);
    assert_eq!(r["title"], expected_title(), "{r}");
    assert_eq!(r["focus"], "exited-text", "{r}");
}

#[test]
fn the_again_script_is_a_no_op_once_the_reason_line_holds_focus() {
    let page = Page {
        code_written: false,
        present: true,
        hash: "#exited",
    };
    let steps = "run(scripts.first); run(scripts.again); run(scripts.again);";
    let r = run_node(&page, steps);
    assert_eq!(r["focus"], "exited-text", "{r}");
    assert_eq!(r["focusCalls"], 1, "{r}");
}

#[test]
fn the_again_script_never_takes_focus_back_from_a_link_the_reader_moved_to() {
    let page = Page {
        code_written: false,
        present: true,
        hash: "#exited",
    };
    let steps = "run(scripts.first); doc.activeElement = link; run(scripts.again);";
    let r = run_node(&page, steps);
    assert_eq!(r["focus"], "retry", "{r}");
    assert_eq!(r["focusCalls"], 1, "{r}");
}

#[test]
fn the_again_script_does_not_wait_and_the_first_script_still_does() {
    let page = Page {
        code_written: false,
        present: false,
        hash: "",
    };
    let r = run_node(&page, "run(scripts.again);");
    assert_eq!(
        r["timers"], 0,
        "the again-script is repeated by the shell: {r}"
    );
    let r = run_node(&page, "run(scripts.first);");
    assert_eq!(r["timers"], 1, "the first script polls for the page: {r}");
}
