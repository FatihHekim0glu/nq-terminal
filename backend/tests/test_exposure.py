"""Exposure and costs (TASKS 3.4; ANALYTICS_CATALOG section 9: EX1 to EX4).

- EX3: the cost waterfall (gross, commissions, modelled slippage, net) sums to `pnl_total`, to
  `balance_check.delta_usd` and, for the costs, to `fees_total`, exactly in decimal, on every fixture shape and
  every usable real run; tampered commissions, totals or an unknown slippage model are refused (born failing).
- EX4: the linear ladder `net(t) = gross - fees - t x tick value x sides` passes through the run's own `pnl_total`
  and reproduces the 0 and 2 tick re-runs of the same books exactly (their fills are identical).
- EX1: gross and net exposure at the raw contract price (the sized books' own `closes[].raw`, dtsmom's `c_none`
  through the gate with caller "terminal"); the back-adjusted snapshot price is born failing (volmanaged would
  break its 2x cap); positions rebuilt from cumulative fills equal the snapshots' `net_qty` (a dropped fill is
  born failing).
- EX2: turnover from the fills path equals the snapshot-difference path; annualised as mean x 252.
"""
from __future__ import annotations

import dataclasses
import math
from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytest

from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_panel import build_panel
from nq_terminal.analytics import exposure
from nq_terminal.services import run_books
from nq_terminal.services.bars import BarService

from fakes import FIXTURES, make_fake_serve
from test_runs_support import RUNS, FakeClock, service

SESSIONS_PER_YEAR = 252
VOLMANAGED_CAP = 2.0 * 1.10  # the 2x cap plus the 10% no-trade band (nq-lab project rules, round 3)
RE_RUNS = {  # the 1-tick run and its 0 and 2 tick re-runs (identical fills, nq-lab project rules, rounds 3 and 8)
    "nt_volmanaged_v0_final_m1": ("nt_volmanaged_v0_final_m0", "nt_volmanaged_v0_final_m2"),
    "nt_volmanaged_v0_final_bh1": ("nt_volmanaged_v0_final_bh0", "nt_volmanaged_v0_final_bh2"),
    "nt_tsmom_v0_m1": ("nt_tsmom_v0_m0", "nt_tsmom_v0_m2"),
    "nt_dtsmom_v0_ts1": ("nt_dtsmom_v0_ts0", "nt_dtsmom_v0_ts2"),
}


@lru_cache(maxsize=1)
def real_runs():
    return service(ROOT, clock=FakeClock())


@lru_cache(maxsize=1)
def fixture_runs():
    return service(FIXTURES, clock=FakeClock())


@lru_cache(maxsize=None)
def fixture_book(shape: str) -> exposure.RunBook:
    return run_books.load_book(fixture_runs(), RUNS[shape])


@lru_cache(maxsize=None)
def real_book(run_id: str) -> exposure.RunBook:
    return run_books.load_book(real_runs(), run_id)


def usable_real_ids() -> list[str]:
    return sorted(s.run_id for s in real_runs().summaries() if s.readable and s.usable and s.n_trades)


SHAPES = ("za_orb", "overnight", "sized", "dtsmom")


# ---------------------------------------------------------------- instruments and sides


def test_intraday_runs_are_one_nq_contract_with_no_modelled_slippage():
    book = fixture_book("za_orb")
    (inst,) = book.instruments
    assert (inst.multiplier, inst.tick_size, inst.cost_per_side) == (Decimal("20"), Decimal("0.25"), Decimal("2.24"))
    assert book.ticks == 0 and inst.tick_value == Decimal("5") and inst.fee_per_side == Decimal("2.24")
    assert exposure.sides(book) == {inst.name: 12}  # six one-contract trades, two sides each


def test_sized_books_split_the_cost_into_fee_and_slippage():
    book = fixture_book("sized")
    (inst,) = book.instruments
    assert inst.name == "MNQ.XCME" and book.ticks == 1
    assert inst.tick_value == Decimal("0.5") and inst.fee_per_side == Decimal("0.61")  # the venue's cost note
    assert exposure.sides(book) == {"MNQ.XCME": sum(int(f["qty"]) for f in book.fills)}


