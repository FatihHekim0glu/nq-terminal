"""The challenge-response identity proof behind `GET /api/desktop/proof?nonce=<64 hex>` (review 2, 05 G08).

The caller sends a fresh random nonce and gets back HMAC-SHA256(token, 'proof'|nonce|port|pid) with the backend's
root, prefix, contract number and pid. Only a caller that knows the token can check the MAC, so the route takes no
secret and needs no Authorization header, and it reveals nothing to a caller without the token; a fresh nonce per call
means an answer recorded earlier cannot be replayed. The shell runs it before attaching and on every top-level
navigation (02 C3-4), off its UI thread.
"""
from __future__ import annotations

import re
from typing import Any

from nq_terminal.desktop.handshake import PROOF, identity, mac
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.settings import Settings

NONCE_PATTERN = r"^[0-9a-f]{64}$"
_NONCE = re.compile(NONCE_PATTERN)


def valid_nonce(nonce: object) -> bool:
    """64 lowercase hex characters (32 random bytes), nothing else."""
    return isinstance(nonce, str) and _NONCE.match(nonce) is not None


def proof_body(settings: Settings, runtime: Runtime, nonce: str) -> dict[str, Any]:
    """The answer to one challenge: the MAC, then the identity fields the shell compares with the lab it picked."""
    if not valid_nonce(nonce):
        raise ValueError("the nonce must be 64 lowercase hex characters")
    ident = identity(settings)
    return {"proof": mac(runtime.token, PROOF, nonce, runtime.port, runtime.pid), "root": ident["root"],
            "prefix": ident["prefix"], "contract": ident["contract"], "pid": runtime.pid}
