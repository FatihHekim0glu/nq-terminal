"""Reference contrast audit for the amber-classic theme (TASKS Phase 12), apart from the web app's TypeScript.

Reads `web/src/theme/tokens.css` and `web/src/theme/amberClassic.css` as text, lays the amber-classic block over
the default theme (and optionally a colour-vision block), resolves `var()` aliases and measures every pair below
with the WCAG 2.2 relative-luminance formula written out here. Text pairs need 4.5:1 (1.4.3), graphics 3:1
(1.4.11). The pair list is written independently of `src/theme/amberClassic.ts`; the test beside it checks the
real files. No statistic, no data read: a theme has no metric, so this is a two-way check (TypeScript and Python).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

THEME_DIR = Path(__file__).resolve().parents[2] / "web" / "src" / "theme"
SRC_DIR = THEME_DIR.parent
TOKENS_CSS = THEME_DIR / "tokens.css"
AMBER_CSS = THEME_DIR / "amberClassic.css"
AMBER_SELECTOR = ':root[data-theme="amber-classic"]'
TEXT_MIN = 4.5
GRAPHIC_MIN = 3.0
# Never set by the amber block: the print five are read from the live page by the evidence pack and must stay
# black on white; the regime ramp is told apart by lightness alone on the black screen this look keeps.
FIXED_TOKENS = ("print-bg", "print-fg", "print-muted", "print-rule", "print-label",
                "regime-low", "regime-mid", "regime-high")
SOURCE = "WCAG 2.2 relative luminance and contrast ratio, written out in plain Python"

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_ALIAS = re.compile(r"^var\(--([a-z0-9-]+)\)$", re.I)
_DECL = re.compile(r"--([a-z0-9-]+)\s*:\s*([^;]+);", re.I)
_CVD = re.compile(r'\[data-cvd="(deut|prot)"\]')

SURFACES = ("bg", "surface", "raised", "chrome", "th-bg", "sel-bg", "hover-row", "hover-cell", "hover-menu",
            "list-bg", "list-sel", "ac-bg", "tab-bg", "btn-grey", "field-btn", "ro-box", "band", "cfg-head",
            "stats-band", "toggle-hover", "spark-bg", "legend-bg", "minibar-bg", "cmd-bg", "tape-bg", "btn-top",
            "btn-bot")
MUTED_SURFACES = ("bg", "raised", "chrome", "th-bg", "sel-bg", "hover-row", "hover-menu", "list-bg", "ac-bg",
                  "band", "cfg-head", "stats-band", "spark-bg", "legend-bg")


def _pairs() -> list[tuple[str, str, float]]:
    out = [(fg, bg, TEXT_MIN) for fg in ("text", "data") for bg in SURFACES]
    out += [("muted", bg, TEXT_MIN) for bg in MUTED_SURFACES]
    out += [("muted-hover", "hover-cell", TEXT_MIN), ("th-fg", "th-bg", TEXT_MIN), ("tab-fg", "tab-bg", TEXT_MIN),
            ("frame-tab-fg", "frame-tab-on", TEXT_MIN), ("minibar-fg", "minibar-bg", TEXT_MIN),
            ("msg-fg", "cmd-bg", TEXT_MIN), ("field-fg", "field-bg", TEXT_MIN), ("chart-axis", "bg", TEXT_MIN)]
    out += [(fg, bg, TEXT_MIN) for fg in ("white", "fn-fg") for bg in ("fn-bar", "fn-hover", "fn-press")]
    out += [(fg, bg, TEXT_MIN) for fg in ("black", "tab-on-fg") for bg in ("tab-on", "tab-hover")]
    out += [(fg, bg, GRAPHIC_MIN) for fg in ("border-int", "list-border", "menu-border")
            for bg in ("bg", "raised", "chrome", "list-bg")]
    out += [("sb-thumb", "sb-track", GRAPHIC_MIN), ("sb-thumb", "sb-track-list", GRAPHIC_MIN),
            ("sb-arrow", "sb-track", GRAPHIC_MIN)]
    # The frame strip (black text, and a black focus ring, on the strip and on a hovered tab) and the blue
    # selected-row fills with their white text.
    out += [("frame-fg", "frame-bg", TEXT_MIN), ("frame-fg", "tab-on", TEXT_MIN), ("frame-fg", "tab-on", GRAPHIC_MIN)]
    out += [("white", bg, TEXT_MIN) for bg in ("sel-list", "list-sel", "sel-toggle")]
    return out


PAIRS: tuple[tuple[str, str, float], ...] = tuple(_pairs())


def _channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    if not _HEX.match(hex_colour):
        raise ValueError(f"not a 6-digit hex colour: {hex_colour}")
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def blocks(css: str) -> list[tuple[str, str]]:
    """Top-level (selector, body) pairs; comments dropped, nested blocks kept inside their parent's body."""
    clean = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out, depth, start, opened = [], 0, 0, 0
    for i, ch in enumerate(clean):
        if ch == "{":
            if depth == 0:
                opened = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                out.append((clean[start:opened].strip(), clean[opened + 1:i]))
                start = i + 1
    return out


