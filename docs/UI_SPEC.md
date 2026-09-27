# nq-lab terminal: UI specification

Status: plan, 2026-09-26; sections 1 to 3, 5, 9 and 10 updated the same day for the flat-black terminal look (`BLOOMBERG_LOOK.md`, the look spec; decisions D1 to D7 are applied as noted below). Stack and decisions: `ARCHITECTURE.md`, `PRD.md` section 7. Contrast ratios were computed with the WCAG formula.

## 1. Principles

1. **Amber identifiers and labels on black, light-grey numbers; up and down are the only semantic hues; blue for the command line, the focus ring and the selection.** Names and labels are amber (`--data`), as are times and headlines; most numbers are `--text`. A persistent command line of mnemonics, panels linked in groups, dense tabular figures, and everything reachable from the keyboard. The product name stays nq-lab terminal: no third-party name, mark or proprietary font appears in the UI (look spec 1.2).
2. **Honesty is visible.** nq-lab's rules show on screen (section 6), so a chart can never look more certain than the research behind it.
3. **Read only, and it says so.** The frame strip and the status line always show `READ ONLY` and `NO ORDER PATH`. There is no order ticket anywhere.
4. **Nothing animates numbers.** No count-ups, no reveal effects, no tick flash, and no transition on any colour: every state change is a hard cut. The only motion is the command-line caret blink, which holds steady under `prefers-reduced-motion`.
5. **Colour is never the only cue.** Signed numbers carry `+` or `-` and ▲ or ▼; legends carry a text symbol.

## 2. Frame

Global rows, top to bottom, at 1920x1080 (look spec 4.1; measured in Playwright by `e2e/keys.spec.ts`):

```
y=0     FRAME STRIP    37px  #CDCDCD  layout tabs HOME / RESEARCH / LIVE / +  (active #191919) | READ ONLY  NO ORDER PATH  Options
y=37    KEY TOOLBAR    32px  #191919  CANCEL (red), HELP SEARCH MENU PG BACK PG FWD, then HOME REG RUNS LEDG LIVE OOS (green) | key map
y=69    NAV TOOLBAR    22px  #191919  < > | [A] NQ1 Index | GP | Related Functions Menu        Message: KILL off, TWS | favourites | export | ?
y=91    COMMAND ZONE   50px  #000000  22px command box (680px), panel number, link groups | 21px message line (PT Mono)
y=141   WORKSPACE     917px  #000000  dockview, 2px black gutters, no panel borders
y=1058  STATUS LINE    22px  #191919  Status | Screen HOME | A NQ1 Index | B volmanaged_v0 | C - | DATA ... | TWS not monitored |
                                      KILL off | Gate reads 7 | READ ONLY | NO ORDER PATH           14:02:11 ET | <Esc> command
```

With the event tape switched on (`NO <GO>`; off by default, D4), a 57px tape sits above the status line and the workspace shrinks to 860px. There is one global command box, labelled with the focused panel's number (D3); instrument panels carry their own two-line quote header instead. The status line is one 22px line (D7) whose safety segments (KILL, TWS, gate reads, READ ONLY, NO ORDER PATH) never shrink.

Target 1920x1080; minimum 1366x768. Default layouts per screen live in one declarative table, `web/src/chrome/WorkspaceLayouts.ts`. HOME is a 2x2 grid (GP, MON, EQ, REG, numbered 1 to 4 in reading order); LIVE and OOS open with Shift+Enter. Layouts are fixed: dockview group tab strips are hidden (the panel title bar replaces them) and panels do not resize by dragging, because a 4px sash drag has no keyboard or single-pointer equivalent (WCAG 2.1.1, 2.5.7). A user layout is the panel set a command leaves (Enter replacing a panel, Shift+Enter adding one); it is kept in `localStorage` as a per-viewer convenience, saved only after such a command, and tied to the default it came from, so a changed default replaces it (wrapped in try/catch; the default layout renders if storage fails).

