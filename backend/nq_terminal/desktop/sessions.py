"""Sessions on the loopback port (03 section 4.2; 02 C3-9 and C3-11; 05 X10).

- `GET /api/session` swaps the token (`Authorization: NQT <hex>`) and an origin (`X-NQT-Origin`) for a session value
  bound to that one origin; the shell sets it as the cookie `nqt_s_<port>` (HttpOnly, SameSite=Strict, Path=/api).
- `GET /api/session/code` mints a single-use launch code that lives `CODE_TTL_S`; `GET /api/session/redeem` swaps it
  for a session bound to the origin of the page that redeemed it. A code dies on its first use, whether or not it
  was still live, and an expired code is refused.
- Session values and codes are 32 random bytes in hex, kept in memory only and keyed by their sha256, so the store
  never holds a value it could leak. Every comparison goes through `hmac.compare_digest` on bytes (`same`), so a
  value or origin with non-ASCII characters is refused instead of raising.
- At most `MAX_SESSIONS` sessions and `MAX_CODES` unredeemed codes are kept; the oldest goes first. The cookie name
  carries the port because cookies do not separate by port on 127.0.0.1 (RFC 6265, M2 of 03).

`SessionMiddleware` (security.py) asks `origin_of` for every /api request; nothing here logs a value or a code.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

COOKIE_PREFIX = "nqt_s_"
CODE_TTL_S = 60
VALUE_BYTES = 32
MAX_SESSIONS = 128
MAX_CODES = 16
STATE_KEY = "nqt_sessions"
COOKIE_FLAGS: dict[str, Any] = {"httponly": True, "samesite": "strict", "path": "/api"}
VALUE_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def cookie_name(port: int) -> str:
    return f"{COOKIE_PREFIX}{int(port)}"


def same(a: str, b: str) -> bool:
    """Constant-time equality of two texts, safe for any characters (compare_digest refuses non-ASCII str)."""
    return hmac.compare_digest(a.encode("utf-8", "surrogatepass"), b.encode("utf-8", "surrogatepass"))


def _key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", "surrogatepass")).hexdigest()


def well_formed(value: object) -> bool:
    """64 lowercase hex characters: the only shape a session value or a code ever has."""
    return isinstance(value, str) and VALUE_PATTERN.match(value) is not None


class SessionStore:
    """In-memory sessions bound to one origin each, and single-use launch codes that live `CODE_TTL_S`."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._sessions: OrderedDict[str, str] = OrderedDict()  # sha256(value) -> origin, oldest first
        self._codes: OrderedDict[str, float] = OrderedDict()  # sha256(code) -> expiry on the clock
        self._guard = threading.Lock()

    def create(self, origin: str) -> str:
        """A new session value bound to `origin`."""
        value = secrets.token_hex(VALUE_BYTES)
        with self._guard:
            self._sessions[_key(value)] = origin
            while len(self._sessions) > MAX_SESSIONS:
                self._sessions.popitem(last=False)
        return value

    def origin_of(self, value: str | None) -> str | None:
        """The origin a live session value is bound to, else None."""
        if not well_formed(value):
            return None
        digest = _key(value)
        with self._guard:
            found = [origin for stored, origin in self._sessions.items() if same(stored, digest)]
        return found[0] if found else None

    def is_live(self, value: str | None, origin: str | None = None) -> bool:
        """A known session, and, when an origin is given, bound to exactly that origin."""
        bound = self.origin_of(value)
        return bound is not None and (origin is None or same(bound, origin))

    def mint_code(self) -> str:
        """A new single-use launch code; expired codes are dropped first."""
        code = secrets.token_hex(VALUE_BYTES)
        now = self._clock()
        with self._guard:
            for stale in [k for k, expires in self._codes.items() if now > expires]:
                del self._codes[stale]
            self._codes[_key(code)] = now + CODE_TTL_S
            while len(self._codes) > MAX_CODES:
                self._codes.popitem(last=False)
        return code

    def redeem(self, code: str | None, origin: str) -> str | None:
        """A new session for `origin` when the code is known and unexpired; the code dies either way."""
        if not well_formed(code):
            return None
        digest, now = _key(code), self._clock()
        with self._guard:
            found = next((k for k in self._codes if same(k, digest)), None)
            expires = self._codes.pop(found) if found is not None else None
        if expires is None or now > expires:
            return None
        return self.create(origin)

    def counts(self) -> tuple[int, int]:
        """(live sessions, unredeemed codes), for tests and diagnostics; never the values."""
        with self._guard:
            return len(self._sessions), len(self._codes)


def store(app: Any) -> SessionStore:
    """The app's session store, made on first use."""
    current = getattr(app.state, STATE_KEY, None)
    if current is None:
        current = SessionStore()
        setattr(app.state, STATE_KEY, current)
    return current
