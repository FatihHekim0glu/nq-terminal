//! The stale-page rebuild (03 section 7.1; 04 D4.2 item 12), a part of window.rs kept in its own file for size.
//!
//! When the backend reports the page build stale or missing, the window shows rebuild.html. In the release, and
//! only after the explicit click of the native confirm, the shell runs the two steps start.ps1 runs
//! (`pnpm install --frozen-lockfile`, then `pnpm build`, in `<lab>\terminal\web`, caches on D:); when node or pnpm
//! is missing it shows "rebuild needed" with the command. Smoke and measure refuse the rebuild with a log line.
//! The shell starts no process here: the caller hands in the runner (process creation belongs to supervise.rs).
use super::Tools;
#[path = "window_rebuild_announce.rs"]
mod announce;
use crate::ShellError;
use crate::dialogs::{self, Confirm};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Runtime, WebviewWindow};

/// The bundled pages' origin on Windows (frontendDist), and the rebuild page.
pub const ASSET_ORIGIN: &str = "http://tauri.localhost/";
pub const REBUILD_PAGE: &str = "rebuild.html";
/// The page sources in the lab, where the two steps run.
pub const LAB_WEB: &str = r"terminal\web";
/// Package caches for the rebuild when the shell's environment names none (03 section 7.1: caches on D:).
const REBUILD_CACHES: [(&str, &str); 2] = [
    ("npm_config_cache", r"D:\dev\npm-cache"),
    ("npm_config_store_dir", r"D:\dev\pnpm-store"),
];

/// The page build as the backend reports it (handshake `dist`, `/api/health`; 03 section 7.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DistState {
    Current,
    Stale,
    Missing,
}

impl DistState {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "current" => Some(Self::Current),
            "stale" => Some(Self::Stale),
            "missing" => Some(Self::Missing),
            _ => None,
        }
    }
}

/// One tool run of the rebuild: CreateProcessW's application name and exact command line, the working folder, and
/// variables added to the shell's own environment. The runner (process creation belongs to supervise.rs) starts it
/// with CREATE_NO_WINDOW inside a kill-on-close job and returns its exit code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolCall {
    pub application: PathBuf,
    pub command_line: String,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

pub type ToolRunner = dyn Fn(&ToolCall) -> Result<u32, String> + Send + Sync;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RebuildOutcome {
    Rebuilt,
    Cancelled,
    /// A test build: never rebuilt.
    Refused,
    /// node or pnpm is missing: the page shows the command.
    NeedsManual {
        command: String,
    },
    Failed {
        why: String,
    },
}

/// The section of rebuild.html on show (its `#` fragment).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RebuildPage {
    Confirm,
    Needed,
    Running,
    Failed,
    Done,
}

impl RebuildPage {
    const fn fragment(self) -> &'static str {
        match self {
            Self::Confirm => "confirm",
            Self::Needed => "needed",
            Self::Running => "running",
            Self::Failed => "failed",
            Self::Done => "done",
        }
    }
}

/// The two steps start.ps1 runs, as the owner would type them.
pub fn rebuild_command(lab: &Path) -> String {
    format!(
        "pnpm install --frozen-lockfile\npnpm build\n(in {})",
        lab.join(LAB_WEB).display()
    )
}

