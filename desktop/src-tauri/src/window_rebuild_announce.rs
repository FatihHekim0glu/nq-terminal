//! The screen-reader announcement for each rebuild stage (WCAG 4.1.3), a part of window_rebuild.rs kept pure so the
//! hidden-window test can run the very same script.
//!
//! rebuild.html has no script (the bundled pages run under `script-src 'self'`), and each stage is a fragment-only
//! navigation, which fires no page load and moves no focus. The shell therefore runs this short script through the
//! webview's eval, which the page policy does not govern: it sets the document title to the stage heading and focuses
//! that heading (tabindex -1), so a screen reader announces the stage. It waits, bounded, for the page to be the
//! rebuild page on the stage's fragment, because the first navigation is a full load that eval can overtake.

/// The script for one stage: `fragment` is the section id (`confirm`, `running`, ...), its heading is `<id>-title`.
/// Anything but ASCII letters is dropped, so the text can never break out of the script's string.
pub fn announce_script(fragment: &str) -> String {
    let id: String = fragment.chars().filter(char::is_ascii_alphabetic).collect();
    format!(
        "(function(f){{var n=0;function go(){{\
var h=document.getElementById(f+'-title');\
if(!h||location.hash!=='#'+f||document.readyState==='loading'){{if(++n<50)setTimeout(go,100);return;}}\
document.title='nq-lab terminal: '+h.textContent;h.setAttribute('tabindex','-1');h.focus();}}go();}})('{id}')"
    )
}

#[cfg(test)]
mod tests {
    use super::announce_script;

    #[test]
    fn the_script_names_the_stage_heading_and_waits_for_the_page() {
        let script = announce_script("running");
        assert!(script.ends_with("('running')"), "{script}");
        assert!(script.contains("document.title="), "{script}");
        assert!(script.contains(".focus()"), "{script}");
        assert!(
            script.contains("++n<50"),
            "the wait must be bounded: {script}"
        );
    }

    #[test]
    fn a_hostile_fragment_cannot_break_out_of_the_string() {
        let script = announce_script("x');alert(1);('");
        assert!(script.ends_with("('xalert')"), "{script}");
        assert!(!script.contains("alert(1)"), "{script}");
    }
}
