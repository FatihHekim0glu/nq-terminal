"""Generate the tables of docs/desktop/03_migration_plan.md from the repository tree and the inventories.

Usage (nq-lab venv Python, never a bare python):
    <nq-lab>/.venv/Scripts/python.exe gen_03_tables.py <terminal folder> <output .md>

Read only. It walks backend/nq_terminal, web/src, qa/crosscheck and the launchers, parses the route
table of 00_inventory_backend.md, adds any path found only in the working-tree contract, reads the
manifests, and writes one Markdown file of tables. A row is produced for every file or folder found,
so nothing is missed; the fate of each row comes from the rule tables below, and a row that no rule
covers is printed as UNMAPPED so a reviewer sees it.
"""
from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROUTE_ROW = re.compile(r"^\| (GET|POST|DELETE|PUT) \| `([^`]+)` \| `([^`]+)` \| (\w+) \| (\w+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|")

# ---------------------------------------------------------------- routes
SLOW_CACHE = {  # the eight routes slower than 1 s cold in the inventory (stage 1.2)
    "/api/ledger", "/api/analytics/spa", "/api/seasonality/instrument/{root}",
    "/api/analytics/hypothesis/{name}/bootstrap", "/api/analytics/run/{run_id}/bootstrap",
    "/api/market/two-day", "/api/runs/compare", "/api/analytics/deflated",
}


def desktop_form(method: str, path: str, cost: str, streaming: str) -> tuple[str, str]:
    """Return (desktop form, stage) for one route."""
    if path == "/api/openapi.json":
        return "unchanged; read by the contract drift test only, never by the page", "none"
    if streaming == "yes":
        return ("same-origin SSE, cookie checked by the token middleware (EventSource sends same-origin "
                "cookies); app smoke asserts stream mode, not polling; minimise-and-restore case", "1.4, 2.4")
    if method in ("POST", "DELETE"):
        return ("unchanged write (one of three); refused unless sys.prefix is ROOT/.venv and, in desktop "
                "mode, NQT_FIXTURE_DIR is unset; child gets the allow-listed environment", "1.3, 1.5")
    if path.startswith("/api/jobs"):
        return "unchanged read; loads nautilus_trader lazily as today", "1.4"
    if path == "/api/ib/snapshot":
        return "unchanged, opt-in (NQT_IB_READONLY=1); one backend per lab, so one client id 95", "1.3"
    if path == "/api/health":
        return ("unchanged, polled every 2 s; reports the contract version beside today's fields "
                "so the page can compare it with bridgeVersion", "1.3")
    if path in SLOW_CACHE:
        return "unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared", "1.2"
    if cost in ("heavy", "very heavy"):
        return "unchanged; profiled again after 1.1, cache only if it misses its budget", "1.1"
    return "unchanged (same GET, same JSON), token cookie checked", "1.4"


NEW_ROUTES = [
    ("GET", "/api/desktop/proof", "new (stage 1.3)",
     "header `Authorization: NQT <token>` and a nonce; answers the HMAC of token, nonce, port and pid, plus "
     "ROOT, sys.prefix and the contract version; re-run by the shell on every top-level navigation", "1.3"),
    ("GET", "/api/session", "new (stage 1.4)",
     "token header plus the caller's origin; returns a session value bound to that one origin and sets the "
     "HttpOnly, SameSite=Strict cookie on Path=/api; used by the shells, which then set the cookie in the webview", "1.4"),
    ("GET", "/api/session/code", "new (stage 1.4)",
     "token header; mints a single-use launch code that lives 60 s; used by start.ps1 and the Mac launcher", "1.4"),
    ("GET", "/api/session/redeem", "new (stage 1.4)",
     "code in a header, sent by the static `session.html` page that read it from the URL fragment; sets the "
     "cookie bound to the browser's origin; the code dies on first use", "1.4"),
    ("GET", "/api/workspaces", "new (stage 1.6)", "lists stored documents with their versions", "1.6"),
    ("GET", "/api/workspaces/{doc}", "new (stage 1.6)", "reads one stored document", "1.6"),
    ("PUT", "/api/workspaces/{doc}", "new (stage 1.6)",
     "the third write: versioned (If-Match), size-capped, schema-checked, writes only "
     "terminal/state/workspaces/<doc>.json; doc from a fixed allow list of ten names", "1.6"),
]


