# nq-lab terminal: UI specification

Status: plan, 2026-09-26. Stack and decisions: `ARCHITECTURE.md`, `PRD.md` section 7. Contrast ratios below were computed with the WCAG formula; SIGNAL oklch values were converted to sRGB.

## 1. Principles

1. **Bloomberg traits, translated.** Amber data on near-black; up and down are the only semantic hues; a persistent command line of mnemonics; panels linked in groups; dense tabular figures; everything reachable from the keyboard.
2. **Honesty is visible.** nq-lab's rules show on screen (section 6), so a chart can never look more certain than the research behind it.
3. **Read only, and it says so.** The status bar always shows `READ ONLY` and `NO ORDER PATH`. There is no order ticket anywhere.
4. **Nothing animates numbers.** No count-ups, no reveal effects. `prefers-reduced-motion` is honoured for the little motion there is (panel focus, dropdown).
5. **Colour is never the only cue.** Signed numbers carry `+` or `-` and ▲ or ▼; legends carry a text symbol.

## 2. Frame

```
+--------------------------------------------------------------------------------------------+
| nq-lab> _                           | A:NQ  B:volmanaged_v0  C:-  |  READ ONLY  NO ORDER PATH |  28px CMD bar
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|   dockview workspace: panels with 28px headers, tabs, split and float; popout for monitor 2|
|                                                                                            |
+--------------------------------------------------------------------------------------------+
| SCR 00 HOME | A NQ | B volmanaged_v0 | DATA 2010-01-01..2021-12-31 | TWS: not monitored |   |  22px status bar
| KILL: off | gate reads 7 | 14:02:11 ET | Esc cmd                                          |
+--------------------------------------------------------------------------------------------+
```

Target 1920x1080; minimum 1366x768 (panels stack to two columns). Default layouts per screen live in one declarative table, `web/src/chrome/WorkspaceLayouts.ts` (Phase 7.4 may split it per screen). Layouts are fixed: dockview group tab strips are hidden (the panel header replaces them) and panels do not resize by dragging, because a 4px sash drag has no keyboard or single-pointer equivalent (WCAG 2.1.1, 2.5.7). A user layout is the panel set a command leaves (Enter replacing a panel, Shift+Enter adding one); it is kept in `localStorage` as a per-viewer convenience, saved only after such a command, and tied to the default it came from, so a changed default replaces it (wrapped in try/catch; the default layout renders if storage fails).

**Panel header** (SIGNAL `.panel-head`, compacted): link chip `[A]` `[B]` `[C]` `[-]` with a colour stripe and the letter, title in `.eyebrow` style, mnemonic, tag (`[PRE-REG]`, `[POST HOC]`, `[SPENT]`, `[PLUMBING]`, `[UNUSABLE: BALANCE]`), table-view toggle, overflow menu.

**Link groups.** Setting a context in one A panel retargets every A panel and syncs the time crosshair across them (uPlot `cursor.sync` key per group; lightweight-charts crosshair position set programmatically [v5 API name `setCrosshairPosition` unverified; Phase 5 confirms]). `[-]` panels are unlinked.

## 3. Design tokens

