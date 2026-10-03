"""SV8 route (ANALYTICS_CATALOG SV8; TASKS Phase 12): `GET /api/analytics/spa`, the family test over the registered NQ
hypotheses that share the daily one-contract Basis A construction, against NQ buy and hold on one contract.

The router lives in `nq_terminal/api/spa.py`; until the merge step includes it in `app.py`, these tests include it
themselves on an app built by `create_app`. Real research files are read only; NQ prices come from the tests' fake
serve (synthetic bars through `oos_gate.serve_bars` with a temporary log), so no test touches the project's log.
"""
from __future__ import annotations

import shutil

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nq_lab.config import IS_END
from nq_terminal.analytics import series, spa
from nq_terminal.api import spa as spa_api
from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.services import spa_family
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve
from nq_terminal.constants import SERIES_SOURCES
from test_research_support import build_root, real_registry_rows, write_registry

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
ROUTE = "/api/analytics/spa"
# The rule's members on the research files of 2026-09-27, in registry order (SV8 construction step 1).
MEMBERS = ["za_v0", "tom_v0", "preholiday_v0", "prefomc_v0", "overnight_v0", "macroday_v0", "halloween_v0",
           "rebal_v0", "mac5rev_v0", "fomccycle_v0", "fomctone_v0"]
# The other rows registered on 2026-09-27: the view names each as excluded. The tests read a root built from exactly
# these rows (copied from the lab's files, never the live registry), so a later registration cannot change them.
SNAPSHOT_EXCLUDED = ["volmanaged_v0", "tsmom_v0", "eurodrift_v0", "dtsmom_v0", "mim_v0", "carry_v0", "eomtsy_v0",
                     "cskew_v0", "vt_har_v0", "vrp_eq_v0"]


def with_spa(app: FastAPI) -> FastAPI:
    """`create_app` includes the router before the static mount of web/dist; the app is GET only bar the JOBS writes."""
    assert "/api/analytics/spa" in app.openapi()["paths"], "create_app includes the SPA router"
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    return app


