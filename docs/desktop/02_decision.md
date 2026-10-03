# 02: Architecture decision for the desktop terminal

Step 02 of the desktop migration plan. It takes the options in `01_options.md` and the three challenge reviews of that step, decides the target architecture and the path to it, answers the owner's "light and fast" with numbers, names the measurements that would change course, and records a verdict on every challenge finding.

- Date: 2 October 2026. Repository `nq-lab/terminal`, HEAD `c7f9e61` (v2).
- Status: **decided**, with two questions for the owner still open (gate G0 in section 6.1: which Mac, and where the lab lives for it). Nothing here changes code. The stages in section 5 are the plan.
- Inputs: `01_options.md`, `00_inventory_backend.md`, `00_inventory_frontend.md`, `00_spike_webview2.md`, `00_spike_rust.md`, `research/L1` to `L7`, and three challenge reviews of step 01 (hidden costs and consistency, performance, security). The code facts the reviews quote were re-read for this step: `backend/nq_terminal/services/jobs.py` lines 98 to 99 and 342 to 346, `settings.py` lines 18 to 27, `app.py` lines 108 to 110, and `__main__.py`.
- Labels: **measured** means the inventory or a spike measured it on the owner's Windows 11 PC; **sourced** means a URL in the sources list, checked on 2 October 2026; **estimate** means a figure built by this plan; **unverified** means not confirmed from a primary source. Tags S1 to S40 refer to the sources of `01_options.md`; tags D1 to D12 are new and listed at the end.
- This step ran no app, opened no window and measured nothing. Nothing has been measured on a Mac by any step.
- The rescoring in section 8.1 is reproducible: it keeps the weights and the arithmetic of 01 (total = sum of weight times score, divided by 5), and changes only the cells listed there.

## 1. The decision in five lines

1. Keep today's React page and the lab's own Python backend, and wrap them in a thin native shell. No native UI rewrite and no Rust backend.
2. First make the backend start fast and the app shell-neutral (stage 1). Nearly all of the speed the owner will feel comes from there, and the browser terminal gets it too.
3. The shell is Tauri 2 (Rust) on Windows and macOS if the Mac WebKit gate G1 passes on numbers fixed in advance; if it fails, Electron on both. By default Windows shell work may start once stage 1 is done and T2 has been read, with or without G1; no Mac shell code is written before G1 (section 3.3).
4. Rust goes beyond the shell only as PyO3 modules for profiled arithmetic kernels after Python caching has been tried (G3), and a natively drawn view only for a screen that misses its frame budget.
5. By default the Mac app attaches over an SSH tunnel to the one lab on the Windows PC, so the research gate keeps one audit log. A second lab on the Mac needs a change to the lab's gate and the owner's go.

## 2. Context

### 2.1 The ask

The owner wants the terminal as a native app on macOS and on Windows, "light and fast", with Rust or a C-family language preferred but not required. The plan has to be honest about effort and risk, and must not regress four things: correctness and the three-way crosscheck, the research gate (with the write ban and the read-only IB client), WCAG 2.2 AA accessibility, and the amber-on-black look.

### 2.2 What the evidence settles

- **Page speed belongs to the engine, not the shell.** Per-screen times in a Tauri window and in headless Edge agree within 13% on all 8 screens tried; HOME took 753 ms in WebView2 against 752 ms in Edge on a warm fixture backend (measured).
- **The window costs little.** The Tauri spike reached its process `main` at 23 ms and had the window and WebView2 built at 318 ms (medians of 5, measured).
- **The backend sets the start.** It takes 2.6 to 3.1 s from process start to the first `/api/health` on a quiet machine and 3.6 to 5.1 s under load; about 2.3 s of that is imports, with scipy.stats and `analytics.perf` alone about 0.57 to 0.66 s (measured).
- **The slow screens are backend reads.** On real data `EQ` settles in 2,330 ms and `REG` in 1,248 ms, in Tauri and Edge alike. Cold routes: `/api/ledger` 4,312 ms, `/api/analytics/spa` 3,575 ms, `/api/seasonality/instrument` 2,268 ms, bootstrap 1.4 s each; several are no faster warm (measured).
- **Memory.** The Tauri UI tree used 191 MB private at HOME and 238 MB after eight screens. After the heavy set (an 8,411-row Perspective pivot and six more panels) the WebView2 side used 375 MB private, about 378 MB with a Rust exe as host (derived). The backend used 139 to 186 MB at ready, about 300 MB after 16 typical routes, and 1,170 MB working set (peak 1,464 MB) after a sweep of every route with a 256 MiB bar cache (measured). Its default cap is 2 GiB (`settings.py` line 23), so heavier totals are possible.
- **On Windows, WebView2 is Chromium.** In the one method-described CI benchmark an empty app used 317 MB under Tauri and 278 MB under Electron on Windows (S4). In Tauri issue 5889, real pages used more memory under Tauri than under Electron on both systems (399 against 318 MB on Windows, 421 against 337 MB on macOS, per L5 S15; the issue is closed, D3).
- **A native UI saves UI memory only.** The egui spike held 77 to 84 MB private on synthetic data (measured), but every native route keeps the same backend, costs 52 to 147 weeks, and the Rust toolkits expose no grid or table structure to Windows screen readers (S7).
- **The Mac is unmeasured.** If the lab runs on the Mac, NautilusTrader 1.231.0 needs Apple Silicon on macOS 26 or later (S18).

### 2.3 What the challenges changed

The three reviews raised 39 findings, 8 of them HIGH. Every one is answered in section 9. These are the ones that change the decision:

- **The A against E lead was within scoring error.** Step 01 had 84.8 against 83.5. Rescored with the accepted findings, Electron leads at 01's own weights (section 8.1). The choice of Tauri is therefore argued in section 3.3, not read off a total.
- **The headlines counted only the window.** From double-click to a usable HOME, today's stack takes about 7 to 9 s with a cold backend (estimate from measured parts, section 4.1), and the whole app uses about 430 to 500 MB private at HOME (estimate, section 4.2). The Python work therefore moves from an optional later phase into stage 1.
- **Costs that 01 did not price:** saved workspaces had no storage channel that works; two backends would share `jobs.json`; a lab on the Mac would split the gate's audit trail; the shipped Mac engine could not be tested with today's suites; A had no upkeep figure; and the plan promised "no page commands" while needing three.
- **Two security gaps:** the planned updater and save dialog gave a pushed workflow or a compromised page a way to ship code or write files.

## 3. Decision

### 3.1 Target architecture

```
 Shell: Tauri 2.12.x (Rust); Electron 44 on both systems if G1 fails
   framed window, bundled splash in the amber look, lab picker,
   identity check on every top-level navigation, file export through the
   download handler, one native write module with a deny list,
   no plugin permissions for the page, no auto-updater
   |
   |  Windows: spawns <lab>/.venv python -E -s -X utf8 -m nq_terminal
   |           (working folder terminal/backend), or attaches to the lab's
   |           running backend through its lock file
   |  macOS, default: attaches to the PC's backend over an SSH tunnel
   v
 FastAPI backend: same contract, plus the stage 1 seams
   binds 127.0.0.1:0; prints port, token proof, ROOT, interpreter and
   contract version; one backend per lab; token cookie on every /api call,
   the live stream included; stdin watchdog stops JOBS and exits when the
   parent goes; workspaces stored as files under terminal/state/workspaces
   nq_lab.data.serve stays the only door to prices; JOBS unchanged
   v
 Page: today's React build, served by the backend
   (same origin, same CSP, same SSE, same Perspective worker)
   WebView2 (Chromium 154) on Windows, WKWebView on macOS,
   or Chromium 152 inside Electron
```

### 3.2 Why this shape

- **Every proof is kept.** The page, the API and the backend stay, so the backend tests (about 2,875), the crosscheck (about 2,325 checks), the golden files, the unit suite (about 6,925) and the end-to-end suite (383), the gate, the write ban and the read-only IB client all carry over.
- **The work goes where the time goes:** Python imports and slow routes (section 4).
- **The window is light.** The spike shell is a 3,224,576-byte exe with a 1,195,347-byte NSIS installer (measured). That shell has no plugins and no supervision, so the production shell is quoted as under 15 MB until it is built and measured (estimate).
- **Native UIs lose.** The only measured gain from a native UI is UI memory. That saving, about 110 to 300 MB or 10 to 30% of a heavy session, does not pay for 52 to 147 weeks, the loss of every front-end test and an accessibility gap on grids.

