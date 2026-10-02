"""Shared helpers for the WebView2 spike: process trees, memory snapshots, backend launch."""
import hashlib, http.client, os, subprocess, sys, time
import psutil

HOME = r"C:\Users\Fatih Hekimoglu"
ROOT = HOME + r"\nq-lab"
TERMINAL = ROOT + r"\terminal"
BACKEND = TERMINAL + r"\backend"
BACKEND_TESTS = BACKEND + r"\tests"
FIXTURES = BACKEND_TESTS + r"\fixtures"
DIST = TERMINAL + r"\web\dist"
LAB_PY = ROOT + r"\.venv\Scripts\python.exe"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 8793
NO_WINDOW = 0x08000000
MACHINE_SETTINGS = ["NQT_IB_READONLY", "IB_HOST", "IB_PORT", "IB_ACCOUNT_ID", "IB_BASE_USD_RATE", "IB_PAPER_DELAYED_DATA", "VOLMAN_C"]


def dist_hash():
    return hashlib.sha256(open(DIST + r"\index.html", "rb").read()).hexdigest()[:16]


def backend_cmd(mode):
    if mode == "fixture":
        return [LAB_PY, "-m", "uvicorn", "fixture_app:app", "--app-dir", BACKEND_TESTS, "--host", "127.0.0.1", "--port", str(PORT)]
    return [LAB_PY, "-m", "nq_terminal"]


def backend_env(mode):
    env = os.environ.copy()
    for k in MACHINE_SETTINGS:
        env[k] = ""
    env["NQT_PORT"] = str(PORT)
    env["PYTHONUTF8"] = "1"
    if mode == "fixture":
        env["NQT_FIXTURE_DIR"] = FIXTURES
        env["NQT_FIXTURE_JOBS"] = "fake"
    else:
        env.pop("NQT_FIXTURE_DIR", None)
    return env


def health_ok(port=PORT, path="/api/health"):
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        c.request("GET", path)
        r = c.getresponse()
        r.read()
        c.close()
        return r.status == 200
    except Exception:
        return False


def start_backend(mode):
    """Returns (Popen, seconds from spawn to the first 200 on /api/health)."""
    assert not health_ok(), "spare port already answers"
    t0 = time.perf_counter()
    p = subprocess.Popen(backend_cmd(mode), cwd=BACKEND, env=backend_env(mode), creationflags=NO_WINDOW,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while time.perf_counter() - t0 < 120:
        if health_ok():
            return p, time.perf_counter() - t0
        if p.poll() is not None:
            raise RuntimeError("backend exited early")
        time.sleep(0.005)
    raise RuntimeError("backend never answered")


def tree(pid):
    try:
        root = psutil.Process(pid)
        return [root] + root.children(recursive=True)
    except psutil.NoSuchProcess:
        return []


def kill_tree(pid):
    procs = tree(pid)
    for p in reversed(procs):
        try:
            p.kill()
        except Exception:
            pass
    psutil.wait_procs(procs, timeout=10)


def kind_of(p):
    try:
        name = p.name().lower()
        if name in ("conhost.exe",):
            return "conhost"
        cmd = " ".join(p.cmdline())
        if "--type=" in cmd:
            return cmd.split("--type=")[1].split()[0]
        if name.startswith("msedge"):
            return "browser"
        return name
    except Exception:
        return "?"


def snapshot(pid):
    """Per-process working set (rss) and private working set (uss) of a process tree, MB."""
    rows = []
    for p in tree(pid):
        try:
            mi = p.memory_info()
            try:
                uss = p.memory_full_info().uss
            except Exception:
                uss = None
            rows.append({"pid": p.pid, "name": p.name(), "kind": kind_of(p), "rss": mi.rss / 2**20,
                         "uss": None if uss is None else uss / 2**20, "commit": mi.private / 2**20})
        except psutil.NoSuchProcess:
            pass
    return rows


def summarize(rows, host_names):
    """Totals excluding conhost: host (by name) versus engine (everything else), in MB."""
    real = [r for r in rows if r["kind"] != "conhost"]
    host = [r for r in real if r["name"].lower() in host_names]
    eng = [r for r in real if r["name"].lower() not in host_names]
    f = lambda rs, k: round(sum(x[k] or 0 for x in rs), 1)
    rend = sorted([x for x in real if x["kind"] == "renderer"], key=lambda x: -x["rss"])
    top = {"rss": round(rend[0]["rss"], 1), "uss": round(rend[0]["uss"] or 0, 1)} if rend else None
    return {"top_renderer": top, "procs": len(real), "rss_total": f(real, "rss"), "uss_total": f(real, "uss"), "commit_total": f(real, "commit"),
            "host_rss": f(host, "rss"), "host_uss": f(host, "uss"),
            "engine_rss": f(eng, "rss"), "engine_uss": f(eng, "uss"), "engine_procs": len(eng),
            "by_kind": {k: {"n": sum(1 for x in real if x["kind"] == k), "rss": f([x for x in real if x["kind"] == k], "rss"),
                            "uss": f([x for x in real if x["kind"] == k], "uss")} for k in sorted({x["kind"] for x in real})}}
