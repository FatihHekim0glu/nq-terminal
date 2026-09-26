"""One registry reader (RI1): /api/hypotheses, /api/audit/spec-hashes and /api/commands agree during a rebuild.

`nq_lab.registry.write` rewrites `results/registry.csv` in place (truncate, then write), and a research workflow
rebuilds it while the terminal runs. A half-written file must never be read as a short registry: spec-hashes
answers 503 (it would otherwise report all_ok over the rows that happen to be there) and the command index keeps
its mnemonics but lists no hypotheses and says why. Every root here is a copy under pytest's tmp_path.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from test_research_support import build_root

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
NAMES = ("tom_v0", "overnight_v0", "volmanaged_v0", "rebal_v0")  # registry file order


def fixture_client(root: Path) -> TestClient:
    return TestClient(create_app(load_settings({"NQT_FIXTURE_DIR": str(root)})), base_url=LOCAL, client=LOOPBACK)


def _cut(root: Path, keep_rows: int, mid_line: bool) -> None:
    path = root / "results" / "registry.csv"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    text = "".join(lines[: 1 + keep_rows])
    text = text + lines[1 + keep_rows][:20] if mid_line else text.rstrip("\n")
    path.write_text(text, encoding="utf-8", newline="")


@pytest.fixture
def whole_root(tmp_path: Path) -> Path:
    return build_root(tmp_path, NAMES)


def test_whole_registry_agrees_across_the_three_views(whole_root):
    c = fixture_client(whole_root)
    body = c.get("/api/audit/spec-hashes").json()
    assert [r["name"] for r in body["rows"] if r["kind"] == "registry"] == list(NAMES)
    assert body["all_ok"] is True and body["registry_present"] is True
    commands = c.get("/api/commands").json()
    assert commands["hypotheses"] == list(NAMES) and commands["registry_error"] is None
    assert [h["name"] for h in c.get("/api/hypotheses").json()] == list(NAMES)


@pytest.mark.parametrize("mid_line", [False, True])
def test_a_half_written_registry_is_not_a_short_list(whole_root, mid_line):
    _cut(whole_root, keep_rows=2, mid_line=mid_line)
    c = fixture_client(whole_root)
    spec = c.get("/api/audit/spec-hashes")
    assert spec.status_code == 503, spec.json()
    commands = c.get("/api/commands").json()
    assert commands["hypotheses"] == [] and commands["registry_error"]
    assert {m["code"] for m in commands["mnemonics"]} >= {"REG", "DES"}
    assert c.get("/api/hypotheses").status_code == 503


def test_a_missing_registry_is_absent_not_an_error(tmp_path: Path):
    (tmp_path / "results").mkdir()
    c = fixture_client(tmp_path)
    body = c.get("/api/audit/spec-hashes").json()
    assert body["registry_present"] is False and body["all_ok"] is False
    commands = c.get("/api/commands").json()
    assert commands["hypotheses"] == [] and commands["registry_error"] is None