### 3.3 Why Tauri, although the rescored matrix favours Electron

With the accepted findings, 01's fixed criteria give Electron 86.2 against Tauri's 80.8 before G1, and 86.2 against 84.8 if G1 passes (section 8.1). Tauri stays the lead for three reasons, under one condition.

1. **After a G1 pass the gap is 1.4 points.** One half-point step on a weight-15 criterion is worth 1.5, so the matrix cannot separate the two.
2. **The tie breaks on the owner's own words.** The criteria give install size 5 of 100 points and do not score the Rust preference at all, yet the ask names both. After a G1 pass, Tauri leads whenever speed and lightness carries 30 or more of the 100 points (A 83.5, E 82.4), or whenever install size counts for half of that criterion (A 86.5, E 83.8). This is a judgement and is recorded as one; it is not a score.
3. **The gains are concrete for this owner.** Drive C: on the PC is 99% full; the Tauri installer is about 1 MB, against an Electron runtime of 157,998,329 bytes zipped (S2). The app also has no bundled Chromium or Node to patch: Electron listed 41 advisories in 2026 up to 2 October (S22). Most of those need untrusted content in the page, which this app does not load, so this point weighs less than 01 said.

**The condition.** Before G1, Electron leads by 5.4 points, and 8 of its 10 points of advantage come from WebKit being unproven: parity and the look, the crosschecked maths on the Mac's JavaScript engine, and the risk and test work on the Mac. A G1 failure therefore means Electron on both systems, not a split shell. If Electron, measured on this PC, turns out lighter or faster by a margin (trigger T2), Electron wins even with a G1 pass.

**The default for shell code before G1** (one rule, used everywhere in these documents):

- **Windows shell work** (stage 2) may start once stage 1 has met its exit and T2 has been read (stage 0.2), with or without G1. The risk taken is stated: if G1 later fails, Windows moves to Electron at about 3 to 5 weeks (section 5, Totals).
- **Mac shell work** (stage 3) never starts before G1 passes.
- The owner can hold all shell work until G1 instead (question 2, section 10).

### 3.4 Where Rust and C sit

- **The shell is Rust:** a few hundred lines to about 1,500 by estimate, covering supervision, the handshake, the download handler and the write module.
- **Rust in the backend** comes only as PyO3 modules behind existing Python functions, after the stage 1 cache, and only under gate G3 (section 6.4):
  - for pure arithmetic kernels that use neither NumPy's random stream nor pandas semantics;
  - shadow-tested for one release at the crosscheck tolerances (1e-9 relative, 1e-12 for stored anchors).
- **Never in Rust:** the research gate, JOBS, the IB client, or reading bars.
- **C or C++:** none is planned. Qt 6 in C++ (option D) has the strongest native accessibility, but costs 52 to 95 weeks and rebuilds the look by hand.

## 4. "Light and fast", in numbers

Today's figures are measured unless marked. Targets are estimates, recalibrated from a quiet-machine run at the start of stage 2; ceilings fail the build. Today's browser budgets (HOME 1,500 ms, grid 500 ms, shell bundle 114.9 kB gzip) stay in force unchanged. Mac figures come from G1.

| Metric (Windows, this PC) | Today | Desktop target after stages 1 and 2 (ceiling) | What a native Rust UI would change |
|---|---|---|---|
| Install | none (browser) | shell installer under 15 MB (30 MB); the spike measured a 3.2 MB exe and a 1.14 MiB installer | egui exe 10.8 MB (measured, synthetic) |
| Disk needed beyond the install | lab venv 690 to 723 MB, already on disk | same, not shipped | same: the backend stays |
| Window built | not applicable | 318 ms (measured on the spike) | hidden egui window, first frame 568 ms (measured) |
| Shell painted (splash in the look, no data) | the browser waits for the backend | 500 ms (1,000 ms) | about the same |
| Backend ready, quiet machine | 2.6 to 3.1 s | 2.0 s (2.5 s) after lazy imports (estimate, section 4.3); 1.5 s only if pandas and numpy also leave the start path, unknown until item 1.1a | no change |
| Double-click to HOME with data, backend cold | about 7 to 9 s (estimate from measured parts, section 4.1) | 4.5 s (6 s, provisional) with the persisted result cache and the HOME prewarm (section 4.1); ceiling fixed from the stage 1 measurement | no change |
| Warm start to HOME with data | 1,642 ms from navigation start on real data (Tauri spike); 647 ms in the fixture budget run | 1,000 ms (1,500 ms) | chrome perhaps 0.3 to 0.5 s sooner; data no sooner |
| Real-data screens `EQ`, `REG`, warm | 2,330 ms, 1,248 ms | 1,000 ms each (1,500 ms) with the result cache | no change: backend time |
| Slow routes (`/api/ledger`, SPA, seasonality) | 4.3 s, 3.6 s, 2.3 s, warm much the same | repeats under 100 ms (300 ms) from an mtime-keyed cache (estimate); the first call in a new process is also served from the cache on disk when the route reads no prices and its input files are unchanged, and is unchanged otherwise (section 4.1) | no change |
| Grid open, 8,411 fills | 61 ms (budget 500 ms) | 61 ms or less (500 ms) | a frame costs about 0.6 ms (synthetic) |
| Chart pan and zoom | rule: 54 fps, p95 25 ms; test skipped offline | p95 16.7 ms (25 ms), to be measured | 1.1 to 1.2 ms a frame with decimation (synthetic, 1M points) |
| Keystroke to paint, command line | not measured | p95 50 ms (100 ms), to be measured | unknown: not measured either way |
| Whole app, idle at HOME, private memory | about 430 to 500 MB in the app (estimate from measured parts, section 4.2); the browser path is of the same order | no more than the same HOME in the browser terminal, measured in the same session (550 MB) | about 110 to 190 MB less |
| Whole app, heavy session | 1.2 to 1.5 GB possible (measured sweep at a 256 MiB cache); over 2.5 GB possible at default caps (estimate) | 1.0 GB (1.5 GB) with desktop caps of 512 MiB for bars and 128 MiB for files | 110 to 300 MB less (10 to 30%) |

How to read it:

- **Stage 1 is what makes the app fast.** It shortens the cold start and the slow screens in the app and in the browser alike.
- **A Rust UI would buy two things:** about a third less UI memory, and chrome painted a little sooner. It would not move any time to data. Measured differences between the two web shells on Windows are within noise.
- **What "light" honestly means.** The desktop app runs the same engine and the same backend as the browser terminal, so at HOME it uses about as much memory as the browser path, not less. Its measurable lightness is elsewhere: an installer of about 1 MB against an Electron runtime of about 158 MB (S2), no browser to keep open, and desktop cache caps that hold a heavy session to 1.5 GB where today's defaults allow over 2.5 GB. The pitch must say this plainly.
- **Measurement rules.** Every number above is the median of 3 runs on a quiet machine. The window is created hidden. Memory is the private working set of the whole process tree, backend included.

### 4.1 Cold HOME, route by route

HOME is a 2 by 2 grid of GP, MON, EQ and REG (`00_inventory_frontend.md`, section 4.1). Read from the screen folders' route lists and the panels' source, it asks for these routes on a cold backend (cold times from `00_inventory_backend.md` section 4, in process, measured):

| Panel | Heavy routes on first open | Cold time |
|---|---|---|
| EQ | `/api/analytics/hypothesis/{name}/bootstrap`; `/api/analytics/hypothesis/{name}` | 1,408 ms; 390 ms |
| MON | `/api/market/two-day` (reads prices through the gate); `/api/market/universe` | 1,260 ms; 436 ms |
| REG | `/api/analytics/deflated`, only when the panel is wide enough for the full board (`needsDeflated` in `screens/reg/regViews.ts`); the rest light | 1,062 ms |
| GP | `/api/runs` (run index built on first call, 1,318 to 1,419 ms over HTTP); its other routes are light | about 1.3 s |
| Record watch, after the first idle moment | `/api/ledger` (3,846 to 4,302 ms over HTTP), `/api/runs` again | about 4 s, competing with the last HOME reads |

