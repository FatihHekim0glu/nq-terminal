//! Supervision (03 sections 2.2 to 2.4, 8, 17; 04 D4.3): spawn or attach, the handshake checks, the session
//! cookie, navigation, the kill-on-close Job Object, restarts, the stopped page and the child-exit watch.
//!
//! STAGE A: stubs with their final signatures. The one behaviour filled now is the smoke build's `--attach-url`,
//! which loads a page server that is already running with no backend and no handshake (03 section 7.1). Stage B
//! (slice w4b-supervise-link) fills the spawn path (CreateProcessW with PROC_THREAD_ATTRIBUTE_JOB_LIST, the
//! challenge-response proof through link.rs, the pid-in-job and listener-ownership checks) without changing a
//! signature.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use crate::{Launch, ShellError};
use serde_json::json;
use tauri::WebviewWindow;

/// Restart back-off in seconds, and the crash window that stops retries (03 section 17).
pub const RESTART_BACKOFF_S: [u64; 3] = [1, 2, 4];
pub const CRASHES_BEFORE_STOP: usize = 3;
pub const CRASH_WINDOW_S: u64 = 60;
/// How long a closed stdin gets before the Job Object ends the tree (03 section 2.3).
pub const STOP_GRACE_S: u64 = 5;

/// How this window reaches its page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Nothing started (the stub, or a start that stopped).
    Idle,
    /// A backend this shell spawned; it ends with the shell.
    Spawned { port: u16 },
    /// A live backend found through its lock; never stopped by this shell.
    Attached { port: u16 },
    /// Smoke only: a page server named by `--attach-url`, with no backend and no handshake.
    PageServer { url: String },
}

/// The supervisor's handle, kept as app state for the life of the window.
#[derive(Debug)]
pub struct Supervisor {
    mode: Mode,
}

impl Supervisor {
    pub fn mode(&self) -> &Mode {
        &self.mode
    }

    /// Window closing: confirm a running job (O11), close the backend's stdin, then let the Job Object end the
    /// tree after the grace period. Attach mode only closes the window. STUB.
    pub fn shutdown(&self) -> Result<(), ShellError> {
        Ok(())
    }
}

/// Starts or attaches to the backend and sends the window to its page. STUB except the smoke `--attach-url`, and
/// the smoke `--fixture`, which is refused until stage B spawns the fixture backend (tests/setup_refused.rs relies
/// on that refusal, and on stage B refusing a lab with no backend).
pub fn start(window: &WebviewWindow, launch: &Launch) -> Result<Supervisor, ShellError> {
    #[cfg(feature = "smoke")]
    if launch.smoke.fixture {
        return Err(ShellError::NotReady(
            "--fixture: the fixture backend is spawned from stage B",
        ));
    }
    #[cfg(feature = "smoke")]
    if let Some(url) = &launch.smoke.attach_url {
        let parsed: tauri::Url = url
            .parse()
            .map_err(|e| ShellError::Refused(format!("--attach-url: {e}")))?;
        window.navigate(parsed)?;
        crate::crash::log("supervise_attach_url", json!({ "url": url }));
        return Ok(Supervisor {
            mode: Mode::PageServer { url: url.clone() },
        });
    }
    let _ = (window, launch);
    crate::crash::log(
        "supervise_stub",
        json!({ "note": "spawn and attach arrive in stage B; the splash stays" }),
    );
    Ok(Supervisor { mode: Mode::Idle })
}