**Panel chrome** (look spec 4.3 to 4.7, with D1 applied to every control):
- Title bar, 24px, `--frame-bg` with black 11px text: `<n>-<MNEMONIC>`, a 14px link-group square with a black letter (none when unlinked), then the context and argument (`1-GP [A] NQ1 Index 1d`). On the right: the tag (`[PRE-REG]`, `[POST HOC]`, `[SPENT]`, `[PLUMBING]`, `[UNUSABLE: BALANCE]`), the table toggle `T`, `Options` and maximise.
- Quote header (instrument panels only): two 22px lines; ticker white, arrow by last tick, price by day change, amber labels, a `d` delayed flag in `--warn`; no tick flash.
- Red function bar, 24px plus a 1px edge: an optional amber context field, numbered menu buttons in the house scheme `95) Compare`, `96) Actions`, `97) Settings`, `98) Export`, `99) Help`; `Page n/m` and the white bold screen title on the right. Hover `--fn-hover`, pressed `--fn-press`; its dropdowns are the same red.
- Trapezoid tabs (5px slant), numbered `1) Equity 2) Drawdown ...`; sub-tabs on a `--tab-on` strip.
- Related Functions menu: a black box with a light grey edge inside the owning panel. `--dim` covers only that panel from the red bar down, so the chrome and the command line stay usable. Two columns, numbered across both. While it is open it holds the panel's Tab stop.
- Focused panel: a 1px `--cmd-border` line around it, its number in the command zone, the nav toolbar reflecting it, and the command box border dimming to `--cmd-border-idle` while focus is in a panel.
- Per-panel back and forward history (50 each), walked with End, the `< >` buttons and the Options menu.

**Link groups.** Setting a context in one A panel retargets every A panel and syncs the time crosshair across them (uPlot `cursor.sync` key per group; lightweight-charts `setCrosshairPosition` and `clearCrosshairPosition`, confirmed in the v5 source). Unlinked panels show no chip. Chip colours are a house choice: A `#66ABFF`, B `#D7B8FF`, C `#8FE3E0`.

## 3. Design tokens

`web/src/theme/tokens.css` is the single source for every colour and size, and for the fonts; no component writes a hex value (tests in `src/theme`, `src/grids` and `src/charts/theme` enforce it). The values and their evidence are in look spec sections 2 and 3; `src/theme/tokens.test.ts` asserts them exactly and `contrast.test.ts` checks every pair in look spec 8.2, including the negative cases that must fail.

| Token | Value | Use |
|---|---|---|
| `--bg`, `--surface` | `#000000` | page, function bodies, chart plots |
| `--raised` | `#1E1E1E` | side panes, dropdowns, autocomplete sheet, rails |
| `--chrome` | `#191919` | key and nav toolbars, status line, active layout tab |
| `--frame-bg` | `#CDCDCD` | frame strip and panel title bars, black text |
| `--text` | `#D7D7D7` | numbers, body text |
| `--data` | `#FFA028` | names, labels, dates, times, headlines, field fill |
| `--muted` | `#A5A5A5` | `N)` numbers, hints; `--muted-hover #B4B4B4` inside a hovered cell |
| `--white` | `#FFFFFF` | totals, KPI values, headings, mnemonics in menus |
| `--c-up` | `#51EE6C` | positive |
| `--c-down` | `#FF2C4A` on black, raised and chrome only; `--c-down-raised #FF5566` on headers and the selection; `--c-down-hover #FF8A94` in a hovered cell | negative |
| `--fn-bar` | `#870F1E` | red function bar; READ ONLY and NO ORDER PATH flags, white text |
| `--cmd-border` | `#148EFF` | command box, focused-panel line; `--accent` is an alias |
| `--focus` | `#FFFFFF` | 2px keyboard focus ring |
| `--sel-bg` | `#0C2B4A` | selected grid row, selected HELP item |
| `--link` | `#53B2F5` | links, breadcrumbs, `{... <GO>}` command links |
| `--th-bg` / `--th-rule` | `#232323` / `#505050` | table header and its top rule |
| `--border-int` | `#8C8C8C` | control boundaries (1.4.11) |
| `--fence` | `#FFA028`, 1px dashed | 2022-01-01 line, `IS | 2022+ SPENT` |
| `--sb-thumb` / `--sb-track` | `#787878` / `#222222` | classic 15px scrollbars |