`/api/analytics/spa` (3,575 ms) is not on HOME: only the MT screen asks for it. The handlers above are CPU-bound Python under one interpreter lock, so they largely run one after another: about 4 to 6 s of handler time before HOME is ready. That fits the one cold measurement there is: the Tauri spike's first run, with the backend already started but no route yet served, took 5.8 s from launch to HOME ready on a loaded machine (`00_spike_rust.md`, Caveats). The 1,642 ms warm figure is the same HOME with the backend's own caches full; two-day and bootstrap recompute on every call even then.

The cold double-click adds the backend start in front: today 2.6 to 3.1 s, plus about 0.1 s for the handshake and navigation, plus 4 to 6 s of routes, so **about 7 to 9 s** (estimate; the route part rests on one measured run). Stage 1 as first written could not meet a 5 s ceiling: lazy imports bring the start to about 2.0 to 2.4 s, and an in-memory result cache is empty in a new process, so every slow route misses it.

**What the cold-HOME budget relies on.** All three of the following, and none of them is optional:

1. **The result cache persists to disk for routes that read no prices** (item 1.2). Entries whose computation made no gated read (the read hook records whether `serve` was called) are written under `terminal/state/cache/`, capped at 64 MiB, keyed as in memory on the route, the normalised query and the (path, mtime_ns, size) of every input file, and re-checked against those files before use. On HOME that covers deflated (its trials are built with no bar service), the run index and the ledger. EQ's bootstrap is covered only when the hypothesis carries a recorded benchmark: for an NQ-unit hypothesis without one, `analytics/series.py` builds an NQ buy-and-hold benchmark from bars through the gate, so that entry stays in memory and is prewarmed instead. This is a new write by the backend: it is counted in section 7.2, and the write-ban scan must allow exactly that module and that folder. **Gate log:** entries that made a gated read (two-day, universe, bars) stay in memory only and die with the process, so each backend process still logs its first read of each window exactly as today; nothing price-derived is stored on disk, and the gate log keeps its present meaning.
2. **A HOME prewarm.** As soon as the backend has bound its port it computes the price-reading HOME routes for the saved HOME layout (two-day and universe for the default universe, bars for the GP instrument, and EQ's bootstrap when it reads bars) in a background thread, so they are under way while the splash and the page load. The reads go through the gate with `caller="terminal"` and the same reason as the page's own reads, so the log gains no new kind of line.
3. **A measured ceiling.** With 1 and 2 the estimate is about 2.0 to 2.4 s to backend ready, then about 2 to 2.5 s of uncached handler time (two-day, universe, hypothesis analytics and the light routes, partly overlapped by the prewarm): **about 4 to 5 s**, or about 5.5 to 6 s when EQ's bootstrap reads bars and cannot come from disk. The target is 4.5 s and the ceiling is provisionally 6 s. At stage 1 exit the ceiling is fixed from a quiet-machine measurement (median of 3 cold launches plus 20%, never above 6 s), and G2 tests against that figure. **Decided (DEC1, 3 October 2026, a decision the owner delegated): the cold launches are first launches after an install, with an empty state folder.** That is the worst case and the one a new user meets, so the 6 s cap and the 4.5 s target are read on it, the ceiling is its median plus 20%, and T3 fires when it is above 6 s. The usual launch (a state folder an earlier launch filled) is held to the same cap and must not regress against the ceiling recorded for it at W3B (4,508 ms). `docs/desktop/stage1/measure_stage1.mjs` gates both (`HOME_READING` is `first-launch`, `HOME_READING_RATIFIED` is true).

A launch after the lab's result files have changed (a new run, a ledger append) misses the disk cache for the changed routes and pays the old cost for them; it is reported beside the budget, not gated on its own, and it is no slower than the first launch, which is gated. The opt-in resident backend (T3, question 6) is the answer if the measured cold figure is still too slow.

### 4.2 Memory at HOME

The earlier figure of 330 to 380 MB added the UI tree at HOME (191 MB private, Tauri spike, measured) to a backend that had served nothing (139 MB private, 186 to 189 MB working set at ready, measured). But HOME's four panels and the record watch have made the backend serve about ten routes by the time HOME is ready. The nearest measurement is the backend after 16 typical routes: 299 to 300 MB working set (`00_inventory_backend.md` section 6). Its private share is not measured; at ready it was about 74% of the working set, and the growth after start is mostly heap, which is private, so about 250 MB private is a fair estimate.

- **Idle at HOME, whole app:** about 191 + 250 = **about 440 MB private**, between 430 and 500 MB depending on how much of the backend's working set is private (estimate).
- **Not yet counted:** MON's two-day reads fill the bar cache with year-aligned frames for the universe; on real data that has not been measured, and it can add up to the bar cache cap. The fixture warm-up of the WebView2 spike reached 872 MB working set (819 MB private) with synthetic bars cached, which shows how far the cache can carry it.
- **The browser path** holds the same page renderer (about 250 to 270 MB private in both hosts, `00_spike_webview2.md`) and the same backend, so it is of the same order.

The idle target is therefore relative, not a promise of lightness: the app at HOME must use no more than the browser terminal at HOME measured in the same session, with an absolute ceiling of 550 MB. The heavy-session ceiling (1.5 GB at the desktop caps) is where the desktop is measurably lighter than today.

### 4.3 Backend ready: the import arithmetic

Start-up today is 2.63 to 3.13 s from process start to the first health answer on a quiet machine, with the import of the whole app at 2,346 ms under `-X importtime`. Self time by package (`00_inventory_backend.md` section 6, approximate):

| Package | Self time | Stage 1.1 |
|---|---|---|
| scipy | 657 ms | lazy: `scipy.stats` and the clustering calls move inside the functions that use them; saves about 0.6 to 0.66 s |
| exchange_calendars | 86 ms | lazy candidate; saves up to about 0.09 s |
| pyarrow | 68 ms | lazy candidate if nothing at start needs it; saves up to about 0.07 s |
| pandas and numpy | 243 + 166 ms | stay for now: they load through `nq_lab.oos_gate` and through the analytics modules at import. Deferring them means importing the gate and the analytics bodies only inside handlers; possible saving up to about 0.4 s, unknown until item 1.1a |
| the terminal's own modules and pydantic model building | 553 ms | stay: routes and their models register at start. Lazy routers may save a part, unmeasured |
| fastapi, pydantic | 113 + 75 ms | stay |

The sure savings (scipy, exchange_calendars, pyarrow) total about 0.75 to 0.8 s, which takes the start to **about 1.85 to 2.35 s**. Hence a target of 2.0 s with the 2.5 s ceiling. A 1.5 s start needs pandas and numpy off the start path as well; that is marked unknown until item 1.1a has profiled it, and is not a target.

## 5. The path, stage by stage

Weeks are focused build weeks for one developer working with automated build runs. All are **estimates**, to be recalibrated after the first stage 2 item. Calendar time depends on how many weeks a month the owner gives the work.

### Stage 0: decide and measure (about 1.2 to 2.5 weeks, mostly time on the Mac)

| Item | Weeks |
|---|---|
| 0.1 The owner answers G0 (section 6.1) | owner time |
| 0.2 Electron 44 measured on this PC with the spike's harness: a hidden window (`show: false`), caches and profile under `D:\dev`, the page from a fixture backend on a spare port, the window closed at once. Whole-tree private memory at HOME and after the heavy set, and launch to HOME ready. **Baseline:** the Tauri spike shell re-run in the same session against the same fixture backend, never the earlier spike's figures (those used the real-data backend). **Protocol:** inside a quiet-machine window the owner names (O16 in `04_roadmap.md`), at least 10 runs of each shell, interleaved (Electron, Tauri, Electron, ...), with the machine's CPU load logged before each run. Feeds T2 | 0.2 to 0.5 |
| 0.3 The Mac WebKit gate G1 (section 6.2), including whether Gatekeeper blocks a locally built app and whether blob downloads reach Tauri's download handler in WKWebView | 1 to 2 |

### Stage 1: a shell-neutral foundation (about 4.75 to 8.25 weeks; no Mac needed; can start now; also ships to the browser build)

| Item | Weeks |
|---|---|
| 1.1 Start-up: lazy imports of scipy.stats, `analytics.perf` and the route modules; a test that pins what is imported at start | 0.5 to 1 |
| 1.2 Result cache for the eight routes slower than 1 s, keyed on the input files' modification time and size as `FileCache` already is; crosscheck dumps compare cached and fresh answers. Entries that made no gated read persist under `terminal/state/cache/` (64 MiB cap); entries that read prices stay in memory. A HOME prewarm after the port is bound (section 4.1). The persistence and prewarm put the item at the upper end of its range (estimate) | 1 to 2 |
| 1.3 One backend per lab. A lock file under `terminal/state`. The backend binds port 0 itself and prints, on stdout, the port, a token proof (HMAC of the token and a shell nonce), ROOT, `sys.prefix`, the `nq_lab` and `nq_terminal` paths and a contract version. A second launcher attaches instead of spawning. JOBS is refused unless `sys.prefix` is `ROOT/.venv`, and in desktop mode unless `NQT_FIXTURE_DIR` is unset | 0.75 to 1.25 |
| 1.4 Token on both doors. The token goes in a header to one GET, which sets an HttpOnly, SameSite=Strict cookie with `Path=/api`. The cookie is checked on every `/api` call, the stream included, with `hmac.compare_digest`. `start.ps1` and the Mac launcher open the browser through the same one-time step. Desktop mode accepts exactly one origin, `http://127.0.0.1:<port>` | 0.5 to 1 |
| 1.5 An allow-listed environment in `_child_env` and in the launchers; a stdin watchdog (on end of file it calls `JobService.close()` and exits); desktop cache defaults (512 MiB bars, 128 MiB files), with route times checked | 0.5 to 0.75 |
| 1.6 A workspace store: one versioned, size-capped PUT route that writes only `terminal/state/workspaces/*.json`, schema-checked like today's import. The page moves workspaces and layouts to it and keeps `localStorage` as a cache, with a one-time import from the browser. The GET-only test is updated to allow exactly three writes | 1 to 1.5 |
| 1.7 A shell bridge in the page: one small interface (`saveFile`, `copyImage`, `bridgeVersion`) whose browser implementation is today's behaviour. A test pins the wasm32 Perspective server. Immutable cache headers for the hashed assets, only if a measurement shows revalidations | 0.5 to 0.75 |

Exit: backend tests and the crosscheck green, browser budgets unchanged, the "backend ready" and real-data screen targets of section 4 met on this PC, and the cold-HOME ceiling fixed from a quiet-machine measurement (section 4.1).

### Stage 2: the Windows app on Tauri (about 6.25 to 9.75 weeks; starts after the stage 1 exit and the T2 reading, with or without G1, section 3.3)

| Item | Weeks |
|---|---|
| 2.1 Shell and window. **Window:** framed, because NVDA stays silent in a frameless Tauri window (S34); single instance, ignoring forwarded arguments; window state; a bundled splash in the look; the lab picker. **Keys and links:** browser accelerator keys off; new-window requests denied, except the attribution link, which opens in the system browser. **Hardening:** `WEBVIEW2_*` variables removed from the shell's own environment, and the HKCU WebView2 policy key checked for debugging flags (D8); the WebView2 data folder on the drive the owner picks; test hooks compiled only under a `smoke` cargo feature, which release CI refuses | 2 to 3 |
| 2.2 Supervision: spawn as in section 3.1, or attach; a Windows Job Object as a second guard behind the backend's watchdog; no console windows; a restart policy; a bundled "backend stopped" page; the identity proof re-run on every top-level navigation | 1 to 1.5 |
| 2.3 Native writes. **Export:** through Tauri's download handler (`on_download`, D2) with the native save dialog, so the page needs no command. **One write module** for every native write: it resolves the destination fully (symlinks, junctions, 8.3 names, the `\\?\` prefix) and refuses anything under `<lab>/results`, `data`, `live`, `backtests/output`, `.venv` or `src`. **Image copy:** a native fallback only if the clipboard API fails. **Test:** every core and plugin command is called from the page and must be refused | 0.75 to 1.25 |
| 2.4 Proof (G2). **Budgets:** the section 4 targets with whole-tree memory; first launch after a reboot; traces of pan and zoom at 20,000 bars and of keystroke to paint. **Correctness:** a hidden-window smoke test over the debugging protocol (test builds only); the served-JSON check (`qa/crosscheck/served.py`): every route that has a crosscheck dump is fetched through the app's session from the app-launched backend (fixture mode) and compared byte for byte with the in-process body of the same commit. The crosscheck itself reads only dumps written by in-process backend tests and never sees served JSON, so it cannot be "run against" the app; the two checks together are the proof. **Endurance:** an all-day soak at the shipped cache defaults; 30 to 60 minutes minimised with the stream live, then a restore. **Supply chain:** cargo-deny with a source allow list, cargo-audit, Clippy bans on `TcpStream` and on file writes outside the write module, reviewed lockfile changes, and the existing write and IB scans extended to the shell source. **Drift:** a scheduled job that re-runs the unit and smoke suites on the current WebView2 runtime and alerts on any change | 2 to 3 |
| 2.5 Package: NSIS per-user without admin, with a choice of install folder, and the WebView2 bootstrapper. Release builds use the MSVC host in CI, with `rust-toolchain.toml` and `--locked`, on Tauri 2.12.x (2.11.6 or later, S21). No auto-updater: each release is built from a tagged commit | 0.5 to 1 |

### Stage 3: the Mac app on Tauri after a G1 pass (about 5.75 to 12 weeks)

| Item | Weeks |
|---|---|
| 3.1 WebKit proof. **In CI, on every change:** the golden tests of `web/src/quant` under JavaScriptCore. **In the real WKWebView:** an in-app self-test page, loaded hidden, that reports to the shell log; and a smoke set driven through the WebdriverIO Tauri service's embedded WebDriver server (D1), in test builds only. **Baselines:** Mac visual baselines, with axe and contrast re-run on WebKit | 3 to 4.5 |
| 3.2 WebKit fixes found by G1 and 3.1 | 1 to 4 |
| 3.3 Mac keys and menus: alternatives for F8 to F11, Cmd conventions, the Edit menu items, and a help overlay with the Mac bindings | 1 |
| 3.4 Remote mode: the shell opens an SSH tunnel to the PC, reads the token from the lab's lock file over the same connection, and attaches; a clear screen appears when the PC cannot be reached | 0.5 to 1 |
| 3.5 Package: a local build from a tagged commit. Developer ID and notarisation only if stage 0 shows that Gatekeeper blocks a locally built app (unverified, D9) | 0.25 to 1.5 |

Exit: the G2 proof repeated on the Mac with the in-page harness.

### Totals

| Path | Focused weeks (estimate) |
|---|---|
| **Lead: stages 0 to 3 on Tauri** | **about 18 to 32.5** |
| Electron on both after a G1 failure: stages 0 and 1, then Electron on Windows (5 to 8.5) and on the Mac (3 to 5.5) | about 14 to 25 |
| Windows already built on Tauri when G1 fails: Windows moved to Electron | plus about 3 to 5 |
| Split shell (Tauri on Windows, Electron on the Mac), only if the owner asks for it | the Mac on Electron (3 to 5.5), plus 2 to 3 for a second pipeline and a second implementation of the bridge |
| Later phases on evidence (section 6.5) | accessibility gaps 2 to 4; one PyO3 kernel 2 to 4 each; binary columns 2 to 3; a bundled demo engine 3 to 5; one native view 4 to 8; local-lab mode on the Mac 1 to 2 plus the gate change |

The lead grew from 01's 14 to 24.5 weeks because stage 1 now counts in full. About 2.5 to 3.5 weeks of stage 1 were already inside 01's phases 1b to 1d.

**Sequencing.** Stage 1 starts now. Stage 2 starts on Tauri once stage 1 has met its exit and T2 has been read, whether or not a Mac has been available for G1 (the default of section 3.3), for three reasons:

- Windows is the daily machine.
- Drive C: is full.
- The owner prefers Rust.

Stage 3 waits for G1 in every case. The bridge interface keeps a later move of Windows to Electron at about 3 to 5 weeks, which is the work at risk if G1 fails after stage 2 has started.

## 6. Gates and triggers

### 6.1 G0: the owner decides (during stage 1, before stage 3)

- **Which Mac?** The chip, the macOS version and the display (refresh rate and pixel ratio set the frame target and canvas memory).
- **Where does the lab live for it?**
  - **Remote mode (recommended default).** The Mac app attaches to the PC's backend over an SSH tunnel, through an OpenSSH server or a private network on the PC (installing either is the owner's decision).
    - Gains: one lab, one gate log, no copied data, no venv to rebuild. There is no macOS 26 floor either: that floor comes from the NautilusTrader wheel and applies only where the lab runs (S18).
    - Costs: the PC must be on and reachable, and the live stream's latency over a tunnel is unmeasured.
  - **Local-lab mode.** A second lab on the Mac, on Apple Silicon with macOS 26 or later.
    - The gate's audit log would need splitting by machine, for example one log file per host, with sealed openings allowed on one machine only. That is a change to the lab's own gate code, outside the terminal, so it needs the owner's go and its own tests.
    - The shell must also pass the IB settings explicitly from a small settings file, because an app started from Finder does not inherit the login shell's environment.