Base: the SIGNAL dark theme (the owner's own design system), token names kept so components port without renames, with two fixes (`--down`, `--border-int`).

| Token | Value | On `--raised #171C22` | On `--surface #0F1318` | Use |
|---|---|---|---|---|
| `--bg` | `#070A0E` | | | page |
| `--surface` | `#0F1318` | | | panel body |
| `--raised` | `#171C22` | | | panel header, dropdowns |
| `--text` | `#EFF2F5` | 15.25 | 16.59 | labels, prose |
| `--data` (new) | `#FFB000` | 9.35 | 10.17 | every non-semantic number |
| `--muted` | `#8D9399` | 5.52 | 6.01 | secondary labels (11px floor) |
| `--accent` | `#94D53C` | 9.66 | 10.51 | focus ring, selection, active link |
| `--accent-2` | `#E8AA4E` | 8.40 | 9.13 | benchmark lines |
| `--c-up` | `#23C987` | 7.98 | 8.68 | positive |
| `--c-down` | `#FF5C5C` (replaces SIGNAL `#E64343`, which is 4.28 on raised and fails 1.4.3) | 5.66 | 6.16 | negative |
| `--cvd-up` (P1 theme) | `#4DA3FF` | 6.53 | 7.10 | up in CVD mode |
| `--border` | `oklch(1 0 0 / 9%)` | decorative | | panel dividers |
| `--border-int` | `#646C77` (replaces the 14% alpha; `#4A505A` gives only 2.1 to 2.4) | 3.23 | 3.51 | input and control boundaries (1.4.11) |
| `--sel-bg` | `#2A1F00` | amber 8.85, text 14.44 | | selected grid row |
| `--fence` | `#FFB000`, dashed | 9.35 | | 2022-01-01 line |

Sector palette for the 27 futures (each at least 7.3:1 on `--raised`): Equity `#6CB6FF`, Rates `#B39DFF`, FX `#38C7E8`, Energy `#FF8A3D`, Metals `#E0C060`, Grains `#9CCC65`, Livestock `#F48FB1`, Benchmark `#8D9399`.

Keep SIGNAL's rule: never put a `var()` oklch colour in a CSS transition.

**Type.**
- Data: JetBrains Mono 12px/16px, `font-feature-settings: 'tnum' 1, 'zero' 1` (`zero` unverified; dropped if it does not render).
- Labels: 11px uppercase, `letter-spacing: .07em` (SIGNAL `.eyebrow`).
- Prose (spec text, summaries): Inter 13px.
- KPI headline numbers: Space Grotesk 600 (SIGNAL `.mchip .v`).
- 11px minimum anywhere. Numbers right-aligned, fixed decimals per column, explicit `+`, ASCII `-`.
- Fonts self-hosted through @fontsource.

**Themes.** `dark` (default, P0); `dark+cvd` (P1, `data-cvd="deut"`: up `#4DA3FF`, down `#FF5C5C`); `amber-classic` (P2, `--text` becomes amber). No light theme.

## 4. Reuse from the SIGNAL design system

From the SIGNAL design system:
- `globals.css` lines 10 to 25: the `@theme inline` mapping of `--color-*` to runtime variables.
- Class grammar: `.eyebrow` (panel titles), `.panel` and `.panel-head` (panel chrome), `.mchip` (KPI tile; the `data-tip` hover becomes a focusable `aria-describedby` popover), `.crosshair-readout` (readout bar under every chart), `.statusline` (status bar), `.cmdk` (command-line dropdown), `.rail nav .ix` (numbered index on `HELP`), `.tag-b` (bracket tags), `.term-switch` (segmented toggles), `.dstrip` (in-sample against sealed strip on `DES`).
- `CommandPalette.tsx`: the grouped results and the `fuzzy()` function (lines 17 to 24) only. The markup is not reused (plain `div` rows without `role="option"`); the styling goes onto cmdk's combobox. The prompt becomes `nq-lab>`.
- `StatusLine.tsx`: the segment layout.
- `EquityChart.tsx` and `Drawdown.tsx` conventions, rebuilt on uPlot: honest zero baseline with a dashed zero line, gradient fills, hover readout, `aria-label` data summary, reduced-motion guard.
- Not ported: `Reveal`, `CountUp`, the hero, Supabase, i18n, the Rail page layout (DL2).

From an earlier charting reference: shared time axes with a synced crosshair; range buttons `1M 6M YTD 1Y 5Y MAX` instead of a range slider; no line across warm-up NaNs; Bollinger bands as a filled band. Its white-background up and down colours are not reused.

## 5. Command line

```
<context> <FUNCTION> [args] <Enter>
context := instrument (NQ ZN ES CL ... the 27 futures) | hypothesis (za_v0, rebal_v1_confirm)
         | run id (nt_dtsmom_v0_ts1) | 27F (the universe) | omitted: the focused panel's link-group context
Shift+Enter opens the result in a new panel instead of replacing the focused one.
Up and Down in the empty line walk the history. Suggestions come from /api/commands.
```

Examples: `NQ GP`, `NQ GIP 2019-03-14`, `volmanaged_v0 DES`, `nt_dtsmom_v0_ts1 RUN`, `27F CORR`, `REG`.

### Mnemonics

| Mnemonic | Screen | Pri |
|---|---|---|
| `HOME` | Launchpad | P0 |
| `GP` | Candles, volume, indicator pane (timeframes 1m, 5m, 1h, 1d) | P0 |
| `GIP` | `GP` for one date, intraday (DL18) | P0 |
| `DES` | Hypothesis tear sheet (context is a hypothesis) or instrument description | P0 |
| `REG` | Registry board | P0 |
| `MT` | Multiple-testing view | P0 |
| `RUNS` | Nautilus runs table | P0 |
| `RUN` | Run inspector | P0 |
| `EQ` `DD` `RET` `RR` `MRET` | Analytics tear sheet tabs: equity, drawdown, returns and risk, rolling, monthly | P0 |
| `MON` | 27-futures monitor | P0 |
| `CORR` | Correlation matrix | P0 |
| `LEDG` | Ledger (table in P0, pivot in P1) | P0 |
| `OOS` | Gate access log and openings | P0 |
| `LIVE` | Paper book | P0 |
| `JRNL` | Journals | P0 |
| `HELP` | Mnemonics, keys, link groups, licences and attributions | P0 |
| `COST` `BLK` `EXPO` `SEAL` | Own screens (P0 shows cost and blocks inside `DES`) | P1 |
| `VCONE` `SEAS` `EVT` `ROLL` `DQ` | Volatility cone, seasonality, event study, roll calendar, data quality | P1 |
| `JOBS` | Backtest queue | P2 |

The mnemonic registry in `web/src/commands/registry.ts` is the single source for the parser, suggestions and `HELP`.

### Keys

WCAG 2.1.4 rules out always-on single-character shortcuts.
- **Esc**: focus the command line; a second Esc returns focus to the previous panel. (P0)
- **Ctrl+K**: focus the command line. (P0)
- **Tab, Shift+Tab**: move between panels; each panel is one tab stop with a roving tabindex inside. (P0)
- **In a focused chart**: Left and Right step the crosshair one bar and update the readout; `+` and `-` zoom; Home and End jump to the data ends; `T` toggles the table view. Active only while the chart has focus. (P0)
- **In a grid**: arrows, PgUp, PgDn; Enter drills down. (P0)
- **F-keys** (P1, DL16): F2 `REG`, F4 `LEDG`, F8 `LIVE`, F9 `HOME`, each behind a Playwright test that the browser does not act on them. F1, F3, F5, F6, F7, F11 and F12 are never used.

## 6. Honesty labels

- **OOS fence**: dashed amber line at 2022-01-01 on every time axis, labelled `IS | 2022+ SPENT`. Served data stops at the fence.
- **Tags**: every analytic panel is `[PRE-REG]` (value read from a registered result) or `[POST HOC]` (computed by the terminal, descriptive). Gated price analytics add "descriptive, in-sample, not a registered test".
- **Spent window**: sealed results carry `[SPENT]` and "spent window, opened 2026-09-26, descriptive only".
- **Plumbing**: plumbing rows are hatched and carry the literal `paper_plumbing.BANNER` text ("PLUMBING TEST, DELAYED DATA: not strategy performance"). They never feed a performance chart.
- **Balance**: a run with `balance_check.ok` false shows `[UNUSABLE: BALANCE]` and its equity is not drawn.
- **Probe and anchor runs**: `[PROBE: never a result]`, `[ANCHOR]`; probes are excluded from compare views by default.
- **Naming**: the screen JSON's `dsr` field is shown as "Sharpe difference (m - BH)".
- **Basis**: every KPI tile shows its basis (A screen, B account) and unit in its description popover.

## 7. Screens (P0)

**HOME**
```
| [A] NQ GP 1D                                  | [A] 27F MON  daily to 2021-12-31                  |
|  candles | volume | RV22      :IS | 2022+ SPENT|  SYM SECT  LAST  1D  1W  1M  12M  VOL  CORR/NQ   |
|  readout: T O H L C V                          |                                                  |
| [B] volmanaged_v0 EQ against same-exposure BH | [-] REG  registered 15  PASS 1  FAIL 14 (runtime) |
|  equity, underwater, rolling 252 Sharpe       |  name  verdict  n  p  BH q  sha                   |
| [-] LIVE  MNQZ6  c 0.6x  next 15:55:05 ET     | [-] OOS  last 10 reads, terminal reads count      |
```
Registry counts come from `/api/hypotheses` at runtime (DL12).

**REG and MT.** MonitorGrid: name, round, verdict badge, n, p, control p, Bonferroni, Holm, BH q, spec sha (short) with `spec_sha_ok` and re-hash status. Sealed confirmations in their own block with their own alpha. `MT` panel: sorted p against rank (ECharts scatter) with Bonferroni, Holm and BH lines, plus the adjusted-values table. Enter on a row opens `DES`.

**DES** (hypothesis tear sheet)
```
| rebal_v0 [PRE-REG] [FAIL] spec 64bf...0f33 sha ok | round 4 | pass bar text (verbatim from spec) |
| KPI: n | t | p | control p | Bonferroni | Holm | BH q | headline value                        |
| pass_checks list (each true or false, with the frozen threshold)                           |
| blocks bar ladder (RL5) | cost ladder 0/1/2 ticks with break-even marker (EX4)             |
| series equity at the chosen cost (Basis A) with benchmark | [POST HOC] panels labelled       |
| in-sample against sealed strip [SPENT] where a confirmation exists | linked Nautilus runs    |
| round summary markdown (Inter 13px)                                                         |
```

**RUNS and RUN.** `RUNS`: MonitorGrid of every run with badges (probe, anchor, ledgered, balance, MTM, coverage), filter by strategy. `RUN`:
```
| config JSON | nautilus 1.231.0 | elapsed | venue, fill model, cost per side | ledger copy command |
| BalanceCheck [OK] diff 0.00 | MTM max abs diff | coverage 2517/2517 | anchor: IDENTICAL          |
| equity (basis B) and underwater (uPlot, synced)                                                |
| tabs: trades | fills | decisions | closes | rolls | notes   (TanStack virtual grids)           |
```

**Analytics tear sheet** (`EQ`, `DD`, `RET`, `RR`, `MRET` open the matching tab; context is a run or a hypothesis)
```
| KPI row: total, CAGR, vol, Sharpe [CI], Sortino, Calmar, max DD, PSR(0), MinTRL, IR, TE, alpha t |
| EQ: equity against benchmark, log toggle, range buttons | DD: underwater + top-10 table        |
| RR: rolling Sharpe and vol 63/252 | MRET: year x month heatmap + yearly bars                    |
| RET: histogram with normal and VaR lines | VaR/CVaR 95/99 | 21-session tails | stats table     |
| trades (if any): stats tiles, P&L by hour/weekday/month, slippage | exposure, turnover, costs     |
```

**GP / GIP**
```
| [A] NQ GP 1D back-adj | 1m 5m 1h 1d | vendor/repaired | 1M 6M YTD 1Y 5Y MAX | fills from linked RUN |
|  price pane with roll markers and fence | volume pane | RV22 pane                                  |
|  readout: T 09:35 O H L C V | RV22 | gate: served 2019 (cached)                                   |
```
Sessions rejected by `qa.day_gate` show `[GATED]`, repaired ones `[REPAIRED]`. A request past the fence shows the gate's refusal text in the panel. TradingView attribution logo stays on.

**MON and CORR.** `MON`: grid by sector, last close (to 2021-12-31), 1D, 1W, 1M, 3M, YTD, 12M returns (MV4), vol-normalised toggle, realised vol, correlation to NQ. `CORR`: clustered 27x27 heatmap with a 252-session / full-sample toggle; click a cell for the rolling pair correlation in a linked panel.

**LEDG.** Ledger rows, balance column with colour and text, anchor pair status, run links.

**OOS.** Swimlane timeline by caller (ECharts custom series), fence line, sealed reads highlighted; table of entries; openings card (opened 2026-09-26, CLOSED) with pin status; terminal read count.

**LIVE and JRNL.**
```
| MNQZ6 qty | target | c | RV22 | usd value | KILL: on/off (live_guards) | delayed flag set?       |
| countdown: decision 15:55:05 ET | order 15:59:30 ET | roll date from mnq_roll                  |
| target against actual step chart (performance rows only) | reconciliation table             |
| journal rows ... ////PLUMBING TEST, DELAYED DATA: not strategy performance////               |
```
Empty states name the expected file ("no journal yet: live/logs/volmanaged_paper_journal.jsonl").

**HELP.** Numbered mnemonic index, keys, link-group guide, licences and attributions (TradingView notice and link, fonts OFL).

## 8. Components

| Component | Library | Notes |
|---|---|---|
| `CommandLine` | cmdk inline, zustand | parser, context resolver, history, suggestions |
| `ContextStrip` | React | one chip per link group |
| `Workspace` | dockview-react | layouts per screen; own focus handling (dockview keyboard support is not documented) |
| `PanelChrome` | SIGNAL `.panel-head` | title, mnemonic, link chip, tag, table toggle, `aria-label` |
| `StatusBar` | SIGNAL `.statusline` | screen, contexts, data window, READ ONLY, NO ORDER PATH, TWS, KILL, gate reads, ET clock |
| `CandleChart` | lightweight-charts v5 | price, volume, indicator panes; markers for fills and rolls; fence |
| `LineStack` | uPlot | equity, underwater, rolling, exposure; `cursor.sync` per link group |
| `Heatmap` | ECharts | monthly returns, correlation, 27F returns |
| `Distribution` | ECharts | histogram with normal overlay and VaR markers |
| `BarLadder` | ECharts | blocks, cost ladder, P&L by hour and weekday with CI whiskers |
| `PScatter` | ECharts | multiple-testing p against rank with boundary lines |
| `Swimlane` | ECharts custom | OOS log timeline |
| `KpiTile` | SIGNAL `.mchip` | value, basis, unit, tag, description popover |
| `MonitorGrid` | TanStack Table and Virtual | 24px rows, right-aligned numbers, sticky header |
| `JournalTable` | TanStack | plumbing rows hatched with the banner |
| `SpecCard`, `BalanceCheck`, `Countdown`, `HelpScreen` | React | as above |
| `ChartA11y` wrapper | React | `role="img"`, `aria-label` summary, table view |

## 9. Accessibility (WCAG 2.2 AA)

- 1.4.3: every text token above is at least 4.5:1 on its background.
- 1.4.11: `--border-int`, chart lines and the focus ring are at least 3:1.
- 1.4.1: sign and glyph on every signed value; legend text symbols.
- 2.1.1 and 2.1.4: every action from the keyboard; no always-on single-key shortcuts.
- 2.4.7 and 2.4.11: 2px lime focus ring; a focused cell scrolls into view and sticky headers do not cover it.
- 2.5.8: default rows 24px; an opt-in compact 20px density is documented as below the target-size minimum.
- Every canvas chart: `role="img"` with an `aria-label` data summary (range, last value, max drawdown) and a table view toggle, because axe cannot see into canvas.
- `prefers-reduced-motion` honoured.

## 10. Copy rules

UK spelling (normalise, colour, analyse), no em or en dashes, no stock filler vocabulary, sentence case for prose, uppercase only for mnemonics, tags and `.eyebrow` labels. All strings live in `web/src/copy/*.ts` so the house style lint can check them as one file set.