def route_tables(terminal: Path, inv_backend: Path) -> str:
    rows, seen = [], set()
    for line in inv_backend.read_text(encoding="utf-8").splitlines():
        m = ROUTE_ROW.match(line)
        if not m:
            continue
        method, path, handler, _mode, streaming, query, size, _body, cost, times = (g.strip() for g in m.groups())
        seen.add((method, path))
        form, stage = desktop_form(method, path, cost, streaming)
        rows.append((method, path, handler, size, cost, times, form, stage))
    contract = json.loads((terminal / "contract" / "openapi.json").read_text(encoding="utf-8"))
    extra = []
    for path, ops in sorted(contract["paths"].items()):
        for method in ops:
            if method.upper() in ("GET", "POST", "DELETE", "PUT") and (method.upper(), path) not in seen:
                extra.append((method.upper(), path))
    out = ["| # | Method | Path | Handler | Size | Cost | Cold / warm ms | Desktop form | Stage |",
           "|---:|---|---|---|---|---|---|---|---|"]
    for i, (method, path, handler, size, cost, times, form, stage) in enumerate(rows, 1):
        out.append(f"| {i} | {method} | `{path}` | `{handler}` | {size} | {cost} | {times} | {form} | {stage} |")
    n = len(rows)
    for method, path in extra:
        n += 1
        out.append(f"| {n} | {method} | `{path}` | working tree only (uncommitted) | not measured | not measured | "
                   f"not measured | unchanged GET once committed; measured at the start of stage 1 | 1.4 |")
    for method, path, handler, form, stage in NEW_ROUTES:
        out.append(f"| new | {method} | `{path}` | {handler} | XS | light | not built | {form} | {stage} |")
    summary = (f"Rows: {len(rows)} from the inventory route table, {len(extra)} found only in the working-tree "
               f"contract, {len(NEW_ROUTES)} new. Inventory routes cached in stage 1.2: "
               f"{sum(1 for r in rows if r[1] in SLOW_CACHE)}.")
    return summary + "\n\n" + "\n".join(out)


# ---------------------------------------------------------------- backend modules
CROSSCHECK = {
    "analytics/bootstrap.py": "crosscheck `bootstrap`", "analytics/deflated.py": "crosscheck `deflated`",
    "analytics/spa.py": "crosscheck `spa`", "analytics/capacity.py": "crosscheck `p2capacity`",
    "analytics/term_structure.py": "crosscheck `p2term`", "analytics/trend_regime.py": "crosscheck `p2trend`",
    "analytics/risk_extras.py": "crosscheck `p2risk`", "analytics/regimes.py": "crosscheck `regimes`",
    "analytics/seasonality.py": "crosscheck `seasonality`", "analytics/stress.py": "crosscheck `stress`",
    "analytics/tracking.py": "crosscheck `tracking`", "analytics/trades.py": "crosscheck `trades`",
    "analytics/excursions.py": "crosscheck `paths`", "analytics/expectation.py": "crosscheck `lv6`",
    "analytics/neff.py": "golden `p2_neff_served.json`", "analytics/exposure.py": "crosscheck `costs`",
    "analytics/perf.py": "crosscheck `series`", "analytics/drawdown.py": "crosscheck `series`",
    "analytics/rolling.py": "crosscheck `series`, `p1series`", "analytics/distribution.py": "crosscheck `series`",
    "analytics/risk.py": "crosscheck `series`", "analytics/relative.py": "crosscheck `series`",
    "analytics/validity.py": "crosscheck `series`, `registry`", "analytics/series.py": "crosscheck `series`, `p1series`",
    "analytics/_inputs.py": "crosscheck `series`", "services/vcone.py": "crosscheck `vcone`",
    "services/events.py": "crosscheck `evt`", "services/roll.py": "crosscheck `roll`",
    "services/dq.py": "crosscheck `dq_nq`, `dq_sidecar`", "services/dq_guards.py": "crosscheck `guards`",
    "services/market.py": "crosscheck `market`", "services/spa_family.py": "crosscheck `spa`",
    "services/tearsheet.py": "crosscheck `series`", "services/tearsheet_extended.py": "crosscheck `p1series`",
    "services/run_books.py": "crosscheck `costs`, `trades`", "services/paper_expectation.py": "crosscheck `lv6`",
    "services/regimes_capacity_term.py": "crosscheck `p2capacity`, `p2term`, `p2trend`",
    "services/risk_extras.py": "crosscheck `p2risk`", "services/seasonality.py": "crosscheck `seasonality`",
}

