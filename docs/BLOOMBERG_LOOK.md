# nq-lab terminal: Bloomberg look and behaviour

Status: build spec, 2026-09-26. It replaces the research draft of the same date. It is built from seven research dimensions (palette; typography; chrome; keyboard; charts; screens; clones and legal), each checked by an adversarial second pass, plus four gap studies (interaction states, window frame stack, tear-sheet templates, single-source tokens) and one critic review. Rules come only from findings marked confirmed or corrected, or from gap studies with pixel evidence. Anything else is either labelled `[house]` (our choice, with the reason given) or listed in section 9 ("best guess"). Contrast ratios use the WCAG 2.x relative-luminance formula; the scripts are `SCR\synth\cr.py` and `SCR\final\cr2.py` to `cr4.py`.

Reference root, used for every image path below: `<nq-lab>\design_refs\bbg\` (written `SCR\` from here on), a local folder outside this repository. Nothing in `SCR\` is ever committed.

**Evidence tags.** Every value carries one of these:

- `[off]` official: Bloomberg's own page, PDF text or guide.
- `[px]` pixel-sampled from a named image. In the token tables, a source written as `finding-id (confirmed)` or `finding-id (corrected)` is pixel-sampled unless the row says otherwise; the id points at the research finding and the word is the second-pass verdict.
- `[sec]` secondary: a university guide, a third-party video, public code.
- `[inf]` inferred from other evidence.
- `[house]` our own choice, not a Bloomberg value. Each one states why.

**Which Terminal we copy.** The flat-black build of about 2018 to 2021:

- black function body `#000000`
- flat red function bar `#870F1E`
- amber fields `#FFA028`
- `#232323` table headers with a `#505050` top rule
- `#9E9E9E` / `#464646` trapezoid tabs
- `#148EFF` command-line border
- light grey `#CDCDCD` window frame strip

The primary pixel reference is Bloomberg's Dec 2020 Market Data Manual screenshot (`SCR\verify-chrome\mdm\p29_1_755x647.png`, lossless, 100% scale). The primary chart references are the March 2021 "Charts of the Month" PDF screenshots (`SCR\verify-charts\cotm_p4_0.png`, `cotm_p5_0.png`, `cotm_p6_0.png`) and the May 2021 issue (`SCR\single-source-tokens\may21\m_p6_0.png`). The 2011 navy Launchpad, the glossy 2014 skin and the 2025 redesign (black tab strip, muted chips) are **not** targets. Where two official builds disagree, the spec names the value it picked and why.

---

## 1. What we copy and what we do not

### 1.1 We copy (functional or unprotectable)

- **Colour.** The palette in section 2: amber on black, neutral greys, red function bar, blue command line, up/down semantics, the two CVD schemes. Hex values are facts. Amber is claimed as a trade mark only inside the BI logo (US Reg. 6456886), never on its own `[off]`.
- **Grammar.** Mnemonics and command syntax: `<context> [SECTOR] FUNCTION <GO>`, Number `<GO>`, MENU/CANCEL/HELP behaviour, `{... <GO>}` links. These are methods of operation: *Lotus v Borland* (1st Cir. 1995), *SAS v WPL* (C-406/10), and *Navitaire v easyJet* [2004] EWHC 1725 (Ch) on command names and syntax.
- **Generic layout.** Panel arrangements, numbered menus, tab strips, a dense 20px grid, zero radius, the order of the chrome rows.

### 1.2 We do not copy

- **The name or marks.** No "Bloomberg", "BBG", "Bloomberg Terminal", "Bloomberg Professional", "Launchpad", "BLP", no Bloomberg logo and no "B" mark anywhere in the UI. That covers the title, favicon, HELP text, status bar, package name, repo name and CSS class names. BLOOMBERG TERMINAL is US Reg. 2964028 `[off]`; Bloomberg's trademark notice (`data.bloomberglp.com/professional/sites/10/Trademark-Notice.pdf`) lists the others. The product name stays **nq-lab terminal**. The panel title shows `1-HOME`, never `1-BLOOMBERG`.
- **Fonts.** Bloomberg Prop Unicode and Bloomberg Fixed Unicode (Matthew Carter designs) are proprietary. Do not download, extract, vendor, subset, `@font-face`, or name them in any `font-family` stack. Naming them would also trip the name grep in section 8.
- **Screenshots, icons, help or manual text.** Research images stay in `SCR\` and are never committed, including e2e baselines. Icons are redrawn from generic glyphs (`≡ ★ ⧉ ? ✎ ⌄`), never traced. HELP text is our own; nothing is pasted from Bloomberg PDFs.
- **A pixel copy of one specific Bloomberg screen's graphic design.** UK and EU law can protect an original GUI as a work (*BSA v Ministry of Culture*, C-393/09; the GUI-screen holding in *Navitaire*). Each screen is rebuilt from tokens, the grammar and generic arrangement. We do not trace a PORT or GP screen's decorative layout element for element.
- **Implied affiliation.** No "replica", "clone of" or similar wording. If the repo or any screenshot is ever made public, add to the README and HELP: "Not affiliated with or endorsed by Bloomberg L.P.; Bloomberg and Bloomberg Terminal are trademarks of Bloomberg Finance L.P." Not needed while the tool is private. (General information, not legal advice.)
- **Proprietary dependencies.** Never install `dockview-enterprise`; only `dockview`, `dockview-core` and `dockview-react` are MIT.
- **Code from non-permissive projects.** FinceptTerminal and OpenBB are AGPL, Neuberg is BSL, and feremabraz and similar repos carry no licence. Reading hex values from them is fine. Code or CSS may be copied only from MIT or OFL sources (jx22/berg, bloomberg_free, alpha-stack, dchest/bergoom), keeping their notices.

### 1.3 Spec text that changes as a result

- **UI_SPEC section 1, principle 1** becomes: "Amber identifiers and labels on black, light-grey numbers; up and down are the only semantic hues; blue for the command line, the focus ring and the selection." In the real Terminal, names and labels are amber, as are times and headlines, and most numbers are `#D7D7D7`.
- **UI_SPEC section 2** (frame diagram): replaced by section 4.1 of this document.
- **UI_SPEC section 3** (tokens and type): replaced by sections 2 and 3.
- **UI_SPEC section 5, Keys**: F-key plan replaced by section 5.2. The Tab rule **stays** (see 5.2).
- **UI_SPEC section 9**: the "2px lime focus ring" becomes a 2px white `--focus` ring; the 24px row default is decision D1.
- **UI_SPEC section 10**: uppercase is used for mnemonics, tags, tickers, source codes and autocomplete group headings. Drop the `.eyebrow` uppercase labels.

---

## 2. Colour tokens

Backgrounds used for ratios: `bg #000000`, `raised #1E1E1E`, `chrome #191919`, `th #232323`, `sel #0C2B4A`, `hover-cell #3C3C3C`. "Graphic" means a WCAG 1.4.11 (3:1) check, not a text check. **Bold** marks a value that differs from Bloomberg's because Bloomberg's fails AA.

### 2.1 Existing tokens (tokens.css and UI_SPEC section 3)

| Token | Old | New | Use | Source (verdict) | Contrast |
|---|---|---|---|---|---|
| `--bg` | `#070A0E` | `#000000` | page, function body, chart plot | palette-bg, chrome-17 (confirmed; Dec 2020 PNG body `#000000`) | n/a |
| `--surface` | `#0F1318` | `#000000` | panel body. Function bodies are black; greys are for panes only | chrome-17 (confirmed) | n/a |
| `--raised` | `#171C22` | `#1E1E1E` | side panes, dropdowns, autocomplete sheet, left rails, control rows, list menus | palette-panel-bg (corrected: `#1E1E1E` confirmed); gap IS-06 (`#1E1E1E` in BT and TSIG lists) | n/a |
| `--text` | `#EFF2F5` | `#D7D7D7` | numbers, body text, header labels, toolbar text | screens_b-04 (corrected: numbers `#D7D7D7`/`#D8D8D8`), palette-white | 14.59 bg, 11.58 raised, 12.22 chrome, 10.92 th, 9.99 sel, 7.66 hover-cell |
| `--data` | `#FFB000` | `#FFA028` | **role change**: security names, row labels, dates, times, headlines, menu titles, DES prose, field fill | palette-amber, charts-amber-official (confirmed; official swatch "Bloomberg Default" `#FFA028` `[off]`) | 10.31 bg, 8.19 raised, 8.63 chrome, 7.72 th, 7.06 sel, 5.42 hover-cell |
| `--muted` | `#8D9399` | `#A5A5A5` | `N)` hot-link numbers, secondary text, descriptions, hints | palette-muted (corrected: prefix `#A5A5A5`, Tour PDF PNG) | 8.53 bg, 6.77 raised, 7.14 chrome, 6.38 th, 5.84 sel. Fails on `#3C3C3C` (4.48): see 4.12. Never on the red bar (4.03) |
| `--accent` | `#94D53C` lime | `#148EFF` (alias of `--cmd-border`) | kept only so ported components compile. Focus moves to `--focus`, selection to `--sel-*` | palette-cmdline, chrome-03 (corrected: Dec 2020 border `#148EFF`) | graphic: 6.34 bg, 5.04 raised, 5.31 chrome |
| `--accent-2` | `#E8AA4E` | `#F06000` | benchmark or second series | charts-series-palette (corrected: GP compare swatch `#F06000`, 2018 CBS PNG) | graphic 6.38 bg; as text 6.38 bg, 5.06 raised |
| `--c-up` | `#23C987` | `#51EE6C` | positive text | palette-up-down-text (confirmed) | 13.80 bg, 10.95 raised, 10.33 th, 9.45 sel, 7.25 hover-cell |
| `--c-down` | `#FF5C5C` | **`#FF2C4A`** on `--bg`, `--raised` and `--chrome` only; see `--c-down-raised` | negative text | single-source-tokens `exc` (corrected: exact `#FF2C4A` in the lossless May 2021 GP header, 487 px, and in LUISS 2018 WEI, 1,181 px). Replaces the draft `#FF1E3E` (2017 Launchpad PNG) because `#FF2C4A` is the 2018 to 2021 value | 5.71 bg, 4.53 raised, 4.78 chrome. Fails 4.27 th, 3.91 sel, 3.54 hover-cell |
| `--c-down-raised` (new) | | **`#FF5566`** | negative text on `th`, the selected row and the ECO day band | nearest passing value to `#FF2C4A` `[inf]` | 6.74 bg, 5.35 raised, 5.05 th, 4.62 sel |
| `--c-down-hover` (new) | | **`#FF8A94`** | negative text inside a hovered cell (`#3C3C3C`) | nearest passing value `[inf]` | 4.89 hover-cell, 6.38 sel |
| `--cvd-up` | `#4DA3FF` | **`#3399FF`** | up in `data-cvd` themes | Bloomberg swatch `#0089E9` (cvd-design-swatches, confirmed `[off]`) fails 4.31 th and 3.94 sel; `#3399FF` is the nearest pass | 7.14 bg, 5.67 raised, 5.34 th, 4.89 sel |
| `--border` | `oklch(1 0 0 / 9%)` | `#343434` | decorative rules (optional table frame, panel dividers) | palette-grid-lines (corrected: bevel outer `#343434`) | decorative 1.69, exempt |
| `--border-int` | `#646C77` | **`#8C8C8C`** | boundary of grey buttons and controls (1.4.11) | Bloomberg's grey button `#404040` to `#484848` fails on black; `#8C8C8C` is the clones-18 fix `[inf]` | 6.25 bg, 4.96 raised, 5.23 chrome |
| `--sel-bg` | `#2A1F00` | `#0C2B4A` | selected grid row, selected HELP TOC item | single-source-tokens `sel-bg` (confirmed in three captures: LUISS 2018, Indices PDF 2020, FI Indices 2021) | white 14.38, `--text` 9.99, amber 7.06 |
| `--fence` | `#FFB000` dashed | `#FFA028`, 1px dashed | 2022-01-01 line, "IS / 2022+ SPENT" label | amber confirmed; the dashed treatment is `[house]` (no Bloomberg equivalent) | 10.31 bg |
| `--sec-equity` | `#6CB6FF` | keep | sector swatch | `[house]` original spec | 9.77 bg, 7.76 raised |
| `--sec-rates` | `#B39DFF` | keep | " | `[house]` | 9.18 / 7.29 |
| `--sec-fx` | `#38C7E8` | keep | " | `[house]` | 10.50 / 8.34 |
| `--sec-energy` | `#FF8A3D` | keep | " | `[house]` | 8.95 / 7.11 |
| `--sec-metals` | `#E0C060` | keep | " | `[house]` | 11.88 / 9.43 |
| `--sec-grains` | `#9CCC65` | keep | " | `[house]` | 11.24 / 8.92 |
| `--sec-livestock` | `#F48FB1` | keep | " | `[house]` | 9.41 / 7.47 |
| `--sec-benchmark` | `#8D9399` | keep | " | `[house]` | 6.77 / 5.37 |
| `--link-a/b/c` | `#94D53C` / `#D7B8FF` / `#8FE3E0` | see 9.1 (best guess) | link-group chips | unverifiable | |
| `--font-display` | Space Grotesk | **removed** (KPIs use `--font-sans` larger) | | typography-size-hierarchy (corrected) | |
| `--font-sans` | Inter | `"Bergoom", "Source Sans 3", system-ui, sans-serif` | all UI and data | section 3 | |
| `--font-mono` | JetBrains Mono | `"PT Mono", ui-monospace, monospace` | fixed-grid content only | section 3 | |
| `--r-sm/--r-md/--r-lg` | 4 / 6 / 10px | `0` | everything square | screens_b-31 (corrected: radius 0) | |
| `--cmd-h` | 28px | replaced by `--cmd-zone-h 50px` with a `--cmd-box-h 22px` box | section 4.2 | chrome gap wfs-02d (Dec 2020 native: 6 gap + 22 box + 21 message + 1) | |
| `--status-h` | 22px | 22px | section 4.10 | `[house]`: Bloomberg's Information Panel is 43px (wfs-03); see D7 | |
| `--panel-head-h` | 28px | replaced by `--ptitle-h 18px` + `--fn-h 21px` | section 4.3 | | |

### 2.2 New tokens

**Window chrome**

| Token | Value | Use | Source | Contrast |
|---|---|---|---|---|
| `--white` | `#FFFFFF` | emphasis: totals, KPI values, headings, mnemonics in menus, bar text | palette-white (confirmed) | 21.00 bg, 16.67 raised |
| `--chrome` | `#191919` | key toolbar, nav toolbar, status line, footers, active layout tab | palette-toolbar-bg (confirmed); wfs-02c `[px]` Dec 2020 PNG | `--text` 12.22, amber 8.63, `#D9DAD9` 12.54 |
| `--chrome-rule` | `#0A0A0A`, 1px | line under the nav toolbar | wfs-02c `[px]` MDM p29 y52 | decorative |
| `--chrome-div` | `#646464`, 1px x 13px | vertical dividers in the nav toolbar | wfs-02c `[px]` | decorative |
| `--frame-bg` / `--frame-fg` | `#CDCDCD` / `#000000` | window frame strip and panel title bars | chrome-09 (corrected), wfs-02a `[px]` MDM p29 y0-30 | 13.21 |
| `--frame-tab-on` / `--frame-tab-fg` | `#191919` / `#D9DAD9` | active layout tab in the frame strip, merging into the key toolbar | wfs-02f `[px]` CVD-8 frame 0 (GIF) and PORT 2024 video | 12.54 |
| `--frame-tab-edge` | `#434343`, 1px | right edge of the active tab | wfs-02f `[px]` CVD-8 | decorative |
| `--fn-bar` / `--fn-fg` | `#870F1E` / `#FFFFFF` | red function bar | palette-red-title-bar (confirmed) | 9.92 |
| `--fn-hover` | `#BB152E` | red-bar button hover; hovered row in red dropdown menus | single-source-tokens `hover-row` `[px]` lossless May 2021 p6 (`#BB152E`); IS-04/IS-05 videos agree (`#B9132F`, `#BB142D`) | white 6.44 |
| `--fn-press` | `#770C1A` | red-bar button pressed or menu open | IS-05 `[px]` TSIG video (about 0.87 x rest, three clips agree on the ratio) | white 11.34 |
| `--fn-div` | `#000000`, 2px | divider between red-bar buttons | charts-function-bar (corrected: dark dividers, 2021 PDF) | decorative |
| `--fn-edge` | `#1E0306`, 1px | bottom edge of the red bar | chrome-05 (corrected; no lighter top line) | decorative |
| `--fn-off` | `#4A0A12` text | disabled red-bar button label | IS-05 `[px]` "dark red text on the red bar"; exact hex `[inf]` | decorative only; disabled controls are exempt from 1.4.3 |

**Command line**

