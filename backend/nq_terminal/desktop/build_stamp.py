"""Is the served page build current? `web/dist/build-stamp.json` against the sources and the contract (03 7.1).

The build writes the stamp (`web/scripts/buildStamp.mjs`, stage B):

    {"v": 1, "newest_source_mtime_ms": <int>, "openapi_sha256": "<64 hex>"}

`newest_source_mtime_ms` is the newest modification time, in whole milliseconds since the epoch, over the same source
list `start.ps1` checks (`Get-NewestSourceTime`): every file under `web/src` except `*.test.*` and `*.gallery.*`, the
files `index.html`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json` and `tsconfig.app.json` when
present, and every file under `web/public`. `openapi_sha256` is the full sha256 of `contract/openapi.json`.

`dist_status` answers `missing` when `dist/index.html` is absent; `stale` when the stamp is absent or unreadable, a
source is newer than the stamp or the contract's sha256 differs; else `current`. It only reads.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from nq_terminal.settings import TERMINAL_DIR, WEB_DIST

CURRENT, STALE, MISSING = "current", "stale", "missing"
STAMP_NAME = "build-stamp.json"
STAMP_VERSION = 1
WEB_DIR = WEB_DIST.parent
OPENAPI = TERMINAL_DIR / "contract" / "openapi.json"
TOP_LEVEL_SOURCES = ("index.html", "session.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json",
                     "tsconfig.app.json")
NOT_A_SOURCE = re.compile(r"\.(test|gallery)\.")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
NS_PER_MS = 1_000_000


def _files(folder: Path) -> list[Path]:
    return [p for p in folder.rglob("*") if p.is_file()] if folder.is_dir() else []


def source_files(web_dir: Path = WEB_DIR) -> list[Path]:
    """The launcher's source list (start.ps1 Get-NewestSourceTime)."""
    files = [p for p in _files(web_dir / "src") if not NOT_A_SOURCE.search(p.name)]
    files += [web_dir / name for name in TOP_LEVEL_SOURCES if (web_dir / name).is_file()]
    return files + _files(web_dir / "public")


def newest_source_mtime_ms(web_dir: Path = WEB_DIR) -> int:
    """The newest modification time of the source list in whole milliseconds (0 when there is no source)."""
    return max((p.stat().st_mtime_ns // NS_PER_MS for p in source_files(web_dir)), default=0)


def openapi_sha256(contract: Path = OPENAPI) -> str | None:
    try:
        return hashlib.sha256(contract.read_bytes()).hexdigest()
    except OSError:
        return None


def _stamp(dist: Path) -> tuple[int, str] | None:
    try:
        doc = json.loads((dist / STAMP_NAME).read_text(encoding="utf-8"))
        mtime, digest = doc["newest_source_mtime_ms"], doc["openapi_sha256"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if doc.get("v") != STAMP_VERSION or not isinstance(mtime, int) or not isinstance(digest, str):
        return None
    return (mtime, digest) if HEX64.match(digest) else None


def dist_status(web_dir: Path = WEB_DIR, contract: Path = OPENAPI) -> str:
    """'current', 'stale' or 'missing' for `<web_dir>/dist`."""
    dist = web_dir / "dist"
    if not (dist / "index.html").is_file():
        return MISSING
    stamp = _stamp(dist)
    if stamp is None:
        return STALE
    mtime, digest = stamp
    if newest_source_mtime_ms(web_dir) > mtime or openapi_sha256(contract) != digest:
        return STALE
    return CURRENT
