//! The stale-page rebuild (03 section 7.1; 04 D4.2 item 12), a part of window.rs kept in its own file for size.
//!
//! When the backend reports the page build stale or missing, the window shows rebuild.html. In the release, and
//! only after the explicit click of the native confirm, the shell runs the two steps start.ps1 runs
//! (`pnpm install --frozen-lockfile`, then `pnpm build`, in `<lab>\terminal\web`, caches on D:, or under the folder
//! `NQT_REBUILD_CACHE_ROOT` names); each step is stopped after 15 minutes (`NQT_REBUILD_TOOL_TIMEOUT_S` sets the limit)
//! so a hung network cannot keep the page busy for ever. When node or pnpm is missing it shows "rebuild needed" with the
//! command. Smoke and measure refuse the rebuild with a log line.
//! The shell starts no process here: the caller hands in the runner (process creation belongs to supervise.rs).
use super::Tools;
#[path = "window_rebuild_announce.rs"]
mod announce;
use crate::ShellError;
use crate::dialogs::{self, Confirm};
use serde_json::json;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Runtime, WebviewWindow};

/// The bundled pages' origin on Windows (frontendDist), and the rebuild page.
pub const ASSET_ORIGIN: &str = "http://tauri.localhost/";
pub const REBUILD_PAGE: &str = "rebuild.html";
/// The page sources in the lab, where the two steps run.
pub const LAB_WEB: &str = r"terminal\web";
/// Package caches for the rebuild when the shell's environment names none (03 section 7.1: caches on D:): each variable
/// and the folder under the cache root that it points at.
const CACHE_FOLDERS: [(&str, &str); 2] = [
    ("npm_config_cache", "npm-cache"),
    ("npm_config_store_dir", "pnpm-store"),
];
/// Where the caches live when `CACHE_ROOT_VAR` is not set and D: exists.
const DEFAULT_CACHE_ROOT: &str = r"D:\dev";
/// Names the (absolute) folder that holds both caches, for a PC without a D: drive or with another layout (AUD-6).
pub const CACHE_ROOT_VAR: &str = "NQT_REBUILD_CACHE_ROOT";
/// How long one step of the rebuild may run before it is stopped (AUD-6): `pnpm install` on a hung network would
/// otherwise keep the rebuild page busy for ever.
pub const TOOL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Sets that limit in seconds; a value outside `TOOL_TIMEOUT_MIN_S..=TOOL_TIMEOUT_MAX_S` or not a number is ignored.
pub const TOOL_TIMEOUT_VAR: &str = "NQT_REBUILD_TOOL_TIMEOUT_S";
const TOOL_TIMEOUT_MIN_S: u64 = 10;
const TOOL_TIMEOUT_MAX_S: u64 = 2 * 60 * 60;

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
    /// The step is stopped, and the rebuild fails, when it runs longer than this.
    pub timeout: Duration,
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

/// The step limit for a setting (the value of `TOOL_TIMEOUT_VAR`, if any): the default unless it is a whole number of
/// seconds inside the allowed range.
pub fn tool_timeout(setting: Option<&str>) -> Duration {
    setting
        .and_then(|text| text.trim().parse::<u64>().ok())
        .filter(|secs| (TOOL_TIMEOUT_MIN_S..=TOOL_TIMEOUT_MAX_S).contains(secs))
        .map_or(TOOL_TIMEOUT, Duration::from_secs)
}

/// The cache variables the rebuild adds to the shell's environment. `root` is the value of `CACHE_ROOT_VAR` (used only
/// when it is an absolute path), else D:\dev when `d_drive` says D: exists, else nothing. A variable the shell's
/// environment already names (`named`) is never overridden.
pub fn cache_env(
    root: Option<&OsStr>,
    named: &dyn Fn(&str) -> bool,
    d_drive: bool,
) -> Vec<(String, String)> {
    let configured = root.map(Path::new).filter(|path| path.is_absolute());
    let base = match configured {
        Some(path) => path.to_path_buf(),
        None if d_drive => PathBuf::from(DEFAULT_CACHE_ROOT),
        None => return Vec::new(),
    };
    CACHE_FOLDERS
        .iter()
        .filter(|(name, _)| !named(name))
        .map(|(name, folder)| ((*name).to_string(), base.join(folder).display().to_string()))
        .collect()
}

