"""A fake terminal backend for the shell's supervision tests (04 D4.3; 05 T08, T09 and G08).

The tests copy this file into a fake lab under D:/dev/tmp as `terminal/backend/nq_terminal/__main__.py` (and as
`nq_terminal/desktop/fixture_main.py`, and as `nq_terminal/fake_backend.py` for the worker process's target), so
the shell's exact spawn line `-E -s -X utf8 -X faulthandler -m nq_terminal` from `terminal/backend` runs it through
the lab's venv launcher. It never imports the real backend, reads no lab data and writes no file: everything it
reports goes to stdout, which the shell drains into backend.log (or a test reads through a pipe), one line each:

- `FAKE-RECORD {...}`: how it was started (argv, working folder, environment names, pid, parent pid, prefix, port);
- `FAKE-REQUEST {...}`: the path and every header of each request it receives (the G08 impostor's log);
- `access GET <path>`: an access line per request, as uvicorn prints, so a shell that stops draining blocks it.

It speaks the real contract: TOKEN and NONCE on stdin, one `NQT-READY` line whose proof is HMAC-SHA256 keyed by the
token's bytes over `ready|nonce|port|pid`, `/api/desktop/proof` answering `proof|nonce|port|pid`, `/api/session`
taking `Authorization: NQT <token>` and `X-NQT-Origin` for the cookie `nqt_s_<port>`, and `/api/health` and
`/api/jobs` behind that cookie. End of file on stdin ends it, as the real watchdog does.

`terminal/backend/fake_mode.json` (written by the test) bends it: `lie` (hmac, root, prefix, contract, dist,
pid_outside, listener), `outside_pid`, `report_port`, `noise_before` and `noise_after` (bytes of stray output around
the READY line), `late_nqt` (a later fake NQT- line), `grandchild` (a sleeping worker process started with
multiprocessing, standing in for a JOBS run), `exit_after_ready_s`, `exit_before_handshake` (an exit code, taken before stdin is read), `attach_line`, `running_jobs` and `contract`.
`proof_delay_s` holds back the answer to the first `proof_delay_count` proofs (1 when absent) by that many seconds, as a
backend whose first proof meets a slow first start does; `proof_lie` makes the proof route alone answer wrongly (`mac`:
a proof under another key; `foreign_pid`: the pid `outside_pid`) while the READY line stays honest.

Started by a test as `python -E -s <this file> --swapped <port>`, it is the G08 impostor: it binds the port of a
backend that has ended and reports every header it receives, without knowing any token.
"""
from __future__ import annotations

import ctypes
import hashlib
import hmac
import json
import multiprocessing
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.dont_write_bytecode = True

NOISE_LINE = b"fake backend noise: a line of stray output that is not a handshake " + b"x" * 60 + b"\n"
# The page asks /api/health once, so the request lines show whether the webview sends the session cookie.
HTML = (b"<!doctype html><html lang='en-GB'><head><title>fake</title></head><body><p>fake HOME</p>"
        b"<img src='/api/health' alt=''></body></html>")
OUT_LOCK = threading.Lock()
SLEEP_S = 120
GRANDCHILD_START_S = 20


def mac(token: str, kind: str, nonce: str, port: int, pid: int) -> str:
    message = f"{kind}|{nonce}|{int(port)}|{int(pid)}".encode("ascii")
    return hmac.new(bytes.fromhex(token), message, hashlib.sha256).hexdigest()


def load_mode() -> dict:
    path = Path.cwd() / "fake_mode.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def emit(data: bytes) -> None:
    with OUT_LOCK:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def report(kind: str, value: dict) -> None:
    emit(f"FAKE-{kind} {json.dumps(value, separators=(',', ':'))}\n".encode("utf-8"))


