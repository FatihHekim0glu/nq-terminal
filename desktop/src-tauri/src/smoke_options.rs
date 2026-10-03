//! The smoke build's test switches: one frozen struct, parsed only in smoke builds (main.rs declares this module
//! under `cfg(feature = "smoke")`, so none of it exists in the release or measure exe).
//!
//! FROZEN in W4A (04 D4): stage B fills behaviour behind these fields and never adds, removes or retypes one.
//! Switches, each at most once:
//!
//! - `--fixture`: start the fixture backend (`nq_terminal.desktop.fixture_main`) through the full handshake;
//! - `--attach-url <url>`: load a page server that is already running, with no backend and no handshake
//!   (`http://127.0.0.1:<port>/...` only, never port 8765);
//! - `--state-dir <dir>`: the backend's state folder (its lock, logs and cache) instead of `<lab>/terminal/state`;
//! - `--save-dir <dir>`: downloads and the diagnostics zip land here, with no save dialog;
//! - `--lab <dir>`: the lab, with no picker;
//! - `--webview-data-dir <dir>` (required): the WebView2 profile folder;
//! - `--config-dir <dir>` (required): the shell's settings and logs, never the roaming folder;
//! - `--zoom <percent>`: the app zoom, 50 to 300 in steps of 25;
//! - `--size <width>x<height>`: the inner window size, at least 1024x640;
//! - `--remote-debugging-port <port>`: default 0 (the engine picks one and writes DevToolsActivePort);
//! - `--screen2`: owner decision 10 only; the window may then be shown on the second monitor without activation.
//!
//! Rebuilds of a stale page are refused in every smoke run whatever the switches say (main.rs `rebuild_allowed`).

use std::ffi::OsString;
use std::fmt;
use std::path::{Component, PathBuf, Prefix};

/// The owner's browser backend: never attached to and never used as a debugging port.
pub const OWNER_PORT: u16 = 8765;
pub const ZOOM_MIN: u16 = 50;
pub const ZOOM_MAX: u16 = 300;
pub const ZOOM_STEP: u16 = 25;
pub const SIZE_MIN: (u32, u32) = (1024, 640);
pub const SIZE_MAX: (u32, u32) = (7680, 4320);

/// Every test switch of the smoke build (frozen).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmokeOptions {
    pub fixture: bool,
    pub attach_url: Option<String>,
    pub state_dir: Option<PathBuf>,
    pub save_dir: Option<PathBuf>,
    pub lab: Option<PathBuf>,
    pub webview_data_dir: PathBuf,
    pub config_dir: PathBuf,
    pub zoom: Option<u16>,
    pub size: Option<(u32, u32)>,
    pub remote_debugging_port: u16,
    pub screen2: bool,
}

/// Why a smoke command line was refused.
#[derive(Debug, PartialEq, Eq)]
pub struct SmokeArgError(pub String);

impl fmt::Display for SmokeArgError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "smoke switches refused: {}", self.0)
    }
}

impl std::error::Error for SmokeArgError {}

fn refuse<T>(why: impl Into<String>) -> Result<T, SmokeArgError> {
    Err(SmokeArgError(why.into()))
}

/// The raw switches before the cross-field checks.
#[derive(Default)]
struct Raw {
    fixture: bool,
    screen2: bool,
    values: Vec<(&'static str, String)>,
}

const FLAGS: [&str; 2] = ["--fixture", "--screen2"];
const VALUED: [&str; 9] = [
    "--attach-url",
    "--state-dir",
    "--save-dir",
    "--lab",
    "--webview-data-dir",
    "--config-dir",
    "--zoom",
    "--size",
    "--remote-debugging-port",
];

fn collect<I: IntoIterator<Item = OsString>>(args: I) -> Result<Raw, SmokeArgError> {
    let mut raw = Raw::default();
    let mut seen: Vec<String> = Vec::new();
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        let Some(arg) = arg.to_str().map(str::to_owned) else {
            return refuse("a switch is not valid Unicode");
        };
        if seen.contains(&arg) {
            return refuse(format!("{arg} given twice"));
        }
        seen.push(arg.clone());
        if let Some(flag) = FLAGS.iter().find(|f| **f == arg) {
            if *flag == "--fixture" {
                raw.fixture = true
            } else {
                raw.screen2 = true
            }
            continue;
        }
        let Some(name) = VALUED.iter().find(|v| **v == arg) else {
            return refuse(format!("unknown switch {arg}"));
        };
        let Some(value) = it.next().and_then(|v| v.into_string().ok()) else {
            return refuse(format!("{name} needs a value"));
        };
        if value.starts_with("--") || value.is_empty() {
            return refuse(format!("{name} needs a value"));
        }
        raw.values.push((name, value));
    }
    Ok(raw)
}

fn absolute(name: &str, value: &str) -> Result<PathBuf, SmokeArgError> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return refuse(format!("{name} must be an absolute path"));
    }
    Ok(path)
}

