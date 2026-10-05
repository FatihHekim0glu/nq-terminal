"""Launch presets (vnext product-1): the ledger rows of registered strategies, offered as starting points.

Built from `results/ledger.csv` only (read through the run service's file cache, no price read), newest first,
de-duplicated by (strategy, params, variant, start, end). A row of a strategy the terminal does not know is skipped,
and so is any row whose window leaves `[2010-01-01, 2022-01-01)`. A row whose params the job spec would refuse is
listed with `launchable` false and the reasons. Each strategy offered carries its named parameter schema.
"""
from __future__ import annotations

import pytest

from nq_terminal.services import presets as presets_service

from actions_support import OVERNIGHT, OVERNIGHT_EXP, ZA, ZA_EXP, make_root, runs_for, snapshot


@pytest.fixture
def root(tmp_path):
    return make_root(tmp_path)


def by_id(listing) -> dict:
    return {p.preset_id: p for p in listing.presets}


def test_presets_come_from_the_ledger_newest_first(root) -> None:
    listing = presets_service.list_presets(runs_for(root))
    assert listing.ledger_found is True
    assert [p.preset_id for p in listing.presets] == ["nt_bh_ok_fixture", "nt_bh_fixture", OVERNIGHT, ZA]


def test_a_repeated_config_is_offered_once_from_its_newest_row(root) -> None:
    ids = [p.preset_id for p in presets_service.list_presets(runs_for(root)).presets]
    assert "nt_za_v0_fixture_old" not in ids and ZA in ids


def test_an_unknown_strategy_and_windows_past_the_fence_are_never_offered(root) -> None:
    listing = presets_service.list_presets(runs_for(root))
    strategies = {p.strategy for p in listing.presets}
    assert "mystery" not in strategies
    assert all(p.end <= "2022-01-01" and p.start >= "2010-01-01" for p in listing.presets)
    assert not {"nt_za_late_fixture", "nt_za_early_fixture", "nt_mystery_fixture"} & set(by_id(listing))


def test_a_preset_carries_its_config_and_ledger_facts(root) -> None:
    za = by_id(presets_service.list_presets(runs_for(root)))[ZA]
    assert (za.exp_id, za.strategy, za.variant, za.start, za.end) == (ZA_EXP, "za_orb", "repaired", "2010-09-28",
                                                                      "2022-01-01")
    assert za.params == {"or_minutes": 5, "target_r": 10.0}
    assert za.run_found is True and za.launchable is True and za.reasons == []
    assert za.runtime_s == 28.3
    overnight = by_id(presets_service.list_presets(runs_for(root)))[OVERNIGHT]
    assert overnight.exp_id == OVERNIGHT_EXP and overnight.params == {"exit_at": "open_tick"}


def test_a_row_the_job_spec_would_refuse_is_listed_but_not_launchable(root) -> None:
    bh = by_id(presets_service.list_presets(runs_for(root)))["nt_bh_fixture"]
    assert bh.launchable is False and bh.run_found is False
    assert any("t0" in reason for reason in bh.reasons)


def test_a_volmanaged_bh_row_with_an_in_sample_t0_is_launchable(root) -> None:
    bh = by_id(presets_service.list_presets(runs_for(root)))["nt_bh_ok_fixture"]
    assert bh.launchable is True and bh.reasons == [] and bh.params["t0"] == "2011-04-21"


def test_each_offered_strategy_carries_its_parameter_schema(root) -> None:
    listing = presets_service.list_presets(runs_for(root))
    schemas = {s.strategy: s for s in listing.strategies}
    assert set(schemas) == {p.strategy for p in listing.presets}
    assert {f.name for f in schemas["za_orb"].params} == {"or_minutes", "target_r", "trade_size"}


def test_no_ledger_means_no_presets(tmp_path) -> None:
    listing = presets_service.list_presets(runs_for(make_root(tmp_path, ledger=False)))
    assert listing.ledger_found is False and listing.presets == [] and listing.strategies == []


def test_a_preset_is_found_by_its_id_and_an_unknown_id_is_refused(root) -> None:
    runs = runs_for(root)
    assert presets_service.find_preset(runs, ZA).strategy == "za_orb"
    for bad in ("nt_unknown", "nt_mystery_fixture", "nt_za_late_fixture", "../ledger", ""):
        with pytest.raises(presets_service.UnknownPreset):
            presets_service.find_preset(runs, bad)


def test_listing_presets_writes_nothing(root) -> None:
    before = snapshot(root)
    presets_service.list_presets(runs_for(root))
    assert snapshot(root) == before
