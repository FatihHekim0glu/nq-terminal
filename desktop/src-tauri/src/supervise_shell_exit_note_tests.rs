//! Unit tests of the exit-note script that supervise_shell.rs evaluates in the stopped page.

use super::*;

/// V032 review: on a second exit (a fragment-only navigation) the reason line still held the earlier exit's code
/// when the announcement focused it, so a screen reader read out a stale code. The code line is now written first:
/// the very scripts the window evaluates, run in their order by node against a stopped page whose line still holds
/// an earlier code, leave the reason line with this exit's code at the moment of the focus.
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a unit test runs node on the shell's own scripts"
)]
fn the_announcement_reads_this_exits_code_never_an_earlier_one() {
    let evals = stopped_evals("exited", Some(&check::exit_note_script(Some(5))));
    let harness = format!(
        r#"
const evals = {evals};
const reason = {{ nodeType: 3, textContent: 'The backend stopped.' }};
const code = {{ nodeType: 1, textContent: ' The backend ended with exit code 3.' }};
reason.nextSibling = code; code.nextSibling = null;
const body = {{ id: 'body' }};
let heard = null;
const line = {{ firstChild: reason, setAttribute() {{}}, focus() {{ heard = reason.textContent + code.textContent; doc.activeElement = line; }} }};
const doc = {{ title: 'nq-lab terminal: stopped', readyState: 'complete', body, activeElement: body,
  getElementById: (id) => (id === 'exited-text' ? line : id === 'exit-code' ? code : null) }};
const location = {{ pathname: '/stopped.html', hash: '#exited' }};
for (const script of evals) new Function('document', 'location', 'setTimeout', script)(doc, location, () => {{}});
console.log(JSON.stringify({{ heard, title: doc.title }}));
"#,
        evals = serde_json::to_string(&evals).expect("scripts")
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
    assert_eq!(
        got,
        json!({
            "heard": "The backend stopped. The backend ended with exit code 5.",
            "title": "nq-lab terminal: The backend stopped."
        })
    );
}

#[test]
fn a_reason_without_an_exit_code_evaluates_only_its_announcement() {
    assert_eq!(
        stopped_evals("lock-held", None),
        [announce::announce_script("lock-held")]
    );
}

#[test]
fn the_repeats_cover_a_full_page_load() {
    const { assert!(EXIT_NOTE_REPEATS >= 1) };
    assert!(
        EXIT_NOTE_PAUSE * EXIT_NOTE_REPEATS >= Duration::from_secs(2),
        "the repeats must outlast the stopped page's load"
    );
}

#[test]
fn with_no_newer_exit_the_note_is_evaluated_again_every_time() {
    let counter = AtomicU64::new(0);
    let generation = next_exit_generation(&counter);
    let mut evals = 0;
    let ran = repeat_exit_note(
        generation,
        &counter,
        EXIT_NOTE_REPEATS,
        Duration::ZERO,
        || evals += 1,
    );
    assert_eq!((ran, evals), (EXIT_NOTE_REPEATS, EXIT_NOTE_REPEATS));
}

#[test]
fn a_newer_exit_ends_the_older_loop_before_its_next_eval() {
    let counter = AtomicU64::new(0);
    let older = next_exit_generation(&counter);
    let mut evals = 0;
    let ran = repeat_exit_note(older, &counter, EXIT_NOTE_REPEATS, Duration::ZERO, || {
        evals += 1;
        // A second exit arrives while the first loop runs.
        let newer = next_exit_generation(&counter);
        assert!(newer > older);
    });
    assert_eq!(
        (ran, evals),
        (1, 1),
        "the older code must never be written again"
    );
}

#[test]
fn an_older_loop_that_starts_late_writes_nothing() {
    let counter = AtomicU64::new(0);
    let older = next_exit_generation(&counter);
    let _newer = next_exit_generation(&counter);
    let mut evals = 0;
    let ran = repeat_exit_note(older, &counter, EXIT_NOTE_REPEATS, Duration::ZERO, || {
        evals += 1
    });
    assert_eq!((ran, evals), (0, 0));
}