BACKEND_RULES: dict[str, tuple[str, str, str, str]] = {
    # path: (fate, target, stage, extra note)
    "__main__.py": ("rewrite", "binds port 0, prints the handshake line on stdout, starts the stdin watchdog, "
                    "takes the lock or exits with ATTACH", "1.3, 1.5", ""),
    "app.py": ("wrap", "registers the token middleware, the proof, session and workspace routers; "
               "assert_get_only allows exactly three writes", "1.3, 1.4, 1.6", ""),
    "settings.py": ("wrap", "NQT_PORT accepts 0; NQT_DESKTOP mode flag; desktop cache defaults "
                    "(512 MiB bars, 128 MiB files)", "1.3, 1.5", ""),
    "security.py": ("wrap", "adds the token cookie check on every /api call (hmac.compare_digest); "
                    "exactly one origin in desktop mode", "1.4", ""),
    "services/jobs.py": ("wrap", "allow-listed _child_env; refuses unless sys.prefix is ROOT/.venv; "
                         "close() called by the watchdog", "1.3, 1.5", ""),
    "services/files.py": ("keep", "FileCache reused as the key scheme of the result cache", "1.2", ""),
    "services/bars.py": ("keep", "same gate injection; desktop default cap 512 MiB", "1.5", ""),
    "services/ib_readonly_client.py": ("keep", "unchanged; AST ban unchanged", "none", ""),
    "services/ib_snapshot.py": ("keep", "unchanged; code 326 already fatal", "none", ""),
    "api/ib.py": ("keep", "unchanged", "none", ""),
    "api/live_stream.py": ("keep", "unchanged; cookie checked by middleware", "1.4", ""),
    "api/jobs.py": ("keep", "unchanged; ALLOWED_WRITE_ROUTES joined by the workspace PUT in app.py", "1.6", ""),
    "api/system.py": ("wrap", "health also reports the contract version", "1.3", ""),
    "api/runs.py": ("wrap", "result cache on /api/ledger and /api/runs/compare", "1.2", ""),
    "api/spa.py": ("wrap", "result cache on /api/analytics/spa", "1.2", ""),
    "api/seasonality.py": ("wrap", "result cache on /api/seasonality/instrument/{root}", "1.2", ""),
    "api/analytics.py": ("wrap", "result cache on both bootstrap routes and /api/analytics/deflated; "
                         "lazy import of analytics.perf", "1.1, 1.2", ""),
    "api/data.py": ("wrap", "result cache on /api/market/two-day", "1.2", ""),
    "analytics/perf.py": ("wrap", "scipy.stats imported inside the functions that need it", "1.1", ""),
    "models/jobs.py": ("keep", "lazy registry import kept; nautilus_trader stays out of start-up", "1.1", ""),
    "constants.py": ("keep", "mnemonic table unchanged; Mac key alternatives live in the page", "none", ""),
}


