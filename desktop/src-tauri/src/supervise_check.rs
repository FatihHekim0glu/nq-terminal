//! What the shell starts and what it accepts (03 sections 2.2, 4.4, 7.1 and 8): the spawn spec, the command line and
//! the allow-listed environment, and the identity checks of the handshake and of every proof, each refusal with its
//! own message and its own section of stopped.html.

use crate::link;
use serde::Deserialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The interpreter switches, exactly (02 C3-5), before the module name.
pub const SPAWN_ARGS: [&str; 7] = ["-E", "-s", "-X", "utf8", "-X", "faulthandler", "-m"];
pub const BACKEND_MODULE: &str = "nq_terminal";
/// The test-only fixture entry, spawned only by a smoke build's `--fixture`.
#[cfg(feature = "smoke")]
pub const FIXTURE_MODULE: &str = "nq_terminal.desktop.fixture_main";
/// The names passed from the shell's environment (03 section 8 and the list in backend desktop/envlist.py).
pub const BASE_ENV: [&str; 20] = [
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "SYSTEMDRIVE",
    "PATHEXT",
    "PROGRAMDATA",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "USERNAME",
    "COMPUTERNAME",
    "OS",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "LOCALAPPDATA",
    "APPDATA",
    "PATH",
];
/// NQT_ names passed on when set; every other NQT_ name the backend gets is the shell's own decision.
pub const PASSED_NQT: [&str; 2] = ["NQT_CACHE_BYTES", "NQT_MEMTRIM"];
/// The contract range when tauri.conf.json carries none (`plugins.nqt-shell.contract_min` and `contract_max`).
pub const CONTRACT_RANGE: (i64, i64) = (1, 1);
pub const CONFIG_KEY: &str = "nqt-shell";
pub const LOCK_FILE: &str = "backend.lock";
pub const BACKEND_LOG: [&str; 2] = ["logs", "backend.log"];
pub const HANDSHAKE_VERSION: u32 = 1;

/// What to spawn, and where its lock and log live.
#[derive(Clone, Debug)]
pub struct Spec {
    pub lab: PathBuf,
    /// `<lab>/terminal/state`, or the smoke `--state-dir`, or the fixture's temporary folder.
    pub state_dir: PathBuf,
    pub module: &'static str,
    /// NQT_STATE_DIR, NQT_JOBS and NQT_FIXTURE_DIR for the test backends (03 section 8).
    pub extra_env: Vec<(String, String)>,
}

impl Spec {
    pub fn python(&self) -> PathBuf {
        self.lab.join(".venv").join("Scripts").join("python.exe")
    }
    pub fn backend_dir(&self) -> PathBuf {
        self.lab.join("terminal").join("backend")
    }
    pub fn lock_path(&self) -> PathBuf {
        self.state_dir.join(LOCK_FILE)
    }
    pub fn log_path(&self) -> PathBuf {
        self.state_dir.join(BACKEND_LOG[0]).join(BACKEND_LOG[1])
    }
}

/// The smoke spec for `--lab`: the `--state-dir` or, when it is absent, a temporary folder under the config folder
/// (fixture or not), NQT_STATE_DIR and NQT_JOBS=off always, and the fixture module with NQT_FIXTURE_DIR. A smoke
/// backend never uses the lab's own state folder and never runs jobs (03 section 8).
#[cfg(feature = "smoke")]
pub fn smoke_spec(
    lab: PathBuf,
    state_dir: Option<PathBuf>,
    config_dir: &Path,
    fixture: bool,
    pid: u32,
) -> Spec {
    let state_dir = state_dir.unwrap_or_else(|| config_dir.join(format!("fixture-state-{pid}")));
    let mut extra_env = vec![
        (
            "NQT_STATE_DIR".to_string(),
            state_dir.to_string_lossy().into_owned(),
        ),
        ("NQT_JOBS".to_string(), "off".to_string()),
    ];
    if fixture {
        let fixtures = lab
            .join("terminal")
            .join("backend")
            .join("tests")
            .join("fixtures");
        extra_env.push((
            "NQT_FIXTURE_DIR".to_string(),
            fixtures.to_string_lossy().into_owned(),
        ));
    }
    let module = if fixture {
        FIXTURE_MODULE
    } else {
        BACKEND_MODULE
    };
    Spec {
        lab,
        state_dir,
        module,
        extra_env,
    }
}

