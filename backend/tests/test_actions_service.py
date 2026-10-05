"""Backtests from a preset and anchor re-runs through the JOBS queue (vnext product-1 and product-3), and the exact
comparison of a re-run with its base (rule 3).

Every action ends in `JobService.enqueue`, so the worker starts the one runner `backtests/run_base.py` with a JSON
config string, as a hand-queued job does. The fake `Popen` records the command and runs nothing.
"""
from __future__ import annotations

import json
from datetime import date

import pytest

from nq_terminal.models.actions import AnchorAction, BacktestAction
from nq_terminal.services import actions
from nq_terminal.services.anchor_check import base_of, check_anchor
from nq_terminal.services.jobs import DuplicateRunId

from actions_support import (
    SIZED,
    ZA,
    ZA_EXP,
    FakePopen,
    jobs_for,
    make_root,
    plant_rerun,
    runner_argv,
    runs_for,
    snapshot,
)
from p2_jobs_fakes import wait_for
from test_runs_support import add_run, result_doc


@pytest.fixture
def popen() -> FakePopen:
    return FakePopen(hold=True)


@pytest.fixture
def lab(tmp_path, popen):
    root = make_root(tmp_path)
    jobs = jobs_for(root, tmp_path, popen)
    yield root, runs_for(root), jobs
    popen.release_all()
    jobs.close()


def backtest(**fields) -> BacktestAction:
    return BacktestAction.model_validate({"kind": "backtest", "preset_id": ZA, **fields})


def started(popen: FakePopen, count: int = 1) -> bool:
    return wait_for(lambda: len(popen.calls) >= count)


# ---------------------------------------------------------------- backtests from a preset


def test_a_backtest_from_a_preset_runs_the_one_runner_with_the_exact_config(lab, popen) -> None:
    root, runs, jobs = lab
    result = actions.start_backtest(backtest(params={"or_minutes": 15}, run_id="t_za_try_1"), runs=runs, jobs=jobs)
    expected = {"strategy": "za_orb", "params": {"or_minutes": 15, "target_r": 10.0}, "variant": "repaired",
                "start": "2010-09-28", "end": "2022-01-01", "run_id": "t_za_try_1"}
    assert result.kind == "backtest" and result.job.run_id == "t_za_try_1" and result.preset_id == ZA
    assert result.changed_params == ["or_minutes"]
    assert started(popen)
    argv, kwargs = popen.calls[0]
    assert argv == runner_argv(root, expected)
    assert kwargs["cwd"] == root and "shell" not in kwargs


def test_the_window_can_be_narrowed_inside_the_fence(lab, popen) -> None:
    root, runs, jobs = lab
    result = actions.start_backtest(backtest(start="2014-01-02", end="2018-01-01", run_id="t_za_mid"), runs=runs,
                                    jobs=jobs)
    assert (result.job.spec.start, result.job.spec.end) == (date(2014, 1, 2), date(2018, 1, 1))


def test_without_a_run_id_the_next_free_one_is_suggested(lab, popen) -> None:
    root, runs, jobs = lab
    first = actions.start_backtest(backtest(), runs=runs, jobs=jobs)
    second = actions.start_backtest(backtest(), runs=runs, jobs=jobs)
    assert (first.job.run_id, second.job.run_id) == (f"t_{ZA_EXP}_1", f"t_{ZA_EXP}_2")


def test_a_suggested_run_id_skips_an_existing_output_folder(lab) -> None:
    root, runs, jobs = lab
    add_run(root, f"t_{ZA_EXP}_1", result_doc(ZA))
    assert actions.start_backtest(backtest(), runs=runs, jobs=jobs).job.run_id == f"t_{ZA_EXP}_2"


@pytest.mark.parametrize("fields", [
    {"params": {"or_minutes": 0}},
    {"params": {"or_minutes": "5"}},
    {"params": {"stop_r": 1.0}},
    {"end": "2022-01-02"},
    {"start": "2022-01-01", "end": "2022-03-01"},
    {"start": "2009-12-31"},
])
def test_a_refused_backtest_queues_nothing(lab, popen, fields) -> None:
    root, runs, jobs = lab
    with pytest.raises(actions.ActionRefused) as refused:
        actions.start_backtest(backtest(run_id="t_refused", **fields), runs=runs, jobs=jobs)
    assert refused.value.problems
    assert jobs.list_jobs().jobs == [] and popen.calls == []


@pytest.mark.parametrize("run_id", ["t_nt_za_v0_fixture_a_regress_r1", "t_x_haltfix_r2"])
def test_a_preset_backtest_cannot_take_an_anchor_run_id(lab, popen, run_id) -> None:
    root, runs, jobs = lab
    with pytest.raises(actions.ActionRefused) as refused:
        actions.start_backtest(backtest(run_id=run_id, params={"target_r": 99.0}), runs=runs, jobs=jobs)
    assert [loc for loc, _ in refused.value.problems] == [("run_id",)]
    assert jobs.list_jobs().jobs == [] and popen.calls == []


