"""Research service (TASKS 2.2): registry, joins to screens and specs, spec re-hash, multiple testing, series.

Counts are read from `results/registry.csv` at run time: a research workflow may add a row while the tests
run, so nothing here hard-codes 16 or 17.
"""
from __future__ import annotations

import json
import math
import random
import re

import pytest

from nq_lab import registry as nq_registry
from nq_lab.config import IS_END, ROOT
from nq_terminal import constants
from nq_terminal.services.research import (
    ResearchDataError,
    ResearchService,
    UnknownNameError,
    benjamini_hochberg,
    bonferroni,
    holm,
    verdict_parts,
)

from test_research_support import (
    PRICE_PATTERN,
    REAL_SCREENS,
    build_root,
    copy_file,
    flip_one_byte,
    real_registry_rows,
    write_registry,
)


@pytest.fixture(scope="module")
def real() -> ResearchService:
    return ResearchService(ROOT)


# ---------------------------------------------------------------- registry and counts


def test_registry_rows_and_counts_come_from_the_file(real):
    rows = real_registry_rows()
    view = real.registry()
    assert [r.name for r in view.rows] == [r["name"] for r in rows]
    assert view.counts.rows == len(rows)
    assert view.counts.registered == sum(r["registered"] == "True" for r in rows)
    assert view.counts.passed == sum(r["verdict"].split()[0] == "PASS" for r in rows)
    assert view.counts.failed == sum(r["verdict"].split()[0] == "FAIL" for r in rows)
    assert view.counts.checks == view.counts.rows - view.counts.passed - view.counts.failed


def test_counts_follow_the_file_not_a_constant(tmp_path):
    """Born failing for hard-coded counts: the same service reports 2 rows, then 3 after a row is added."""
    root = build_root(tmp_path, ("volmanaged_v0", "overnight_v0"))
    service = ResearchService(root)
    assert (service.registry().counts.rows, service.registry().counts.passed) == (2, 1)
    rows = [r for r in real_registry_rows() if r["name"] in ("volmanaged_v0", "overnight_v0", "dtsmom_v0")]
    write_registry(root, rows)
    copy_file(REAL_SCREENS / "dtsmom_v0.json", root, "results", "screens", "dtsmom_v0.json")
    counts = service.registry().counts
    assert (counts.rows, counts.registered, counts.failed) == (3, 3, 2)


def test_registry_values_are_typed(real):
    by_name = {r.name: r for r in real.registry().rows}
    over = by_name["overnight_v0"]
    assert over.registered is True and over.control_p is None and isinstance(over.n, int)
    gao = by_name["za_v0_C3_gao_momentum"]
    assert gao.registered is False and gao.family_k is None and gao.bh_q is None


def test_a_truncated_registry_is_an_error_not_a_short_list(tmp_path):
    root = build_root(tmp_path, ("volmanaged_v0",))
    path = root / "results" / "registry.csv"
    text = path.read_text(encoding="utf-8")
    path.write_text(text[: text.index("\n") + 40], encoding="utf-8")
    with pytest.raises(ResearchDataError):
        ResearchService(root, retry_delay_s=0).registry()


def test_a_missing_registry_is_a_clear_error(tmp_path):
    with pytest.raises(ResearchDataError, match="registry.csv"):
        ResearchService(tmp_path).registry()


def test_verdict_badge_and_note():
    assert verdict_parts("PASS") == ("PASS", None)
    assert verdict_parts("FAIL [multi-asset universe: 27 CME futures, not NQ]") == (
        "FAIL", "multi-asset universe: 27 CME futures, not NQ")
    assert verdict_parts("check inside za_v0 (no own pass bar)") == ("CHECK", "check inside za_v0 (no own pass bar)")


# ---------------------------------------------------------------- joins and spec re-hash


def test_every_registered_row_joins_a_screen_and_a_spec(real):
    cards = real.cards()
    registered = [c for c in cards if c.registered]
    assert len(registered) == real.registry().counts.registered
    for card in registered:
        assert card.screen is not None, card.name
        assert (ROOT / "results" / "screens" / f"{card.screen}.json").is_file(), card.name
        assert (ROOT / "experiments" / f"{card.spec}.json").is_file(), card.name
        assert card.verdict_badge in ("PASS", "FAIL"), card.name