/// The command line: the quoted interpreter, the switches and the module.
pub fn command_line(python: &Path, module: &str) -> String {
    let mut line = format!("\"{}\"", python.display());
    for arg in SPAWN_ARGS.iter().chain(std::iter::once(&module)) {
        line.push(' ');
        line.push_str(arg);
    }
    line
}

/// The backend's environment, built from nothing: the base names, PATH with the venv's Scripts folder first, the
/// two Python settings, NQT_CACHE_BYTES and NQT_MEMTRIM when set, NQT_DESKTOP=1, NQT_PORT=0 and the spec's test names. Names are
/// upper case and sorted; a secret-shaped name, a PYTHON*, a WEBVIEW2_* or an IB_* name can never arrive.
pub fn backend_env(
    parent: impl IntoIterator<Item = (OsString, OsString)>,
    spec: &Spec,
) -> Vec<(String, OsString)> {
    let upper: Vec<(String, OsString)> = parent
        .into_iter()
        .map(|(n, v)| (n.to_string_lossy().to_uppercase(), v))
        .collect();
    let find = |name: &str| {
        upper
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    };
    let mut env: Vec<(String, OsString)> = BASE_ENV
        .iter()
        .chain(PASSED_NQT.iter())
        .filter(|n| **n != "PATH")
        .filter_map(|n| find(n).map(|v| (n.to_string(), v)))
        .collect();
    let mut path = spec.lab.join(".venv").join("Scripts").into_os_string();
    if let Some(rest) = find("PATH") {
        path.push(";");
        path.push(rest);
    }
    env.push(("PATH".into(), path));
    let fixed = [
        ("PYTHONUTF8", "1"),
        ("PYTHONIOENCODING", "utf-8"),
        ("NQT_DESKTOP", "1"),
        ("NQT_PORT", "0"),
    ];
    env.extend(
        fixed
            .iter()
            .map(|(n, v)| (n.to_string(), OsString::from(v))),
    );
    let extra = spec.extra_env.iter();
    env.extend(extra.map(|(n, v)| (n.to_uppercase(), OsString::from(v))));
    env.sort_by(|a, b| a.0.cmp(&b.0));
    env.dedup_by(|later, earlier| later.0 == earlier.0);
    env
}

/// The IB names the backend takes with the snapshot on (backend desktop/envlist.py `IB_NAMES`).
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes no IB checkbox; its settings name no IB snapshot"
    )
)]
pub const IB_NAMES: [&str; 4] = ["IB_HOST", "IB_PORT", "IB_ACCOUNT_ID", "IB_BASE_USD_RATE"];
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes no IB checkbox; its settings name no IB snapshot"
    )
)]
pub const IB_SWITCH: &str = "NQT_IB_READONLY";