def test_dtsmom_instruments_follow_the_strategy_log_order():
    book = fixture_book("dtsmom")
    names = [i.name for i in book.instruments]
    assert len(names) == 27 and names[:2] == ["ES.XCME", "NQ.XCME"]
    by_name = {i.name: i for i in book.instruments}
    assert by_name["ES.XCME"].tick_value == Decimal("12.5") and by_name["ES.XCME"].fee_per_side == Decimal("2.5")
    assert by_name["ZN.XCME"].tick_value == Decimal("15.625") and by_name["ZN.XCME"].fee_per_side == Decimal("2.5")


# ---------------------------------------------------------------- EX3


@pytest.mark.parametrize("shape", SHAPES)
def test_waterfall_sums_to_pnl_total_on_every_fixture_shape(shape):
    book = fixture_book(shape)
    fall = exposure.cost_waterfall(book)
    assert fall["net"] == book.pnl_total and fall["net"] == book.delta_usd
    assert fall["commissions"] + fall["slippage"] == pytest.approx(book.fees_total, abs=1e-9)
    assert fall["costs_total"] == book.fees_total
    assert fall["gross"] == pytest.approx(book.pnl_total + book.fees_total, abs=1e-6)
    assert [row["step"] for row in fall["rows"]] == ["gross", "commissions", "modelled slippage", "net"]
    assert sum(row["value"] for row in fall["rows"][:3]) == pytest.approx(fall["net"], abs=1e-6)


def test_sized_waterfall_on_hand_numbers():
    book = fixture_book("sized")
    fall = exposure.cost_waterfall(book)
    n = sum(int(f["qty"]) for f in book.fills)
    assert fall["sides"] == n
    assert fall["commissions"] == pytest.approx(0.61 * n, abs=1e-9)
    assert fall["slippage"] == pytest.approx(0.5 * n, abs=1e-9)


def _era_costs(run_id: str) -> bool:
    venue = real_runs().detail(run_id).venue or {}
    rows = venue.get("instruments") if isinstance(venue, dict) else None
    return any(str(r.get("cost_per_side", "")).startswith(exposure.ERA_COST_PREFIX) for r in rows or ())


def test_real_waterfalls_sum_to_pnl_total_and_the_balance_check():
    ids = usable_real_ids()
    assert len(ids) >= 50
    for run_id in ids:
        if _era_costs(run_id):
            with pytest.raises(exposure.CostError, match="changes by era"):
                real_book(run_id)
            continue
        book = real_book(run_id)
        fall = exposure.cost_waterfall(book)
        assert fall["net"] == book.pnl_total == book.delta_usd, run_id
        assert fall["costs_total"] == book.fees_total, run_id


def test_born_failing_a_tampered_fill_commission_is_refused():
    book = fixture_book("sized")
    fills = [dict(f) for f in book.fills]
    fills[0]["commission"] = str(Decimal(fills[0]["commission"]) + Decimal("0.01"))
    with pytest.raises(exposure.CostError, match="commission"):
        exposure.cost_waterfall(dataclasses.replace(book, fills=tuple(fills)))


def test_born_failing_a_tampered_trade_commission_is_refused():
    book = fixture_book("za_orb")
    trades = [dict(t) for t in book.trades]
    trades[0]["commissions_usd"] = 4.49
    with pytest.raises(exposure.CostError, match="commission"):
        exposure.cost_waterfall(dataclasses.replace(book, trades=tuple(trades)))


@pytest.mark.parametrize("field", ["pnl_total", "fees_total", "delta_usd"])
def test_born_failing_a_total_that_does_not_add_up_is_refused(field):
    book = fixture_book("dtsmom")
    tampered = dataclasses.replace(book, **{field: getattr(book, field) + 0.01})
    with pytest.raises(exposure.CostError, match=field):
        exposure.cost_waterfall(tampered)


def test_born_failing_an_unknown_slippage_model_is_refused():
    detail = fixture_runs().detail(RUNS["za_orb"])
    venue = {**detail.venue, "fill_model": {"prob_fill_on_limit": 0.0, "prob_slippage": 0.5}}
    with pytest.raises(exposure.CostError, match="slippage"):
        exposure.instruments_of(detail.summary.strategy, detail.data, venue, detail.log_meta)


def test_an_unusable_run_gets_no_book():
    with pytest.raises(exposure.BookUnusable, match="rule 4"):
        run_books.load_book(fixture_runs(), RUNS["unbalanced"])


