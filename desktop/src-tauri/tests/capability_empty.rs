//! The page gets nothing from the shell (03 section 2.1; 02 D10). The one capability file names the main window
//! and grants no permission, every build identity keeps `withGlobalTauri` off and names only that file, and the
//! capabilities Tauri resolved at build time (`gen/schemas/capabilities.json`) grant nothing either. Each check
//! runs first against a planted document, so a checker that passes everything fails here (born failing).
#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own configuration files; the shipped shell reads only through reads.rs"
)]

use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const CONF_FILES: [&str; 3] = [
    "tauri.conf.json",
    "tauri.smoke.conf.json",
    "tauri.measure.conf.json",
];

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is not JSON: {e}", path.display()))
}

/// Every way one capability document could grant the page something.
fn capability_violations(cap: &Value) -> Vec<String> {
    let mut out = Vec::new();
    match cap.get("permissions") {
        Some(Value::Array(list)) if list.is_empty() => {}
        other => out.push(format!(
            "permissions must be an empty list, found {other:?}"
        )),
    }
    if cap.get("remote").is_some() {
        out.push("a capability must not grant remote URLs".to_string());
    }
    match cap.get("windows") {
        Some(Value::Array(list)) if list == &[json!("main")] => {}
        other => out.push(format!(
            "windows must be exactly [\"main\"], found {other:?}"
        )),
    }
    if cap.get("webviews").is_some() {
        out.push("a capability must not name webviews".to_string());
    }
    if cap.get("local") == Some(&Value::Bool(false)) {
        out.push("local must not be turned off in favour of remote pages".to_string());
    }
    out
}

/// What a build identity's configuration must say about the page's reach into the shell.
fn config_violations(conf: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let app = conf.get("app").cloned().unwrap_or(Value::Null);
    if app.get("withGlobalTauri") != Some(&Value::Bool(false)) {
        out.push("app.withGlobalTauri must be explicitly false".to_string());
    }
    let security = app.get("security").cloned().unwrap_or(Value::Null);
    if security.get("capabilities") != Some(&json!(["main"])) {
        out.push("app.security.capabilities must be exactly [\"main\"]".to_string());
    }
    if security.get("csp").is_none_or(Value::is_null) {
        out.push("app.security.csp must be set for the shell's own pages".to_string());
    }
    for key in [
        "dangerousDisableAssetCspModification",
        "assetProtocol",
        "pattern",
    ] {
        if security.get(key).is_some() {
            out.push(format!("app.security.{key} must not be set"));
        }
    }
    if conf
        .get("plugins")
        .is_some_and(|p| p.as_object().is_none_or(|o| !o.is_empty()))
    {
        out.push("plugins must carry no configuration".to_string());
    }
    if app.get("windows") != Some(&json!([])) {
        out.push("app.windows must be empty: main.rs builds the one window".to_string());
    }
    out
}

#[test]
fn planted_permission_or_remote_grant_is_caught() {
    let clean = json!({ "identifier": "main", "windows": ["main"], "permissions": [] });
    assert!(capability_violations(&clean).is_empty());
    let planted = [
        json!({ "identifier": "main", "windows": ["main"], "permissions": ["core:default"] }),
        json!({ "identifier": "main", "windows": ["main"], "permissions": [{ "identifier": "core:path:default" }] }),
        json!({ "identifier": "main", "windows": ["main"] }),
        json!({ "identifier": "main", "windows": ["*"], "permissions": [] }),
        json!({ "identifier": "main", "windows": ["main"], "permissions": [], "remote": { "urls": ["http://127.0.0.1:*"] } }),
        json!({ "identifier": "main", "windows": ["main"], "webviews": ["main"], "permissions": [] }),
    ];
    for cap in planted {
        assert!(
            !capability_violations(&cap).is_empty(),
            "a planted grant passed: {cap}"
        );
    }
}

#[test]
fn planted_config_grant_is_caught() {
    let clean = json!({ "app": { "withGlobalTauri": false, "windows": [],
        "security": { "capabilities": ["main"], "csp": "default-src 'self'" } } });
    assert!(
        config_violations(&clean).is_empty(),
        "{:?}",
        config_violations(&clean)
    );
    let planted = [
        json!({ "app": { "withGlobalTauri": true, "windows": [], "security": { "capabilities": ["main"], "csp": "x" } } }),
        json!({ "app": { "windows": [], "security": { "capabilities": ["main"], "csp": "x" } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [], "security": { "csp": "x" } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [], "security": { "capabilities": ["main", "extra"], "csp": "x" } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [], "security": { "capabilities": ["main"], "csp": null } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [{ "label": "x" }], "security": { "capabilities": ["main"], "csp": "x" } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [],
            "security": { "capabilities": ["main"], "csp": "x", "dangerousDisableAssetCspModification": true } } }),
        json!({ "app": { "withGlobalTauri": false, "windows": [], "security": { "capabilities": ["main"], "csp": "x" } },
            "plugins": { "shell": { "open": true } } }),
    ];
    for conf in planted {
        assert!(
            !config_violations(&conf).is_empty(),
            "a planted config passed: {conf}"
        );
    }
}

#[test]
fn the_one_capability_file_grants_nothing() {
    let dir = crate_dir().join("capabilities");
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
        .filter_map(|entry| {
            entry
                .ok()
                .map(|e| e.file_name().to_string_lossy().into_owned())
        })
        .collect();
    names.sort();
    assert_eq!(
        names,
        ["main.json"],
        "the capabilities folder holds exactly main.json"
    );
    let cap = read_json(&dir.join("main.json"));
    assert_eq!(cap.get("identifier"), Some(&json!("main")));
    let found = capability_violations(&cap);
    assert!(found.is_empty(), "capabilities/main.json: {found:?}");
}

#[test]
fn every_build_identity_keeps_the_page_away_from_the_shell() {
    for name in CONF_FILES {
        let found = config_violations(&read_json(&crate_dir().join(name)));
        assert!(found.is_empty(), "{name}: {found:?}");
    }
}

#[test]
fn capabilities_resolved_at_build_time_grant_nothing() {
    // tauri-build writes this file on every build of the crate, so it describes what was compiled in.
    let path = crate_dir()
        .join("gen")
        .join("schemas")
        .join("capabilities.json");
    let resolved = read_json(&path);
    let map = resolved
        .as_object()
        .unwrap_or_else(|| panic!("{} is not an object", path.display()));
    let ids: Vec<&String> = map.keys().collect();
    assert_eq!(ids, ["main"], "exactly one resolved capability");
    let found = capability_violations(&map["main"]);
    assert!(found.is_empty(), "resolved capability: {found:?}");
}