/// What the settings checkbox "IB snapshot (read only)" adds for the backend (03 section 9): the switch, and the four
/// IB names as this process has them (the owner's own environment; the shell invents no value). Nothing else.
#[cfg_attr(
    feature = "smoke",
    allow(
        dead_code,
        reason = "a smoke build takes no IB checkbox; its settings name no IB snapshot"
    )
)]
pub fn ib_snapshot_env(
    parent: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(String, String)> {
    let mut env = vec![(IB_SWITCH.to_string(), "1".to_string())];
    for (name, value) in parent {
        let name = name.to_string_lossy().to_uppercase();
        if IB_NAMES.contains(&name.as_str()) {
            env.push((name, value.to_string_lossy().into_owned()));
        }
    }
    env
}

/// The contract range from tauri.conf.json (`plugins.nqt-shell`), else CONTRACT_RANGE.
pub fn contract_range(config: Option<&serde_json::Value>) -> (i64, i64) {
    let field = |name: &str| {
        config
            .and_then(|c| c.get(name))
            .and_then(serde_json::Value::as_i64)
    };
    match (field("contract_min"), field("contract_max")) {
        (Some(min), Some(max)) if min <= max => (min, max),
        _ => CONTRACT_RANGE,
    }
}

/// A path for comparison: no `\\?\`, backslashes, no trailing separator, lower case.
pub fn normalise(path: &str) -> String {
    let plain = path
        .strip_prefix(r"\\?\")
        .unwrap_or(path)
        .replace('/', "\\");
    plain.trim_end_matches('\\').to_lowercase()
}

fn forms(path: &Path) -> Vec<String> {
    let mut all = vec![normalise(&path.to_string_lossy())];
    if let Ok(real) = std::fs::canonicalize(path) {
        all.push(normalise(&real.to_string_lossy()));
    }
    all
}

/// What every handshake and proof must report.
#[derive(Clone, Debug)]
pub struct Expect {
    roots: Vec<String>,
    prefixes: Vec<String>,
    pub contract: (i64, i64),
}

impl Expect {
    /// ROOT is the picked lab and the prefix is `<lab>/.venv`, as given or with links resolved.
    pub fn for_lab(lab: &Path, contract: (i64, i64)) -> Self {
        Self {
            roots: forms(lab),
            prefixes: forms(&lab.join(".venv")),
            contract,
        }
    }

    fn same(reported: &str, accepted: &[String]) -> bool {
        accepted.contains(&normalise(reported))
            || forms(Path::new(reported))
                .iter()
                .any(|f| accepted.contains(f))
    }
}

/// A refused backend, each with its own message and its own section of stopped.html.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mismatch {
    Malformed(String),
    /// NQT-ATTACH: another backend holds the lab's lock and could not be attached to.
    LockHeld,
    /// The backend ended with its untrusted-lock exit code: the lab's lock was not made by this user.
    LockUntrusted,
    Hmac,
    PidOutsideJob(u32),
    Listener(Option<u32>),
    Root(String),
    Prefix(String),
    Contract(i64),
    Dist(String),
    /// The fresh proof failed: the backend behind the port is not the one that was checked.
    Proof(String),
    /// The fresh proof did not answer in time (a busy backend): retried, never shown as a swap.
    Unverified(String),
}

impl Mismatch {
    /// The section of stopped.html that explains it.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "handshake",
            Self::LockHeld => "lock-held",
            Self::LockUntrusted => "lock-untrusted",
            Self::Hmac => "hmac",
            Self::PidOutsideJob(_) => "pid",
            Self::Listener(_) => "listener",
            Self::Root(_) => "root",
            Self::Prefix(_) => "prefix",
            Self::Contract(_) => "contract",
            Self::Dist(_) => "dist",
            Self::Proof(_) => "swapped",
            Self::Unverified(_) => "unverified",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Malformed(why) => format!("the backend's handshake is not valid: {why}"),
            Self::LockHeld => {
                "another backend holds the lab's lock and could not be verified".into()
            }
            Self::LockUntrusted => {
                "backend.lock was not made by this user, so the backend refused it and ended".into()
            }
            Self::Hmac => "the handshake proof does not match the token this app sent".into(),
            Self::PidOutsideJob(pid) => {
                format!("the reported process {pid} is not one this app started")
            }
            Self::Listener(pid) => {
                format!("the port is not served by the backend this app started (owner {pid:?})")
            }
            Self::Root(root) => format!("the backend serves another lab: {root}"),
            Self::Prefix(prefix) => format!("the backend runs from another environment: {prefix}"),
            Self::Contract(n) => {
                format!("the lab checkout and the app are out of step (contract {n})")
            }
            Self::Dist(state) => format!("the page build is {state}; rebuild it before starting"),
            Self::Proof(why) => format!("the backend failed its identity proof: {why}"),
            Self::Unverified(why) => {
                format!("the backend did not answer its identity check in time: {why}")
            }
        }
    }
}

/// The NQT-READY fields the shell checks.
#[derive(Clone, Debug, Deserialize)]
pub struct Ready {
    pub v: u32,
    pub port: u16,
    pub pid: u32,
    pub proof: Option<String>,
    pub root: String,
    pub prefix: String,
    pub contract: i64,
    pub dist: String,
}

/// The first `NQT-` line: READY, or the attach notice of a start that found a live lock.
pub fn parse_handshake(line: &str) -> Result<Ready, Mismatch> {
    let trimmed = line.trim();
    let (prefix, rest) = trimmed.split_once(' ').unwrap_or((trimmed, ""));
    match prefix {
        "NQT-READY" => serde_json::from_str(rest).map_err(|e| Mismatch::Malformed(e.to_string())),
        "NQT-ATTACH" => Err(Mismatch::LockHeld),
        other => Err(Mismatch::Malformed(format!("unknown line {other}"))),
    }
}