/// The two tool runs for a pnpm found on PATH; a .cmd shim runs through cmd.exe.
pub fn rebuild_calls(lab: &Path, pnpm: &Path) -> Vec<ToolCall> {
    let env: Vec<(String, String)> = REBUILD_CACHES
        .iter()
        .filter(|(name, _)| std::env::var_os(name).is_none() && Path::new(r"D:\").is_dir())
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect();
    let is_cmd = pnpm
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    let shell = std::env::var_os("SystemRoot").map_or_else(
        || PathBuf::from(r"C:\Windows\System32\cmd.exe"),
        |root| PathBuf::from(root).join("System32").join("cmd.exe"),
    );
    let step = |args: &str| {
        let (application, command_line) = if is_cmd {
            let line = format!(
                r#""{}" /d /s /c ""{}" {args}""#,
                shell.display(),
                pnpm.display()
            );
            (shell.clone(), line)
        } else {
            (
                pnpm.to_path_buf(),
                format!(r#""{}" {args}"#, pnpm.display()),
            )
        };
        let cwd = lab.join(LAB_WEB);
        let env = env.clone();
        ToolCall {
            application,
            command_line,
            cwd,
            env,
        }
    };
    vec![step("install --frozen-lockfile"), step("build")]
}

/// The stale-page rebuild (03 section 7.1; 04 D4.2 item 12). Refused in a test build; "rebuild needed" with the
/// command when node or pnpm is missing; otherwise the two steps run only after `ask` returns Proceed (the explicit
/// click of the native confirm). `show` moves rebuild.html to the section for each stage.
pub fn rebuild_flow(
    lab: &Path,
    allowed: bool,
    tools: &Tools,
    ask: impl FnOnce(&str) -> Confirm,
    run: &dyn Fn(&ToolCall) -> Result<u32, String>,
    show: &dyn Fn(RebuildPage),
) -> RebuildOutcome {
    let command = rebuild_command(lab);
    if !allowed {
        crate::crash::log("rebuild_refused", json!({ "reason": "test build" }));
        show(RebuildPage::Needed);
        return RebuildOutcome::Refused;
    }
    let (Some(_node), Some(pnpm)) = (&tools.node, &tools.pnpm) else {
        show(RebuildPage::Needed);
        return RebuildOutcome::NeedsManual { command };
    };
    show(RebuildPage::Confirm);
    if ask(&command) != Confirm::Proceed {
        show(RebuildPage::Needed);
        return RebuildOutcome::Cancelled;
    }
    show(RebuildPage::Running);
    for call in rebuild_calls(lab, pnpm) {
        let why = match run(&call) {
            Ok(0) => continue,
            Ok(code) => format!("{} exited with code {code}", call.command_line),
            Err(e) => e,
        };
        show(RebuildPage::Failed);
        return RebuildOutcome::Failed { why };
    }
    show(RebuildPage::Done);
    RebuildOutcome::Rebuilt
}

fn show_rebuild_page<R: Runtime>(window: &WebviewWindow<R>, page: RebuildPage) {
    let url = format!("{ASSET_ORIGIN}{REBUILD_PAGE}#{}", page.fragment());
    let shown = url
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())
        .and_then(|u| window.navigate(u).map_err(|e| e.to_string()));
    // A fragment-only navigation fires no load and moves no focus: announce the stage to screen readers (WCAG 4.1.3).
    let announced = shown.and_then(|()| {
        window
            .eval(announce::announce_script(page.fragment()))
            .map_err(|e| e.to_string())
    });
    if let Err(e) = announced {
        crate::crash::log("rebuild_page_failed", json!({ "error": e }));
    }
}

/// Entry point for the supervisor's stale-page hook (stale_page.rs) when the backend reports a stale or missing page
/// build: shows rebuild.html and runs `rebuild_flow` on a worker thread, then hands the outcome to `done`.
/// `allowed` is `Launch::rebuild_allowed`: false in every test build.
pub fn on_stale_dist<R: Runtime>(
    window: &WebviewWindow<R>,
    allowed: bool,
    lab: &Path,
    run: Arc<ToolRunner>,
    done: impl FnOnce(RebuildOutcome) + Send + 'static,
) -> Result<(), ShellError> {
    let (window, lab) = (window.clone(), lab.to_path_buf());
    std::thread::Builder::new()
        .name("rebuild".into())
        .spawn(move || {
            let show = |page| show_rebuild_page(&window, page);
            let tools = Tools::from_env();
            let outcome = rebuild_flow(
                &lab,
                allowed,
                &tools,
                |command: &str| dialogs::confirm_rebuild(Some(&window), command),
                &*run,
                &show,
            );
            crate::crash::log(
                "rebuild_outcome",
                json!({ "outcome": format!("{outcome:?}") }),
            );
            done(outcome);
        })
        .map_err(|e| ShellError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "unit tests build a fake lab and mark what the fake runner did; not shipped code"
)]
mod tests {
    use super::*;
    use crate::Launch;
    use std::cell::RefCell;
    use std::sync::Mutex;

    /// A fake lab under D:\dev\tmp\w4b-window-keys, never the real lab: a page source folder and no build.
    fn fake_lab(name: &str) -> PathBuf {
        let lab = PathBuf::from(r"D:\dev\tmp\w4b-window-keys")
            .join(format!("rebuild-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&lab);
        std::fs::create_dir_all(lab.join(LAB_WEB)).expect("fake web folder");
        lab
    }

    fn tools() -> Tools {
        Tools {
            node: Some(PathBuf::from(r"D:\fake\node.exe")),
            pnpm: Some(PathBuf::from(r"D:\fake\bin\pnpm.cmd")),
        }
    }

    /// A runner that records each call and, for `build`, writes the page into the fake lab's own web folder.
    fn recorder(
        calls: &Mutex<Vec<ToolCall>>,
    ) -> impl Fn(&ToolCall) -> Result<u32, String> + Send + Sync {
        move |call: &ToolCall| {
            calls.lock().expect("calls").push(call.clone());
            if call.command_line.ends_with("build\"") {
                let dist = call.cwd.join("dist");
                std::fs::create_dir_all(&dist).map_err(|e| e.to_string())?;
                std::fs::write(dist.join("index.html"), b"<!doctype html>")
                    .map_err(|e| e.to_string())?;
            }
            Ok(0)
        }
    }

    fn record(seen: &RefCell<Vec<RebuildPage>>, page: RebuildPage) {
        seen.borrow_mut().push(page);
    }

    #[test]
    fn nothing_runs_without_the_click() {
        let lab = fake_lab("cancel");
        let calls = Mutex::new(Vec::new());
        let (seen, push) = (RefCell::new(Vec::new()), record);
        let outcome = rebuild_flow(
            &lab,
            true,
            &tools(),
            |_| Confirm::Cancel,
            &recorder(&calls),
            &|p| push(&seen, p),
        );
        assert_eq!(outcome, RebuildOutcome::Cancelled);
        assert!(calls.lock().expect("calls").is_empty());
        assert!(!lab.join(LAB_WEB).join("dist").exists());
        assert_eq!(*seen.borrow(), [RebuildPage::Confirm, RebuildPage::Needed]);
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn the_rebuild_runs_on_the_fake_lab_after_the_click() {
        let lab = fake_lab("click");
        let calls = Mutex::new(Vec::new());
        let (seen, push) = (RefCell::new(Vec::new()), record);
        let asked = RefCell::new(String::new());
        let ask = |command: &str| {
            asked.replace(command.to_string());
            Confirm::Proceed
        };
        let outcome = rebuild_flow(&lab, true, &tools(), ask, &recorder(&calls), &|p| {
            push(&seen, p)
        });
        assert_eq!(outcome, RebuildOutcome::Rebuilt);
        assert!(asked.borrow().contains("pnpm install --frozen-lockfile"));
        let calls = calls.into_inner().expect("calls");
        assert_eq!(
            calls,
            rebuild_calls(&lab, Path::new(r"D:\fake\bin\pnpm.cmd"))
        );
        assert!(calls.iter().all(|c| c.cwd == lab.join(LAB_WEB)));
        assert!(lab.join(LAB_WEB).join("dist").join("index.html").is_file());
        let order = [
            RebuildPage::Confirm,
            RebuildPage::Running,
            RebuildPage::Done,
        ];
        assert_eq!(*seen.borrow(), order);
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn a_test_build_refuses_without_asking() {
        let lab = fake_lab("refused");
        let calls = Mutex::new(Vec::new());
        let (seen, push) = (RefCell::new(Vec::new()), record);
        let launch = Launch {
            scrubbed: Vec::new(),
            #[cfg(feature = "smoke")]
            smoke: crate::smoke_options::SmokeOptions::for_tests(),
        };
        let ask = |_: &str| -> Confirm { panic!("a refused rebuild must not ask") };
        let outcome = rebuild_flow(&lab, false, &tools(), ask, &recorder(&calls), &|p| {
            push(&seen, p)
        });
        assert_eq!(outcome, RebuildOutcome::Refused);
        assert!(calls.lock().expect("calls").is_empty());
        assert_eq!(*seen.borrow(), [RebuildPage::Needed]);
        assert_eq!(launch.rebuild_allowed(), !crate::TEST_BUILD);
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn missing_tools_show_the_command() {
        let lab = fake_lab("manual");
        let calls = Mutex::new(Vec::new());
        let (seen, push) = (RefCell::new(Vec::new()), record);
        let ask = |_: &str| -> Confirm { panic!("no tools, no question") };
        let outcome = rebuild_flow(
            &lab,
            true,
            &Tools::default(),
            ask,
            &recorder(&calls),
            &|p| push(&seen, p),
        );
        assert_eq!(
            outcome,
            RebuildOutcome::NeedsManual {
                command: rebuild_command(&lab)
            }
        );
        assert!(calls.lock().expect("calls").is_empty());
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn a_failed_step_stops_the_rebuild() {
        let lab = fake_lab("fail");
        let (seen, push) = (RefCell::new(Vec::new()), record);
        let fail = |_: &ToolCall| -> Result<u32, String> { Ok(1) };
        let outcome = rebuild_flow(&lab, true, &tools(), |_| Confirm::Proceed, &fail, &|p| {
            push(&seen, p)
        });
        assert!(
            matches!(outcome, RebuildOutcome::Failed { .. }),
            "{outcome:?}"
        );
        assert_eq!(seen.borrow().last(), Some(&RebuildPage::Failed));
        let _ = std::fs::remove_dir_all(&lab);
    }

    #[test]
    fn a_cmd_shim_runs_through_cmd_and_an_exe_directly() {
        let lab = PathBuf::from(r"D:\lab");
        let cmd = rebuild_calls(&lab, Path::new(r"D:\tools\pnpm.cmd"));
        assert!(cmd[0].application.ends_with("cmd.exe"), "{:?}", cmd[0]);
        assert!(
            cmd[0]
                .command_line
                .ends_with(r#" /d /s /c ""D:\tools\pnpm.cmd" install --frozen-lockfile""#)
        );
        let exe = rebuild_calls(&lab, Path::new(r"D:\tools\pnpm.exe"));
        assert_eq!(exe[1].application, PathBuf::from(r"D:\tools\pnpm.exe"));
        assert_eq!(exe[1].command_line, r#""D:\tools\pnpm.exe" build"#);
        assert_eq!(exe[1].cwd, lab.join(LAB_WEB));
        assert_eq!(DistState::parse("stale"), Some(DistState::Stale));
        assert_eq!(DistState::parse("fresh"), None);
    }
}