### 6.2 G1: the Mac WebKit gate (stage 0)

Pass needs all four of these:

1. **Maths.** The golden tests of `web/src/quant` give the same answers under JavaScriptCore as under V8, within 1e-9 relative.
2. **Features, in the real WKWebView** (self-test page, hidden window):
   - Perspective ready on the wasm32 server, and dockview as the terminal uses it: a saved layout restored, a panel added and removed, fixed sashes. Drag and drop is off in the terminal (`chrome/Workspace.tsx` passes `disableDnd` and `disableFloatingGroups`, `00_inventory_frontend.md`), so it is not tested and cannot trigger T1.
   - The live stream in stream mode, not the polling fallback.
   - `127.0.0.1` allowed through `NSAllowsLocalNetworking` (S25).
   - Text and image copy, and a blob export saved through the download handler.
   - The Mac key alternatives reach the page.
3. **Numbers in a hidden window on the Mac,** against the PC's backend or a fixture backend:
   - shell painted within 1,000 ms;
   - warm HOME with data within 1,500 ms;
   - UI physical footprint at HOME at most 350 MB;
   - the 8,411-row grid open within 500 ms;
   - pan and zoom p95 within 25 ms, if a hidden WKWebView produces frames. If it does not, the owner runs one visible measurement on the Mac.
