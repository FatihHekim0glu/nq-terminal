"""Minimal synchronous CDP client (websocket-client). Drives a host's page over its remote-debugging port."""
import base64, json, time, urllib.request
import websocket

class CDPError(RuntimeError):
    pass

def list_targets(port, timeout=2.0):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=timeout) as r:
        return json.loads(r.read())

class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
        self.n = 0
        self.fills = None          # bytes body for the synthetic fills route, or None
        self.fills_pattern = None
        self.events = []

    def _send(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        return self.n

    def _handle_event(self, msg):
        m = msg.get("method")
        if m == "Fetch.requestPaused":
            p = msg["params"]
            rid = p["requestId"]
            if self.fills is not None and self.fills_pattern in p["request"]["url"]:
                self._send("Fetch.fulfillRequest", {"requestId": rid, "responseCode": 200,
                    "responseHeaders": [{"name": "Content-Type", "value": "application/json"}],
                    "body": base64.b64encode(self.fills(p["request"]["url"])).decode()})
            else:
                self._send("Fetch.continueRequest", {"requestId": rid})
        else:
            self.events.append(msg)

    def call(self, method, params=None, timeout=60):
        mid = self._send(method, params)
        end = time.perf_counter() + timeout
        while True:
            self.ws.settimeout(max(0.05, end - time.perf_counter()))
            try:
                raw = self.ws.recv()
            except websocket.WebSocketTimeoutException:
                raise CDPError(f"timeout waiting for {method}")
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise CDPError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            if "method" in msg:
                self._handle_event(msg)

    def pump(self, seconds):
        end = time.perf_counter() + seconds
        while time.perf_counter() < end:
            self.ws.settimeout(max(0.01, end - time.perf_counter()))
            try:
                msg = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                return
            if "method" in msg:
                self._handle_event(msg)

    def eval(self, expr, await_promise=False, gesture=False, timeout=60):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                      "awaitPromise": await_promise, "userGesture": gesture}, timeout=timeout)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise CDPError(f"js: {d.get('text')} {d.get('exception', {}).get('description', '')}"[:600])
        return r.get("result", {}).get("value")

    def wait(self, expr, timeout=30, poll=0.05):
        end = time.perf_counter() + timeout
        while time.perf_counter() < end:
            v = self.eval(expr)
            if v:
                return v
            self.pump(poll)
        raise CDPError(f"timed out waiting for: {expr[:120]}")

    def key(self, key, code, vk, modifiers=0, text=None):
        base = {"modifiers": modifiers, "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
        if text is not None:
            self.call("Input.dispatchKeyEvent", {**base, "type": "keyDown", "text": text, "unmodifiedText": text})
        else:
            self.call("Input.dispatchKeyEvent", {**base, "type": "rawKeyDown"})
        self.call("Input.dispatchKeyEvent", {**base, "type": "keyUp"})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
