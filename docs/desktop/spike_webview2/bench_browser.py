"""WebView2 (pywebview, hidden) versus headless Edge: HOME first render, five heavy screens, memory, feature checks."""
import datetime, http.client, json, os, shutil, statistics, subprocess, sys, time
import psutil
from cdp import CDP, CDPError, list_targets
from common import *
import pagejs

URL = f"http://127.0.0.1:{PORT}/"
SPIKE_DIR = r"D:\dev\spike-wv2-s"
HERE = os.path.dirname(os.path.abspath(__file__))
RUN_FILLS = "nt_dtsmom_v0_fixture_ts1"
RUN_EQ = "nt_volmanaged_v0_fixture_m1"
ROOTS = ['ES','NQ','YM','ZT','ZF','ZN','ZB','6E','6J','6B','6A','6C','6S','CL','NG','HO','RB','GC','SI','HG','ZC','ZS','ZW','ZL','ZM','LE','HE']
FILLS = 8411
_port = [9370]


def fills_body(url):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(url).query)
    offset = int(q.get("offset", ["0"])[0]); limit = int(q.get("limit", ["500"])[0])
    first = int(datetime.datetime(2012, 1, 4, tzinfo=datetime.timezone.utc).timestamp())
    items = []
    for i in range(offset, min(offset + limit, FILLS)):
        root = ROOTS[i % len(ROOTS)]; day = first + (i // len(ROOTS)) * 86400 * 7
        qty = 1 + (i * 37) % 180
        items.append({"ts": datetime.datetime.fromtimestamp(day, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + ".000000000Z",
                      "ts_epoch_s": day, "instrument": f"{root}.XCME", "side": "SELL" if i % 3 == 0 else "BUY", "qty": qty,
                      "px": round((100 + ((i * 7919) % 400000) / 100) * 100) / 100, "commission": f"{qty * 7.5:.4f}",
                      "commission_float": qty * 7.5, "position_id": f"DtsMom-{i // 54:03d}-{root}-L1", "order_id": f"O-{i}",
                      "tags": "ROLL" if i % 5 == 0 else "REBAL"})
    return json.dumps({"items": items, "offset": offset, "limit": limit, "total": FILLS}).encode()


def next_port():
    _port[0] += 1
    return _port[0]


def launch(kind, profile, port):
    os.makedirs(profile, exist_ok=True)
    if kind == "wv2":
        cmd = [sys.executable, os.path.join(HERE, "host_wv2.py"), "about:blank", str(port), profile, "1"]
    else:
        cmd = [EDGE, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "--no-first-run",
               "--no-default-browser-check", "--window-size=1600,900", "about:blank"]
    return subprocess.Popen(cmd, creationflags=NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_target(port, host, timeout=60):
    end = time.perf_counter() + timeout
    while time.perf_counter() < end:
        if host.poll() is not None:
            raise RuntimeError("host exited early")
        try:
            pages = [t for t in list_targets(port) if t["type"] == "page"]
            if pages:
                return pages[0]
        except Exception:
            pass
        time.sleep(0.02)
    raise RuntimeError("no page target")


def ps(cmd):
    r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", cmd], capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
    return r.stdout.strip()


def clipboard_guard():
    """Returns (can_test, saved_text_or_None, reason)."""
    fm = ps("Add-Type -AssemblyName System.Windows.Forms; $d=[Windows.Forms.Clipboard]::GetDataObject(); if($d){($d.GetFormats() -join ',')}")
    formats = {f for f in fm.split(",") if f}
    textish = {"Text", "UnicodeText", "System.String", "OEMText", "Locale"}
    if formats - textish:
        return False, None, "clipboard holds non-text formats; test skipped to leave it intact"
    saved = ps("Get-Clipboard -Raw") if formats else None
    return True, saved, "ok"


def clipboard_restore(saved):
    if saved is None:
        ps("Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::Clear()")
    else:
        subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", "$input | Set-Clipboard"], input=saved, text=True, timeout=30, creationflags=NO_WINDOW)


FEATURES_JS = r"""
(async () => {
  const out = {};
  out.secure = isSecureContext; out.crossOriginIsolated = crossOriginIsolated; out.sharedArrayBuffer = typeof SharedArrayBuffer;
  out.webassembly = typeof WebAssembly; out.hwc = navigator.hardwareConcurrency; out.ua = navigator.appVersion;
  try { out.wasmSimd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])); } catch (e) { out.wasmSimd = String(e); }
  out.resources = performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname).filter((p) => /worker|\.wasm$/i.test(p));
  try { out.lsPrev = localStorage.getItem('spike.ls'); localStorage.setItem('spike.ls', 'v' + Date.now()); out.lsRoundTrip = localStorage.getItem('spike.ls') !== null; } catch (e) { out.ls = String(e); }
  try { out.idb = await new Promise((res, rej) => { const r = indexedDB.open('spike'); r.onsuccess = () => { r.result.close(); res(true); }; r.onerror = () => rej(r.error); }); } catch (e) { out.idb = String(e); }
  out.sse = await new Promise((resolve) => {
    const t = performance.now(); const es = new EventSource('/api/live/stream'); const seen = [];
    const fin = (ok) => { es.close(); resolve({ ok, helloMs: ok ? performance.now() - t : null, events: seen }); };
    for (const k of ['hello', 'status', 'kill_switch', 'heartbeat']) es.addEventListener(k, () => { seen.push(k); if (k === 'hello') fin(true); });
    es.onerror = () => seen.push('error');
    setTimeout(() => fin(false), 10000);
  });
  out.clipboardApi = { present: typeof navigator.clipboard, writeText: typeof (navigator.clipboard && navigator.clipboard.writeText), clipboardItem: typeof ClipboardItem,
    pngSupported: typeof ClipboardItem !== 'undefined' && ClipboardItem.supports ? ClipboardItem.supports('image/png') : null };
  try { out.permClipboardWrite = (await navigator.permissions.query({ name: 'clipboard-write' })).state; } catch (e) { out.permClipboardWrite = String(e); }
  out.visibility = document.visibilityState; out.hasFocus = document.hasFocus(); out.inner = [innerWidth, innerHeight, devicePixelRatio];
  out.fonts = document.fonts.status;
  return out;
})()
"""

FKEY_LOGGER = r"window.__fk = []; window.addEventListener('keydown', (e) => { if (/^F\d+$/.test(e.key)) window.__fk.push([e.key, e.defaultPrevented]); });"
WRITE_CLIP = r"(async () => { try { await Promise.race([navigator.clipboard.writeText('nqt-spike-clip'), new Promise((_, r) => setTimeout(() => r(new Error('timeout 5s')), 5000))]); return 'ok'; } catch (e) { return 'error: ' + e.name + ' ' + e.message; } })()"


def run_line(c, line, shift=False):
    c.key("k", "KeyK", 75, modifiers=2)
    c.wait("document.activeElement && document.activeElement.getAttribute('role') === 'combobox'", 8)
    c.call("Input.insertText", {"text": line})
    c.eval("window.__t0 = null")
    c.key("Enter", "Enter", 13, modifiers=8 if shift else 0, text="\r")
    return c.eval(pagejs.WAIT_SCREEN % json.dumps(line), await_promise=True, timeout=60)


def run_once(kind, profile, label, features=False, clip=False, keep_profile=False):
    host_names = {"python.exe"} if kind == "wv2" else set()
    rec = {"kind": kind, "label": label, "started": datetime.datetime.now().isoformat(timespec="seconds")}
    psutil.cpu_percent(None)
    port = next_port()
    t_spawn = time.perf_counter()
    host = launch(kind, profile, port)
    c = None
    try:
        tgt = wait_target(port, host)
        rec["host_ready_s"] = round(time.perf_counter() - t_spawn, 3)
        c = CDP(tgt["webSocketDebuggerUrl"])
        for m in ("Page.enable", "Runtime.enable", "Log.enable"):
            c.call(m)
        c.call("Emulation.setDeviceMetricsOverride", {"width": 1600, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        c.call("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}, {"name": "prefers-color-scheme", "value": "dark"}]})
        c.call("Emulation.setFocusEmulationEnabled", {"enabled": True})
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source": pagejs.PROBE})
        c.fills = fills_body; c.fills_pattern = f"/api/runs/{RUN_FILLS}/fills"
        c.call("Fetch.enable", {"patterns": [{"urlPattern": f"*/api/runs/{RUN_FILLS}/fills*", "requestStage": "Request"}]})
        c.pump(2.0)
        rec["blank_page"] = summarize(snapshot(host.pid), host_names)
        rec["blank_visibility"] = c.eval("document.visibilityState")
        t_nav = time.perf_counter()
        c.call("Page.navigate", {"url": URL})
        c.wait("performance.getEntriesByName('nqt:home-ready').length > 0", 60, poll=0.02)
        rec["home_wall_ms"] = round((time.perf_counter() - t_nav) * 1000)
        try:
            c.wait("performance.getEntriesByName('nqt:home-settled').length > 0", 15, poll=0.05)
        except CDPError:
            pass
        marks = json.loads(c.eval("JSON.stringify(performance.getEntriesByType('mark').filter(m => m.name.startsWith('nqt:')).map(m => [m.name, m.startTime]))"))
        rec["home_marks_ms"] = {k: round(v, 1) for k, v in marks}
        nav = json.loads(c.eval("JSON.stringify(performance.getEntriesByType('navigation')[0])"))
        rec["nav"] = {k: round(nav[k], 1) for k in ("responseEnd", "domInteractive", "domContentLoadedEventEnd", "loadEventEnd") if k in nav}
        paints = json.loads(c.eval("JSON.stringify(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]))"))
        rec["paint_ms"] = {k: round(v, 1) for k, v in paints}
        rec["panels_home"] = c.eval("document.querySelectorAll('[data-nqt-panel]').length")
        c.pump(3.0)
        rec["after_open"] = summarize(snapshot(host.pid), host_names)
        rec["heap_after_open_mb"] = round(c.eval("performance.memory.usedJSHeapSize / 1048576"), 1)
        steps = []
        r = run_line(c, f"{RUN_FILLS} RUN"); steps.append({"step": "RUN open", **r})
        p = c.eval(pagejs.PIVOT % json.dumps(RUN_FILLS), await_promise=True, timeout=90)
        steps.append({"step": "1 Perspective pivot, 8411 fills", "domMs": p["total"], "pivot": p})
        for name, line in (("2 uPlot (RR)", f"{RUN_EQ} RR"), ("3 ECharts (CORR)", "27F CORR"), ("4 lightweight-charts (GIP)", "NQ GIP 2011-01-20")):
            r = run_line(c, line); steps.append({"step": name, "line": line, **r})
        t_dock = time.perf_counter(); dock = []
        for line in ("NQ DES", "MT", "RUNS", "OOS", "LIVE", "volmanaged_v0 DES"):
            try:
                r = run_line(c, line, shift=True); dock.append({"line": line, "domMs": r["domMs"], "paintMs": r["paintMs"], "panels": r["panels"]})
            except Exception as e:
                dock.append({"line": line, "error": str(e)[:400]})
        steps.append({"step": "5 dockview, 6 extra panels", "wall_ms": round((time.perf_counter() - t_dock) * 1000), "panels": dock})
        rec["steps"] = steps
        lt = c.eval("window.__lt")
        rec["longtasks"] = {"count": len(lt), "total_ms": round(sum(d for _, d in lt)), "max_ms": round(max([d for _, d in lt] or [0]))}
        c.pump(3.0)
        rec["after_screens"] = summarize(snapshot(host.pid), host_names)
        rec["heap_after_screens_mb"] = round(c.eval("performance.memory.usedJSHeapSize / 1048576"), 1)
        rec["page_errors"] = c.eval("window.__errs")
        rec["console_errors"] = [str(e["params"])[:240] for e in c.events
                                 if (e.get("method") == "Log.entryAdded" and e["params"]["entry"]["level"] == "error") or e.get("method") == "Runtime.exceptionThrown"][:10]
        if features:
            f = c.eval(FEATURES_JS, await_promise=True, timeout=40)
            c.eval(FKEY_LOGGER)
            for i in range(12):
                c.key(f"F{i + 1}", f"F{i + 1}", 112 + i)
                c.pump(0.05)
            f["fkeys_seen_by_page"] = c.eval("window.__fk")
            try:
                tg = c.call("Target.getTargets").get("targetInfos", [])
                f["cdp_targets"] = sorted({t["type"] for t in tg})
            except CDPError as e:
                f["cdp_targets"] = f"n/a: {e}"
            if clip:
                ok, saved, why = clipboard_guard()
                if ok:
                    try:
                        f["clip_write"] = c.eval(WRITE_CLIP, await_promise=True, gesture=True, timeout=15)
                        f["clip_system_after"] = ps("Get-Clipboard -Raw")
                    finally:
                        clipboard_restore(saved)
                else:
                    f["clip_write"] = f"skipped: {why}"
            rec["features"] = f
        rec["sys_cpu_pct_avg"] = psutil.cpu_percent(None)
        rec["sys_mem_avail_mb"] = round(psutil.virtual_memory().available / 2**20)
        rec["ok"] = True
    except Exception as e:
        rec["ok"] = False; rec["error"] = f"{type(e).__name__}: {e}"[:500]
    finally:
        if c:
            c.close()
        kill_tree(host.pid)
        if not keep_profile:
            shutil.rmtree(profile, ignore_errors=True)
    return rec


def warm_home_api():
    def get(path):
        c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=120); c.request("GET", path); r = c.getresponse(); b = r.read(); c.close(); return r.status, b
    st, b = get("/api/market/universe?window=22"); rows = json.loads(b)["rows"]
    for p in ("/api/market/universe?window=252", "/api/data/catalog", "/api/market/rv?symbol=NQ.V.0&window=22"):
        get(p)
    for r in rows:
        get(f"/api/market/two-day?symbols={r['symbol']}")
    return len(rows)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    os.makedirs(SPIKE_DIR, exist_ok=True)
    out = open(os.path.join(HERE, "out", "runs.jsonl"), "a", encoding="utf-8")

    def emit(rec):
        out.write(json.dumps(rec) + "\n"); out.flush()
        hm = rec.get("home_marks_ms", {})
        print(rec["kind"], rec["label"], "ok" if rec.get("ok") else rec.get("error"), "home_ready", hm.get("nqt:home-ready"), "dom", hm.get("nqt:home-ready-dom"),
              "mem", rec.get("after_screens", {}).get("rss_total"), "cpu", rec.get("sys_cpu_pct_avg"), flush=True)

    meta = {"meta": True, "dist_hash_start": dist_hash(), "started": datetime.datetime.now().isoformat(timespec="seconds"),
            "cpu_logical": psutil.cpu_count(), "mem_avail_mb": round(psutil.virtual_memory().available / 2**20)}
    out.write(json.dumps(meta) + "\n"); out.flush()
    backend, t = start_backend("fixture")
    try:
        print("backend up", round(t, 2), flush=True)
        print("warm rows", warm_home_api(), flush=True)
        emit(run_once("edge", os.path.join(SPIKE_DIR, "edge-warmup"), "warmup-discard"))
        time.sleep(2)
        out.write(json.dumps({"backend_after_warmup": summarize(snapshot(backend.pid), {"python.exe"})}) + "\n")
        for kind in ("wv2", "edge"):
            emit(run_once(kind, os.path.join(SPIKE_DIR, f"{kind}-warm"), "prime-warm-discard", features=False, keep_profile=True))
        for i in range(1, n + 1):
            for kind in ("wv2", "edge"):
                emit(run_once(kind, os.path.join(SPIKE_DIR, f"{kind}-fresh-{i}"), f"fresh-{i}", features=(i == 1), clip=(i == 1)))
        for i in range(1, n + 1):
            for kind in ("wv2", "edge"):
                emit(run_once(kind, os.path.join(SPIKE_DIR, f"{kind}-warm"), f"warm-{i}", features=(i == 1), keep_profile=True))
        out.write(json.dumps({"backend_end": summarize(snapshot(backend.pid), {"python.exe"}), "dist_hash_end": dist_hash()}) + "\n")
    finally:
        kill_tree(backend.pid)
        out.close()
        for kind in ("wv2", "edge"):
            shutil.rmtree(os.path.join(SPIKE_DIR, f"{kind}-warm"), ignore_errors=True)
        shutil.rmtree(os.path.join(SPIKE_DIR, "edge-warmup"), ignore_errors=True)


if __name__ == "__main__":
    main()
