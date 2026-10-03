//! No `show()` can run in a smoke or measure build (04 standing rule 4; 04 D4.1), checked statically for every
//! feature set. The dynamic proof (tests\hidden_window.rs) runs for smoke and for measure (the measure exe finds its
//! D: folders through NQT_MEASURE_DIR and stays on its splash until stage B's spawn path exists); this scan covers
//! every branch of `reveal()` and anything added later, with no window needed: every `.show(` in the crate's sources must sit directly under the release
//! cfg, the one that excludes both test features.
#![allow(
    clippy::disallowed_methods,
    reason = "test code reads the crate's own sources"
)]

use std::path::PathBuf;

/// The one cfg a `show()` may sit under.
const RELEASE_ONLY: &str = r#"#[cfg(not(any(feature = "smoke", feature = "measure")))]"#;

/// Line numbers (1-based) of `.show(` calls whose nearest preceding `#[cfg(` line is not the release-only cfg.
fn ungated_show_calls(source: &str) -> Vec<usize> {
    let mut gate = String::new();
    let mut found = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("#[cfg(") {
            gate = trimmed.to_string();
        }
        if trimmed.starts_with("//") {
            continue;
        }
        if trimmed.contains(".show(") && gate != RELEASE_ONLY {
            found.push(index + 1);
        }
    }
    found
}

fn source_files() -> Vec<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    files.sort();
    files
}

#[test]
fn a_show_under_the_measure_cfg_is_flagged() {
    let planted = "#[cfg(feature = \"measure\")]\nfn reveal(w: &W) {\n    let _ = w.show();\n}\n";
    assert_eq!(ungated_show_calls(planted), vec![3]);
}

#[test]
fn a_show_under_the_smoke_or_no_cfg_is_flagged() {
    let smoke = "#[cfg(feature = \"smoke\")]\nfn reveal(w: &W) { w.show(); }\n";
    assert_eq!(ungated_show_calls(smoke), vec![2]);
    assert_eq!(
        ungated_show_calls("fn reveal(w: &W) {\n    w.show();\n}\n"),
        vec![2]
    );
}

#[test]
fn a_show_under_the_release_cfg_is_allowed() {
    let release = format!("{RELEASE_ONLY}\nfn reveal(w: &W) {{\n    let _ = w.show();\n}}\n");
    assert!(ungated_show_calls(&release).is_empty());
}

#[test]
fn every_show_in_the_crate_is_release_only() {
    let mut total = 0;
    for path in source_files() {
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        total += text.matches(".show(").count();
        let bad = ungated_show_calls(&text);
        assert!(
            bad.is_empty(),
            "{} calls show() outside the release-only cfg at lines {bad:?}",
            path.display()
        );
    }
    assert!(
        total > 0,
        "the scan found no show() at all, so it checks nothing"
    );
}
