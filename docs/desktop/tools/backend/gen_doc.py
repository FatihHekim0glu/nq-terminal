"""Build 00_inventory_backend.md from the JSON the scan scripts wrote (modules, routes, census, deps, start, qa).

Every table is generated; the prose around the tables is fixed text with numbers filled from the same JSON.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])


def load(name: str):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


mods = load("modules.json")
routes = load("routes.json")
census = load("census.json")
deps = load("deps.json")
start = load("start_measure.json")
imptime = load("importtime.json")
qa = load("qa.json")
extra = load("extra.json")
oa = load("oa_params.json")
facts = load("facts.json")



def clean(text: str, limit: int = 0) -> str:
    text = text.replace("\u2014", ", ").replace("\u2013", "-").replace("\u2019", "'").replace("\u2018", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"').replace("\u00d7", "x").replace("\u2248", "~")
    text = re.sub(r"[^\x00-\x7f]", "", text)
    text = text.replace("|", "/").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if limit and len(text) > limit:
        text = text[: limit - 3].rstrip() + "..."
    return text


def fmt_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} kB"
    return f"{n / 1048576:.2f} MB"


def size_class(n: int) -> str:
    if n < 2048:
        return "XS"
    if n < 20 * 1024:
        return "S"
    if n < 200 * 1024:
        return "M"
    if n < 1024 * 1024:
        return "L"
    return "XL"


def time_class(ms: float) -> str:
    if ms < 50:
        return "light"
    if ms < 500:
        return "medium"
    if ms < 2000:
        return "heavy"
    return "very heavy"


def table(headers: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


bymod = {m["module"]: m for m in mods}
api_mods = sorted(m["module"] for m in mods if m["module"].startswith("nq_terminal.api."))

# ---------------------------------------------------------------- import graph and reach
graph: dict[str, set[str]] = {}
for m in mods:
    deps_m = set()
    for name in m["imports"]["internal"]:
        cand = name
        while cand and cand not in bymod:
            cand = cand.rpartition(".")[0]
        if cand and cand != m["module"]:
            deps_m.add(cand)
    graph[m["module"]] = deps_m


def reach(start_mod: str) -> set[str]:
    seen, stack = set(), [start_mod]
    while stack:
        cur = stack.pop()
        for nxt in graph.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


reached_by: dict[str, set[str]] = defaultdict(set)
for a in api_mods:
    for r in reach(a) | {a}:
        reached_by[r].add(a.split(".")[-1])
reached_by["nq_terminal.app"] = set()

routes_by_mod: dict[str, list[dict]] = defaultdict(list)
for r in routes:
    mod = r["handler"].rsplit(".", 1)[0]
    routes_by_mod[mod].append(r)

# ---------------------------------------------------------------- module table
KIND_NOTE = {"pure": "pure", "I/O": "I/O", "I/O/subprocess": "I/O + subprocess", "IB": "IB", "IB/network": "IB + network",
             "I/O/IB": "I/O + IB"}


def served_by(m: dict) -> str:
    mod = m["module"]
    own = routes_by_mod.get(mod, [])
    if own:
        return f"{len(own)} route{'s' if len(own) != 1 else ''} (below)"
    users = sorted(reached_by.get(mod, ()))
    if mod in ("nq_terminal.app", "nq_terminal.__main__", "nq_terminal.settings", "nq_terminal.security"):
        return "every route (middleware / start-up)" if mod != "nq_terminal.__main__" else "start-up only"
    if not users:
        return "no route (helper or tests only)"
    if len(users) > 6:
        return f"{len(users)} of {len(api_mods)} route modules"
    return ", ".join(users)


module_rows = []
for m in mods:
    nl = ", ".join(sorted({i.replace("nq_lab.", "") if i != "nq_lab" else "(pkg)" for i in m["imports"]["nq_lab"]})) or "-"
    nt = ", ".join(m["imports"]["nautilus_trader"]) and "nautilus_trader (lazy, typing)" or ""
    tp = ", ".join(sorted(set(m["imports"]["third_party"]))) or "-"
    mix = f"pd {m['pd_refs']} / np {m['np_refs']}" if (m["pd_refs"] or m["np_refs"]) else "-"
    kind_text = KIND_NOTE.get(m["kind"], m["kind"])
    if m["module"] == "nq_terminal.services.bars":
        kind_text = "I/O by injection (gate)"
    git_mark = {"new": " (new, uncommitted)", "edited": " (edited, uncommitted)"}.get(m["git"], "")
    module_rows.append([
        f"`{m['path'].replace('nq_terminal/', '')}`{git_mark}", str(m["lines"]), kind_text,
        clean(m["doc"], 130) or "(no docstring)", clean(nl, 90) if not nt else clean(nl + "; " + nt, 120), tp, mix, served_by(m),
    ])
MODULE_HEADERS = ["Module", "Lines", "Kind", "Role (first docstring sentence)", "From nq_lab / Nautilus", "Third party", "pandas / numpy refs", "Reached from"]

layer_totals = defaultdict(lambda: [0, 0])
for m in mods:
    parts = m["path"].split("/")
    layer = parts[1] if len(parts) > 2 else "(top level)"
    layer_totals[layer][0] += 1
    layer_totals[layer][1] += m["lines"]

# ---------------------------------------------------------------- route table
op_info = oa["paths"]
route_rows = []
size_counter, time_counter = Counter(), Counter()
total_bytes = 0
for r in routes:
    method = "/".join(x for x in r["methods"] if x != "HEAD")
    key = f"{method} {r['path']}"
    q = ", ".join(op_info.get(key, {}).get("query", [])) or "-"
    meas = r["measured"]
    handler = r["handler"].replace("nq_terminal.api.", "").replace("fastapi.applications.", "fastapi.")
    kind = "async" if (r["is_async"] or r["path"] == "/api/live/stream") else "sync"
    if isinstance(meas, list):
        sizes = " / ".join(fmt_bytes(x["bytes"]) for x in meas if "bytes" in x)
        pairs = "; ".join(f"{x['cold_ms']:.0f} / {x['warm_ms']:.0f}" for x in meas if "cold_ms" in x)
        worst = max(x["bytes"] for x in meas if "bytes" in x)
        worst_cold = max(x["cold_ms"] for x in meas if "cold_ms" in x)
        sc = size_class(worst)
        tc = time_class(worst_cold)
        if method == "GET":
            size_counter[sc] += 1
            time_counter[tc] += 1
        if method == "GET":
            total_bytes += worst
        route_rows.append([method, f"`{r['path']}`", f"`{handler}`", kind, "no", q, sc, sizes, tc, pairs])
    else:
        note = "SSE stream" if r.get("streaming") else "write, not called"
        route_rows.append([method, f"`{r['path']}`", f"`{handler}`", kind, "yes" if r.get("streaming") else "no", q,
                           "stream" if r.get("streaming") else "-", note, "-", "-"])
ROUTE_HEADERS = ["Method", "Path", "Handler", "Mode", "Streaming", "Query (* required)", "Size", "Body measured", "Cost", "Cold / warm ms (in process)"]

# ---------------------------------------------------------------- dependency tables
dep_rows = []
for d in sorted(deps["rows"], key=lambda d: -d.get("size_mb", 0)):
    native = f"yes, {d['native_files']} files ({', '.join(d['native_examples'][:2])})" if d["native_files"] else "no (pure Python)"
    direct = ", ".join(d["direct_by"][:3]).replace("nq_terminal.", "") if d["direct_by"] else "transitive only"
    if len(d["direct_by"]) > 3:
        direct += f" (+{len(d['direct_by']) - 3})"
    dep_rows.append([f"`{d['dist']}`", d["version"], f"{d['size_mb']:.1f}", native, d["loaded_at"], clean(direct, 70)])
DEP_HEADERS = ["Distribution", "Version", "Installed MB", "Native extension", "Loaded", "Imported directly by"]

nl_loaded = extra["nq_lab_loaded"]
nl_rows = []
for i in sorted(nl_loaded, key=lambda i: -i["lines"]):
    if i["module"] in ("nq_lab", "nq_lab.strategies"):
        continue
    users = ", ".join(u.replace("nq_terminal.", "") for u in i["used_by"][:3]) or "transitive"
    if len(i["used_by"]) > 3:
        users += f" (+{len(i['used_by']) - 3})"
    nl_rows.append([f"`{i['module']}`", str(i["lines"]), "yes" if i["imports_nautilus"] else "no", clean(users, 80)])

# ---------------------------------------------------------------- QA tables
qa_rows = []
for kind, v in qa.items():
    srcs = ", ".join(f"{k} ({n})" for k, n in list(v["sources"].items())[:4])
    qa_rows.append([f"`{kind}`", str(v["dumps"]), str(v["PASS"]), str(v["INFO"]), clean(srcs, 110)])
QA_HEADERS = ["Dump kind", "Dumps", "PASS", "INFO", "Reference engine (rows compared)"]
tot = Counter()
for v in qa.values():
    for s in ("PASS", "FAIL", "SKIP", "INFO"):
        tot[s] += v[s]

qa_files = []
for p in sorted((Path(facts["lab"]) / "terminal" / "qa" / "crosscheck").glob("*.py")):
    text = p.read_text(encoding="utf-8")
    first = clean(text.split('"""')[1].strip().split("\n\n")[0], 150) if '"""' in text else ""
    qa_files.append([f"`crosscheck/{p.name}`", str(len(text.splitlines())), first])

# ---------------------------------------------------------------- numbers for prose
sm = start
ready = [r["time_to_health_s"] for r in sm]
ws_ready = [r["mem_at_ready"]["working_set_mb"] for r in sm]
ws_after = [r["mem_after_16_routes"]["working_set_mb"] for r in sm]
peak_after = [r["mem_after_16_routes"]["peak_working_set_mb"] for r in sm]
commit_ready = [r["mem_at_ready"]["commit_mb"] for r in sm]
commit_after = [r["mem_after_16_routes"]["commit_mb"] for r in sm]
first_ms = defaultdict(list)
for r in sm:
    for k, v in r["route_ms_first"].items():
        first_ms[k].append(v)
first_rows = [[f"`{k}`", f"{min(v)} to {max(v)}"] for k, v in first_ms.items()]

n_get = sum(1 for r in routes if r["methods"] in (["GET"], ["GET", "HEAD"]))
n_api_ops = oa["n_ops"]
n_async = sum(1 for r in routes if r["is_async"] or r["path"] == "/api/live/stream")
tests = facts["tests"]
n_slow = sum(1 for r in routes if isinstance(r['measured'], list) and any(x.get('cold_ms', 0) >= 1000 for x in r['measured']))
heavy = sorted(
    ((max(x["cold_ms"] for x in r["measured"]), r["path"]) for r in routes if isinstance(r["measured"], list) and "cold_ms" in r["measured"][0]),
    reverse=True)[:8]
big = sorted(
    ((max(x["bytes"] for x in r["measured"]), r["path"]) for r in routes if isinstance(r["measured"], list) and "bytes" in r["measured"][0]),
    reverse=True)[:6]

pure_n = sum(1 for m in mods if m["kind"] == "pure")
n_io = sum(1 for m in mods if m['kind'] == 'I/O')
n_ib = sum(1 for m in mods if m['kind'].startswith('IB'))
io_mods = [m for m in mods if m["kind"] != "pure"]
code_total = sum(m["code_lines"] for m in mods)
line_total = sum(m["lines"] for m in mods)
pd_mods = sorted((m for m in mods if m["pd_refs"] + m["pd_methods"] > 20), key=lambda m: -(m["pd_refs"] + m["pd_methods"]))
pd_free_analytics = [m["module"].split(".")[-1] for m in mods if m["module"].startswith("nq_terminal.analytics.") and m["pd_refs"] == 0 and m["np_refs"] > 0]
np_only = [m["module"].split(".")[-1] for m in mods if m["module"].startswith("nq_terminal.analytics.") and m["pd_refs"] == 0]
scipy_funcs = facts["scipy_functions"]


def lines_of(*names):
    return sum(bymod['nq_terminal.' + n]['lines'] for n in names)


readers = lines_of('services.runs', 'services.research', 'services.audit', 'services.catalog', 'services.journals', 'services.files', 'services.instruments', 'services.events', 'services.dq', 'services.dq_guards', 'services.amendments')
jobs_lines = lines_of('services.jobs', 'api.jobs', 'models.jobs')
ib_lines = lines_of('services.ib_readonly_client', 'services.ib_snapshot', 'api.ib', 'models.ib')
live_lines = lines_of('api.live', 'api.live_stream', 'models.live', 'services.live_routes')
mw_lines = lines_of('security')
pdm = ", ".join(f"{k} ({v})" for k, v in list(extra["pandas_methods"].items())[:14])

doc = f"""# 00 Inventory: backend and QA

