"""DES extracts (ARCHITECTURE s3.2, UI_SPEC s7 DES): headline with unit and basis, t statistic, blocks, cost ladder.

Every value is read from the real screen JSON at a path fixed in `nq_terminal.des_shapes`; nothing is recomputed.
The QA findings these pin down: the sizing screens' `dsr` (a Sharpe difference, ANALYTICS_CATALOG C4) must never
be shown under that name, and the `za_v0_C3_gao_momentum` card must show its own block, not za_v0's headline.
"""
from __future__ import annotations

import json
import math

import pytest

from nq_lab.config import ROOT
from nq_terminal import des_shapes
from nq_terminal.services.research import ResearchService

SCREENS = ROOT / "results" / "screens"


@pytest.fixture(scope="module")
def real() -> ResearchService:
    return ResearchService(ROOT)


@pytest.fixture(scope="module")
def cards(real):
    return {c.name: c for c in real.cards()}


def _screen(stem: str) -> dict:
    return json.loads((SCREENS / f"{stem}.json").read_text(encoding="utf-8"))


def test_no_card_label_names_the_sharpe_difference_dsr(cards):
    for card in cards.values():
        for text in (card.headline_label or "", card.headline_display or ""):
            assert "dsr" not in text.lower(), (card.name, text)


def test_sizing_headlines_show_the_managed_sharpe_with_unit_and_basis(cards):
    vol = cards["volmanaged_v0"]
    assert vol.headline_label == "headline.1tick.sharpe_m"
    assert vol.headline_value == pytest.approx(_screen("volmanaged_v0")["headline"]["1tick"]["sharpe_m"], abs=0)
    assert vol.headline_basis == "A" and "Sharpe" in vol.headline_unit
    tsm = cards["tsmom_v0"]
    assert tsm.headline_label == "headline.1tick.sharpe_a" and tsm.headline_basis == "A"


def test_the_c3_card_shows_its_own_block_and_no_parent_pass_checks(cards):
    c3 = cards["za_v0_C3_gao_momentum"]
    block = _screen("za_v0_repaired")["C3_gao_momentum"]
    assert c3.headline_label == "C3_gao_momentum.mean_pts"
    assert c3.headline_value == block["mean_pts"] and round(c3.headline_value, 4) == -0.8085
    assert c3.t_stat == block["t"]
    assert c3.pass_checks == []
    assert cards["za_v0"].headline_label == "v0.mean_r"


def test_every_registered_card_has_headline_unit_and_t(cards):
    """Every row with a Shape shows its headline, unit and t; a screen with no t statistic (a bootstrap gate) declares
    that in its shape, and the card's t label says why the value is empty. A row the lab registered after this release
    (no Shape yet) is a plain card: named, with no figures, never an error."""
    for card in cards.values():
        if not card.registered:
            continue
        if card.name not in des_shapes.SHAPES:
            assert card.t_stat is None and card.t_label is None, card.name
            assert card.headline_value is None or math.isfinite(card.headline_value), card.name
            continue
        hint = f"{card.name}: add a Shape for it to SHAPES in nq_terminal/des_shapes.py"
        assert card.name in des_shapes.SHAPES, hint
        assert card.headline_value is not None and math.isfinite(card.headline_value), hint
        assert card.headline_unit and card.headline_display and card.t_label, hint
        if des_shapes.SHAPES[card.name].t is None:
            assert card.t_stat is None and "no t statistic" in card.t_label, card.name
        else:
            assert card.t_stat is not None and math.isfinite(card.t_stat), hint


def test_round_13_and_14_headlines_come_from_their_screens(cards):
    vt, vrp = cards["vt_har_v0"], cards["vrp_eq_v0"]
    assert vt.headline_label == "headline.rho_bar"
    assert vt.headline_value == _screen("vt_har_v0")["headline"]["rho_bar"]
    assert vt.t_stat is None and "bootstrap" in vt.t_label
    head = _screen("vrp_eq_v0")["headline"]
    assert vrp.headline_label == "headline.alpha_annual_pct" and vrp.headline_value == head["alpha_annual_pct"]
    assert vrp.t_stat == head["t_a"] == min(head["t_nw"].values())
    assert vrp.headline_unit == "% per year"


