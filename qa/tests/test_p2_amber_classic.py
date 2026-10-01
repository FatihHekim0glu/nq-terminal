"""Tests for the amber-classic contrast reference (TASKS Phase 12): hand values, the real files, born-failing cases."""
from __future__ import annotations

import re

import pytest

from crosscheck.p2_amber_classic import (
    AMBER_CSS,
    PAIRS,
    TOKENS_CSS,
    audit,
    audit_files,
    contrast,
    blocks,
    luminance,
    raw_tokens,
    resolve,
)


def test_wcag_formula_by_hand():
    assert contrast("#000000", "#FFFFFF") == pytest.approx(21.0, rel=1e-12)
    assert contrast("#777777", "#FFFFFF") == pytest.approx(4.48, abs=0.005)  # the WCAG understanding example
    assert contrast("#FFA028", "#000000") == pytest.approx(10.31, abs=0.005)
    assert luminance("#000000") == 0.0
    with pytest.raises(ValueError):
        luminance("#FFF")


def test_amber_block_overrides_the_default_and_leaves_the_rest():
    raw = raw_tokens(TOKENS_CSS.read_text(encoding="utf-8"), AMBER_CSS.read_text(encoding="utf-8"))
    assert resolve(raw, "text") == "#FFC266"
    assert resolve(raw, "fn-bar") == "#7A4A00"
    assert resolve(raw, "data") == "#FFA028"
    assert resolve(raw, "field-fg") == "#000000"
    assert resolve(raw, "accent") == "#148EFF"  # an alias followed to the command-line blue


def test_the_real_files_pass_every_pair_alone_and_with_each_cvd_theme():
    assert len(PAIRS) > 80
    assert audit_files() == []
    assert audit_files("deut") == []
    assert audit_files("prot") == []


def test_agrees_with_the_typescript_key_ratios():
    raw = raw_tokens(TOKENS_CSS.read_text(encoding="utf-8"), AMBER_CSS.read_text(encoding="utf-8"))
    ratio = lambda fg, bg: contrast(resolve(raw, fg), resolve(raw, bg))  # noqa: E731
    assert ratio("text", "hover-cell") == pytest.approx(6.91, abs=0.005)
    assert ratio("muted", "hover-menu") == pytest.approx(5.27, abs=0.005)
    assert ratio("white", "fn-bar") == pytest.approx(7.48, abs=0.005)
    assert ratio("border-int", "raised") == pytest.approx(4.48, abs=0.005)
    assert ratio("sb-thumb", "sb-track") == pytest.approx(3.38, abs=0.005)


def _broken(name: str, value: str) -> dict[str, str]:
    amber = AMBER_CSS.read_text(encoding="utf-8")
    assert f"--{name}:" in amber
    amber = re.sub(rf"(--{name}\s*:\s*)#[0-9A-Fa-f]{{6}}", rf"\g<1>{value}", amber, count=1)
    return raw_tokens(TOKENS_CSS.read_text(encoding="utf-8"), amber)


def test_born_failing_bright_amber_function_bar():
    failures = audit(_broken("fn-bar", "#FFA028"))
    assert ("white", "fn-bar") in [(f[0], f[1]) for f in failures]


def test_born_failing_dark_number_text_and_thin_scrollbar():
    assert ("text", "hover-cell") in [(f[0], f[1]) for f in audit(_broken("text", "#C88C40"))]
    assert ("sb-thumb", "sb-track") in [(f[0], f[1]) for f in audit(_broken("sb-thumb", "#5A3A10"))]


def test_a_missing_token_is_a_failure_not_a_skip():
    raw = raw_tokens(TOKENS_CSS.read_text(encoding="utf-8"), AMBER_CSS.read_text(encoding="utf-8"))
    del raw["tab-bg"]
    assert ("text", "tab-bg", 4.5, None) in audit(raw)


# ---- the look-wide checks: the pairs the stylesheets write, the fixed tokens, both looks ----

from crosscheck.p2_amber_classic import (  # noqa: E402
    FIXED_TOKENS,
    SRC_DIR,
    audit_looks,
    scan_stylesheets,
    stylesheet_pairs,
)