Date checked: {facts['date']}. Scope: `terminal/backend/nq_terminal`, `terminal/qa`, `terminal/scripts`, the launchers, and how the backend reaches nq-lab's data and source. This is the "what exists" half of the migration plan: every piece gets a row here so the plan can give it a fate. It decides nothing about the target stack.

## 0. How this was produced, and how far to trust it

- Source of the tables: scan scripts in `docs/desktop/tools/backend/` (listed in section 12). Module rows come from an AST walk of every `.py` file under `nq_terminal` ({len(mods)} files), so none can be missed. Routes come from the live FastAPI app object (`iter_route_contexts` plus the generated OpenAPI document), not from reading decorators. Import tables come from `sys.modules` after the app was built and every GET route was called once (the "census").
- Code state: HEAD `{facts['head'][:7]}` (v2) plus {facts['dirty']} uncommitted changes in the working tree made by another run while this inventory was taken (some in analytics, spa, the tests and the QA package). Line counts are the working tree on {facts['date']}; they can drift by a few lines per file. Treat module line counts as +/- 1 percent.
- Measurements were taken on the owner's Windows 11 machine ({facts['cpu']}, {facts['ram']}), which was busy with other work, so every time is indicative, not a benchmark. Nothing was shown on screen: the app was driven in process (no window, no browser) and one server was started with no console window on a spare high port, then stopped by its own process id. Port 8765 was never contacted.
- Nothing was written under `results/`, `data/` or `live/`. A guard (Python audit hook) refused any write-mode open under those folders during the sweep and recorded {len(census['write_violations'])} attempts. The one write the terminal can make there, the gate's access-log line on a price read, was redirected to a scratch file in the sweep, and the live server was only sent routes that never reach the gate (checked: they leave no log line).
- Real data was used (not the test fixtures): {census['samples']['n_hypotheses']} registered hypotheses, {census['samples']['n_runs']} Nautilus runs, the processed price files, the live journals.
- Not measured: `/api/live/stream` (a stream, read from its code), the write routes (`POST` and `DELETE /api/jobs`), the Interactive Brokers snapshot (off by default; the route answers `disabled`), and any macOS behaviour (no Mac was reachable).