def raw_tokens(tokens_css: str, amber_css: str | None, cvd: str | None = None) -> dict[str, str]:
    layers = [b for b in blocks(tokens_css) if not b[0].startswith("@") and not _CVD.search(b[0])]
    if amber_css is not None:
        layers += [b for b in blocks(amber_css) if b[0] == AMBER_SELECTOR]
    if cvd is not None:
        layers += [b for b in blocks(tokens_css) if (m := _CVD.search(b[0])) and m.group(1) == cvd]
    out: dict[str, str] = {}
    for _, body in layers:
        out.update({name: value.strip() for name, value in _DECL.findall(body)})
    return out


def resolve(raw: dict[str, str], name: str) -> str | None:
    seen: set[str] = set()
    while name in raw and name not in seen:
        seen.add(name)
        value = raw[name]
        alias = _ALIAS.match(value)
        if not alias:
            return value.upper() if _HEX.match(value) else None
        name = alias.group(1)
    return None


def audit(raw: dict[str, str], pairs=PAIRS) -> list[tuple[str, str, float, float | None]]:
    """(fg, bg, min, ratio) for every pair below its minimum or with a missing token; [] when all pass."""
    failures = []
    for fg, bg, minimum in pairs:
        a, b = resolve(raw, fg), resolve(raw, bg)
        ratio = contrast(a, b) if a and b else None
        if ratio is None or ratio < minimum:
            failures.append((fg, bg, minimum, ratio))
    return failures


def audit_files(cvd: str | None = None) -> list[tuple[str, str, float, float | None]]:
    tokens_css = TOKENS_CSS.read_text(encoding="utf-8")
    amber_css = AMBER_CSS.read_text(encoding="utf-8")
    return audit(raw_tokens(tokens_css, amber_css, cvd))


# ---- the pairs the stylesheets write (independent of src/theme/cssPairs.ts) ----

_TOKEN_REF = re.compile(r"^var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)$", re.I)
_INACTIVE = re.compile(r"\[aria-disabled(?:=[\"']?true[\"']?)?\]|:disabled", re.I)
_SKIPPED_AT = re.compile(r"^@(?:-webkit-)?(?:keyframes|font-face|page|property)(?![a-z-])", re.I)


@dataclass(frozen=True)
class StylePair:
    fg: str
    bg: str
    min: float
    selector: str
    source: str
    inactive: bool


@dataclass(frozen=True)
class StyleScan:
    files: tuple[Path, ...]
    pairs: tuple[StylePair, ...]


def _rules(css: str):
    """(selector, body) of every style rule; the contents of @media and @supports are read as if written flat."""
    clean = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    stack: list[tuple[str, int]] = []
    last = 0
    for m in re.finditer(r"[{}]", clean):
        if m.group() == "{":
            stack.append((clean[last:m.start()].strip(), m.end()))
            last = m.end()
        else:
            selector, begin = stack.pop()
            last = m.end()
            if selector.startswith("@"):
                continue
            skipped = any(_SKIPPED_AT.match(outer) for outer, _ in stack)
            if not skipped:
                yield selector, clean[begin:m.start()]


def _token(value: str | None) -> str | None:
    m = _TOKEN_REF.match(value.strip()) if value else None
    return m.group(1).lower() if m else None


def stylesheet_pairs(css: str, source: str = "") -> list[StylePair]:
    """Every rule that sets a text colour and a fill, both as plain var(--token) references."""
    out = []
    for selector, body in _rules(css):
        decls = {}
        for part in body.split(";"):
            if ":" in part:
                name, value = part.split(":", 1)
                decls[name.strip().lower()] = re.sub(r"\s*!important\s*$", "", value.strip(), flags=re.I)
        fg, bg = _token(decls.get("color")), _token(decls.get("background-color")) or _token(decls.get("background"))
        if fg and bg:
            out.append(StylePair(fg, bg, TEXT_MIN, selector, source, bool(_INACTIVE.search(selector))))
    return out


def scan_stylesheets() -> StyleScan:
    """Every .css under web/src except the two token sheets, read as text."""
    files = tuple(sorted(f for f in SRC_DIR.rglob("*.css") if f.name not in ("tokens.css", "amberClassic.css")))
    pairs = [p for f in files for p in stylesheet_pairs(f.read_text(encoding="utf-8"), f.relative_to(SRC_DIR).as_posix())]
    return StyleScan(files, tuple(pairs))


def audit_looks(look: str, cvd: str | None = None) -> list[tuple[str, str, float, float | None]]:
    """Failures of the hand pairs and of every active stylesheet pair, for one look and one colour scheme."""
    tokens_css = TOKENS_CSS.read_text(encoding="utf-8")
    amber_css = AMBER_CSS.read_text(encoding="utf-8") if look == "amber-classic" else None
    raw = raw_tokens(tokens_css, amber_css, cvd)
    scanned = sorted({(p.fg, p.bg, p.min) for p in scan_stylesheets().pairs if not p.inactive})
    failures = audit(raw, scanned)
    if amber_css is not None:
        failures += audit(raw, PAIRS)
    return failures
