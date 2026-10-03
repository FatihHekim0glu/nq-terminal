//! Separate identities (04 D4; 03 section 3): the release, smoke and measure builds carry three different
//! identifiers, so a test build never shares a config folder, window state, WebView2 profile or single-instance
//! mutex with the owner's app. The single-instance and window-state plugins exist only in the release: absent from
//! the smoke and measure dependency graphs (`cargo tree`), registered only behind one cfg in main.rs (static scan),
//! and reported as not registered by a running smoke build (the start record checked in hidden_window.rs).
#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own sources and configuration files"
)]

use serde_json::{Map, Value};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const RELEASE_ID: &str = "dev.nqlab.terminal";
const SMOKE_ID: &str = "dev.nqlab.terminal.smoke";
const MEASURE_ID: &str = "dev.nqlab.terminal.measure";
const PLUGIN_CRATES: [&str; 2] = ["tauri-plugin-single-instance", "tauri-plugin-window-state"];
const PLUGIN_PATHS: [&str; 2] = ["tauri_plugin_single_instance", "tauri_plugin_window_state"];
/// The one cfg under which main.rs may register the release plugins.
const RELEASE_CFG: &str =
    r#"#[cfg(all(feature = "shell-plugins", not(any(feature = "smoke", feature = "measure"))))]"#;
const RELEASE_FN: &str = "fn release_plugins";

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn conf(name: &str) -> Map<String, Value> {
    let path = crate_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    match serde_json::from_str(&text) {
        Ok(Value::Object(map)) => map,
        other => panic!("{} is not a JSON object: {other:?}", path.display()),
    }
}

fn identifier(map: &Map<String, Value>) -> &str {
    map.get("identifier").and_then(Value::as_str).unwrap_or("")
}

#[test]
fn three_identities_differ() {
    let (release, smoke, measure) = (
        conf("tauri.conf.json"),
        conf("tauri.smoke.conf.json"),
        conf("tauri.measure.conf.json"),
    );
    assert_eq!(identifier(&release), RELEASE_ID);
    assert_eq!(identifier(&smoke), SMOKE_ID);
    assert_eq!(identifier(&measure), MEASURE_ID);
    assert_eq!(
        release.get("productName").and_then(Value::as_str),
        Some("nq-lab terminal")
    );
    let names = [
        identifier(&release),
        identifier(&smoke),
        identifier(&measure),
    ];
    for (i, a) in names.iter().enumerate() {
        for b in &names[i + 1..] {
            assert_ne!(a, b, "two build identities share an identifier");
        }
    }
}

/// The smoke and measure files are full configurations (build.rs merges the one a test build needs over the release file), so they must agree
/// with the release file everywhere except the identity itself.
#[test]
fn test_identities_differ_from_the_release_only_in_identity() {
    let release = conf("tauri.conf.json");
    for name in ["tauri.smoke.conf.json", "tauri.measure.conf.json"] {
        let other = conf(name);
        let mut keys: Vec<&String> = release.keys().chain(other.keys()).collect();
        keys.sort();
        keys.dedup();
        for key in keys {
            if key == "identifier" || key == "productName" {
                continue;
            }
            assert_eq!(
                release.get(key),
                other.get(key),
                "{name} differs from tauri.conf.json in '{key}'"
            );
        }
        assert_ne!(
            release.get("productName"),
            other.get("productName"),
            "{name} needs its own product name"
        );
    }
}