def backend_rule(rel: str) -> tuple[str, str, str]:
    if rel in BACKEND_RULES:
        fate, target, stage, _ = BACKEND_RULES[rel]
        return fate, target, stage
    if rel.startswith("analytics/"):
        if rel.endswith("__init__.py"):
            return "keep", "unchanged", "none"
        scipy_mods = {"risk", "risk_extras", "distribution", "validity", "regimes", "trades", "trend_regime",
                      "deflated", "neff"}
        stem = Path(rel).stem
        if stem in scipy_mods:
            return "keep", "unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile", "1.1"
        if stem in ("bootstrap", "spa"):
            return "keep", "unchanged; never ported (reproduces NumPy's PCG64 draws; out of G3)", "none"
        return "keep", "unchanged maths; G3 candidate only by profile", "none"
    if rel.startswith("api/"):
        return "keep", "unchanged handler; token cookie checked by middleware", "1.4"
    if rel.startswith("models/"):
        return "keep", "unchanged response models; contract regenerated only for the new routes", "none"
    if rel.startswith("services/"):
        return "keep", "unchanged service; reads only through FileCache and the gate", "none"
    if rel in ("__init__.py", "des_shapes.py"):
        return "keep", "unchanged", "none"
    return "UNMAPPED", "", ""


def tests_importing(tests_dir: Path, dotted: str) -> list[str]:
    pat = re.compile(rf"(from|import)\s+{re.escape(dotted)}(\s|$|\.|,)|from\s+{re.escape(dotted.rsplit('.', 1)[0])}\s+import\s+[^\n]*\b{re.escape(dotted.rsplit('.', 1)[1])}\b")
    hits = []
    for f in sorted(tests_dir.glob("test_*.py")):
        if pat.search(f.read_text(encoding="utf-8", errors="replace")):
            hits.append(f.name)
    return hits


def backend_table(terminal: Path) -> tuple[str, int]:
    pkg = terminal / "backend" / "nq_terminal"
    tests_dir = terminal / "backend" / "tests"
    out = ["| # | Path (`backend/nq_terminal/`) | Lines | Fate | Target | Stage | Test that proves parity |",
           "|---:|---|---:|---|---|---|---|"]
    files = sorted(p for p in pkg.rglob("*.py") if "__pycache__" not in p.parts)
    for i, p in enumerate(files, 1):
        rel = p.relative_to(pkg).as_posix()
        lines = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
        fate, target, stage = backend_rule(rel)
        dotted = "nq_terminal." + rel[:-3].replace("/", ".").replace(".__init__", "")
        if rel == "__init__.py":
            dotted = "nq_terminal"
        tests = tests_importing(tests_dir, dotted) if rel != "__init__.py" else []
        proof = []
        if rel in CROSSCHECK:
            proof.append(CROSSCHECK[rel])
        if tests:
            shown = ", ".join(f"`{t}`" for t in tests[:2])
            more = f" (+{len(tests) - 2})" if len(tests) > 2 else ""
            proof.append(shown + more)
        if not proof:
            proof.append("full backend suite and the contract drift test (no test imports it by name)")
        if fate in ("wrap", "rewrite"):
            proof.append("plus a new seam test (section 15)")
        out.append(f"| {i} | `{rel}` | {lines:,} | {fate} | {target} | {stage} | {'; '.join(proof)} |")
    return "\n".join(out), len(files)