def test_round_13_and_14_blocks_and_ladders_match_the_json(real):
    vt = real.detail("vt_har_v0").des
    screen = _screen("vt_har_v0")
    blocks = screen["secondaries"]["S6_blocks"]
    assert [(b.label, b.value) for b in vt.blocks] == [(k, v["rho_bar"]) for k, v in blocks.items()]
    assert [(p.ticks_per_side, p.value) for p in vt.cost_ladder] == [
        (1, screen["headline"]["rho_bar"]), (2, screen["P4_two_ticks"]["rho_bar"])]
    vrp = real.detail("vrp_eq_v0").des
    screen = _screen("vrp_eq_v0")
    assert [(b.label, b.value) for b in vrp.blocks] == [
        (k, v["alpha_annual_pct"]) for k, v in screen["P2_blocks"].items()]
    assert [(p.ticks_per_side, p.value) for p in vrp.cost_ladder] == [
        (1, screen["headline"]["alpha_annual_pct"]), (2, screen["P3_2tick"]["alpha_annual_pct"])]


def test_new_rounds_find_their_summary_by_title_without_a_table_entry(cards, real):
    """Rounds 13 and 14 are not in constants.ROUNDS: the summary whose title names the row gives the round."""
    from nq_terminal import constants
    assert "vt_har_v0" not in constants.ROUNDS and "vrp_eq_v0" not in constants.ROUNDS
    assert cards["vt_har_v0"].round == 13 and cards["vrp_eq_v0"].round == 14
    assert real.detail("vrp_eq_v0").summary_name == "round14_summary.md"


def test_every_shape_path_resolves_to_a_number_on_the_real_screens():
    """Born failing for a typo in the table: each declared path must reach a finite number in the file."""
    for name, shape in des_shapes.SHAPES.items():
        screen = _screen(des_shapes.screen_stem(name))
        for path in shape.paths():
            value = des_shapes.resolve(screen, path)
            assert isinstance(value, (int, float)) and math.isfinite(value), (name, path, value)


def test_resolve_refuses_a_missing_path():
    assert des_shapes.resolve({"a": {"b": 1.5}}, "a.b") == 1.5
    assert des_shapes.resolve({"a": {"b": 1.5}}, "a.c") is None
    assert des_shapes.resolve({"a": {"b": "x"}}, "a.b") is None


def test_blocks_and_cost_ladder_match_the_json(real):
    rebal = real.detail("rebal_v0").des
    screen = _screen("rebal_v0")["headline"]
    assert [b.label for b in rebal.blocks] == ["2010-13", "2014-17", "2018-21"]
    assert [b.value for b in rebal.blocks] == [screen["blocks"][k]["mean"] for k in ("2010-13", "2014-17", "2018-21")]
    assert [(p.ticks_per_side, p.value) for p in rebal.cost_ladder] == [
        (k, screen["cost_ladder"][f"nq_{k}"]["mean"]) for k in (0, 1, 2)]
    assert rebal.break_even_ticks_per_side is None


def test_volmanaged_ladder_and_break_even_come_from_the_json(real):
    vol = real.detail("volmanaged_v0").des
    ladder = _screen("volmanaged_v0")["cost_ladder"]
    assert vol.break_even_ticks_per_side == ladder["break_even_ticks_per_side"]
    assert [p.value for p in vol.cost_ladder] == [ladder["ladder"][f"{k}tick"]["alpha_annual_pct"] for k in (0, 1, 2)]
    assert [b.label for b in vol.blocks] == ["2010-13", "2014-17", "2018-21"]


def test_a_screen_without_a_shape_falls_back_without_dsr(tmp_path):
    screen = {"headline": {"1tick": {"sharpe_m": 1.0, "dsr": -0.1}}}
    label, value = des_shapes.fallback_headline(screen)
    assert (label, value) == ("headline.1tick.sharpe_m", 1.0)
    label, value = des_shapes.fallback_headline({"headline": {"1tick": {"dsr": -0.1}}})
    assert (label, value) == (None, None)


def test_confirmations_link_to_their_parent(real, cards):
    assert "rebal_v1_confirm" in cards["rebal_v0"].confirmations
    assert {"rebal_v1_confirm", "rebal_v1_confirm_trades"} <= set(cards["rebal_v0"].sealed)
    assert {"volmanaged_oos", "volmanaged_oos_daily"} <= set(cards["volmanaged_v0"].sealed)
    by_name = {c.name: c for c in real.confirmations()}
    assert by_name["rebal_v1_confirm"].parent == "rebal_v0"