def test_the_scan_finds_the_sheets_and_a_real_set_of_pairs():
    scan = scan_stylesheets()
    assert len(scan.files) > 40
    assert len({(p.fg, p.bg) for p in scan.pairs}) > 40
    names = {(p.fg, p.bg) for p in scan.pairs}
    for pair in [("fn-fg", "fn-bar"), ("tab-fg", "tab-bg"), ("tab-on-fg", "tab-on"), ("frame-tab-fg", "frame-tab-on")]:
        assert pair in names
    assert "chrome/FunctionBar.css" in {f.relative_to(SRC_DIR).as_posix() for f in scan.files}


def test_the_scan_skips_comments_keyframes_and_flags_disabled_controls():
    css = (
        "/* .x { color: var(--a); background: var(--b); } */\n"
        "@keyframes k { from { color: var(--text); background: var(--bg); } }\n"
        "@media (max-width: 700px) { .m { color: var(--white); background: var(--fn-bar); } }\n"
        '.d[aria-disabled="true"] { color: var(--fn-off); background: var(--fn-bar); }\n'
        ".c { color: var(--text, #fff) !important; background-color: var(--bg); }\n"
        ".n { color: #fff; background: var(--bg); }\n"
    )
    pairs = stylesheet_pairs(css)
    assert [(p.fg, p.bg, p.inactive) for p in pairs] == [
        ("white", "fn-bar", False),
        ("fn-off", "fn-bar", True),
        ("text", "bg", False),
    ]


def test_every_stylesheet_pair_passes_in_both_looks_and_with_each_scheme():
    for cvd in (None, "deut", "prot"):
        for look in ("standard", "amber-classic"):
            assert audit_looks(look, cvd) == [], f"{look} {cvd}"


def test_disabled_controls_are_listed_apart_and_no_worse_in_amber_classic():
    scan = scan_stylesheets()
    inactive = {(p.fg, p.bg) for p in scan.pairs if p.inactive}
    assert inactive == {("field-fg", "field-off"), ("fn-off", "fn-bar"), ("muted", "bg")}
    tokens = TOKENS_CSS.read_text(encoding="utf-8")
    standard = raw_tokens(tokens, None)
    amber = raw_tokens(tokens, AMBER_CSS.read_text(encoding="utf-8"))
    for fg, bg in inactive:
        before = contrast(resolve(standard, fg), resolve(standard, bg))
        after = contrast(resolve(amber, fg), resolve(amber, bg))
        assert after >= min(before, 4.5), (fg, bg)


def test_the_print_palette_and_the_regime_ramp_are_untouched_by_the_amber_block():
    assert set(FIXED_TOKENS) >= {"print-bg", "print-fg", "print-muted", "print-rule", "print-label",
                                 "regime-low", "regime-mid", "regime-high"}
    tokens = TOKENS_CSS.read_text(encoding="utf-8")
    base = raw_tokens(tokens, None)
    amber = raw_tokens(tokens, AMBER_CSS.read_text(encoding="utf-8"))
    for name in FIXED_TOKENS:
        assert name in base
        assert amber[name] == base[name], name
    declared = {name for _, body in blocks(AMBER_CSS.read_text(encoding="utf-8")) for name, _ in _decls(body)}
    assert declared.isdisjoint(FIXED_TOKENS)


def _decls(body: str):
    return re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", body, flags=re.I)


def test_born_failing_a_dark_header_colour_and_a_planted_failing_rule():
    assert ("th-fg", "th-bg") in [(f[0], f[1]) for f in audit(_broken("th-fg", "#7A4A00"), stylesheet_pairs_from_files())]
    planted = stylesheet_pairs(".new { color: var(--muted); background: var(--print-bg); }")
    raw = raw_tokens(TOKENS_CSS.read_text(encoding="utf-8"), AMBER_CSS.read_text(encoding="utf-8"))
    assert audit(raw, [(p.fg, p.bg, p.min) for p in planted]) != []


def stylesheet_pairs_from_files():
    return [(p.fg, p.bg, p.min) for p in scan_stylesheets().pairs if not p.inactive]


def test_the_new_hand_pairs_are_in_the_list():
    for pair in [("frame-fg", "frame-bg", 4.5), ("frame-fg", "tab-on", 4.5), ("frame-fg", "tab-on", 3.0),
                 ("white", "sel-list", 4.5), ("white", "list-sel", 4.5), ("white", "sel-toggle", 4.5)]:
        assert pair in PAIRS, pair
