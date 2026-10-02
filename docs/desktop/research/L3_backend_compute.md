# L3: Backend and compute for the desktop terminal

Research lens L3 of the desktop migration plan. It asks one question: when the terminal becomes a native app on Windows and macOS, what runs the backend? The candidates are a bundled Python sidecar, Python embedded in a Rust host, a port of the analytics to Rust, or a mix.

- Evidence checked: 2 October 2026. Every external claim carries a source tag (B1, B2, ...) that points to the Sources list at the end. Anything not confirmed from a primary source is marked **unverified**.
- Local facts come from reading the repository at HEAD `c7f9e61` (read only) and from the L4 lens, which measured the lab venv on the same date. This lens ran no local apps and took no timings. Every startup and memory figure below is either sourced or marked as an estimate for the spike to measure.
- Scope: the Python backend (`nq_terminal`), the JOBS queue, the research gate, the crosscheck. The window shell and the front end belong to other lenses; where an answer depends on the shell, a Tauri 2 style shell is assumed, as in L4.

## 1. Bottom line

1. **The backend cannot become Python free while the lab is Python.** The terminal is a view over a Python research lab. It imports 55 files' worth of `nq_lab` code (lab `src/` is 33,408 lines), the only door to prices is `nq_lab.data.serve`, and JOBS runs the lab's own `backtests/run_base.py` on NautilusTrader 1.231.0. A Rust port can replace the terminal's own analytics, but it cannot replace the gate, the lab helpers or the backtests without forking the lab. A full Rust port is therefore not an option; the honest choice is between "Python sidecar" and "Python sidecar plus Rust for hot paths".
2. **Phase 1 should run the backend from the lab's own `.venv`, not from a bundled Python.** The app is a research tool over a local lab, so the lab's interpreter is already on the machine, pinned by the lab's `uv.lock`, and is the interpreter that JOBS must use anyway so that a queued backtest is identical to a hand-started one. This costs 0 MB of bundled Python, needs no notarisation of hundreds of native files, and keeps today's behaviour byte for byte. L4 reached the same conclusion from the distribution side.
3. **A bundled Python engine is feasible but heavy and buys little for this owner.** The compressed wheels alone come to roughly 240 MB on Windows and 270 MB on macOS (python-build-standalone 3.12.15 plus NautilusTrader, pyarrow, scipy, numpy, pandas, scikit-learn; B1, B2), and the measured lab venv is 723 MB on disk (L4). Its one real use is a self-contained demo build over fixtures, which does not need the lab.
4. **Of the freezers, python-build-standalone plus uv is the cleanest; PyInstaller onedir is the safe fallback; Nuitka and PyOxidizer are out.** python-build-standalone is MPL-2.0, maintained by Astral, released 1 October 2026 (B3, B4). PyInstaller 6.22.3 (12 September 2026) works but blocks onefile `.app` bundles from v7.0 (B5). Nuitka changed its licence to AGPL-3.0 with a runtime exception in January 2026, needs a C compiler that this PC lacks, warns of "huge compilation times" for pandas and keeps antivirus guidance in its paid tier (B6, B7). PyOxidizer's author called it "effectively in a zombie state" in March 2024 and its last release is 0.24.0 from December 2022 (B8, B9).
5. **Embedding Python in a Rust process with PyO3 is the wrong shape here.** PyO3 0.29.3 (30 September 2026) supports embedding, but the guide says static embedding is not first-class and dynamic embedding means shipping libpython and setting up the environment yourself (B10). It also puts a pandas crash, a GIL stall or a 2 GiB price cache inside the window process. A separate process keeps the UI alive when Python dies and lets the shell restart it.
6. **Rust earns its place for specific hot paths, behind the existing Python interfaces, never as a parallel truth.** The strangler pattern works if each Rust function ships first as a PyO3 extension module called from the same Python function, so the dump test, the four-sided crosscheck and the golden files keep working unchanged. The hard numerical risks are summation order, quantile and `ddof` conventions, random number streams in bootstraps, and clustering ties (section 7). The 1e-12 tolerance for stored anchors will catch any of them.
7. **The research gate and the write ban stay safe only if the packaged app never carries its own copy of `nq_lab`.** `nq_lab.config.ROOT` is computed from `__file__` (`Path(__file__).resolve().parents[2]`), so a frozen copy would point inside the app bundle, and a frozen gate could drift from the lab's hash-pinned one. The app must import `nq_lab` from the chosen lab folder at start, verify it, and refuse to start otherwise.

## 2. What the backend is today (from the repository)