# ---------------------------------------------------------------- front-end folders
E2E = {
    "home": "home.spec.ts, perf/budgets.spec.ts", "gp": "gp.spec.ts, gallery-candles.spec.ts",
    "des": "des.spec.ts", "reg": "reg.spec.ts, flows/p2.spec.ts", "runs": "runs.spec.ts, perspective.spec.ts",
    "tear": "tear.spec.ts", "mon": "market.spec.ts", "corr": "market.spec.ts",
    "ledg": "perspective.spec.ts, books.spec.ts", "oos": "perspective.spec.ts", "live": "live.spec.ts, stream.spec.ts",
    "help": "keys.spec.ts, fkeys.spec.ts", "cost": "books.spec.ts", "blk": "books.spec.ts", "expo": "books.spec.ts",
    "seal": "books.spec.ts", "vcone": "p11.spec.ts", "seas": "p11.spec.ts", "evt": "p11.spec.ts",
    "roll": "p11.spec.ts", "dq": "p11.spec.ts", "jobs": "flows/safety.spec.ts, flows/p2.spec.ts",
    "layouts": "panels.spec.ts", "p2rct": "flows/p2.spec.ts", "riskextras": "flows/p2.spec.ts",
}
FRONT_RULES: dict[str, tuple[str, str, str]] = {
    "screens/home": ("keep", "orientation flag moves to the workspace store (nqt.orientation)", "1.6"),
    "screens/mon": ("keep", "MON defaults move to the workspace store (nqt.mon.defaults)", "1.6"),
    "screens/des": ("keep", "Save rows call bridge.saveFile instead of the anchor", "1.7"),
    "screens/seal": ("keep", "Save row calls bridge.saveFile", "1.7"),
    "screens/reg": ("keep", "Export rows call bridge.saveFile", "1.7"),
    "screens/oos": ("keep", "CSV export through bridge.saveFile", "1.7"),
    "screens/runs": ("keep", "run id copy through bridge.copyText (clipboard API first)", "1.7"),
    "screens/live": ("keep", "unchanged; countdown re-synced on visibility change after a restore", "2.4"),
    "screens/help": ("wrap", "shows the Mac bindings and the desktop key notes; licence list completed", "3.3"),
    "screens/gp": ("keep", "unchanged; GIP pan and zoom traced at 20,000 bars", "2.4"),
    "screens/layouts": ("keep", "default layouts unchanged; saved layouts read from the store", "1.6"),
    "api": ("wrap", "client gains no new channel; health carries the contract version; bridgeVersion check; "
            "workspace client added beside jobsClient (the write scan allows exactly it)", "1.3, 1.6, 1.7"),
    "state": ("wrap", "zustand stores keep localStorage as a cache and sync to the workspace store; "
              "one-time import from browser storage", "1.6"),
    "chrome": ("wrap", "download.ts and panelExport.ts go through the bridge; key map gains Mac "
               "alternatives; deep links read from a launch argument in the app", "1.7, 3.3"),
    "commands": ("wrap", "history moves to the store (nqt.cmd.history); Mac key alternatives in the grammar", "1.6, 3.3"),
    "theme": ("wrap", "look and scheme move to the store (nqt.theme, nqt.cvd); forced-colors and "
              "prefers-contrast rules in the later accessibility phase", "1.6, later"),
    "export": ("wrap", "saveBlob and saveText through the bridge", "1.7"),
    "export/grab": ("wrap", "PNG save through bridge.saveFile; image copy through bridge.copyImage", "1.7"),
    "export/pack": ("wrap", "evidence pack saved through bridge.saveFile", "1.7"),
    "export/print": ("keep", "window.print() kept; checked in WebView2 and WKWebView", "2.4, 3.1"),
    "export/dossier": ("keep", "unchanged", "none"),
    "perspective": ("keep", "wasm32 server pinned by a test; worker same-origin", "1.7"),
    "quant": ("keep", "golden tests also run under JavaScriptCore in CI", "3.1"),
    "charts": ("keep", "unchanged; forced-colours drawing in the later accessibility phase", "later"),
    "charts/echarts": ("keep", "unchanged", "none"),
    "charts/theme": ("keep", "unchanged tokens; contrast re-run on WebKit", "3.1"),
    "demo": ("keep", "unchanged; ships only in the demo build; feeds the self-test page's offline mode", "none"),
    "gallery": ("keep", "unchanged; screenshot gallery stays on Chromium", "none"),
    "copy": ("wrap", "new strings for the splash, backend stopped page and Mac keys; copy rules test", "2.1, 3.3"),
}


