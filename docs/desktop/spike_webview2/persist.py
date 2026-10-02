"""localStorage persistence across two launches of the same WebView2 profile folder (wv2 host)."""
import json, os, shutil, time
import bench_browser as b
from cdp import CDP
from common import *

profile = os.path.join(b.SPIKE_DIR, "wv2-persist")
shutil.rmtree(profile, ignore_errors=True)
backend, t = start_backend("fixture")
res = []
try:
    for launch_no in (1, 2):
        port = b.next_port()
        host = b.launch("wv2", profile, port)
        try:
            tgt = b.wait_target(port, host)
            c = CDP(tgt["webSocketDebuggerUrl"])
            c.call("Page.enable"); c.call("Runtime.enable")
            c.call("Page.navigate", {"url": b.URL})
            c.wait("document.readyState === 'complete'", 30)
            if launch_no == 1:
                v = c.eval("localStorage.setItem('spike.persist', 'kept-123'); localStorage.getItem('spike.persist')")
                c.eval("document.cookie = 'spike=1; max-age=3600'")
            else:
                v = c.eval("localStorage.getItem('spike.persist')")
            if launch_no == 1:
                c.pump(10.0)
            res.append({"launch": launch_no, "localStorage": v, "cookie": c.eval("document.cookie")})
            c.close()
        finally:
            kill_tree(host.pid)
        time.sleep(1.5)
finally:
    kill_tree(backend.pid)
    shutil.rmtree(profile, ignore_errors=True)
print(json.dumps(res))
open(os.path.join(b.HERE, "out", "persist.json"), "w").write(json.dumps(res))