4. **Fixes fit the budget.** Every WebKit defect found has a fix estimate, and the sum fits the 4 weeks of item 3.2.

**Fail on any one:** Electron on both systems. If Windows is already built on Tauri, the owner chooses between moving it (about 3 to 5 weeks) and the split shell.

### 6.3 G2: Windows acceptance (end of stage 2)

To pass:

- **Budgets:** every section 4 target met within its ceiling. Four readings were decided on 3 October 2026 (DEC1, decisions the owner delegated; the evidence is in `d5_integration.md`): the cold HOME is read on a first launch after an install, with an empty state folder, against the 6 s cap (target 4.5 s), and the usual launch must not regress against its W3B ceiling of 4,508 ms (item 4.1.3); the EQ Enter unit of `volmanaged_v0` meets its 1 s target at the shipped desktop caps (512 MiB of bars, 128 MiB of files), which are not raised; at 200% zoom in a 1,366 by 768 and a 1,024 by 640 window every maximised panel keeps every control reachable and operable without clipping (WCAG 2.2 SC 1.4.4 and 1.4.10); and the per-user installer protects whatever folder it installs into (03 section 13.1).
- **Correctness:** `crosscheck --strict` green on the dumps written by the backend tests of the same commit, **and** every dumped route byte-equal to its in-process body when served by the app-launched backend (`qa/crosscheck/served.py`, item 2.4). Both run on this PC before the release tag; neither runs in hosted CI, which cannot reach the lab. Either one alone does not pass G2.
- **Endurance:** an all-day soak that stays under the 1.5 GB ceiling at the shipped cache defaults.
- **Security:** the IPC refusal test green, and the release build compiled without the `smoke` feature.

### 6.4 G3: Rust inside the backend

Allowed only when all of these hold:

- The stage 1 cache is in place.
- A profile names a pure arithmetic kernel that takes more than half of a route's time, on a route that misses its budget.
- The kernel uses no NumPy random stream and no pandas semantics.
- A shadow release computes both bodies and agrees at the crosscheck tolerances.

Bootstrap and SPA must reproduce NumPy's random draws one for one, so they are out of scope.

### 6.5 Triggers that change course

| ID | What is measured | Threshold | Action |
|---|---|---|---|
| T1 | G1 (section 6.2) | any item fails | Electron on both systems |
| T2 | Electron 44 against the Tauri spike shell re-run in the same session on the same fixture backend, same harness, in a quiet-machine window (O16), at least 10 interleaved runs each (stage 0.2) | Electron's median whole-tree private memory at least 15% lower at HOME and after the heavy set, or its median launch to HOME ready at least 300 ms faster; **and** in either case the gap clears the noise: Electron's median beats Tauri's worst run on the same metric. The WebView2 spike found host differences under about 15% to be noise and a 2 to 3 times swing from machine load alone, so a smaller or noisier gap does not fire T2 | Electron on both: "light" then favours it, and install size alone does not hold Tauri |
| T3 | Backend ready on a quiet machine, and cold HOME, after stage 1 | above 2.5 s, or above the cold-HOME ceiling fixed at stage 1 exit (at most 6 s, section 4.1) | Profile the imports again; offer an opt-in resident backend that stays after the window closes and is attached at launch; no shell work until fixed |
| T4 | Whole-tree memory at the desktop caps | idle above 550 MB or above the browser terminal's HOME in the same session, or a heavy session above 1.5 GB | Lower the caps and re-check route times; if the UI tree alone tops 350 MB idle, look at canvas backing stores per panel |
| T5 | GIP pan and zoom at 20,000 points; the 20,000-bar data hop | p95 above 25 ms; hop above 100 ms | Binary columns (2 to 3 weeks); if a screen still misses, one natively drawn view for it (4 to 8 weeks) |
| T6 | Native UI revisited | only if all three hold: AccessKit ships UI Automation Grid and Table patterns (none today, S7); the UI tree misses its ceiling after T4; keystroke-to-paint p95 is above 100 ms after fixes | A costed native study, never before |
| T7 | Tauri 3 with its CEF runtime (3.0.0-alpha.4 on 1 October 2026, S1) | reaches a release candidate | Re-run G1 against it: Chromium on the Mac behind the same Rust shell would remove Electron's main advantage |
| T8 | The scheduled WebView2 run (item 2.4) | any change in suite results | Fix forward; pin the Fixed Version runtime (D6) only while the fix is made, accepting its size |
| T9 | Tauri security advisories | any that touches IPC, capabilities or downloads | Patch within 7 days; there have been two IPC advisories in 2026 (S21) |
| T10 | Remote mode on the Mac | HOME over the tunnel above 5 s, or more than one stream reconnect an hour | Offer local-lab mode (G0) |
| T11 | Rust in the backend | G3 met | One kernel at a time, 2 to 4 weeks each |

## 7. Consequences

### 7.1 What gets better

- **Speed:** cold start and the slow screens, in both the app and the browser (stage 1).
- **Workspaces:** saved workspaces survive a crash, a new port and an engine change, because they are files, not origin storage.
- **The browser door gets a token.** There is one backend per lab, so two terminals can no longer run the same queued backtest or connect twice with IB client id 95.
- **Secrets stay out of JOBS:** backtests see an allow-listed environment.
- **Clean shutdown on both systems:** the backend stops JOBS and exits when its parent goes, whichever shell started it, and even if that shell crashed.

