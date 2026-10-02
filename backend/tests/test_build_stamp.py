"""The page build stamp (03 section 7.1): `web/dist/build-stamp.json` against the sources and the contract.

The build writes the stamp (`web/scripts/buildStamp.mjs`, stage B): the newest modification time of the source list
`start.ps1` checks, in whole milliseconds, and the full sha256 of `contract/openapi.json`. The backend compares it at
start-up and reports `current`, `stale` or `missing` in the handshake (and, from stage B, in `/api/health`). Every
case runs on a small fake web folder under `tmp_path`; the last test reads the real tree and only checks the answer is
one of the three words.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from nq_terminal.desktop import build_stamp
from nq_terminal.desktop.build_stamp import CURRENT, MISSING, STALE, dist_status

T0 = 1_700_000_000.0  # seconds; every fake source starts here


def _touch(path: Path, when: float, text: str = "x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    os.utime(path, (when, when))
    return path


@pytest.fixture
def lab(tmp_path: Path) -> dict[str, Path]:
    web, contract = tmp_path / "web", tmp_path / "contract" / "openapi.json"
    _touch(web / "src" / "main.ts", T0)
    _touch(web / "src" / "deep" / "view.tsx", T0)
    _touch(web / "index.html", T0)
    _touch(web / "package.json", T0, "{}")
    _touch(contract, T0, '{"openapi": "3.1.0"}')
    _touch(web / "dist" / "index.html", T0 + 10)
    return {"web": web, "contract": contract}


def _stamp(lab: dict[str, Path], *, mtime_ms: int | None = None, sha: str | None = None) -> Path:
    body = {
        "v": 1,
        "newest_source_mtime_ms": int(T0 * 1000) if mtime_ms is None else mtime_ms,
        "openapi_sha256": hashlib.sha256(lab["contract"].read_bytes()).hexdigest() if sha is None else sha,
    }
    target = lab["web"] / "dist" / build_stamp.STAMP_NAME
    target.write_text(json.dumps(body), encoding="utf-8")
    return target


def _status(lab: dict[str, Path]) -> str:
    return dist_status(lab["web"], lab["contract"])


def test_a_stamp_that_matches_the_sources_and_the_contract_is_current(lab):
    _stamp(lab)
    assert _status(lab) == CURRENT == "current"


def test_no_dist_is_missing(lab):
    for item in (lab["web"] / "dist").iterdir():
        item.unlink()
    (lab["web"] / "dist").rmdir()
    assert _status(lab) == MISSING == "missing"


def test_a_dist_without_its_index_is_missing(lab):
    _stamp(lab)
    (lab["web"] / "dist" / "index.html").unlink()
    assert _status(lab) == MISSING


def test_a_source_newer_than_the_stamp_is_stale(lab):
    _stamp(lab)
    _touch(lab["web"] / "src" / "deep" / "view.tsx", T0 + 5)
    assert _status(lab) == STALE == "stale"


def test_a_changed_contract_is_stale(lab):
    _stamp(lab)
    lab["contract"].write_text('{"openapi": "3.1.0", "paths": {}}', encoding="utf-8")
    os.utime(lab["contract"], (T0, T0))
    assert _status(lab) == STALE


@pytest.mark.parametrize("name", ["package.json", "index.html", "session.html", "pnpm-lock.yaml",
                                  "vite.config.ts", "tsconfig.json", "tsconfig.app.json"])
def test_each_top_level_source_of_the_launcher_list_counts(lab, name):
    _stamp(lab)
    _touch(lab["web"] / name, T0 + 1)
    assert _status(lab) == STALE


def test_public_files_count(lab):
    _stamp(lab)
    _touch(lab["web"] / "public" / "fonts" / "a.woff2", T0 + 1)
    assert _status(lab) == STALE


@pytest.mark.parametrize("name", ["view.test.ts", "panel.gallery.tsx"])
def test_tests_and_galleries_do_not_count(lab, name):
    _stamp(lab)
    _touch(lab["web"] / "src" / name, T0 + 100)
    assert _status(lab) == CURRENT


def test_a_dist_without_a_stamp_is_stale(lab):
    assert not (lab["web"] / "dist" / build_stamp.STAMP_NAME).exists()
    assert _status(lab) == STALE


@pytest.mark.parametrize("text", ["", "not json", "[]", '{"v": 1}', '{"v": 1, "newest_source_mtime_ms": "x", '
                                                                    '"openapi_sha256": "ab"}'])
def test_an_unreadable_stamp_is_stale(lab, text):
    (lab["web"] / "dist" / build_stamp.STAMP_NAME).write_text(text, encoding="utf-8")
    assert _status(lab) == STALE


def test_a_missing_contract_is_stale(lab):
    _stamp(lab)
    lab["contract"].unlink()
    assert _status(lab) == STALE


def test_the_newest_mtime_is_read_in_whole_milliseconds(lab):
    _touch(lab["web"] / "src" / "main.ts", T0 + 0.0019)
    assert build_stamp.newest_source_mtime_ms(lab["web"]) == int(T0 * 1000) + 1


def test_the_openapi_digest_is_all_64_hex(lab):
    digest = build_stamp.openapi_sha256(lab["contract"])
    assert digest == hashlib.sha256(lab["contract"].read_bytes()).hexdigest() and len(digest) == 64


def test_the_real_tree_reports_one_of_the_three_words():
    assert dist_status() in {CURRENT, STALE, MISSING}