/// Folders the shell or the page writes into: on the D: drive only (the owner's rule for every test artefact), no
/// relative parts, and never a research folder, so a mistyped switch cannot make the shell or WebView2 write under
/// the lab's results, data, live or backtests folders.
const RESEARCH_FOLDERS: [&str; 4] = ["results", "data", "live", "backtests"];

fn folder(name: &str, value: &str) -> Result<PathBuf, SmokeArgError> {
    let path = absolute(name, value)?;
    let on_d = matches!(
        path.components().next(),
        Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(b'D' | b'd'))
    );
    if !on_d {
        return refuse(format!("{name} must be on the D: drive"));
    }
    for part in path.components() {
        let text = part.as_os_str().to_string_lossy().to_lowercase();
        if matches!(part, Component::ParentDir | Component::CurDir) {
            return refuse(format!("{name} may not contain relative parts"));
        }
        if RESEARCH_FOLDERS.contains(&text.as_str()) {
            return refuse(format!("{name} may not sit in a research folder ({text})"));
        }
    }
    Ok(path)
}

/// Only a loopback page server on 127.0.0.1 with an explicit port other than the owner's.
fn attach_url(value: &str) -> Result<String, SmokeArgError> {
    let Some(rest) = value.strip_prefix("http://127.0.0.1:") else {
        return refuse("--attach-url must start with http://127.0.0.1:<port>");
    };
    let port_text: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let after = &rest[port_text.len()..];
    let port: u16 = port_text
        .parse()
        .map_err(|_| SmokeArgError("--attach-url needs a port".into()))?;
    if port == 0 || port == OWNER_PORT {
        return refuse(format!("--attach-url may not use port {port}"));
    }
    if !(after.is_empty() || after.starts_with('/')) {
        return refuse("--attach-url must be a plain loopback URL");
    }
    Ok(value.to_string())
}

fn zoom(value: &str) -> Result<u16, SmokeArgError> {
    let z: u16 = value
        .parse()
        .map_err(|_| SmokeArgError("--zoom must be a whole percentage".into()))?;
    if !(ZOOM_MIN..=ZOOM_MAX).contains(&z) || !z.is_multiple_of(ZOOM_STEP) {
        return refuse(format!(
            "--zoom must be {ZOOM_MIN} to {ZOOM_MAX} in steps of {ZOOM_STEP}"
        ));
    }
    Ok(z)
}

fn size(value: &str) -> Result<(u32, u32), SmokeArgError> {
    let parsed = value
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)));
    let Some((w, h)) = parsed else {
        return refuse("--size must be <width>x<height>");
    };
    if w < SIZE_MIN.0 || h < SIZE_MIN.1 || w > SIZE_MAX.0 || h > SIZE_MAX.1 {
        return refuse(format!(
            "--size must be between {}x{} and {}x{}",
            SIZE_MIN.0, SIZE_MIN.1, SIZE_MAX.0, SIZE_MAX.1
        ));
    }
    Ok((w, h))
}

fn port(value: &str) -> Result<u16, SmokeArgError> {
    let p: u16 = value
        .parse()
        .map_err(|_| SmokeArgError("--remote-debugging-port must be 0 to 65535".into()))?;
    if p == OWNER_PORT {
        return refuse(format!("--remote-debugging-port may not be {OWNER_PORT}"));
    }
    Ok(p)
}

fn build(raw: Raw) -> Result<SmokeOptions, SmokeArgError> {
    let value = |name: &str| {
        raw.values
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.as_str())
    };
    let path = |name: &str| value(name).map(|v| absolute(name, v)).transpose();
    let dir = |name: &str| value(name).map(|v| folder(name, v)).transpose();
    let Some(webview_data_dir) = dir("--webview-data-dir")? else {
        return refuse("--webview-data-dir is required");
    };
    let Some(config_dir) = dir("--config-dir")? else {
        return refuse("--config-dir is required");
    };
    if webview_data_dir == config_dir {
        return refuse("--webview-data-dir and --config-dir must differ");
    }
    let options = SmokeOptions {
        fixture: raw.fixture,
        attach_url: value("--attach-url").map(attach_url).transpose()?,
        state_dir: dir("--state-dir")?,
        save_dir: dir("--save-dir")?,
        lab: path("--lab")?,
        webview_data_dir,
        config_dir,
        zoom: value("--zoom").map(zoom).transpose()?,
        size: value("--size").map(size).transpose()?,
        remote_debugging_port: value("--remote-debugging-port")
            .map(port)
            .transpose()?
            .unwrap_or(0),
        screen2: raw.screen2,
    };
    if options.fixture && options.attach_url.is_some() {
        return refuse("--fixture and --attach-url exclude each other");
    }
    Ok(options)
}

