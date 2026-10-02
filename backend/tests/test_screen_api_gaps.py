"""API gaps the Phase 6 and 7 screen builders reported, closed at the merge (TASKS Phases 6 and 7).

- No response carries a local path: the sealed JSON's `data.serves.*.cache` and the specs' prose held absolute
  paths under the user's home folder (ARCHITECTURE s4: errors and details never carry a path).
- DES blocks: a shape without a block path read the whole screen's top-level keys as blocks (halloween_v0, the C3
  check); halloween_v0 now reads its winter blocks and its 1 and 2 tick ladder; rounds 10 to 12 have shapes.
- Confirmations carry their own spec's pass bar and hypothesis, so the confirmation DES can show them verbatim.
- A run's equity accepts `net_qty` keyed by contract (the multi-contract books of round 11 write a mapping).
- RUNS reads Sharpe and max drawdown from a stats-only route that takes every readable run in one request.
- Exposure, turnover and the paper performance rows carry `t` (epoch seconds at 00:00 UTC of the session date),
  the axis every other chart uses; the performance rows carry the journal `line_no` of each close.
- HOME [B] carries its drawdown unit, its rolling Sharpe unit and the two alpha tiles of the tear sheet.
- The universe rows carry each contract's tick and tick value, so prices print to the served tick.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_terminal import des_shapes
from nq_terminal.app import create_app
from nq_terminal.models.runs import EquitySeries
from nq_terminal.services import journals
from nq_terminal.services.files import redact_local_paths
from nq_terminal.services.market import universe
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve, synthetic_loader

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
SCREENS = ROOT / "results" / "screens"
WINDOWS_HOME = re.compile(r"[A-Za-z]:\\+Users\\+[^\\\"]+", re.IGNORECASE)
FIXTURE_RUN = "nt_dtsmom_v0_fixture_ts1"


def client_for(root, serve=None) -> TestClient:
    settings = load_settings({} if root is None else {"NQT_FIXTURE_DIR": str(root)})
    app = create_app(settings)
    if serve is not None:
        app.state.serve_fn = serve
        if settings.fixture_mode:
            app.state.catalog = FakeCatalog()
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


@pytest.fixture(scope="module")
def real() -> ResearchService:
    return ResearchService(ROOT)


@pytest.fixture(scope="module")
def fixture_api() -> TestClient:
    return client_for(FIXTURES)


@pytest.fixture(scope="module")
def real_api(tmp_path_factory) -> TestClient:
    return client_for(None, make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))


def _screen(stem: str) -> dict:
    return json.loads((SCREENS / f"{stem}.json").read_text(encoding="utf-8"))


def _leaks(text: str) -> list[str]:
    home = str(Path.home())
    found = WINDOWS_HOME.findall(text)
    return found + ([home] if home in text or home.replace("\\", "\\\\") in text else [])


# ---------------------------------------------------------------- no local path in a response


def test_redact_local_paths_keeps_the_part_below_the_root_and_hides_the_home_folder():
    root = Path("C:/Users/Some One/nq-lab")
    doc = {"cache": "C:\\Users\\Some One\\nq-lab\\results\\sealed\\qa.json",
           "note": "from C:\\Users\\Some One\\nq-lab\\RULES.md and C:\\Users\\Other\\x.py",
           "posix": "/home/someone/data/x.csv", "mac": "/Users/someone/y", "n": 3, "list": ["plain text", None],
           "slashes": "C:/Users/Some One/nq-lab/results/a.json"}
    out = redact_local_paths(doc, root)
    assert out["cache"] == "results\\sealed\\qa.json"
    assert out["note"] == "from RULES.md and ~\\x.py"
    assert out["posix"] == "~/data/x.csv" and out["mac"] == "~/y"
    assert out["slashes"] == "results/a.json"
    assert out["n"] == 3 and out["list"] == ["plain text", None]
    assert doc["cache"].startswith("C:\\Users"), "the input is not changed"


def test_born_failing_the_leak_check_sees_a_home_path():
    assert _leaks(json.dumps({"cache": "C:\\Users\\Some One\\nq-lab\\x"}))


def test_no_sealed_view_carries_a_local_path(real):
    for item in real.sealed_index():
        view = real.sealed(item.name)
        text = json.dumps(view.model_dump(), ensure_ascii=False)
        assert _leaks(text) == [], (item.name, _leaks(text)[:2])


def test_no_hypothesis_detail_carries_a_local_path(real):
    for row in real.registry_rows():
        text = json.dumps(real.detail(row.name).model_dump(), ensure_ascii=False)
        assert _leaks(text) == [], (row.name, _leaks(text)[:2])


def test_no_qa_report_carries_a_local_path(real_api):
    names = [r["name"] for r in real_api.get("/api/qa").json()["reports"]]
    assert names, "no QA report listed: the scan would pass vacuously"
    for name in names:
        r = real_api.get(f"/api/qa/{name}")
        if r.status_code != 200:
            continue
        assert _leaks(r.text) == [], (name, _leaks(r.text)[:2])


def test_the_sealed_cache_keeps_its_file_name_below_the_data_root(real):
    names = {item.name for item in real.sealed_index()}
    if "volmanaged_oos" not in names:
        pytest.skip("no sealed volmanaged_oos file under this root")
    serves = real.sealed("volmanaged_oos").data["serves"]
    caches = [s["cache"] for s in (serves.values() if isinstance(serves, dict) else serves) if "cache" in s]
    assert caches and all(c.startswith("data") and c.endswith(".parquet") for c in caches), caches


# ---------------------------------------------------------------- DES blocks and shapes


def test_a_shape_without_a_block_path_has_no_blocks():
    shape = des_shapes.Shape("a", "A", "unit", "t", "t")
    assert des_shapes.blocks({"name": "x", "serve": {"a": 1}, "n": 3}, shape) == []


def test_the_c3_check_has_no_blocks_of_the_screen_keys(real):
    des = real.detail("za_v0_C3_gao_momentum").des
    assert des.blocks == [] and des.blocks_unit is None


def test_halloween_blocks_and_ladder_match_the_json(real):
    des = real.detail("halloween_v0").des
    book = _screen("halloween_v0")["winter_book"]
    assert [(b.label, b.value) for b in des.blocks] == [(k, v["mean"]) for k, v in book["blocks"].items()]
    assert [(p.ticks_per_side, p.value) for p in des.cost_ladder] == [
        (1, book["per_day"]["mean"]), (2, book["per_day_2tick"]["mean"])]
    assert des.blocks_unit and des.cost_ladder_unit


@pytest.mark.parametrize("name, number", [("carry_v0", 10), ("eomtsy_v0", 11), ("cskew_v0", 12)])
def test_rounds_10_to_12_have_a_round_headline_unit_and_t(real, name, number):
    if name not in {r.name for r in real.registry_rows()}:
        pytest.skip(f"{name} is not in this registry")
    card = real.card(name)
    screen = _screen(name)
    assert card.round == number
    assert card.headline_value == screen["headline"]["mean_pct"] and card.headline_unit
    assert card.headline_display and "." not in card.headline_display
    assert card.t_stat == screen["headline"]["t_nw"] and card.t_label
    des = real.detail(name).des
    assert [(b.label, b.value) for b in des.blocks] == [(k, v["mean_pct"]) for k, v in screen["blocks"].items()]
    assert len(des.cost_ladder) == 3 and all(p.value is not None for p in des.cost_ladder)


def test_eomtsy_ladder_reads_its_own_cost_ladder(real):
    if "eomtsy_v0" not in {r.name for r in real.registry_rows()}:
        pytest.skip("eomtsy_v0 is not in this registry")
    ladder = _screen("eomtsy_v0")["cost_ladder_mean_pct"]
    des = real.detail("eomtsy_v0").des
    assert [(p.ticks_per_side, p.value) for p in des.cost_ladder] == [(k, ladder[f"{k}_tick"]) for k in (0, 1, 2)]


# ---------------------------------------------------------------- confirmations carry their spec


def test_a_confirmation_carries_its_spec_pass_bar_and_hypothesis(real):
    found = {c.name: c for c in real.confirmations()}
    if "rebal_v1_confirm" not in found:
        pytest.skip("no sealed confirmation under this root")
    spec = json.loads((ROOT / found["rebal_v1_confirm"].spec).read_text(encoding="utf-8"))
    assert found["rebal_v1_confirm"].pass_bar == spec["pass_bar"]
    assert found["rebal_v1_confirm"].hypothesis == spec["hypothesis"]


# ---------------------------------------------------------------- runs


def test_equity_accepts_net_qty_keyed_by_contract():
    series = EquitySeries(run_id="r", source="mtm_snapshots", label="x", usable=True, unusable_reason=None,
                          starting_usd=1.0, final_usd=1.0, n_sessions=2, sessions_match=None, t=[1, 2],
                          date=["2011-01-03", "2011-01-04"], equity=[1.0, 1.0], pnl=[0.0, 0.0],
                          net_qty=[{}, {"ZBH2011.XCME": 173, "ZTH2011.XCME": 973}])
    assert series.net_qty == [{}, {"ZBH2011.XCME": 173, "ZTH2011.XCME": 973}]


def test_run_stats_take_every_readable_run_in_one_request(fixture_api):
    ids = [r["run_id"] for r in fixture_api.get("/api/runs").json() if r["readable"]]
    assert len(ids) >= 1
    body = fixture_api.get("/api/runs/stats", params={"ids": ",".join(ids)}).json()
    assert [s["run_id"] for s in body] == ids
    compare_ids = ids[:2] if len(ids) >= 2 else None
    if compare_ids:
        compare = fixture_api.get("/api/runs/compare", params={"ids": ",".join(compare_ids)}).json()["stats"]
        assert body[:2] == compare


def test_run_stats_take_a_single_run_and_refuse_duplicates_and_unknown_ids(fixture_api):
    assert fixture_api.get("/api/runs/stats", params={"ids": FIXTURE_RUN}).status_code == 200
    assert fixture_api.get("/api/runs/stats", params={"ids": f"{FIXTURE_RUN},{FIXTURE_RUN}"}).status_code == 422
    assert fixture_api.get("/api/runs/stats", params={"ids": ""}).status_code == 422
    assert fixture_api.get("/api/runs/stats", params={"ids": "no_such_run"}).status_code == 404
    assert fixture_api.post("/api/runs/stats", params={"ids": FIXTURE_RUN}).status_code == 405


def _epoch(date: str) -> int:
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp())


def test_exposure_and_turnover_carry_t_at_midnight_utc(fixture_api):
    body = fixture_api.get(f"/api/analytics/run/{FIXTURE_RUN}/exposure").json()
    assert body["available"] is True
    for view in (body["exposure"], body["turnover"]):
        assert view["t"] == [_epoch(d) for d in view["date"]] and len(view["t"]) > 0


# ---------------------------------------------------------------- live performance rows


def test_performance_rows_carry_t_and_their_journal_line(fixture_api):
    body = fixture_api.get("/api/live/performance").json()
    assert body["t"] == [None if d is None else _epoch(d) for d in body["date"]]
    rows = journals.JournalTailer(FIXTURES / "live" / "logs" / body["journal"]).poll().rows
    close_lines = {r.line_no: r.data.get("date") for r in rows if r.data.get("type") == "close"}
    assert len(body["line_no"]) == len(body["date"])
    assert [close_lines[n] for n in body["line_no"]] == body["date"]


# ---------------------------------------------------------------- HOME [B]


def test_home_panel_carries_its_units_and_the_tear_sheet_alpha_tiles(fixture_api):
    panel = fixture_api.get("/api/analytics/hypothesis/volmanaged_v0/panel").json()
    full = fixture_api.get("/api/analytics/hypothesis/volmanaged_v0").json()
    assert panel["drawdown_unit"] == full["drawdown"]["unit"]
    assert panel["rolling_unit_label"] == full["rolling"]["sharpe_unit"] == full["ci"]["unit"]
    tiles = {k["key"]: k for k in full["kpis"]}
    assert [a["key"] for a in panel["alpha"]] == ["alpha_annual", "alpha_t"]
    for tile in panel["alpha"]:
        assert tile == tiles[tile["key"]]


# ---------------------------------------------------------------- the universe


def test_universe_rows_carry_the_contract_tick():
    frames = {f"{c.root}.V.0": synthetic_loader(f"{c.root}.V.0", "1d")(IS_START, IS_END) for c in TABLE}
    out = universe(frames, window=252, contracts=TABLE)
    ticks = {c.root: (c.tick, c.tick_usd) for c in TABLE}
    for row in out.rows:
        assert (row.tick, row.tick_usd) == ticks[row.root]

