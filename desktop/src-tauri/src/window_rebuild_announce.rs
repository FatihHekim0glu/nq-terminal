//! The screen-reader announcement for each rebuild stage and each stopped reason (WCAG 4.1.3), a part of
//! window_rebuild.rs and supervise_shell.rs kept pure so the hidden-window tests can run the very same script.
//!
//! rebuild.html and stopped.html have no script (the bundled pages run under `script-src 'self'`), and each stage or
//! reason is a fragment-only navigation, which fires no page load and moves no focus. The shell therefore runs this
//! short script through the webview's eval, which the page policy does not govern: it sets the document title to the
//! section's heading and focuses that heading (tabindex -1), so a screen reader announces it. It waits, bounded, for
//! the page to be on the fragment, because the first navigation is a full load that eval can overtake, and the stopped
//! page's shell then evaluates the again-script a few more times, because a full load also kills that wait.

/// The script for one section: `fragment` is the section id (`confirm`, `exited`, `lock-held`, ...). The rebuild page
/// names the heading `<id>-title`, the stopped page `<id>-text` (its reason line); the script takes whichever exists.
/// Anything but ASCII letters and hyphens is dropped, so the text can never break out of the script's string.
pub fn announce_script(fragment: &str) -> String {
    build(fragment, WAIT_POLLS, false)
}

/// The same announcement, for the shell to evaluate again after the first one: the first can run in the outgoing
/// document (a full load) and its wait dies with that document. It does not wait itself (the shell repeats it), and
/// it changes nothing unless the document is fresh (focus on the body), so a page that was already announced, or a
/// reader who has moved on to a link, is left alone.
#[allow(
    dead_code,
    reason = "only the shell's stopped page repeats it; the rebuild window and the page tests share this file"
)]
pub fn announce_again_script(fragment: &str) -> String {
    build(fragment, 1, true)
}

/// How many times the first script looks, 100 ms apart, for the page to be on the fragment.
const WAIT_POLLS: u32 = 50;

/// The title is built from the heading's own text nodes only: an exit code the shell writes into the same line (a
/// span after the text) must not end up in the title, and a repeat can run after it was written. The title is set
/// only when it differs and the focus moved only when the element does not hold it, so a repeat is harmless.
fn build(fragment: &str, polls: u32, only_fresh: bool) -> String {
    let id: String = fragment
        .chars()
        .filter(|c| c.is_ascii_alphabetic() || *c == '-')
        .collect();
    let fresh = if only_fresh {
        "var a=document.activeElement;if(a&&a!==document.body&&a!==document.documentElement)return;"
    } else {
        ""
    };
    format!(
        "(function(f){{var n=0;function go(){{\
var h=document.getElementById(f+'-title')||document.getElementById(f+'-text');\
if(!h||location.hash!=='#'+f||document.readyState==='loading'){{if(++n<{polls})setTimeout(go,100);return;}}\
{fresh}var t='';for(var c=h.firstChild;c;c=c.nextSibling){{if(c.nodeType===3)t+=c.textContent;}}\
t='nq-lab terminal: '+t;if(document.title!==t)document.title=t;\
h.setAttribute('tabindex','-1');if(document.activeElement!==h)h.focus();}}go();}})('{id}')"
    )
}

#[cfg(test)]
mod tests {
    use super::{announce_again_script, announce_script};

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
    fn a_hyphenated_reason_keeps_its_hyphen_and_may_name_a_reason_line() {
        let script = announce_script("lock-held");
        assert!(script.ends_with("('lock-held')"), "{script}");
        assert!(script.contains("f+'-text'"), "{script}");
    }

    #[test]
    fn the_again_script_neither_waits_nor_touches_a_page_that_moved_on() {
        let script = announce_again_script("exited");
        assert!(script.ends_with("('exited')"), "{script}");
        assert!(
            script.contains("++n<1)"),
            "the shell repeats it, it does not poll: {script}"
        );
        assert!(script.contains("a!==document.body"), "{script}");
        assert!(!announce_script("exited").contains("a!==document.body"));
    }

    #[test]
    fn the_title_is_built_from_the_heading_text_nodes_and_a_repeat_changes_nothing() {
        let script = announce_script("exited");
        assert!(script.contains("c.nodeType===3"), "{script}");
        assert!(!script.contains("h.textContent"), "{script}");
        assert!(script.contains("if(document.title!==t)"), "{script}");
        assert!(
            script.contains("if(document.activeElement!==h)h.focus()"),
            "{script}"
        );
    }

    #[test]
    fn a_hostile_fragment_cannot_break_out_of_the_string() {
        let script = announce_script("x');alert(1);('");
        assert!(script.ends_with("('xalert')"), "{script}");
        assert!(!script.contains("alert(1)"), "{script}");
    }
}