/// Parses the smoke command line (without the program name). Anything unknown, repeated or out of range is
/// refused, so a typo can never fall back to a default that touches the owner's folders.
pub fn parse<I: IntoIterator<Item = OsString>>(args: I) -> Result<SmokeOptions, SmokeArgError> {
    build(collect(args)?)
}

#[cfg(test)]
impl SmokeOptions {
    /// A minimal valid set for unit tests elsewhere in the crate.
    pub fn for_tests() -> Self {
        Self {
            fixture: false,
            attach_url: None,
            state_dir: None,
            save_dir: None,
            lab: None,
            webview_data_dir: PathBuf::from(r"D:\dev\tmp\wv"),
            config_dir: PathBuf::from(r"D:\dev\tmp\config"),
            zoom: None,
            size: None,
            remote_debugging_port: 0,
            screen2: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    const BASE: [&str; 4] = [
        "--webview-data-dir",
        r"D:\dev\d4\hw\r\wv",
        "--config-dir",
        r"D:\dev\d4\hw\r\cfg",
    ];

    fn with(extra: &[&str]) -> Result<SmokeOptions, SmokeArgError> {
        let mut all: Vec<&str> = BASE.to_vec();
        all.extend_from_slice(extra);
        parse(args(&all))
    }

    #[test]
    fn minimal_line_takes_the_defaults() {
        let o = with(&[]).expect("valid");
        assert_eq!(o.remote_debugging_port, 0);
        assert!(!o.fixture && !o.screen2);
        assert_eq!(o.attach_url, None);
        assert_eq!(o.webview_data_dir, PathBuf::from(r"D:\dev\d4\hw\r\wv"));
    }

    #[test]
    fn every_field_parses() {
        let o = with(&[
            "--attach-url",
            "http://127.0.0.1:8796/",
            "--state-dir",
            r"D:\s",
            "--save-dir",
            r"D:\o",
            "--lab",
            r"D:\lab",
            "--zoom",
            "200",
            "--size",
            "1280x800",
            "--remote-debugging-port",
            "9352",
            "--screen2",
        ])
        .expect("valid");
        assert_eq!(o.attach_url.as_deref(), Some("http://127.0.0.1:8796/"));
        assert_eq!(
            (o.zoom, o.size, o.remote_debugging_port, o.screen2),
            (Some(200), Some((1280, 800)), 9352, true)
        );
        assert_eq!(o.lab, Some(PathBuf::from(r"D:\lab")));
    }

    #[test]
    fn required_folders_are_required() {
        assert!(parse(args(&["--config-dir", r"D:\c"])).is_err());
        assert!(parse(args(&["--webview-data-dir", r"D:\w"])).is_err());
        assert!(
            parse(args(&[
                "--webview-data-dir",
                r"D:\w",
                "--config-dir",
                r"D:\w"
            ]))
            .is_err()
        );
    }

    #[test]
    fn folder_switches_must_be_on_d_and_clear_of_research_folders() {
        let bad = [
            ("--config-dir", r"C:\Users\Owner\nq-lab\results\x"),
            ("--config-dir", r"C:\cfg"),
            ("--config-dir", r"D:\dev\nq-lab\results\x"),
            ("--config-dir", r"D:\dev\x\..\..\cfg"),
            ("--config-dir", r"\\server\share\cfg"),
            ("--webview-data-dir", r"C:\wv"),
            ("--webview-data-dir", r"D:\dev\nq-lab\DATA\wv"),
            ("--state-dir", r"C:\s"),
            ("--save-dir", r"D:\dev\live\o"),
            ("--save-dir", r"D:\dev\backtests\o"),
        ];
        for (switch, folder) in bad {
            let mut line = vec!["--webview-data-dir", r"D:\w", "--config-dir", r"D:\c"];
            if let Some(i) = line.iter().position(|v| *v == switch) {
                line[i + 1] = folder;
            } else {
                line.extend([switch, folder]);
            }
            assert!(parse(args(&line)).is_err(), "accepted {switch} {folder}");
        }
    }

    #[test]
    fn bad_lines_are_refused() {
        let bad: [&[&str]; 16] = [
            &["--unknown"],
            &["--zoom", "45"],
            &["--zoom", "310"],
            &["--zoom", "110"],
            &["--size", "800x600"],
            &["--size", "big"],
            &["--attach-url", "http://localhost:8796/"],
            &["--attach-url", "http://127.0.0.1:8765/"],
            &["--attach-url", "http://127.0.0.1:8796.evil/"],
            &["--attach-url", "https://127.0.0.1:8796/"],
            &["--remote-debugging-port", "8765"],
            &["--lab", r"relative\lab"],
            &["--fixture", "--attach-url", "http://127.0.0.1:8796/"],
            &["--fixture", "--fixture"],
            &["--save-dir"],
            &["--state-dir", "--fixture"],
        ];
        for line in bad {
            assert!(with(line).is_err(), "accepted {line:?}");
        }
    }
}