def front_rule(rel: str) -> tuple[str, str, str]:
    if rel in FRONT_RULES:
        return FRONT_RULES[rel]
    if rel.startswith("screens/"):
        return "keep", "unchanged screen, same contract", "none"
    if rel in ("grids", "tiles", "format", "vendor", "assets"):
        return "keep", "unchanged", "none"
    if rel == "(src root)":
        return "wrap", "main.tsx installs the bridge implementation chosen at start", "1.7"
    return "UNMAPPED", "", ""


def count_ts(folder: Path, recursive: bool) -> tuple[int, int]:
    it = folder.rglob("*") if recursive else folder.glob("*")
    prod = tests = 0
    for f in it:
        if not f.is_file() or "__snapshots__" in f.parts:
            continue
        if ".test." in f.name:
            tests += 1
        elif ".gallery." not in f.name:
            prod += 1
    return prod, tests


def front_table(terminal: Path) -> tuple[str, int, int]:
    src = terminal / "web" / "src"
    rows: list[tuple[str, Path, bool]] = [("(src root)", src, False)]
    for d in sorted(p for p in src.iterdir() if p.is_dir()):
        if d.name == "screens":
            continue
        subdirs = sorted(p for p in d.iterdir() if p.is_dir() and p.name not in ("__snapshots__", "codegen"))
        rows.append((d.name, d, not subdirs))
        if d.name in ("charts", "export"):
            for s in subdirs:
                rows.append((f"{d.name}/{s.name}", s, True))
        elif subdirs:
            rows[-1] = (d.name, d, True)
    screens = sorted(p for p in (src / "screens").iterdir() if p.is_dir())
    out = ["| # | Path (`web/src/`) | Non-test files | Test files | Fate | Target | Stage | Test that proves parity |",
           "|---:|---|---:|---:|---|---|---|---|"]
    i = 0
    for d in screens:
        i += 1
        rel = f"screens/{d.name}"
        prod, tests = count_ts(d, True)
        fate, target, stage = front_rule(rel)
        e2e = E2E.get(d.name, "shell.spec.ts")
        out.append(f"| {i} | `{rel}` | {prod} | {tests} | {fate} | {target} | {stage} | "
                   f"vitest `{rel}` ({tests} {'file' if tests == 1 else 'files'}); Playwright {e2e}; Mac smoke set (3.1) |")
    n_screens = i
    for rel, d, recursive in rows:
        i += 1
        prod, tests = count_ts(d, recursive)
        fate, target, stage = front_rule(rel)
        proof = f"vitest `{rel}` ({tests} {'file' if tests == 1 else 'files'})" if tests else "covered through its callers' tests"
        if rel in ("api", "state", "chrome", "export", "export/grab", "export/pack", "(src root)", "commands", "theme"):
            proof += "; new bridge or store tests (section 15)"
        out.append(f"| {i} | `{rel}` | {prod} | {tests} | {fate} | {target} | {stage} | {proof} |")
    return "\n".join(out), n_screens, i - n_screens


