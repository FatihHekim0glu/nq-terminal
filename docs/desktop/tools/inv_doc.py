"""Assemble 00_inventory_frontend.md from tables.json and the narrative below."""
import json, re, sys
from pathlib import Path

WORK = Path(sys.argv[1])
OUTFILE = Path(sys.argv[2])
T = json.load(open(WORK / "tables.json", encoding="utf-8"))
SRC = WORK / "head" / "web" / "src"
tot = T["totals"]; sc = T["screen_totals"]; vt = T["vitest_tot"]; et = T["e2e_tot"]; dc = T["dep_counts"]
dist_total_mb = T["dist_total_bytes"] / 1e6
schema_lines = 11346
prod_lines_no_schema = tot["l_prod_code"] - schema_lines

help_src = (SRC / "copy/help.ts").read_text(encoding="utf-8")
keys_block = re.search(r"export const HELP_KEYS[^=]*=\s*\[(.*?)\n\]", help_src, re.S).group(1)
key_rows = re.findall(r"\[\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\s*\]", keys_block)
def unesc(s):
    return s.replace("\\'", "'")
keys_md = "| Key | What it does (as HELP words it) |\n|---|---|\n" + "\n".join(f"| {unesc(k)} | {unesc(v).replace('|', '/')} |" for k, v in key_rows)

STORAGE = """| Key | Written by | Holds | Limits and version |
|---|---|---|---|
| `nqt.layouts` | `state/layouts.ts` | the dockview layout of each screen, keyed by mnemonic | 200,000 characters per layout, store version 1; a layout saved from an older default is dropped (`chrome/WorkspaceStorage.ts`) |
| `nqt.workspaces` | `state/workspaces.ts` | named workspaces (SAVE, LOAD, FORGET) as recipes of command lines, plus the last one used | at most 12 workspaces, 20,000 characters per recipe, store version 1 |
| `nqt.linkGroups` | `state/linkGroups.ts` | the context of link groups A, B and C | store version 1; the crosshair time is never stored |
| `nqt.watch` | `state/recordWatch.store.ts` | the record watch checkpoint (what changed since marked seen) | 200,000 characters |
| `nqt.cmd.history` | `commands/history.ts` | the last command lines | 100 lines |
| `nqt.tape` | `chrome/EventTape.store.ts` | event tape on or off | the string `true` or `false` |
| `nqt.cvd` | `chrome/FrameStrip.scheme.ts` | colour scheme: standard, deut or prot | three values |
| `nqt.theme` | `theme/look.ts` | look: standard or amber-classic | two values |
| `nqt.orientation` | `screens/home/HomeOrientation.tsx` | the HOME orientation card was dismissed | one flag |
| `nqt.mon.defaults` | `screens/mon/MonScreen.tsx` | MON view, heat and window defaults | three fields |"""

EXPORTS = """| Output | Trigger | Code | Mechanism |
|---|---|---|---|
| CSV of a grid | Export row on REG, OOS and other grids | `chrome/exportCsv.ts` | `saveText` makes a Blob and an object URL, clicks a hidden anchor with `download` |
| Markdown or JSON report | Save rows on DES (hypothesis and instrument) and SEAL | `screens/des/HypothesisDes.tsx`, `screens/des/InstrumentDes.tsx`, `screens/seal/SealScreen.tsx` | same `saveText` |
| Panel image (PNG) | GRAB, the Options row Grab as image | `export/grab/run.ts`, `export/grab/compose.ts`, `export/prepare.ts` | reads chart canvases (`toDataURL`), draws labels and a caption on a 2D canvas, `toBlob`, `saveBlob` |
| Panel image to clipboard | the Options row Copy image | `export/grab/run.ts`, `chrome/panelExport.ts` | `navigator.clipboard.write` with a `ClipboardItem`; the code notes the write must start inside the click (Safari refuses it after an await) |
| Evidence pack (one HTML file) | the Options row Evidence pack (HTML) | `export/pack/run.ts`, `export/pack/packHtml.ts` | builds HTML text, `saveText` |
| Print dossier (A4 landscape) | the Options row Print dossier | `export/print/run.tsx`, `export/print/PrintDossier.tsx`, `export/print/print.css` | draws a hidden `#nqt-print-root` with its own React root, waits for two frames, images and fonts, then `window.print()`; removes it on `afterprint` |
| Copy of a run id | RUN header | `screens/runs/RunHeader.tsx` | `navigator.clipboard` text |
| Copy link | Options rows | `chrome/copyLink.ts` | builds a `#go=` fragment |"""

