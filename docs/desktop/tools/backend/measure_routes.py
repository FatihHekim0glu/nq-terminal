"""Import census and a read-only sweep of every GET route of the terminal app, in process (no port), on real data.

Safety: an audit hook refuses any write-mode open under data/, results/ or live/ (the one write path the terminal
could reach, the OOS access log, is redirected to a scratch file); NQT_IB_READONLY is removed; POST/DELETE are never
called; /api/live/stream is not opened (SSE). Writes routes.json and census.json next to this file.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import functools
import inspect
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
LAB = Path(r"C:\Users\Fatih Hekimoglu\nq-lab")
PROTECTED = [str((LAB / p).resolve()).lower() for p in ("data", "results", "live")]
VIOLATIONS: list[str] = []


def _hook(event: str, args: tuple) -> None:
    if event == "open" and len(args) >= 3:
        path, mode, flags = args[0], args[1], args[2]
        if not isinstance(path, (str, bytes, os.PathLike)):
            return
        writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
            isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND))
        if not writing:
            return
        try:
            p = str(Path(os.fsdecode(path)).resolve()).lower()
        except Exception:
            return
        if any(p.startswith(q) for q in PROTECTED):
            VIOLATIONS.append(p)
            raise PermissionError(f"measurement refuses a write under a protected folder: {p}")


sys.addaudithook(_hook)
os.environ.pop("NQT_IB_READONLY", None)
os.environ["NQT_CACHE_BYTES"] = str(256 * 1024 * 1024)
sys.path.insert(0, str(LAB / "terminal" / "backend"))


class PMC(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


def mem() -> dict:
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    p = ctypes.WinDLL("psapi", use_last_error=True)
    k.GetCurrentProcess.restype = ctypes.c_void_p
    p.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wt.DWORD]
    c = PMC()
    c.cb = ctypes.sizeof(c)
    p.GetProcessMemoryInfo(k.GetCurrentProcess(), ctypes.byref(c), c.cb)
    mb = 1024 * 1024
    return {"working_set_mb": round(c.WorkingSetSize / mb, 1), "peak_working_set_mb": round(c.PeakWorkingSetSize / mb, 1),
            "private_mb": round(c.PagefileUsage / mb, 1)}


census: dict = {"mem_start": mem()}
before = set(sys.modules)
t0 = time.perf_counter()
from nq_lab import oos_gate  # noqa: E402

oos_gate.serve_bars = functools.partial(oos_gate.serve_bars, log_path=HERE / "scratch_oos.jsonl")
from nq_terminal.app import create_app  # noqa: E402

census["import_app_s"] = round(time.perf_counter() - t0, 3)
t1 = time.perf_counter()
app = create_app()
census["create_app_s"] = round(time.perf_counter() - t1, 3)
census["mem_after_create_app"] = mem()
census["modules_after_create_app"] = sorted(set(sys.modules) - before)

from fastapi.routing import iter_route_contexts  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 50000))


def get(path: str):
    t = time.perf_counter()
    r = client.get(path)
    return r, (time.perf_counter() - t) * 1000


def first(path: str, key=None):
    r, _ = get(path)
    j = r.json()
    return j[key] if key else j


hyps = first("/api/hypotheses")
runs = first("/api/runs")
readable = [r for r in runs if r.get("readable")]
big = max(readable, key=lambda r: r.get("n_trades") or 0)
hyp = hyps[0]["name"]
run_id = readable[0]["run_id"]
run2 = readable[1]["run_id"]
sealed = first("/api/sealed")[0]["name"]
qa_name = first("/api/qa", "reports")[0]["name"]
dq_symbol = first("/api/dq/symbols", "symbols")[0]["symbol"]
live_files = [j["name"] for j in first("/api/live/status", "journals")]
rd = first(f"/api/runs/{run_id}")
census["run_detail_keys"] = list(rd) if isinstance(rd, dict) else str(type(rd))
sample = {"name": hyp, "run_id": run_id, "root": "NQ", "symbol": dq_symbol, "job_id": "none", "section": "stdout",
          "sidecar_name": "none"}
census["samples"] = {"hypothesis": hyp, "run": run_id, "big_run": big["run_id"], "big_run_trades": big.get("n_trades"),
                     "sealed": sealed, "qa": qa_name, "dq_symbol": dq_symbol, "n_hypotheses": len(hyps),
                     "n_runs": len(runs), "n_readable_runs": len(readable)}

extra_query = {
    "/api/live/log": "file=" + (live_files[0] if live_files else "x"),
    "/api/runs/compare": f"ids={run_id},{run2}",
    "/api/runs/stats": f"ids={run_id},{run2}",
    "/api/market/pair-corr": "a=NQ.V.0&b=ES.V.0",
    "/api/market/rv": "symbol=NQ.V.0",
    "/api/market/vcone": "symbol=NQ.V.0",
}
variants = {
    "/api/bars": ["symbol=NQ.V.0&timeframe=1d", "symbol=NQ.V.0&timeframe=1m&start=2021-12-01&end=2021-12-31"],
}
URL_OVERRIDE = {
    "/api/sealed/{name}": "/api/sealed/" + sealed,
    "/api/qa/{name}": "/api/qa/" + qa_name,
    "/api/runs/{run_id}/log/{section}": f"/api/runs/{run_id}/log/snapshots",
    "/api/runs/{run_id}/sidecar/{name}": "/api/runs/nt_dtsmom_v0_ts1/sidecar/compare_screen",
    "/api/jobs/{job_id}": "/api/jobs/" + first("/api/jobs", "jobs")[0]["id"],
}
extra_query["/api/live/log"] = "file=preflight1_2026-09-26_PLUMBING_DELAYED.log"
SKIP = {"/api/live/stream": "SSE stream, not opened by this sweep"}
rows = []
for ctx in iter_route_contexts(app.routes):
    methods = sorted(ctx.methods or [])
    path = ctx.path or "?"
    ep = getattr(ctx.original_route, "endpoint", None)
    if ep is None:
        continue
    row = {"methods": methods, "path": path, "handler": f"{ep.__module__}.{ep.__name__}",
           "is_async": bool(inspect.iscoroutinefunction(ep)),
           "response_model": str(getattr(ctx.original_route, "response_model", None)),
           "response_class": getattr(getattr(ctx.original_route, "response_class", None), "__name__", None),
           "doc": (ep.__doc__ or "").strip().split("\n")[0][:160]}
    rows.append(row)
    if methods not in (["GET"], ["GET", "HEAD"]):
        row["measured"] = "not called (write route)"
        continue
    if path in SKIP:
        row["measured"] = SKIP[path]
        row["streaming"] = True
        continue
    url = path
    for k, v in sample.items():
        url = url.replace("{%s}" % k, v)
    url = URL_OVERRIDE.get(path, url)
    results = []
    known = {m.split(".")[0] for m in sys.modules}
    for q in variants.get(path, [extra_query.get(path, "")]):
        full = url + ("?" + q if q else "")
        try:
            r, ms1 = get(full)
            _, ms2 = get(full)
            results.append({"url": full, "status": r.status_code, "bytes": len(r.content), "cold_ms": round(ms1, 1),
                            "warm_ms": round(ms2, 1), "content_type": r.headers.get("content-type", "")})
        except Exception as exc:  # noqa: BLE001
            results.append({"url": full, "error": f"{type(exc).__name__}: {exc}"[:200]})
    row["measured"] = results
    row["new_top_modules"] = sorted({m.split(".")[0] for m in sys.modules} - known - {"_" + x for x in ()})
    row["nq_lab_modules_new"] = []
census["mem_after_sweep"] = mem()
census["write_violations"] = VIOLATIONS
census["modules_after_sweep"] = sorted(set(sys.modules) - before)
(HERE / "routes.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
(HERE / "census.json").write_text(json.dumps(census, indent=1), encoding="utf-8")
print("routes", len(rows), "violations", VIOLATIONS, census["mem_after_sweep"])