def test_spec_rehash_matches_the_recorded_hash_for_every_row(real):
    for check in real.spec_checks():
        assert check.rehash_sha256 == check.registry_sha256 == check.screen_sha256, check.name
        assert check.ok is True, check.name
    assert all(card.spec_rehash_ok for card in real.cards())


def test_a_spec_copy_with_one_byte_changed_fails(tmp_path):
    """Born failing (RI1): the untouched copy re-hashes clean, the same copy with one byte changed does not."""
    root = build_root(tmp_path, ("volmanaged_v0",))
    service = ResearchService(root)
    assert service.card("volmanaged_v0").spec_rehash_ok is True
    flip_one_byte(root / "experiments" / "volmanaged_v0.json")
    card = service.card("volmanaged_v0")
    assert card.spec_rehash_ok is False
    assert card.spec_sha_ok is True  # the stored flag is shown as recorded; the re-hash is the live check
    check = next(c for c in service.spec_checks() if c.name == "volmanaged_v0")
    assert check.ok is False and check.rehash_sha256 != check.registry_sha256


def test_a_screen_recording_another_hash_fails(tmp_path):
    root = build_root(tmp_path, ("overnight_v0",))
    screen = root / "results" / "screens" / "overnight_v0.json"
    data = json.loads(screen.read_text(encoding="utf-8"))
    data["spec_sha256"] = "0" * 64
    screen.write_text(json.dumps(data), encoding="utf-8")
    assert ResearchService(root).card("overnight_v0").spec_rehash_ok is False


def test_a_missing_spec_or_screen_is_reported_not_hidden(tmp_path):
    root = build_root(tmp_path, ("overnight_v0", "volmanaged_v0"))
    (root / "experiments" / "overnight_v0.json").unlink()
    (root / "results" / "screens" / "volmanaged_v0.json").unlink()
    service = ResearchService(root)
    assert service.card("overnight_v0").spec_rehash_ok is False
    card = service.card("volmanaged_v0")
    assert card.screen is None and card.spec_rehash_ok is False
    missing = {c.name: c.problem for c in service.spec_checks()}
    assert "spec" in missing["overnight_v0"] and "screen" in missing["volmanaged_v0"]


def test_screen_aliases_mirror_nq_lab_registry():
    assert dict(constants.SCREEN_ALIASES) == dict(nq_registry.RESULT_FILE)


def test_unknown_or_path_like_names_are_refused(real):
    for name in ("nope_v0", "../registry", "..\\x", "overnight_v0/../../x", ""):
        with pytest.raises(UnknownNameError):
            real.card(name)
        with pytest.raises(UnknownNameError):
            real.detail(name)


def test_a_path_like_spec_in_the_registry_is_refused(tmp_path):
    rows = [r for r in real_registry_rows() if r["name"] == "overnight_v0"]
    rows[0]["spec"] = "../results/registry"
    root = build_root(tmp_path, ())
    write_registry(root, rows)
    card = ResearchService(root).card("overnight_v0")
    assert card.spec_rehash_ok is False


# ---------------------------------------------------------------- cards and detail


def test_cards_carry_pass_checks_and_headline(real):
    by_name = {c.name: c for c in real.cards()}
    over = by_name["overnight_v0"]
    assert over.verdict_badge == "PASS" and over.round == 1
    assert {p.name: p.passed for p in over.pass_checks}["t_ge_2_5"] is True
    vol = by_name["volmanaged_v0"]
    assert {p.name: p.passed for p in vol.pass_checks} == {
        "alpha_t_ge_2": False, "blocks_a_gt_0": False, "dsr_2tick_gt_0": False}
    assert vol.series_kind == "daily"
    assert over.headline_label and isinstance(over.headline_value, float)
    assert "nt_overnight_v0_open_c" in over.nautilus_runs


def test_detail_joins_screen_spec_summary_history_and_auxiliaries(real):
    vol = real.detail("volmanaged_v0")
    assert vol.screen["name"] == "volmanaged_v0" and vol.spec is not None
    assert vol.summary_name == "sizing_summary.md" and vol.summary_md.startswith("# Sizing screens")
    fomc = real.detail("fomccycle_v0")
    assert "fomccycle_v0.first.json" in fomc.history
    euro = real.detail("eurodrift_v0")
    assert {"eurodrift_v0_coverage", "eurodrift_v0_rsv"} <= set(euro.auxiliaries)
    za = real.detail("za_v0")
    assert za.card.screen == "za_v0_repaired" and "za_v0_repaired_rejected_days" in za.auxiliaries