# ---------------------------------------------------------------- EX4


@pytest.mark.parametrize("shape", SHAPES)
def test_ladder_passes_through_the_runs_own_pnl_and_is_linear(shape):
    book = fixture_book(shape)
    ladder = exposure.cost_sensitivity(book)
    assert ladder["ticks"] == [0, 1, 2, 3, 4]
    assert ladder["net_usd"][book.ticks] == book.pnl_total
    steps = [b - a for a, b in zip(ladder["net_usd"], ladder["net_usd"][1:])]
    assert all(step == pytest.approx(-ladder["cost_per_tick_usd"], rel=1e-12) for step in steps)
    be = ladder["break_even_ticks_per_side"]
    assert ladder["net_usd"][0] - be * ladder["cost_per_tick_usd"] == pytest.approx(0.0, abs=1e-6)
    assert ladder["net_pct_of_k"][0] == pytest.approx(ladder["net_usd"][0] / book.starting_usd, rel=1e-12)


@pytest.mark.parametrize("run_id", sorted(RE_RUNS))
def test_ladder_reproduces_the_zero_and_two_tick_re_runs_exactly(run_id):
    ladder = exposure.cost_sensitivity(real_book(run_id))
    zero, two = RE_RUNS[run_id]
    assert ladder["net_usd"][0] == real_book(zero).pnl_total
    assert ladder["net_usd"][1] == real_book(run_id).pnl_total
    assert ladder["net_usd"][2] == real_book(two).pnl_total


# ---------------------------------------------------------------- EX1


def hand_exposure(book: exposure.RunBook, prices) -> tuple[list[float], list[float]]:
    gross, net = [], []
    mult = [float(i.multiplier) for i in book.instruments]
    for snap, px in zip(book.snapshots, prices):
        qty = snap["net_qty"] if isinstance(snap["net_qty"], list) else [snap["net_qty"]]
        eq = float(snap["equity"])
        gross.append(sum(abs(q * m * p) for q, m, p in zip(qty, mult, px) if q) / eq)
        net.append(sum(q * m * p for q, m, p in zip(qty, mult, px) if q) / eq)
    return gross, net


def fake_bars(tmp_path: Path) -> tuple[BarService, object]:
    serve = make_fake_serve(tmp_path / "oos_access_log.jsonl")
    return BarService(serve, cache_bytes=256 * 1024**2), serve


def test_sized_exposure_uses_the_raw_close_the_run_recorded():
    book = fixture_book("sized")
    closes = {c["date"]: c["raw"] for c in fixture_runs().log(RUNS["sized"], "closes", 0, 100).items}
    prices = [[closes[s["date"]]] for s in book.snapshots]
    expo = exposure.exposure(book)
    gross, net = hand_exposure(book, prices)
    assert expo["date"] == [s["date"] for s in book.snapshots]
    assert expo["gross"] == pytest.approx(gross, rel=1e-12, abs=1e-15)
    assert expo["net"] == pytest.approx(net, rel=1e-12, abs=1e-15)
    assert expo["price_basis"] == exposure.PRICE_RAW_RUN and expo["positions_reconcile"] is True
    assert expo["unit"] == "notional over equity"


def test_dtsmom_exposure_at_raw_prices_through_the_gate(tmp_path):
    book = fixture_book("dtsmom")
    bars, serve = fake_bars(tmp_path)
    raw = run_books.gated_raw_prices(bars, book)
    assert serve.served and all(c.caller == "terminal" for c in serve.calls)
    frames = {f"{i.name.split('.')[0]}.V.0": bars.frame(f"{i.name.split('.')[0]}.V.0", "1d", "vendor", IS_START,
                                                          IS_END).frame for i in book.instruments}
    panel = build_panel(frames, [date.fromisoformat(s["date"]) for s in book.snapshots])
    assert np.array_equal(raw, panel.N, equal_nan=True)
    expo = exposure.exposure(book, raw_px=raw)
    gross, net = hand_exposure(book, raw.tolist())
    assert expo["gross"] == pytest.approx(gross, rel=1e-12, abs=1e-15)
    assert expo["net"] == pytest.approx(net, rel=1e-12, abs=1e-15)
    assert expo["price_basis"] == exposure.PRICE_RAW_GATE


