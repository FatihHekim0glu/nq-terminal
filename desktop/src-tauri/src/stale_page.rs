//! The supervisor's answer to a stale or missing page build (03 section 7.1; 04 D4.2 item 12 and D4.3): the backend's
//! handshake says `dist` is not current, the supervisor ends that backend, and this hook shows rebuild.html, runs the
//! rebuild only after the owner's click (window_rebuild.rs) and tells the supervisor whether to start the backend
//! again. The tools run through `supervise::run_tool`, the shell's one process path, with their output in
//! `<config>/logs/rebuild.log`.

use crate::crash;
use crate::supervise::{StaleHook, run_tool};
use crate::window::rebuild::{self, DistState, RebuildOutcome, ToolCall, ToolRunner};
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, mpsc};
use tauri::{Runtime, WebviewWindow};

/// The hook for one window and one lab. `allowed` is `Launch::rebuild_allowed` (false in every test build, where
/// the flow only shows "rebuild needed" and the supervisor does not start the backend again).
pub fn hook<R: Runtime>(
    window: &WebviewWindow<R>,
    allowed: bool,
    lab: PathBuf,
    log: PathBuf,
) -> StaleHook {
    let window = window.clone();
    Arc::new(move |state: &str| {
        crash::log("stale_dist", json!({ "state": state }));
        if !matches!(
            DistState::parse(state),
            Some(DistState::Stale | DistState::Missing)
        ) {
            return false;
        }
        let log = log.clone();
        let runner: Arc<ToolRunner> = Arc::new(move |call: &ToolCall| {
            run_tool(
                &call.application,
                &call.command_line,
                &call.cwd,
                &call.env,
                &log,
                call.timeout,
            )
        });
        let (done, outcome) = mpsc::channel();
        let started = rebuild::on_stale_dist(&window, allowed, &lab, runner, move |o| {
            let _ = done.send(o);
        });
        started.is_ok() && matches!(outcome.recv(), Ok(RebuildOutcome::Rebuilt))
    })
}