fn cargo_tree(args: &[&str]) -> String {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let out = Command::new(cargo)
        .args(["tree", "--locked", "--offline", "--prefix", "none"])
        .args(args)
        .current_dir(crate_dir())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap_or_else(|e| panic!("cannot run cargo tree: {e}"));
    assert!(
        out.status.success(),
        "cargo tree {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn plugins_are_absent_from_smoke_and_measure_graphs() {
    let release = cargo_tree(&["-e", "normal"]);
    for krate in PLUGIN_CRATES {
        assert!(
            release.contains(krate),
            "the release graph should hold {krate}"
        );
    }
    for feature in ["smoke", "measure"] {
        let graph = cargo_tree(&[
            "-e",
            "normal",
            "--no-default-features",
            "--features",
            feature,
        ]);
        for krate in PLUGIN_CRATES {
            assert!(!graph.contains(krate), "the {feature} graph holds {krate}");
        }
    }
}

#[test]
fn release_feature_graph_has_no_test_feature() {
    // The package's own features show only in the inverted tree of the package.
    let graph = cargo_tree(&["-e", "features", "-i", "nq-lab-terminal"]);
    for feature in ["\"smoke\"", "\"measure\""] {
        let hits: Vec<&str> = graph
            .lines()
            .filter(|l| l.starts_with("nq-lab-terminal feature") && l.contains(feature))
            .collect();
        assert!(
            hits.is_empty(),
            "the release graph enables {feature}: {hits:?}"
        );
    }
    assert!(
        graph.contains("nq-lab-terminal feature \"shell-plugins\""),
        "the release build enables shell-plugins"
    );
    let smoke = cargo_tree(&[
        "-e",
        "features",
        "-i",
        "nq-lab-terminal",
        "--no-default-features",
        "--features",
        "smoke",
    ]);
    assert!(
        smoke.contains("nq-lab-terminal feature \"smoke\""),
        "the scan must see a feature that is on"
    );
    assert!(
        !smoke.contains("\"shell-plugins\""),
        "the smoke build must not enable shell-plugins"
    );
}

/// The source without whitespace, and for each kept byte its offset in the source (rustfmt may wrap the cfg).
fn compact(source: &str) -> (String, Vec<usize>) {
    let kept: Vec<(usize, char)> = source
        .char_indices()
        .filter(|(_, c)| !c.is_whitespace())
        .collect();
    let text: String = kept.iter().map(|(_, c)| *c).collect();
    let mut offsets = Vec::with_capacity(text.len());
    for (at, c) in kept {
        offsets.extend(std::iter::repeat_n(at, c.len_utf8()));
    }
    (text, offsets)
}

/// The byte range of the body of `fn release_plugins` when it sits directly under the release cfg, whatever the
/// line wrapping.
fn guarded_body(source: &str) -> Option<(usize, usize)> {
    let (text, offsets) = compact(source);
    let head: String = format!("{RELEASE_CFG}{RELEASE_FN}")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let at = text.find(&head)?;
    let fn_at = offsets[at + head.len() - 1];
    let open = fn_at + source[fn_at..].find('{')?;
    let mut depth = 0usize;
    for (i, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((open, open + i));
                }
            }
            _ => {}
        }
    }
    None
}

/// Every use of a plugin path that is not inside the guarded release function of main.rs.
fn unguarded_plugin_uses(files: &[(String, String)]) -> Vec<String> {
    let mut out = Vec::new();
    for (name, source) in files {
        let body = if name == "main.rs" {
            guarded_body(source)
        } else {
            None
        };
        for path in PLUGIN_PATHS {
            for (at, _) in source.match_indices(path) {
                if !body.is_some_and(|(start, end)| at > start && at < end) {
                    out.push(format!("{name}: {path} at byte {at}"));
                }
            }
        }
    }
    out
}

fn sources(dir: &Path) -> Vec<(String, String)> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
        .flatten()
    {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            files.push((entry.file_name().to_string_lossy().into_owned(), text));
        }
    }
    files
}

#[test]
fn plugins_are_registered_only_behind_the_release_cfg() {
    let files = sources(&crate_dir().join("src"));
    assert!(
        files.iter().any(|(n, _)| n == "main.rs"),
        "src/main.rs is missing"
    );
    let main = &files
        .iter()
        .find(|(n, _)| n == "main.rs")
        .map(|(_, s)| s.clone())
        .unwrap_or_default();
    assert!(
        guarded_body(main).is_some(),
        "main.rs must hold `{RELEASE_FN}` directly under {RELEASE_CFG}"
    );
    for path in PLUGIN_PATHS {
        assert!(main.contains(path), "main.rs never registers {path}");
    }
    let found = unguarded_plugin_uses(&files);
    assert!(
        found.is_empty(),
        "plugin used outside the guarded release function: {found:?}"
    );
}

#[test]
fn planted_unguarded_plugin_use_is_caught() {
    let guarded = format!(
        "{RELEASE_CFG}\n{RELEASE_FN}(b: B) -> B {{ b.plugin(tauri_plugin_window_state::Builder::default().build()) }}\n"
    );
    assert!(unguarded_plugin_uses(&[("main.rs".into(), guarded.clone())]).is_empty());
    let planted = [
        (
            "main.rs".to_string(),
            format!(
                "{guarded}fn other() {{ tauri_plugin_single_instance::init(|_, _, _| {{}}); }}"
            ),
        ),
        (
            "window.rs".to_string(),
            "fn x() { tauri_plugin_window_state::Builder::default(); }".to_string(),
        ),
        (
            "main.rs".to_string(),
            guarded.replace(
                "not(any(feature = \"smoke\", feature = \"measure\"))",
                "not(feature = \"smoke\")",
            ),
        ),
    ];
    for (name, source) in planted {
        assert!(
            !unguarded_plugin_uses(&[(name.clone(), source.clone())]).is_empty(),
            "planted use passed: {source}"
        );
    }
}