| Token | Value | Use | Source | Contrast |
|---|---|---|---|---|
| `--cmd-bg` | `#000000` | command box | chrome-03 (corrected) | |
| `--cmd-border` | `#148EFF`, 1px | command box border when the command line has focus | chrome-03, single-source-tokens `cmdline-blue` (confirmed: MDM Dec 2020 and Tour PNG; LUISS 2018 `#0B51A8` is a resampling artefact of the same line) | graphic 6.34 bg, 5.31 chrome |
| `--cmd-border-idle` | `#163A6B` | box border when focus is in a panel | IS-03 `[px]` PORT video; wfs-02g `#143B6D` | decorative (state cue, not the focus indicator) |
| `--cmd-caret` | `#2B8EFF` | solid right-pointing triangle at the left of the box | single-source-tokens `cmdline-blue` `[px]` MDM p29 | graphic 6.3 |
| `--cmd-caret-idle` | `#003E9A` | triangle when unfocused | IS-03 `[px]` video | decorative |
| `--cmd-cursor` | `#328EFD` | block cursor, bright phase | palette-cmdline (corrected, Tour PNG, lossless) | graphic 6.42 |
| `--cmd-cursor-dim` | `#00307D` | block cursor, dim phase | single-source-tokens `cmdline-blue` `[px]` MDM p29 (a still caught in the dim phase) | blink phase only |
| `--caret-phase` | `1000ms` | each blink phase; hard cut, never fully off | IS-01 `[px]` two native captures at 60 and 12 fps. A Bloomberg Pro Tip clip gives about 550 ms; see 9.10 | |
| `--ac-bg` | `#1E1E1E` | autocomplete sheet | chrome-04 (confirmed) | |
| `--msg-fg` | `#FFFFFF` | message line text | screens_b-06 (corrected) | 21 |

**Fields, lists, buttons**

| Token | Value | Use | Source | Contrast |
|---|---|---|---|---|
| `--field-bg` / `--field-fg` | `#FFA028` / `#000000` | editable fields, amber filter row | palette-input-field (confirmed) | 10.31 |
| `--field-btn` | `#3F3F3F` with a `#D7D7D7` ▾ | dropdown button beside a field; calendar and stepper buttons | single-source-tokens `field-btn` (corrected: `#3F3F3F` in LUISS 2018 and May 2021; `#484848` was the inactive tab blurred) | ▾ glyph 7.3 on it |
| `--field-off` | `#A69785`, black text | disabled field | screens_b-13 (confirmed on the 2026 optimisation PNG) | 7.39 |
| `--field-focus` | `#3F85D2`, 1px, offset 1px | keyboard focus on an amber field | IS-14 `[px]` PORT video `#2668B2` to `#3F85D2` | graphic 5.50 bg, 4.36 raised |
| `--list-bg` | `#1E1E1E` | amber-field dropdown list | IS-06 `[px]` BT and TSIG videos | |
| `--list-border` | `#B8B8B8`, 1px | dropdown list edge | IS-06 `[px]` (`#B2B2B2` to `#CBCBCB`) | graphic 8.40 on raised |
| `--list-sel` | `#0F3A66` | current item in an amber-field list | IS-06 `[px]` (`#0F3A66` BT, `#123A68` TSIG) | amber 5.67, white 11.55 |
| `--th-bg` / `--th-fg` | `#232323` / `#D7D7D7` | table header row | palette-table-header (confirmed) | 10.92 |
| `--th-rule` | `#505050`, 1px, top of header, table frame, body column rules | header top rule; header cells are split by a 1px black gap instead | single-source-tokens `th-rule` (confirmed, 2020 lossless and 2021) | decorative |
| `--tab-bg` / `--tab-fg` | `#464646` / `#D7D7D7` | inactive tab | palette-tabs (corrected) | 6.56 |
| `--tab-on` / `--tab-on-fg` | `#9E9E9E` / `#000000` | active tab, sub-tab strip | palette-tabs (confirmed) | 7.84 |
| `--tab-hover` | `#CCCCCC` | hovered tab on a grey strip | IS-08 `[px]` PORT video | black 13.08 |
| `--sel-list` | `#0D58A7`, white text | active sub-tab, selected menu or list item | palette-toggle-selected (confirmed) | 7.07 |
| `--sel-toggle` | `#0051BA`, white text | active range or toggle button | single-source-tokens `sel-toggle-blue` (confirmed 2018 and 2021) | 7.28 |
| `--btn-top` / `--btn-bot` | `#333333` / `#191919` gradient | range and toggle buttons | charts-range-toolbar (confirmed on May 2021 p5). single-source-tokens measured `#1B1B1B` to `#212121` on other 2021 buttons; we pick the p5 value because it is the chart range row we copy | white ≥ 12.6 |
| `--btn-grey` | `#404040`, 1px `--border-int` | grey dialog and footer buttons | single-source-tokens `field-btn` `[px]` MDM p21/p23 | `--text` 6.9 |
| `--hover-row` | `#191919` | grid row under the pointer | IS-07 `[px]` PORT native video | `--text` 12.22, amber 8.63 |
| `--hover-cell` | `#3C3C3C` | grid cell under the pointer | IS-07 `[px]` PORT native video | `--text` 7.66, amber 5.42; muted and down swap, see 4.12 |
| `--hover-menu` | `#373737` | dark dropdown and autocomplete hover row | single-source-tokens `hover-row` (confirmed for dark menus only, 2020 PNG) | white 11.90, amber 5.84, `--muted` 4.83 |
| `--focus` | `#FFFFFF` | 2px keyboard focus outline | `[house]`: Bloomberg's "white outline box" is official text for hover (screens_a-22 `[off]`), but no clip shows it (IS-08); we keep white for keyboard focus to meet 2.4.7 | 21 bg, 16.67 raised |
| `--link` | `#53B2F5` | links, breadcrumbs, "More ..." rows | palette-link (confirmed) | 9.05 bg, 7.19 raised |
| `--dim` | `rgba(0,0,0,.5)` | modal dim over the owning panel only | IS-10 `[px]` two videos measure 0.46 to 0.53 on every channel | |
| `--dialog-title` | `#CBCBCB` title strip, black text; body black; 2px `#CBCDC8` border | modal dialogs | IS-10 `[px]` BT video | 13.0 |
| `--tip-bg` / `--tip-border` / `--tip-fg` | `#FFFFFF` / `#3B3B3B` / `#1A1A1A` | plain UI tooltips | IS-11 `[px]` PORT video | 17.40 |
| `--datatip-bg` | `#99CACB`, black text | chart event-marker data tips | IS-12 `[px]` BT video (single clip, medium) | 11.67 |

**Scrollbars** (the critic noted they were missing)

| Token | Value | Use | Source | Contrast |
|---|---|---|---|---|
| `--sb-w` | 15px | classic, always visible, takes layout space | IS-09 `[px]` PORT native video (x369-383) | |
| `--sb-track` | `#222222` (`#131313` inside lists) | scrollbar track | IS-09 `[px]` | |
| `--sb-thumb` | **`#787878`**, flat, radius 0, 1px track-coloured border | scrollbar thumb | Bloomberg `#646464` (IS-09 `[px]`) is 2.69 on `#222222` and fails 1.4.11 once we restyle it (the user-agent exemption no longer applies); `#787878` is the nearest pass `[inf]` | graphic 3.60 |
| `--sb-arrow` | `#FFFFFF` | small triangles in about 17px end zones, no button boxes | IS-09 `[px]` | 15.91 on track |

**Headers, tape, flags**

| Token | Value | Use | Source | Contrast |
|---|---|---|---|---|
| `--legend-bg` | `#0C0C0C` | chart legend box | charts-legend-box (confirmed) | white 19.56 |
| `--cyan-name` | `#40EDFF` | long-name line under function headers (DES, REG, RUN) | single-source-tokens `cyan-name` (confirmed 2018 and 2020) | 14.78 bg |
| `--cyan-chart` | `#89FFF1` | name line above charts (GP, GIP, EQ) | single-source-tokens `cyan-name` `[px]` May 2021 lossless ClearType, per-channel maximum | 17.64 bg |
| `--marker` | `#FFFF00`, black text | chart event markers (News tool style, used for rolls) | single-source-tokens `marker` `[px]` March 2021 GPC only (single source) | 19.56 bg |
| `--warn` | `#FFE100` | ⚠ glyph, `d` delayed flag, yellow `?` help square | single-source-tokens `warn` (confirmed as an in-era colour; the warning role is `[inf]`) | 16.02 bg, 13.41 chrome |
| `--exc` | alias of `--c-down` (`#FF2C4A`) | "Exceptions (N)" text on black | single-source-tokens `exc` (corrected from `#FF2B46`, the 2026 value) | 5.71 bg |
| `--flag-bg` / `--flag-fg` | `#870F1E` / `#FFFFFF` | READ ONLY and NO ORDER PATH chips | `[house]`: amber is non-semantic in Bloomberg, so it cannot flag; we reuse the red-bar pair. clones_legal-20 confirmed only the gap, not this design | 9.92 |
| `--key-cancel` | `#FF425A`, black label | CANCEL key button | palette-fkeys (confirmed; `#FF415C` in the lossless Tour login PNG) | 6.18 |
| `--key-go` | `#18BD39`, black label | GO, HELP, SEARCH, MENU, PG BACK, PG FWD and custom keys | palette-fkeys (confirmed; `#1BBC3C` lossless) | 8.38 |
| `--key-sector` | `#F0AF00`, black label | sector keys in the drawn HELP keyboard and in `<Key>` hint tokens | keyboard-04 (corrected: KB3 and KB4 agree) | 10.84 |
| `--key-panel` | `#1DBBED`, black label | PANEL key in the drawn keyboard | keyboard-04 (corrected: 2017 KB4 photo) | 9.38 |
| `--tape-bg` | `#001230` | event tape background | screens_b-08 (corrected) | |
| `--tape-fg` | `#FB9600` | event tape text | screens_b-08 (corrected) | 8.38 |
| `--tape-src` | `#EA5D08` | source-code column in the tape and in news-style lists | screens_b-08 (corrected) | 5.37 |
| `--tape-edit` | `#001940` | thin line above the tape | screens_b-08 (confirmed) | |
| `--bar-pos` / `--bar-neg` / `--bar-mag` | `#00851C` / `#C31834` / `#0051BA` | in-cell bars (signed; unsigned magnitude) | screens_b-05 (2026 PORT; blue confirmed) | graphic 4.37 / 3.50 / 2.89. The value is always printed beside the bar, so the bar is supplementary |

**Heat and tile scales**

- **MON cells.** `--heat-up-2 #51EE6C` and `--heat-dn-2 #FF1E3E` (ends confirmed, palette-heat-scale). `--heat-up-1 #39A74C` and `--heat-dn-1 #BA152D` (middle steps vary between images; 2017 Launchpad and PDFU values). Text is black on `#51EE6C` (13.80), `#39A74C` (6.81) and `#FF1E3E` (5.51), but **white on `#BA152D`** (6.50). Bloomberg's black on `#BA152D` is 3.23 and fails.
- **CORR** (changed from the draft). The FXC 4-level scale (`#96000F / #510004 / #004000 / #008616`) is only seen in a 2015 capture (single-source-tokens `corr-scale`, era-specific). The in-era 2018 heat scale is the LUISS MOVERS tiles `[px]`: strong down `#6C0820`, weak down `#390014`, weak up `#002D09`, strong up `#005713`; neutral (|r| < 0.10) `#000000`; diagonal `#4B4B4B` (the MOVERS neutral tile). White text on each: 12.40 / 17.74 / 15.23 / 8.85 / 21 / 8.72. The steps are `[house]` thresholds: |r| < 0.10 neutral, 0.10 to 0.40 weak, above 0.40 strong. The printed value carries the sign, so colour is never the only cue.
- **MRET** (new, from the tear-sheet gap study MRET-2). SEAG heat-map ramp, 2021 look `[px]` (galaxy.gif, palette GIF, cell means): negative floor `#5E0A1D` to negative max `#DE1831`; positive floor `#014D10` to positive max `#18BD39`. Small values never fall to black. Interpolate by |v| / max|v| from floor to max. Text colour is whichever of black or white contrasts more; the worst case along the green ramp is 4.60 (at `#0D8826`) and along the red ramp 4.91 (white on `#DE1831`), so both pass. Scale symmetric by max|v| `[inf]` (the 2015 bar is labelled symmetric; the 2021 one is not clear).
- **HOME KPI tiles** (corrected GMM tile scale): `#004A0F`, `#00821B`, `#7B0B23`, `#A1132D`, white text (10.57 / 4.99 / 10.97 / 7.94).

**Chart tokens** (section 6): `--chart-grid #505050` (dotted, decorative 2.60; changed from the draft `#626262`, see 6.1), `--chart-axis #FFFFFF`, `--chart-s1 #FFFFFF`, `--chart-area #031D38`, `--chart-vol #7189AA` (5.86), `--chart-split-outer #242424`, `--chart-split-inner #484848`, `--chart-year-div #808080`, `--candle-up #FFFFFF`, `--candle-dn #0080FF` (5.53), `--last-line #F09000` (8.69), `--perf-pos #007219`, `--perf-neg #6A1020`, `--dist-curve #F79400` (9.19), `--roll-vol #00B5F7` (8.95), `--zero-line #848484` (5.61).

### 2.3 Themes

- **`dark`** (default): the tokens above.
- **`data-cvd="deut"`**: PDFU COLORS Deuteranopia (official mechanics `[off]`). Blue for up, red for down; amber unchanged.
  - `--c-up #3399FF` (Bloomberg swatch `#0089E9` fails on th and sel).
  - `--c-down` and `--c-down-raised` become `#FF5566` (the swatch `#CD4B4B` is 4.70 on bg and 3.73 on raised).
  - Heat up steps `#6BCEFF` / `#399CFF` (best guess, single GIF).
  - Message line text on switch: "New theme applied. Rerun the screen to see the changes."
- **`data-cvd="prot"`**: Protanomaly.
  - Up `#3399FF`.
  - Down `#FF7329` (7.74 bg, 5.30 sel).
  - **Amber swaps too**: `--data` and `--field-bg` become `#FEBA11` (official swatch; the GIF shows `#FCBC50`; 12.25 bg). From the clones_legal verifier, CVD-8 frames 42 to 54.
- **`amber-classic`** (Phase 12, optional, `src/theme/amberClassic.css`): an all-amber-on-black variant that sets colour token values only. Every pair of the default list (8.2) and of `AMBER_CLASSIC_PAIRS` passes in it, alone and with each colour scheme, and so does every pair the stylesheets write (`src/theme/cssPairs.ts` reads each rule that sets a token text colour and a token fill; `src/theme/amberClassic.looks.test.ts` measures them in both looks). Disabled controls are exempt from the text minimum (WCAG 1.4.3) and listed by the test. The navy 2011 look is not a target.

The existing rule stays: never put a `var()` colour in a CSS transition. State changes (hover, press, menu open, dim) are hard cuts with no transition (IS-04, IS-05, IS-07, IS-10 `[px]`: every observed state change lands within one frame).

### 2.4 Where AA overrides the look outside colour `[house]`

Recorded after the 2026-09-26 accessibility and visual reviews. Each is the smallest change that passes; the look at 1920x1080 is unchanged.

