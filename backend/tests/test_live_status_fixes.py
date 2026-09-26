"""Live monitor fixes from the Phase 2 QA: the book's halted flag, IB account masking, the log listing.

- `/api/live/status.halted` is the book's own state (LV1, LV3): an old plumbing preflight journal that ends on a
  halted row must not mark the paper book halted.
- IB paper ids have letters after the prefix (`DUX123456`); the mask must catch that form, the configured
  `IB_ACCOUNT_ID` wherever it appears, and leave no id-like token in the real logs (ARCHITECTURE s9).
- The LIVE and JRNL screens need the `live/logs/*.log` names to ask `/api/live/log` for one.
Real files under live/ are only read; every write goes to tmp_path.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.services import journals
from nq_terminal.settings import load_settings

from fakes import FIXTURES

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
BOOK = "volmanaged_paper_journal.jsonl"
REAL_LOGS = ROOT / "live" / "logs"
ID_LIKE = re.compile(r"(?<![A-Z0-9])(DU|DF|U|F)[A-Z]{0,3}\d{5,10}(?![0-9])")


def client(root: Path) -> TestClient:
    return TestClient(create_app(load_settings({"NQT_FIXTURE_DIR": str(root)})), base_url=LOCAL, client=LOOPBACK)


def _root_with(tmp_path: Path, files: dict[str, str]) -> Path:
    logs = tmp_path / "live" / "logs"
    logs.mkdir(parents=True)
    for name, text in files.items():
        (logs / name).write_text(text, encoding="utf-8")
    return tmp_path


def _line(**fields) -> str:
    return json.dumps({"type": "close", "date": "2026-09-28", **fields}) + "\n"


def test_a_halted_plumbing_journal_does_not_halt_the_book(tmp_path: Path):
    root = _root_with(tmp_path, {
        BOOK: _line(halted=False, target=6, actual={"MNQZ6.CME": 6}),
        "preflight3_journal.PLUMBING_DELAYED.jsonl": _line(halted=True, plumbing=True,
                                                          strategy_performance=False,
                                                          label="plumbing test, delayed data"),
    })
    body = client(root).get("/api/live/status").json()
    assert body["last_close"]["halted"] is False
    assert body["halted"] is False
    preflight = next(j for j in body["journals"] if j["name"].startswith("preflight3"))
    assert preflight["last_halted"] is True  # still reported per journal


def test_a_halted_book_is_halted(tmp_path: Path):
    root = _root_with(tmp_path, {BOOK: _line(halted=False) + _line(date="2026-09-29", halted=True)})
    assert client(root).get("/api/live/status").json()["halted"] is True


def test_no_book_journal_means_halted_unknown(tmp_path: Path):
    root = _root_with(tmp_path, {"preflight3_journal.PLUMBING_DELAYED.jsonl": _line(halted=True)})
    assert client(root).get("/api/live/status").json()["halted"] is None


@pytest.mark.parametrize("text, masked", [
    ("Account `DUX123456` found", "Account `DU*******` found"),
    ("AccountState(account_id=INTERACTIVE_BROKERS-DUX123456, x)", "AccountState(account_id=INTERACTIVE_BROKERS-DU*******, x)"),
    ("paper account DUX123456.", "paper account DU*******."),
    ("IB-DUK123456", "IB-DU*******"),
    ("accountU1234567", "accountU*******"),
    ("account DU1234567 and U7654321 ok", "account DU******* and U******* ok"),
    ("MNQZ6.CME req_id=-1 code 2104 at 2026-09-26T21:00:00", "MNQZ6.CME req_id=-1 code 2104 at 2026-09-26T21:00:00"),
])
def test_ib_account_ids_are_masked(text, masked):
    assert journals.mask_accounts(text) == masked


def test_the_configured_account_is_masked_wherever_it_appears():
    assert journals.mask_accounts("id=xq9zz12 end", known=("xq9zz12",)) == "id=******* end"


def test_no_account_like_token_survives_in_the_real_logs(tmp_path: Path):
    logs = sorted(REAL_LOGS.glob("*.log"))
    if not logs:
        pytest.skip("no real Nautilus log under live/logs")
    root = tmp_path / "root"
    (root / "live" / "logs").mkdir(parents=True)
    for path in logs:
        shutil.copyfile(path, root / "live" / "logs" / path.name)
    c = client(root)
    for path in logs:
        body = c.get("/api/live/log", params={"file": path.name, "tail": 5000}).json()
        leaked = [x["message"] for x in body["lines"] if ID_LIKE.search(x["message"])]
        assert leaked == [], (path.name, leaked[:3])


def test_status_lists_the_log_files():
    body = client(FIXTURES).get("/api/live/status").json()
    names = {x["name"] for x in body["logs"]}
    assert names == {p.name for p in (FIXTURES / "live" / "logs").glob("*.log")}
    entry = body["logs"][0]
    assert entry["path"] == f"live/logs/{entry['name']}" and entry["size_bytes"] > 0
    assert entry["plumbing"] is ("PLUMBING" in entry["name"])