# ---------------------------------------------------------------- QA, launchers, contract
def other_table(terminal: Path) -> tuple[str, int]:
    out = ["| # | Path | Fate | Target | Stage | Test that proves parity |", "|---:|---|---|---|---|---|"]
    rows = []
    for f in sorted((terminal / "qa" / "crosscheck").glob("*.py")):
        rows.append((f"qa/crosscheck/{f.name}", "keep", "unchanged oracle; also run against the app-launched backend", "2.4",
                     "`qa/tests`, `python -m crosscheck --strict`"))
    for g in sorted((terminal / "qa" / "golden").glob("*.json")):
        rows.append((f"qa/golden/{g.name}", "keep", "also read by the JavaScriptCore golden run", "3.1",
                     "vitest `quant`; JavaScriptCore run"))
    rows += [
        ("start.ps1", "wrap", "allow-listed environment; lock file attach; one-time launch code for the browser door", "1.4, 1.5",
         "launcher plan tests; `-DryRun` output check"),
        ("start.sh", "keep", "unchanged hand-off to scripts/start.mjs", "none", "launcher tests"),
        ("scripts/start.mjs", "keep", "unchanged Node version guard", "none", "`nodeGuard.test.ts`"),
        ("web/scripts/start/", "wrap", "same changes as start.ps1 for the Mac browser door", "1.4, 1.5",
         "`plan.test.ts`, `doctor.test.ts`, `entry.test.ts`"),
        ("scripts/smoke_real.ps1", "wrap", "second mode that drives the packaged app (hidden window) instead of a browser", "2.4",
         "the smoke itself: hashes unchanged, only terminal gate lines appended"),
        ("contract/openapi.json", "keep", "regenerated once for the seven new routes", "1.3, 1.4, 1.6",
         "contract drift test; `pnpm test` codegen check"),
        ("web/scripts/bundleCheck.ts", "keep", "budgets unchanged; desktop budgets live in the shell harness", "none",
         "`bundleCheck.test.ts`, `shellBudget.test.ts`"),
        ("web/e2e/", "keep", "unchanged on Chromium; a desktop project reuses the specs against the app-launched backend", "2.4",
         "the suite itself"),
    ]
    for i, (p, fate, target, stage, proof) in enumerate(rows, 1):
        out.append(f"| {i} | `{p}` | {fate} | {target} | {stage} | {proof} |")
    return "\n".join(out), len(rows)


# ---------------------------------------------------------------- dependencies
PY_ROW = re.compile(r"^\| `([^`]+)`(?: \(import name `[^`]+`\))? \| ([^|]+) \| ([\d.]+) \| ([^|]+) \| ([^|]+) \|")
PY_FATE = {
    "nautilus_trader": ("keep, out of the start path", "loaded only by GET /api/jobs and the JOBS child; never in the shell"),
    "scipy": ("keep, lazy", "imported inside the 14 functions' callers after stage 1.1; not ported"),
    "pyarrow": ("keep", "catalogue footers; rows only inside nq_lab"),
    "numpy": ("keep", "PCG64 draw order pinned by the crosscheck; never replaced"),
    "pandas": ("keep", "the real coupling; no port planned"),
    "pydantic_core": ("keep", "response validation"), "pydantic": ("keep", "response models, new workspace schemas"),
    "fastapi": ("keep", "same contract"), "starlette": ("keep", "middleware gains the token check"),
    "uvicorn": ("keep", "binds port 0 in desktop mode"), "h11": ("keep", "unchanged"),
    "anyio": ("keep", "stream and stdin watchdog thread"),
    "exchange_calendars": ("keep", "DQ calendar"),
    "orjson": ("keep", "unchanged"),
    "nautilus_ibapi": ("keep, opt-in", "read-only snapshot, client id 95"),
}