def test_an_unknown_or_unoffered_preset_is_refused(lab, popen) -> None:
    root, runs, jobs = lab
    for preset in ("nt_unknown", "nt_za_late_fixture"):
        with pytest.raises(actions.UnknownPreset):
            actions.start_backtest(backtest(preset_id=preset, run_id="t_x"), runs=runs, jobs=jobs)
    assert popen.calls == []


def test_a_preset_the_job_spec_refuses_cannot_be_launched(lab, popen) -> None:
    root, runs, jobs = lab
    with pytest.raises(actions.ActionRefused) as refused:
        actions.start_backtest(backtest(preset_id="nt_bh_fixture", run_id="t_bh"), runs=runs, jobs=jobs)
    assert any("t0" in msg for _, msg in refused.value.problems) and popen.calls == []


def test_a_taken_run_id_is_refused_by_the_queue(lab) -> None:
    root, runs, jobs = lab
    with pytest.raises(DuplicateRunId):
        add_run(root, "t_taken", result_doc(ZA))
        actions.start_backtest(backtest(run_id="t_taken"), runs=runs, jobs=jobs)


# ---------------------------------------------------------------- anchor re-runs


def test_an_anchor_rerun_queues_the_base_config_with_a_fresh_run_id(lab, popen) -> None:
    root, runs, jobs = lab
    result = actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id=ZA), runs=runs, jobs=jobs)
    anchor_id = f"t_{ZA}_regress_r1"
    assert result.kind == "anchor" and result.base_run_id == ZA and result.job.run_id == anchor_id
    expected = {**result_doc(ZA)["config"], "run_id": anchor_id}
    assert started(popen)
    assert popen.calls[0][0] == runner_argv(root, expected)


def test_the_next_free_regress_number_is_used(lab) -> None:
    root, runs, jobs = lab
    add_run(root, f"t_{ZA}_regress_r1", result_doc(ZA))
    result = actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id=ZA), runs=runs, jobs=jobs)
    assert result.job.run_id == f"t_{ZA}_regress_r2"
    again = actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id=ZA), runs=runs, jobs=jobs)
    assert again.job.run_id == f"t_{ZA}_regress_r3"


def test_a_base_that_already_starts_with_t_keeps_its_name() -> None:
    assert actions.anchor_run_id("t_mine", taken=set()) == "t_mine_regress_r1"
    assert actions.anchor_run_id("nt_x", taken={"t_nt_x_regress_r1"}) == "t_nt_x_regress_r2"


def test_an_anchor_id_past_the_length_limit_is_refused() -> None:
    with pytest.raises(actions.ActionRefused):
        actions.anchor_run_id("n" * 75, taken=set())


def test_an_unknown_base_is_refused(lab, popen) -> None:
    root, runs, jobs = lab
    with pytest.raises(actions.UnknownBase):
        actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id="nt_nowhere"), runs=runs, jobs=jobs)
    assert popen.calls == []


@pytest.mark.parametrize(("mutate", "word"), [
    (lambda cfg: cfg.update(end="2022-01-02"), "end"),
    (lambda cfg: cfg["params"].update(or_minutes=500), "or_minutes"),
    (lambda cfg: cfg["params"].update(lookahead_probe=True), "lookahead_probe"),
])
def test_a_base_whose_config_would_be_refused_is_not_rerun(lab, popen, mutate, word) -> None:
    root, runs, jobs = lab
    doc = json.loads(json.dumps(result_doc(ZA)))
    mutate(doc["config"])
    add_run(root, "nt_bad_base", doc)
    with pytest.raises(actions.ActionRefused) as refused:
        actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id="nt_bad_base"), runs=runs, jobs=jobs)
    assert any(word in f"{loc} {msg}" for loc, msg in refused.value.problems)
    assert popen.calls == []


# ---------------------------------------------------------------- the comparison (rule 3)


def test_the_base_of_a_terminal_anchor_is_found_from_its_name(lab) -> None:
    root, runs, jobs = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA)
    entries = runs.index.rescan()
    assert base_of(f"t_{ZA}_regress_r1", entries) == ZA
    assert base_of("t_unknown_regress_r1", entries) is None
    assert base_of(ZA, entries) is None


def test_the_run_pages_read_a_terminal_rerun_against_its_base_too(lab) -> None:
    """RUNS, RUN and the ANCHORS tab (`RunService.anchor`) must find the base of `t_<base>_regress_r<N>` as well."""
    root, runs, jobs = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA)
    runs.index.rescan()
    pair = runs.anchor(f"t_{ZA}_regress_r1")
    assert pair is not None
    assert (pair.base, pair.base_found, pair.verdict) == (ZA, True, "IDENTICAL")
    assert [p.anchor for p in runs.ledger().anchor_pairs if p.base == ZA] == [f"t_{ZA}_regress_r1"]


def test_an_identical_rerun_is_a_match(lab) -> None:
    root, runs, jobs = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA)
    check = check_anchor(f"t_{ZA}_regress_r1", runs=runs, jobs=jobs)
    assert (check.verdict, check.base, check.first_difference) == ("MATCH", ZA, None)
    assert [c.field for c in check.checks] == ["n_trades", "trades", "pnl_total", "fees_total", "sharpe"]
    assert all(c.equal is True for c in check.checks)
    assert "regress_check" in check.note