### 7.2 What it costs, and the risks taken on

- **Two web engines** if G1 passes. The 383 end-to-end tests stay on Chromium; on the Mac, proof comes from a smaller set: the JavaScriptCore golden run, the self-test page and the WebDriver smoke set.
- **Engines update under the app:** WebView2 is self-updating, and WKWebView changes with macOS. Handled by the scheduled run (T8).
- **Upkeep** (estimate):
  - Tauri: 5 to 10 days a year, mostly WebKit re-checks after each macOS release, plus WebView2 drift, Tauri 2 minors, the Rust toolchain on `D:`, cargo-deny upkeep and two screenshot sets.
  - Electron: 3 to 8 days a year with a policy of skipping majors, since only the latest three are supported (S3).
- **Remote mode** needs the PC switched on, and an SSH or private-network install on it.
- **Two invariants change on purpose:**
  - a third write route (workspaces), beside the two JOBS writes. It writes only under `terminal/state/workspaces`;
  - a backend write that is not a route: the persisted result cache under `terminal/state/cache/`, 64 MiB at most, holding only bodies whose computation made no gated read (section 4.1). The write-ban scan allows exactly that module and folder.
  - Neither ever writes under `results/`, `data/` or `live/`, and neither stores anything price-derived on disk, so the gate log keeps one line per real price read in each backend process.
- **The read-only IB guarantee** rests on Python's AST ban plus a small, reviewed Rust tree. Banning crates by name does not stop a renamed or compromised crate, so the plan does not claim that it does.
- **Signing covers the shell only.** The Python side is trusted because the owner controls the lab, not because of any signature.

### 7.3 What must not regress, and how it is held

| Guarantee | Held by |
|---|---|
| Crosscheck and golden files | API and backend unchanged; cached and fresh dumps compared (1.2); `crosscheck --strict` on the same commit's dumps plus every dumped route served byte-equal by the app-launched backend (G2) |
| Backend tests (about 2,875) | Unchanged, plus a test for each new seam |
| Unit (about 6,925) and end-to-end (383) suites | Unchanged on Chromium; JavaScriptCore golden run, self-test page and WebDriver smoke set on the Mac |
| Research gate and write ban | No new read path; lab identity checked in the handshake; the shell's write deny list; one backend per lab; one gate log in remote mode; nothing price-derived persisted by the result cache |
| Read-only IB (client id 95, AST ban) | One backend per lab, so one client 95; the snapshot already treats code 326 (id in use) as fatal; Clippy `TcpStream` ban and a reviewed lockfile for the shell |
| WCAG 2.2 AA | Framed window, accelerator keys off, axe on both engines. The gaps that exist today (`forced-colors`, `prefers-contrast`, text alternatives for canvas charts) are a later 2 to 4 weeks in every option |
| The look | Same tokens and fonts; Mac visual baselines; contrast re-checked on WebKit |
| Performance budgets | Browser budgets unchanged; the desktop budgets of section 4 added beside them |
| Browser launch | Kept, now behind the token |

## 8. Alternatives considered

### 8.1 The matrix, rescored

Weights as in 01 section 3. Changed cells, each tied to a finding in section 9:

- **Correctness:** A 5 to 4.5, A+ 4.5 to 4, B 3.5 to 3. The crosschecked browser maths have never run on JavaScriptCore, and the shipped Mac engine cannot run today's suites (C1-2, C1-5).
- **Effort:** A 5 to 4.5 (18 to 32.5 weeks), A+ 4 to 3.5, B 2.5 to 2. Electron stays 5 (14 to 25 weeks).
- **Maintainability:** A 4 to 3, A+ 3.5 to 2.5, B 2.5 to 2, E 2 to 3, once both upkeep figures are shown (C1-6).
- **Research-gate safety:** E 4 to 4.5. Node in the main process can be policed by a lint ban, like the Rust shell (C1-2).
- **Speed:** E's memory part 2.5 to 3, making its speed score 2.8 (C2-4). The interaction part for C and C0 goes from 5 to 4, making their speed 3.98 (C2-6).
- **After a G1 pass:** A, A+ and B gain 0.5 on correctness and on risk, and score 4.5 on the look and 4 on parity.
- **After a G1 failure:** as in 01 (parity 2, look 3, risk 2).

| Option | 01 total | Adjusted, before G1 | After a G1 pass | After a G1 failure |
|---|---|---|---|---|
| A, Tauri shell | 84.8 | 80.8 | 84.8 | 73.8 |
| E, Electron | 83.5 | **86.2** | **86.2** | **86.2** |
| A+, A then PyO3 kernels | 80.6 | 76.6 | 80.6 | 69.6 |
| B, Rust strangler | 67.1 | 63.6 | 67.6 | 57.6 |
| F, PySide6 | 62.0 | 62.0 | 62.0 | 62.0 |
| D, Qt 6 C++ | 61.4 | 61.4 | 61.4 | 61.4 |
| C0, egui over the Python backend | 59.7 | 58.9 | 58.9 | 58.9 |
| C, egui with a Rust core | 51.2 | 50.4 | 50.4 | 50.4 |

Sensitivity (top two, and the best native option):

| Scenario | Result |
|---|---|
| Adjusted weights, before G1 | E 86.2, A 80.8; best native F 62.0 |
| After a G1 pass | E 86.2, A 84.8; F 62.0 |
| Speed and lightness at 25, after a G1 pass | E 84.3, A 84.1 (tie) |
| Speed and lightness at 30, after a G1 pass | A 83.5, E 82.4 |
| Speed and lightness at 40, after a G1 pass | A 82.1, A+ 80.0, E 78.7; D 64.7 |
| Speed and lightness at 40, before G1 | A 79.1, E 78.7 |
| Install size worth half of the speed criterion, after a G1 pass | A 86.5, E 83.8 |
| Parity at 20, before G1 | E 87.7, A 79.6 |
| Accessibility at 0, after a G1 pass | A 85.3, E 84.7; C0 62.1 |
| All criteria equal, after a G1 pass | E 87.3, A 83.8; F 63.3 |

What this says:

- **No native option reaches second place in any scenario.**
- **A against E turns on two things:** whether WebKit passes, and how much weight the owner's "light" carries. Section 3.3 records the judgement on the second.

### 8.2 Electron on both systems (the fallback)

**For:**

- Chromium 152 on both systems (S2), so the suites, baselines and axe checks apply to the engine that actually ships, and the engine is pinned.
- Playwright's Electron class can drive the real app (D7).
- Header injection through `webRequest.onBeforeSendHeaders` (D11) and `session.flushStorageData()` (D4) make the token and storage simpler.

**Against:**

- A runtime of 130 to 158 MB per platform (S2), and Chromium and Node patches owned by the app.
- No Rust anywhere.

It becomes the plan under T1 or T2.

### 8.3 Split shell: Tauri on Windows, Electron on the Mac

Rejected as a plan and kept only as an owner's option, because it doubles every shell-side mechanism:

- two ways to talk to the page (Tauri commands with capabilities, against `contextBridge`);
- two supervisors and two signing flows;
- two security checklists and two end-to-end harnesses.

Its extra cost is 2 to 3 weeks on top of the Mac Electron work (section 5). The stage 1 bridge interface means it stays possible.

### 8.4 A+ and B: Rust in the backend

A+ survives, narrowed to G3:

- The measured hot routes are mostly file reading (`/api/ledger`) or must reproduce NumPy's random stream draw for draw (bootstrap, SPA), so a cache fixes the first kind and a Rust port is unsafe for the second.

B, a route-by-route Rust server, stays rejected:

- A Rust route that needs bars must either ask Python for them or open an ungated door to the data.
- It shortens no start time.
- It costs 20 to 40 weeks on top of A.

### 8.5 Native UIs: C, C0 (egui), D (Qt 6 C++), F (PySide6)

All four are rejected:

- They cost 52 to 147 weeks and throw away about 77,400 lines of front end and 73,900 test lines.
- They keep the same Python start and the same backend times.
- The Rust toolkits fail WCAG 1.3.1 on Windows grids today (S7).