# ---------------------------------------------------------------- multiple testing


def test_adjustments_equal_nq_lab_registry_functions():
    rng = random.Random(7)
    for _ in range(50):
        ps = [rng.random() for _ in range(rng.randint(1, 20))]
        for ours, theirs in ((bonferroni, nq_registry.bonferroni), (holm, nq_registry.holm),
                             (benjamini_hochberg, nq_registry.bh)):
            assert ours(ps) == pytest.approx(theirs(ps), abs=1e-15)


def test_multiple_testing_reproduces_the_stored_columns(real):
    mt = real.multiple_testing()
    assert mt.k == real.registry().counts.registered
    assert mt.max_abs_diff <= 1e-12 and mt.matches_registry is True
    ranks = sorted(mt.rows, key=lambda r: r.rank)
    for i, row in enumerate(ranks, start=1):
        assert row.rank == i
        assert row.bonferroni_line == pytest.approx(mt.alpha / mt.k)
        assert row.holm_line == pytest.approx(mt.alpha / (mt.k - i + 1))
        assert row.bh_line == pytest.approx(i * mt.alpha / mt.k)
    assert [r.p for r in ranks] == sorted(r.p for r in ranks)


def test_multiple_testing_flags_a_tampered_stored_column(tmp_path):
    """Born failing: a stored Holm value that the p values do not give is reported as a mismatch."""
    names = ("volmanaged_v0", "overnight_v0", "dtsmom_v0")
    root = build_root(tmp_path, names)
    rows = [r for r in real_registry_rows() if r["name"] in names]
    ps = [float(r["p"]) for r in rows]
    for row, b, h, q in zip(rows, bonferroni(ps), holm(ps), benjamini_hochberg(ps)):
        row.update(family_k="3", bonferroni_p=repr(b), holm_p=repr(h), bh_q=repr(q))
    write_registry(root, rows)
    assert ResearchService(root).multiple_testing().matches_registry is True
    rows[0]["holm_p"] = "0.5"
    write_registry(root, rows)
    mt = ResearchService(root).multiple_testing()
    assert mt.matches_registry is False and mt.max_abs_diff > 0.01


# ---------------------------------------------------------------- series


def test_series_sources_name_real_columns_and_no_price_column():
    for name, source in constants.SERIES_SOURCES.items():
        header = (REAL_SCREENS / source.file).read_text(encoding="utf-8").splitlines()[0].split(",")
        columns = [source.time_column, *source.values.values(), *source.bench.values()]
        assert set(columns) <= set(header), name
        assert not any(re.search(PRICE_PATTERN, c) for c in columns[1:]), name


def test_every_registered_row_has_a_series_source(real):
    registered = {c.name for c in real.cards() if c.registered}
    assert registered <= set(constants.SERIES_SOURCES)


def test_volmanaged_series_at_each_cost(real):
    for cost in (0, 1, 2):
        s = real.series("volmanaged_v0", cost)
        assert s.basis == "A" and s.cost == cost and s.bench_label
        assert len(s.t) == len(s.r) == len(s.r_bench) == len(s.equity)
        assert s.equity[-1] == pytest.approx(math.fsum(s.r))
        assert s.t == sorted(s.t) and max(s.t) < IS_END.timestamp()


def test_series_cost_not_recorded_is_refused(real):
    with pytest.raises(UnknownNameError, match="cost"):
        real.series("fomctone_v0", 0)


def test_series_past_the_fence_is_refused(tmp_path):
    """Born failing: an in-sample series file that holds a 2022 row is refused, not served."""
    root = build_root(tmp_path, ("volmanaged_v0",), series=("volmanaged_v0_daily.csv",))
    service = ResearchService(root)
    assert service.series("volmanaged_v0", 1).t
    path = root / "results" / "screens" / "volmanaged_v0_daily.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    last = lines[-1].split(",")
    last[0] = "2022-01-03"
    path.write_text("\n".join([*lines, ",".join(last)]) + "\n", encoding="utf-8")
    with pytest.raises(ResearchDataError, match="2022-01-01"):
        service.series("volmanaged_v0", 1)


def test_every_registered_series_loads_at_its_first_cost(real):
    for name, source in constants.SERIES_SOURCES.items():
        if name not in {r.name for r in real.registry().rows}:
            continue
        cost = min(source.values)
        s = real.series(name, cost)
        assert s.t and len(s.t) == len(s.r), name
        assert s.unit == source.unit