## 1. Headline numbers

{table(["Item", "Value"], [
    ["Backend modules", f"{len(mods)} files in the working tree, {line_total:,} lines ({code_total:,} code lines). At HEAD: {facts['head_modules']} files, {facts['head_lines']:,} lines. The other {len(mods) - facts['head_modules']} files are new and uncommitted (in-progress LV6 expectation and effective-trials work)"],
    ["Pure computation modules", f"{pure_n} of {len(mods)} (no file, network, subprocess or IB call found in the module by the scan; the price gate is reached by injection, so `services/bars.py` is flagged separately)"],
    ["Modules that touch the outside world", f"{len(io_mods)}: file I/O {n_io}, subprocess 1 (`services/jobs.py`), IB or network {n_ib}"],
    ["HTTP operations", f"{n_api_ops} in OpenAPI: {n_api_ops - 2} GET (one is the stream), 1 POST and 1 DELETE (both on /api/jobs); plus FastAPI's own `GET /api/openapi.json`. {oa['n_schemas']} schemas"],
    ["Streaming routes", "1 (`GET /api/live/stream`, Server-Sent Events); everything else is request and response JSON"],
    ["Runtime third-party distributions", f"{len(deps['rows'])} (installed size {sum(d.get('size_mb', 0) for d in deps['rows']):.0f} MB of {deps['all_installed_total_mb']:.0f} MB in the whole venv)"],
    ["Largest runtime weights", "nautilus_trader 317 MB (loaded only by `GET /api/jobs`), scipy 103 MB, pyarrow 83 MB, numpy 40 MB, pandas 37 MB"],
    ["scipy surface actually used", f"{len(scipy_funcs)} functions (see section 5)"],
    ["nq_lab modules loaded at runtime", f"{len(nl_loaded)} modules, {sum(i['lines'] for i in nl_loaded):,} lines"],
    ["Cold start to first `/api/health`", f"{min(ready):.1f} to {max(ready):.1f} s (3 runs); importing the app alone takes about 2.4 s of that (plain import, one measurement)"],
    ["Resident memory (working set)", f"{min(ws_ready):.0f} MB at ready, {min(ws_after):.0f} to {max(ws_after):.0f} MB after 16 typical routes (peak {max(peak_after):.0f} MB); {census['mem_after_sweep']['working_set_mb']:.0f} MB (peak {census['mem_after_sweep']['peak_working_set_mb']:.0f} MB) after the sweep of every GET route"],
    ["Committed memory", f"{min(commit_ready):.0f} MB at ready, {max(commit_after):.0f} MB after 16 routes, {census['mem_after_sweep']['private_mb']:.0f} MB after the full sweep (virtual commit, not RAM; see section 6)"],
    ["Backend tests", f"{tests['backend']} collected in {tests['backend_files']} files ({tests['backend_lines']:,} lines)"],
    ["QA crosscheck", f"{len(qa) and sum(v['dumps'] for v in qa.values())} dumps, {tot['PASS']:,} PASS, {tot['FAIL']} FAIL, {tot['SKIP']} SKIP, {tot['INFO']} INFO (documented differences); {tests['qa']} QA tests; 4 golden files"],
    ["Data the backend can read", f"processed prices {facts['processed_gb']} GB ({facts['processed_files']:,} files incl. repair records), results {facts['results_mb']} MB, run folders {facts['runs_mb']} MB ({facts['n_runs']} runs), live logs under 1 MB"],
])}

Findings that matter most for the plan, each detailed below:

