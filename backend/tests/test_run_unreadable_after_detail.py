"""A result file that the framed fast path read as healthy but a full decode cannot read is listed as unreadable once
a detail or section read has said so (V032 cleanup, 0.3.1 audit).

The run list reads each run's summary without decoding the large members (`run_head_scan`), so a result.json with an
invalid token inside `trades` and intact frame lines is first listed as readable, and the run view index keeps that
view under the file's (mtime_ns, size). The first full decode that fails records the error there; the row then reads
unreadable, exactly as before V031B, until the file changes.
"""
from __future__ import annotations

import os
import random
from pathlib import Path

import pytest

from nq_terminal.services.runs import RunService, RunUnreadable

from many_runs_lab import add_runs, result_doc, writer_bytes

RUN = "nt_corrupt_large_member_r1"


def _write(output: Path, run_id: str, *, corrupt: bool) -> Path:
    doc = result_doc(run_id, random.Random(0), probe_data=False, kind="book", ok=True)
    doc["trades"] = [{"t": 1, "pnl_usd": 1.5} for _ in range(5)]
    doc["n_trades"], doc["pnl_total"], doc["fills"] = 5, 7.5, []
    raw = writer_bytes(doc, crlf=False)
    if corrupt:
        raw = raw.replace(b'"t": 1', b'"t": @@@', 1)
    folder = output / run_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "result.json").write_bytes(raw)
    return folder / "result.json"


class Lab:
    def __init__(self, tmp_path: Path, *, state: bool = True, corrupt: bool = True):
        self.root = tmp_path / "lab"
        self.output = self.root / "backtests" / "output"
        self.output.mkdir(parents=True)
        add_runs(self.output, 6)
        self.result = _write(self.output, RUN, corrupt=corrupt)
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        self.calls: list[int] = []
        self.service = RunService(data_root=self.root, project_root=self.root, rescan_s=0.0,
                                  state_dir=state_dir if state else None, on_unreadable=lambda: self.calls.append(1))

    def row(self, run_id: str = RUN):
        return next(r for r in self.service.summaries() if r.run_id == run_id)


@pytest.fixture()
def lab(tmp_path: Path) -> Lab:
    return Lab(tmp_path)


def test_the_fast_path_lists_the_corrupt_run_as_readable_first(lab):
    row = lab.row()
    assert row.readable is True and row.kind == "book"


def test_born_failing_one_failed_detail_read_makes_the_next_listing_unreadable(lab):
    assert lab.row().readable is True
    with pytest.raises(RunUnreadable) as caught:
        lab.service.detail(RUN)
    row = lab.row()
    assert row.readable is False and row.error == str(caught.value) and RUN in row.error
    assert lab.calls == [1], "the run list's cached body is told once"


@pytest.mark.parametrize("read", ["trades", "fills", "log"])
def test_born_failing_a_failed_section_read_records_it_too(lab, read):
    assert lab.row().readable is True
    with pytest.raises(RunUnreadable):
        if read == "trades":
            lab.service.trades(RUN)
        elif read == "fills":
            lab.service.fills(RUN)
        else:
            lab.service.log(RUN, "decisions")
    assert lab.row().readable is False


def test_the_other_runs_stay_listed_as_readable(lab):
    lab.service.summaries()
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    rows = lab.service.summaries()
    assert [r.run_id for r in rows if not r.readable] == [RUN] and len(rows) == 7


def test_a_repeated_failure_does_not_tell_the_cache_again(lab):
    for _ in range(3):
        with pytest.raises(RunUnreadable):
            lab.service.detail(RUN)
        lab.row()
    assert lab.calls == [1]


def test_a_summary_read_of_a_noted_run_raises_so_the_ledger_match_is_unknown(lab):
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    with pytest.raises(RunUnreadable):
        lab.service._read(lab.service.index.get(RUN), "summary")


def test_a_changed_file_is_read_again_and_the_note_is_dropped(lab):
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    assert lab.row().readable is False
    _write(lab.output, RUN, corrupt=False)
    stamp = os.stat(lab.result).st_mtime_ns + 5_000_000_000
    os.utime(lab.result, ns=(stamp, stamp))
    assert lab.row().readable is True
    assert lab.service.detail(RUN).summary.run_id == RUN


def test_a_same_size_rewrite_with_a_new_mtime_is_read_again(lab):
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    raw = lab.result.read_bytes().replace(b"@@@", b"  1")
    lab.result.write_bytes(raw)
    stamp = os.stat(lab.result).st_mtime_ns + 5_000_000_000
    os.utime(lab.result, ns=(stamp, stamp))
    assert lab.row().readable is True


def test_a_healthy_run_that_is_read_in_full_is_never_noted(tmp_path):
    lab = Lab(tmp_path, corrupt=False)
    assert lab.service.detail(RUN).summary.readable is True
    assert lab.row().readable is True and lab.calls == []


def test_a_service_without_a_state_folder_still_raises_and_lists_as_before(tmp_path):
    lab = Lab(tmp_path, state=False)
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    assert lab.calls == []


def test_the_unreadable_row_carries_the_error_text_of_the_failed_read(lab):
    with pytest.raises(RunUnreadable):
        lab.service.detail(RUN)
    row = next(r for r in lab.service.summaries() if not r.readable)
    assert row.run_id == RUN and row.error.startswith(RUN) and row.usable is False