def client_for(root, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = with_spa(create_app(settings))
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def serve(tmp_path_factory):
    return make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")


@pytest.fixture(scope="module")
def snapshot_root(tmp_path_factory):
    names = (*MEMBERS, *SNAPSHOT_EXCLUDED)
    files = [SERIES_SOURCES[name].file for name in names]
    return build_root(tmp_path_factory.mktemp("registry"), tuple(names),
                      series=(*files, "za_v0_rejected_days.json", "za_v0_repaired_rejected_days.json"))


@pytest.fixture(scope="module")
def real_api(serve, snapshot_root) -> TestClient:
    return client_for(snapshot_root, serve)


@pytest.fixture(scope="module")
def real_body(real_api) -> dict:
    r = real_api.get(ROUTE)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def research(snapshot_root) -> ResearchService:
    return ResearchService(snapshot_root)


def test_the_route_is_get_only():
    app = with_spa(create_app(load_settings({})))
    assert set(app.openapi()["paths"][ROUTE]) == {"get"}


def test_the_family_is_the_rule_s_members_and_every_other_registered_row_is_named_with_its_reason(real_body,
                                                                                                  research):
    assert [m["name"] for m in real_body["members"]] == MEMBERS
    registered = [row.name for row in research.registry_rows() if row.registered]
    excluded = {e["name"]: e["reason"] for e in real_body["excluded"]}
    assert sorted(excluded) == sorted(set(registered) - set(MEMBERS))
    assert "return on capital" in excluded["volmanaged_v0"] and "basis points" in excluded["eurodrift_v0"]
    assert "monthly" in excluded["tsmom_v0"] and "monthly" in excluded["eomtsy_v0"]
    assert "za_v0_C3_gao_momentum" not in excluded  # an unregistered check is no hypothesis of the family


def assert_row_equals_family_test(row, want):
    assert row["n_sessions"] == want["t"]
    assert row["pvalues"] == want["pvalues"] and row["reality_check"] == want["pvalues"]["upper"]
    assert row["critical_values"] == want["critical_values"]
    assert row["block"] == want["block"] and row["reps"] == 10_000 and row["seed"] == 20260927
    assert row["superior"] == [MEMBERS[i] for i in want["stepm"]["superior"]]
    for i, member in enumerate(row["members"]):
        assert member["mean_differential"] == want["mean_differential"][i]
        assert member["in_consistent_set"] == want["consistent_set"][i]
        assert member["rejected"] == (i in want["stepm"]["superior"])


def test_the_primary_row_is_against_cash_so_each_differential_is_the_member_s_return(real_body, research, serve):
    from nq_terminal.services.bars import BarService

    bars = BarService(serve, cache_bytes=1 << 30)
    fam = spa_family.family_inputs(research, bars, None, benchmark=spa_family.CASH)
    assert real_body["benchmark_id"] == spa_family.CASH == "cash"
    assert (fam.bench.to_numpy() == 0.0).all() and fam.bench_missing == 0 and len(fam.index) == real_body["n_sessions"]
    assert_row_equals_family_test(real_body, spa.family_test(fam.bench.to_numpy(), fam.models.to_numpy()))
    for member in real_body["members"]:
        assert member["mean_differential"] == pytest.approx(member["mean_return"], rel=1e-12, abs=1e-9)


def test_the_second_row_is_against_nq_buy_and_hold_on_its_own_common_index(real_body, research, serve):
    from nq_terminal.services.bars import BarService

    bars = BarService(serve, cache_bytes=1 << 30)
    fam = spa_family.family_inputs(research, bars, None)
    row = real_body["buy_and_hold"]
    assert row["benchmark_id"] == spa_family.NQ_BUY_AND_HOLD == "nq_buy_and_hold" and row["buy_and_hold"] is None
    assert row["benchmark"] == series.NQ_BH_USD_LABEL
    assert_row_equals_family_test(row, spa.family_test(fam.bench.to_numpy(), fam.models.to_numpy()))
    assert [m["name"] for m in row["members"]] == MEMBERS


def test_each_row_says_which_null_it_tests(real_body):
    cash, held = real_body, real_body["buy_and_hold"]
    assert "cash" in cash["benchmark"].lower() and "positive mean" in cash["note"]
    assert "buy and hold" in held["benchmark"] and "buy and hold" in held["note"]
    assert cash["note"] != held["note"] and cash["loss"] != held["loss"] and cash["label"] != held["label"]


def test_the_cash_row_is_not_charged_the_buy_and_hold_drift(real_body):
    # against one NQ contract held, every member's mean differential falls by the benchmark's mean; against cash
    # it is the member's own mean return
    held = real_body["buy_and_hold"]
    shifts = [m["mean_return"] - h["mean_differential"] for m, h in zip(real_body["members"], held["members"])]
    assert all(s > 0 for s in shifts)
    assert [m["mean_differential"] for m in real_body["members"]] != [m["mean_differential"] for m in held["members"]]


def test_the_common_index_is_the_members_shared_sessions_inside_the_window(real_body, research):
    own = [series.hypothesis_series(research, name, 1).r.index for name in MEMBERS]
    shared = own[0]
    for index in own[1:]:
        shared = shared.intersection(index)
    assert real_body["n_sessions"] == len(shared) and real_body["bench_missing"] == 0  # cash has no gaps
    held = real_body["buy_and_hold"]
    assert held["n_sessions"] + held["bench_missing"] == len(shared)
    assert real_body["first"] >= shared[0].strftime("%Y-%m-%d")
    assert real_body["last"] <= shared[-1].strftime("%Y-%m-%d") < IS_END.strftime("%Y-%m-%d")
    assert real_body["first"] == own[MEMBERS.index("fomccycle_v0")][0].strftime("%Y-%m-%d")  # the latest start
    for member, index in zip(real_body["members"], own):
        assert member["sessions"] == len(index)
        assert member["left_out"] == len(index) - real_body["n_sessions"]
        assert 0 <= member["left_out_with_pnl"] <= member["left_out"]


def test_every_price_read_went_through_the_gate_as_terminal(real_body, serve):
    assert serve.calls and all(c.caller == "terminal" for c in serve.calls)
    assert all(c.symbol == "NQ.V.0" and c.timeframe == "1d" for c in serve.calls)


def test_the_view_is_labelled_a_family_test_over_the_pre_registered_hypotheses(real_body):
    assert real_body["tag"] == "[POST HOC]"
    assert "pre-registered" in real_body["family_note"] and "not picked on screen" in real_body["family_note"]
    assert "never overrides" in real_body["label"]
    assert "not studentised" in real_body["statistic"]
    assert "favours members with a large spread" in real_body["statistic"]
    assert real_body["unit"] == "USD per session, one NQ contract" and real_body["cost"] == 1
    assert real_body["basis"] == "A"


def test_a_second_request_is_served_from_the_cache(real_api, real_body, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("recomputed")

    monkeypatch.setattr(spa, "family_test", boom)
    r = real_api.get(ROUTE)
    assert r.status_code == 200 and r.json() == real_body


def test_the_fixture_tree_has_one_member_and_names_the_other(serve):
    body = client_for(FIXTURES, serve).get(ROUTE)
    assert body.status_code == 200, body.text
    view = body.json()
    assert [m["name"] for m in view["members"]] == ["overnight_v0"]
    assert [e["name"] for e in view["excluded"]] == ["volmanaged_v0"]


def test_without_a_price_source_the_view_is_refused():
    r = client_for(FIXTURES).get(ROUTE)
    assert r.status_code == 503 and "NQ prices" in r.json()["detail"]


def test_born_failing_one_unbuildable_member_refuses_the_whole_view(serve, monkeypatch):
    real = series.hypothesis_series

    def broken(research, name, cost, **kwargs):
        if name == "overnight_v0":
            raise series.SeriesError("its series file is missing (test)")
        return real(research, name, cost, **kwargs)

    monkeypatch.setattr(series, "hypothesis_series", broken)
    r = client_for(FIXTURES, serve).get(ROUTE)
    assert r.status_code == 503 and "overnight_v0" in r.json()["detail"]


def test_born_failing_a_benchmark_gap_leaves_the_session_out_and_counts_it(research, serve, monkeypatch):
    from nq_terminal.services.bars import BarService

    bars = BarService(serve, cache_bytes=1 << 30)
    clean = spa_family.family_inputs(research, bars, None)
    real = series.nq_buy_and_hold

    def gappy(bars, index, **kwargs):
        out = real(bars, index, **kwargs)
        return out.where(out.index != index[5], np.nan)

    monkeypatch.setattr(series, "nq_buy_and_hold", gappy)
    fam = spa_family.family_inputs(research, bars, None)
    assert len(fam.index) == len(clean.index) - 1 and fam.bench_missing == clean.bench_missing + 1
    assert not fam.bench.isna().any() and isinstance(fam.index, pd.DatetimeIndex)


@pytest.mark.parametrize("benchmark", [spa_family.CASH, spa_family.NQ_BUY_AND_HOLD])
def test_each_row_serves_the_correlation_of_its_own_differentials(real_body, research, serve, benchmark):
    from nq_terminal.services.bars import BarService

    bars = BarService(serve, cache_bytes=1 << 30)
    fam = spa_family.family_inputs(research, bars, None, benchmark=benchmark)
    d = spa.loss_differentials(fam.bench.to_numpy(), fam.models.to_numpy())
    want = pd.DataFrame(d).corr().to_numpy()
    row = real_body if benchmark == spa_family.CASH else real_body["buy_and_hold"]
    got = np.array(row["correlation"], dtype=float)
    k = len(row["members"])
    assert got.shape == (k, k) == want.shape
    np.testing.assert_allclose(got, want, rtol=0, atol=1e-12)
    assert (got == got.T).all() and (np.diag(got) == 1.0).all()


def test_against_cash_the_correlation_is_the_correlation_of_the_members_returns(real_body, research, serve):
    from nq_terminal.services.bars import BarService

    fam = spa_family.family_inputs(research, BarService(serve, cache_bytes=1 << 30), None, benchmark=spa_family.CASH)
    np.testing.assert_allclose(np.array(real_body["correlation"], dtype=float), fam.models.corr().to_numpy(),
                               rtol=0, atol=1e-12)


def test_the_fixture_tree_serves_a_one_by_one_correlation(serve):
    view = client_for(FIXTURES, serve).get(ROUTE).json()
    assert view["correlation"] == [[1.0]]


def test_the_correlation_notes_name_the_series_each_is_taken_on(real_body):
    held = real_body["buy_and_hold"]
    assert "differential" in held["correlation_note"] and "r_bh" in held["correlation_note"]
    assert "members' returns" in real_body["correlation_note"] and "not the members' returns" not in real_body["correlation_note"]
    assert "MT 87" in real_body["correlation_note"]


def test_born_failing_the_buy_and_hold_correlation_note_does_not_claim_the_returns_overstate_the_overlap(real_body):
    """Every differential holds -r_bh, so for sparse members it is d that is pulled towards 1, not the returns."""
    note = real_body["buy_and_hold"]["correlation_note"]
    assert "share the market" not in note and "overstate" not in note
    assert "towards 1" in note and "not the number of independent" in note and "MT 87" in note


def test_born_failing_a_registered_row_without_a_series_source_is_named_not_refused(tmp_path, serve):
    """A lab registration the terminal has not learned yet must not turn the view into a 503."""
    root = tmp_path / "tree"
    shutil.copytree(FIXTURES, root)
    rows = real_registry_rows()
    fixture_rows = [dict(row) for row in rows if row["name"] in ("overnight_v0", "volmanaged_v0")]
    unknown = dict(next(row for row in rows if row["name"] == "overnight_v0"), name="zz_unlearned_v0")
    write_registry(root, [*fixture_rows, unknown])
    r = client_for(root, serve).get(ROUTE)
    assert r.status_code == 200, r.text
    view = r.json()
    assert [m["name"] for m in view["members"]] == ["overnight_v0"]
    excluded = {e["name"]: e["reason"] for e in view["excluded"]}
    assert excluded["zz_unlearned_v0"] == spa_family.NO_SOURCE_REASON and "volmanaged_v0" in excluded


def test_born_failing_the_unknown_row_reason_says_what_to_add():
    reason = spa_family.exclusion_reason("zz_unlearned_v0")
    assert reason == spa_family.NO_SOURCE_REASON and "SERIES_SOURCES" in reason


def test_born_failing_the_fx_month_end_book_is_excluded_as_monthly():
    assert "fxeomhedge_v0" in SERIES_SOURCES
    assert "monthly" in (spa_family.exclusion_reason("fxeomhedge_v0") or "")


def test_every_registered_row_of_the_live_registry_is_decided():
    """The live registry decides no member or exclusion by raising: each row has a reason or joins the family, and a
    row the lab registered after this release (no series source yet) is named with the reason that says so."""
    for row in real_registry_rows():
        if row["registered"] == "True":
            reason = spa_family.exclusion_reason(row["name"])
            if row["name"] not in SERIES_SOURCES:
                assert reason == spa_family.NO_SOURCE_REASON, row["name"]


# ---------------------------------------------------------------- the effective number of members (SV8 step 8)


@pytest.mark.parametrize("benchmark", [spa_family.CASH, spa_family.NQ_BUY_AND_HOLD])
def test_each_row_serves_the_effective_members_the_browser_used_to_compute(real_body, benchmark):
    """C8 mirror: the served estimators are `analytics.neff` over the row's own served correlation."""
    from nq_terminal.analytics import neff

    row = real_body if benchmark == spa_family.CASH else real_body["buy_and_hold"]
    names = [m["name"] for m in row["members"]]
    want = neff.effective_members(np.array(row["correlation"], dtype=float), names)
    assert row["effective_members"] == want
    got = row["effective_members"]
    assert got["refusal"] is None and got["k"] == len(MEMBERS) and got["cut"] == 0.5
    assert 1.0 <= got["participation"] <= len(MEMBERS) and got["li_ji"] >= 1.0
    assert sorted(n for g in got["clusters"] for n in g) == sorted(MEMBERS)
    assert [len(g) for g in got["clusters"]] == sorted((len(g) for g in got["clusters"]), reverse=True)
    pair = got["strongest"]
    i, j = names.index(pair["a"]), names.index(pair["b"])
    assert i < j and pair["rho"] == row["correlation"][i][j]


def test_the_effective_members_use_the_estimators_of_the_correlation_the_view_serves(real_body):
    got = real_body["effective_members"]
    eig = np.linalg.eigvalsh(np.array(real_body["correlation"], dtype=float))
    assert got["participation"] == pytest.approx(float(eig.sum() ** 2 / (eig ** 2).sum()), rel=1e-12)


def test_the_fixture_tree_serves_one_member_so_the_effective_members_refuse_with_single(serve):
    view = client_for(FIXTURES, serve).get(ROUTE).json()
    assert view["effective_members"] == {"k": 1, "cut": 0.5, "refusal": {"kind": "single", "name": None},
                                         "participation": None, "li_ji": None, "clusters": [], "strongest": None}
