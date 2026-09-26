"""HTTP layer for the runs endpoints (ARCHITECTURE section 4, Runs): status codes, shapes and paging."""
from __future__ import annotations

import pytest

from nq_terminal.models.common import MAX_LIMIT

from test_runs_support import RUNS, add_run, client, copy_root, ledger_row, result_doc, strict_json, write_ledger

ZA, SIZED, BOOK, SMOKE = RUNS["za_orb"], RUNS["sized"], RUNS["dtsmom"], RUNS["nan_tokens"]
SUMMARY_KEYS = {"run_id", "strategy", "params", "variant", "start", "end", "created_utc", "elapsed_s", "kind",
                "n_trades", "pnl_total", "fees_total", "hit_rate", "mean_net_r", "t_net_r", "t_pnl_usd",
                "balance_ok", "mtm_ok", "coverage_ok", "is_probe", "is_anchor", "ledger", "sidecars"}


@pytest.fixture
def root(tmp_path):
    return copy_root(tmp_path)


@pytest.fixture
def api(root):
    return client(root)


def test_runs_list(api):
    r = api.get("/api/runs")
    assert r.status_code == 200
    body = strict_json(r.text)
    assert {x["run_id"] for x in body} == set(RUNS.values())
    assert all(SUMMARY_KEYS <= set(x) for x in body)


def test_run_detail_and_nan(api):
    r = api.get(f"/api/runs/{SMOKE}")
    assert r.status_code == 200
    body = strict_json(r.text)
    assert body["summary"]["run_id"] == SMOKE and body["summary_stats"]["blocks"]["2010-2013"]["t"] is None


@pytest.mark.parametrize("path", ["", "/trades", "/fills", "/log/snapshots", "/equity", "/sidecar/regress_check"])
@pytest.mark.parametrize("run_id", ["nt_nope", "..", "%2E%2E", "nt_za_v0_fixture_a%2F..", "result.json"])
def test_unknown_run_id_gives_404(api, run_id, path):
    r = api.get(f"/api/runs/{run_id}{path}")
    assert r.status_code == 404, r.text


def test_trades_page_bounds(api):
    body = api.get(f"/api/runs/{ZA}/trades", params={"offset": 1, "limit": 2}).json()
    assert (body["offset"], body["limit"], body["total"], len(body["items"])) == (1, 2, 6, 2)
    assert api.get(f"/api/runs/{ZA}/trades").json()["limit"] == 500
    assert api.get(f"/api/runs/{ZA}/trades", params={"limit": MAX_LIMIT + 1}).status_code == 422
    assert api.get(f"/api/runs/{ZA}/trades", params={"offset": -1}).status_code == 422


def test_fills_page(api):
    body = api.get(f"/api/runs/{SIZED}/fills").json()
    assert body["total"] == 9 and body["items"][0]["ts"].endswith("Z") and "commission_float" in body["items"][0]


def test_log_sections(api):
    assert api.get(f"/api/runs/{BOOK}/log/rolls").json()["total"] == 3
    assert api.get(f"/api/runs/{SIZED}/log/rolls").status_code == 404
    assert api.get(f"/api/runs/{SIZED}/log/trades").status_code == 422


def test_equity_endpoint(api):
    body = strict_json(api.get(f"/api/runs/{SIZED}/equity").text)
    doc = result_doc(SIZED)
    assert body["source"] == "mtm_snapshots" and body["basis"] == "B"
    assert body["equity"][-1] == pytest.approx(doc["balance_check"]["final_usd"])
    assert all(isinstance(t, int) for t in body["t"])


def test_unbalanced_equity_is_empty(api):
    body = api.get(f"/api/runs/{RUNS['unbalanced']}/equity").json()
    assert body["usable"] is False and body["equity"] == [] and body["t"] == []


def test_sidecar_endpoint(root):
    add_run(root, "nt_side", result_doc(ZA), {"regress_check.json": '{"identical": true}'})
    api = client(root)
    assert api.get("/api/runs/nt_side/sidecar/regress_check").json() == {"identical": True}
    assert api.get("/api/runs/nt_side/sidecar/result").status_code == 404


def test_compare_endpoint(api):
    body = api.get("/api/runs/compare", params={"ids": f"{ZA},{SIZED}"}).json()
    assert [s["run_id"] for s in body["series"]] == [ZA, SIZED]


@pytest.mark.parametrize("ids", [ZA, "", f"{ZA},{ZA}", ",".join([ZA] * 9)])
def test_compare_needs_two_to_eight_distinct_ids(api, ids):
    assert api.get("/api/runs/compare", params={"ids": ids}).status_code == 422


def test_compare_unknown_id_is_404(api):
    assert api.get("/api/runs/compare", params={"ids": f"{ZA},nt_nope"}).status_code == 404


def test_ledger_endpoint(root):
    write_ledger(root, [ledger_row(ZA, "za_v0_nautilus_zero_slippage")])
    body = client(root).get("/api/ledger").json()
    assert body["ledger_found"] is True and body["rows"][0]["run_id"] == ZA and body["rows"][0]["matches_result"]


def test_detail_ledger_command(api):
    body = api.get(f"/api/runs/{SIZED}").json()
    assert body["ledger_command"]["eligible"] is True and "--exp-id <exp>" in body["ledger_command"]["command"]


def test_runs_routes_are_get_only(api):
    paths = api.app.openapi()["paths"]
    runs = {p: ops for p, ops in paths.items() if p.startswith(("/api/runs", "/api/ledger"))}
    assert len(runs) == 9
    assert all(set(ops) == {"get"} for ops in runs.values())


def test_non_get_is_refused(api):
    assert api.post(f"/api/runs/{ZA}").status_code == 405
    assert api.delete(f"/api/runs/{ZA}").status_code == 405


def test_fixture_mode_default_folder_serves_runs():
    """NQT_FIXTURE_DIR at the Phase 1 fixtures (no copy): every fixture run is listed."""
    from fakes import FIXTURES

    body = client(FIXTURES).get("/api/runs").json()
    assert {x["run_id"] for x in body} == set(RUNS.values())