def dep_tables(terminal: Path, inv_backend: Path, inv_front: Path) -> str:
    parts = []
    out = ["| # | Python distribution (backend runtime) | Version | Installed MB | Loaded | Fate | Note |",
           "|---:|---|---|---:|---|---|---|"]
    n = 0
    text = inv_backend.read_text(encoding="utf-8")
    section = text.split("## 5. Dependencies", 1)[1].split("## 6.", 1)[0]
    for line in section.splitlines():
        m = PY_ROW.match(line)
        if not m:
            continue
        name, version, mb, c4, c5 = (g.strip() for g in m.groups())
        if name in ("Distribution",) or not re.match(r"^[\d.]+", version.split()[0] if version else ""):
            continue
        fate, note = PY_FATE.get(name, ("keep", "transitive; follows its parent"))
        n += 1
        loaded = c5 if c4.startswith(("yes", "no")) else c4
        out.append(f"| {n} | `{name}` | {version} | {mb} | {loaded} | {fate} | {note} |")
    for name, why in (("scikit-learn 1.9.1", "research code only"), ("langchain-typesafe and its tree", "lab text pipeline only"),
                      ("quantpad-data 0.8.0", "lab data pulls only"), ("pytest", "backend test runner")):
        n += 1
        out.append(f"| {n} | `{name}` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | {why} |")
    parts.append(out)
    qa = tomllib.loads((terminal / "qa" / "pyproject.toml").read_text(encoding="utf-8"))
    out = ["| # | QA environment (pinned in `qa/pyproject.toml`) | Fate | Note |", "|---:|---|---|---|"]
    for i, d in enumerate(qa["project"]["dependencies"] + qa["dependency-groups"]["dev"], 1):
        out.append(f"| {i} | `{d}` | keep | the oracle; runs in CI on Windows; never shipped |")
    parts.append(out)
    pkg = json.loads((terminal / "web" / "package.json").read_text(encoding="utf-8"))
    out = ["| # | npm production dependency | Version | Fate | Note |", "|---:|---|---|---|---|"]
    notes = {"@perspective-dev/server": "wasm32 build pinned by a test (memory64 absent in Safari)",
             "dockview-react": "drag and drop stays off; checked in WKWebView at G1",
             "react": "unchanged", "react-dom": "unchanged",
             "@fontsource/pt-mono": "self-hosted; same glyphs on both engines",
             "@fontsource/source-sans-3": "self-hosted",
             "echarts": "Apache-2.0 notice added to HELP licences", "lightweight-charts": "Apache-2.0 notice; attribution link opens in the system browser",
             "uplot": "unchanged", "cmdk": "unchanged", "zustand": "stores sync to the workspace store",
             "@tanstack/react-query": "networkMode always kept"}
    for i, (k, v) in enumerate(pkg["dependencies"].items(), 1):
        out.append(f"| {i} | `{k}` | {v} | keep | {notes.get(k, 'unchanged')} |")
    parts.append(out)
    out = ["| # | npm development dependency | Version | Fate | Note |", "|---:|---|---|---|---|"]
    dev_notes = {"@playwright/test": "stays the Chromium suite; drives Electron only if T1 or T2 fires",
                 "@axe-core/playwright": "also injected into the Mac self-test page (axe-core build)",
                 "vitest": "unchanged; plus a JavaScriptCore runner for `web/src/quant` golden tests",
                 "openapi-typescript": "regenerates types for the seven new routes"}
    for i, (k, v) in enumerate(pkg["devDependencies"].items(), 1):
        out.append(f"| {i} | `{k}` | {v} | keep | {dev_notes.get(k, 'unchanged')} |")
    parts.append(out)
    return "\n\n".join("\n".join(p) for p in parts)


def main() -> None:
    terminal = Path(sys.argv[1]).resolve()
    target = Path(sys.argv[2])
    docs = terminal / "docs" / "desktop"
    inv_b, inv_f = docs / "00_inventory_backend.md", docs / "00_inventory_frontend.md"
    routes = route_tables(terminal, inv_b)
    back, n_back = backend_table(terminal)
    front, n_screens, n_support = front_table(terminal)
    other, n_other = other_table(terminal)
    deps = dep_tables(terminal, inv_b, inv_f)
    unmapped = sum(t.count("UNMAPPED") for t in (back, front, other))
    text = "\n\n".join([
        "<!-- generated: routes -->", routes,
        f"<!-- generated: backend {n_back} -->", back,
        f"<!-- generated: front {n_screens} screens, {n_support} support -->", front,
        f"<!-- generated: other {n_other} -->", other,
        "<!-- generated: deps -->", deps,
        f"<!-- unmapped rows: {unmapped} -->",
    ])
    target.write_text(text + "\n", encoding="utf-8")
    print(f"backend {n_back}, screens {n_screens}, support {n_support}, other {n_other}, unmapped {unmapped}")


if __name__ == "__main__":
    main()
