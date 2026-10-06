"""Launch presets (vnext product-1): the ledger rows of registered strategies, offered as starting points.

Built from `results/ledger.csv` only (read through the run service's file cache, no price read), newest first,
de-duplicated by (strategy, params, variant, start, end). A row of a strategy the terminal does not know is skipped,
and so is any row whose window leaves `[2010-01-01, 2022-01-01)`. A row whose params the job spec would refuse is
listed with `launchable` false and the reasons. Each strategy offered carries its named parameter schema.

Each preset carries `spec_sha256`, the sha256 of `experiments/<exp_id>.json` when that file exists (read only, through
the run service's cache), else None; an exp id that is not a plain file stem never names a file.
"""
from __future__ import annotations

import hashlib

import pytest

from nq_terminal.services import presets as presets_service

from actions_support import (OVERNIGHT, OVERNIGHT_EXP, ZA, ZA_EXP, add_specs, ledger_rows, make_root, row, runs_for,
                             snapshot)
from test_runs_support import write_ledger


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


# ---------------------------------------------------------------- spec hashes


def test_a_preset_carries_the_sha256_of_its_spec_file(root) -> None:
    hashes = add_specs(root)
    listing = by_id(presets_service.list_presets(runs_for(root)))
    assert listing[ZA].spec_sha256 == hashes[ZA_EXP]
    assert listing["nt_bh_ok_fixture"].spec_sha256 == hashes["volmanaged_v0_ok"]
    expected = hashlib.sha256((root / "experiments" / f"{ZA_EXP}.json").read_bytes()).hexdigest()
    assert listing[ZA].spec_sha256 == expected and len(expected) == 64


def test_a_preset_without_a_spec_file_carries_no_hash(root) -> None:
    add_specs(root)
    listing = by_id(presets_service.list_presets(runs_for(root)))
    assert OVERNIGHT_EXP not in {p.stem for p in (root / "experiments").iterdir()}
    assert listing[OVERNIGHT].spec_sha256 is None
    assert listing["nt_bh_fixture"].spec_sha256 is None


def test_no_experiments_folder_means_no_hashes(root) -> None:
    assert not (root / "experiments").exists()
    assert all(p.spec_sha256 is None for p in presets_service.list_presets(runs_for(root)).presets)


def test_an_exp_id_that_is_not_a_plain_stem_names_no_file(root) -> None:
    add_specs(root)
    (root / "results" / "ledger.json").write_text("{}", encoding="utf-8")
    rows = [*ledger_rows(),
            row("nt_escape_fixture", "../results/ledger", "za_orb", {"or_minutes": 7, "target_r": 3.0},
                ts="2026-09-26T08:00:00+00:00"),
            row("nt_nested_fixture", "drafts/x", "za_orb", {"or_minutes": 8, "target_r": 3.0},
                ts="2026-09-26T08:30:00+00:00")]
    write_ledger(root, rows)
    listing = by_id(presets_service.list_presets(runs_for(root)))
    assert listing["nt_escape_fixture"].spec_sha256 is None
    assert listing["nt_nested_fixture"].spec_sha256 is None


def test_an_edited_spec_file_gives_a_new_hash(root) -> None:
    add_specs(root)
    runs = runs_for(root)
    before = by_id(presets_service.list_presets(runs))[ZA].spec_sha256
    hashes = add_specs(root, {ZA_EXP: '{"name": "za_v0_fixture", "bar": 3.0, "edited": true}\n'})
    after = by_id(presets_service.list_presets(runs))[ZA].spec_sha256
    assert before is not None and after == hashes[ZA_EXP] and after != before


def test_hashing_specs_leaves_experiments_and_results_byte_identical(root) -> None:
    add_specs(root)
    experiments, results = snapshot(root / "experiments"), snapshot(root / "results")
    runs = runs_for(root)
    presets_service.list_presets(runs)
    presets_service.find_preset(runs, ZA)
    assert snapshot(root / "experiments") == experiments and snapshot(root / "results") == results
