"""The handshake line and the stdin control channel (03 sections 2.2 and 2.4, Appendix A row 2).

The shell (or a launcher) starts the backend and writes two lines on its stdin, once each: `TOKEN <64 hex>` (32
random bytes, the backend's master secret) and `NONCE <64 hex>`. Nothing else is accepted; end of file means the
parent is gone. The token never travels in argv, the environment, a URL or a log.

Once start-up has taken the lock, the backend prints one line on stdout, prefixed so stray output is never mistaken
for it:

    NQT-READY {"v":1,"port":P,"pid":N,"proof":"<hex>","root":...,"prefix":...,"nq_lab":...,"nq_terminal":...,
               "contract":C,"openapi_sha256":"<64 hex>","dist":"current|stale|missing",
               "mode":"desktop|launcher|browser"}

`proof` is HMAC-SHA256 keyed by the token's 32 raw bytes over the ASCII text `ready|<nonce>|<port>|<pid>`; the proof
route answers the same MAC over `proof|<nonce>|<port>|<pid>`, so a READY answer can never be replayed as a proof
answer or the other way round. A start that finds a live lock prints `NQT-ATTACH {"port":P}` instead and exits 0.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import sys
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, BinaryIO

import nq_lab

from nq_terminal.desktop.build_stamp import OPENAPI, dist_status, openapi_sha256
from nq_terminal.settings import TERMINAL_DIR, Settings

READY, PROOF = "ready", "proof"
READY_PREFIX, ATTACH_PREFIX = "NQT-READY", "NQT-ATTACH"
HANDSHAKE_VERSION = 1
DESKTOP_CONTRACT = 1  # the desktop contract number until contract/desktop_version.json exists (stage B writes it)
DESKTOP_VERSION_FILE = TERMINAL_DIR / "contract" / "desktop_version.json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
CONTROL_LINE = re.compile(rb"^(TOKEN|NONCE) ([0-9A-Fa-f]{64})\r?\n?$")
MAX_CONTROL_LINE = 256
POLL_S = 0.05
PACKAGE_DIR = Path(__file__).resolve().parents[1]
LOG = logging.getLogger("nq_terminal.desktop")


def mac(token: str, kind: str, nonce: str, port: int, pid: int) -> str:
    """HMAC-SHA256 keyed by the token's raw bytes over `kind|nonce|port|pid` (kind is 'ready' or 'proof')."""
    message = f"{kind}|{nonce}|{int(port)}|{int(pid)}".encode("ascii")
    return hmac.new(bytes.fromhex(token), message, hashlib.sha256).hexdigest()


def _verify(claimed: object, token: str, kind: str, nonce: str, port: object, pid: object) -> bool:
    if not isinstance(claimed, str) or not HEX64.match(claimed) or not HEX64.match(token or ""):
        return False
    try:
        expected = mac(token, kind, nonce, int(port), int(pid))
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(expected, claimed)


def verify_ready(payload: Mapping[str, Any], token: str, nonce: str) -> bool:
    """Check a READY payload's proof against the token and the nonce the caller sent."""
    return _verify(payload.get("proof"), token, READY, nonce, payload.get("port"), payload.get("pid"))


def verify_proof(body: Mapping[str, Any], token: str, nonce: str, port: int) -> bool:
    """Check a proof route answer for the nonce the caller sent to the port it called."""
    return _verify(body.get("proof"), token, PROOF, nonce, port, body.get("pid"))


def contract_number() -> int:
    """The desktop contract number: contract/desktop_version.json when present, else DESKTOP_CONTRACT."""
    try:
        value = json.loads(DESKTOP_VERSION_FILE.read_text(encoding="utf-8"))["contract"]
    except (OSError, ValueError, KeyError, TypeError):
        return DESKTOP_CONTRACT
    return value if isinstance(value, int) and value >= 1 else DESKTOP_CONTRACT


def identity(settings: Settings) -> dict[str, Any]:
    """The fields the shell checks besides the proof: where this backend's code and interpreter come from."""
    return {
        "root": str(settings.root),
        "prefix": sys.prefix,
        "nq_lab": str(Path(nq_lab.__file__).resolve().parent),
        "nq_terminal": str(PACKAGE_DIR),
        "contract": contract_number(),
    }


def ready_payload(settings: Settings, *, token: str, nonce: str | None, port: int, pid: int) -> dict[str, Any]:
    """The READY fields in their fixed order; `proof` is None when no nonce came in (a plain start)."""
    proof = mac(token, READY, nonce, port, pid) if nonce else None
    return {"v": HANDSHAKE_VERSION, "port": port, "pid": pid, "proof": proof, **identity(settings),
            "openapi_sha256": openapi_sha256(OPENAPI), "dist": dist_status(settings.web_dist.parent, OPENAPI),
            "mode": settings.mode}


def _line(prefix: str, payload: Mapping[str, Any]) -> str:
    return f"{prefix} {json.dumps(payload, separators=(',', ':'))}"


def ready_line(payload: Mapping[str, Any]) -> str:
    return _line(READY_PREFIX, payload)


def attach_line(port: int | None) -> str:
    return _line(ATTACH_PREFIX, {"port": port})


def parse_line(text: str) -> tuple[str, dict[str, Any]] | None:
    """(prefix, payload) for an NQT-READY or NQT-ATTACH line, else None."""
    prefix, _, rest = text.strip().partition(" ")
    if prefix not in (READY_PREFIX, ATTACH_PREFIX):
        return None
    try:
        payload = json.loads(rest)
    except ValueError:
        return None
    return (prefix, payload) if isinstance(payload, dict) else None


class StdinChannel:
    """Reads TOKEN and NONCE once each from a binary stream on a daemon thread, then waits for end of file.

    Any other line, a second value or a malformed one is dropped without being echoed. End of file calls `on_eof`
    (the watchdog), whether or not both values arrived."""

    def __init__(self, stream: BinaryIO, on_eof: Callable[[], None]) -> None:
        self._stream, self._on_eof = stream, on_eof
        self._values: dict[str, str] = {}
        self._both, self._closed = threading.Event(), threading.Event()

    @property
    def closed(self) -> bool:
        """True once the stream reached end of file (the parent is gone)."""
        return self._closed.is_set()

    def start(self) -> "StdinChannel":
        threading.Thread(target=self._run, name="nqt-stdin", daemon=True).start()
        return self

    def wait(self, timeout_s: float) -> tuple[str, str] | None:
        """(token, nonce) once both arrived; None on end of file or time-out before that."""
        end = time.monotonic() + timeout_s
        while not self._both.is_set() and not self._closed.is_set():
            left = end - time.monotonic()
            if left <= 0:
                break
            self._both.wait(min(left, POLL_S))
        if self._both.is_set():
            return self._values["TOKEN"], self._values["NONCE"]
        return None

    def _accept(self, raw: bytes) -> None:
        match = CONTROL_LINE.match(raw[:MAX_CONTROL_LINE + 1])
        if match is None:
            LOG.warning("stdin control: a line that is not TOKEN or NONCE was dropped")
            return
        name, value = match.group(1).decode("ascii"), match.group(2).decode("ascii").lower()
        if name in self._values:
            LOG.warning("stdin control: a second %s line was dropped", name)
            return
        self._values[name] = value
        if len(self._values) == 2:
            self._both.set()

    def _run(self) -> None:
        try:
            for raw in iter(lambda: self._stream.readline(MAX_CONTROL_LINE + 1), b""):
                self._accept(raw)
        except (OSError, ValueError):
            LOG.warning("stdin control: the stream failed; treated as end of file")
        finally:
            self._closed.set()
            self._on_eof()