| Fact | Value | Where it comes from |
|---|---|---|
| Backend size | 110 Python files, about 21,000 lines: `analytics/` 4,777, `services/` 8,643, `models/` 3,611, `api/` 3,055, top level 922 | `wc -l` over `terminal/backend/nq_terminal` |
| Coupling to the lab | `from nq_lab...` in 55 backend files: `config` (24), `nq_lab` root (17), `dtsmom_universe` (11), `dtsmom_panel` (7), `sessions` (5), `live_guards` (5), `strategies.registry`, `data`, and others | `grep` over the backend |
| Lab code size | `src/nq_lab`: 33,408 lines | `wc -l` |
| Lab root discovery | `ROOT = Path(__file__).resolve().parents[2]` in `src/nq_lab/config.py` | source |
| In-sample fence | `IS_START = 2010-01-01`, `IS_END = 2022-01-01` exclusive | `src/nq_lab/config.py` |
| Gate | `oos_gate.serve_bars` refuses out-of-sample and straddling windows, then appends one JSON line per serve to `results/oos_access_log.jsonl`; `serve_sealed` is a separate door pinned by hashes in `guards.SEALED_GATE_PINS` | `src/nq_lab/oos_gate.py` |
| Runtime third-party imports in the backend | pandas (42), numpy (38), fastapi (31), pydantic (23), scipy (14: `stats`, `cluster.hierarchy`, `spatial.distance`), starlette, ibapi (5, only the read-only client), pyarrow (2) | `grep` |
| NautilusTrader in the server | lazily in `models/jobs.py` (`StrategyConfig`) and through `nq_lab.strategies.registry`, which imports `nautilus_trader` at module level; JOBS validation checks params against that registry | source |
| statsmodels and arch | **not** runtime dependencies: only the crosscheck project `terminal/qa` pins `arch==8.0.0`, `statsmodels==0.15.0`, `scipy==1.18.1`, `quantstats`, `empyrical-reloaded` | `terminal/qa/pyproject.toml` |
| JOBS | `subprocess.Popen([sys.executable, "-u", <root>/backtests/run_base.py, "--config", <json>], cwd=<root>)`, one worker, queue cap 10, state in `terminal/state/jobs.json` | `services/jobs.py`, ARCHITECTURE section 8 |
| Write ban | AST scans in the tests (no writing `open`, `to_csv`, `to_parquet`, and so on), a test-time `sys.addaudithook` guard (`tests/research_guard.py`), and sha256 fixtures on `oos_access_log.jsonl`, `ledger.csv`, `registry.csv`, `oos_openings.json` | ARCHITECTURE "Writes to research files", tests |
| Memory | an in-memory, byte-capped LRU of gated bars, default 2 GiB (`NQT_CACHE_BYTES`); nothing written to disk by design (DL1) | `settings.py`, PRD DL1 |
| Crosscheck | four value sides (`ours`, `nq_lab`, `nautilus`, `stored`) read from JSON dumps written by `tests/test_dump_for_qa.py`; tolerance 1e-9 relative for closed forms, 1e-12 for stored anchors; `--strict` turns a missing value into a failure | `terminal/qa/crosscheck` |
| Lab venv (Windows) | 723 MB, 383 `.pyd`, 18 `.dll` | measured by L4 on 2 October 2026 |

Two consequences shape everything below. First, the server process needs NautilusTrader even though it never runs a backtest itself, because the JOBS validator imports the strategy registry. Second, the write ban is proved by tests over the source, not by a runtime sandbox; any packaging route must ship exactly the tested source and keep the scans meaningful.

## 3. Option A: keep Python as a sidecar process

The shell starts one Python process (the backend), talks to it over loopback HTTP and SSE exactly as the web front end does now, and kills it on exit. JOBS children are spawned by that process as today. Five ways to provide that Python:

### A0. The lab's own venv (no bundled Python)