def test_without_raw_prices_the_snapshot_price_is_named_as_back_adjusted():
    book = fixture_book("dtsmom")
    expo = exposure.exposure(book)
    gross, _ = hand_exposure(book, [s["px"] for s in book.snapshots])
    assert expo["gross"] == pytest.approx(gross, rel=1e-12, abs=1e-15)
    assert expo["price_basis"] == exposure.PRICE_SNAPSHOT and "back adjusted" in expo["price_basis"]


def test_raw_prices_must_fit_the_snapshot_grid():
    book = fixture_book("dtsmom")
    with pytest.raises(exposure.ExposureError, match="raw prices"):
        exposure.exposure(book, raw_px=np.ones((len(book.snapshots), 3)))
    held = np.full((len(book.snapshots), 27), np.nan)
    with pytest.raises(exposure.ExposureError, match="price"):
        exposure.exposure(book, raw_px=held)  # a held instrument without a price


def test_real_volmanaged_exposure_respects_its_cap_only_at_raw_prices():
    book = real_book("nt_volmanaged_v0_final_m1")
    assert max(exposure.exposure(book)["gross"]) <= VOLMANAGED_CAP
    back = dataclasses.replace(book, raw_closes=())  # born failing: the back-adjusted snapshot price
    assert max(exposure.exposure(back)["gross"]) > VOLMANAGED_CAP


def test_dtsmom_exposure_by_instrument_sums_to_gross():
    expo = exposure.exposure(fixture_book("dtsmom"))
    held = expo["by_instrument"]
    assert set(held) == {"ES.XCME", "CL.XCME", "GC.XCME", "ZN.XCME"}  # the fixture's four-leg book
    total = [sum(values) for values in zip(*held.values())]
    assert total == pytest.approx(expo["gross"], rel=1e-12, abs=1e-15)


def test_born_failing_positions_from_fills_disagree_when_a_fill_is_dropped():
    book = fixture_book("dtsmom")
    short = dataclasses.replace(book, fills=book.fills[1:])
    assert exposure.exposure(short)["positions_reconcile"] is False


def test_real_positions_from_fills_equal_the_snapshots():
    for run_id in ("nt_volmanaged_v0_final_m1", "nt_tsmom_v0_m1", "nt_dtsmom_v0_ts1"):
        assert exposure.exposure(real_book(run_id))["positions_reconcile"] is True, run_id


@pytest.mark.parametrize("shape", ["za_orb", "overnight"])
def test_runs_without_snapshots_have_no_exposure_or_turnover(shape):
    book = fixture_book(shape)
    assert exposure.exposure(book) is None and exposure.turnover(book) is None


# ---------------------------------------------------------------- EX2


@pytest.mark.parametrize("shape", ["sized", "dtsmom"])
def test_turnover_fills_path_equals_the_snapshot_path(shape):
    book = fixture_book(shape)
    fills, snaps = exposure.turnover(book, "fills"), exposure.turnover(book, "snapshots")
    assert fills["daily"] == pytest.approx(snaps["daily"], rel=1e-12, abs=1e-15)
    assert fills["annualised"] == pytest.approx(sum(fills["daily"]) / len(fills["daily"]) * SESSIONS_PER_YEAR,
                                                rel=1e-12)


def test_sized_turnover_on_the_entry_day_by_hand():
    book = fixture_book("sized")
    day = exposure.turnover(book)
    i = day["date"].index("2011-06-06")
    snap, raw = book.snapshots[i], book.raw_closes[i]
    assert day["daily"][i] == pytest.approx(20 * 2.0 * raw / float(snap["equity"]), rel=1e-12)
    assert day["price_basis"] == exposure.PRICE_RAW_RUN


def test_real_turnover_paths_agree():
    for run_id in ("nt_volmanaged_v0_final_m1", "nt_dtsmom_v0_ts1"):
        book = real_book(run_id)
        a, b = exposure.turnover(book, "fills"), exposure.turnover(book, "snapshots")
        assert a["daily"] == pytest.approx(b["daily"], rel=1e-12, abs=1e-15), run_id
        assert math.isfinite(a["annualised"]) and a["annualised"] > 0


def test_turnover_refuses_an_unknown_source():
    with pytest.raises(ValueError, match="source"):
        exposure.turnover(fixture_book("sized"), "orders")
