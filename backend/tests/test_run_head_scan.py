"""The head of a result.json read without decoding its large arrays (V031B; `services/run_head_scan.py`).

For every layout the generated lab holds (`many_runs_lab.py`) and for every run of the real lab (read only): the summary
view (`runs.parse_summary`) equals the full head (`runs.parse_head`) on every key the view keeps, and the run's kind is
the head's. The writer's layout (indent 1, LF or CRLF) is read by the fast path, which never decodes a large member;
every other layout, and every file the fast path cannot prove, goes to the full decoder, which answers as before (the
same value, or the same error).
"""
from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal.services import run_head_scan as scan
from nq_terminal.services import runs
from nq_terminal.services.files import thaw

from many_runs_lab import add_edges, add_runs, result_doc, writer_bytes

REAL_OUTPUT = ROOT / "backtests" / "output"
FAST = ["edge_nan_trades", "edge_nan_head", "edge_late_members", "edge_log_null", "edge_log_list", "edge_log_empty",
        "edge_wide_int", "edge_no_large"]
FULL = ["edge_compact", "edge_indent2", "edge_dup_key", "edge_not_object", "edge_trailing", "edge_truncated",
        "edge_empty", "edge_bom"]
UNREADABLE = {"edge_not_object", "edge_trailing", "edge_truncated", "edge_empty", "edge_bom"}


def _framed(raw: bytes):
    return scan.framed_head(raw, large=runs.LARGE_KEYS, log_key=runs.LOG_KEY, log_probe=runs.KIND_KEYS)


def _same_as_head(raw: bytes) -> None:
    view, head = thaw(runs.parse_summary(raw)), thaw(runs.parse_head(raw))
    meta = head.pop(runs.META)
    assert view.pop(runs.META) == {"kind": meta["kind"]}
    assert view == head


@pytest.fixture(scope="module")
def edges(tmp_path_factory) -> dict[str, bytes]:
    output = tmp_path_factory.mktemp("edges")
    names = add_edges(output)
    assert sorted(names) == sorted(FAST + FULL)
    return {name: (output / name / "result.json").read_bytes() for name in names}


@pytest.mark.parametrize("crlf", [False, True])
@pytest.mark.parametrize("kind", ["book", "sized", "intraday", "none"])
def test_the_writer_layout_is_read_by_the_fast_path_and_equals_the_head(kind, crlf):
    for seed in range(12):
        doc = result_doc(f"nt_x_{seed}", random.Random(seed), probe_data=seed % 2 == 0, kind=kind, ok=seed % 3 > 0)
        raw = writer_bytes(doc, crlf=crlf)
        framed = _framed(raw)
        assert framed is not None
        assert list(framed.members) == [k for k in doc if k not in runs.LARGE_KEYS]
        _same_as_head(raw)
        assert thaw(runs.parse_summary(raw))[runs.META]["kind"] == runs.run_kind(doc)


@pytest.mark.parametrize("name", FAST)
def test_unusual_files_in_the_writer_layout_take_the_fast_path_and_equal_the_head(edges, name):
    assert _framed(edges[name]) is not None
    _same_as_head(edges[name])


@pytest.mark.parametrize("name", FULL)
def test_other_layouts_go_to_the_full_decoder_and_answer_as_before(edges, name):
    raw = edges[name]
    assert _framed(raw) is None
    if name in UNREADABLE:
        with pytest.raises(ValueError) as head_error:
            runs.parse_head(raw)
        with pytest.raises(ValueError) as view_error:
            runs.parse_summary(raw)
        assert str(view_error.value) == str(head_error.value)
    else:
        _same_as_head(raw)


LARGE_ONLY_MARKS = (b'"entry_ts"', b'"exit_ts"', b'"net_r"', b'"px"', b'"equity"')  # inside large members only