@pytest.mark.parametrize(("mutate", "field"), [
    (lambda doc: doc.update(pnl_total=doc["pnl_total"] + 0.01), "pnl_total"),
    (lambda doc: doc.update(fees_total=doc["fees_total"] + 0.01), "fees_total"),
    (lambda doc: doc["trades"][1].update(exit_px=doc["trades"][1]["exit_px"] + 0.25), "trades[1].exit_px"),
    (lambda doc: (doc["trades"].pop(), doc.update(n_trades=doc["n_trades"] - 1)), "n_trades"),
])
def test_a_planted_difference_is_a_mismatch_naming_the_first_field(lab, mutate, field) -> None:
    root, runs, jobs = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA, mutate)
    check = check_anchor(f"t_{ZA}_regress_r1", runs=runs, jobs=jobs)
    assert check.verdict == "MISMATCH" and check.first_difference == field


def test_a_mismatch_shows_both_values(lab) -> None:
    root, runs, jobs = lab
    base_pnl = result_doc(ZA)["pnl_total"]
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA, lambda doc: doc.update(pnl_total=base_pnl + 1.0))
    check = check_anchor(f"t_{ZA}_regress_r1", runs=runs, jobs=jobs)
    pnl = {c.field: c for c in check.checks}["pnl_total"]
    assert (pnl.equal, pnl.anchor, pnl.base) == (False, base_pnl + 1.0, base_pnl)


def test_a_sharpe_difference_alone_is_a_mismatch(lab, monkeypatch) -> None:
    root, runs, jobs = lab
    plant_rerun(root, f"t_{ZA}_regress_r1", ZA)
    real = runs.account_stats

    def shifted(run_id):
        sharpe, depth, note = real(run_id)
        return (sharpe + 1e-12 if run_id.startswith("t_") else sharpe), depth, note

    monkeypatch.setattr(runs, "account_stats", shifted)
    check = check_anchor(f"t_{ZA}_regress_r1", runs=runs, jobs=jobs)
    assert check.verdict == "MISMATCH" and check.first_difference == "sharpe"


def test_a_lab_anchor_whose_name_hides_its_base_uses_its_regress_check(lab) -> None:
    """The lab's own anchors (`x_regress_r8` of the run `x_a`) name their base in regress_check.json."""
    root, runs, jobs = lab
    folder = plant_rerun(root, "nt_za_v0_fixture_regress_r8", ZA)
    (folder / "regress_check.json").write_text(json.dumps({"old": ZA, "new": "nt_za_v0_fixture_regress_r8",
                                                           "identical": True}), encoding="utf-8")
    check = check_anchor("nt_za_v0_fixture_regress_r8", runs=runs, jobs=jobs)
    assert (check.verdict, check.base, check.base_found) == ("MATCH", ZA, True)


def test_an_anchor_without_a_findable_base_is_not_comparable(lab) -> None:
    root, runs, jobs = lab
    plant_rerun(root, "nt_lost_regress_r1", ZA)
    check = check_anchor("nt_lost_regress_r1", runs=runs, jobs=jobs)
    assert (check.verdict, check.first_difference, check.base_found) == ("NOT COMPARABLE", "base", False)


def test_an_unusable_pair_is_not_comparable(lab) -> None:
    root, runs, jobs = lab
    plant_rerun(root, "nt_unb_base", ZA, lambda doc: doc["balance_check"].update(ok=False))
    plant_rerun(root, "t_nt_unb_base_regress_r1", ZA, lambda doc: doc["balance_check"].update(ok=False))
    check = check_anchor("t_nt_unb_base_regress_r1", runs=runs, jobs=jobs)
    assert check.verdict == "NOT COMPARABLE" and check.first_difference == "sharpe"


def test_a_queued_rerun_is_pending_and_an_unknown_one_is_refused(lab, popen) -> None:
    root, runs, jobs = lab
    result = actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id=SIZED), runs=runs, jobs=jobs)
    check = check_anchor(result.job.run_id, runs=runs, jobs=jobs)
    assert check.verdict == "PENDING" and check.base == SIZED and check.job_state in ("queued", "running")
    with pytest.raises(actions.UnknownAnchor):
        check_anchor("t_nowhere_regress_r1", runs=runs, jobs=jobs)


def test_no_action_writes_under_results(lab, popen) -> None:
    root, runs, jobs = lab
    before = snapshot(root / "results")
    actions.start_backtest(backtest(run_id="t_quiet"), runs=runs, jobs=jobs)
    actions.rerun_anchor(AnchorAction(kind="anchor", base_run_id=ZA), runs=runs, jobs=jobs)
    plant_rerun(root, f"t_{ZA}_regress_r9", ZA)
    check_anchor(f"t_{ZA}_regress_r9", runs=runs, jobs=jobs)
    assert started(popen)
    assert snapshot(root / "results") == before