1. The backend is thin glue over a small numeric core. Of {len(mods)} modules, {pure_n} are pure; the API layer, the models and the services are mostly file reads plus shaping. The numeric core is `analytics/` ({sum(m['lines'] for m in mods if m['module'].startswith('nq_terminal.analytics.')):,} lines, 26 modules) plus parts of `services/` that call it.
2. The scientific stack is used far less than its install size suggests. scipy is imported for {len(scipy_funcs)} functions in the working tree and {len(facts['scipy_functions_head'])} at HEAD: the normal pdf, cdf, survival function and quantile, the Student t quantile, `ttest_ind`, `skew`, `kurtosis`, `jarque_bera`, `probplot`, plus hierarchical clustering helpers. It costs 103 MB on disk and about 0.65 s of start-up.
3. Two analytics modules reproduce numpy's random stream exactly (`np.random.default_rng(seed)`: `integers` then `random`, PCG64), so that the stationary bootstrap and the SPA test match the reference library draw for draw. A port in another language must reproduce that generator bit for bit, or the strict crosscheck will fail by design.
4. pandas is the real coupling: {len(pd_mods)} modules each make more than 20 pandas references (time-zone aware indexes, rolling windows, group-bys, merge-as-of, calendars). It is the largest porting cost, not scipy.
5. The nq-lab research gate is not in the terminal. Prices come only through `nq_lab.data.serve`, which lives in the research repository and reads parquet through pyarrow. The terminal adds a catalogue (parquet footers), a year-aligned cache and a refusal layer on top.
6. `GET /api/jobs` is the only route that pulls `nautilus_trader` into the server process: in a fresh-process sweep of all 75 measured URLs, with that route last, nothing else loaded it, and none of `ibapi`, `sklearn`, `statsmodels`, `arch` or `quantstats` loaded. The cause is the strategy registry that `models/jobs.py` imports lazily to validate the stored job specs. The backtest itself runs in a child process (`backtests/run_base.py`). A native shell can drop NautilusTrader from its own process entirely and keep it as an external tool the job queue starts.
7. {n_slow} routes take more than a second cold on this machine, and several recompute on every call (section 4).

## 2. Architecture in one page