- **How:** the shell runs `<lab>\.venv\Scripts\python.exe -m nq_terminal` (macOS: `<lab>/.venv/bin/python`) with `cwd` the lab root, a random free port and a per-launch token. This is what `start.ps1` does today, minus the console window.
- **Size:** 0 MB of Python in the app. The app is the shell plus the built web assets.
- **Startup:** the same as today's server start (not measured by this lens; the spike measures it). No first-launch antivirus scan of new native files, because the venv's files are already known to Defender and Gatekeeper on this machine.
- **Memory:** unchanged; dominated by the 2 GiB bar cache cap, not by the runtime.
- **Signing:** nothing extra. The shell only spawns an existing interpreter. On macOS a hardened-runtime shell may spawn a separate executable that is not signed by the same team; library validation governs code loaded into the process, and a child process is a separate executable with its own signature (an inference from B11 and B12, which say entitlements go on executables and shared libraries inherit the host's; **to confirm on the Mac in the spike**).
- **Updates:** the shell update is small; the Python side updates when the owner runs `uv sync` in the lab, which is how the lab already works.
- **Gate, JOBS, lab folder:** identical to today. `sys.executable` is the lab interpreter, so JOBS is unchanged.
- **Weak spots:** the app does not start on a machine without a lab and a synced venv. For this owner that is the definition of the product, not a defect. The macOS lab venv must exist on the Mac (NautilusTrader 1.231.0 ships macOS wheels only as `macosx_26_0_arm64`, B2), which is a lab task, not an app task. The lab is pinned to Python 3.12, which has security support until October 2028 (B35), so the interpreter itself is not a near-term risk.

### A1. python-build-standalone plus uv (a bundled "engine" folder)

- **What it is:** portable CPython builds, MPL-2.0, now in `astral-sh/python-build-standalone`, release `20261001` on 1 October 2026 (B3). Astral took over stewardship in December 2024; the post calls the builds "truly standalone: you can download, unzip, and run them on any machine" and reports over 70 million downloads (B4). uv installs Python from these builds (B13).
- **Sizes (compressed archives, release 20261001, B3):** Windows x86_64 `install_only_stripped` 22.0 MB (`install_only` 46.4 MB); macOS arm64 `install_only_stripped` 25.0 MB.
- **How it would be built:** in CI, unpack the stripped build into `engine/`, then `uv pip install` the lab's locked runtime set into that interpreter (not a venv). uv's relocatable venv support is still incomplete: `--relocatable` with `uv sync` is an open request (uv #21945, 23 September 2026), and a relocatable venv with a managed interpreter breaks in a zip because of an RPATH and symlink issue (uv #19126) (B14). Installing straight into the standalone tree avoids both.
- **Known quirks (B15):** build-time absolute paths captured in `sysconfig` files; no `pip.exe` on Windows (use `python -m pip`); on macOS no `Python.framework` build (open request #274, B16). The macOS build bundles its own libffi rather than Apple's (`#1224`, open, B16); whether `ctypes` callbacks then need `com.apple.security.cs.allow-unsigned-executable-memory` under the hardened runtime is **unverified** and is a spike item. The backend itself does not use `ctypes` (only two lab modules outside the terminal's import graph do).
- **Bundle size estimate (Windows, compressed wheels, B1, B2):** NautilusTrader 112.8 MB, scipy 36.7 MB, pyarrow 28.0 MB, numpy 12.6 MB, pandas 11.0 MB, scikit-learn 8.3 MB, pydantic-core 2.0 MB, plus about 5 MB of pure Python (fastapi, uvicorn, pydantic, starlette, exchange-calendars and others), plus Python 22.0 MB: **about 240 MB compressed**. macOS arm64: NautilusTrader 156.0 MB, pyarrow 35.9 MB, scipy 20.5 MB, pandas 10.7 MB, scikit-learn 8.3 MB, numpy 5.4 MB, pydantic-core 1.9 MB, plus about 5 MB, plus Python 25.0 MB: **about 270 MB compressed**. Installed on disk: the measured 723 MB venv (L4) is the right order; expect **700 to 850 MB** (estimate).
- **Startup:** same interpreter and same imports as A0, so the same as today once warm. First launch on Windows and macOS may be slowed by the OS scanning hundreds of new native files; a PyInstaller maintainer gives that as the usual cause of a slow first launch and the reporter confirmed signing fixed it (B17). Not measured here.
- **Signing on macOS:** every `.so` and `.dylib` in the engine is a Mach-O image and must be signed with the Developer ID, with the hardened runtime and a secure timestamp, before notarisation (L4 S2). Apple's bundle rules put dynamic libraries in `Contents/Frameworks/` and treat Python scripts as resources in `Contents/Resources/`; "incorrectly placed code might work during day-to-day development, but might cause problems during notarization" (B18). A Python `site-packages` tree mixes both, so the build must either relocate binaries (what PyInstaller 6 does, below) or ship the engine as a signed helper tree. Briefcase, which faces the same problem, applies `allow-unsigned-executable-memory` and `disable-library-validation` to every macOS app by default (B19); copying those defaults weakens the hardened runtime and should only be done if the spike proves they are needed.
- **Updates:** a full engine is 240 to 270 MB compressed. Engine and shell should version separately so a shell update does not resend the engine (L4 covers delta updaters).
- **Fit:** good for a self-contained demo build over `NQT_FIXTURE_DIR`. For the real lab it duplicates the lab's environment and creates a second set of versions to keep in step with `uv.lock`.

### A2. PyInstaller

- **Version and licence:** 6.22.3, 12 September 2026 (B5). GPL-2.0 with an exception: bundles "can be shipped with whatever license you want, as long as it complies with the licenses of your dependencies" (B20).
- **Mode:** onedir only. Onefile extracts to a `_MEIxxxxxx` temp folder on every start, is "a little slower to start", and leaves the folder behind if the program is killed (B21). The 6.13.0 changelog says onefile `.app` bundles "will be blocked in v7.0" because they "are heavily penalised by macOS's security scanning" (B5). Since 6.0.0, macOS `.app` output puts shared libraries in `Contents/Frameworks` and data in `Contents/Resources`, cross-linked by symlinks (B5), which is what notarisation wants.
- **Signing:** with a real identity PyInstaller turns on the hardened runtime (`--options=runtime`) and signs collected binaries; ad hoc otherwise (B22). Open issues on unsigned-looking binaries after codesign: #4333 (2019) and #8029 (2023), both still open (B23).
- **Risks for this stack:** NautilusTrader is Cython plus a PyO3 extension; imports made from compiled modules are invisible to PyInstaller's analysis and need hidden-import lists. No PyInstaller or NautilusTrader issue reports a freeze of NautilusTrader either way (searches on 2 October 2026 found none), so this is **untested** and a spike item. Tauri users report three sidecar problems with PyInstaller builds: the onefile bootloader's child survives the app (Tauri #14360, closed with a kill-tree feature), the NSIS installer silently keeps a stale 71 MB PyInstaller sidecar on reinstall (Tauri #15134, open since March 2026), and a sidecar that stops working after macOS signing (Tauri #6888, open since 2023) (B24).
- **Size:** the same payload as A1 plus the bootloader; compression of the archive is optional.
- **Fit:** fallback if A1's macOS layout proves painful. It does not remove the duplicate-environment problem.

### A3. Nuitka

- **Licence:** changed to AGPL-3.0 on 28 January 2026 "with an exception for the runtime library parts to allow proprietary compiled code to link against it" (B6). The output is usable; the change targets competing products.
- **Practical blockers on this PC:** needs a C compiler (MSVC or MinGW64; the README notes MinGW64 does not work with Python 3.13 or later) and this PC has no MSVC build tools (B7). The README warns "you will have to deal with huge compilation times" for packages such as pandas, and says unmodified Windows builds "might be recognized by some AV vendors as malware", with real guidance only in Nuitka commercial (B7).
- **Gain:** compiles our own Python to C. The heavy work already runs in compiled libraries (numpy, pandas, pyarrow) and in the Rust core of NautilusTrader, so the speed gain on this backend is **unverified and likely small**.
- **Fit:** not recommended.

### A4. Briefcase

- 0.4.5, 8 September 2026, BSD-3-Clause (B9). Builds signed and notarised macOS apps by default and defaults to universal builds (B19). It is built around apps whose UI is Python (Toga); using it only to wrap a server process under a Rust or webview shell fights its model. Its macOS defaults are useful as a reference for entitlements, not as the packager.

### A5. PyOxidizer and PyApp

- **PyOxidizer:** last release 0.24.0 on 30 December 2022 (B9); the author wrote on 17 March 2024 that it is "effectively in a zombie state" (B8). Not an option.
- **PyApp** (`ofek/pyapp`, Apache-2.0 or MIT, v0.29.0 from 15 October 2025, B9): a Rust launcher that bootstraps Python and the app on first run. It suits command-line tools; here it would download hundreds of megabytes on first launch, which is worse than A0 or A1.

## 4. Option B: embed Python in a Rust host with PyO3

- **State:** PyO3 0.29.3, 30 September 2026, MIT or Apache-2.0 (B9, B25). The guide: dynamic embedding is "much easier", but for distribution "you will have to consider including the Python shared library in your distribution as well as setting up wrapper scripts to set the right environment variables". Static embedding: "PyO3 does not yet have first-class support for this embedding mode"; compiled extension modules need special linker flags to import; `auto-initialize` is deliberately disabled (B10).
- **What it would buy:** no HTTP hop between UI and backend; calls through Tauri commands instead of fetch. Front-end code would have to change from `fetch` and `EventSource` to IPC, which touches the 6,925 vitest and 383 Playwright tests.
- **What it costs:** the same 700 to 850 MB of Python and wheels as A1, now loaded inside the window process. A segfault in a native wheel takes the window down; the GIL serialises Python work against Rust callbacks; the 2 GiB cache lives in the UI process. Free-threaded Python (3.13 onward, fully supported in 3.14, B26) does not apply, because the lab is pinned to `>=3.12,<3.13`.
- **JOBS:** unchanged in principle (still `Popen` of an interpreter), but `sys.executable` in an embedded interpreter is the host binary, not `python.exe`, so the job service would need an explicit interpreter path. Today's code passes `python=sys.executable`.
- **Verdict:** more work than A0 or A1, weaker isolation, no size gain. Not recommended.

## 5. Option C: port the analytics to Rust

### 5.1 What exists in Rust (crates.io and GitHub, 2 October 2026)

| Need | Crate | Version and date | Licence | Source |
|---|---|---|---|---|
| Data frames | polars | 0.55.2 (Rust), Python 1.44.2 | MIT | B9, B27 |
| Arrow and Parquet | arrow (arrow-rs) | 60.0.0, 15 September 2026 | Apache-2.0 | B9, B27 |
| N-dimensional arrays | ndarray | 0.17.2, 10 January 2026 | MIT or Apache-2.0 | B9, B27 |
| Distributions and special functions | statrs | 0.19.1, 11 August 2026 | MIT | B9, B27 |
| Portfolio statistics | nautilus-analysis | 0.61.0 is the crate set behind Python 1.231.0; 0.64.0 is current (15 September 2026); 36 statistic files including Sharpe, Sortino, Calmar, max drawdown, VaR, expected shortfall, tail ratio, ulcer index | LGPL-3.0-only | B28 |
| Other NautilusTrader crates | nautilus-core, -model, -backtest, -persistence, -indicators, -interactive-brokers | 0.64.0; workspace needs Rust 1.97.1 at v1.231.0 and the IB crate declares 1.98.1 | LGPL-3.0-only | B27, B28 |
| Interactive Brokers | ibapi (rust-ibapi) | 4.2.0, 21 September 2026 | MIT | B29 |

Notes, sceptically:

- **NautilusTrader's Rust crates move fast.** Four minor versions in two months (0.61.0 on 2 August, 0.64.0 on 15 September 2026, B27), and the Python package is in a 2.0 release-candidate cycle (2.0.0rc5 on 15 September 2026, B28). Building on them means tracking a moving API while the lab stays pinned to 1.231.0. They are also LGPL-3.0: statically linking them into a Rust binary that is distributed carries relinking obligations (**unverified for this use; get a reading before shipping to anyone but the owner**).
- **`nautilus-analysis` does not match our definitions automatically.** The crosscheck exists precisely because libraries define metrics differently (the `INFO` status in `compare.py`). Its statistics would be a fifth reference side, not a drop-in for `nq_terminal.analytics`.
- **ibapi has no read-only build.** Its features are `async`, `sync` and `utoipa` only (B29); order calls are always compiled in. NautilusTrader's own IB adapter pins `ibapi = "=3.3.0"`, a major version behind (B27). The Python side enforces read-only with an AST ban, a single importing module and an eight-id outgoing message allowlist. A Rust port would need the same three layers: Clippy's `disallowed-methods` configuration (B30) to ban every order method, one crate-private module that owns the client, and a wrapper that checks message ids before they reach the socket. The safety E2E (every request GET bar the two JOBS writes) stays as is.

### 5.2 What a port can and cannot replace

| Part | Lines today | Portable to Rust? |
|---|---|---|
| `nq_terminal.analytics` (pure functions over series) | 4,777 | Yes, function by function. This is where Rust can help, if a profile shows it matters. |
| `api`, `models` (FastAPI routes, Pydantic shapes) | 6,666 | Yes in principle (axum and serde), but it is a rewrite of the HTTP contract that the front end and e2e tests are pinned to, for no user-visible gain. |
| `services` (bars cache, runs, journals, jobs, IB) | 8,643 | Partly. Everything that reads prices goes through `nq_lab.data.serve`; everything that reads runs uses lab helpers. |
| `nq_lab` gate, sessions, universes, panels, registry | 33,408 (whole lab) | **No.** Porting it would fork the lab's research code and its hash-pinned gate. |
| `backtests/run_base.py` on NautilusTrader 1.231.0 | lab | **No.** JOBS must run the lab's own runner. |

Only about a quarter of the backend is a natural port target, and the rest is either the HTTP contract or the lab. A Rust-only backend is not reachable without porting the lab, which is outside the owner's ask.

### 5.3 Startup, memory, size for Rust parts

- **Startup and memory:** a compiled Rust server starts in milliseconds and its idle memory is tiny compared with an interpreter that imports pandas and NautilusTrader (both **unverified for this project**; the spike should time both). Neither matters while a Python process must also start for the gate.
- **Size:** the Polars Python runtime wheel, which carries the whole compiled engine, is 51.3 MB on Windows and 43.3 MB on macOS arm64 (B1). A Rust binary using a subset of Polars features would be smaller; how much smaller is **unverified**.

## 6. Option D: hybrid (recommended shape)

```
 shell (Rust, window, tray, lab picker, process supervisor)
   |  spawns, supervises, kills the whole tree
   v
 backend process: <lab>/.venv python -m nq_terminal   (phase 1: lab venv; demo build: bundled engine)
   |  imports nq_lab from <lab>/src, prices only via nq_lab.data.serve
   |  optional: nq_terminal_rs (PyO3 extension) for profiled hot paths
   v
 JOBS children: <lab>/.venv python -u backtests/run_base.py --config ...
```

- The shell is native and light; the backend stays the tested Python; Rust enters only as an extension module called behind existing Python functions, built with maturin 1.15.0 (B9).
- The HTTP contract, the SSE streams and the front end stay exactly as they are, so the existing test suites keep their meaning.
- A bundled engine (A1) is built only for the demo build, where `NQT_FIXTURE_DIR` replaces the lab, the runner is off and no lab code is needed beyond what is vendored for fixtures (check during the spike whether fixture mode still imports `nq_lab`; `settings.py` imports `nq_lab.config.ROOT` at module load, so today it does).

## 7. Keeping the three-way crosscheck honest during a port

The crosscheck reads JSON dumps written by `tests/test_dump_for_qa.py`, which calls the terminal's own analytics, and compares the `ours` side with `nq_lab`, `nautilus` and `stored` sides and with reference libraries (quantstats, empyrical-reloaded, arch, statsmodels, scipy). Rules for any Rust work:

1. **Same entry point.** A Rust function replaces the body of an existing Python function in `nq_terminal.analytics` through a PyO3 module. The dump test, the API and the golden files do not change. The crosscheck then proves the Rust code exactly as it proved the Python code.
2. **Shadow first.** For one release the Python body stays, and a test computes both and asserts equality at the crosscheck tolerances (1e-9 closed forms, 1e-12 stored anchors, absolute floor 1e-15) over the fixture set and the real-data smoke set. Only then is the Python body deleted.
3. **Golden files are not regenerated by a port.** `terminal/qa/golden/*.json` (four files today) are a fixed record; a port that needs a new golden file has changed a result and must be treated as a defect until explained.
4. **Known places where Rust and NumPy disagree in the last digits:**
   - Summation order. NumPy sums float arrays pairwise; a plain Rust iterator sum is sequential, and Polars uses compensated summation (an open proposal to move from Kahan to Neumaier, polars #24842; a fix for Kahan producing NaN from infinities, #25850) (B31). Differences of a few ulps are normal and will fail 1e-12 on long series.
   - Rolling moments. Polars reports "significant discrepancies in rolling moments calculation" on long time-varying data (#23488, open) and a stale residue in rolling skew and kurtosis (#28290, fixed July 2026); `rolling` results that differ from pandas (#5325, open since 2022) (B31).
   - Conventions: `ddof` (NumPy 0, pandas 1), quantile interpolation (NumPy default linear), NaN skipping, and `scipy.stats.skew` bias defaults. Each must be pinned in the port's tests.
   - Random streams. The live-start cone checks against arch's `StationaryBootstrap(block, r, seed)`; any bootstrap or Monte Carlo ported to Rust must reproduce NumPy's bit stream or keep the draw in Python. A Rust RNG with the same seed does not give the same numbers.
   - Clustering. `scipy.cluster.hierarchy.linkage`, `fcluster` and `leaves_list` order ties in their own way; a Rust clustering crate may return the same tree in a different leaf order, which changes the rendered heat map.
5. **The crosscheck stays Python.** It depends on reference libraries such as arch and statsmodels; there is nothing to gain from porting it, and keeping it independent of the code under test is the point.

## 8. The research gate in a packaged app

| Rule | Risk in a desktop app | Control |
|---|---|---|
| Prices only through `nq_lab.data.serve` | A Rust part that reads Parquet directly would be an ungated door | The backend never links `parquet` or `arrow` readers to lab paths. Extend the existing "no direct parquet reads" scan to the Rust code: Clippy `disallowed-methods` (B30) on Parquet and file-open calls outside an allowlisted module, plus a CI grep over `Cargo.lock` for Parquet features in the shell crate. |
| Nothing after 2021-12-31; sealed data never served | A bundled copy of `nq_lab` freezes the gate at build time and drifts from the lab's pins | Never bundle `nq_lab`. At start the backend puts `<lab>/src` first on `sys.path`, imports `nq_lab`, checks that `nq_lab.config.ROOT` resolves to the chosen lab folder, and checks `oos_gate.check_openings_pin` and `check_sealed_log_pin` as `/api/system` already does. Any failure: no prices, a clear refusal screen. |
| No writes under `results/`, `data/`, `live/` (except the gate's own audit lines) | The shell gains new write paths (config, logs, crash dumps, updater) | The shell writes only to its own folders: a folder named `nq-terminal` in the roaming per-user data folder on Windows and `~/Library/Application Support/nq-terminal` on macOS, plus the lab's `terminal/state/` for JOBS as today. Ban `std::fs` write calls outside one module with `disallowed-methods`. Ship the backend's test-time audit hook (`tests/research_guard.py`) as an optional runtime guard in debug builds; it already canonicalises 8.3 aliases, device prefixes and hard links. |
| Loopback only, same-origin checks on the two JOBS writes | The webview origin changes: Tauri serves `http://tauri.localhost` on Windows and `tauri://localhost` on macOS by default (B32) | Add exactly those origins to the JOBS origin allowlist and keep the per-launch token; never bind anything but 127.0.0.1. |

## 9. JOBS when Python is bundled

- **Use the lab's interpreter for backtests, always.** A queued backtest must be the same computation as a hand-started one: same NautilusTrader 1.231.0 build, same pandas, same `uv.lock`. A bundled engine is a second environment that can drift. `JobService` already takes `python` as an argument; the desktop backend passes `<lab>/.venv/Scripts/python.exe` (or `bin/python`) instead of `sys.executable`, and refuses JOBS with a clear message when that file is missing. In the demo build the runner is off, as fixture mode already does.
- **Kill the whole tree.** Today closing the server stops a running child. In a desktop app the shell must own the tree: on Windows, put the backend in a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, which "causes all processes associated with the job to terminate when the last handle to the job is closed" (B33), so a crashed shell still takes the backend and any `run_base.py` with it. On macOS, start the backend as a process group leader and signal the group on exit, plus a parent-death check in the backend (stdin closed means exit). Tauri's sidecar API had exactly this gap with PyInstaller children (#14360) and with NSIS upgrades (#9950) (B24).
- **No console windows.** On Windows the shell spawns the backend with `CREATE_NO_WINDOW`, and the backend's own `Popen` for JOBS should pass the same flag (today it relies on running inside a console). This is a small backend change.
- **Output:** JOBS writes `backtests/output/<run_id>/` and gate log lines exactly as now; nothing changes in what is written or where.

## 10. How the app finds the lab

- **The problem:** `nq_lab.config.ROOT` is `Path(__file__).resolve().parents[2]`, and the terminal's own `TERMINAL_DIR` is computed the same way from `settings.py`. Both assume the code lives inside the lab checkout. That is true for A0 and false for any frozen or bundled copy.
- **Order of lookup (proposal):** `NQ_LAB_ROOT` environment variable; then the path saved in the app's config file; then a first-run folder picker. The shell validates the folder before starting the backend: `pyproject.toml` with `name = "nq-lab"`, `src/nq_lab/oos_gate.py`, `results/`, `backtests/run_base.py`, and the venv interpreter. The backend then confirms that the imported `nq_lab.config.ROOT` equals that folder.
- **macOS specifics:** a Developer ID app outside the Mac App Store does not need App Sandbox ("To distribute a macOS app through the Mac App Store, you must enable the App Sandbox capability", B34), and should not use it: a sandboxed app could not read an arbitrary lab folder without security-scoped bookmarks and could not run the lab's interpreter. If the lab lives under `~/Documents` or `~/Desktop`, macOS will ask the owner once for folder access; keeping the lab in `~/nq-lab` avoids that prompt (**unverified for a child process; spike item**).
- **Windows specifics:** the lab is `C:\Users\Fatih Hekimoglu\nq-lab`, a path with a space; every spawn must use argument lists, as `JobService` already does.

## 11. Comparison

| | A0 lab venv | A1 standalone engine | A2 PyInstaller onedir | A3 Nuitka | B PyO3 embed | C Rust port | D hybrid (A0 + Rust modules) |
|---|---|---|---|---|---|---|---|
| Python shipped | 0 MB | about 240 MB (Win) / 270 MB (mac) compressed; 700 to 850 MB on disk (est.) | as A1 plus bootloader | as A1, compiled | as A1 | still needed for gate and JOBS | 0 MB |
| Startup | today's | today's after first launch; first launch slowed by OS scans (B17) | onedir about as A1; onefile slower (B21) | not measured | in-process, same imports | Rust part fast; Python still starts | today's |
| Memory | today's (2 GiB cache cap) | same | same | same | same, inside the UI process | lower for ported parts only | today's |
| macOS signing pain | none for Python | high: sign every Mach-O, layout rules (B18) | medium: tool does layout and signing (B5, B22) | medium | high | low for Rust | none for Python |
| Update size | shell only | engine 240 to 270 MB unless split | same | same | same | small | shell plus small extension |
| JOBS | unchanged | must point at lab venv | must point at lab venv | must point at lab venv | interpreter path must be explicit | unchanged (Python) | unchanged |
| Gate safety | unchanged | must not bundle `nq_lab` | must not bundle `nq_lab` | must not bundle `nq_lab` | must not bundle `nq_lab` | new Rust read paths to police | unchanged plus Rust scan |
| Crosscheck | unchanged | unchanged | unchanged | unchanged | unchanged | must prove every port | proves every port through the same dumps |
| Licence notes | none new | MPL-2.0 (B3) | GPL-2.0 with exception (B20) | AGPL-3.0 with runtime exception (B6) | MIT or Apache-2.0 | NautilusTrader crates LGPL-3.0 (B27) | maturin and PyO3 permissive |
| Verdict | **phase 1** | demo build only | fallback | no | no | no as a whole | **phase 2, only where profiled** |

## 12. What the spike must measure (hidden windows only)

These replace every "not measured" above. All on D:\dev, no window shown, nothing touching 127.0.0.1:8765.

1. Cold and warm start of `python -m nq_terminal` from the lab venv to the first `/api/health` 200, on a spare port, in fixture mode and in lab mode; `python -X importtime` breakdown for the top ten modules.
2. Idle and loaded working set of the backend (after HOME and an 8,411-row grid), against the 2 GiB cache cap.
3. A1 trial: unpack python-build-standalone 3.12.15, install the runtime set, record on-disk size and compressed size, start time, and whether NautilusTrader and pyarrow import cleanly from a relocated tree.
4. Whether fixture mode can start without importing `nq_lab` (decides how self-contained a demo build can be).
5. Job Object test: kill the shell process and confirm the backend and a running `run_base.py` die with it.
6. On the Mac (not reachable from here): codesign and notarise a stripped A1 engine; record which entitlements, if any, are needed.

## 13. What this means for the nq-lab terminal

- Keep the backend in Python and keep it a separate process. The window shell is where the "light and fast" gain lives; the backend's cost is the lab's own stack, which a desktop app cannot remove.
- Phase 1: the shell starts `<lab>/.venv` python with `-m nq_terminal`, supervises it with a Job Object (Windows) or process group (macOS), and passes the lab interpreter explicitly to JOBS. No bundled Python, no new signing work for Python, no change to the gate, the crosscheck or the e2e suite. Two small backend changes: an explicit lab root and interpreter from the shell, and no-console flags on spawns.
- Never bundle `nq_lab`. Import it from the chosen lab, verify the root and the gate pins at start, refuse to serve otherwise.
- Build a bundled engine (python-build-standalone plus uv) only for a demo build over fixtures, and only if the owner wants a build that runs without the lab.
- Use Rust inside the backend only after a profile names a hot path, and only as a PyO3 module behind the existing Python function, proved by the same dumps and golden files at the same tolerances. Do not build on NautilusTrader's Rust crates while the lab is on 1.231.0 and upstream is in a 2.0 release-candidate cycle.
- If the owner later wants a Rust IB snapshot, use `ibapi` 4.2.0 behind a Clippy ban on every order method and an outgoing message allowlist, mirroring today's three layers.

## Open questions

- Q1. Does the owner want a build that runs without a lab (demo only), or is "a window over my lab" the whole product? This decides whether A1 is ever built.
- Q2. Which Mac model and macOS version? NautilusTrader 1.231.0 needs macOS 26 on Apple Silicon for its wheels (L4, B2), for the lab venv as much as for any bundle.
- Q3. Is there a measured hot path in the backend today (a slow screen, a slow analytic)? Without one, a Rust port has no target.
- Q4. Should a debug build run the write-ban audit hook at runtime, or stay test-only as now?
- Q5. LGPL-3.0 obligations if NautilusTrader Rust crates are ever linked into a distributed binary: needs a reading before any second user.

## Sources

All checked on 2 October 2026.

- **B1** PyPI JSON API, wheel sizes and licences for the exact pinned versions: https://pypi.org/pypi/numpy/2.5.3/json, https://pypi.org/pypi/pandas/2.3.3/json, https://pypi.org/pypi/scipy/1.18.1/json, https://pypi.org/pypi/pyarrow/25.0.1/json, https://pypi.org/pypi/scikit-learn/1.9.1/json, https://pypi.org/pypi/pydantic-core/2.46.5/json, https://pypi.org/pypi/statsmodels/0.15.0/json, https://pypi.org/pypi/arch/8.0.0/json, https://pypi.org/pypi/polars-runtime-32/json
- **B2** NautilusTrader 1.231.0 on PyPI (win_amd64 112.8 MB, macosx_26_0_arm64 156.0 MB, LGPL-3.0-or-later): https://pypi.org/pypi/nautilus-trader/1.231.0/json
- **B3** python-build-standalone release 20261001 and asset sizes: https://github.com/astral-sh/python-build-standalone/releases/tag/20261001 (repository licence MPL-2.0 via the GitHub API)
- **B4** Astral, "A new home for python-build-standalone", 17 December 2024: https://astral.sh/blog/python-build-standalone
- **B5** PyInstaller changelog (6.22.3 of 12 September 2026; 6.13.0 onefile `.app` deprecation; 6.0.0 macOS layout): https://github.com/pyinstaller/pyinstaller/blob/develop/doc/CHANGES.rst
- **B6** Nuitka licence change commit 25d9589c, 28 January 2026: https://github.com/Nuitka/Nuitka/commit/25d9589c
- **B7** Nuitka README (licence, compilers, compile times, virus scanners): https://github.com/Nuitka/Nuitka/blob/develop/README.rst
- **B8** Gregory Szorc, "My Shifting Open Source Priorities", 17 March 2024: https://gregoryszorc.com/blog/2024/03/17/my-shifting-open-source-priorities/
- **B9** GitHub API repository and latest-release data: https://github.com/indygreg/PyOxidizer/releases, https://github.com/beeware/briefcase/releases, https://github.com/ofek/pyapp/releases, https://github.com/PyO3/pyo3/releases, https://github.com/PyO3/maturin/releases, https://github.com/pola-rs/polars/releases, https://github.com/apache/arrow-rs/releases, https://github.com/rust-ndarray/ndarray/releases, https://github.com/statrs-dev/statrs/releases
- **B10** PyO3 guide, the page on building and distributing (embedding section): https://pyo3.rs/v0.29.3/building-and-distribution.html
- **B11** Apple, Hardened Runtime: https://developer.apple.com/documentation/security/hardened-runtime
- **B12** Apple, Disable Library Validation entitlement (linked from B11): https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation
- **B13** uv, Python versions: https://docs.astral.sh/uv/concepts/python-versions/
- **B14** uv issues #21945 and #19126: https://github.com/astral-sh/uv/issues/21945, https://github.com/astral-sh/uv/issues/19126
- **B15** python-build-standalone quirks: https://gregoryszorc.com/docs/python-build-standalone/main/quirks.html
- **B16** python-build-standalone issues #274, #1224, #773: https://github.com/astral-sh/python-build-standalone/issues/274, https://github.com/astral-sh/python-build-standalone/issues/1224, https://github.com/astral-sh/python-build-standalone/issues/773
- **B17** PyInstaller discussion #8970, first launch of onedir, 3 to 4 January 2025: https://github.com/orgs/pyinstaller/discussions/8970
- **B18** Apple, Placing content in a bundle: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- **B19** Briefcase macOS reference (default entitlements, notarisation, universal builds): https://briefcase.beeware.org/en/stable/reference/platforms/macOS/index.html
- **B20** PyInstaller licence: https://pyinstaller.org/en/stable/license.html
- **B21** PyInstaller, how onefile works: https://pyinstaller.org/en/stable/operating-mode.html
- **B22** PyInstaller feature notes, macOS code signing: https://pyinstaller.org/en/stable/feature-notes.html
- **B23** PyInstaller issues #4333 and #8029: https://github.com/pyinstaller/pyinstaller/issues/4333, https://github.com/pyinstaller/pyinstaller/issues/8029
- **B24** Tauri issues #14360, #15134, #6888, #9950: https://github.com/tauri-apps/tauri/issues/14360, https://github.com/tauri-apps/tauri/issues/15134, https://github.com/tauri-apps/tauri/issues/6888, https://github.com/tauri-apps/tauri/issues/9950; sidecar guide: https://v2.tauri.app/develop/sidecar/
- **B25** PyO3 on crates.io: https://crates.io/crates/pyo3
- **B26** PyO3 guide, calling Python from Rust (free-threading note): https://pyo3.rs/v0.29.3/python-from-rust.html
- **B27** crates.io API: https://crates.io/crates/polars, https://crates.io/crates/arrow, https://crates.io/crates/ndarray, https://crates.io/crates/statrs, https://crates.io/crates/nautilus-analysis, https://crates.io/crates/nautilus-interactive-brokers
- **B28** NautilusTrader repository at v1.231.0 (`Cargo.toml` workspace version 0.61.0, `rust-version` 1.97.1; `crates/analysis/src/statistics`) and releases: https://github.com/nautechsystems/nautilus_trader/tree/v1.231.0/crates/analysis/src/statistics, https://github.com/nautechsystems/nautilus_trader/releases/tag/v2.0.0rc5
- **B29** rust-ibapi README and crates.io features for 4.2.0: https://github.com/wboayue/rust-ibapi, https://crates.io/crates/ibapi/4.2.0
- **B30** Clippy lint configuration, `disallowed-methods`: https://doc.rust-lang.org/clippy/lint_configuration.html
- **B31** Polars issues #24842, #25850, #23488, #28290, #5325: https://github.com/pola-rs/polars/issues/24842, https://github.com/pola-rs/polars/pull/25850, https://github.com/pola-rs/polars/issues/23488, https://github.com/pola-rs/polars/issues/28290, https://github.com/pola-rs/polars/issues/5325
- **B32** Tauri config source, `use_https_scheme` doc comment (default `http://<scheme>.localhost` on Windows, `<scheme>://localhost` on macOS): https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs
- **B33** Microsoft, JOBOBJECT_BASIC_LIMIT_INFORMATION: https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information
- **B34** Apple, App Sandbox: https://developer.apple.com/documentation/security/app-sandbox
- **B35** Python versions and end of life (3.12 security support until October 2028): https://devguide.python.org/versions/