The native interaction score rested on a synthetic one-million-point chart, while the terminal draws at most 20,000 points (`MAX_POINTS` in `api/data.py`). Trigger T6 says what would reopen the question.

### 8.6 Other shapes, dropped in 01 and still dropped

- **Wails v3** (beta, cannot stream SSE on Windows, S28).
- **Neutralinojs**, **Electrobun**, and **CEF used directly**.
- **Python embedded in the Rust shell** (S20).
- **Nuitka and PyOxidizer** as packagers (S30, S31).
- **Tauri 3 with CEF** is the one to watch (T7).
- **A bundled Python engine** (python-build-standalone with uv, about 240 to 270 MB compressed, S19) stays a later phase, needed only if the owner wants an app that runs without the lab.

### 8.7 Remote mode against local-lab mode on the Mac

Remote mode is the default:

- It keeps one audit trail for the gate and needs no lab change.
- It removes the macOS 26 floor.
- It cuts Mac work to the shell.

Local-lab mode is the owner's choice at G0, at 1 to 2 weeks plus a change to the lab's gate (section 6.1).

## 9. Challenge findings: accepted and rejected

IDs: C1 is the review of hidden costs and consistency, C2 the performance review, C3 the security review. "Accepted" means the change is in this plan at the place named. "Accepted, different fix" means the problem is accepted but solved another way, for the reason given. "Rejected" means the problem is not accepted, for the reason given.

### 9.1 C1: hidden costs and consistency (13 findings)

| ID | Sev. | Finding | Verdict and change |
|---|---|---|---|
| C1-1 | HIGH | Workspaces have no working channel: a random port changes the origin, page commands are banned, the backend refuses writes | **Accepted, different fix.** A workspace store in the backend (stage 1.6), not a Tauri command: it works for the browser, both shells and remote mode, and keeps the page without commands. The port stays random (C3-4); the two lens documents' "fixed port" and "random port" wording is superseded by this record |
| C1-2 | HIGH | The 1.3-point lead is smaller than one scoring step | **Accepted.** Rescored (section 8.1): E leads at 01's weights. The decision now rests on G1, T2 and an explicit judgement (section 3.3); the deck should present a decision rule, not a winner by score |
| C1-3 | HIGH | Two backends share `jobs.json` and `backtests/output`, and can run a job twice | **Accepted, different fix.** One backend per lab with a lock file, and the second launcher attaches (stage 1.3), rather than a second backend with JOBS off: attaching also avoids a second IB connection and a second 2 GiB cache. Test: a held lock makes a second start attach, and JOBS is never run twice |
| C1-4 | HIGH | A lab on the Mac splits the gate's audit trail; nobody says which machine owns the lab | **Accepted.** G0 is now a design choice with remote mode as the default (sections 6.1, 8.7). The handshake reports ROOT, and the shell shows which lab it serves |
| C1-5 | HIGH | Under A the shipped Mac app cannot be tested end to end; phase 2a tests a different WebKit | **Accepted in part.** The JavaScriptCore golden run in CI, the in-app self-test page and Mac proof repriced at 3 to 4.5 weeks (stage 3.1), with correctness scored 4.5. The claim that no driver exists is out of date: the WebdriverIO Tauri service runs an embedded WebDriver server inside the app on macOS (D1, checked 2 October 2026), so a smoke set can drive the real WKWebView, in test builds only. The 383 tests still do not port as they stand |
| C1-6 | MED | Upkeep is priced for E only; E's figure is too high | **Accepted.** A 5 to 10 days a year, E 3 to 8 with a policy of skipping majors (section 7.2); maintainability 3 for both |
| C1-7 | MED | A cannot pin its engine; suites run on a different engine from the one in use | **Accepted in part.** The drift is stated (7.2) and a scheduled run watches it (2.4, T8). Pinning WebView2 with the Fixed Version runtime by default is rejected: it gives up the install-size gain that is one of the reasons for A, and the scheduled run catches the same breakage. Electron's pinned engine is credited in the rescore |
| C1-8 | MED | Process clean-up is shell-specific and fails if the Mac shell crashes | **Accepted.** A stdin watchdog in the backend (stage 1.5); the Job Object is a second guard only (2.2) |
| C1-9 | MED | The split shell doubles every mechanism and is not costed | **Accepted.** Costed at 2 to 3 weeks extra and demoted to an owner's option (8.3); the page's seams sit behind one bridge interface from stage 1.7 |
| C1-10 | MED | An app started from Finder lacks the IB_* settings and PATH | **Accepted, narrowed.** Needed only in local-lab mode: an explicit settings file passed as an allow list (6.1). In remote mode the backend runs on the PC with its own environment. The source of the environment is shown in the handshake |
| C1-11 | MED | Updating the shell does not update the page; the two can fall out of step | **Accepted.** No auto-updater (C3-2); shell and page are built from the same tagged commit; a contract version in the handshake, and `bridgeVersion` in the page, which turns off features its shell cannot serve (1.3, 1.7) |
| C1-12 | LOW | Two seams are unnecessary (Tauri origins, explicit root and interpreter), and the token for the stream is unspecified | **Accepted.** No `tauri.localhost` origins; no new root or interpreter input, only an identity assertion; the cookie design is written down (1.3, 1.4) |
| C1-13 | LOW | Measured A is compared with an empty-app CI benchmark for E | **Accepted.** One day measuring Electron on this PC with a hidden window (0.2), which feeds T2 |

### 9.2 C2: performance (13 findings)

| ID | Sev. | Finding | Verdict and change |
|---|---|---|---|
| C2-1 | HIGH | The start-up headline leaves out the cold Python backend | **Accepted.** Restated as about 7 to 9 s from double-click to HOME with data, decomposed route by route (section 4.1; first written as 4 to 8 s and corrected after review). The start-up work moves into stage 1; first launch after a reboot is in 2.4; an opt-in resident backend is the T3 response |
| C2-2 | HIGH | Serving the page from FastAPI ties first paint to Python imports | **Accepted, different order.** Default: same origin as today, plus a bundled splash in the look that hands over when the handshake completes (2.1), held to the "shell painted" budget. Bundled assets with the API going cross-origin are measured only if the splash misses that budget, because that path costs CORS, a cookie across origins and an unverified WebAssembly code cache |
| C2-3 | HIGH | The memory headline counts only the UI tree | **Accepted.** Whole-tree memory is the headline; desktop caps of 512 MiB and 128 MiB; absolute idle and heavy ceilings; the soak runs at the shipped defaults (section 4, 1.5, 2.4) |
| C2-4 | MED | The memory score favours A against the only real-page evidence | **Accepted.** E's memory part raised to 3 (8.1) |
| C2-5 | MED | Mac speed is asserted, not measured; Tauri's empty app starts in about 2,044 ms on macOS CI | **Accepted.** Mac start, memory and grid numbers are now part of G1 (6.2). The 2,044 ms figure is a single noisy CI run of an empty app (S4, L5 S14) |
| C2-6 | MED | Interaction speed is unmeasured where a native UI would differ | **Accepted.** Interaction scored 4 for C and C0 and marked unverified; pan, zoom and keystroke traces in 2.4 |
| C2-7 | MED | Two start budgets cannot be met as sequenced, yet G2 requires them | **Accepted.** The Python work is in stage 1. "Shell painted" now means the bundled splash. The cold-HOME target is 4.5 s with a provisional 6 s ceiling, resting on a result cache persisted for routes that read no prices and a HOME prewarm, and fixed from a quiet-machine measurement at stage 1 exit (section 4.1) |
| C2-8 | MED | The slowness the owner feels is backend compute, which no shell fixes | **Accepted.** The result cache comes first (1.2), with real-data screen targets; presented as the main source of "fast" (section 4) |
| C2-9 | LOW | A+ buys little; the paths that use random draws are high-risk | **Accepted.** A+ is limited to arithmetic kernels without random draws, behind the cache (G3, 8.4) |
| C2-10 | LOW | The 422 MB figure belongs to the pywebview host | **Accepted.** Quoted as 191 MB, 238 MB and about 378 MB derived, each with its source (2.2) |
| C2-11 | LOW | Hashed assets go through Python with no immutable cache header | **Accepted as a measurement.** The header is added only if 2.4 shows revalidations (1.7) |
| C2-12 | LOW | Restore after hours behind a full-screen game is untested | **Accepted.** A minimise-and-restore case in 2.4. Lowering WebView2's memory target while minimised is a candidate, measured before it is adopted |
| C2-13 | LOW | The install size is quoted from a spike exe with no plugins; "light" leaves out the venv | **Accepted.** "Under 15 MB" until measured; the 690 to 723 MB venv is stated (section 4) |