The sector palette for the 27 futures is unchanged: Equity `#6CB6FF`, Rates `#B39DFF`, FX `#38C7E8`, Energy `#FF8A3D`, Metals `#E0C060`, Grains `#9CCC65`, Livestock `#F48FB1`, Benchmark `#8D9399`. Chart colours are tokens too (grid off by default; candles white up and `#0080FF` down, D6; benchmark `#F06000`; the MON, CORR and monthly-return scales); `web/src/charts/theme` reads them for the canvas libraries. All radii are 0; the chart legend's 3px corner is the one exception.

Never put a `var()` colour in a CSS transition; state changes are hard cuts.

**Type.** Fonts are self-hosted through @fontsource, or vendored OFL files with their licence.
- Everything (UI, tables, numbers, charts, KPIs): `"Bergoom", "Source Sans 3", system-ui, sans-serif`. Bergoom (OFL-1.1) is vendored unmodified in `web/src/assets/fonts/bergoom/` with its `LICENSE.md`, which ships in every build (D2). Source Sans 3 comes from `@fontsource/source-sans-3`. Bergoom's digits are tabular by default.
- Fixed grid only (message line, event tape, command box, raw log views): `"PT Mono", ui-monospace, monospace` from `@fontsource/pt-mono`, with a plain zero.
- Sizes: 15px body and table cells on 20px rows (D1); an 11px floor (title bars, key labels, status line); 13px for the nav toolbar and charts; 18px quote header; 21px KPI values. Weights 400 and 700 only.
- No letter-spacing and no zero-slash or stylistic features; `tabular-nums lining-nums` on numbers. Numbers are right-aligned with fixed decimals per column, an explicit `+` on changes, ASCII `-`, and `--` for missing. Treasury prices are shown in 32nds as `130-06+` (D5).

**Themes.** `dark` (default); `data-cvd="deut"` (up `#3399FF`, down `#FF5566`); `data-cvd="prot"` (up `#3399FF`, down `#FF7329`, amber `#FEBA11`). The scheme is chosen in the frame strip's Options menu and kept in `localStorage`. `amber-classic` is dropped. No light theme.

## 4. Reuse from the SIGNAL design system

Where this section conflicts with sections 2, 3 and 5 (the look spec), those win: there is no `.eyebrow` label, no command prompt text, and the range buttons read `1D 3D 1M 6M YTD 1Y 5Y Max`.

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
line    := [NXTW] [context [SECTOR]] [FUNCTION [args]] [HELP] <GO>
         | SECTOR | digits | MNEMONIC
context := instrument (NQ ZN ES CL ... the 27 futures, or a generic ticker: NQ1, TY1, EC1, C 1 ...)
         | hypothesis (za_v0, rebal_v1_confirm) | run id (nt_dtsmom_v0_ts1) | 27F (the universe)
         | omitted: the focused panel's link-group context
