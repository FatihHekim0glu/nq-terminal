"""Start `python -m nq_terminal` on a spare port with no window, time it to /api/health, read its memory, stop it.

Only the process started here is stopped (by its own pid). Real data, but only routes that never reach the OOS gate
(verified: they leave no access-log line), so nothing is written under results/. IB stays off.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
LAB = Path(r"C:\Users\Fatih Hekimoglu\nq-lab")
PY = str(LAB / ".venv" / "Scripts" / "python.exe")
PORT = 48731
BASE_PORT = 48740
ROUTES = ["/api/health", "/api/hypotheses", "/api/runs", "/api/registry", "/api/commands", "/api/runs/nt_dtsmom_v0_lo0",
          "/api/data/catalog", "/api/qa", "/api/sealed", "/api/audit/oos-log", "/api/audit/openings", "/api/live/status",
          "/api/ledger", "/api/multiple-testing", "/api/runs/nt_dtsmom_v0_lo0/equity", "/api/runs/nt_dtsmom_v0_lo0/trades"]
CREATE_NO_WINDOW = 0x08000000


class PMC(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


def mem(pid: int) -> dict:
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    p = ctypes.WinDLL("psapi", use_last_error=True)
    k.OpenProcess.restype = ctypes.c_void_p
    k.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    p.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wt.DWORD]
    h = k.OpenProcess(0x0400 | 0x0010, False, pid)
    c = PMC()
    c.cb = ctypes.sizeof(c)
    p.GetProcessMemoryInfo(h, ctypes.byref(c), c.cb)
    k.CloseHandle(ctypes.c_void_p(h))
    mb = 1048576
    return {"working_set_mb": round(c.WorkingSetSize / mb, 1), "peak_working_set_mb": round(c.PeakWorkingSetSize / mb, 1),
            "commit_mb": round(c.PagefileUsage / mb, 1)}


def child_pid(parent: int) -> int:
    """The real interpreter: the venv python.exe is a launcher that starts the base interpreter as its child."""
    cmd = f"(Get-CimInstance Win32_Process -Filter 'ParentProcessId={parent}' | Where-Object {{ $_.Name -eq 'python.exe' }} | Sort-Object WorkingSetSize -Descending | Select-Object -First 1).ProcessId"
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=30,
                         creationflags=CREATE_NO_WINDOW).stdout.strip()
    return int(out) if out.isdigit() else parent


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def fetch(path: str):
    t = time.perf_counter()
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=60) as r:
        body = r.read()
    return len(body), (time.perf_counter() - t) * 1000


def one_run(index: int) -> dict:
    global PORT
    PORT = BASE_PORT + index
    assert port_free(PORT), f"port {PORT} is in use; not starting"
    env = {k: v for k, v in os.environ.items() if k != "NQT_IB_READONLY"}
    env["NQT_PORT"] = str(PORT)
    t0 = time.perf_counter()
    proc = subprocess.Popen([PY, "-m", "nq_terminal"], cwd=str(LAB / "terminal" / "backend"), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    out: dict = {"launcher_pid": proc.pid}
    real = proc.pid
    try:
        ready = None
        while time.perf_counter() - t0 < 60:
            try:
                fetch("/api/health")
                ready = time.perf_counter() - t0
                break
            except Exception:
                time.sleep(0.02)
        out["time_to_health_s"] = round(ready, 3) if ready else None
        real = child_pid(proc.pid)
        out["python_pid"] = real
        out["mem_launcher_stub"] = mem(proc.pid)
        out["mem_at_ready"] = mem(real)
        time.sleep(5)
        out["mem_idle_5s"] = mem(real)
        sizes = []
        for p in ROUTES:
            sizes.append((p, *fetch(p)))
        out["mem_after_16_routes"] = mem(real)
        out["route_ms_first"] = {p: round(ms) for p, _, ms in sizes}
        out["threads_note"] = "uvicorn single process, sync handlers on the anyio thread pool"
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=30,
                       creationflags=CREATE_NO_WINDOW)
    return out


runs = [one_run(i) for i in range(3)]
(HERE / "start_measure.json").write_text(json.dumps(runs, indent=1), encoding="utf-8")
for r in runs:
    print(r["time_to_health_s"], r["mem_at_ready"], r["mem_after_16_routes"])
