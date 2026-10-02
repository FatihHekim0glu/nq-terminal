"""LV6 and LV6b dumps for the reference cross-check in `terminal/qa` (ANALYTICS_CATALOG LV6, LV6b and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules) with the prefix `nqt_lv6_`.
Each dump is an `lv6` bundle: a paper book's LV5 rows (dates, daily paper P&L, the paper and model cumulative paths),
K, the backtest-start cone's percentiles exactly as served, and the live-start cone's replications and seed; in
`values.ours` what `services/paper_expectation.py` serves (both placements, the live-start cone and its refusal).
`terminal/qa/crosscheck/lv6_live_cone.py` recomputes it with arch and numpy.

The backtest-start cone is volmanaged_v0's own SV6 cone at 1 tick per side (research files, read only, no bar
service and so no gate read). The paper books are seeded synthetic books, labelled as such (no paper book has a
performance row yet): one of 60 sessions with a gap, one of 300 sessions (both horizons are reached and rows lie past
them), and one of 12 sessions (the live-start cone is refused, the backtest one is not).

The bundles go into the shared dump folder only once the `lv6` kind is registered in the QA side's `BUNDLE_INPUTS`
(its `dumps.py`, read as text, never imported); before that they are written into a temporary folder only.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import ROOT
from nq_terminal.analytics import bootstrap, series
from nq_terminal.models.expectation import ExpectationCone
from nq_terminal.services import paper_expectation
from nq_terminal.services.research import ResearchService

PREFIX = "nqt_lv6_"
QA_DUMPS = Path(__file__).resolve().parents[2] / "qa" / "crosscheck" / "dumps.py"
HYPOTHESIS = "volmanaged_v0"
COST = 1
K = 1_000_000.0
NONE = "none"


def registered_in_qa() -> bool:
    try:
        return '"lv6":' in QA_DUMPS.read_text(encoding="utf-8")
    except OSError:
        return False


def synthetic_book(n: int, *, seed: int, gaps: tuple[int, ...] = (), lead: int = 2) -> dict:
    """LV5 rows of a seeded synthetic paper book (not project data): USD per session, nulls before it starts."""
    rng = np.random.default_rng(seed)
    total = lead + n
    dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-12-07", periods=total)]
    paper: list[float | None] = [None] * lead + [float(v) for v in rng.normal(35.0, 1100.0, n).round(2)]
    model: list[float | None] = [None] * lead + [float(v) for v in rng.normal(35.0, 1100.0, n).round(2)]
    for i in gaps:
        paper[lead + i] = model[lead + i] = None

    def running(values):
        out, acc = [], 0.0
        for v in values:
            if v is not None:
                acc += v
            out.append(None if v is None else acc)
        return out

    return {"present": True, "date": dates, "paper": paper, "model": model, "paper_cumulative": running(paper),
            "model_cumulative": running(model)}


def placement_values(prefix: str, cone: ExpectationCone) -> dict:
    placed = cone.placement
    out = {f"{prefix}_first_index": float(placed.first_index), f"{prefix}_latest_step": float(placed.latest_step),
           f"{prefix}_beyond": float(placed.beyond)}
    for name in ("paper", "model"):
        path = getattr(placed, name)
        out.update({f"{prefix}_{name}_fraction": path.fraction, f"{prefix}_{name}_bands": path.bands,
                    f"{prefix}_{name}_first_index": path.first_index, f"{prefix}_{name}_beyond": float(path.beyond)})
    return out


def lv6_doc(case: str, source: str, tracking: dict, s: series.SessionSeries) -> dict:
    back = paper_expectation.backtest_cone(tracking, K, s, HYPOTHESIS, COST)
    live = paper_expectation.live_cone(tracking, K)
    ours = placement_values("backtest", back)
    ours["live_refusal"] = live.refusal.code if live.refusal else NONE
    ours["live_n"] = float(live.source_n)
    if live.cone is not None:
        ours.update({"live_block": live.block, "live_horizon": float(live.cone.horizon),
                     **{f"live_cone_{q}": live.cone.quantiles[str(q)] for q in bootstrap.CONE_PERCENTILES},
                     **placement_values("live", live)})
    inputs = {"dates": tracking["date"], "paper": tracking["paper"], "paper_cumulative": tracking["paper_cumulative"],
              "model_cumulative": tracking["model_cumulative"], "capital": K,
              "backtest_quantiles": back.cone.quantiles, "backtest_horizon": back.cone.horizon,
              "reps": live.reps, "seed": live.seed}
    return _clean({"schema": SCHEMA, "kind": "lv6", "case": case, "source": source, "inputs": inputs,
                   "values": {"ours": ours}, "missing": {}})


def write_lv6_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    written = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case'][len('lv6_'):]}.json"
        path.write_text(json.dumps(doc, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        written.append(path)
    return written


@pytest.fixture(scope="module")
def docs() -> list[dict]:
    s = series.hypothesis_series(ResearchService(ROOT), HYPOTHESIS, COST)
    cone = f"{HYPOTHESIS} SV6 cone at 1 tick (research files, read only)"
    return [lv6_doc("lv6_book_60_with_a_gap", f"seeded synthetic paper book of 60 sessions (not project data); {cone}",
                    synthetic_book(60, seed=61, gaps=(17,)), s),
            lv6_doc("lv6_book_300", f"seeded synthetic paper book of 300 sessions (not project data); {cone}",
                    synthetic_book(300, seed=62), s),
            lv6_doc("lv6_book_12_short", f"seeded synthetic paper book of 12 sessions (not project data); {cone}",
                    synthetic_book(12, seed=63), s)]


def test_the_three_books_cover_a_gap_both_horizons_and_a_refusal(docs):
    by_case = {d["case"]: d["values"]["ours"] for d in docs}
    assert by_case["lv6_book_60_with_a_gap"]["live_n"] == 59.0
    assert by_case["lv6_book_60_with_a_gap"]["live_horizon"] == 59.0
    long = by_case["lv6_book_300"]
    assert long["live_horizon"] == 252.0 and long["live_beyond"] == 300 - 252
    assert long["backtest_beyond"] == 300 - 252
    assert by_case["lv6_book_12_short"]["live_refusal"] == "live_short"
    assert "live_cone_50" not in by_case["lv6_book_12_short"]


def test_lv6_docs_carry_the_inputs_and_the_served_values(docs):
    for doc in docs:
        assert set(doc["inputs"]) == {"dates", "paper", "paper_cumulative", "model_cumulative", "capital",
                                      "backtest_quantiles", "backtest_horizon", "reps", "seed"}
        assert doc["inputs"]["reps"] == 10_000 and doc["inputs"]["seed"] == 20260927
        assert doc["inputs"]["backtest_horizon"] == 252
        assert len(doc["values"]["ours"]["backtest_paper_fraction"]) == 252


def test_write_lv6_dumps(docs, tmp_path):
    folder = dump_dir() if registered_in_qa() else tmp_path
    paths = write_lv6_dumps(folder, docs)
    assert [json.loads(p.read_text(encoding="utf-8"))["case"] for p in paths] == [d["case"] for d in docs]


def test_the_prefix_leaves_other_dumps_alone(tmp_path):
    (tmp_path / "nqt_qa_keep.json").write_text("{}", encoding="utf-8")
    write_lv6_dumps(tmp_path, [])
    assert (tmp_path / "nqt_qa_keep.json").exists()
