//! stopped.html (03 section 7.1; WCAG 4.1.3): the stopped page changes its reason by URL fragment when a restart
//! attempt fails with a different code, and that is a same-document navigation: no load, no focus move, no title
//! change. The shell therefore runs the same announce script the rebuild page uses after every navigation to it.
//!
//! The page and its two style sheets are copied into the run folder and served on 127.0.0.1:8810; the hidden smoke
//! exe loads them with `--attach-url`, and a debugging-protocol script goes from #exited to #hmac to #lock-held,
//! running the shell's own script after each step. Born failing: the script only knew the rebuild headings
//! (`<id>-title`), so on this page the title stayed the same and focus stayed on the body.
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

/// The reasons the restart loop moves between, with the text a screen reader must hear for each.
const STEPS: [(&str, &str); 3] = [
    ("exited", "The backend stopped."),
    (
        "hmac",
        "The backend did not prove that it holds this app's secret.",
    ),
    (
        "lock-held",
        "Another backend already holds this lab's lock.",
    ),
];

fn steps_body() -> String {
    let scripts: serde_json::Value = STEPS
        .iter()
        .map(|(f, _)| ((*f).to_string(), json!(announce::announce_script(f))))
        .collect::<serde_json::Map<_, _>>()
        .into();
    format!(
        r#"const scripts = {scripts};
const out = {{ first_title: await evaluate('document.title') }};
for (const step of ['exited', 'hmac', 'lock-held']) {{
  await evaluate(`location.hash = '${{step}}'`);
  await evaluate(scripts[step]);
  await sleep(250);
  out['title_' + step] = await evaluate('document.title');
  out['focus_' + step] = await evaluate('document.activeElement && document.activeElement.id');
  out['shown_' + step] = await evaluate(`[...document.querySelectorAll('.reason')].filter((s) => s.offsetParent !== null).map((s) => s.id)`);
}}
out.scripts = await evaluate('document.scripts.length');
console.log(JSON.stringify(out));
"#
    )
}

#[test]
fn each_stopped_reason_is_announced_by_title_and_focus() {
    let _one = one_run();
    let run = run_dir("stopped-page");
    let page = run.join("page");
    std::fs::create_dir_all(&page).expect("page folder");
    let assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    for file in ["stopped.html", "stopped.css", "look.css"] {
        std::fs::copy(assets.join(file), page.join(file)).expect("copy the page");
    }
    let _server = serve_folder(&run, &page);
    let url = format!("http://127.0.0.1:{PAGE_PORT}/stopped.html");
    let watch = start_watch();
    let mut args = base_args(&run);
    args.extend(["--attach-url".into(), format!("{url}#exited").into()]);
    let mut shell = launch(&run, &args, &[]);
    let port = devtools_port(&run, &mut shell);
    let result = cdp(port, &url, &steps_body());
    let closed = close_shell(&mut shell);
    drop(shell);
    std::thread::sleep(Duration::from_millis(500));
    let report = watch.finish();
    for (step, text) in STEPS {
        let expect = format!("nq-lab terminal: {text}");
        assert_eq!(result[format!("title_{step}")], json!(expect), "{result}");
        let focus = format!("{step}-text");
        assert_eq!(result[format!("focus_{step}")], json!(focus), "{result}");
        assert_eq!(result[format!("shown_{step}")], json!([step]), "{result}");
    }
    assert_eq!(result["scripts"], json!(0), "the page needs no script");
    assert!(closed, "the shell did not close on WM_CLOSE");
    assert_clean(&report);
}