FEATURE_NOTES = """| Capability | Present? | Evidence |
|---|---|---|
| WebAssembly | yes, two binaries, 4.0 MB | `perspective/engine.ts` fetches `perspective-server-*.wasm` (2,459,148 bytes) and `perspective-viewer-*.wasm` (1,552,105 bytes) through `fetchAsset` |
| Web Workers | one: the Perspective engine worker | `perspective/engine.ts` imports `perspective-server.worker.js?worker`; no `new Worker(` call in `src` |
| WebGL | no | the string `webgl` is in no built JavaScript file; only the Perspective datagrid plugin is installed (a DOM table), not its d3fc chart plugins |
| Canvas 2D | yes | uPlot, lightweight-charts and ECharts (`renderer: 'canvas'` in `charts/echarts/EchartsChart.tsx`) all draw to canvas; GRAB composes its own canvas |
| OffscreenCanvas, createImageBitmap | no | no match in `src` |
| SharedArrayBuffer, `crossOriginIsolated` | no | no match in `src` or in the built JavaScript |
| COOP and COEP headers | not sent | `backend/nq_terminal/security.py` sets `X-Frame-Options: DENY`, a CSP, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` only |
| Content Security Policy | strict | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (same file). No inline script, no `eval`, no blob URLs for workers |
| Server-Sent Events | yes, one stream | `api/client.ts` `openEventStream('/api/live/stream')`; `api/liveStream.ts` states: off, connecting, open, reconnecting, polling; falls back to 2 s polling |
| WebSocket, XMLHttpRequest, background sends | banned | `api/client.ts` `findWriteRequests` scans every source file for them in a test |
| Service worker, Notification, BroadcastChannel | no | no match in `src` |
| IndexedDB, sessionStorage | no | no match in `src` |
| `window.open` and the blocking dialogs (`alert`, `confirm`) | no | no match in `src` |
| Drag and drop | off | `chrome/Workspace.tsx` passes `disableDnd` and `disableFloatingGroups` to dockview; sashes do not drag; uPlot drag-zoom is off (`drag: { x: false, y: false }`) |
| Text file upload, file pickers | no | no `input type=file`, no `FileReader` |"""

SOURCES = """- Tailwind CSS v4.0 compatibility page, checked 2026-10-02, https://tailwindcss.com/docs/compatibility : "Tailwind CSS v4.0 is designed for and tested on modern browsers, and the core functionality of the framework specifically depends on these browser versions: Chrome 111, Safari 16.4, Firefox 128."
- Vite build options, checked 2026-10-02, https://vite.dev/config/build-options : the default `build.target` is `baseline-widely-available`, "`['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4']`" for this major release.
- Everything else in this document comes from the repository snapshot, the built `dist` folder and the installed packages, as described in section 2. No other external claim is made here."""

