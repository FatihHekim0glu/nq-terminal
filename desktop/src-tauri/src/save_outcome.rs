//! How a save ended, as the page is told (bridgeVersion 2; web/src/bridge/browser.ts). The pure parts of the
//! download handler live here so that they are tested in the unit build, which cannot link the webview code of
//! writes_download.rs.
//!
//! The shell calls the page: one `nqt:save-outcome` event on its window, `detail: { uri, outcome }`, where `uri` is
//! the download's own address (the object URL of the link the page clicked) and `outcome` is `saved`, `cancelled` or
//! `failed`. The page calls nothing.

use serde_json::json;

/// The refusal text of a decision with no path: the dialog was cancelled, or a test build had no save folder.
pub const NO_PATH: &str =
    "no save path: the dialog was cancelled, or a test build had no save folder";

/// The name of the page's event for how a save ended (web/src/bridge/browser.ts `SAVE_OUTCOME_EVENT`).
pub const OUTCOME_EVENT: &str = "nqt:save-outcome";

/// The script that tells the page how the save of `uri` ended. Both values are JSON-encoded, so no address can end
/// the script early.
pub fn outcome_script(uri: &str, outcome: &str) -> String {
    let detail = json!({ "uri": uri, "outcome": outcome });
    format!("window.dispatchEvent(new CustomEvent('{OUTCOME_EVENT}', {{ detail: {detail} }}))")
}

/// What a refused decision means to the page: a cancelled dialog (or no save folder in a test build) is a cancel, any
/// other refusal (the policy, a path the engine could not take) a failure.
pub fn refusal_outcome(reason: &str) -> &'static str {
    if reason == NO_PATH {
        "cancelled"
    } else {
        "failed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_dispatches_the_pages_event_with_the_address_and_the_word() {
        let script = outcome_script("blob:http://127.0.0.1:50000/abc", "saved");
        assert!(script.starts_with("window.dispatchEvent(new CustomEvent('nqt:save-outcome'"));
        assert!(script.contains(r#""uri":"blob:http://127.0.0.1:50000/abc""#));
        assert!(script.contains(r#""outcome":"saved""#));
    }

    #[test]
    fn an_address_cannot_end_the_script_early() {
        // A quote that would close the string, a statement, and a line break: all must stay inside the JSON text.
        let hostile = "x'\"); alert(1); //\nnext";
        let script = outcome_script(hostile, "failed");
        assert!(script.contains(r#"x'\"); alert(1); //\nnext"#), "{script}");
        assert!(!script.contains('\n'), "a raw line break in {script}");
        assert_eq!(script.matches("alert(1)").count(), 1);
    }

    #[test]
    #[allow(
        clippy::disallowed_methods,
        reason = "test: reads the page's bridge source, in this repository, to pin the event name"
    )]
    fn the_event_name_is_the_one_the_page_listens_for() {
        let page = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/src/bridge/browser.ts");
        let require = std::env::var_os("NQT_REQUIRE_SEAMS").is_some_and(|v| v == "1");
        let Some(source) = page_source_or_skip(std::fs::read_to_string(&page), &page, require)
        else {
            return;
        };
        assert!(source.contains(&format!("SAVE_OUTCOME_EVENT = '{OUTCOME_EVENT}'")));
    }

    /// The page's source, or a printed skip when this copy of the crate has no `web` folder beside it; a run that
    /// must prove the seams (`NQT_REQUIRE_SEAMS=1`, set by scripts/check.ps1 in the lab's own tree) fails instead.
    fn page_source_or_skip(
        read: std::io::Result<String>,
        page: &std::path::Path,
        require: bool,
    ) -> Option<String> {
        match read {
            Ok(source) => Some(source),
            Err(why) if require => panic!(
                "NQT_REQUIRE_SEAMS=1 but {} cannot be read: {why}",
                page.display()
            ),
            Err(_) => {
                println!(
                    "SKIPPED: {} is not here (a copy of the crate)",
                    page.display()
                );
                None
            }
        }
    }

    #[test]
    #[should_panic(expected = "NQT_REQUIRE_SEAMS=1 but")]
    fn a_copy_of_the_crate_fails_when_the_seams_are_required() {
        let missing = Err(std::io::Error::from(std::io::ErrorKind::NotFound));
        page_source_or_skip(missing, std::path::Path::new("browser.ts"), true);
    }

    #[test]
    fn a_copy_of_the_crate_skips_when_the_seams_are_not_required() {
        let missing = Err(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(
            page_source_or_skip(missing, std::path::Path::new("browser.ts"), false),
            None
        );
    }

    #[test]
    fn no_path_is_a_cancel_and_any_other_refusal_a_failure() {
        assert_eq!(refusal_outcome(NO_PATH), "cancelled");
        assert_eq!(refusal_outcome("refused: inside the lab"), "failed");
        assert_eq!(refusal_outcome(""), "failed");
    }
}