SECTOR  := INDEX | COMDTY | CMDTY | CURNCY | CRNCY | EQUITY | GOVT | CORP   (any case; F8 to F11 insert one)
<GO>    := Enter or NumpadEnter. Shift+Enter (or NXTW) opens the result in a new panel.
```

Examples: `NQ GP`, `NQ1 INDEX GP 1d`, `TY1 COMDTY DES`, `NQ GIP 2019-03-14`, `volmanaged_v0 DES`, `nt_dtsmom_v0_ts1 RUN`, `27F CORR`, `REG`, `GP HELP`.

- **Sector keys** are checked against the instrument: NQ, ES and YM take INDEX; rates, energy, metals, grains and livestock take COMDTY; FX futures take CURNCY. Hypotheses, runs and 27F reject one. `NQ COMDTY` answers "NQ is an Index future: use INDEX (F10)." The chrome shows instruments as generic tickers with a title-case sector (`NQ1 Index`, `TY1 Comdty`); the alias table lives in `web/src/commands/sectors.ts`, because `/api/commands` has no alias field.
- **A context on its own** (`NQ1 INDEX <GO>`) loads it into the focused panel's link group and opens its numbered function menu. **A bare sector** (`INDEX`, `COMDTY`) opens the sector menu.
- **Number `<GO>`**: `N <GO>` runs numbered item N of the focused panel (red-bar buttons, tabs, menu rows, the HELP index) through `web/src/chrome/NumberedActions.ts`; out of range gives "No item 42 on this screen." `N <PgDn>` jumps N pages.
- **Words**: `MNEM HELP` opens that function's help and `HELP` the index; `LAST` lists the last 8 commands; `MAIN` is HOME; `HL` searches help, hypotheses and runs; `NO` toggles the event tape; `MENU` opens Related Functions.
- `{NQ1 Index GP <GO>}` in HELP and notes renders as a command link that runs on click or Enter.
- The box shows no prompt and no placeholder; typed letters show in upper case. Suggestions come from `/api/commands` in groups (FUNCTIONS, INSTRUMENTS, HYPOTHESES, RUNS, SEARCH), at most 6 per group, or 9 when one group matches. Messages, prompts and errors appear in the message line under the box (a polite live region), never in toasts.
- Up and Down in the empty line, or Shift+PgUp and Shift+PgDn, walk the history.

### Mnemonics

| Mnemonic | Screen | Pri |
|---|---|---|
| `HOME` | Home view (the front end shows this in place of the backend's own title; look spec 1.2) | P0 |
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

WCAG 2.1.4 rules out always-on single-character shortcuts. The key toolbar under the frame strip shows the main keys as buttons (CANCEL, HELP, SEARCH, MENU, PG BACK, PG FWD, then HOME, REG, RUNS, LEDG, LIVE, OOS); each names its key and action.
- **Esc** (CANCEL): close the open list or menu; else clear a non-empty line; else return focus to the panel. From a panel, Esc focuses the command line. (P0)
- **Enter, NumpadEnter** (GO): run the line. (P0)
- **F1**: once, help for the function typed or for the focused screen; twice within 500ms, the HELP index. (P0)
- **F8, F9, F10, F11**: insert ` Equity`, ` Comdty`, ` Index`, ` Curncy`. A Playwright test checks each one is prevented with no browser action (no full screen, no help tab). F8 answers "No equities in nq-lab". (P0)
- **End**: back in the focused panel's history when the line is empty or a panel has focus. **Home**: focus the command line from elsewhere. (P0)
- **PgUp, PgDn**: page back and forward in the focused panel, with an N prefix. **Shift+PgUp, Shift+PgDn**: command history. (P0)
- **Alt+1 to Alt+9**: focus panel N. **Alt+K**: the keyboard map; Alt+K again closes it. **Ctrl+K**: focus the command line. (P0)
- **Tab, Shift+Tab**: move between panels; each panel is one tab stop with a roving tabindex inside. Inside the command line, Tab completes while the suggestion list is open. (P0)
- **In a focused chart**: Left and Right step the crosshair one bar and update the readout; `+` and `-` zoom; Home and End jump to the data ends; `T` toggles the table view. Active only while the chart has focus. (P0)
- **In a grid**: arrows, PgUp, PgDn; Enter drills down. (P0)
- The earlier F-key plan (F2 REG, F4 LEDG, F8 LIVE, F9 HOME) is dropped; the custom key buttons replace it. MENU is not bound to the ContextMenu key, and F12 is never used.

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

### P1 views on screen (Phases 9.2 and 10, 2026-09-27)

Every view below is `[POST HOC]`, descriptive and in sample, never a verdict; every chart keeps its data summary and table view (section 9). The tear sheet's P1 views sit under the tab view in the body's scroll, as DES-style cards like a run's books.
- **EQ**: SV5 bootstrap intervals (Sharpe, CAGR, max drawdown; method, block length, replications and seed named) and the SV6 cone, labelled "resampled history, not a forecast", with a key under the chart. The Sharpe tile keeps its Mertens interval.
- **RET**: PF7 to PF9 tiles; RK3 normal and Cornish-Fisher VaR by level (outside the monotone domain Cornish-Fisher is "not defined", the historical VaR (RK1) is shown beside the greyed normal VaR, and the row says so); RD4 Jarque-Bera on the whole series with the RD3 QQ plot; RK5 stress windows as a panel of their own (the frozen windows, and the spent 2022 row only for volmanaged_v0, tagged `[SPENT]`). No p-value on a window.
- **RR**: each window's RL1 range as two dashed amber bounds on the rolling Sharpe pane, only for a window with a rolling value: the range (95%) of a w-period Sharpe if the full-sample Sharpe held throughout, named in the legend and in words under the chart ("a line outside its range is not by itself a regime change"). SV5's full-sample interval is not drawn on the rolling pane: it is far too narrow for 63 or 252 values; RL3 and RL4 rolling beta and correlation (a note instead of empty panes when the series is shorter than the window); BR3 capture; BR4 scatter with BR1's OLS line; RG1 volatility regimes with Welch t and no p-value.
- **A run's books**: a trade paths card beside the trades card: TA2 MAE and MFE against the final result (in R where every trade has one, a losing trade hollow; intraday runs only, the card says why otherwise; when the served bars are on another price basis than the fills the card says so with the counts and draws nothing, and a few trades off their bars are counted in a note), TA4 holding times on log minutes, TA5 streaks and the runs test on the whole trade list.
- **REG, MT, DES**: SV3's Deflated Sharpe: a `DSR` column on REG (not in the narrow column set) with a one-line note; the full table, the facts (N, V, SR0) and a DSR ladder on MT under the confirmations; one line in DES's registration box ("not an SV3 trial" for a check row).
- **LIVE and JRNL**: the live stream line (live, reconnecting, or polling and why; last event in ET; rows streamed; whether the server resumed after the last event id); LV5 paper against model tracking on LIVE under Routes and Fills.

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
- 2.4.7 and 2.4.11: 2px white `--focus` ring (inset on grid cells); a focused cell scrolls into view and sticky headers do not cover it. Amber fields use a 1px `--field-focus` ring with a 1px offset.
- 2.5.8: table and list rows are 20px (D1), with Number `<GO>` in the command box as the equivalent control for every numbered row. Every other control (title-bar buttons, red-bar buttons, tabs, menu rows, key buttons, fields) is at least 24px. The 22px command box and the 21px nav toolbar buttons meet 2.5.8 through the spacing exception.
- Where the reference colour fails AA, the nearest passing value is used (`--c-down-raised`, `--c-down-hover`, `--muted-hover`, `--sb-thumb`, white text on `#BA152D`); the look spec lists each one.
- Every canvas chart: `role="img"` with an `aria-label` data summary (range, last value, max drawdown) and a table view toggle, because axe cannot see into canvas.
- Every pivot view (LEDG pivot, RUN trades and fills, the OOS log) has a visible Show as [Table | Pivot grid] toggle over the same rows. The Perspective viewer draws its grid in a shadow tree that axe leaves out and no screen reader has been run over, so Table shows those rows in the house MonitorGrid: the pivot grid's opening layout (every row in its columns and sort, or for a grouped preset a total row and one row per group, each header naming its aggregate), one keyboard stop, the active cell announced, a polite status naming the rows. Table is the default under `prefers-reduced-motion` and takes over, with an alert, when the pivot grid cannot start; a choice made on the toggle holds for the page (`src/perspective/pivots.tsx`, `pivotTable.ts`; `e2e/perspective.spec.ts` checks it with axe over the whole page and from the keyboard).
- `prefers-reduced-motion` honoured.
- 1.4.10: at 700 CSS px and narrower the panels stack at full width in reading order and only the page scrolls vertically (look spec 2.4); `e2e/shell.spec.ts` checks 320 CSS px.
- 1.4.12: no chrome or panel text is clipped under the text-spacing overrides; `e2e/shell.spec.ts` checks HOME.
- 2.2.2 and 2.3.1: the command-line block cursor blinks with a hard cut, 1000ms per phase, never fully off, and only while the line has focus. It is a text caret, the essential convention for an editable field, so 2.2.2 does not ask for a pause control; it is one 9 x 18px block, well under the 2.3.1 flash threshold, and it holds steady under `prefers-reduced-motion`.
- The related functions menu is a non-modal dialog (`aria-modal="false"`); focus moving into another panel closes it.

## 10. Copy rules

UK spelling (normalise, colour, analyse), no em or en dashes, no stock filler vocabulary, sentence case for prose and headers ("Registry board", "Active exp."). Uppercase only where the data itself is uppercase: mnemonics, tags (`[PRE-REG]`), tickers, source codes, key-button labels and suggestion group headings (`FUNCTIONS`). There are no uppercase eyebrow labels and no letter-spacing. Hints use `<Key>` notation (`<End> back  <F1> help`). All strings live in `web/src/copy/*.ts` so the house style lint can check them as one file set.
