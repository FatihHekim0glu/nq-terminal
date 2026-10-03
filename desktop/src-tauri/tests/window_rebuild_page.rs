//! rebuild.html (04 D4.2 item 12; 03 section 7.1): each stage of the rebuild shows exactly one section, chosen by the
//! URL fragment the shell navigates to, with no script (the bundled pages run under `script-src 'self'`).
//!
//! The page and look.css are copied from assets/ into the run folder and served on 127.0.0.1:8810; the hidden smoke
//! exe loads them with `--attach-url`, and a debugging-protocol script moves through the fragments. Born failing:
//! before this slice there was no rebuild.html, so the page has no sections and the test fails.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it copies the page into its run folder and starts processes it owns"
)]

#[path = "../src/window_rebuild_announce.rs"]
mod announce;
#[path = "window_harness.rs"]
mod harness;

use harness::*;
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

/// Each stage as the shell shows it: the fragment, then the shell's own announce script. `title` and `focus` are
/// what a screen reader hears (WCAG 4.1.3): the document title and the focused heading.
fn steps_body() -> String {
    let scripts: serde_json::Value = ["confirm", "running", "done", "needed", "failed"]
        .iter()
        .map(|f| ((*f).to_string(), json!(announce::announce_script(f))))
        .collect::<serde_json::Map<_, _>>()
        .into();
    format!(
        r#"const scripts = {scripts};
const out = {{}};
for (const step of ['', 'confirm', 'running', 'done', 'needed', 'failed']) {{
  await evaluate(`location.hash = '${{step}}'`);
  if (scripts[step]) await evaluate(scripts[step]);
  await sleep(250);
  out[step || 'none'] = await evaluate(`[...document.querySelectorAll('h1')].filter((h) => h.offsetParent !== null).map((h) => h.id)`);
  out['title_' + step] = await evaluate('document.title');
  out['focus_' + step] = await evaluate('document.activeElement && document.activeElement.id');
}}
out.scripts = await evaluate('document.scripts.length');
out.lang = await evaluate('document.documentElement.lang');
console.log(JSON.stringify(out));
"#
    )
}

#[test]
fn each_rebuild_stage_shows_one_section() {
    let _one = one_run();
    let run = run_dir("rebuild-page");
    let page = run.join("page");
    std::fs::create_dir_all(&page).expect("page folder");
    let assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    for file in ["rebuild.html", "look.css"] {
        std::fs::copy(assets.join(file), page.join(file)).expect("copy the page");
    }
    let _server = serve_folder(&run, &page);
    let url = format!("http://127.0.0.1:{PAGE_PORT}/rebuild.html");
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend(["--attach-url".into(), url.clone().into()]);
    let mut shell = launch(&run, &args, &[]);
    let port = devtools_port(&run, &mut shell);
    let result = cdp(port, &url, &steps_body());
    let closed = close_shell(&mut shell);
    drop(shell);
    std::thread::sleep(Duration::from_millis(500));
    let report = watch.finish();
    for (step, title) in [
        ("none", "confirm-title"),
        ("confirm", "confirm-title"),
        ("running", "running-title"),
        ("done", "done-title"),
        ("needed", "needed-title"),
        ("failed", "failed-title"),
    ] {
        assert_eq!(result[step], json!([title]), "step {step}: {result}");
    }
    for (step, title, heading) in [
        (
            "confirm",
            "The terminal page needs a rebuild",
            "confirm-title",
        ),
        ("running", "Rebuilding the page", "running-title"),
        ("done", "Page rebuilt", "done-title"),
        ("needed", "Rebuild needed", "needed-title"),
        ("failed", "The rebuild failed", "failed-title"),
    ] {
        let expect = format!("nq-lab terminal: {title}");
        assert_eq!(result[format!("title_{step}")], json!(expect), "{result}");
        assert_eq!(result[format!("focus_{step}")], json!(heading), "{result}");
    }
    assert_eq!(
        result["scripts"],
        json!(0),
        "the page must need no script: {result}"
    );
    assert_eq!(result["lang"], json!("en-GB"));
    assert!(closed, "the shell did not close on WM_CLOSE");
    assert_clean(&report);
}