def noise(total: int) -> None:
    lines, rest = divmod(max(total, 0), len(NOISE_LINE))
    block = NOISE_LINE * 256
    for _ in range(lines // 256):
        emit(block)
    emit(NOISE_LINE * (lines % 256) + b"y" * max(rest - 1, 0) + (b"\n" if rest else b""))


def sleeper(started: object) -> None:
    """The JOBS stand-in: detached from the console it inherited (a real JOBS child gets its own), so that only a job
    can end it, never the teardown of its parent's console; it says so once it runs on its own."""
    ctypes.windll.kernel32.FreeConsole()
    started.set()
    time.sleep(SLEEP_S)


# ---------------------------------------------------------------- HTTP

class Fake:
    def __init__(self, mode: dict, token: str | None) -> None:
        self.mode, self.token = mode, token
        self.port, self.pid, self.session = 0, os.getpid(), None
        self.lab = Path.cwd().parent.parent
        self.proofs, self.proofs_lock = 0, threading.Lock()

    def proof_delay(self) -> float:
        """How long this proof's answer is held back: `proof_delay_s` for the first `proof_delay_count` proofs."""
        with self.proofs_lock:
            self.proofs += 1
            seen = self.proofs
        late = seen <= int(self.mode.get("proof_delay_count", 1))
        return float(self.mode.get("proof_delay_s", 0)) if late else 0.0

    def reported_pid(self) -> int:
        return int(self.mode.get("outside_pid", 0)) if self.mode.get("lie") == "pid_outside" else self.pid

    def identity(self) -> dict:
        lie = self.mode.get("lie")
        return {"root": r"C:\elsewhere\lab" if lie == "root" else str(self.lab),
                "prefix": r"C:\elsewhere\.venv" if lie == "prefix" else sys.prefix,
                "contract": 99 if lie == "contract" else int(self.mode.get("contract", 1))}


def handler_for(fake: Fake, swapped: bool) -> type:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002 (the base class's name)
            emit(f"access {self.command} {self.path}\n".encode("utf-8"))

        def _send(self, status: int, body: bytes, kind: str = "application/json", extra: tuple = ()) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            for name, value in extra:
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, value: dict, extra: tuple = ()) -> None:
            self._send(status, json.dumps(value).encode("utf-8"), extra=extra)

        def _cookie_ok(self) -> bool:
            wanted = f"nqt_s_{fake.port}={fake.session}"
            return fake.session is not None and wanted in (self.headers.get("Cookie") or "")

        def do_GET(self) -> None:  # noqa: N802 (the base class's name)
            report("REQUEST", {"pid": fake.pid, "path": self.path, "headers": dict(self.headers.items())})
            url = urlsplit(self.path)
            if url.path == "/api/desktop/proof":
                nonce = (parse_qs(url.query).get("nonce") or [""])[0]
                time.sleep(fake.proof_delay())
                self._json(200, proof_body(fake, nonce, swapped))
            elif url.path == "/api/session":
                self._session(swapped)
            elif url.path in ("/api/health", "/api/jobs"):
                self._behind_cookie(url.path)
            elif url.path == "/":
                self._send(200, HTML, "text/html; charset=utf-8")
            else:
                self._json(404, {"detail": "not found"})

        def _behind_cookie(self, path: str) -> None:
            if not self._cookie_ok():
                self._json(401, {"detail": "a session is required"})
            elif path == "/api/health":
                self._json(200, {"ok": True, "pid": fake.pid})
            else:
                self._json(200, self._jobs_body())

        def _jobs_body(self) -> dict:
            """`/api/jobs`: `jobs_pad` bytes of log tail in one record bulk the answer as a long history would."""
            pad = int(fake.mode.get("jobs_pad", 0))
            jobs = [{"id": "j_pad", "state": "done", "log_tail": "x" * pad}] if pad else []
            return {"jobs": jobs, "queued": 0, "running": int(fake.mode.get("running_jobs", 0))}

        def _session(self, swapped: bool) -> None:
            expected = f"NQT {fake.token}" if fake.token else None
            origin_ok = self.headers.get("X-NQT-Origin") == f"http://127.0.0.1:{fake.port}"
            if not swapped and (self.headers.get("Authorization") != expected or not origin_ok):
                self._json(401, {"detail": "not authorised"})
                return
            fake.session = secrets.token_hex(32)
            cookie = f"nqt_s_{fake.port}={fake.session}; HttpOnly; Path=/api; SameSite=strict"
            self._json(200, {"ok": True, "cookie": f"nqt_s_{fake.port}"}, extra=(("Set-Cookie", cookie),))

    return Handler


def proof_body(fake: Fake, nonce: str, swapped: bool) -> dict:
    lie = fake.mode.get("proof_lie")
    pid = int(fake.mode.get("outside_pid", 0)) if lie == "foreign_pid" else fake.reported_pid()
    key = secrets.token_hex(32) if swapped or lie == "mac" else fake.token
    proof = mac(key, "proof", nonce, fake.port, pid)
    return {"proof": proof, **fake.identity(), "pid": pid}


def serve(fake: Fake, port: int, swapped: bool) -> ThreadingHTTPServer:
    ThreadingHTTPServer.allow_reuse_address = swapped
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(fake, swapped))
    fake.port = server.server_address[1]
    threading.Thread(target=server.serve_forever, name="fake-http", daemon=True).start()
    return server