### 9.3 C3: security (13 findings)

| ID | Sev. | Finding | Verdict and change |
|---|---|---|---|
| C3-1 | HIGH | "No page commands" contradicts the planned save dialog, image copy and workspace mirror | **Accepted.** **Export:** through the download handler, with no command (D2; WKWebView blob support checked at G1). **Workspaces:** through the backend (1.6). **Image copy:** a native command only if the clipboard API fails, taking bytes and no path. **Never** the fs, dialog, clipboard-manager, shell, http or opener plugins for the page. A refusal test covers every command (2.3) |
| C3-2 | HIGH | The updater lets anyone who can push to the public repository ship signed code, and the signature covers only the shell | **Accepted.** No auto-updater in stages 1 to 3; releases are built locally from a tagged commit (2.5, 3.5). If one is ever added: an offline key, a protected environment with the owner as required reviewer, actions pinned to commits, and no secrets for pull-request jobs |
| C3-3 | MED | Removing only `QUANTPAD_API_KEY` leaves other secrets and switches in the backend and every backtest | **Accepted.** An allow list in `_child_env` and in the launchers. `NQT_FIXTURE_DIR`, `PYTHON*`, `COVERAGE_*` and `WEBVIEW2_*` are never passed on. Test: canary values in two key variables, and a job child that sees neither (1.5) |
| C3-4 | MED | The port plan contradicts itself, and the identity check runs only once | **Accepted.** The backend binds port 0 and proves itself with an HMAC (1.3); the proof is re-run on every navigation, with a "backend stopped" page (2.2); a backend that fails the handshake is refused; the token is never put in a URL (1.4) |
| C3-5 | MED | The start command lets files in the working folder and Python variables change what code runs | **Accepted.** `python -E -s -X utf8 -m nq_terminal` from `terminal/backend`; the handshake reports `sys.prefix` and module paths, and the shell refuses a mismatch (2.2, 1.3) |
| C3-6 | MED | A separate lab root and interpreter for JOBS makes a second source of truth | **Accepted.** No new input: ROOT comes from `nq_lab.config`, and JOBS uses `sys.executable` with assertions (1.3) |
| C3-7 | MED | The write ban covers Python only, not the shell's writes | **Accepted.** One native write module with full path resolution and a deny list, tests with a junction and an 8.3 alias, and Clippy bans (2.3, 2.4) |
| C3-8 | MED | Spike test hooks and `WEBVIEW2_*` variables could open injection or a debugging port | **Accepted.** Hooks only under the `smoke` feature, which release CI refuses; the variables are removed and the HKCU policy key checked (2.1). Microsoft's page says user-scoped overrides are ignored only for elevated hosts (D8) |
| C3-9 | MED | The browser door on 8765 stays unauthenticated | **Accepted.** The same token and cookie on both doors (1.4) |
| C3-10 | MED | Banning crates by name does not make the shell read-only toward IB; client id 95 clashes | **Accepted, different fix for the clash.** The wording now says what the guarantee rests on (7.2); a minimal, reviewed tree; cargo-deny with a source allow list; a Clippy `TcpStream` ban (2.4). A separate client id for the desktop backend is rejected: with one backend per lab there is only one client 95, and code 326 is already fatal |
| C3-11 | LOW | The desktop origin allow list is too broad | **Accepted.** Exactly one origin in desktop mode (1.4) |
| C3-12 | LOW | New windows, external links and a second launch are unspecified | **Accepted.** New windows denied except the attribution link, opened in the system browser; forwarded arguments ignored; no deep-link plugin (2.1) |
| C3-13 | LOW | The build toolchain is not pinned if the GNU host is used | **Accepted.** Releases on the MSVC host in CI, `rust-toolchain.toml`, `--locked`, Tauri 2.11.6 or later (2.5). The GNU host stays for local spikes under `D:\dev` only |

Tally: 39 findings. 31 accepted as written; 6 accepted with a different fix, order or scope (C1-1, C1-3, C1-10, C2-2, C2-11, C3-10); 2 accepted in part, with the rejected part and its reason stated (C1-5, C1-7). None rejected outright.

## 10. Open questions for the owner

1. **G0:** which Mac, and remote mode or a second lab on it?
2. **Order of work:** may Windows shell work (stage 2) start on Tauri before G1, once stage 1 is done and T2 has been read? The default is yes, with about 3 to 5 weeks at risk if G1 later fails; Mac shell work waits for G1 either way (section 3.3).
3. **The SSH or private-network install on the PC** that remote mode needs: allowed?
4. **The judgement in section 3.3:** do a 1 MB install and Rust justify Tauri at an equal score, or would the owner rather take Electron's single engine?
5. **Desktop memory caps:** are 512 MiB for bars and 128 MiB for files acceptable, or should the app keep today's 2 GiB?
6. **A resident backend** that keeps running after the window closes, so launches are warm: wanted, as an opt-in?

## Sources

New sources for this step, all checked on 2 October 2026 unless marked. Sources S1 to S40 are those of `01_options.md`.

- D1. Tauri, WebDriver testing: the WebdriverIO Tauri service with an embedded WebDriver server "is how macOS is supported"; `tauri-driver` alone covers Windows and Linux only. https://v2.tauri.app/develop/tests/webdriver/ (source read through the GitHub API: https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/Tests/WebDriver/index.mdx). The maturity of that service on macOS 26 is **unverified**.
- D2. Tauri `WebviewWindowBuilder::on_download`, `crates/tauri/src/webview/webview_window.rs` line 384 on the `dev` branch: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/webview/webview_window.rs . Whether WKWebView hands blob downloads to it is **unverified** (G1).
- D3. Tauri issue 5889, "Memory benchmark might be incorrect: Tauri might consume more RAM than Electron", opened 21 December 2022, closed: https://github.com/tauri-apps/tauri/issues/5889 . The figures quoted come from L5 S15 and were not re-read in this step.
- D4. Electron `ses.flushStorageData()`: https://www.electronjs.org/docs/latest/api/session (source `docs/api/session.md` in electron/electron).
- D5. Electron `protocol.handle` and the `stream` privilege for streaming protocols: https://www.electronjs.org/docs/latest/api/protocol . SSE through a custom scheme is **unverified**; the plan does not depend on it.
- D6. Microsoft, distributing WebView2 (Evergreen against Fixed Version): https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- D7. Playwright, class Electron: https://playwright.dev/docs/api/class-electron . Its stability label was not confirmed (**unverified**).
- D8. Microsoft, WebView2 security best practices (user-scoped overrides ignored only when the host runs elevated): https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security
- D9. Apple Platform Security, Gatekeeper: https://support.apple.com/guide/security/sec5599b66df/web . That a locally built app carries no quarantine attribute and so skips notarisation checks is **unverified** (stage 0).
- D10. Tauri capabilities, including remote origins: https://v2.tauri.app/security/capabilities/
- D11. Electron `webRequest.onBeforeSendHeaders`: https://www.electronjs.org/docs/latest/api/web-request
- D12. Elanis, web-to-desktop-framework-comparison (Tauri release app on macOS arm64, about 2,044 ms start, single CI runs): https://github.com/Elanis/web-to-desktop-framework-comparison (also S4 and L5 S14).

Local evidence: `docs/desktop/01_options.md`, `00_inventory_backend.md` (section 6), `00_spike_webview2.md`, `00_spike_rust.md`, `research/L1` (5.1, 5.5, 5.8), `L3`, `L4`, `L5` (sections 8 and 10) and `L7`, and the backend source lines listed at the top.