/// ROOT, the prefix and the contract range.
pub fn check_place(
    root: &str,
    prefix: &str,
    contract: i64,
    expect: &Expect,
) -> Result<(), Mismatch> {
    if !Expect::same(root, &expect.roots) {
        return Err(Mismatch::Root(root.to_string()));
    }
    if !Expect::same(prefix, &expect.prefixes) {
        return Err(Mismatch::Prefix(prefix.to_string()));
    }
    if !(expect.contract.0..=expect.contract.1).contains(&contract) {
        return Err(Mismatch::Contract(contract));
    }
    Ok(())
}

/// The READY checks that need no process: version, MAC, ROOT, prefix, contract and the page build.
pub fn check_ready(
    ready: &Ready,
    token: &str,
    nonce: &str,
    expect: &Expect,
) -> Result<(), Mismatch> {
    if ready.v != HANDSHAKE_VERSION {
        return Err(Mismatch::Malformed(format!(
            "handshake version {}",
            ready.v
        )));
    }
    let proof = ready.proof.as_deref().unwrap_or("");
    if !link::verify_mac(token, link::READY_KIND, nonce, ready.port, ready.pid, proof) {
        return Err(Mismatch::Hmac);
    }
    check_place(&ready.root, &ready.prefix, ready.contract, expect)?;
    if ready.dist != "current" {
        return Err(Mismatch::Dist(ready.dist.clone()));
    }
    Ok(())
}

/// Why a start did not give a checked backend.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// The process could not be created (or its pipes, job or log).
    Spawn(String),
    /// It ended, or closed its output, before its handshake or while its first proof was retried; carries its exit
    /// code when that was read.
    Exited(Option<u32>),
    Timeout,
    /// It answered and failed a check: never retried.
    Refused(Mismatch),
    /// The proof or the session request failed.
    Link(String),
}

impl Failure {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Spawn(_) => "spawn",
            Self::Exited(_) | Self::Timeout | Self::Link(_) => "exited",
            Self::Refused(m) => m.code(),
        }
    }

    /// The backend's exit code, when it ended and the code was read.
    pub fn exit_code(&self) -> Option<u32> {
        match self {
            Self::Exited(code) => *code,
            _ => None,
        }
    }
}

/// The id of the stopped page's exit code line, inside its "exited" section.
pub const EXIT_NOTE_ID: &str = "exit-code";

/// The stopped page's line for a backend's exit code, in words; nothing when the code is unknown. It names no folder.
/// It starts with a real space, because it follows the reason's own text in the same line (no space drawn by CSS, which
/// a copy of the line would lose).
pub fn exit_note(code: Option<u32>) -> Option<String> {
    code.map(|c| format!(" The backend ended with exit code {c}."))
}

/// A script that puts the exit code line into the stopped page (and clears it when the code is unknown, so that a
/// later exit never shows an earlier one's code). Run through the webview's eval after the navigation, like the
/// announcement: it waits, bounded (50 looks, 100 ms apart), for the stopped page, because the first navigation is a
/// full load that eval can overtake (the webview is then still on the outgoing page, which is a reason to wait, not
/// to give up), and it changes nothing on any other page. A script that ran in the outgoing document dies with it;
/// the shell therefore evals it again a few times (see `WindowSink::exited`). It writes only when the line differs,
/// so a repeat replaces nothing (a selection in the line survives, and the live region is not told again).
pub fn exit_note_script(code: Option<u32>) -> String {
    let text = serde_json::to_string(&exit_note(code).unwrap_or_default())
        .unwrap_or_else(|_| "\"\"".into());
    format!(
        "(function(){{var n=0;function go(){{var e=document.getElementById('{EXIT_NOTE_ID}');\
if(!location.pathname.endsWith('stopped.html')||!e||document.readyState==='loading')\
{{if(++n<50)setTimeout(go,100);return;}}\
if(e.textContent!=={text}){{e.textContent={text};}}}}go();}})();"
    )
}

#[cfg(test)]
#[allow(
    clippy::disallowed_methods,
    reason = "a unit test reads the one plain JSON file that names the backend's contract number"
)]
mod tests {
    use super::*;