/// The two tool runs for a pnpm found on PATH; a .cmd shim runs through cmd.exe.
pub fn rebuild_calls(lab: &Path, pnpm: &Path) -> Vec<ToolCall> {
    let env = cache_env(
        std::env::var_os(CACHE_ROOT_VAR).as_deref(),
        &|name| std::env::var_os(name).is_some(),
        Path::new(r"D:\").is_dir(),
    );
    let timeout = tool_timeout(std::env::var(TOOL_TIMEOUT_VAR).ok().as_deref());
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
            timeout,
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

    fn pair(name: &str, value: &str) -> (String, String) {
        (name.to_string(), value.to_string())
    }

    #[test]
    fn the_cache_root_setting_moves_both_caches() {
        let env = cache_env(Some(OsStr::new(r"E:\caches")), &|_| false, true);
        assert_eq!(
            env,
            [
                pair("npm_config_cache", r"E:\caches\npm-cache"),
                pair("npm_config_store_dir", r"E:\caches\pnpm-store"),
            ]
        );
        let without_d = cache_env(Some(OsStr::new(r"E:\caches")), &|_| false, false);
        assert_eq!(without_d, env, "the setting works on a PC with no D: drive");
    }

    #[test]
    fn without_a_setting_the_caches_stay_on_d_when_it_exists() {
        let env = cache_env(None, &|_| false, true);
        assert_eq!(
            env,
            [
                pair("npm_config_cache", r"D:\dev\npm-cache"),
                pair("npm_config_store_dir", r"D:\dev\pnpm-store"),
            ]
        );
        assert!(cache_env(None, &|_| false, false).is_empty());
    }

    #[test]
    fn an_empty_or_relative_cache_root_is_ignored() {
        for bad in ["", "caches", r"\caches", r"..\caches"] {
            let env = cache_env(Some(OsStr::new(bad)), &|_| false, true);
            assert_eq!(env, cache_env(None, &|_| false, true), "{bad:?}");
            assert!(cache_env(Some(OsStr::new(bad)), &|_| false, false).is_empty());
        }
    }

    #[test]
    fn a_cache_variable_the_shell_already_has_is_not_overridden() {
        let has = |name: &str| name == "npm_config_cache";
        let env = cache_env(Some(OsStr::new(r"E:\caches")), &has, true);
        assert_eq!(env, [pair("npm_config_store_dir", r"E:\caches\pnpm-store")]);
    }

    #[test]
    fn the_step_limit_is_bounded_and_a_bad_setting_keeps_the_default() {
        assert_eq!(tool_timeout(None), TOOL_TIMEOUT);
        assert_eq!(tool_timeout(Some("120")), Duration::from_secs(120));
        assert_eq!(tool_timeout(Some(" 600 ")), Duration::from_secs(600));
        for bad in [
            "",
            "abc",
            "-5",
            "1.5",
            "0",
            "9",
            "7201",
            "99999999999999999999",
        ] {
            assert_eq!(tool_timeout(Some(bad)), TOOL_TIMEOUT, "{bad:?}");
        }
        assert!(
            TOOL_TIMEOUT >= Duration::from_secs(60),
            "pnpm install needs minutes, not seconds"
        );
    }

    #[test]
    fn every_rebuild_step_carries_the_limit() {
        let setting = std::env::var(TOOL_TIMEOUT_VAR).ok();
        let calls = rebuild_calls(Path::new(r"D:\lab"), Path::new(r"D:\tools\pnpm.exe"));
        assert_eq!(calls.len(), 2);
        for call in &calls {
            assert_eq!(call.timeout, tool_timeout(setting.as_deref()));
            assert!(call.timeout > Duration::ZERO);
        }
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