doc = f"""# Front end inventory (desktop migration, step 0)

Status: factual map of the web front end as it stands at v2, written 2 October 2026. It is the base for the migration plan, not a recommendation. Every number below is generated by script from the repository, the built `dist` folder and the installed packages, unless a line says it is quoted from the owner's brief or unverified.

## 1. Summary

- The front end is {tot["prod"]} production source files and {tot["test"]} test files under `web/src` ({tot["all"]} files in all). Production code is about {prod_lines_no_schema:,} lines of TypeScript and TSX (not counting the {schema_lines:,}-line generated `api/schema.d.ts`) plus {tot["l_prod_css"]:,} lines of CSS. Test code is {tot["l_test"]:,} lines.
- There are 30 mnemonics, served by 25 screen folders under `src/screens` ({sc["prod"]} production files, {sc["l_prod_code"]:,} lines of TypeScript and TSX, {sc["l_prod_css"]:,} lines of CSS). Every screen is a lazy chunk.
- The production build in `dist` is {T["dist_n_assets"]} asset files and {dist_total_mb:.1f} MB. Of that, 4.0 MB (48%) is two WebAssembly files for the Perspective pivot grid, 0.9 MB is fonts, 0.36 MB is the first-paint JavaScript (114.5 kB gzip against a 114.9 kB ceiling), 2.6 MB is lazy JavaScript and 0.34 MB is CSS.
- 17 npm packages are direct production dependencies ({dc["transitive"]} more are transitive, {dc["all"]} in all). React and React DOM are 67 kB gzip of the 114.5 kB shell. Heavy libraries are all lazy: ECharts 201 kB gzip, dockview 86 kB gzip (plus 10 kB of CSS), Perspective 92 kB gzip plus the 4.0 MB of WebAssembly, lightweight-charts 61 kB gzip, uPlot 22 kB gzip, TanStack table and virtual 19 kB gzip.
- Browser coupling is narrow and well fenced: one HTTP client (GET only, plus the JOBS POST and DELETE), one Server-Sent Events stream, ten `localStorage` keys, one WebAssembly engine with one worker, canvas 2D drawing, one print path, three clipboard and download paths. There is no WebGL, no SharedArrayBuffer, no COOP or COEP, no IndexedDB, no service worker, no drag and drop, no `window.open`.
- The front end talks to the backend only through {len(json.load(open(WORK / "inv.json", encoding="utf-8"))["schema_paths"])} contract paths on one origin. Anything that replaces the browser (a desktop shell) has to keep that origin story, the CSP and the same-origin rules, or replace them knowingly.
- The test stack is the real asset. Static count: {vt["files"]} vitest files with {vt["tests"]:,} `it` or `test` calls and {vt["each"]} parameter tables (the owner's brief quotes about 6,925 after expansion), {et["files"]} Playwright files with {et["tests"]} calls (brief: 383), {et["screens"]} screenshot baselines, {et["axe"]} files that run axe. Playwright, the performance budgets (a Chromium trace) and every baseline are tied to Chromium on Windows.

## 2. Method, snapshot and limits

- Snapshot: `git archive HEAD` of commit `c7f9e61` (v2, 1 October 2026, 23:23 +0100). The working tree is not the snapshot: at the time of writing another run had 69 uncommitted paths under `web/src` (new, changed and one deleted file). They are excluded, so these numbers describe HEAD and will drift from the working tree.
- Build output: `web/dist` as found, built 1 October 2026 at 23:17 +0100, six minutes before the commit. It was copied before reading and never rebuilt here. The repository's own `scripts/bundleCheck.ts` was run read only against the copy and reports shell 114.5 kB gzip of a 114.9 kB ceiling, uPlot 22.1 kB, lightweight-charts 61.4 kB, ECharts 201.6 kB, tanstack-grid 18.7 kB, Perspective 86.1 kB, and no rule violated. That the folder equals a fresh build of HEAD is not proven (unverified); its chunk set and sizes match the budgets recorded in the code.
- Packages: `pnpm ls --prod --depth Infinity --json` (read only), then each package's `package.json` for its licence and a directory walk for its size on disk.
- Standalone package sizes in section 9 come from bundling just the imports the app uses, minified, with Rolldown 1.2.11 (the bundler inside Vite 8), from a scratch folder outside the repository. They match the real chunks within 1% (React 220.6 against 218.8 kB, dockview 380.1 against 378.8 kB, lightweight-charts 195.2 against 194.2 kB), so the method is sound, but they are estimates and not attributions.
- Not run: Playwright (not allowed), vitest (not needed for an inventory), any browser or desktop shell. Test counts are static counts of calls and are lower bounds. Nothing was measured at run time; no number here is a speed or memory measurement.
- Generators: `docs/desktop/tools/` holds the scripts. Run order, each with a work folder as its one argument: unpack `git archive HEAD` into `<work>/head`, copy `web/dist` to `<work>/dist_snapshot`, save `pnpm ls --prod --depth Infinity --json` as `<work>/pnpm_ls.json`, run `size.mjs` (optional, for section 9.2) in `<work>/spike`, then `inv_extract.py`, `inv_dist.py`, `inv_deps.py`, `inv_tests.py`, `inv_tables.py`, and `inv_doc.py <work> <output file>`.
- Classification: a file is a test if its name has `.test.`, a "gallery or fixture" file if it is a component gallery page (`*.gallery.tsx`, used only by the Playwright gallery build) or fixture data, and production otherwise. The `src/demo` folder (in-browser fixture API) and `src/gallery` are production-folder code that ships only in the demo and gallery builds, and `bundleCheck` proves they are absent from the production build.

## 3. Runtime shape today

- One origin: uvicorn serves the API under `/api` and a plain `StaticFiles` mount of `web/dist` at `/`, on `127.0.0.1:8765`. The browser, the API and the static files share it, so `fetch('/api/...')` is relative and cookies, CORS and tokens do not exist (`backend/nq_terminal/app.py`, `security.py`).
- Backend guards the front end depends on: loopback-only peers, a same-origin rule on every GET under `/api` (`Sec-Fetch-Site` and `Origin` checks), the CSP above, and `X-Frame-Options: DENY`.
- Three builds of the same source: production (`vite build`, `dist`), gallery (`vite build --mode gallery`, `dist-gallery`, adds `/__gallery/<name>` pages for component screenshots) and demo (`vite build --mode demo`, `dist-demo`, answers every `/api` GET inside the page from fixtures in `src/demo`, after a seeded 20 to 120 ms delay, with no backend). `src/main.tsx` folds the gallery and demo branches away in a production build.
- Offline Playwright (`playwright.offline.config.ts`) already runs the specs against a Node-side copy of the demo API, so a front end with no Python backend is an existing, tested mode.
- Dev: `vite` on 5173 proxies `/api` to 8765. Node 24 or newer, pnpm 11.5.1, TypeScript 6.0.3, `target: es2023`. Vite's default build target (`baseline-widely-available`) is Chrome 111, Edge 111, Firefox 114, Safari 16.4 (sources at the end). Tailwind 4.0 needs Chrome 111, Safari 16.4, Firefox 128 (same place).
- Deep links: the URL fragment `#go=<command line>` (up to 8 lines of up to 200 characters, restricted alphabet, allowlisted actions) is read from the address bar by `chrome/useDeepLinks.ts` and consumed with `history.replaceState`. A page opened with no link restores the last workspace through `LOAD`.
- The one write path: `api/jobsClient.ts` may POST `/api/jobs` and DELETE `/api/jobs/{{job_id}}`. A source scan test fails on any other write method, any `fetch` outside the two client files, and any `XMLHttpRequest`, `WebSocket`, background send or `new Request`.

## 4. Source tree

Top-level counts. "Prod" is production source, "Other" is gallery pages and fixture data. Lines are physical lines.

### 4.1 Screen folders (`src/screens`)

{T["id_screens"]}

Screen totals: {sc["all"]} files, {sc["prod"]} production, {sc["test"]} test, {sc["other"]} gallery or fixture; {sc["l_prod_code"]:,} production TypeScript lines, {sc["l_prod_css"]:,} CSS lines, {sc["l_test"]:,} test lines.

Four folders are not mnemonics of their own: `layouts` holds the 30 default dockview layouts (HOME is a 2 by 2 grid: GP, MON, EQ, REG), `p2rct` holds three panels (capacity, term structure, trend regime) that other screens host, `riskextras` holds the risk-extras panel shown inside tear sheets, and `tear` is one screen for five mnemonics (EQ, DD, RET, RR, MRET are five tabs of the same panel).

### 4.2 Support folders (everything else under `src`)

{T["id_support"]}

Notes: `api` includes the {schema_lines:,}-line generated `schema.d.ts`; `chrome` is the shell (frame strip, command line, key toolbar, workspace, status bar, panel chrome, record watch, tape, help); `charts` is the three chart engines and the tokens that style them; `copy` is every user-facing string (UK spelling, no em or en dashes, enforced by `copy/copyRules.test.ts`); `demo` and `gallery` ship only in their own builds.

## 5. Mnemonics (the 30 screens)

Source: `src/commands/registry.ts` and `src/copy/commands.ts`. The same table exists in the backend (`constants.MNEMONICS`) and a test compares them.

{T["mnemonics"]}

Command line words that are not screens (`src/copy/commands.ts` `CHROME_WORDS`): HL (search), NO (event tape), MENU (related functions), LAST (8 recent commands), MAIN, NXTW (open the next command in a new panel), RESET, UNDO (last 10 layout changes), WATCH (record watch), GRAB (panel image), SAVE, LOAD, FORGET (named workspaces). Timeframes for GP: 1m, 5m, 1h, 1d. GIP takes a date.

## 6. Screen inventory, one row per folder

Four views of the same rows. "Own" means found in the folder's own production files; "reached" means through a component the folder uses from `charts`, `grids`, `perspective` or `tiles`. Library names are the chunk names in section 9.

### 6.1 Libraries and components

{T["lib_screens"]}

### 6.2 API routes named

{T["routes_screens"]}

Routes with a `{{name}}` parameter are on-demand GETs. The full route table with refresh behaviour is in section 15.

### 6.3 Keyboard bindings

Own keys are string literals compared with `event.key` in the folder's own files, so a blank row means the screen has no key logic of its own. Every panel also gets the shared panel keys (roving tabindex, Left and Right between items, Tab between panels; section 11) from `chrome/WorkspaceFocus.ts`, and every key in the global map works on top of them.

{T["keys_screens"]}

Component key sets, from `copy/help.ts` (HELP words them): grid keys are arrows, PgUp and PgDn to move through rows, Enter to drill down; chart keys are Left and Right to step the crosshair, plus and minus to zoom, Home and End to jump to the data ends, T to toggle the table view.

### 6.4 Browser features and modern CSS

{T["feat_screens"]}

"Browser features" counts files that use the feature in the folder's own production files. "popover/menu" is a loose text match for menu and pop-up markup, not the HTML `popover` attribute. "download" is a call through `chrome/download.ts`. The word "Intl" means `Intl.*` formatting with an explicit locale (en-GB, en-US or en-CA) and, in many places, the time zone `America/New_York`.

### 6.5 Accessibility markup by folder

Counts of source occurrences, not rendered elements.

{T["a11y"]}

## 7. Support folder inventory

### 7.1 Libraries and components

{T["lib_support"]}

### 7.2 API routes named

{T["routes_support"]}

### 7.3 Keyboard bindings

{T["keys_support"]}

### 7.4 Browser features and modern CSS

{T["feat_support"]}

## 8. What each support folder does (one line each)

| Folder | Role |
|---|---|
| `chrome` | the shell: frame strip, nav toolbar, key toolbar, function bar, command line with suggestions and menus, message line, status bar, connection strip, event tape, panel chrome, tab strip, workspace (dockview host, controller, layouts, recipes, focus roving), record watch, deep links, export menu, download, help |
| `charts` | `CandleChart` (lightweight-charts), `LineStack` (uPlot), `echarts/*` (nine ECharts figure types on one wrapper, tree-shaken), `ChartA11y` (a role=img figure with a data summary and a table toggle), `lazy.ts` (the only place a chart library is imported), crosshair sync, chart tokens read from CSS |
| `grids` | `MonitorGrid` (TanStack table plus virtual, keyboard grid with typeahead, sort, hints), `JournalTable`, CSV |
| `perspective` | the pivot engine loader, `PerspectiveGrid`, pivot table fallback, datasets, reduced-motion mode |
| `tiles` | KPI tile, spec card, balance check, countdown, Eastern Time helper |
| `export` | GRAB image, evidence pack, print dossier, dossier models |
| `state` | zustand stores with guarded `localStorage`: layouts, link groups, workspaces, record watch, safe storage, FNV-1a hash |
| `commands` | the mnemonic registry, parser, line grammar, suggestions, search index, sectors, history |
| `copy` | all user-facing text, with rules tests |
| `theme` | tokens, amber-classic look, colour-vision themes, contrast maths, `useLook` |
| `api` | typed GET client, query hooks, connection state machine, live stream, jobs client, generated schema, contract sync |
| `quant` | small numeric helpers (linear algebra, clustering, normal, power, trials) used by REG panels in the browser |
| `demo`, `gallery` | the in-page demo API and the E2E component gallery (separate builds) |
| `vendor` | stubs that keep unused code of cmdk, TanStack Query and Radix out of the shell |
| `format` | one decimal formatter that rounds on the printed decimal digits |

## 9. Dependencies and bundle

### 9.1 Direct production dependencies

{dc["direct"]} direct, {dc["transitive"]} transitive, {dc["all"]} in all (licence counts: {", ".join(f"{k} {v}" for k, v in sorted(T["dep_licences"].items(), key=lambda kv: -kv[1]))}). "Built size" is the real chunk in `dist` (raw / gzip, kilobytes of 1,000 bytes, JavaScript only; CSS and WebAssembly are separate). Perspective's four packages share four chunks, so they show the same combined figure.

{T["deps_direct"]}

The 12 non-MIT packages in the production tree (all permissive; the three Apache-2.0 and BSD sets need their notices carried):

{T["deps_nonmit"]}

The Perspective client's tree carries command-line helpers (`zx`, `opener`, `qs`, `union`, `leb128`, `buffer-pipe`) that are not in the browser bundle; they matter only for an installer's licence list.

### 9.2 Standalone estimates for the shell's parts

The shell's `vendor` chunk is 49.9 kB raw and 15.6 kB gzip and holds zustand, TanStack Query core and cmdk with its stubs. A source map would give the exact split; none is built. These standalone estimates bound it:

{T["standalone"]}

TanStack Query (36.9 kB raw) and zustand (0.6 kB) already account for about 37.5 of the chunk's 49.9 kB, so cmdk after the two stubs in `vite.config.ts` is about 12 kB raw, not the 50 kB standalone figure.

### 9.3 Build output by category

{T["dist_totals"]}

Total `dist`: {dist_total_mb:.2f} MB including `index.html` and the favicon. The WebAssembly files do not compress (2,459,148 raw against 2,427,720 gzip; the package ships them self-extracting), so over HTTP they cost their full size, and in a desktop bundle they cost 4.0 MB of disk.

Shell (what `index.html` loads before any dynamic import), {T["shell_gz"]:,} bytes gzip in all:

{T["shell"]}

Largest stylesheets: dockview 126.6 kB raw, Perspective 91.3 kB, the app's own shell stylesheet 30.6 kB (which includes Tailwind output):

{T["css_top"]}

The complete asset list (all {T["dist_n_assets"]} files) is in Appendix B.

## 10. Browser capabilities the code relies on

### 10.1 Capability map

{FEATURE_NOTES}

### 10.2 Feature roll-up (production files, gallery and demo excluded)

{T["feat_rollup"]}

### 10.3 Persistence (`localStorage` only, per origin)

All reads and writes go through guarded wrappers (`state/safeStorage.ts` and the tape, history and scheme stores), so blocked storage means defaults, never an error. Stored values are treated as untrusted and validated field by field.

{STORAGE}

Storage is bound to the page origin (today `http://127.0.0.1:8765`). Any shell that serves the app from a different origin or scheme starts with empty storage unless the values are migrated (open question 3).

### 10.4 Exports, clipboard, printing

{EXPORTS}

### 10.5 Time, locale and numbers

- Time zones: `Intl.DateTimeFormat` with `America/New_York` in the status bar clock, the event tape, the record watch and candle charts (instrument time zones for GP and GIP). The page does not use the machine's zone for market time.
- Locale: formatters name `en-GB` (numbers, dates), `en-US` (the decimal formatter) and `en-CA` (ISO-like dates in `screens/gp/model.ts`) explicitly. Eleven `toLocaleString('en-GB')` calls. No use of the navigator language, platform or browser-string properties.
- Decimal rounding: `format/decimal.ts` rounds on the printed decimal digits, because `Intl.NumberFormat` rounds the stored binary value; a native shell must not replace this.
- Clock: 36 lines in production code read `Date()` or `Date.now()`. The server clock (`/api/health` `now_utc`) is used for the GRAB and print captions.

### 10.6 Polling and streaming

Health 2 s (back-off 4, 8, 16, 30 s while down); commands index 60 s; LIVE and JRNL data by stream, else 2 s; event tape 10 s when on; IB snapshot 10 s when on; everything else on demand with a 30 s stale time and one retry on a network error or 5xx. `networkMode: 'always'` is deliberate: the browser online flag says nothing about a loopback server.

## 11. Keyboard grammar

The command line is the primary input; no single printable key is bound globally (WCAG 2.1.4). F-keys are held back from the browser: F2 to F7 are reserved and post a message instead of acting, F8 to F11 insert a sector, F1 is HELP. The global map is `chrome/CommandLine.keys.ts` (`globalKeyAction`), bound once on the document, and it leaves alone any key a panel already handled (`defaultPrevented`).

{keys_md}

Where the browser and the system keep keys: F12, Ctrl+R and Alt+F4 are not bound.

Key groups the front end reads: `key`, `code`, `ctrlKey`, `metaKey`, `altKey`, `shiftKey`, `isComposing`, `repeat`. Platform-specific behaviour of these keys on macOS (Option plus a digit or letter, function keys as media keys, absent Home and End on laptop keyboards) is not checked here; see open question 5.

## 12. Look: tokens, themes, fonts

- `theme/tokens.css` ({T["tok_total"]} custom properties; `@theme inline` maps {T["tok_theme_n"]} of them to Tailwind colour and font names): 39 geometry and type tokens, 177 colour tokens for the default dark theme, 19 colour-vision overrides.
- Looks: standard (amber on black, flat, square, hard cuts with no colour transitions) and `amber-classic` (`theme/amberClassic.css`, {T["amber_n"]} token overrides, values only). Colour schemes: standard, deut, prot (`data-cvd`). Look and scheme combine, and every WCAG pair is tested for each combination (`theme/contrast.test.ts`, `amberClassic.looks.test.ts`, `cssPairs.ts`).
- Geometry is pixel-fixed for a 1920 by 1080 frame: 37 px frame strip, 32 px key toolbar, 22 px nav, 50 px command zone, 21 px message line, 22 px status bar, 20 px grid rows, 24 px minimum target (WCAG 2.5.8). Two narrower breakpoints exist in CSS (700 px and 1100 px). The visual baselines are taken at 1920 by 1080 and 1366 by 768, device scale factor 1.
- Rule: a colour literal appears only in tokens. Outside the token files, hex colours remain in {len(T["hex_files"])} production files: {", ".join(f"`{f}` ({n})" for f, n in T["hex_files"])}; `charts/theme/chartTokens.ts` holds the chart fallbacks.
- Fonts: Bergoom (five vendored woff2 files, SIL OFL 1.1, licence copied into the build as `LICENSE-*.md`), Source Sans 3 (fallback) and PT Mono (fixed grid), both self-hosted through Fontsource, weights 400 and 700 plus italics, latin subset. `font-display: swap`. {T["fonts_tot"]["n"]} font files are in `dist`: {T["fonts_tot"]["woff2"]:,} bytes of woff2 and {T["fonts_tot"]["woff"]:,} bytes of woff ({T["fonts_tot"]["n_woff"]} files) that a current engine never fetches.

{T["fonts"]}

Modern CSS in use (section 6.4 has it per folder), counted over {T["css_counts"]["src"]} source stylesheets ({T["css_counts"]["src_lines"]:,} lines, galleries excluded) and the {T["css_counts"]["dist"]} built ones:

{T["css_rollup"]}

Tailwind 4 emits `@property`, `@layer` and `color-mix()` into the built entry stylesheet; the app's own stylesheets use `@container` (7 files), `:has()` (5), `scrollbar-color` and `::-webkit-scrollbar` (3 each) and `color-mix()` (1). Container queries need Chrome 105, Safari 16 and Firefox 110 or newer (platform knowledge, not checked against a compatibility table here).

## 13. Accessibility machinery

- Standard: WCAG 2.2 AA. Evidence is axe-core through `@axe-core/playwright` with the AA tag set, run in {et["axe"]} Playwright files (shell, keys, home, panels, market, perspective, books, p11, fkeys and the offline demo among them), including with the command dropdown open and with every chart in its table view, at two viewports, and in both colour-vision schemes.
- Panels: each panel is one Tab stop with a roving tabindex inside (`data-roving`, `data-roving-default`, `data-roving-entry`, `data-roving-scroll`, `data-roving-vertical-list`, `data-roving-overlay`). Every other focusable in a panel is taken out of the Tab order. Left and Right move between items, Down enters a tab's content, Home and End go to tab ends, Tab and Shift+Tab move between panels (`chrome/WorkspaceFocus.ts`, 346 lines). A `MutationObserver` keeps the roving state in step with the DOM.
- `inert`: the panel body is made inert while a related-functions overlay is open so it is not a scroll region no key reaches; the lightweight-charts attribution link is kept on screen but made inert (`charts/lwcAttribution.ts`).
- Charts: every canvas chart sits in a `ChartA11y` figure with `role="img"`, a data summary as its name, and a Table toggle (key T) that swaps it for a real table with caption, headers and rows. A test and the visual spec audit this for every chart.
- Live regions: the message line and the status line are the announcement channel; counts per folder are in section 6.5.
- Focus: Esc returns focus to the panel or to the command line; Home and Ctrl+K focus the command line; focus restoration after menus, workspace changes and panel removal has its own tests (`Workspace.focusRestore.test.tsx`, `WorkspaceFocus.test.ts`).
- Motion: `prefers-reduced-motion` is honoured in two stylesheets and by the pivot grid's mode switch (`perspective/pivotMode.ts`); Playwright runs with `reducedMotion: 'reduce'`. `forced-colors` and `prefers-contrast` are not used.
- Colour: contrast pairs are computed from the tokens and tested (text 4.5:1, graphics 3:1) in the default theme, both colour-vision themes and amber-classic.
- Targets: 24 px minimum for interactive items that are not table rows (WCAG 2.5.8).

## 14. Test stack

### 14.1 Unit and component tests (vitest 5.0.2, jsdom 30.1.1, Testing Library)

Static count: {vt["files"]} files, {vt["tests"]:,} `it` or `test` calls, {vt["each"]} `each` tables, {vt["lines"]:,} lines; {vt["jsdom"]} files opt into jsdom, the rest run in Node. The owner's brief quotes about 6,925 tests after `each` expansion; the gap is consistent with the {vt["each"]} tables but was not run to confirm.

{T["vitest_rows"]}

Repository-level tests (`web/scripts`): `bundleCheck.test.ts` (two real Vite builds), `shellBudget.test.ts` (pins each shell piece and the ceiling), `docsSync.test.ts` (the architecture document's endpoint index, the README's commands and pinned versions against the code and the contract), `playwrightConfig.test.ts`, `playwrightOffline.test.ts`, `lineEndings.test.ts`. `pnpm test` first runs `gen-api.mjs --check` (the contract hash).

### 14.2 End to end (Playwright 1.63.0, Chromium)

Static count: {et["files"]} files with test calls, {et["tests"]} calls (the brief: 383), {et["screens"]} screenshot baselines (platform-suffixed, taken on Windows Chromium at `maxDiffPixelRatio` 0.002), {et["axe"]} files with axe.

{T["e2e_rows"]}

Projects and rules (`playwright.config.ts`, `playwright.offline.config.ts`): a fixture-mode backend on port 8795 and a gallery build served by `vite preview` on 4273, never the real 8765; viewport 1920 by 1080, `colorScheme: dark`, `reducedMotion: reduce`, locale `en-GB`, time zone `Europe/London`, one to two workers; the perf budgets are a separate project run alone. The offline configuration runs the same specs against a Node-side demo API and the in-page demo build, on ports 4373 and 4374, with its own baselines (`offline-{{platform}}`).

### 14.3 Performance budgets (`e2e/perf`)

Measured with a Chromium DevTools trace (`Tracing` domain, `DrawFrame` events, `RunTask` slices), against the fixture backend:

| Budget | Limit in code | Value quoted in the owner's brief |
|---|---|---|
| HOME first render, median of three cold loads | 1,500 ms | 647 ms |
| Fills grid, 8,411 rows (open, sort, second page) | 500 ms | 61 ms to open |
| GIP pan and zoom | at least 54 fps, p95 frame interval at most 25 ms, no gap over 50 ms, at least 30 frames | not quoted |
| Long task on the main thread | under 50 ms | not quoted |
| Shell JavaScript | 114,900 bytes gzip (gallery build 115,800) | 114.9 kB |
| Library chunks (gzip) | uPlot 30,000; lightweight-charts 75,000; ECharts 230,000; tanstack-grid 45,000; Perspective 100,000 | n/a |

Every perf run also asserts no console error and that every request is a same-origin GET. A real-data smoke (`e2e/perf/smoke.real.ts`, run by `scripts/smoke_real.ps1`) repeats the budgets and an axe scan on the real run of 8,411 fills.

The numeric crosscheck (`terminal/qa`, about 2,325 checks in the brief) is backend and QA code, outside this inventory. It reads the API's JSON, not the browser.

## 15. API surface the front end calls

{len(json.load(open(WORK / "inv.json", encoding="utf-8"))["schema_paths"])} paths in `contract/openapi.json`, all of them named by the front end (`/api/jobs/{{job_id}}` is built by `jobsClient.ts`). Seventy-two are GET only; `/api/jobs` also has POST and `/api/jobs/{{job_id}}` also has DELETE.

{T["api_routes"]}

Types are generated (`openapi-typescript` into `api/schema.d.ts`, header carries the contract sha256, checked by `pnpm test`). Errors are `ApiError` with kinds network, http and decode; a bodiless 500 counts as an outage (`api/connection.ts`).

## 16. Browser-coupled points a desktop shell must keep, replace or retest

Facts only; the plan decides what to do with them.

1. One origin for the page and the API; relative `/api` URLs; the backend's same-origin and loopback middleware; the CSP (no blob workers, no eval, `wasm-unsafe-eval` only).
2. The page is served from `127.0.0.1:8765`: `localStorage` is keyed to that origin (ten keys, section 10.3). A different origin or scheme loses saved layouts, workspaces, history, theme and links.
3. The `#go=` deep link and `history.replaceState` read the address bar; a window with no address bar needs another way in (launch argument, protocol handler) or none.
4. Server-Sent Events through `EventSource`: the code relies on the browser's automatic reconnect and `Last-Event-ID`.
5. Perspective: a Web Worker plus two WebAssembly files (4.0 MB), fetched on first pivot view, started by `fetchAsset` with `same-origin`, `redirect: 'error'` and no referrer. Used by LEDG, RUN (fills and trades tabs) and OOS.
6. Three canvas engines and one canvas composer (GRAB). GRAB output is read back from canvases (`toDataURL`, `toBlob`).
7. Downloads by object URL and a hidden anchor (CSV, Markdown, JSON, HTML, PNG); a shell has to give these a save path or a dialog.
8. `window.print()` for the dossier, with `@media print` CSS and `afterprint`.
9. `navigator.clipboard.write` with `ClipboardItem` for Copy image, and text copy for run ids.
10. Keyboard: F1 to F11, Alt+1 to 9, Alt+K, Ctrl+K, Home, End, PgUp, PgDn, Shift variants, all handled on `keydown`; F2 to F7 reserved to stop the browser acting. A native menu bar or a platform's own accelerators would collide with these.
11. Text rendering and layout: pixel-fixed geometry, tabular figures, `font-display: swap`, three font families, container queries, `:has()`, `color-mix()`, `@property`, `@layer`. These are engine-version dependent; the three desktop webview engines differ in version and update policy (not checked here).
12. Dockview's DOM layout with fixed sashes; `disableDnd` means no HTML5 drag events.
13. `ResizeObserver` (7 files), `MutationObserver` (3), `IntersectionObserver` (1), `requestAnimationFrame` (5), `requestIdleCallback` (1, with a fallback), `matchMedia` (1).
14. Test tooling: Playwright with Chromium, axe through Playwright, a CDP trace for frame timing and long tasks, and 204 pixel baselines. Each is Chromium and Windows specific as written.
15. The in-page demo API and the offline Playwright target already prove the front end can run with no Python process behind it.

## 17. Unverified, and open questions

1. The `dist` folder predates the HEAD commit by six minutes. Its chunk set matches HEAD's budgets, but equality with a fresh build is not proven. A build with source maps would also settle the vendor split in section 9.2.
2. Test counts are static. The brief's 6,925 vitest and 383 Playwright counts were not reproduced.
3. Which origin and scheme a desktop shell serves the page from, and whether saved storage is migrated. The inventory shows what is at stake (ten keys); it does not decide.
4. Whether `EventSource` and `fetch` against a loopback server behave the same in each desktop webview. Not tested here.
5. macOS key behaviour of the global map (Option combinations, function keys, no Home and End on laptops, Cmd versus Ctrl) is unchecked: no Mac is reachable from here.
6. The webview versions each platform would run, and therefore whether Tailwind 4's floor (Safari 16.4, Chrome 111) and the app's `:has()`, `@container` and `color-mix()` hold on every supported OS release. Not checked here.
7. Printing from a desktop webview (`window.print()` for the dossier) and clipboard image writes are not tested outside Chromium.
8. The bundled-licence list in HELP names only MIT packages; Apache-2.0 (ECharts, zrender, lightweight-charts, Perspective) and BSD-3-Clause (zrender, qs) notices are not in the in-app list. Whether the build already carries them elsewhere was not checked.

## Sources

{SOURCES}

## Appendix A. Production files in `src/screens`

{T["appendix_count"]} production files (tests, gallery pages and fixture data excluded), with physical line counts.

{T["appendix_files"]}

## Appendix B. Every asset in `dist`

{T["dist_all"]}
"""
OUTFILE.write_text(doc, encoding="utf-8", newline="\n")
print("written", OUTFILE, len(doc))