    #[cfg(feature = "smoke")]
    fn env_of<'a>(spec: &'a Spec, name: &str) -> Option<&'a str> {
        let found = spec.extra_env.iter().find(|(n, _)| n == name);
        found.map(|(_, v)| v.as_str())
    }

    #[cfg(feature = "smoke")]
    #[test]
    fn a_lab_without_a_state_dir_gets_a_temporary_state_folder_and_jobs_off() {
        let lab = PathBuf::from(r"D:\dev	mp\lab");
        let config = PathBuf::from(r"D:\dev	mp\config");
        let spec = smoke_spec(lab.clone(), None, &config, false, 4242);
        let temporary = config.join("fixture-state-4242");
        assert_eq!(spec.state_dir, temporary);
        assert_ne!(spec.state_dir, lab.join("terminal").join("state"));
        let named = temporary.to_string_lossy().into_owned();
        assert_eq!(env_of(&spec, "NQT_STATE_DIR"), Some(named.as_str()));
        assert_eq!(env_of(&spec, "NQT_JOBS"), Some("off"));
        assert_eq!(spec.module, BACKEND_MODULE);
    }

    #[cfg(feature = "smoke")]
    #[test]
    fn an_explicit_state_dir_is_kept_and_jobs_stay_off() {
        let state = PathBuf::from(r"D:\dev	mp\state");
        let lab = PathBuf::from(r"D:\dev	mp\lab");
        let config = PathBuf::from(r"D:\dev	mp\config");
        let spec = smoke_spec(lab, Some(state.clone()), &config, false, 1);
        assert_eq!(spec.state_dir, state);
        assert_eq!(env_of(&spec, "NQT_JOBS"), Some("off"));
    }

    #[cfg(feature = "smoke")]
    #[test]
    fn the_fixture_keeps_its_module_and_fixture_dir_with_jobs_off() {
        let lab = PathBuf::from(r"D:\dev	mp\lab");
        let config = PathBuf::from(r"D:\dev	mp\config");
        let spec = smoke_spec(lab, None, &config, true, 7);
        assert_eq!(spec.module, FIXTURE_MODULE);
        assert!(env_of(&spec, "NQT_FIXTURE_DIR").is_some());
        assert_eq!(env_of(&spec, "NQT_JOBS"), Some("off"));
    }

    /// The range the shell accepts moves with `contract/desktop_version.json`: a backend contract bump without the
    /// shell's range following is a failing build, not a shell that refuses every backend at run time.
    #[test]
    fn the_built_in_range_holds_the_contract_number_of_the_repository() {
        let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("contract")
            .join("desktop_version.json");
        let text = std::fs::read_to_string(&file).expect("contract/desktop_version.json");
        let json: serde_json::Value = serde_json::from_str(&text).expect("JSON");
        let contract = json["contract"].as_i64().expect("a contract number");
        let (min, max) = contract_range(None);
        assert!(
            (min..=max).contains(&contract),
            "the backend contract {contract} is outside the shell's range {min} to {max}"
        );
    }

    fn os(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(n, v)| ((*n).into(), (*v).into()))
            .collect()
    }

    #[test]
    fn the_ib_checkbox_adds_the_switch_and_only_the_four_names() {
        let parent = os(&[
            ("ib_host", "127.0.0.1"),
            ("IB_PORT", "7497"),
            ("IB_ACCOUNT_ID", "DU1"),
            ("IB_PAPER_DELAYED_DATA", "1"),
            ("QUANTPAD_API_KEY", "secret"),
            ("PATH", "C:/x"),
        ]);
        let env = ib_snapshot_env(parent);
        let names: Vec<&str> = env.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            ["NQT_IB_READONLY", "IB_HOST", "IB_PORT", "IB_ACCOUNT_ID"]
        );
        assert_eq!(env[0].1, "1");
        assert_eq!(env[1].1, "127.0.0.1");
    }

    #[test]
    fn without_the_checkbox_no_ib_name_reaches_the_backend() {
        let spec = Spec {
            lab: PathBuf::from(r"D:\lab"),
            state_dir: PathBuf::from(r"D:\lab\terminal\state"),
            module: BACKEND_MODULE,
            extra_env: Vec::new(),
        };
        let parent = os(&[("IB_HOST", "127.0.0.1"), ("NQT_IB_READONLY", "1")]);
        let env = backend_env(parent, &spec);
        assert!(
            env.iter()
                .all(|(n, _)| !n.starts_with("IB_") && n != IB_SWITCH)
        );
    }

    #[test]
    fn the_memory_trim_switch_reaches_the_backend() {
        let spec = Spec {
            lab: PathBuf::from(r"D:\lab"),
            state_dir: PathBuf::from(r"D:\lab\terminal\state"),
            module: BACKEND_MODULE,
            extra_env: Vec::new(),
        };
        let off = backend_env(os(&[("NQT_MEMTRIM", "0")]), &spec);
        let found = off.iter().find(|(n, _)| n == "NQT_MEMTRIM");
        assert_eq!(found.map(|(_, v)| v.to_str()), Some(Some("0")));
        let other = backend_env(os(&[("NQT_OTHER", "0")]), &spec);
        assert!(
            other
                .iter()
                .all(|(n, _)| n != "NQT_MEMTRIM" && n != "NQT_OTHER")
        );
    }

    #[test]
    fn a_known_exit_code_is_put_into_words_and_an_unknown_one_says_nothing() {
        assert_eq!(
            exit_note(Some(3)).as_deref(),
            Some(" The backend ended with exit code 3.")
        );
        assert_eq!(
            exit_note(Some(0)).as_deref(),
            Some(" The backend ended with exit code 0.")
        );
        assert_eq!(
            exit_note(Some(3_221_225_786)).as_deref(),
            Some(" The backend ended with exit code 3221225786.")
        );
        assert_eq!(exit_note(None), None);
    }

    /// V032 review: the space between the reason and the code was drawn by CSS (`::before`), so it was not in the
    /// line's text. It is a real space in the note now, and the stylesheet draws none.
    #[test]
    fn the_space_before_the_code_is_text_and_not_drawn_by_the_stylesheet() {
        assert!(exit_note(Some(3)).is_some_and(|n| n.starts_with(' ')));
        let css = include_str!("../assets/stopped.css");
        assert!(!css.contains("::before"), "{css}");
        assert!(css.contains(".exit-code:empty"), "{css}");
    }

    #[test]
    fn only_an_exit_carries_a_code() {
        assert_eq!(Failure::Exited(Some(3)).exit_code(), Some(3));
        assert_eq!(Failure::Exited(None).exit_code(), None);
        assert_eq!(Failure::Timeout.exit_code(), None);
        assert_eq!(Failure::Link("x".into()).exit_code(), None);
        assert_eq!(Failure::Refused(Mismatch::Hmac).exit_code(), None);
        assert_eq!(Failure::Exited(Some(3)).code(), "exited");
        assert_eq!(Failure::Exited(None).code(), "exited");
    }

    #[test]
    fn the_stopped_page_has_a_code_line_in_its_exited_section_and_no_folder_name_in_the_script() {
        let page = include_str!("../assets/stopped.html");
        let exited = page.split(r#"id="exited""#).nth(1).expect("exited section");
        let exited = exited.split("</section>").next().expect("section end");
        assert!(
            exited.contains(&format!(r#"id="{EXIT_NOTE_ID}""#)),
            "{exited}"
        );
        // The code is part of the announced reason line (role=status), so a screen reader hears it when it is written.
        let status = exited
            .split(r#"id="exited-text""#)
            .nth(1)
            .and_then(|rest| rest.split("</p>").next())
            .expect("the exited reason line");
        assert!(
            status.contains(&format!(r#"id="{EXIT_NOTE_ID}""#))
                && status.contains(r#"role="status""#),
            "the exit code must sit inside the announced #exited-text line: {status}"
        );
        let script = exit_note_script(Some(3));
        assert!(script.contains(EXIT_NOTE_ID), "{script}");
        assert!(script.contains("The backend ended with exit code 3."));
        assert!(!script.contains('\\'), "{script}");
        assert!(!script.contains("terminal") && !script.contains("backend.log"));
    }

    #[test]
    fn the_script_clears_the_line_when_the_code_is_unknown_and_stays_on_the_stopped_page() {
        let known = exit_note_script(Some(7));
        let unknown = exit_note_script(None);
        assert!(known.contains("endsWith('stopped.html')"), "{known}");
        assert!(unknown.contains("textContent=\"\""), "{unknown}");
        assert!(!unknown.contains("exit code"), "{unknown}");
        assert!(
            known.contains("++n<50"),
            "the wait must be bounded: {known}"
        );
    }

    #[test]
    fn a_repeated_script_writes_only_when_the_line_differs() {
        let known = exit_note_script(Some(7));
        let text = "\" The backend ended with exit code 7.\"";
        let guarded = format!("if(e.textContent!=={text}){{e.textContent={text};}}");
        assert!(known.contains(&guarded), "{known}");
        let unknown = exit_note_script(None);
        assert!(
            unknown.contains("if(e.textContent!==\"\"){e.textContent=\"\";}"),
            "{unknown}"
        );
    }
}
