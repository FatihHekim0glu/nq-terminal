import json, statistics, sys
RUNS = sys.argv[1]
rows = [json.loads(l) for l in open(RUNS, encoding="utf-8")]
runs = [r for r in rows if "kind" in r]
other = [r for r in rows if "kind" not in r]
med = lambda xs: round(statistics.median(xs), 1) if xs else None
rng = lambda xs: (round(min(xs), 1), round(max(xs), 1)) if xs else None


def pick(rs, fn):
    out = []
    for r in rs:
        try:
            v = fn(r)
        except Exception:
            v = None
        if v is not None:
            out.append(v)
    return out


def step(r, prefix, key="paintMs"):
    for s in r["steps"]:
        if s["step"].startswith(prefix):
            if prefix.startswith("1"):
                return s["pivot"]["pivotOpenMs"] if key == "pivot" else s["domMs"]
            if prefix.startswith("5"):
                return s["wall_ms"]
            return s.get(key) if s.get(key) is not None else s.get("domMs")
    return None


METRICS = [
    ("host ready (s, spawn to page target)", lambda r: r["host_ready_s"]),
    ("HOME ready, painted (ms from nav start)", lambda r: r["home_marks_ms"]["nqt:home-ready"]),
    ("HOME ready, DOM only (ms)", lambda r: r["home_marks_ms"]["nqt:home-ready-dom"]),
    ("HOME frame, painted (ms)", lambda r: r["home_marks_ms"]["nqt:home-frame"]),
    ("first contentful paint (ms)", lambda r: r["paint_ms"]["first-contentful-paint"]),
    ("DOMContentLoaded end (ms)", lambda r: r["nav"]["domContentLoadedEventEnd"]),
    ("RUN open (ms)", lambda r: step(r, "RUN open")),
    ("1 Perspective: Show as Pivot grid (ms)", lambda r: step(r, "1 ", "pivot")),
    ("2 uPlot RR open (ms)", lambda r: step(r, "2 ")),
    ("3 ECharts CORR open (ms)", lambda r: step(r, "3 ")),
    ("4 lightweight-charts GIP open (ms)", lambda r: step(r, "4 ")),
    ("5 six more dockview panels (wall ms)", lambda r: step(r, "5 ")),
    ("long tasks, whole run (total ms)", lambda r: r["longtasks"]["total_ms"]),
    ("long tasks, max single (ms)", lambda r: r["longtasks"]["max_ms"]),
    ("JS heap after open (MB)", lambda r: r["heap_after_open_mb"]),
    ("JS heap after screens (MB)", lambda r: r["heap_after_screens_mb"]),
    ("procs after screens", lambda r: r["after_screens"]["procs"]),
    ("blank page: working set total (MB)", lambda r: r["blank_page"]["rss_total"]),
    ("blank page: private WS total (MB)", lambda r: r["blank_page"]["uss_total"]),
    ("after HOME: working set total (MB)", lambda r: r["after_open"]["rss_total"]),
    ("after HOME: private WS total (MB)", lambda r: r["after_open"]["uss_total"]),
    ("after 5 screens: working set total (MB)", lambda r: r["after_screens"]["rss_total"]),
    ("after 5 screens: private WS total (MB)", lambda r: r["after_screens"]["uss_total"]),
    ("after 5 screens: commit total (MB)", lambda r: r["after_screens"]["commit_total"]),
    ("after 5 screens: host process WS (MB)", lambda r: r["after_screens"]["host_rss"]),
    ("after 5 screens: engine processes WS (MB)", lambda r: r["after_screens"]["engine_rss"]),
    ("after 5 screens: engine processes private WS (MB)", lambda r: r["after_screens"]["engine_uss"]),
    ("after 5 screens: top renderer WS (MB)", lambda r: r["after_screens"]["top_renderer"]["rss"]),
    ("after 5 screens: top renderer private WS (MB)", lambda r: r["after_screens"]["top_renderer"]["uss"]),
    ("system CPU % over the run", lambda r: r["sys_cpu_pct_avg"]),
]

lines = []
for label in ("fresh", "warm"):
    lines.append(f"\n### {label} profile (median, [min, max], n)\n")
    lines.append("| metric | WebView2 (pywebview) | Edge headless |")
    lines.append("|---|---|---|")
    groups = {k: [r for r in runs if r["kind"] == k and r["label"].startswith(label + "-") and r.get("ok")] for k in ("wv2", "edge")}
    for name, fn in METRICS:
        cells = []
        for k in ("wv2", "edge"):
            xs = pick(groups[k], fn)
            cells.append(f"{med(xs)} {list(rng(xs)) if xs else ''} n={len(xs)}" if xs else "n/a")
        lines.append(f"| {name} | {cells[0]} | {cells[1]} |")
print("\n".join(lines))
print()
print("failed runs:", [(r["kind"], r["label"], r.get("error")) for r in runs if not r.get("ok")])
for o in other:
    print(json.dumps(o)[:600])
# first fresh run features
for r in runs:
    if r.get("features") and r["label"] == "fresh-1":
        print(r["kind"], "FEATURES", json.dumps(r["features"]))
for r in runs:
    if r.get("features") and r["label"] == "warm-1":
        print(r["kind"], "WARM-1 lsPrev", r["features"].get("lsPrev"))
errs = [(r["kind"], r["label"], r.get("page_errors"), r.get("console_errors")) for r in runs if r.get("page_errors") or r.get("console_errors")]
print("page/console errors:", errs[:6])
print("per-run home ready (painted):")
for r in runs:
    if r.get("ok"):
        print(" ", r["kind"], r["label"], r["home_marks_ms"].get("nqt:home-ready"), "cpu", r["sys_cpu_pct_avg"], "memavail", r["sys_mem_avail_mb"])