def _doc_with_large_members(kind: str) -> dict:
    """A document whose trades, fills and strategy log are each several KB (the seed alone may leave two empty)."""
    doc = result_doc("nt_big", random.Random(3), probe_data=True, kind=kind, ok=True)
    doc["trades"] = [{"entry_ts": 1_420_070_400_000_000_000 + i, "exit_ts": 1_420_070_400_000_000_900 + i,
                      "qty": 1, "pnl": 1.25, "net_r": 0.5, "note": "trades [x]"} for i in range(200)]
    doc["fills"] = [{"ts": t["entry_ts"], "px": "100.25", "qty": 1} for t in doc["trades"]]
    doc["n_trades"], doc["pnl_total"] = len(doc["trades"]), 250.0
    return doc


@pytest.mark.parametrize("kind", ["book", "sized", "intraday"])
def test_the_fast_path_never_decodes_a_large_member(monkeypatch, kind):
    doc = _doc_with_large_members(kind)
    raw = writer_bytes(doc, crlf=True)
    spans = {key: end - start for key, start, end in scan._members(raw) if key in runs.LARGE_KEYS}
    assert set(spans) == set(runs.LARGE_KEYS) and min(spans.values()) > 4096, spans
    seen: list[bytes] = []
    real = scan.decode

    def decode(part: bytes):
        seen.append(bytes(part))
        return real(part)

    monkeypatch.setattr(scan, "decode", decode)
    assert _framed(raw) is not None and seen
    for part in seen:
        assert not any(mark in part for mark in LARGE_ONLY_MARKS), part[:80]
    assert sum(len(part) for part in seen) + sum(spans.values()) <= len(raw)
    assert sum(len(part) for part in seen) < min(spans.values())


def _close_trades_inline(raw: bytes) -> bytes:
    at = raw.rindex(b"\n ],", 0, raw.index(b'\n "fills"'))
    return raw[:at] + b"]," + raw[at + 4:]


@pytest.mark.parametrize("damage", [
    lambda raw: raw.replace(b'\n "fills": [', b'\n "fills": [\n "x": 1,', 1),  # a member mark inside a large array
    lambda raw: raw.replace(b'\n "summary": {', b'\n "summary": {\n "bad', 1),  # a small member that does not decode
    lambda raw: raw.rstrip(b"\r\n}") + b"\n ]",  # no closing brace
    lambda raw: raw.replace(b'\n "config": ', b'\n "config" : ', 1),  # not the writer's key separator
    lambda raw: _close_trades_inline(raw),  # a large member closed off its own line
])
def test_a_file_the_fast_path_cannot_prove_goes_to_the_full_decoder(damage):
    doc = result_doc("nt_damage", random.Random(9), probe_data=False, kind="sized", ok=True)
    doc["trades"] = doc["trades"] or [{"pnl": 1.0}]
    raw = damage(writer_bytes(doc, crlf=False))
    assert _framed(raw) is None


def test_strategy_log_members_are_found_at_their_own_depth_only():
    doc = result_doc("nt_depth", random.Random(4), probe_data=False, kind="intraday", ok=True)
    doc["strategy_log"]["closes"] = [{"instruments": 1, "snapshots": 2}]  # deeper keys of the same names
    framed = _framed(writer_bytes(doc, crlf=True))
    assert framed is not None and framed.log_is_object and framed.log_keys == frozenset()
    doc["strategy_log"]["snapshots"] = []
    assert _framed(writer_bytes(doc, crlf=False)).log_keys == frozenset({"snapshots"})


def test_a_generated_lab_reads_every_run_by_the_fast_path(tmp_path):
    ids = add_runs(tmp_path, 120)
    for run_id in ids:
        raw = (tmp_path / run_id / "result.json").read_bytes()
        assert _framed(raw) is not None, run_id
        _same_as_head(raw)


@pytest.mark.skipif(not REAL_OUTPUT.is_dir(), reason="the real lab is not on this machine")
def test_every_real_run_is_read_by_the_fast_path_and_equals_its_head():
    """Read only: the real lab's result files, each read once."""
    paths = sorted(REAL_OUTPUT.glob("*/result.json"))
    assert paths
    for path in paths:
        raw = path.read_bytes()
        assert _framed(raw) is not None, path.parent.name
        _same_as_head(raw)
