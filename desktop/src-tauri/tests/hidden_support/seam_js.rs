//! The page-side scripts of the INT1 seam run (the driver, the page probes and the debounce hold), kept apart so
//! `int1_seams.rs` stays under the 800-line ceiling. Included with `#[path]`; nothing here starts a process but the
//! node check of the hold.

use serde_json::{Value, json};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use super::launch_support;

/// The page driver: runs the steps in `NQT_STEPS` (a JSON array) in the page named by its URL prefix, over the
/// debugging protocol, and prints the results as a JSON array. `eval` awaits its promise, `insert` types text into
/// the focused element, `key` sends a key down and up, `wait` sleeps.
pub const DRIVER_JS: &str = r#"const [port, prefix] = process.argv.slice(1);
const steps = JSON.parse(process.env.NQT_STEPS);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith(prefix));
if (!page) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(0) }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let n = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } };
const call = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })) });
const out = [];
for (const s of steps) {
  if (s.eval !== undefined) {
    const r = await call('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true });
    out.push(r.result.exceptionDetails ? { exception: r.result.exceptionDetails.text } : r.result.result.value ?? null);
  } else if (s.insert !== undefined) { await call('Input.insertText', { text: s.insert }); out.push(true) }
  else if (s.key !== undefined) {
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: s.key, code: s.key, windowsVirtualKeyCode: s.vk, text: type === 'keyDown' && s.key === 'Enter' ? '\r' : undefined });
    out.push(true);
  } else if (s.wait !== undefined) { await new Promise((r) => setTimeout(r, s.wait)); out.push(true) }
}
console.log(JSON.stringify(out)); ws.close();
"#;

pub const FOCUS_COMMAND_LINE: &str = "(() => { const el = document.querySelector('[role=\"combobox\"][aria-label=\"Command line\"]'); if (!el) return false; el.focus(); return document.activeElement === el })()";
pub const STORE_STATUS: &str = "fetch('/api/workspaces/prefs').then((r) => r.status)";
pub const SYNC_ANSWER: &str = "(() => { const f = window.__NQT_STORE_SYNC__; return typeof f === 'function' ? f() : 'no hook' })()";
/// The four HOME panels are on the page and nothing on it is loading: HOME as a restored workspace shows it (the strict
/// probe of the first launch also names the content of the fresh state's panels, which a restored layout may change).
pub const PANELS_QUIET: &str = "document.querySelectorAll('[data-nqt-title]').length === 4 && document.querySelector('p.ws-empty') === null && document.querySelector('[aria-busy=\"true\"]:not(td):not([role=\"gridcell\"])') === null";
pub const MESSAGE_LINE: &str = "(() => { const el = document.querySelector('.msg-line[role=\"status\"]'); return el ? el.textContent : null })()";
pub const SHELL_OBJECT: &str = "JSON.stringify(window.__NQT_SHELL__)";
pub const HEALTH_PORT_FIXED: &str =
    "fetch('/api/health').then((r) => r.json()).then((b) => b.port_fixed)";
pub const WORKSPACES_CACHE: &str = "localStorage.getItem('nqt.workspaces')";
/// Holds the store's 500 ms debounce (`DEBOUNCE_MS` in remoteStore.ts): a timer of exactly 500 ms is counted and never
/// fires, every other timer runs as before. With it installed the page cannot send a change by itself, so the shell's
/// flush hook is the only way the change reaches the store, however slow the machine or the driver is.
pub const HOLD_DEBOUNCE: &str = "(() => { const real = window.setTimeout.bind(window); window.__nqtReal = real; const held = { n: 0, base: 0 }; window.__nqtHeld = held; window.setTimeout = (fn, ms, ...rest) => { if (ms === 500) { held.n += 1; return -1 } return real(fn, ms, ...rest) }; return true })()";
/// Marks how many timers were held so far, so only the debounce the typed command schedules is counted afterwards.
pub const HELD_MARK: &str = "(() => { window.__nqtHeld.base = window.__nqtHeld.n; return true })()";
/// True once the change has been noted (a debounce timer was held after the mark): the driver returns only then, so the
/// close can follow at once with no fixed wait. False if it never happened within 5 s.
pub const HELD_NOTED: &str = "(async () => { const real = window.__nqtReal; for (let i = 0; i < 100; i += 1) { if (window.__nqtHeld.n > window.__nqtHeld.base) return true; await new Promise((r) => real(r, 50)) } return false })()";

/// Runs the debounce hold in node against a stand-in window and reports what fired.
pub fn run_hold_in_node() -> Value {
    let probe = r#"globalThis.window = globalThis;
const fired = [];
eval(process.env.NQT_HOLD);
eval(process.env.NQT_MARK);
window.setTimeout(() => fired.push(500), 500);
window.setTimeout(() => fired.push(20), 20);
await new Promise((r) => window.__nqtReal(r, 700));
console.log(JSON.stringify({ fired, held: window.__nqtHeld.n, base: window.__nqtHeld.base }));"#;
    let out = Command::new("node")
        .args(["--input-type=module", "-e", probe])
        .env("NQT_HOLD", HOLD_DEBOUNCE)
        .env("NQT_MARK", HELD_MARK)
        .stdin(Stdio::null())
        .creation_flags(launch_support::CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run node for the hold check: {e}"));
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "the hold check printed no JSON ({e}): {}",
            String::from_utf8_lossy(&out.stderr)
        )
    })
}

#[test]
pub fn debounce_hold_never_fires_the_500_ms_timer_and_lets_other_timers_run() {
    let seen = run_hold_in_node();
    assert_eq!(seen["fired"], json!([20]), "{seen}");
    assert_eq!(seen["held"], 1, "{seen}");
}
