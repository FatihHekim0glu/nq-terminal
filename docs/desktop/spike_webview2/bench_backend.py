"""Backend cold start to the first 200 and resident memory, 5 runs per mode."""
import json, statistics, sys, time
import psutil
from common import *

def one(mode):
    psutil.cpu_percent(None)
    p, dt = start_backend(mode)
    try:
        s0 = summarize(snapshot(p.pid), {"python.exe"})
        time.sleep(3)
        s1 = summarize(snapshot(p.pid), {"python.exe"})
        cpu = psutil.cpu_percent(None)
    finally:
        kill_tree(p.pid)
    time.sleep(1.0)
    return {"mode": mode, "to_200_s": round(dt, 3), "at_200": s0, "idle3s": s1, "sys_cpu_pct": cpu}

if __name__ == "__main__":
    out = []
    for i in range(5):
        for mode in ("fixture", "real"):
            r = one(mode); r["i"] = i + 1; out.append(r)
            print(json.dumps({k: r[k] for k in ("mode", "i", "to_200_s", "sys_cpu_pct")}), r["idle3s"]["rss_total"], r["idle3s"]["uss_total"], r["idle3s"]["procs"], flush=True)
    json.dump(out, open("out/backend_coldstart.json", "w"), indent=1)
    for mode in ("fixture", "real"):
        xs = [r["to_200_s"] for r in out if r["mode"] == mode]
        print(mode, "median to_200", statistics.median(xs), "min", min(xs), "max", max(xs))