- **Reflow (1.4.10).** The Terminal keeps its fixed panel grid at any window size. At 700 CSS px and narrower (200% to 400% zoom) the panels stack in reading order at full width, each `max(16rem, 80dvh)` tall, and only the page scrolls vertically; red bars and tab strips wrap instead of clipping, and placeholder cells wrap instead of ending in an ellipsis. `[house]`
- **Status line size.** 13px (`--fs-nav`) for its main text, near body size like the reference row; only the clock and the `<Esc>` hint stay 11px (the section 3.2 "status-bar secondary" role). The safety segments stay whole at 1366x768. `[house]`
- **Focused-panel line.** The 1px `--cmd-border` line (4.3) is drawn as an overlay above everything in the panel, the menu dim included, so it runs round the whole panel; the panel the command line addresses carries it before any click (panel 1 on load, then the panel a command ran in). `[house]`
- **Reserved F-keys (5.2).** If a browser keeps F1, F10 or F11 for itself, HELP says what to type instead: `HELP`, `INDEX`, `CURNCY`. `[house]`
- **Related Functions menu (4.7).** Marked `aria-modal="false"`, since the chrome stays usable while it is open; focus moving into another panel closes it, focus on the chrome does not (Number `<GO>` still reaches its rows). `[house]`
- **Text spacing (1.4.12).** Under 1.5 line height, 0.12em letter spacing and 0.16em word spacing, no chrome or panel text is clipped: 20px rows grow with their text, and the yellow help square's height is a minimum. Checked in `e2e/shell.spec.ts`. `[house]`
- **Chart focus ring (2.4.7, 2.4.11).** Every chart fills its `role="img"` figure with an opaque layer, so the 2px `--focus` ring is drawn on an overlay above the chart, not as the figure's own outline. The chart and its table view are Tab stops of their own; inside a panel the roving focus still leaves one Tab stop. Checked on screen pixels in `e2e/gallery-focus.spec.ts`. `[house]`
- **Chart controls and legends at narrow widths (1.4.10).** The range row (6.4) and the chart's `Table` toggle share one row that wraps below the buttons' full width instead of overlapping; a CandleChart legend name ends in an ellipsis rather than running off the plot, and its value stays whole. At 1366x768 and wider nothing changes. Checked at 320 CSS px in `e2e/gallery-reflow.spec.ts`. `[house]`
- **Held arrow keys on a chart.** The crosshair moves on every key repeat, but the polite readout announces only where a held key stops (300 ms after the last repeat), as it already did for the pointer. `[house]`
- **Tab strips (4.1.2).** A `role="tab"` keeps the ARIA tabs keyboard contract. Left and Right stay in its tablist and wrap at the ends; Home goes to the first tab and End to the last; Enter or Space selects. Because Tab moves between panels (UI_SPEC section 5), Down on a tab moves into the panel's content, and Left from the first content item returns to the tabs. Every tab strip names the `role="tabpanel"` it controls. `[house]`
- **Chart summaries and drawdown (1.1.1).** A chart's accessible name states a maximum drawdown only when the screen passes the API's figure with its basis (for example `max drawdown -22.64% (Basis A)`); the chart never derives one from the plotted curve, and other panes (exposure, contracts, rolling figures) state none. `[house]`
- **Short panels (round 3 visual review, 2026-09-27).** A panel body under 480px tall (a HOME 2x2 cell) folds the MON parameter row away, so the grid keeps its 19-row budget; a full-screen MON (556px at 1366x768) keeps it. A GP body under 300px (the HOME cell at 1366x768) folds its parameter row, range row and session line away so the price pane stays readable; the full GP panel keeps them, and the basis footer follows in the body's scroll. LIVE shows its chart before the KPI tiles in a body under 320px. RR draws no scale when the series is shorter than the rolling window: each pane states the window and the series length instead. `[house]`
- **Numbers are never cut (4.8).** A grid column is never narrower than its header, and a numeric column never narrower than its widest value; only name and text columns end in an ellipsis. A grid wider than its panel scrolls. `[house]`
- **Gate read counter (4.1.3).** The status line's `Gate reads N` sits outside its polite live region on purpose: it rises with every price read a screen makes (GP, HOME), so announcing it would talk over the screen. The kill switch and TWS segments, which change rarely and matter at once, stay in the live region. `[house]`

---

## 3. Typography

### 3.1 Families (open licences only)

| Role | Stack | Package | Why |
|---|---|---|---|
| Everything (UI, tables, numbers, charts, KPIs) | `"Bergoom", "Source Sans 3", system-ui, sans-serif` | Bergoom: self-host `Bergoom-{Regular,Italic,Semibold,Bold,BoldItalic}.woff2` and `LICENSE.md` from github.com/dchest/bergoom (OFL-1.1) into `web/src/assets/fonts/bergoom/`. Fallback: `@fontsource/source-sans-3` (OFL-1.1) | Modern Terminal screens are **proportional** everywhere (typography-prop-is-default-everywhere, confirmed). Bergoom is an OFL imitation of Bloomberg Prop built on Source Sans 3. Measured width against the real Prop is within about 5% (typography-prop-substitute, corrected). All ten digits advance 497/1000, so numbers are tabular by default (verified with fontTools) |
| Fixed grid only: message line, event tape, command-line echo, raw log views (LEDG raw, JRNL raw, OOS log), 80-column text | `"PT Mono", ui-monospace, monospace` | `@fontsource/pt-mono` (OFL-1.1, weight 400 only) | Bloomberg Fixed has a **plain zero** and serifed I/l/1/i. PT Mono matches both, has a 0.600 em advance (9px cells at 15px) and a 10.5px cap (typography-fixed-substitute, corrected). JetBrains Mono, IBM Plex Mono and Source Code Pro all draw a dotted zero |

- **Licence condition.** The OFL reserves the names "Bergoom" and "Source". A subsetted or modified build must use a new family name. Shipping the unmodified woff2 is fine.
- **Spec change.** UI_SPEC section 3 ("fonts self-hosted through @fontsource") becomes "through @fontsource, or vendored OFL files with their licence". HELP licences list Bergoom (OFL), Source Sans 3 (OFL) and PT Mono (OFL).
- **Remove.** `font-feature-settings: 'zero'` everywhere (not in the @fontsource subsets, and Bloomberg zeros are plain), plus `'cv05', 'ss01'` on `body`. Remove Inter, Space Grotesk and JetBrains Mono. Keep `font-variant-numeric: tabular-nums lining-nums` on numeric cells; harmless on Bergoom and needed on the fallback.
- **Known shortfall.** Real Prop has wider default letter and word spacing than Bergoom, especially in bold (typography verifier, missed). Leave tracking at 0; do not add letter-spacing to fake it.

### 3.2 Sizes, line heights, weights

| Token | Value | Use | Basis |
|---|---|---|---|
| `--fs-data` | 15px | body, table cells, labels, menu rows | Prop cap ≈ 0.75 em. At 15px the cap is 11.25px, inside the measured 10 to 12.5px range (typography-size-hierarchy, corrected) |
| `--row-h` | 20px (see D1) | table and list rows, header rows | row pitch ≈ 1.75 to 1.8 × cap (typography-row-pitch, confirmed); Dec 2020 native pitch 21.4px `[px]` |
| `--fs-small` | 11px | source codes, timestamps in lists, status-bar secondary, frame strip and panel title text, key-button labels | 0.72 × body (corrected); key labels cap 8px at 100% (wfs-02b `[px]`); 11px floor kept |
| `--fs-cmd` | 15px | command box, autocomplete rows | about body size (confirmed) |
| `--fs-quote` | 18px | two-line quote header | 1.17 × table pitch `[inf]` |
| `--fs-kpi` | 21px | KPI headline values | 1.38 × body cap (corrected) |
| `--fs-title` | 15px, weight 700 | function title on the red bar, DES section heads | bold at body size (confirmed) |
| `--fs-nav` | 13px | nav toolbar text | cap 9px at 100% (wfs-02c `[px]`) |
| `--fs-chart` | 13px | chart axes, legend, tags, range buttons | cran4 cap 10px ≈ 13px; Bloomberg treats this as a user setting (Small / Medium / Large, charts-typography corrected) |
| `--fs-fixed` / `--lh-fixed` | 15px / 19px | PT Mono content | 9 × 19 cell (insider figure, confirmed `[sec]`) |

- **Weights.** 400 and 700 only; no light or medium. Numbers are never bold except totals and KPIs.
- **Italic.** Hints (`<UP ARROW> to hide`), breadcrumbs, alias text in autocomplete, and "More ..." links.

### 3.3 Case and tracking

- `text-transform: none; letter-spacing: 0` everywhere. Delete the `.eyebrow` uppercase `.07em` style.
- Caps only where the data itself is caps: tickers, mnemonics, source codes, tags (`[PRE-REG]`), key-button labels and autocomplete group headings (`FUNCTIONS`).
- Descriptions and headers are sentence or title case: "Registry board", "Active exp.", "Sharpe difference (m - BH)".
- The command line shows typed letters in upper case, but a sector suffix in title case (`NQ1 Index`). Amber input fields keep the user's case.

### 3.4 Number formatting (typography-number-format, corrected; screens_b-28, confirmed)