# ---------------------------------------------------------------- the start

def read_secrets() -> tuple[str, str]:
    values: dict[str, str] = {}
    while len(values) < 2:
        line = sys.stdin.buffer.readline()
        if not line:
            os._exit(0)
        name, _, value = line.decode("ascii", "replace").strip().partition(" ")
        values.setdefault(name, value.lower())
    return values["TOKEN"], values["NONCE"]


def watch_stdin() -> None:
    def run() -> None:
        while sys.stdin.buffer.readline():
            pass
        os._exit(0)  # the parent is gone: stop, as the real watchdog does
    threading.Thread(target=run, name="fake-stdin", daemon=True).start()


def grandchild() -> int:
    """A sleeping worker process, the stand-in for a JOBS backtest child (it inherits the job, as a real one does)."""
    # A worker's target must be importable by name, and a package's __main__ is not; the test lab carries this same
    # file as nq_terminal/fake_backend.py for that.
    from nq_terminal import fake_backend
    started = multiprocessing.Event()
    worker = multiprocessing.Process(target=fake_backend.sleeper, args=(started,), name="fake-jobs-child")
    worker.start()
    if not started.wait(GRANDCHILD_START_S):  # its start-up reads from this process: report it only once it runs
        raise RuntimeError("the JOBS stand-in did not start")
    return worker.pid


def record(fake: Fake, extra: dict) -> None:
    env = dict(os.environ)
    report("RECORD", {
        "orig_argv": list(getattr(sys, "orig_argv", sys.argv)), "cwd": str(Path.cwd()), "pid": os.getpid(),
        "ppid": os.getppid(), "executable": sys.executable, "prefix": sys.prefix, "env_names": sorted(env),
        "nqt": {k: v for k, v in env.items() if k.upper().startswith("NQT_")}, "port": fake.port, **extra})


def ready_line(fake: Fake, nonce: str) -> bytes:
    lie, pid = fake.mode.get("lie"), fake.reported_pid()
    port = int(fake.mode.get("report_port", fake.port)) if lie == "listener" else fake.port
    key = secrets.token_hex(32) if lie == "hmac" else fake.token
    ident = fake.identity()
    payload = {"v": 1, "port": port, "pid": pid, "proof": mac(key, "ready", nonce, port, pid),
               "root": ident["root"], "prefix": ident["prefix"], "nq_lab": str(fake.lab / "src" / "nq_lab"),
               "nq_terminal": str(Path(__file__).resolve().parent), "contract": ident["contract"],
               "openapi_sha256": "0" * 64, "dist": "stale" if lie == "dist" else "current", "mode": "desktop"}
    return b"NQT-READY " + json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\n"


def main_desktop() -> int:
    mode = load_mode()
    if "exit_before_handshake" in mode:  # the real backend's refusal of an untrusted lock: a stderr line, no NQT- line
        sys.stderr.write("fake backend: ending before any handshake\n")
        sys.stderr.flush()
        return int(mode["exit_before_handshake"])
    token, nonce = read_secrets()
    fake = Fake(mode, token)
    if mode.get("attach_line"):
        emit(b'NQT-ATTACH {"port":1}\n')
        return 0
    serve(fake, int(os.environ.get("NQT_PORT") or 0), swapped=False)
    record(fake, {"grandchild_pid": grandchild()} if mode.get("grandchild") else {})
    watch_stdin()
    noise(int(mode.get("noise_before", 0)))
    emit(ready_line(fake, nonce))
    if "exit_after_ready_s" in mode:
        threading.Timer(float(mode["exit_after_ready_s"]), lambda: os._exit(3)).start()
    noise(int(mode.get("noise_after", 0)))
    if mode.get("late_nqt"):
        emit(b'NQT-READY {"v":1,"port":1,"pid":1,"proof":"' + b"0" * 64 + b'"}\n')
    threading.Event().wait()
    return 0


def main_swapped(port: int) -> int:
    fake = Fake({}, None)
    serve(fake, port, swapped=True)
    record(fake, {"swapped": True})
    time.sleep(SLEEP_S)
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--swapped":
        sys.exit(main_swapped(int(sys.argv[2])))
    sys.exit(main_desktop())