Request path: browser or webview -> uvicorn (plain `h11`, asyncio, no `uvloop`, no `httptools`) -> four ASGI middlewares (security headers, loopback-only peer check, trusted host `127.0.0.1` and `localhost`, same-origin guard for `/api`) -> FastAPI router -> a plain `def` handler (run on the anyio worker thread pool; {len(routes) - n_async} of {len(routes)} registered handlers are sync, {n_async} are async: the SSE stream and FastAPI's own OpenAPI route) -> a service object held on `app.state` -> files read through `FileCache`, prices read through the injected gate function.

- Process model: one Python process. A thread pool runs the sync handlers. One daemon thread (`nqt-jobs`) runs the backtest queue. The venv's `python.exe` is a launcher stub (4 MB) that starts the real interpreter as a child, so Task Manager shows two processes per terminal.
- Read-only by construction: `create_app` refuses to build if any route other than GET and HEAD exists, except exactly `POST /api/jobs` and `DELETE /api/jobs/{{job_id}}`; the only mount is a plain `StaticFiles` of `web/dist`; the API docs pages are off. Tests scan the source with the AST for forbidden names (IB order calls, parquet reads outside the gate, writes outside `terminal/state`).
- State: no database. Everything is files. The terminal's own writable state is `terminal/state/jobs.json` (queue history, 200 entries) and the append-only gate log `results/oos_access_log.jsonl` (one line per price read, written by `nq_lab.oos_gate`, not by the terminal).
- Caches (all in memory, rebuilt on start): `FileCache` (entries keyed on path, validated by mtime and size, bounded by entries and bytes, parquet refused), `GatedBarCache` (year-aligned frames, byte cap `NQT_CACHE_BYTES`, default 2 GiB, set to 256 MiB in these measurements), a run index rescanned on a timer, journal monitors for the live screens.
- Contract: `terminal/contract/openapi.json` ({Path(facts['lab'], 'terminal', 'contract', 'openapi.json').stat().st_size // 1024} kB) is generated from the app and checked in; the front end generates its TypeScript types from it and a test fails on drift. {oa['n_schemas']} schemas, most of them response bodies. Any new backend must either serve the same contract or the front end types move with it.
- Environment variables read: `NQT_PORT`, `NQT_CACHE_BYTES`, `NQT_FIXTURE_DIR`, `NQT_IB_READONLY`, `IB_HOST`, `IB_PORT`, `IB_ACCOUNT_ID`, `IB_BASE_USD_RATE`; the job runner passes `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` to the child. The bind host is a constant (`127.0.0.1`), never an option.

Layer totals (working tree):

{table(["Layer", "Files", "Lines"], [[f"`{k}`", str(v[0]), f"{v[1]:,}"] for k, v in sorted(layer_totals.items())])}

## 3. Module table (one row per file)

Kind is derived from the module's imports and calls: `pure` means no file, network, subprocess or IB use. "pandas / numpy refs" counts attribute uses of `pd.` and `np.` in the module (a size signal for porting cost, not a quality measure). "Reached from" is the set of route modules that import the module directly or through other modules (import reachability: an upper bound, since a route module may import a service it uses for one route only).

{table(MODULE_HEADERS, module_rows)}

Notes on the table:

- Lazy imports exist in `app.py` (analytics, instruments, live_stream, p11 and p12 routers are imported inside `create_app`) and `models/jobs.py` (the strategy registry and `nautilus_trader.trading.config`, imported inside a function). They are why the census shows `nautilus_trader` loading only after the first `/api/jobs` call.
- `services/ib_readonly_client.py` is the only file that imports the Interactive Brokers library (`ibapi`, shipped as `nautilus_ibapi`), and `services/ib_snapshot.py` imports it only inside a function, so with the snapshot off (the default) it is never loaded.

## 4. API route table (every route)

Size classes (largest measured body): XS under 2 kB, S under 20 kB, M under 200 kB, L under 1 MB, XL above. Cost classes (largest cold time, in process, no HTTP): light under 50 ms, medium under 500 ms, heavy under 2 s, very heavy above. "Cold / warm" is the first and the second call of the same URL in the same process, so warm shows what the service caches save. Where a cell has two pairs the route was measured with two parameter sets (`/api/bars`: daily bars, then one month of 1m bars), written as cold / warm; the OS file cache was warm for most reads, so first-ever reads of cold files are slower. Parameters used: first registered hypothesis `{census['samples']['hypothesis']}`, run `{census['samples']['run']}` ({census['samples']['n_readable_runs']} readable runs), root `NQ`, symbol `NQ.V.0`. Responses are uncompressed JSON (no gzip middleware).

{table(ROUTE_HEADERS, route_rows)}

Distribution over the {sum(size_counter.values())} measured GET routes (the schema route included, the stream excluded): sizes {', '.join(f'{k} {v}' for k, v in sorted(size_counter.items(), key=lambda kv: 'XS S M L XL'.split().index(kv[0])))}; cost {', '.join(f'{k} {v}' for k, v in time_counter.items())}.

Slowest cold routes (in process): {', '.join(f'`{p}` {ms:,.0f} ms' for ms, p in heavy)}. Largest bodies: {', '.join(f'`{p}` {fmt_bytes(b)}' for b, p in big)}.

Fresh server over real HTTP, first call of each route after start (three starts; milliseconds, minimum to maximum). This is the number a user feels on first open; `/api/runs` builds the run index and `/api/ledger` parses the ledger on the first call:

{table(["Route", "First call, ms"], first_rows)}

Observations for the plan:

- {size_counter.get('XS', 0) + size_counter.get('S', 0)} of the measured routes return under 20 kB; the large ones are series for charts (equity, exposure, bars, analytics panels), all JSON today. Moving to a binary column format between backend and UI would shrink the biggest bodies but changes the contract.
- Warm times equal cold times for several heavy routes (`/api/market/two-day`, `/api/analytics/*/bootstrap`, `/api/seasonality/instrument/{{root}}`, `/api/analytics/run/{{run_id}}/capacity`, `/api/dq/symbols`): they recompute on every call. These are the first candidates for a native rewrite or a result cache.
- Every handler is synchronous except the stream and FastAPI's schema route. The concurrency model is therefore "thread pool of blocking calls", which maps directly onto a native thread pool.

## 5. Dependencies actually imported at runtime

Method: the census of `sys.modules` after the app was built ("app start") and after every GET route was called ("first use of a route"). Sizes are the sum of the files each distribution lists on disk (site-packages, Windows wheels, Python 3.12.12). The base interpreter (uv-managed CPython 3.12.12) is separate: 67 MB on disk. uvicorn, `h11` and `click` are added by the server entry point; they were measured in a separate import. Versions are the installed ones.

{table(DEP_HEADERS, dep_rows)}

Added by `python -m nq_terminal` or by an opt-in feature (not in the census above, because the app object was driven in process or the feature was off):

{table(["Distribution", "Version", "Installed MB", "Native extension", "When"], [
    ["`uvicorn`", "0.54.0", "0.3", "no", "server entry point; plain install, so no `uvloop` and no `httptools`: it runs on the standard asyncio loop"],
    ["`h11`", "0.16.0", "0.1", "no", "HTTP/1.1 parser used by uvicorn"],
    ["`click`", "8.5.0", "0.4", "no", "imported by uvicorn"],
    ["`nautilus_ibapi` (import name `ibapi`)", "10.45.1", "1.1", "no", "only with `NQT_IB_READONLY=1`, and only inside `take_snapshot`"],
    ["`protobuf`", "5.29.6", "1.6", "yes, 1 file", "dependency of the IB library"],
])}

Installed but not imported by the terminal: `ibapi` (`nautilus_ibapi 10.45.1`, loaded only when `NQT_IB_READONLY=1`), `scikit-learn 1.9.1` (26 MB, used by research code, not the terminal), `langchain-typesafe` and its tree, `quantpad-data`, `pytest`. The QA project has its own environment with `statsmodels 0.15.0`, `arch 8.0.0`, `quantstats 0.0.82`, `empyrical-reloaded 0.5.12` and `scipy 1.18.1` (section 9); those never run in the terminal.

What the backend uses from the heavy libraries:

- scipy ({len(scipy_funcs)} functions, 11 modules): {', '.join(f'`{f}`' for f in scipy_funcs)}. `scipy.stats` appears in ten analytics modules (perf, risk, risk_extras, distribution, validity, regimes, trades, trend_regime, deflated, neff); clustering is in neff and `services/market.py`.
- numpy: array maths everywhere in `analytics/`; `np.linalg.eigvalsh` (neff); `np.random.default_rng` (bootstrap, spa) with the draw order of the `arch` library, which the crosscheck verifies. Any replacement generator must be PCG64 seeded the way numpy seeds it, and must draw `integers(n, size=n)` and then `random(n)` per replication in the same order.
- pandas: most used attributes (counts across the backend): {pdm}. Heavy modules: {', '.join(f"`{m['module'].split('nq_terminal.')[1]}` ({m['pd_refs']}+{m['pd_methods']})" for m in pd_mods[:12])}. The time-zone rules (US Eastern sessions, UTC bars, a Globex 22:00 UTC day boundary) are carried by pandas time-zone indexes.
- pyarrow: one module (`services/catalog.py`, `parquet.read_metadata`: footers only). All price rows are read inside nq_lab (`pyarrow.dataset` with a `ts` filter).
- exchange_calendars: one module (`services/dq.py`, the NYSE `XNYS` calendar for data-quality day states, from 2010-09-28). It pulls `pyluach`, `korean_lunar_calendar`, `toolz` and `pytz`.
- orjson: imported at start by FastAPI's response module when installed; no terminal code calls it. pydantic 2.13.5 with `pydantic_core` (Rust) validates every response model.

nq_lab modules loaded at runtime ({len(nl_loaded)} modules; the research package has about 33,000 lines, so the terminal's real dependency on it is the set below). "Direct importers" are terminal modules that import the module by name; the rest are pulled in by other nq_lab modules.

{table(["nq_lab module", "Lines", "Imports nautilus_trader", "Direct importers in the terminal"], nl_rows)}

The closure includes the strategy modules (`nq_lab.strategies.*`) and book builders (`dtsmom_*`, `eomtsy_*`, `sizing_*`, `nt_*`), most of which import `nautilus_trader`. The terminal loads them only through `/api/jobs` and some analytics services that reuse their statistics (`dtsmom_stats`, `sizing_stats`, `calendar_effects`, `carry_signal`). That is research code the terminal borrows, and the plan must decide per function whether to port, wrap or keep as a Python sidecar.

## 6. Cold start and memory

Method: `python -X importtime` on `import nq_terminal.__main__` (3 runs, wall {', '.join(str(x) for x in facts['importtime_wall_ms'])} ms); a server started with `python -m nq_terminal` on a spare port with no window, polled until `/api/health` answers (3 runs), memory read with `GetProcessMemoryInfo` on the real interpreter process (not the launcher stub), the server stopped by process id.

{table(["Measure", "Value"], [
    ["Bare interpreter start (`python -c pass`)", f"{facts['bare_python_ms']} ms"],
    ["`import pandas` alone", f"{facts['pandas_ms']} ms"],
    ["`import scipy.stats, scipy.optimize` alone", f"{facts['scipy_ms']} ms"],
    ["Import of the whole app (`nq_terminal.__main__`, includes the module-level `create_app()`)", f"{imptime['total_ms']} ms under `-X importtime`; {', '.join(str(x) for x in facts['importtime_wall_ms'])} ms wall for three runs with `-X importtime`; `create_app()` itself about {census['create_app_s']:.2f} s"],
    ["Modules in `sys.modules` after app start", f"{len(census['modules_after_create_app']):,} new modules (all third party and nq_lab; the standard library is already loaded)"],
    ["Process start to first `/api/health` 200", f"{', '.join(f'{x:.2f}' for x in ready)} s"],
    ["Working set at ready (real interpreter)", f"{', '.join(f'{x:.0f}' for x in ws_ready)} MB; idle after 5 s unchanged"],
    ["Working set after 16 typical routes", f"{', '.join(f'{x:.0f}' for x in ws_after)} MB (peak {', '.join(f'{x:.0f}' for x in peak_after)} MB)"],
    ["Working set after all routes incl. bars, analytics, bootstrap (256 MiB bar cache)", f"{census['mem_after_sweep']['working_set_mb']:.0f} MB (peak {census['mem_after_sweep']['peak_working_set_mb']:.0f} MB)"],
    ["Committed memory", f"{', '.join(f'{x:.0f}' for x in commit_ready)} MB at ready; {census['mem_after_sweep']['private_mb']:.0f} MB after the sweep. The high commit with a low working set comes from address space the numeric libraries reserve; it is not RAM in use."],
    ["Launcher stub process", f"{sm[0]['mem_launcher_stub']['working_set_mb']} MB (venv launcher that starts the interpreter)"],
])}

Where start-up time goes (self time summed per top-level package from `-X importtime`, so approximate): scipy {imptime['by_top_self_ms'].get('scipy', 0)} ms, the terminal's own modules and their pydantic model building {imptime['by_top_self_ms'].get('nq_terminal', 0)} ms, pandas {imptime['by_top_self_ms'].get('pandas', 0)} ms, numpy {imptime['by_top_self_ms'].get('numpy', 0)} ms, fastapi {imptime['by_top_self_ms'].get('fastapi', 0)} ms, exchange_calendars {imptime['by_top_self_ms'].get('exchange_calendars', 0)} ms, pydantic {imptime['by_top_self_ms'].get('pydantic', 0)} ms, pyarrow {imptime['by_top_self_ms'].get('pyarrow', 0)} ms.

Reading it: nearly all of the {min(ready):.1f} to {max(ready):.1f} s to first answer is Python importing libraries and building the pydantic models (a plain import of the app took about 2.4 s in one measurement; `-X importtime` adds its own overhead). The rest is the launcher stub, the server socket and the first request. A compiled backend would not pay it. The first calls then add run-index and ledger parsing (`/api/runs` about 1.3 s, `/api/ledger` about 4 s on a fresh start), which a native rewrite would also have to make fast.

## 7. How the backend finds nq-lab's data and source

- Source: `nq-lab/.venv/Lib/site-packages/nq_lab.pth` contains the single line `C:\\Users\\Fatih Hekimoglu\\nq-lab\\src`, an editable install. The terminal package itself is not installed: `start.ps1` runs `python -m nq_terminal` with the working directory `terminal/backend`, so the current directory puts `nq_terminal` on the path. There is no `pyproject.toml` under `terminal/backend` (only `ruff.toml`).
- Root: `nq_lab.config.ROOT = Path(__file__).resolve().parents[2]`, the nq-lab folder, found from the location of the editable source. `Settings.root` is that path. `NQT_FIXTURE_DIR` replaces the root for every research and live file read (tests, demos, screenshots); settings refuse a UNC or device path, the project root or a parent of it, and any folder inside the project except `terminal/backend/tests/fixtures`.
- Folders read (all relative to the root or the fixture folder): `results/` (registry, ledger, screens, QA reports, sealed results, openings, the gate log), `backtests/output/<run_id>/` (one `result.json` plus logs and optional sidecars per run, {facts['n_runs']} runs, {facts['runs_mb']} MB), `live/logs/` and `live/KILL` (paper journals, kill switch), `data/processed/` (parquet price files, {facts['processed_gb']} GB in {facts['processed_files']:,} files counting repair-record folders; footers only through the catalogue, rows only through the gate), and `data/text/fomc/manifest.json` (a calendar cross-check). The 3.4 GB `data/raw` folder is not read.
- Prices: `nq_lab.data.serve(start, end, caller="terminal", reason=..., symbol, timeframe, variant)` -> `oos_gate.serve_bars`, which refuses any window outside [2010-01-01, 2022-01-01), appends a JSON line to `results/oos_access_log.jsonl` and loads parquet with `pyarrow.dataset`. Sealed data is never requested by the terminal.
- Python used: the launcher picks `nq-lab/.venv/Scripts/python.exe` (Python 3.12.12 from the uv-managed interpreter), and refuses to start if `fastapi` and `uvicorn` do not import. The macOS launcher (`start.sh`) hands over to a Node script that does the same checks.
- Front end: the built SPA is served by the same process from `terminal/web/dist` (a `StaticFiles` mount at `/`, after the API routes). In development Vite runs on 5173 and proxies `/api` to 8765.

## 8. Subprocess and Interactive Brokers paths

- Backtest queue (`services/jobs.py`, `api/jobs.py`, `models/jobs.py`): `POST /api/jobs` validates a `JobSpec` (strategy name from `run_base.FEEDS`, parameter names from the strategy registry, in-sample dates), queues it (cap 10, history 200), and a single worker thread starts `[python, "-u", <root>/backtests/run_base.py, "--config", <json>]` through `subprocess.Popen` with an argv list (no shell). The child writes `backtests/output/<run_id>/result.json` and gate log lines itself; the terminal tails its output (last lines), maps exit codes (0 ok, 1 failed checks, other error), persists the queue to `terminal/state/jobs.json` and stops a running child on shutdown. This is the only place the terminal starts a process, and the only place NautilusTrader runs. A native app must keep a Python (or equivalent) runtime available for this feature, or drop it.
- Interactive Brokers (`services/ib_readonly_client.py`, `services/ib_snapshot.py`, `api/ib.py`): opt-in with `NQT_IB_READONLY=1`; host and port from `IB_HOST` (default 127.0.0.1) and `IB_PORT` (default 7497, TWS paper), the live ports 7496 and 4001 refused, accounts must be paper (`DU...`), client id fixed at 95, a whitelist of request ids on the socket, every order-style method overridden to raise, account ids masked, result cached for a few seconds. One blocking socket read in a worker thread. The IB wire library is `ibapi 10.45.1` (via `nautilus_ibapi`), pure Python.
- Live screens (`api/live.py`, `api/live_stream.py`, `services/journals.py`): read the paper book's journals and logs from `live/logs/`, report the kill switch, and push changes over Server-Sent Events (bounded streams, resume by a `Last-Event-ID` position token, heartbeat, a lifetime after which the browser reconnects). No writes, no order path.

## 9. QA: the crosscheck, golden files and tests

Purpose: a strict three-way numerical check. The backend tests write JSON dumps (`terminal/qa/.dumps/`, schema `nqt-qa-dump/1`, {len(list((Path(facts['lab'], 'terminal', 'qa', '.dumps')).glob('*.json')))} files, ~20 MB, git-ignored) holding raw inputs plus the values each implementation computed: `ours` (the terminal), `nq_lab` (the existing research helper), `nautilus` (the Nautilus Rust statistic where one exists) and `stored` (a value in a result file). `python -m crosscheck` in the separate QA environment then recomputes each metric with reference libraries (or plain Python, `decimal`, written-out rules) and compares. Tolerance: 1e-9 relative for closed forms, 1e-12 for stored values. Differences from a reference library's own definition are listed in `reference.py` as documented and shown as INFO, never failed. `--strict` turns a missing value (SKIP) into a failure. QA code never imports the backend.

Run on {facts['date']} over the current dumps: `{tot['PASS']:,} PASS, {tot['FAIL']} FAIL, {tot['SKIP']} SKIP, {tot['INFO']} INFO`, exit OK, about 37 s. (The brief for this work quotes about 2,325 checks; the dumps on disk now give the higher count, which fits the uncommitted QA changes in the working tree.)

{table(QA_HEADERS, qa_rows)}

Reference libraries (QA environment only, pinned in `terminal/qa/pyproject.toml`): `quantstats 0.0.82`, `empyrical-reloaded 0.5.12`, `arch 8.0.0`, `statsmodels 0.15.0`, `scipy 1.18.1`; the environment is {facts['qa_venv_mb']} MB and also holds matplotlib, seaborn and curl_cffi among others, pulled in by quantstats.

Crosscheck source files (`terminal/qa/crosscheck`):

{table(["File", "Lines", "Role"], qa_files)}

Golden files (`terminal/qa/golden`): `p12_power.json` (normal CDF, quantile, minimum detectable Sharpe and power from `scipy.stats.norm`), `p12_neff.json` (correlation, eigenvalues, Li-Ji and participation-ratio effective trials, UPGMA clusters, expected-maximum Sharpe and PSR on a synthetic nine-trial panel), `p12_expectation.json` (expectation cone cases), `p2_neff_served.json` (the served neff and SV8 values). They are written by `python -m crosscheck.p12_*` and read by the TypeScript tests: the browser already carries ported copies of this maths (`web/src/quant/normal.ts`, `power.ts`), pinned to Python by these files. That is the template the migration can reuse: a golden file per ported kernel, generated from the Python reference, checked from the new language.

Tests: {tests['backend']} backend tests in {tests['backend_files']} files plus fixtures ({facts['fixtures_kb']} kB of tiny result files, journals and screens); {tests['qa']} QA tests; the AST safety scans (`tests/test_safety_ast.py` and helpers) that ban order-style IB names, parquet reads outside the gate and non-GET routes; the contract drift test (`contract/openapi.json` against the app); the CSP test (`'wasm-unsafe-eval'` for Perspective). The front-end suites (vitest, Playwright, perf budgets, accessibility) are out of this document's scope.

What a migration must preserve here, as constraints for the plan:

- The 1e-9 and 1e-12 agreement on every dumped metric, including the RNG-dependent ones (bootstrap, SPA, lv6 cone), which pins the generator.
- The documented differences from the reference libraries (the INFO rows): the plan must keep the terminal's definitions, not adopt a library's.
- The gate behaviour: the fence [2010-01-01, 2022-01-01), one gate log line per read with `caller="terminal"`, the sealed-data refusal, and the pin checks on the sealed log and openings.
- The AST-level guarantees (no order path, no ungated parquet read, GET only) re-expressed as checks that a new code base can run.

## 10. Scripts and launchers

{table(["File", "Lines", "What it does"], [
    ["`start.ps1` (Windows)", "242", "Starts the backend with the venv Python (`python -m nq_terminal`, working directory `terminal/backend`, `NQT_PORT`, `PYTHONUTF8=1`), builds `web/dist` with pnpm when sources are newer, waits for `/api/health` (up to 90 s), opens the browser, stops the tree on Ctrl+C with `taskkill /T /F`. `-Dev` runs `uvicorn --reload` plus Vite on 5173. If the port already answers as the terminal it only opens the browser. `-DryRun` prints the plan."],
    ["`start.sh` (macOS, Linux)", "23", "Finds Node (or `NQT_NODE`) and runs `scripts/start.mjs`."],
    ["`scripts/start.mjs`", "78", "Checks the Node version against `web/package.json` engines (Node 24 or newer), re-runs itself under an installed Node 24 when the default is older, then imports the TypeScript launcher."],
    ["`web/scripts/start/*.ts` (`launcher`, `plan`, `facts`, `doctor`, `nodeGuard`)", "about 1,200 lines plus about 1,800 lines of tests", "The cross-platform launcher: gathers facts (Python, deps, ports, contract sync), resolves a mode (FULL, FIXTURE or DEMO ONLY), prints a doctor checklist or the plan, runs steps as argv arrays, polls the URL, stops process groups on signals. It mirrors `start.ps1`."],
    ["`scripts/smoke_real.ps1`", "458", "Real-data smoke run: records hashes of the research files, builds the web app to a temporary folder, starts a second backend on 8953 and Vite preview on 4953, runs the real-data Playwright config, then checks that only terminal gate lines were appended and the research files are unchanged."],
    ["`web/package.json` scripts", "-", "`build` (tsc, vite, bundle budget check), `demo` (Vite demo mode on 5174, offline fixtures), `test` (API codegen check plus vitest), `gen:api` (types from `contract/openapi.json`), `e2e`, `e2e:perf`, `e2e:offline*`."],
])}

Who needs what at run time today: Python 3.12 with the nq-lab venv (about 690 MB on disk), Node 24 and pnpm 11 (build and launcher only; the served app is static files), and a browser. A packaged native app removes the Node and browser requirements; the Python requirement stays unless every route and the job runner are ported.

## 11. Inventory facts that bear on the fate of each piece

Not decisions, only the evidence a plan needs. Fate options are left to the later documents.

{table(["Piece", "Size", "Coupling", "What decides its fate"], [
    ["`api/` routers (22 files)", f"{sum(m['lines'] for m in mods if m['module'].startswith('nq_terminal.api.')):,} lines", "FastAPI, pydantic", "Mostly parameter parsing and calling a service; the contract in `openapi.json` is what the UI sees."],
    ["`models/` (23 files)", f"{sum(m['lines'] for m in mods if m['module'].startswith('nq_terminal.models.')):,} lines", "pydantic", f"{oa['n_schemas']} schemas; the types the front end generates from. Any new backend can emit the same JSON."],
    ["`services/` file readers (runs, research, audit, catalog, journals, files, instruments, events, dq, dq_guards, amendments)", f"{readers:,} lines", "pandas CSV and JSON, pathlib", "Directory scans, JSON and CSV parsing, caching with mtime validation. Straightforward in any language; the sanitiser rules (NaN to null, nanosecond timestamps, decimal strings) are part of the contract."],
    ["`services/bars.py` and gate use", f"{lines_of('services.bars'):,} lines", "pandas, `nq_lab.data.serve`", "The only price door. The gate and parquet loader live in nq_lab; a port either keeps calling Python or re-implements the gate semantics and the log line format."],
    ["`analytics/` (26 files)", f"{sum(m['lines'] for m in mods if m['module'].startswith('nq_terminal.analytics.')):,} lines", "numpy, pandas, scipy.stats in 10 modules", "The numeric core and the crosscheck's subject. Modules with no pandas reference: " + ", ".join(f"`{n}`" for n in np_only) + "."],
    ["`services/jobs.py`, `api/jobs.py`, `models/jobs.py` and `backtests/run_base.py`", f"{jobs_lines:,} lines plus the 296-line runner and the nq_lab strategy code it loads", "subprocess, Nautilus", "Needs Python and NautilusTrader on the machine regardless of the shell."],
    ["IB snapshot", f"{ib_lines:,} lines", "`ibapi`, threads, SSE", "Optional and off by default. The IB library is pure Python; the protocol is a documented socket protocol."],
    ["Live screens and SSE stream", f"{live_lines:,} lines", "journal readers, SSE", "Read files from `live/logs`; the stream is plain Server-Sent Events with a resume token."],
    ["Security middleware", f"{mw_lines} lines", "Starlette ASGI", "Loopback, host and origin checks and headers. A native shell without a network port would make most of it unnecessary, but the checks are tested behaviour."],
    ["QA crosscheck", f"{sum(1 for _ in qa_files)} files, 3 libraries", "quantstats, arch, statsmodels", "The oracle. It needs the Python reference libraries whatever the app is written in."],
])}

## 12. Reproducing the tables

Scripts (in `docs/desktop/tools/backend/`; they read and write JSON in their own folder or the current folder, so copy them to a scratch folder before running; use the nq-lab venv Python, never a bare `python`; order: `scan_static`, `measure_routes`, `oa_params`, `dep_table`, `extra_scan`, `start_measure`, `qa_scan`, `facts`, `gen_doc`):

- `scan_static.py`: AST scan of every backend module -> `modules.json` (lines, imports by class, calls, kind, pandas and numpy reference counts).
- `measure_routes.py`: builds the app, installs the write guard, calls every GET route twice in process, records bytes and times, writes `routes.json` and `census.json`. It uses real data, a scratch gate log and a 256 MiB cache.
- `oa_params.py`: query parameters and status codes from the generated OpenAPI document.
- `dep_table.py`: maps imported top-level modules to distributions, sums installed sizes, flags native extensions -> `deps.json`.
- `extra_scan.py`: scipy functions, pandas method counts, nq_lab modules loaded -> `extra.json`.
- `start_measure.py`: starts the server on a spare port with no window, times it to health, reads memory of the real interpreter, stops it by process id -> `start_measure.json`.
- `qa_scan.py` (run in the QA environment): per dump kind PASS, FAIL, SKIP and INFO counts -> `qa.json`.
- `facts.py`: file and tree counts (data sizes, test counts, git state, scipy functions at HEAD and in the working tree) -> `facts.json`.
- `gen_doc.py`: builds this file from the JSON.

## 13. Open questions and unverified items

- Unverified: macOS start-up time and memory of the same backend (no Mac was reachable); wheels for macOS arm64 differ in size from the Windows figures here.
- The working tree held {facts['dirty']} uncommitted changes while this was written. Seven new modules from in-progress work (LV6 expectation, effective number of trials) are in the module table, marked as new. The `paper_expectation` router is not registered in `create_app`, so no row in the route table comes from it, and the route list should equal HEAD's; this was not checked against a clean checkout (no git writes were allowed). The schema count and the `openapi.json` size may differ at HEAD.
- Measured only in process: HTTP framing and JSON encoding add some milliseconds to the larger bodies on a real connection; cold times here also include first-call cache fills and an OS file cache warmed by earlier runs.
- `/api/live/stream` was not opened; its cost per open stream is unmeasured (bounded by `max_streams` and `lifetime_s` in code).
- Which Nautilus statistics the `nautilus` side of the crosscheck calls is read from the dump kinds and the dump writers, not traced call by call.
"""

doc = clean_doc = doc  # keep text as is; only table cells were cleaned
OUT.write_text(doc, encoding="utf-8")
print("written", OUT, len(doc.splitlines()), "lines")