- Right-aligned, tabular digits. Numeric column headers right-aligned to the same edge, same size and weight as the data.
- Negatives use an ASCII hyphen-minus, never parentheses; colour carries direction and the sign always stays.
- `+` on change and return columns only, not on levels. `%` attaches with no space: `+0.55%`.
- Thousands separators on money and volume columns and on P&L (`1,188,839`); none on price or index levels (`18432.25`).
- Fixed decimals per column in tables. Do not copy the PORT habit of stripping trailing zeros, or the BT habit of dropping leading zeros.
- K/M/B suffixes in dense columns (`6.66k`, `1.19M`, `4.27B`).
- Missing value: `--` (ASCII, right-aligned; ECO and Launchpad `[px]`). Bloomberg's own mark is a dash one digit wide in the last digit slot; `--` keeps the house style lint (no en or em dashes) clean.
- Hot-link numbers `N)`: body size, drawn at 0.62 to 0.65 width (`display:inline-block; transform:scaleX(.63); transform-origin:right center`), colour `--muted`, right-aligned in a 2.2em gutter, `)` tight after the digits.
- Long names truncate with `...` (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`). Nothing wraps in grids.

---

## 4. Chrome

### 4.1 Frame stack at 1920x1080 (top to bottom)

This section is rebuilt from the frame-stack gap study (wfs-01 to wfs-06), which measured the official Dec 2020 capture at 100% and cross-checked CVD-8 (1.5x) and the 2024 PORT video. It resolves the critic's point that the draft stack contradicted the evidence.

**How Bloomberg maps onto dockview.** A Bloomberg panel is an OS window, and each window has, top to bottom: frame strip (or tab strip), optional custom-button toolbar, nav toolbar, command zone (command box plus message row, or the 2-line quote header in the same slot), red function bar, function area, Information Panel. Our app is one window holding several dockview panels, so the window-level rows are **global** and each dockview panel is treated like a Launchpad component inside that window `[house]`. The rows keep Bloomberg's order and heights.

```
y=0     FRAME / TAB STRIP  37px  #CDCDCD  8px top margin + 29px layout tabs (active #191919) | flags
y=37    KEY TOOLBAR        32px  #191919  4 + 24px buttons + 4
y=69    NAV TOOLBAR        22px  #191919  21px row + 1px #0A0A0A rule
y=91    COMMAND ZONE       50px  #000000  6px gap + 22px command box + 21px message row + 1px
y=141   WORKSPACE         917px  #000000  dockview; 2px black gutters, no panel borders
y=1058  STATUS LINE        22px  #191919  suggested-functions style
```

With the event tape on (D4), a 57px tape sits above the status line and the workspace shrinks to 860px.

Measured basis: frame strip 31px without tabs, about 37px with tabs (wfs-02a, wfs-02f `[px]`); custom-button toolbar 32px = 4 + 24 + 4 (wfs-02b `[px]`, CVD-8 and PORT at about 1.5x, so `[inf]` to the pixel); nav toolbar 21px plus a 1px `#0A0A0A` line (wfs-02c `[px]`, native); command zone 50px (wfs-02d `[px]`, native). The only departures:

- `[house]` The key toolbar is app-wide, not per panel; Bloomberg shows one per window and ours is one window.
- `[house]` The status line is 22px, not the 43px Information Panel (D7).
- `[house]` The 2-line quote header does not replace the global command zone. Bloomberg swaps the zone to the quote header when a security is loaded (wfs-02e `[px]`); our global box must stay usable, so the quote header moves into instrument panels (4.6), where it takes the slot the command zone would have in a Bloomberg window.

### 4.2 Frame strip, key toolbar, nav toolbar, command line, message line, autocomplete

**Frame / tab strip** (37px, `--frame-bg`):
- 8px top margin, then 29px browser-style tabs, one per saved layout (`HOME`, `RESEARCH`, `LIVE`, `+`). This maps Bloomberg's in-frame tabs (wfs-02f `[px]`) onto our layouts `[house]`.
- Active tab: `--frame-tab-on` fill, merging into the key toolbar with no line between them; a bold mnemonic then the title in `--frame-tab-fg` (`HOME Launchpad view`); 1px `--frame-tab-edge` on the right; about 225 to 240px wide.
- Inactive tabs: black text on `#CDCDCD` `[inf]` (no 2020 to 2024 capture shows an inactive tab).
- Right side: `READ ONLY` and `NO ORDER PATH` chips (`--flag-bg`, white 11px bold), then `≡ Options`. No window minimise, maximise or close glyphs (a browser tab has its own).

**Key toolbar** (32px, `--chrome`). Bloomberg's official default list (wfs-02b `[px]`, identical order in CVD-8 2021 and PORT 2024) is CANCEL (red), then HELP, SEARCH, NEWS, QUOTE, QUOTE, MSG, MENU, PRINT, PG BACK, PG FWD (green), then user buttons. The critic was right that the draft's INDEX/COMDTY/CURNCY buttons and LAST/HOME buttons are not on it. The new bar:
- Official keys that have an nq-lab meaning, in Bloomberg's order: `CANCEL` (`--key-cancel`, Esc), `HELP` (F1), `SEARCH` (runs `HL`), `MENU`, `PG BACK`, `PG FWD`, all `--key-go`. NEWS, QUOTE, MSG, PRINT: left out, since nq-lab has no such function `[house]`.
- Then custom buttons, which Bloomberg lets users add with a label and colour (ALT+B `[off]`, 2013 guide): `HOME`, `REG`, `RUNS`, `LEDG`, `LIVE`, `OOS` in `--key-go` `[house]`: the mechanism is official, the labels are ours.
- No sector buttons. F8 to F11 insert the sector suffix (5.2), and the drawn keyboard in HELP shows them yellow.
- Geometry: buttons 24px tall, about 44px wide on a 48px pitch, first button inset 6px, labels black 11px uppercase, clipped at the button edge with no ellipsis (`CANCE`), square corners (wfs-02b `[px]`). Every button has an `aria-label` naming its key and action.
- A wrench glyph at the far right opens the key map (Alt+K).

**Nav toolbar** (21px + 1px `--chrome-rule`), reflecting the focused panel (wfs-02c `[px]`, 2020 flat style, no light chips):
- Left: `< >` back and forward; `|`; `[A] NQ1 Index ▾` (context with link chip); `|`; `GP ▾` (mnemonic); `|`; `Related Functions Menu ≚` (opens MENU).
- Right: envelope `Message` (shows `KILL off` and the TWS state), `★▾` favourite layouts, `⧉▾` export CSV, `?▾` on a `--warn` square with black glyph (2017 to 2024 captures `[px]`).
- Text `--text` at `--fs-nav`; dividers 1px `--chrome-div`, 13px tall, vertically centred.

**Command zone** (50px black):
- **Box**: 22px tall including a 1px border on all sides (wfs-02d `[px]` Dec 2020 native), 8px left inset. Border `--cmd-border` when focused, `--cmd-border-idle` when focus is in a panel (IS-03 `[px]`).
- **Width**: 680px at 100% `[inf]`. Bloomberg's box measured 52% to 81% of the window across five captures and about 660 to 680px at 100% in wide windows (wfs-02d); the draft's "73%" was one capture.
- **Caret**: a solid right-pointing triangle about 6px wide, full inner height, `--cmd-caret` (focused) or `--cmd-caret-idle`.
- **Cursor**: a block one cell wide (9 × 18px) right after the last typed character. Blinks between `--cmd-cursor` and `--cmd-cursor-dim` with a hard cut every `--caret-phase`, never fully off (IS-01 `[px]`). Keeps blinking while the autocomplete sheet is open; each keystroke restarts it in the bright phase (IS-02 `[px]`). Hidden when the box loses focus (IS-03). Steady bright under `prefers-reduced-motion`. Implementation: `@keyframes caret{0%,50%{background:var(--cmd-cursor)}50.01%,100%{background:var(--cmd-cursor-dim)}}` with `animation: caret calc(2*var(--caret-phase)) steps(1) infinite`; hide the native caret with `caret-color: transparent`.
- **Text**: white, `--fs-cmd`, displayed upper case. No prompt text and no placeholder sentence: delete `nq-lab>` and "type a mnemonic...".
- **Focus**: the bright border is the focus cue; add a 2px `--focus` outline on `:focus-visible`.
- **Target size**: the 22px box passes 2.5.8 by the spacing exception (no other target within the 24px circle: a 6px gap above, the message row below).
- **Zone right side**: `1  [A] NQ1 Index  [B] rebal_v0  [C] -`. The digit is the focused panel number, so the global box reads as that panel's command line.

**Message line** (21px, screens_b-06 confirmed, wfs-02d):
- PT Mono, white, left-aligned.
- Prompts and status: `<HELP> for explanation.` (`<HELP>` in `--key-go` text), `Layout saved.`, `Gate refused 2022+ window.`, `No item 42 on this screen.`, `<Back> to return`.
- Replaces toasts. `aria-live="polite"`.

**Autocomplete** (chrome-04 confirmed, keyboard-14 corrected):
- A sheet directly under the box, same width, `--ac-bg`. It hangs from the box's own 1px `--cmd-border`; the draft's separate `#0B51A8` rule is dropped (that hex was a resampling artefact of the same line, single-source-tokens `cmdline-blue`).
- Group heading rows (20px): amber uppercase 13px bold (`FUNCTIONS`, `INSTRUMENTS`, `HYPOTHESES`, `RUNS`, `SEARCH`). The first heading carries a right-aligned italic `--muted` hint `<UP ARROW> to hide`.
- Each group shows at most 6 rows, or 9 when only one group matches (2017 shows 6, 2013 shows 9), then an italic `--link` row `More functions...` that opens the full list.
- Row (20px, two columns): left 24% width, mnemonic or ticker in white (`GP`, `NQ1 Index`); right, description in `--muted` with matched letters in bold white. Hover or active row `--hover-menu`.
- ArrowUp on the first row closes the sheet. Each row keeps `role="option"`.

### 4.3 Panel chrome (per dockview panel)

```
+----------------------------------------------------------------------------------------+
| 2-GP  [A] NQ1 Index                               [PRE-REG]   T   ≡ Options   □       | 18px title bar
| NQ1 Index  ↑18432.25 +42.50 +0.23%  [spark]  At 2021-12-31 16:00 d                    | 22px quote 1 (instrument only)
| Vol 312,004  O 18390.00  H 18450.75  L 18371.25  RV22 18.4%                            | 22px quote 2 (instrument only)
|[NQ1 Index    ▾] 95) Compare ▾ 96) Actions ▾ 97) Edit ▾            Page 1/1  Candle chart| 21px red bar
| 1) Price  2) Table  3) Rolls |   (trapezoid tabs, only on multi-tab screens)           | 21px tabs
|  body ...                                                                               |
+----------------------------------------------------------------------------------------+
```

- **Title bar** (18px, `--frame-bg`, black 11px text): left `<panel no>-<MNEMONIC>` then the link chip and context; right the tag, table toggle `T`, `≡ Options`, maximise `□`. The colour and control set match the modern Launchpad component bar (chrome-09 `[px]`, BQuant PNG `#CDCDCD` with `≡ Options ↗ _ ⧉ ×`). Height is `[house]`: the component bar measures 13px but may be cropped (9.4); 18px keeps the 11px text floor.
- **No per-panel nav toolbar.** The draft's 21px per-panel toolbar is removed: the nav toolbar is global (4.2) and reflects the focused panel. This returns 21px of rows per panel.
- **Quote header** (two 22px lines): only for instrument contexts (GP, GIP, instrument DES, MON drill-down). Details in 4.6.
- **Gutters**: 2px black between panels, no panel borders.
- **Focused panel** (critic item resolved): no source shows bold text or a white outline around a focused panel. Evidence shows focus through (a) the OS window accent border (`#1884D6` in CVD-8, OS chrome), (b) the bright versus dim command-box border, (c) in tab mode, the active tab merging into the toolbar (wfs-02g, `[inf]` for the meaning). The spec therefore uses:
  - a 1px `--cmd-border` line around the focused panel, standing in for the OS accent border `[house]` (graphic 6.34 on the black gutter);
  - the panel number shown in the command zone and the nav toolbar reflecting that panel;
  - the command box border dimming to `--cmd-border-idle` when focus is inside a panel.
  - Keyboard focus on controls inside a panel is a separate 2px `--focus` outline (2.4.7).

### 4.4 Red function bar and tab strips

**Function bar** (21px, `--fn-bar`; palette-red-title-bar confirmed, chrome-05 corrected, wfs-04 function-dependent height):
- Flat: no gloss, no light top line; one 1px `--fn-edge` bottom edge.
- **Left**, optionally, an amber context field (`--field-bg`, black text, 20px), then numbered menu buttons `NN) Label ▾` in white 15px, separated by 2px `--fn-div`.
- **States** (IS-05 `[px]`): rest `--fn-bar`; hover `--fn-hover` fill (not an outline); pressed or menu open `--fn-press`; disabled label `--fn-off`. Do not use `--muted` on red (4.03). Instant switches.
- **Numbering** `[house]`: Bloomberg's numbers vary by function (keyboard-09 corrected: 97) Actions, 11) to 14) in PORT, 102) to 104) in News), so there is no Bloomberg rule. Red-bar actions often sit in the 90s (confirmed examples 94) to 99)), which we adopt as a fixed house scheme: `95) Compare` (charts only), `96) Actions`, `97) Settings`, `98) Export`, `99) Help`.
- **Right**: `Page n/m` (only when the grid pages; official `[off]` "may also contain a page number indicator"), then the screen title in white bold, for example "Hypothesis description".

**Red dropdown menus** (opened from a red-bar button; IS-04 `[px]` three clips):
- Open instantly below the button, left-aligned to it, background `--fn-bar` (the same red as the bar).
- Rows one grid row high, white text, no separators, no check marks, no icons; submenus show a small solid ▸ at the right edge.
- Hovered or keyboard-active row: full-width `--fn-hover`.
- Padding about 0.6 row top and bottom; edge 1px black; no shadow; no transition.

**Top-level tabs** (21px):
- Trapezoids whose right edge slants out 5px over the height: `clip-path: polygon(0 0, calc(100% - 5px) 0, 100% 100%, 0 100%)` (screens_b-31 corrected: slant measured in the 2018, 2023, 2026 captures).
- Active `--tab-on` with black text; inactive `--tab-bg` with `--tab-fg` text; hover on a grey strip `--tab-hover` (IS-08 `[px]`). The strip background is black.
- Labels numbered: `1) Equity  2) Drawdown  3) Returns  4) Rolling  5) Monthly`. `aria-selected` carries the state.

**Sub-tab strip** (20px, `--tab-on` background): active sub-tab `--sel-list` with white text; inactive black text; numbering optional.

**Parameter row** (22px, black): amber labels as text followed by amber fields: `Range [2010-01-01]-[2021-12-31]  Freq [Daily ▾]  Variant [repaired ▾]  Cost [1 tick ▾]`.

### 4.5 Fields, lists, buttons

- **Field**: `--field-bg`, `--field-fg` 15px, 20px tall in a 22px row, radius 0.
  - Placeholder in angle brackets: `<Narrow>`, `<Enter keyword filter>`.
  - Dropdown fields add a 16px `--field-btn` box with a ▾ on the right.
  - Disabled: `--field-off`.
  - Keyboard focus: `outline: 1px solid var(--field-focus); outline-offset: 1px`, wrapping the field and its button (IS-14 `[px]`). While a list is open, the field text shows as selected.
  - Amber **only** on real inputs. Read-only values are never amber-filled; in the RUN config they show as `#454545` boxes with `--text` (6.66).
- **Amber-field dropdown list** (IS-06 `[px]`): `--list-bg`, 1px `--list-border`, amber item text, rows one grid row high, no separators, no check marks; current item `--list-sel`; padding about 0.6 row; may be wider than the field; opens upward when there is no room below.
- **Grey buttons**: `--btn-grey` fill, `--text` label, 1px `--border-int`.
- **Range and toggle buttons** (section 6.4): gradient `--btn-top` to `--btn-bot`, white 13px, 1px black separators. Active: `--sel-toggle` background plus bold text. The bold is `[house]` so the state is not colour alone (2.29:1 against neighbours). Toggle hover `#414141` `[px]` (IS-08, one frame, low confidence).
- **Tooltips** (IS-11 `[px]`): plain UI tooltips `--tip-bg` with 1px `--tip-border` and `--tip-fg` 11px text, placed about 12px right and 20px below the pointer tip, shown 500ms after the pointer rests, hidden in the same frame it leaves; no fade, no shadow. Keyboard focus shows the same tooltip at once (1.4.13: dismissable with Esc, hoverable, persistent).

### 4.6 Security or quote header (screens_b-29 and screens_a-24, corrected)

- **Placement** (critic item resolved): Bloomberg shows the 2-line quote header **in place of** the command box and message row (wfs-02e `[px]`, BT 2021 video: the red bar starts at the same y either way). In nq-lab it sits inside instrument panels, between the title bar and the red bar `[house]`, because the global command zone must stay. Two 22px lines at `--fs-quote`.
- **Line 1**: ticker in white (not amber); tick arrow (↑/↓) coloured by the **last tick direction**; last price coloured by the **sign of the day change** (arrow and digits are separate spans, palette-tick-arrow-rule confirmed); net change and % change in up/down colours; a 60 × 14px sparkline.
- **Line 2**: amber labels (`At`, `Vol`, `O`, `H`, `L`, `RV22`) with white values; a `d` flag in `--warn` after the time means "served, delayed, in-sample". Time is ET, date ISO.
- **No tick flash** in headers: IS-13 `[px]` (Bloomberg's own Pro Tip at 8 fps) shows digits and arrow change with no background flash.
- For a hypothesis context, line 1 becomes `rebal_v0  [FAIL]  t 1.13  p 0.13  round 4`.

### 4.7 Menus (Related Functions; sector and context menus)

Source: keyboard-24 corrected; screens_a-23 corrected; IS-10 for the dim.

- A black overlay box with a 1px `#BABABA` border (10.82) `[px]` (Scranton p61, 2015 menu).
- **Dim** (critic item resolved): `--dim` covers only the body of the panel that owns the menu or dialog (red bar and below). The key toolbar, nav toolbar and command line stay bright and usable, as do the tape and status line. The dim appears in one frame; the dialog one or two frames later (IS-10 `[px]`, two videos).
- **Top-left**: italic `--link` breadcrumb, for example `Main menu of functions > Research > rebal_v0`.
- **Top-right**: `<Cancel> X` in `--text`.
- **Body**: two columns, numbered **sequentially across both columns, category rows included**.
  - Category rows white, ending in `>`.
  - Function rows `N) MNEM  Title`: number `--muted` and condensed, mnemonic white, title amber.
- Selected row `--sel-list` with white text. Rows 20px. Esc or MENU closes or goes up one level.

### 4.8 Tables (MonitorGrid)

Source: palette-table-header confirmed, chrome-17 confirmed, screens_b-12 corrected, typography-alignment confirmed, single-source-tokens `th-rule` confirmed.

- **Header**: 20px, `--th-bg`, `--th-fg` 15px regular, 1px `--th-rule` top. Header cells are separated by a 1px black gap, not a grey rule. Two-level headers allowed (`Multiple testing: p | Bonf | Holm | BH q`). Sticky.
- **Body rows**: `--row-h`, black, **no zebra**. Names and labels amber; numbers `--text`; totals row white bold.
- **Group or section rows**: black, white bold, numbered (`1) Equity`).
- **Filter row** (optional): full-width amber row under the header, black text, `<Enter filter>`.
- **Rules**: optional 1px `--th-rule` body column rules and table frame; off by default.
- **Padding**: 0 vertical, 5px horizontal.
- **Tree expanders**: `⊞`/`⊟` (round > hypothesis > run).
- **States** (4.12): hover row `--hover-row`, hover cell `--hover-cell`, selected `--sel-bg`, keyboard focus 2px `--focus` outline inset.
- **Red text**: `--c-down` on black rows; `.row[aria-selected=true] { --c-down: var(--c-down-raised) }`; header and band rows the same override.
- **Inline bars**: `--bar-pos`/`--bar-neg` (signed) or `--bar-mag` (unsigned), 60% of row height, value printed beside.
- **Warnings**: `Exceptions (N)` in `--exc` above a table; `⚠` in `--warn` plus text for `[POST HOC]` or `[SPENT]`.
- **Scrollbars**: classic, always visible, 15px, `--sb-*` tokens: `::-webkit-scrollbar{width:15px;height:15px}`, track `--sb-track`, thumb `--sb-thumb` with radius 0 and a 1px track-coloured border, `::-webkit-scrollbar-button` showing `--sb-arrow` triangles; Firefox `scrollbar-color: var(--sb-thumb) var(--sb-track)`. No overlay or auto-hiding scrollbars (IS-09 `[px]`).

### 4.9 Event tape (optional; screens_b-08 corrected)

- 3 lines × 19px, `--tape-bg`, with a 1px `--tape-edit` line above.
- PT Mono, `--tape-fg`. Format `NNNN SRC HH:MM text`, with SRC (`OOS`, `REG`, `LIVE`, `LEDG`) in `--tape-src`. Example: `0412 OOS 14:02 gate read volmanaged_v0 1d NQ.V.0 [IS]`.
- Static list, newest on top; no scrolling by default and never under reduced motion.
- `NO <GO>` toggles it (official Bloomberg behaviour `[off]`). State kept in `localStorage` with try/catch.

### 4.10 Status line

Source: chrome-15 corrected, screens_b-08 confirmed. 22px is `[house]` (D7).

- `--chrome`, in "Suggested Functions" style: an amber label, then segments of a bold white key and a `--text` value, divided by 1px `--chrome-div` rules.
- Content: `Screen HOME | A NQ1 Index | B rebal_v0 | DATA 2010-01-01..2021-12-31 | TWS not monitored | KILL off | Gate reads 7 | 14:02:11 ET | <Esc> command`.
- Key hints use `<Key>` notation, key name in `--key-go` text: `<End> back  <F1> help`.
- A per-panel zoom control is **not** added (9.15).

### 4.11 Linked groups

See 9.1: colours unverifiable. The form is a solid 14 × 14px square in the group colour with a black letter, placed before the context in the panel title bar, the nav toolbar and the command zone. An unlinked panel shows no chip.

### 4.12 Interaction states (new, from the interaction-states gap study)

| Element | Rest | Hover (pointer) | Pressed or open | Keyboard focus | Source |
|---|---|---|---|---|---|
| Red-bar button | `--fn-bar` | `--fn-hover` fill | `--fn-press` | 2px `--focus` inset | IS-05 `[px]` |
| Red dropdown row | `--fn-bar` | `--fn-hover` | | same fill as hover, follows roving focus | IS-04 `[px]` |
| Grid row | black | row `--hover-row`, cell `--hover-cell` | | 2px `--focus` inset + cell fill `--hover-cell` | IS-07 `[px]` |
| Tab on grey strip | `--tab-bg` / `--tab-on` | `--tab-hover` | | 2px `--focus` | IS-08 `[px]` |
| Amber field | `--field-bg` | no change seen | text selected while list open | 1px `--field-focus`, offset 1px | IS-14 `[px]` |
| Command box | idle border | no hover state | | bright border + caret + 2px `--focus` on `:focus-visible` | IS-03 `[px]` |

- Every change is a hard cut with no transition (all clips).
- Inside a hovered cell (`#3C3C3C`) two text tokens fail: `--muted` (4.48) and `--c-down` (3.54). Override them there: `.cell:hover { --muted: #B4B4B4; --c-down: var(--c-down-hover) }` (5.32 and 4.89) `[inf]`.
- Bloomberg's official "white outline box" hover (screens_a-22 `[off]` text) was never seen in any clip; every observed mouse hover is a fill. We use fills for the mouse and the white outline only for the keyboard.
- Multi-row selection (Shift+drag) highlights in orange in Launchpad monitors (IS-16 `[sec]`); not built in P0.

---

## 5. Keyboard and command grammar (changes to UI_SPEC section 5)

Source: keyboard-01 to 29 as verified. Every item here is confirmed or corrected unless marked otherwise.

### 5.1 Grammar

```
line := [NXTW] [context [SECTOR]] [FUNCTION [args]] [HELP]
      | SECTOR | digits | MNEMONIC
SECTOR := INDEX | COMDTY | CMDTY | CURNCY | CRNCY | EQUITY | GOVT | CORP   (any case; F-key inserts it)
```

1. **Sector token (optional).** Accepted after an instrument context and checked against it.
   - NQ, ES, YM take `INDEX`. ZN, ZB, CL, GC, the grains and livestock take `COMDTY`. 6E and the other FX futures take `CURNCY`.
   - Hypotheses, runs and `27F` reject a sector.
   - A mismatch such as `NQ COMDTY` gives the message "NQ is an Index future: use INDEX (F10)."
   - Display the canonical suffix in title case: `NQ1 Index`, `TY1 Comdty`, `EC1 Curncy`.
2. **Generic tickers as aliases** `[sec]`: NQ1, ES1, DM1 = YM, TY1 = ZN, US1 = ZB, TU1 = ZT, FV1 = ZF, EC1 = 6E, JY1 = 6J, BP1 = 6B, AD1 = 6A, CD1 = 6C, SF1 = 6S, XB1 = RB, `C 1` = ZC, `S 1` = ZS, `W 1` = ZW, BO1 = ZL, SM1 = ZM, LC1 = LE, LH1 = HE. Only `CL1 <CMDTY>` is official (Duke guide p20 `[off]`).
   - Add an alias field named `generic` in `/api/commands` (keeps the word Bloomberg out of code).
   - Show `NQ1 Index` in the context dropdown and suggestions, with `NQ.V.0 back-adj` in the description column.
3. **Context only.** `NQ1 INDEX <Enter>` loads the context into the focused panel's link group and opens a **function menu** (4.7) listing the valid mnemonics, numbered sequentially. Replaces the current `missing-function` result.
4. **Bare sector.** `INDEX <Enter>` opens the sector menu (ES1, NQ1, DM1 ...); `COMDTY` opens Rates / Energy / Metals / Grains / Livestock.
5. **Digits.** `N <Enter>` activates numbered item N in the focused panel (Number `<GO>`) through a per-panel registry of numbered actions. Out of range gives "No item 42 on this screen." `N <PgDn>` jumps N pages.
6. **Help.** `MNEM HELP <Enter>` or F1 with a mnemonic typed opens that function's help. F1 once opens the focused screen's help; F1 twice within 500ms, or `HELP <Enter>`, opens the HELP index. Typed `HELP` after a mnemonic is an nq-lab adaptation; Bloomberg uses the key.
7. **New panel.** `NXTW <line>` equals Shift+Enter.
8. **History list.** `LAST` shows the last 8 commands as a numbered list.
9. **Mnemonics.** `MAIN` is an alias of `HOME`. `HL` searches the HELP text, the hypotheses and the runs (the SEARCH key runs it). `NO` toggles the event tape. `MENU` opens Related Functions. No `GPO` alias: Bloomberg's GPO is a bar chart.
10. **Links.** `{NQ1 Index GP <GO>}` in HELP, journal notes and summaries renders as a `--link` command link that runs on click or Enter.
11. **Hint notation.** `<Key>` notation with the key token coloured by group: `<GO>` `--key-go`, `<CANCEL>` `--key-cancel`, sector `--key-sector`.
12. **GO.** Enter and NumpadEnter both run the line; nothing runs on selection change. Choosing an instrument row in autocomplete loads it and shows its menu (item 3).

### 5.2 Keys

| Key | Action | Evidence |
|---|---|---|
| Esc | CANCEL: close the open list or menu; else clear a non-empty line; else return focus to the panel. From a panel, Esc focuses the command line | official (keyboard-22) |
| Enter, NumpadEnter | GO | official |
| F1 | HELP (once, twice) | KB4 legend `[off]` |
| F8 / F9 / F10 / F11 | insert ` Equity` / ` Comdty` / ` Index` / ` Curncy` | KB4 legends `[off]`. F8 accepted with the message "no equities in nq-lab" |
| End | BACK (panel history) when the line is empty or a panel has focus; inside a non-empty line, End keeps its caret meaning | KB4 `End Back` `[off]` |
| Home | focus the command line when focus is elsewhere | KB3 HOME / JHU `[sec]` |
| PgUp / PgDn | PAGE BACK / PAGE FWD, with an N prefix | KB3 legends `[off]` |
| Shift+PgUp / Shift+PgDn | command history older / newer (Up and Down stay too) | official |
| Alt+1 ... Alt+9 | focus panel N | official (Alt + panel number) |
| Alt+K | keyboard-map overlay; K again closes it | official |
| Ctrl+K | focus the command line (web convenience, kept) | `[house]` |
| Tab, Shift+Tab | move between panels, roving tabindex inside (UI_SPEC section 5, unchanged) | `[house]`, Phase 4 tested |

- **Tab** (critic item resolved): the draft's "Tab from the command line goes to the first amber field" (JHU, secondary, older keyboard) conflicted with UI_SPEC section 5. UI_SPEC wins: it is built and tested in Phase 4 and it is the keyboard model axe and the e2e suite rely on. Inside the command line, Tab still completes while the suggestion list is open. UI_SPEC section 5 needs no change for Tab.
- **Drop** the P1 F-key plan (F2 REG, F4 LEDG, F8 LIVE, F9 HOME): it collides with Bloomberg's yellow keys. The custom key buttons (4.2) replace it.
- **Do not bind** MENU to the ContextMenu key: no Bloomberg basis (KB4 has MENU in the top row; KB3 had it on End).
- **Not bindable**: PANEL on the Windows key, PRINT on PrtScr, F12.
- **Browser capture of F1/F10/F11 is unverified.** Each bound F-key needs a Playwright test asserting `defaultPrevented` and no browser action. If F11 cannot be held, HELP says "type CURNCY".
- **Per-panel history**: an immutable `{back: string[], fwd: string[]}` per panel, capped at 50. MENU pressed again moves up one level; Esc closes.

---

## 6. Charts

Common rules: `--font-sans` at `--fs-chart`, background `#000000`, a solid white 1px axis line on the **right**. Major ticks extend 6px past the axis at each label; minor ticks 3px, halfway between. Labels white, left-aligned 2px after the tick. Gutter about 57px; right padding 26px (about 2.5%) between the last bar and the axis. Source: charts-price-axis-right, confirmed on the official 2021 PDF.

### 6.1 Shared elements

- **Grid** (critic item resolved): a per-chart setting, **off by default on every chart**. The official 2021 GP, GPC plus G 354 compare line charts have no grid (charts-grid corrected; single-source-tokens `chart-grid`). When switched on: 1px, dash `[2,2]`, `--chart-grid #505050` (TSIG Feb 2021 lossless `[px]`), horizontal at labelled ticks and vertical at month or period boundaries. The 2024 GP value `#626262` and the saved G #BTV solid grid are later or user-saved variants.
- **Legend**: HTML overlay at top-left, inset 6 to 12px.
  - `background:var(--legend-bg); border-radius:3px; font:13px/16px var(--font-sans); grid-template-columns:13px auto auto; column-gap:6px`. The 3px radius is the only rounded corner in the spec `[px]`.
  - Rows: a 13px colour square, the name with an axis tag `(R1)`/`(L1)`, the value right-aligned.
  - Single series: `Last price / High on <date> / Average / Low on <date>`. Values track the cursor.
  - Replaces the `.crosshair-readout` bar under the chart, which stays only as the table-view fallback.
- **Last-value tag**: a pentagon on the axis, 17px tall with a 5px arrow at the axis line, filled with the series colour. Text colour by contrast: black on light fills, white on blue fills. It replaces the tick label at that height.
- **X axis**: white 1px baseline and two rows. Daily data: month abbreviations centred in each month span, then years centred and split by 1px `--chart-year-div` dividers. Intraday: `HH:MM`, then the date centred on the day.
- **Pane splitter**: 5px: 1px `#242424`, 3px `#484848`, 1px `#242424`. Volume pane about 25% of the chart height, with its own right axis in M/k units, its own legend and its own tag, plus a thin white volume moving-average line (charts verifier, missed).
- **Mini toolbar**: floating at top centre on `#111111`, `#D8D8D8` text: `Track | Table | Zoom`.
- **Crosshair**: see 9.2 (best guess).
- **Event-marker data tip**: hovering a fill, roll or gate marker shows a multi-line tip on `--datatip-bg` with black text, about 15px right of the pointer tip, about 200ms after rest, hidden at once (IS-12 `[px]`, single clip). Plain tooltips elsewhere use 4.5.
- **Honesty**: the fence is an amber 1px dashed vertical line labelled `IS | 2022+ SPENT`. Roll markers use `--marker`: a full-height 1px yellow line with a yellow date tag and black text (News-tool style, official 2021 GPC, single source).

### 6.2 Series colours

- **Primary**: `#FFFFFF`, 1.5px, over a flat `--chart-area` fill down to the pane bottom (charts-primary-line-area, confirmed).
- **Benchmark or second series**: `--accent-2` `#F06000`.
- **Third and later**: Bloomberg has no fixed order (corrected: green, gold `#E0C010`, blue `#0073FF` and orange all seen as second series). Use the `--sec-*` palette in house order `[house]`.
- **Volume**: `--chart-vol` bars plus a white 1px moving-average line.
- **Candles**: up `#FFFFFF`, down `#0080FF`, wicks in the body colour, no borders (official 2021 GPC `[px]`). Alternative lime `#81C71C` / crimson `#DF2D43` (2023 marketing frame) is D6.
- **Last-price line on candles**: solid 1px `--last-line` from the last bar to the axis (2021 GPC; the colour is seen in three sources, the role in one).
- **Bollinger**: three lines, no fill: upper `#FF00FF`, middle `#FFFFFF`, lower `#00FF00`; defaults 20 periods, 2.0 SD (charts-bollinger, confirmed `[off]`). Overrides UI_SPEC's "filled band".
- **Legacy study colours** `[off]` (2003 handbook): MACD white with a red signal line; +DI green, -DI red.
- **Honest zero baseline** (UI_SPEC): kept as a `[house]` deviation. Bloomberg fills to the pane bottom; nq-lab keeps a solid white 1px zero line on EQ (Basis A) and DD.

### 6.3 Library settings

These are option objects owned by the charts theme module (Build plan task 4); Phase 5 components consume them.

**uPlot** (LineStack: EQ, DD, RR, rolling panes)
```js
axes: [
  { side: 2, stroke: '#FFFFFF', size: 45, font: '13px Bergoom',
    grid: { show: false, stroke: '#505050', width: 1, dash: [2, 2] },
    ticks: { show: true, stroke: '#FFFFFF', width: 1, size: 6 } },   // two-row labels via a draw hook
  { scale: 'y', side: 1, size: 57, gap: 2, stroke: '#FFFFFF', font: '13px Bergoom',
    border: { show: true, stroke: '#FFFFFF', width: 1 },
    grid: { show: false, stroke: '#505050', width: 1, dash: [2, 2] },
    ticks: { show: true, stroke: '#FFFFFF', width: 1, size: 6 } },   // minor 3px ticks + pentagon tags in hooks.draw
],
padding: [8, 26, 0, 8],
series: [{}, { stroke: '#FFFFFF', width: 1.5, fill: '#031D38' }, { stroke: '#F06000', width: 1.5 }],
legend: { show: false },   // HTML legend overlay from hooks.setCursor
cursor: { sync: { key: linkGroup }, points: { show: false } },
```
- Container background `#000`. Panes: a second synced instance with the same `cursor.sync` key, separated by the 5px splitter div.
- Candles (if needed in uPlot): the candlestick demo paths with the 6.2 colours.

**lightweight-charts v5** (CandleChart: GP, GIP)
```js
layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#FFFFFF',
          fontFamily: 'Bergoom, "Source Sans 3", sans-serif', fontSize: 13,
          panes: { separatorColor: '#484848', separatorHoverColor: '#626262', enableResize: false } },
grid: { vertLines: { visible: false }, horzLines: { visible: false } },  // setting on: { color:'#505050', style: LineStyle.Dashed } = [2,2] at width 1
rightPriceScale: { visible: true, borderVisible: true, borderColor: '#FFFFFF', ticksVisible: true },
timeScale: { borderVisible: true, borderColor: '#FFFFFF', rightOffset: 5 },
addSeries(CandlestickSeries, { upColor: '#FFFFFF', downColor: '#0080FF', borderVisible: false,
  wickUpColor: '#FFFFFF', wickDownColor: '#0080FF', priceLineVisible: true,
  priceLineColor: '#F09000', priceLineStyle: LineStyle.Solid, priceLineWidth: 1, lastValueVisible: true })
addSeries(HistogramSeries, { color: '#7189AA', priceFormat: { type: 'volume' }, lastValueVisible: true }, 1)
chart.panes()[1].setHeight(Math.round(h * 0.25))
```
- The library defaults `separatorColor '#E0E3EB'` and `separatorHoverColor 'rgba(178, 181, 189, 0.2)'` must be overridden (corrected from the draft's `#2B2B43`; verified in `layout-options-defaults.ts`).
- The year row of the time axis is an HTML strip; lightweight-charts has one axis row.
- The pentagon tag is a custom series primitive (`priceAxisViews` plus a pane view).
- Link-group crosshair sync: `other.setCrosshairPosition(price, time, series)` and `clearCrosshairPosition()` (API confirmed in the v5 source). Resolves the "[unverified]" note in UI_SPEC section 2.

**ECharts** (Heatmap, Distribution, BarLadder, PScatter, Swimlane)
```js
backgroundColor: '#000000',
textStyle: { fontFamily: 'Bergoom, "Source Sans 3", sans-serif', fontSize: 13, color: '#FFFFFF' },
yAxis: { position: 'right', axisLine: { show: true, lineStyle: { color: '#FFFFFF' } },
         axisTick: { show: true, length: 6, lineStyle: { color: '#FFFFFF' } },
         minorTick: { show: true, splitNumber: 2, length: 3 },
         splitLine: { show: false, lineStyle: { color: '#505050', width: 1, type: [2, 2] } },
         axisLabel: { color: '#FFFFFF', margin: 2 } },
xAxis: { axisLine: { lineStyle: { color: '#FFFFFF' } }, splitLine: { show: false } },
legend: { show: false },   // DOM overlay, as above
```
- **CORR heatmap**: `visualMap` `type: 'piecewise'` with the 2018 MOVERS scale (2.2); cell text white; diagonal `#4B4B4B`.
- **MON 27F returns**: the 4-step MON heat scale, black text except white on `#BA152D`.
- **MRET**: the SEAG ramp (2.2) as a continuous `visualMap`, text colour by contrast.
- **Distribution (RET)**: see 7.5.
- **BarLadder**: signed bars `--bar-pos`/`--bar-neg`, CI whiskers white.
- **PScatter**: points white; Bonferroni/Holm/BH lines in house colours `#FF00FF`, `#00FF00`, `#F06000`, each with a text label `[house]`.
- **Swimlane**: lane labels amber; sealed reads `--marker`; fence amber dashed.

### 6.4 Range toolbar (charts-range-toolbar, confirmed)

- **Row 1** (22px): amber date fields `[2019-01-02] - [2021-12-31]` with calendar glyphs in `--field-btn`, then `Last px`, then field dropdowns.
- **Row 2** (20px): `1D 3D 1M 6M YTD 1Y 5Y Max`, then `Daily ▾`, then `Line` and `Candle` type icons, then `Table`. Right: `« Edit chart ⚙`.
  - Buttons contiguous, 35px minimum width, 1px black separators; gradient and active styling from 4.5.
- **Spec change**: replaces UI_SPEC's `1M 6M YTD 1Y 5Y MAX`. `Max` is title case.

---

## 7. Screen templates (1920x1080)

The workspace is 1920 × 917 (tape off) between the command zone and the status line. Wireframes are about 100 columns wide, one character about 19px. Every panel has the chrome from 4.3; wireframes abbreviate the title bar as `==title==`.

**Reduced templates (recorded after the Phase 6 and 7 visual review, 2026-09-27; revised in Phase 8, 2026-09-27).** Where a template below asks for something the terminal does not have, the screen shows less rather than a value the API does not send. Phase 8 built the full templates the new API fields allow: the instrument DES tabs (`1) Profile`, `2) Coverage`, `3) Notes`, `4) Contracts (CT)` with the month-code strip, trading hours and related dates from `GET /api/instruments/{root}`), the EQ performance-difference pane, the RET per-period series beside the histogram, the RR volatility `Hi:` and `Low:` callouts, the MON 2Day sparkline column, the OOS `R` severity column, the CORR sector header row (sector order), the LIVE Routes and Fills sections with the footer strip, the GP RV22 indicator pane, and the REG tag and amendment columns with the accepted-amendments block. Also built: `98) Export` on RUNS, RUN, LEDG, EQ to MRET and CORR (a CSV of what the screen shows, made in the page; nothing is requested), `98) Report` on DES (the description as Markdown), the context field on GP and GIP, the `[27F]` field and `95) Save defaults` on MON (kept in this browser only), and the `[27F]` field on CORR. What remains reduced:
- LEDG has no white Totals row: a sum over rows is not an API value (rule 2). `[house]`
- `95) Compare` on GP and GIP is not built: a comparison on one axis needs a rebased series that `/api/bars` does not send (two back-adjusted price levels on one scale compare roll artefacts); CORR's rolling pair panel compares two symbols from the API. `[house]`
- `95) Create new` on CORR is not built: the universe is the frozen 27F, and a matrix over another set would be a new computation, not an API value. `[house]`
- LIVE: the journal records no send time, so the Routes section states the book's rule (15:59:30 ET) instead of a `Route time` column; the footer strip shows the API's totals over performance rows (routes, sent, blocked, refused, errors, fills, filled contracts, notional) with the plumbing rows counted apart, and no `%Filled` (the journal records no working quantity). `[house]`
- Instrument DES: nq-lab records trading hours and a listing cycle only for NQ and MNQ (and the listing cycle for ZT, ZF, ZN, ZB); for other roots those fields stay empty with the API's note rather than filled from outside knowledge. `[house]`
- MON 2Day: each cell asks for its own symbol once its row has been on screen (every symbol is a gated 1m read in the backend), so rows never scrolled to cost nothing; a cell shows `--` until its row is seen. `[house]`
- RR: the `Hi:` and `Low:` callouts mark the short-window volatility line (63 sessions or 12 months); both windows' extremes are also listed in words under the chart. `[house]`
- REG and LEDG in a narrow panel (a 682px HOME cell at 1366x768, LEDG at 1366px) drop their lower-priority columns rather than scroll sideways (REG: round, control p, Bonferroni, spec sha; LEDG: exp id, variant, window, fees), with a line saying so; `98) Export` saves every column. `[house]`
- HOME panel 3 leaves out the rolling Sharpe pane when the series is shorter than the window (its note says why), and a pane under 120px sets its legend on one line. `[house]`
- LIVE in a short panel (the 1366x768 split) shows the whole target-against-actual chart at rest, sized to the panel, with the rest of the screen below it in the body's scroll. `[house]`
- The RUN chart puts the benchmark in a pane of its own when a shared axis would give the strategy's line less than a fifth of its height (for example a fixture run against NQ buy and hold); the values are unchanged. `[house]`
- The RUN side panel shows one Total column, without the 7.4 `Statistics | Settings` side tabs and Long and Short columns (the run's summary has no split by side). `[house]`
- Real fill slippage (TA6) shows only beside the strategy its sample belongs to: the quote check's rows on za_orb runs, the paper book's close rows on volmanaged runs (ARCHITECTURE section 4). `[house]`

**Row budget** for a 2x2 grid panel (tape off): (917 - 2) / 2 = 457px; minus title 18, red bar 21, header 20 = 398px, so 19 rows at 20px (18 with a parameter row). With the tape on: 18 rows (17 with a parameter row). This replaces the draft's "22 rows", which assumed a thinner stack than the evidence supports.

### 7.1 HOME: Launchpad view, 2x2 (4 panels, about 19 rows each)
Model: Launchpad (component grid, link-group chips, a chart and a monitor), plus the 2026 PORT summary cards for the KPI tiles.
```
+--------------------------------------------------+ +-------------------------------------------------+
|1-GP [A] NQ1 Index ==title==                      | |2-MON 27F                        ==title==       |
|NQ1 Index ↑18432.25 +42.50 +0.23% At 2021-12-31 d | |[27F ▾] 96)Actions 97)Settings  Futures monitor  |
|Vol 312,004 O 18390.00 H 18450.75 L 18371.25      | |1) Equity      2Day  Last     1D    1W   1M  12M |
|[NQ1 Index▾] 95)Compare 96)Actions   Candle chart | | 11) CME E-mini Nasdaq ~~ 18432.25 +0.23 ... heat |
|1D 3D 1M 6M YTD 1Y 5Y Max  Daily▾                 | | 12) CME E-mini S&P    ~~  4766.18 ...           |
| candles white/blue, legend top-left, tag right   | |2) Rates                                          |
| ------------------5px splitter-----------------  | | 21) CBOT 10Y Note ...                            |
| volume #7189AA + white MA                        | |                                                  |
+--------------------------------------------------+ +-------------------------------------------------+
|3-EQ [B] rebal_v0 ==title==                       | |4-REG ==title==                                  |
|[rebal_v0▾] 96)Actions 98)Export   Equity curve   | |[<Enter filter>] 96)Actions 98)Export  Registry  |
|[Sharpe 0.99 vs 0.99][Alpha +3.5%/yr t1.18][MaxDD]| | Registered 16   Pre-reg 14   Pass 1   Fail 15    |
| white equity / orange BH / fence dashed amber    | |   Name           Verdict  n     t     p    BH q |
| perf-difference pane                             | | 1) za_v0         FAIL  2305  0.96  0.17  0.61   |
+--------------------------------------------------+ +-------------------------------------------------+
```
- LIVE and OOS panels open with Shift+Enter; they are no longer in the default layout.
- KPI tiles: `--raised` cards with 8px black gutters; value `--fs-kpi` white, label `--muted`. Twin bars `--bar-mag`.
- The current 2x3 layout (about 17 rows per panel) becomes 2x2.

### 7.2 REG and MT
Model: EQS criteria and matches, plus PORT two-level tree tables.
```
|[<Enter filter>        ] 96)Actions 97)Settings 98)Export                        Registry board |
| Rounds              |  Selected screening criteria                                    Matches |
| 1) Round 1  (3)     |  Registered hypotheses                                               17 |
| 2) Round 2  (2)     |  51) Pre-registered                                                  14 |
| ...                 |  52) Passed own bar                                                   1 |
| 9) Round 9  (1)     |  53) Survived BH q<0.05                                               0 |
| 20) Confirmations   |----------------------------------------------------------------------|
|  (left rail #1E1E1E)|      |          |      Multiple testing          |       Spec          |
|                     |   Name  Round Verdict  n    p    Ctrl p Bonf Holm BH q  sha      ok    |
|                     | 1) za_v0   1  [FAIL] 2305 0.17  0.30  1.00 1.00 0.61  b02f..fd89 yes  |
| MT: sorted p vs rank scatter (ECharts), Bonferroni / Holm / BH lines labelled, adjusted table |
```
- Enter on a row opens DES.
- Section header bands `#2D2D2D` (EQS/FSRC 2018 `[px]`); the "Universe" count row in `#5DA1DF` `[px]`.
- Verdict badges: `[PASS]` in `--c-up` text, `[FAIL]` in `--c-down` text, both in brackets, never a fill alone.

### 7.3 DES (hypothesis) and DES (instrument)
Models: 2018 flat-black equity DES (LUISS p21 `[px]`, lossless) and futures DES.
```
|[rebal_v0 HYP    ] 98)Report 99)Help                         Page 1/4  Hypothesis description |
| 1) Profile  2) Pass checks  3) Costs and blocks  4) Linked runs      (trapezoid tabs)          |
| REBAL_V0 (cyan #40EDFF)                                spec 64bf...0f33  [sha ok] [PRE-REG]   |
| Month-end pension rebalancing, bond leg ZN. Pass bar: ... (amber prose, 2 lines) ... More     |
+------------------------------+-------------------------------+------------------------------+
| 8) Equity | EQ »             | 9) Multiple testing | MT »    | 13) Registration             |
|  mini area chart             |  Bonferroni          1.00     |  Round              4        |
|  n                  56       |  Holm                1.00     |  Verdict        [FAIL]       |
|  t                1.13       |  BH q                0.61     |  15) Linked runs | RUNS »    |
|  p                0.13       | 12) Cost ladder | COST »      |   16) nt_rebal_v0_a1         |
+------------------------------+-------------------------------+------------------------------+
| [SPENT] strip where a confirmation exists | round summary (amber prose, Bergoom 15px)        |
```
- Card title bands: 20px `--raised` with white bold text (2018 DES `#1E1E1E` `[px]`). Box borders 1px `#4D4D4D`. Labels amber, values `--text` right-aligned.
- **Instrument DES** follows futures DES: `3) Notes` (data caveats, including the collapsed 2010-2015 days); `4) Contracts (CT)` with the month-code strip `Jan:F ... Dec:Z` `[off]` and H M U Z in white for NQ; columns Contract specifications, Trading hours, Related dates (roll from `mnq_roll`), Price chart `| GP »` with `Intraday | History | Curve`, Data coverage (served range, gate reads, fence).

### 7.4 RUNS and RUN
Models: BT (Strategy Definition, Strategy Analysis, Trade Table) `[sec]` video; 2026 PORT Optimization for the read-only config form `[px]`.
```
RUNS
|[<Enter filter>   ] 96)Actions 98)Export                                     Page 1/3  Runs |
| 85) All  86) Ledgered  87) Anchors  88) Probes  89) Unusable     (sub-tab strip #9E9E9E)     |
|   Run id              Strategy     Trades  Net P&L  Sharpe  MaxDD  Balance  MTM  Anchor      |
| 1) nt_dtsmom_v0_ts1   dtsmom_v0    ...     ...      0.25    ...    [OK]     ok   IDENTICAL   |
RUN
|[nt_dtsmom_v0_ts1] 96)Actions 98)Export              Backtest: strategy analysis             |
| 1) Chart  2) Trades  3) Fills  4) Decisions  5) Closes  6) Rolls  7) Config  8) Notes        |
| BalanceCheck [OK] diff 0.00 | MTM max abs diff 0.00 | coverage 2517/2517 | anchor IDENTICAL   |
+-------------------------------------------------------------+-------------------------------+
| equity (basis B) white, BH orange                           | Statistics | Settings         |
| --- splitter ---                                            | Summary   Long  Short  Total  |
| underwater                                                  | Trades     ...                |
| --- splitter ---                                            | Net P&L, Avg R, t, Sharpe,    |
| exposure                                                    | Sortino, Max DD, Avg dur ...  |
+-------------------------------------------------------------+-------------------------------+
```
- Chart about 66% of the width, statistics side panel about 33%; side tabs active `--sel-toggle` (BT `#0050BB` `[sec]` video).
- **Trades tab**: `# | Rule | Action | Date | Price | Qty | Trade P&L | Cum P&L | Total return | % max return | % min return | % max DD | Max DD length`. Newest first; entry and exit paired rows; P&L coloured; 2-line wrapped headers.
- **Config tab**: read-only. Collapsible numbered sections `⌄ 1. Factors / 2. Rules / 3. Simulation control` on `#2E2D2B` header bars (2026 optimisation PNG `[px]`, `--text` 9.56); values in `#454545` boxes, never amber.

### 7.5 EQ, DD, RET, RR, MRET (one panel, five tabs)
Model: PORT Performance (Total Return with a Performance Difference pane; EQ-1 `[px]`, four captures 2014 to 2018). The tab names Period Analysis, Seasonal Analysis and Statistical Summary are real PORT sub-tabs `[off]`, but their contents were never seen (GAP-PORT), so RET, RR, MRET use the nearest real Bloomberg screens instead.
```
|[volmanaged_v0 ▾] 96)Actions 98)Export                         Performance: equity curve       |
| 1) Equity  2) Drawdown  3) Returns  4) Rolling  5) Monthly                                    |
| Run [volmanaged_v0▾] vs [BH same-exposure▾] Time [Custom▾] [2010-01-01]-[2021-12-31] Freq[Daily▾] |
| 1D 3D 1M 6M YTD 1Y 5Y Max    ◉ Total return %  ○ Value   ☐ Log                                 |
| [Total][CAGR][Vol][Sharpe CI][Sortino][Calmar][Max DD][PSR][MinTRL][IR][TE][Alpha t]  cards    |
| legend: ■ volmanaged_v0 (R1) 2.31  ■ BH (R1) 2.19                                              |
| EQ: white strategy, #F06000 benchmark, area #031D38, fence, pentagon tags     right axis       |
| --- 5px splitter ---                                                                           |
| Performance difference (m - BH): area from 0, #007219 above, #6A1020 below, white 1px outline  |
```
- **EQ**: the upper pane as shown; the lower "Performance difference" pane is an area from 0 with a 1px white outline, `--perf-pos #007219` above (DD-1 `[px]`: 2018 GIF `#007219`, 98% flat) and `--perf-neg #6A1020` below (the midpoint of `#5E0F1C` and `#731122`, two 2018 GIFs `[inf]`). The fills are 3.42 and 1.71 on black, so the white outline carries the shape (1.4.11).
- **DD**: upper pane equity in white with the orange benchmark; lower pane the underwater curve as an area from 0 downward in `--perf-neg` with a 1px white outline and a solid white zero line (DD-1 `[px]`; the underwater mapping is `[inf]`, no native PORT drawdown screen exists). Top-10 drawdown table below: `# | Start | Trough | Recover | Depth | Length` `[house]`. Replaces best-guess 9.7 of the draft.
- **RET**: modelled on the HS and GV histogram side panel (RET-1 `[px]`, 2021 GIFs). A **horizontal** histogram sharing the y (return) axis with a daily-return time series on the left; count axis at the bottom; a fitted normal curve in `--dist-curve #F79400`; dashed `--dist-curve` lines at the mean and ±1σ; extra amber dashed lines for VaR/CVaR 95 and 99 `[house]`. Bloomberg's bars are `#397310` (≥ 0) and `#731010` (< 0); `#731010` is 1.81 on black and fails 1.4.11, so we use `--bar-pos` / `--bar-neg` **(changed)**. A stats panel on the right in HS/GV style (RET-2 `[px]`): labels amber left, values white right, one row per metric, `#292921` section bands ("Summary", "Additional stats").
- **RR**: two stacked panes (RR-1 `[px]`, GV and a study pane). Top: rolling Sharpe, 63-session in white and 252-session in `--accent-2`, with a solid `--zero-line` and a last-value tag per series. Bottom: rolling volatility as a `--roll-vol #00B5F7` line with GV-style Hi and Low callouts (white dot plus `Hi: 32.00`, `Low: 14.91`). The 63/252 pairing and the pane split are `[inf]`.
- **MRET**: modelled on SEAG `<GO>` Heat Map view (MRET-1 `[px]`, galaxy.gif 2021, and a 2015 JPEG). Columns Jan to Dec with white headers on black; a year-label column about 70px wide, right-aligned; the **first row is the N-year average** (`12 yr avg`), then years **descending**; cells show the signed value with 2 decimals, centred, on the SEAG ramp (2.2) with 2px black gutters; months not yet reached (and 2022+ months, which are behind the fence) stay black; a horizontal scale bar under the grid labelled min at the left and max at the right. SEAG has no yearly-total column; if yearly bars are kept they are `[house]` and labelled so.

### 7.6 GP and GIP
Model: 2018 LUISS GP (lossless, flat-black era) and the 2021 GPC for candles.
```
|NQ1 Index ↑18432.25 +42.50 +0.23% [spark] At 2021-12-31 16:00 d                              |
|Vol 312,004  O 18390.00  H 18450.75  L 18371.25  RV22 18.4%                                    |
|[NQ1 Index    ▾] 95)Compare▾ 96)Actions▾ 97)Edit▾                                 Candle chart |
|[2021-01-04]-[2021-12-31]  [1d▾] [repaired▾] [back▾]  ☐ Mov avgs  ☐ Rolls  ☐ Fills (RUN link)  |
|1D 3D 1M 6M YTD 1Y 5Y Max  Daily▾ | ▭ ▮ | Table                                  « Edit chart ⚙ |
|  legend: NQ1 Index - Last price / High on / Average / Low on        Track | Table | Zoom       |
|  candles up #FFF down #0080FF, last-price line #F09000, pentagon tag            18500 -|       |
|  roll markers yellow, fence amber dashed, [GATED]/[REPAIRED] session tags       18400 -|       |
|  ------------------------------ 5px splitter ------------------------------------------      |
|  Volume 312.0k  #7189AA bars + white MA                                           400k -|      |
|  ------------------------------ 5px splitter ------------------------------------------      |
|  RV22 line white                                                                              |
|   Mar  Apr  May ...                                                                           |
|         2021                                                                                  |
```
- The name line above the chart, where shown, is `--cyan-chart`.
- **GIP** is GP chrome with the title "Intraday chart", bar-size buttons `1m 5m 1h`, a two-row `HH:MM` / date axis, and dashed vertical day separators (screens_a-15 confirmed on group-402).
- A request past the fence shows the gate's refusal text in the plot, amber, centred.

### 7.7 MON
Model: GLCO / WEI futures monitor (screens_a-16, screens_a-17).
```
|[27F ▾] 95)Save defaults 96)Actions 97)Settings                          Futures monitor (27F)  |
|[Standard▾] ☐ Vol-normalised  ☐ Heat cells   Window [Daily▾]  As of [2021-12-31]                |
|1) Equity           2Day   Last       d   1D     1W     1M     3M     YTD    12M    RV    ρ/NQ |
| 11) CME E-mini Nasdaq ~~ 18432.25  x  +0.23  +1.10  -0.40  ...                                 |
| 12) CME E-mini S&P    ~~  4766.18  x  ...                                                      |
|2) Rates   (section rows: #232323 header style, numbered, white)                               |
| 21) CBOT 10Y Note     ~~   130.19  x  ...                                                      |
```
- Rows 20px, no zebra. Names amber, Last `--text`, changes in up/down text. The `x` flag in `--warn` after Last means "served to the fence".
- 2Day cell: a `#181818` sparkline, prior day `#4D4D4D`, current day white, final segment up/down.
- Heat option: fill 1D to 12M with the 4-step MON scale.
- Enter on a row opens the Related Functions popup (4.7 style, dimming only this panel): `1) GP  2) GIP  3) DES  4) CORR` for that symbol.
- No tick flash (4.6; grid flash is unverified, 9.3).

### 7.8 CORR
Model: FXC Currency Rates Matrix layout (grouped headers from FXIP), with the 2018 MOVERS colour scale (2.2).
```
|[27F ▾] 95)Create new 96)Actions 98)Export                               Correlation matrix     |
| Window [252 sessions▾]  Returns [Daily▾]  ☑ Symmetric  ☑ Clustered   As of [2021-12-31]         |
| 1) 27F        |      Equity       |        Rates         |  FX  | Energy | Metals | Grains ... |
| 11) 252 sess. |    NQ   ES   YM   |  ZT   ZF   ZN   ZB   | ...                                 |
| 12) Full      | NQ 1.00 .95 .93   | -.31 ...   4-step fills, white values in every cell         |
|               | ES .95 1.00 ...   |                                                              |
| 31) Rolling correlation NQ vs ZN (click a cell)  line chart, white, 252-session window          |
| legend: -1.00 [#6C0820][#390014][#000000][#002D09][#005713] +1.00                              |
```
- Symbol row headers amber-filled with black text (the FXC convention; labelled, not an input).
- Values always printed; colour is never the only cue.

### 7.9 LEDG
Models: HP (Historical Price Table) for density; PRTU for the totals row and date stepper.
```
|[ledger.csv ▾] 98)Export 96)Actions                                      Page 1/6  Run ledger     |
| |< < [2026-09-26] > >|  Strategy [All▾]  Balance [All▾]            Rows 214  Balanced 214       |
|  Totals (white bold)                                                                             |
|   Date        Run id              Strategy   Trades   Net P&L    Sharpe  Balance  Anchor pair     |
| Fr 2026-09-26 nt_dtsmom_v0_ts1    dtsmom_v0    ...      ...        0.25   [OK]     lo1 IDENTICAL  |
| Th ...  (weekday prefix #A5A5A5, blank row between weeks)                                         |
```
- The Totals row is white (2018 PRTU `[px]`; blue Totals were 2014 only).
- Balance column shows colour **and** text: `[OK]` / `[FAIL]`.
- A `Raw` sub-tab shows the CSV in PT Mono.
- `98) Export` replaces the draft's `90) Export` so the house numbering in 4.4 holds.

### 7.10 OOS
Model: ECO (Economic Calendars grid with day banding, 2018 lossless).
```
|[All callers ▾] 96)Actions 98)Export                                     Gate access log         |
| [2026-09-01]-[2026-09-26]  Caller [All▾]  View ◉ Log ○ Timeline      Terminal reads 7           |
| Openings: opened 2026-09-26 by user, CLOSED  pin sha ok  (card, #1E1E1E)                         |
|   Date time (ET)     A  R    Caller       Reason              Symbol  Window        Result       |
| 21) 09-26 14:02:11   ⚑  ▮▮   screen...    round 9 ...         NQ.V.0  2010..2021    served [IS]  |
| 22) 09-26 13:40:02   ⚑  ▮▮▮▮ serve_sealed confirm rebal_v1    NQ.V.0  2022..2026    SEALED READ  |
|   (days alternate #000000 / #1E1E1E bands; '--' for missing)                                     |
| Timeline tab: swimlanes by caller, fence amber dashed, sealed reads yellow markers               |
```
- Header band `#2D2D2D` (ECO 2018 `[px]`).
- Red text on the `#1E1E1E` band uses `--c-down` (4.53 passes); on `#2D2D2D` use `--c-down-raised`.
- `A` is an alert glyph (refused or sealed); `R` is a severity bar of 1 to 4 steps. Their meaning in ECO is unverified; here they are `[house]` semantics.

### 7.11 LIVE and JRNL
Model: EMSX blotter (layout only: the only screenshot is a circa-2008 legacy UI, screens_b-23 corrected), TOP and First Word lists for the journal.
```
LIVE
|[MNQZ6 ▾] 96)Actions                                                  Paper book (read only)     |
| MNQZ6  Qty 12  Target 12  c 0.62x  RV22 14.1%  USD value ...  KILL [off]  Delayed flag: no       |
| Decision 15:55:05 ET  |  Order 15:59:30 ET  |  Roll 2026-12-08 (mnq_roll)                        |
|  READ ONLY |Status  B/S  Qty  Contract Target Working Filled AvgPx  Last  Decision px  Slip     |
| --- Routes ---  Route time | Status | B/S | Qty | Contract                                         |
| --- Fills  ---  Contract | Qty | Price | Date | Time                                              |
| %Filled | Filled | Notional | # orders   (footer strip #191919)                                   |
JRNL
| 1) 2026-09-26 15:55:05  decision c 0.62x qty 12 ...                             LIVE  15:55     |
| 2) ////PLUMBING TEST, DELAYED DATA: not strategy performance//// (hatched) ...   PLMB  15:55     |
```
- B/S is coloured text: BUY `--c-up`, SELL `--c-down`.
- Journal rows numbered, amber text; source code in `--tape-src`; time amber, right-aligned.
- Styling uses the flat-black tokens, not the legacy EMSX colours.

### 7.12 HELP
Model: the Help Page (left table of contents, breadcrumb, amber prose), plus the HL layout.
```
|[<Search help>        ] 96)Actions                                      Page 1/3  Help            |
| Getting started > Help for GP        (italic breadcrumb, #53B2F5)                              |
| Mnemonics        (29) |  GP                                               (white, 2x size)     |
|  1) HOME              |  Candles and volume for one instrument, with roll markers. (amber)       |
|  2) GP  (sel #0C2B4A) |  41) Examples: {NQ1 Index GP <GO>}  {ZN COMDTY GP 1h <GO>} (blue links) |
| Keys             (14) |  Keys: <End> back  <PgDn> page  <F10> Index ...                        |
| Link groups       (3) |                                                                         |
| Keyboard map          |  KEYBOARD: drawn keyboard (Esc red CANCEL, F1 green HELP, F8-F11 yellow,|
| Licences          (6) |  End green BACK, Enter green GO, Alt+1..9 cyan PANEL) + table view      |
```
- **Selected TOC item** (critic item resolved): `--sel-bg #0C2B4A`. The draft's `#063856` came from a colour-shifted Getting Started JPEG (black renders `#02161F` in those guides) and is dropped; the only lossless HELP TOC evidence is 2013 (`#18364F`, out of era). `#0C2B4A` is the confirmed in-era selection navy; its use here is `[house]`.
- Counts right-aligned. Group headings white; items amber.
- Licences: Bergoom (OFL), Source Sans 3 (OFL), PT Mono (OFL), TradingView attribution.
- The drawn keyboard has `role="img"` plus an equivalent key/action table. Keys follow KB4: PgUp and PgDn black (green only on KB3), Print green, fraction keys cyan, MENU in the top row, PANEL at the right Windows key position. Substitutes such as Alt+1 to 9 for PANEL are labelled as substitutes.

---

## 8. Acceptance checks (QA)

### 8.1 Token values (vitest: `src/theme/tokens.test.ts`)

Parse `tokens.css` and assert each value in sections 2.1 and 2.2 exactly, for example:
- `--bg #000000`, `--data #FFA028`, `--c-down #FF2C4A`, `--fn-bar #870F1E`, `--th-bg #232323`, `--th-rule #505050`, `--sel-bg #0C2B4A`, `--cmd-border #148EFF`, `--frame-bg #CDCDCD`, `--field-btn #3F3F3F`, `--sb-thumb #787878`.
- All radii are `0`.
- `--font-sans` begins with `"Bergoom"`.
- No token value is `#070A0E`, `#94D53C`, `#FFB000`, `#063856` or `#0B51A8`.

### 8.2 Contrast (extend `src/theme/contrast.test.ts`)

Required at 4.5:1 or above (text):
- `--text`, `--data`, `--muted`, `--white`, `--c-up`, `--link` on each of `#000000`, `#1E1E1E`, `#191919`, `#232323`, `#0C2B4A`.
- `--c-down` on `#000000`, `#1E1E1E`, `#191919` **only** (5.71 / 4.53 / 4.78).
- `--c-down-raised` on `#232323`, `#0C2B4A` (5.05 / 4.62). `--c-down-hover` and `#B4B4B4` on `#3C3C3C` (4.89 / 5.32).
- `--cvd-up #3399FF` and prot down `#FF7329` on `#000000`, `#1E1E1E`, `#232323`, `#0C2B4A`.
- Black on `--field-bg` (10.31), `--frame-bg` (13.21), `--tab-on` (7.84), `--tab-hover` (13.08), `--key-*` (6.18 to 10.84), `--field-off` (7.39), `--datatip-bg` (11.67), MON heat fills except `#BA152D`.
- White on `--fn-bar` (9.92), `--fn-hover` (6.44), `--fn-press` (11.34), `--sel-list` (7.07), `--sel-toggle` (7.28), `--flag-bg` (9.92), `#BA152D` (6.50), every CORR fill (≥ 8.72), `--list-sel` (11.55).
- Amber on `--list-sel` (5.67), `--hover-menu` (5.84), `--hover-cell` (5.42); `--text` on `--tab-bg` (6.56); `--tape-fg` and `--tape-src` on `--tape-bg` (8.38 / 5.37); `--tip-fg` on `--tip-bg` (17.40); `--frame-tab-fg` on `--frame-tab-on` (12.54).
- SEAG ramp: for 101 steps along each ramp, the better of black and white is ≥ 4.5 (worst 4.60 green, 4.91 red).

Required at 3:1 or above (graphics, 1.4.11):
- `--cmd-border`, `--cmd-cursor`, `--border-int`, `--field-focus` on `#000000`, `#1E1E1E`, `#191919`.
- `--sb-thumb` on `--sb-track` (3.60); `--list-border` on `#1E1E1E` (8.40).
- Chart series `#FFFFFF`, `#F06000`, `#7189AA`, `#0080FF`, `--bar-pos`, `--bar-neg` on `#000000`.

**Negative tests** (a check must be born failing): `#FF2C4A` on `#232323` (4.27), `#FF1E3E` on `#1E1E1E` (4.37), black on `#BA152D` (3.23), `#A5A5A5` on `#3C3C3C` (4.48), `#646464` on `#222222` (2.69) and `#731010` on `#000000` (1.81) must all **fail** the checker.

### 8.3 No Bloomberg name or files

- A CI grep: `rg -i "bloomberg|\bbbg\b" web/src web/index.html web/public` returns nothing; `docs/` is exempt.
- `rg -i "Prop Unicode|Fixed Unicode"` across the repo returns nothing.
- No font file other than Bergoom, Source Sans 3 and PT Mono under `web/`.
- No file from `SCR\` is committed: no reference PNGs in `web/e2e/__screenshots__`.
- `dockview-enterprise` absent from `package.json` and the lockfile.

### 8.4 Keyboard and grammar (vitest parser plus Playwright)

- **Parser**: `NQ1 INDEX GP 1d`, `NQ INDEX GP`, `NQ GP`, `TY1 COMDTY DES` (resolves to ZN), `INDEX`, `NQ1 INDEX` (load plus menu), `3` (select), `GP HELP`, `NXTW NQ GP`, `LAST`. Rejects `NQ COMDTY` (message names F10) and `27F INDEX CORR`.
- **Keys**: Esc cascade; F1 once and twice; F9/F10/F11 insert suffixes with `defaultPrevented` and no browser action (no full screen, help tab or menu focus); End back; Shift+PgUp history; Alt+1 to Alt+4 focus; NumpadEnter runs; Tab still moves between panels.
- **Number `<GO>`**: `7 <Enter>` on REG opens DES for row 7; `42` gives "No item 42 on this screen."
- **Caret**: blinks with `--caret-phase` when focused; steady under `prefers-reduced-motion`; hidden when unfocused.

### 8.5 Screenshot review against references

For each screen, a reviewer compares our 1920x1080 capture with the listed images (all in `SCR\`, never committed) on row order, colours (sample with any picker) and density.

| Our screen | Reference images |
|---|---|
| Global chrome, panel stack, tables | `verify-chrome\mdm\p29_1_755x647.png` (Dec 2020 native), `clones_legal\bbimg\cvd8full_0.png` (tab strip, key toolbar), `window-frame-stack\z_mdm29_top.png`, `window-frame-stack\z_cvd8_tl.png` |
| Key toolbar, PDFU palette, CVD schemes | `verify-clones_legal\CVD-8_f0.png`, `f48.png`, `f60.png` |
| Command line states and caret | `interaction-states\fr\cl_141.5.png`, `cl_142.5.png`, `port_412_c.png` (unfocused) |
| Autocomplete | `verify-palette\accounts_133040_images_command_line_2.png`, `verify-keyboard\duke\pg10_Im0.png`, `interaction-states\fr\bt_ac_full.png` |
| Red-bar states and menus | `interaction-states\fr\tsig_hover_launch.png`, `tsig_menu_hover.png`, `tsig_create.png`, `chsig_c.png` |
| Related Functions menu | `verify-keyboard\duke\pg14_Im0.png`, `screens_a\cbs_eurusd.png` |
| Field lists, grid hover, scrollbars, tooltips | `interaction-states\fr\bd_608.png`, `pg_3c_c.png`, `port_sb.png`, `pz_294.583.png` |
| Modal dim scope | `interaction-states\fr\md_seq.png`, `pm_seq.png` |
| GP candles | `verify-charts\cotm_p6_0.png`; GP line: `verify-charts\cran4.png`, `cran5.png`; G compare: `verify-charts\cotm_p4_0.png`, `cotm_p5_0.png`; 2018 GP: `verify-screens_b\LUISS_2018Pr\p21_i1_1280x720.png` |
| DES | `verify-screens_b\LUISS_2018Pr\p21_i0` (2018 lossless); instrument DES: `screens_a\scranton_p59_0.png` |
| Tabs, sub-tabs, filter row | `palette\pro_News-on-your-terms-4.png`, `verify-palette\Accessing-Bl\p4_0_720x437.png` |
| EQ and DD | `tearsheet\g\last\327815378.png`, `327580908.png` |
| RET | `tearsheet\g\last\volume.png`, `tearsheet\commbro\p7_i1_1267x556.jpeg` |
| RR | `tearsheet\g\last\moneyness.png`, `deviation.png` |
| MRET | `tearsheet\g\last\galaxy.png`, `tearsheet\asm_shot12.jpg` |
| RUN / RUNS | `verify-screens_b\bt_920.png`, `bt_895.png`, `bt_700.png`; config: `screens_b\web\build-more-resilient-portfolio.png` |
| REG | `screens_b\LUISS_2018Primer\p26_i1_1280x720.png`, `p24_i1_1280x720.png` |
| MON | `screens_a\scranton_p58_0.png`, `scranton_p20_0.png`, `scranton_p58_1.png` (popup) |
| CORR | `screens_a\scranton_p62_1.png` (FXIP layout); colours `verify-screens_b\LUISS_2018Pr\p7_i0_1280x720.png` (MOVERS) |
| OOS | `screens_b\LUISS_2018Primer\p16_i0_1280x720.png` (ECO) |
| LEDG | `screens_a\scranton_p30_1.png` (HP), `screens_b\LUISS_2018Primer\p33_i0_1280x720.png` (PRTU) |
| HELP | `screens_b\gsg\p23_i0_733x490.png` (layout only; colours shifted), `verify-chrome\Bloom\p18_0_470x366.png` (HL) |
| Event tape and status | `verify-screens_b\crop_ticker.png`, `screens_b\LUISS_2018Primer\p29_i0_1280x720.png` |
| Fonts | `verify-typography\bergoom_demo.png`, `verify-typography\fonts\mono_zeros.png` |

Pass criteria:
- (a) Chrome order and heights within ±2px of section 4.1 (37 / 32 / 22 / 50 / workspace / 22).
- (b) Sampled flat fills match the tokens exactly.
- (c) A 2x2 HOME at 1080p with the tape hidden shows at least 19 data rows in each grid panel without a parameter row, 18 with one (section 7 row budget).
- (d) No blue-tinted surface, lime colour or rounded corner remains (the chart legend's 3px radius excepted).
- (e) No transition on any colour or background (a grep for `transition` in chrome/panel/grid CSS finds only `opacity` or `transform`).

---

## 9. Best guess (unverifiable findings; use only with a visible "house choice" note)

1. **Link-group chip colours.** A `#66ABFF` (Launchpad badge, one 2017 PNG), B `#D7B8FF`, C `#8FE3E0` (current house tints). Black letters (8.83 / 12.19 / 14.23). The 2011 Launchpad shows A blue `#3082C3` and D olive `#6B7F04`, one image each.
2. **Crosshair.** Lines `#BFBFBF`, 1px solid; axis labels `#C0FFFF` with black text (18.99 on black). The labels were seen in one 2018 CBS capture only; no image shows the lines. BT shows thin lines to the right and bottom axes (IS-12, video).
3. **Tick flash in grids.** Not built. Header quotes do not flash (IS-13, measured). The only grid evidence is one Launchpad frame with solid green or red cells; monitor footage of live ticks does not exist. If ever added: a hard cut, never animated, and off under reduced motion.
4. **Panel title bar height.** 18px. The Launchpad component bar measures 13px but may be cropped; the full Bloomberg window frame is 31px.
5. **Previous-close line.** Dotted amber with amber change text beside the tag (one 2015 GIF).
6. **Backtest markers.** Green `#3BB53C` rounded 12px badges for fills (one 2023 marketing frame).
7. **Drawdown chart.** Superseded by 7.5 DD (PORT Performance Difference fill). Kept here only to record that no native PORT drawdown screen was found.
8. **Deuteranopia in-product tints.** Up `#6BCEFF` text and `#399CFF` cells, down `#FF5A73` (single GIF). The spec uses the passing values from 2.3.
9. **Selected radio and checkbox fill** `#399CFF` (one GIF).
10. **Caret blink rate.** 1000ms per phase from two native captures; Bloomberg's own Pro Tip clip gives about 550 to 600ms, close to the Windows default of 530ms, so the Terminal may follow the OS setting. Kept as the `--caret-phase` token.
11. **Menu hover** `#BDBDBD` with dark text (2017 downscaled). The spec uses `--hover-menu #373737`, confirmed in 2020.
12. **Chart text size.** 11 to 13px; Bloomberg makes it a user setting.
13. **ECO `A` and `R` column meanings**, and the contents of PORT Period Analysis, Seasonal Analysis and Statistical Summary: only tab names seen.
14. **Futures ticker aliases** (`NQ1 Index` and others): secondary sources; only `CL1 <CMDTY>` is official.
15. **Resize and zoom.** Newer Bloomberg apps show more content on resize and never scale fonts; Launchpad offers a zoom slider and custom zoom percentage (IS-15 `[sec]`). We reflow and never scale fonts with panel size; a per-layout zoom is not built.
16. **Inactive layout tab style** in the frame strip: dark text on `#CDCDCD`, no capture.
17. **Key-button label weight and face.** Black, uppercase, about 11px; regular weight in a geometric sans (wfs-02b). We use Bergoom 11px regular.

## 10. Open decisions for the user

- **D1 Row height.** Bloomberg density is 20px rows (19 per 2x2 grid panel at 1080p), but UI_SPEC 2.5.8 sets 24px rows.
  - Proposal: 20px rows, with Number `<GO>` in the command box as the equivalent control that meets 2.5.8.
  - Alternative: keep 24px rows (about 15 per 2x2 grid panel).
- **D2 Font source.** Vendor Bergoom (best likeness; needs the spec change in 3.1), or `@fontsource/source-sans-3` only (same skeleton, slightly less like the Terminal).
- **D3 Command line per panel.** Proposal: one global box labelled with the focused panel number, quote headers inside instrument panels (4.6). A true per-panel input, as in the Terminal, is a larger dockview change.
- **D4 Event tape** on or off by default. It costs 57px (one row per panel).
- **D5 ZN price format.** Bloomberg fonts have 1/32 and 1/64 fraction glyphs; ours do not. Choose `130-06+` or `130'06.5` for Treasuries.
- **D6 Candle palette.** Official 2021 white/blue (default) or 2023 lime/crimson.
- **D7 Status line.** 22px one-line status (proposal, `[house]`) or Bloomberg's 43px Information Panel (two lines of Suggested Functions; costs one row per panel).

### 10.1 Critic items: resolution

| Critic point | Resolution |
|---|---|
| Key bar invented INDEX, COMDTY, CURNCY, LAST, HOME | Fixed (4.2): official key order kept; sector buttons removed; HOME and our mnemonics are labelled custom buttons `[house]` |
| Frame stack contradicted evidence | Fixed (4.1): rebuilt from the measured stack; departures listed and labelled |
| `--flag-bg` mislabelled as confirmed | Fixed: now `[house]` |
| HELP TOC `#063856` from a colour-shifted JPEG | Fixed: `--sel-bg #0C2B4A` `[house]` use (7.12) |
| Focused-panel bold and white outline unsourced | Fixed (4.3): evidence-based cues plus a labelled `[house]` accent line |
| "Line = grid on" unsupported | Fixed (6.1): grid off by default everywhere, per-chart setting |
| Unlabelled rules (dim, 20px keys, 73% width, 90s numbering) | Fixed: dim now measured (IS-10) and scoped; keys 24px (official); width 680px `[inf]`; numbering `[house]` |
| Tab rule conflicted with UI_SPEC | Fixed (5.2): UI_SPEC wins, stated |
| Scrollbars missing | Fixed (2.2, 4.8): measured values plus an AA thumb fix |

### 10.2 Still open (not resolvable from the evidence)

- No lossless full-window capture with tabs, key toolbar and a known 100% scale together; tab strip and key toolbar heights come from a 1.5x GIF and a compressed video.
- Grid-cell tick flash, the crosshair line style and range-button hover were never captured.
- Link-group chip colours (9.1).
- Browser capture of F1, F10, F11 (needs the Playwright tests in 8.4). The Playwright tests prove the page prevents the default and inserts the suffix, but synthetic key events cannot show whether a real keypress reaches the page before the browser acts (F11 full screen in particular). A manual check in each supported browser is still open; HELP names the typed fallback (2.4).
- PORT Period Analysis, Seasonal Analysis and Statistical Summary contents; BTST/HVG/HVT screens.
- CORR has no in-era Bloomberg screen; the MOVERS scale is an adaptation.
- The designer of Bloomberg Fixed (Carter per Bloomberg, Monotype per one insider): no effect on the build.

---

## 11. Sources

Official Bloomberg documents and images:
- Market Data Manual, Dec 2020: https://assets.bbhub.io/professional/sites/10/Market-Data-Manual_Eng_Dec2020.pdf
- Terminal tour and install guide: https://assets.bbhub.io/professional/sites/10/terminal_tour_install_30en.pdf
- Accessing Bloomberg Indices on the Terminal (2020): https://assets.bbhub.io/professional/sites/10/Accessing-Bloomberg-Indices-on-the-Terminal.pdf
- Accessing Fixed Income Indices (2021): https://assets.bbhub.io/professional/sites/27/Bloomberg-Indices_Accessing-Fixed-Income-Indices-on-the-Terminal.pdf
- Terminal Mode Citrix overview: https://assets.bbhub.io/professional/sites/10/Terminal-Mode-Citrix-Workspace-Overview.pdf
- Charts of the Month, March 2021: https://assets.bbhub.io/promo/sites/12/1046398-ChartsoftheMonth_March2021.pdf
- Charts of the Month, May 2021: https://assets.bbhub.io/professional/sites/10/Charts-of-the-Month-May-2021.pdf
- Chartbook, Feb 2021 (file named Feb-18): https://assets.bbhub.io/professional/sites/10/Chartbook-Marketing-Book-Feb-18.pdf
- LUISS 2018 Primer: https://data.bloomberglp.com/professional/sites/10/LUISS_2018Primer.pdf
- Getting Started Guide for Students: https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf
- Keyboard 4 guide: https://data.bloomberglp.com/professional/sites/20/bloomberg_keyboard_4_guide.pdf
- Keyboard 3 guide: https://data.bloomberglp.com/professional/sites/20/bloomberg_keyboard_3_installation_guide1.pdf
- David Allen PORT white paper (2014): https://assets.bbhub.io/professional/sites/10/David-Allen-WP.pdf
- PORT brochure: https://data.bloomberglp.com/professional/sites/4/Portfolio_and_Risk_Analytics_Brochure4.pdf
- Pro Tip GIFs (SEAG, HS, GV, study pane, PORT): https://assets.bbhub.io/professional/sites/10/galaxy.gif, .../volume.gif, .../moneyness.gif, .../deviation.gif, https://data.bloomberglp.com/professional/sites/10/327815378.gif, https://assets.bbhub.io/professional/sites/10/327580908.gif
- Colour accessibility article and images (via Wayback): https://web.archive.org/web/20250104104154/https://www.bloomberg.com/ux/2021/10/14/designing-the-terminal-for-color-accessibility/ ; https://assets.bbhub.io/company/sites/34/2021/10/CVD-8.gif ; https://assets.bbhub.io/company/sites/34/2021/10/CVD-7-a.jpg
- Product pages: https://professional.bloomberg.com/products/bloomberg-terminal/ ; https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/ ; https://professional.bloomberg.com/products/bloomberg-terminal/charts/
- Trademark notice: https://data.bloomberglp.com/professional/sites/10/Trademark-Notice.pdf ; USPTO https://tsdr.uspto.gov/statusview/rn2964028 and https://tsdr.uspto.gov/statusview/rn6456886

Secondary (guides, video, code):
- Getting Started with Bloomberg (CityU, 2013): https://www.cb.cityu.edu.hk/ef/msc/handbook/2015/doc/Getting_Started_with_Bloomberg.pdf
- Kent Terminal guide: https://blogs.kent.ac.uk/kbs-news-events/files/2017/10/Bloomberg-Terminal-Guide.pdf
- Launchpad guides: https://financetapmi.wordpress.com/wp-content/uploads/2018/10/launchpad-basics.pdf ; https://library.iima.ac.in/public/download/bloomberg/launchpad.pdf
- Scranton training manual: https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf
- UNF tutorial: https://www.unf.edu/coggin/_files/ccb/certified.rf.Bloomberg-Tutorial-8-8-2023.pdf
- Cranfield GP screenshots: https://blogs.cranfield.ac.uk/library/price-graph-bloomberg/
- CBS libguide images: https://libguides.cbs.dk/gp_function_bloomberg
- Videos: BT demo https://www.youtube.com/watch?v=oEyiqowOoJY ; PORT walkthrough https://www.youtube.com/watch?v=cOT1TuPHaGY ; Pro Tips https://www.youtube.com/watch?v=kOG5PH29l_U , https://www.youtube.com/watch?v=kIHT5GDl0BE , https://www.youtube.com/watch?v=XnLH1u8qCU4
- Hacker News insider comments: https://news.ycombinator.com/item?id=40432259 , https://news.ycombinator.com/item?id=40430904 , https://news.ycombinator.com/item?id=11722209
- Fonts: https://github.com/dchest/bergoom ; https://github.com/jx22/berg ; @fontsource/source-sans-3 and @fontsource/pt-mono on npm
- lightweight-charts source: https://github.com/tradingview/lightweight-charts
- Case law: Lotus v Borland https://law.justia.com/cases/federal/appellate-courts/F3/49/807/545474/ ; Navitaire v easyJet https://www.bailii.org/ew/cases/EWHC/Ch/2004/1725.html ; SAS v WPL https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62010CJ0406

---

## 12. Build plan

Runs after the Phase 4 QA gate and before Phase 5 (chart kit). Four tasks in parallel on disjoint files under `terminal/web`. Token names and component contracts are fixed by this document, so each task can reference another task's names before the merge. Each task writes vitest tests first; each keeps `pnpm test:types` and `pnpm test` green on its own branch.

**Shared contracts (fixed here so the tasks do not block each other):**
- Token names: exactly those in section 2.
- `src/chrome/NumberedActions.ts` (owned by task 2): `registerNumbered(panelId: string, items: ReadonlyArray<{ n: number; label: string; run: () => void }>): () => void` and `activateNumbered(panelId: string, n: number): boolean`.
- `WorkspaceController` (owned by task 3) adds `goBack(panelId: string): boolean` and `goForward(panelId: string): boolean`; task 2 calls them from End and the `< >` buttons.
- `src/charts/theme/index.ts` (owned by task 4) exports `uplotTheme`, `lwcTheme`, `echartsTheme` as plain option objects with no library import.

### Task 1: tokens and fonts

- **Files:** `src/theme/tokens.css`, `src/theme/index.css`, `src/theme/contrast.ts`, `src/theme/contrast.test.ts`, `src/theme/tokens.test.ts` (new), `src/theme/noBrand.test.ts` (new), `src/assets/fonts/bergoom/**` (new: five woff2 plus `LICENSE.md`, unmodified), `src/main.tsx` (font imports only), `package.json`, `pnpm-lock.yaml`.
- **Work:** every token in section 2 including CVD themes; radii 0; `--font-sans` and `--font-mono` stacks with `@font-face` for Bergoom; add `@fontsource/source-sans-3` and `@fontsource/pt-mono` at exact pins; remove Inter, Space Grotesk and JetBrains Mono packages and imports; delete `.eyebrow`, `.disp`, `'zero'`, `'cv05'`, `'ss01'`; body font size 15px; `::selection` to `--sel-bg` with `--text`.
- **Acceptance:** 8.1 and 8.2 pass including the negative tests; the 8.3 name grep and font-file checks run as `noBrand.test.ts`; `tsc -b` clean; no token value from the banned list.

### Task 2: chrome (frame strip, key toolbar, nav toolbar, command line, message line, status line, tape, grammar)

- **Files:** `src/chrome/CommandLine*`, `src/chrome/ContextStrip*`, `src/chrome/StatusBar*`, `src/chrome/HelpScreen*`, new `src/chrome/FrameStrip*`, `src/chrome/KeyToolbar*`, `src/chrome/NavToolbar*`, `src/chrome/MessageLine*`, `src/chrome/EventTape*`, `src/chrome/NumberedActions.ts`, `src/commands/**`, `src/App.tsx`, `src/AppCommandBar.tsx`, `src/copy/chrome.ts`, `src/copy/commands.ts`, `src/copy/help.ts`, new `e2e/keys.spec.ts`.
- **Work:** the global stack of 4.1 and 4.2; caret blink and states; grouped autocomplete; message line replacing toasts; status line of 4.10; tape of 4.9 with `NO`; grammar and keys of section 5 (sector tokens, generic aliases, context-only menu, digits, `HELP` suffix, `NXTW`, `LAST`, F1/F8 to F11/End/Home/PgUp/PgDn/Shift+PgUp/Alt+n/Alt+K); HELP keyboard map and licence list (7.12).
- **Acceptance:** 8.4 passes (parser units and `keys.spec.ts`, including `defaultPrevented` for each F-key); chrome heights 37 / 32 / 22 / 50 / 22 at 1920x1080 measured in Playwright with `boundingBox()`; message line has `aria-live="polite"`; axe clean; every existing Phase 4 command-line test still passes or is updated with a stated reason.

### Task 3: panels and tables

- **Files:** `src/chrome/PanelChrome*`, `src/chrome/Workspace*` (css, tsx, Model, Controller, Layouts, Focus, Screens, Placeholder, Storage), new `src/chrome/FunctionBar*`, `src/chrome/TabStrip*`, `src/chrome/Field*`, `src/chrome/RelatedMenu*`, `src/chrome/QuoteHeader*`, `src/chrome/Tooltip*`, new `src/grids/grid.css` (table styles that the Phase 5 MonitorGrid imports), `src/copy/frame.ts`, `src/copy/workspace.ts`, new `e2e/panels.spec.ts`.
- **Work:** panel title bar, quote header, red function bar with states and red dropdown menus, trapezoid tabs, sub-tabs, parameter row, amber fields and lists; grey and toggle buttons, tooltips, Related Functions menu with panel-scoped dim, focused-panel cue (4.3), table styles and interaction states (4.8, 4.12), scrollbars, 2x2 HOME default layout, per-panel back and forward history, registering numbered items through `NumberedActions`.
- **Acceptance:** 2x2 HOME at 1920x1080 meets 8.5 (c) row budget on the placeholder grids; tab slant 5px and radius 0 checked by computed style; menu dim covers only the owning panel (Playwright: the command line stays clickable while a menu is open); hovered-cell overrides pass the 8.2 pairs; Tab still visits every panel with a visible 2px white ring; axe clean.

### Task 4: charts theme

- **Files:** new `src/charts/theme/**` (`chartTokens.ts` reading the CSS variables, `uplotTheme.ts`, `lwcTheme.ts`, `echartsTheme.ts`, `scales.ts` for the MON/CORR/SEAG ramps with their text-colour rule, `index.ts`), `src/charts/ChartA11y.css`, `src/charts/theme/*.test.ts`.
- **Work:** the option objects of 6.3 with grid off by default and a `withGrid()` switch; legend, pentagon tag and splitter geometry constants; range-toolbar button spec (6.4); SEAG/MOVERS/MON heat functions returning fill and text colour; the table-view styles in `ChartA11y.css` restyled to the grid look.
- **Acceptance:** unit tests assert every colour in the option objects equals the matching token value (no stray hex); the lightweight-charts separator defaults are overridden; `scales.ts` returns text colours that pass 4.5 for 101 steps on each ramp; no chart library is added to `package.json` (Phase 5 adds them).

### After the merge (one step, not parallel)

- Regenerate the Playwright baselines once at 1920x1080 and 1366x768.
- A visual reviewer runs 8.5 against the `SCR\` references and records pass or fail per row.
- Update UI_SPEC sections 1 to 3, 5, 9 plus 10 as listed in 1.3, and TASKS.md Phase 5 (MonitorGrid imports `src/grids/grid.css`; charts consume `src/charts/theme`).
