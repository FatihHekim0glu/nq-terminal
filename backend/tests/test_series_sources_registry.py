"""The series source registry (`nq_terminal.series_sources`) and the Deflated Sharpe's list of unlearned rows.

The package holds every learned registration (the 22 rows of 0.3.3 and the SOURCES of the monthly and daily-event
modules) and NOT_LEARNABLE, the registered rows that cannot get a series under convention C2, each with its reason.
`constants.SERIES_SOURCES` is the same mapping, so every caller that read it there reads the package now. SV3's view
names each registered row that N does not count in `unlearned`, with the reason, and the list must agree with the
names its N note gives. The dump at the end carries the registered rows of the lab's `results/registry.csv` and both
lists for the cross-check's completeness reference (`terminal/qa/crosscheck/reference.py`), which fails under
`--strict` on a registered row that is neither learned nor listed. Read-only on `results/`.
"""
from __future__ import annotations

import csv
import importlib
import json
import shutil
import sys
from pathlib import Path
from types import MappingProxyType, ModuleType

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError
from test_dump_for_qa import REGISTRY, SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_terminal import constants, series_sources
from nq_terminal.analytics import deflated
from nq_terminal.api import analytics as analytics_api
from nq_terminal.models.analytics_p1 import DeflatedView, UnlearnedRow
from nq_terminal.services import tearsheet_extended
from nq_terminal.services.research import ResearchService

from fakes import FIXTURES
from test_research_support import write_registry

PREFIX = "nqt_w3_registry_"
ORIGINAL_22 = ("za_v0", "tom_v0", "preholiday_v0", "prefomc_v0", "overnight_v0", "macroday_v0", "halloween_v0",
               "mac5rev_v0", "rebal_v0", "fomccycle_v0", "eurodrift_v0", "fomctone_v0", "volmanaged_v0", "tsmom_v0",
               "dtsmom_v0", "carry_v0", "eomtsy_v0", "cskew_v0", "mim_v0", "vt_har_v0", "vrp_eq_v0", "fxeomhedge_v0")
C2_ROWS = ("cotliq_v0", "mpslope_ym_v0", "wkndgap_fx_v0", "wkndshort_v0", "finroll_tff_v0")
C2_REASON = ("outside convention C2 (P = 252 or 12, docs/ANALYTICS_CATALOG.md:16); needs a statistics decision "
             "(O23)")
SOURCE = constants.SeriesSource("x_daily.csv", "date", MappingProxyType({1: "r1"}), "return on capital per session",
                                "daily")


# ---------------------------------------------------------------- the registry


def test_born_failing_a_name_both_learned_and_not_learnable_fails():
    with pytest.raises(series_sources.SeriesRegistryError, match="za_v0"):
        series_sources.merge_registry(series_sources.BASE_SOURCES, [], {"za_v0": C2_REASON})


def test_born_failing_a_name_a_module_marks_not_learnable_while_another_learns_it_fails():
    parts = [("monthly_a", {"x_v0": SOURCE}, {}), ("monthly_b", {}, {"x_v0": "sample passes the fence"})]
    with pytest.raises(series_sources.SeriesRegistryError, match="x_v0"):
        series_sources.merge_registry({}, parts, {})


def test_born_failing_a_name_learned_by_two_modules_fails():
    parts = [("monthly_a", {"x_v0": SOURCE}, {}), ("daily_event", {"x_v0": SOURCE}, {})]
    with pytest.raises(series_sources.SeriesRegistryError, match="x_v0.*monthly_a.*daily_event"):
        series_sources.merge_registry({}, parts, {})


def test_born_failing_a_not_learnable_row_without_a_reason_fails():
    with pytest.raises(series_sources.SeriesRegistryError, match="y_v0"):
        series_sources.merge_registry({}, [], {"y_v0": "  "})


def test_born_failing_a_module_entry_that_is_not_a_series_source_fails():
    with pytest.raises(series_sources.SeriesRegistryError, match="x_v0"):
        series_sources.merge_registry({}, [("monthly_a", {"x_v0": ("x.csv", "date")}, {})], {})


def test_the_merged_registry_keeps_the_base_order_then_each_module_in_turn():
    parts = [("monthly_a", {"b_v0": SOURCE}, {}), ("daily_event", {"c_v0": SOURCE}, {"d_v0": "a reason"})]
    learned, barred = series_sources.merge_registry({"a_v0": SOURCE}, parts, {"e_v0": C2_REASON})
    assert list(learned) == ["a_v0", "b_v0", "c_v0"] and dict(barred) == {"e_v0": C2_REASON, "d_v0": "a reason"}
    assert isinstance(learned, MappingProxyType) and isinstance(barred, MappingProxyType)


def test_the_package_holds_the_22_rows_of_0_3_3_first_and_unchanged():
    assert tuple(series_sources.BASE_SOURCES) == ORIGINAL_22
    assert tuple(series_sources.SERIES_SOURCES)[:22] == ORIGINAL_22
    assert all(series_sources.SERIES_SOURCES[n] is series_sources.BASE_SOURCES[n] for n in ORIGINAL_22)
    assert series_sources.BASE_SOURCES["dtsmom_v0"].time_rule == constants.MONTH_END_SESSION
    assert series_sources.BASE_SOURCES["vt_har_v0"].portfolio == constants.PortfolioRule(exclude=("NQ",))


def test_constants_re_exports_the_package_mapping_under_the_same_name():
    from nq_terminal.constants import SERIES_SOURCES

    assert SERIES_SOURCES is series_sources.SERIES_SOURCES is constants.SERIES_SOURCES
    with pytest.raises(AttributeError, match="NO_SUCH_TABLE"):
        constants.NO_SUCH_TABLE  # noqa: B018 - the lazy re-export must not swallow other names


def test_the_five_rows_outside_convention_c2_are_not_learnable_with_the_reason():
    assert {name: series_sources.NOT_LEARNABLE[name] for name in C2_ROWS} == dict.fromkeys(C2_ROWS, C2_REASON)
    assert not set(series_sources.NOT_LEARNABLE) & set(series_sources.SERIES_SOURCES)


def test_the_unlearned_reason_is_the_not_learnable_reason_or_no_series_source_yet():
    assert series_sources.unlearned_reason("cotliq_v0") == C2_REASON
    assert series_sources.unlearned_reason("zz_new_v0") == "no series source yet" == series_sources.NO_SOURCE_REASON


def test_every_part_is_imported_by_name_and_holds_its_sources():
    assert series_sources.PARTS == ("monthly_a", "monthly_b", "daily_event")
    for name, module in series_sources.PART_MODULES:
        assert module.__name__ == f"nq_terminal.series_sources.{name}" and module.SOURCES
        assert set(module.SOURCES) <= set(series_sources.SERIES_SOURCES)


def test_a_present_module_gives_its_sources_and_its_optional_not_learnable_rows():
    module = ModuleType("nq_terminal.series_sources.fake")
    module.SOURCES = {"x_v0": SOURCE}
    assert series_sources.part_tables("fake", module) == ("fake", {"x_v0": SOURCE}, {})
    module.NOT_LEARNABLE = {"y_v0": "sample passes the fence"}
    assert series_sources.part_tables("fake", module)[2] == {"y_v0": "sample passes the fence"}


def test_the_package_imports_first_without_a_cycle():
    """A test module that imports a series module before anything imported `constants` still loads."""
    names = [m for m in sys.modules if m == "nq_terminal.constants" or m.startswith("nq_terminal.series_sources")]
    saved = {m: sys.modules.pop(m) for m in names}
    try:
        fresh = importlib.import_module("nq_terminal.series_sources")
        assert tuple(fresh.SERIES_SOURCES)[:22] == ORIGINAL_22
        assert importlib.import_module("nq_terminal.constants").SERIES_SOURCES is fresh.SERIES_SOURCES
    finally:
        for m in [m for m in sys.modules if m == "nq_terminal.constants" or m.startswith("nq_terminal.series_sources")]:
            del sys.modules[m]
        sys.modules.update(saved)


# ---------------------------------------------------------------- SV3's unlearned list


def _trials() -> list[deflated.Trial]:
    rng = np.random.default_rng(23)
    dates = pd.bdate_range("2019-01-01", periods=300, name="session")
    return [deflated.Trial(name=f"t{i}_v0", kind="daily", periods=252,
                           r=pd.Series(rng.standard_normal(300) * 0.01 + 0.0004 * i, index=dates)) for i in range(3)]


@pytest.fixture(scope="module")
def view() -> DeflatedView:
    return tearsheet_extended.deflated_view(_trials(), ["cotliq_v0", "zz_new_v0"])


def test_the_view_lists_each_unlearned_row_with_its_reason(view):
    assert view.unlearned == [UnlearnedRow(name="cotliq_v0", reason=C2_REASON),
                              UnlearnedRow(name="zz_new_v0", reason="no series source yet")]
    assert "cotliq_v0, zz_new_v0: 2 registered rows" in view.n_note
    assert view.n_trials == 3


def test_born_failing_a_deflated_view_whose_unlearned_list_misses_a_row_named_in_its_note_fails(view):
    body = view.model_dump()
    with pytest.raises(ValidationError, match="zz_new_v0"):
        DeflatedView.model_validate({**body, "unlearned": body["unlearned"][:1]})


def test_born_failing_a_deflated_view_listing_a_row_its_note_does_not_name_fails(view):
    body = view.model_dump()
    extra = [*body["unlearned"], {"name": "zz_other_v0", "reason": "no series source yet"}]
    with pytest.raises(ValidationError, match="zz_other_v0"):
        DeflatedView.model_validate({**body, "unlearned": extra})
    with pytest.raises(ValidationError, match="zz_other_v0"):
        DeflatedView.model_validate({**body, "n_note": body["n_note"].split(";")[0], "unlearned": extra[2:]})


def test_a_view_with_every_row_learned_has_an_empty_list_and_its_plain_note():
    plain = tearsheet_extended.deflated_view(_trials())
    assert plain.unlearned == [] and "not learned" not in plain.n_note


def test_the_model_reads_the_clause_the_service_writes():
    for names in (["a_v0"], ["a_v0", "b_v0", "c_v0"]):
        clause = tearsheet_extended.unlearned_note(names)
        found = DeflatedView.unlearned_in_note("N = 3 treats" + clause)
        assert found == names


def test_the_route_serves_the_list_for_rows_planted_in_a_copy_of_the_fixture_tree(tmp_path):
    root = tmp_path / "tree"
    shutil.copytree(FIXTURES, root)
    with (root / "results" / "registry.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    write_registry(root, [*rows, dict(rows[0], name="wkndshort_v0", spec="wkndshort_v0"),
                          dict(rows[0], name="zz_new_v0", spec="zz_new_v0")])
    trials, unlearned = analytics_api.registry_trials(ResearchService(root))
    assert unlearned == ["wkndshort_v0", "zz_new_v0"]
    served = tearsheet_extended.deflated_view(trials, unlearned).model_dump(mode="json")
    assert served["unlearned"] == [{"name": "wkndshort_v0", "reason": C2_REASON},
                                   {"name": "zz_new_v0", "reason": "no series source yet"}]


# ---------------------------------------------------------------- the completeness dump


def completeness_doc(registry: Path = REGISTRY) -> dict:
    frame = pd.read_csv(registry)
    registered = frame.loc[frame["registered"].astype(str) == "True", "name"].astype(str).tolist()
    return _clean({"schema": SCHEMA, "kind": "registry_completeness", "case": "registry_completeness",
                   "source": "results/registry.csv registered rows; nq_terminal.series_sources",
                   "inputs": {"registered": registered, "learned": list(series_sources.SERIES_SOURCES),
                              "not_learnable": dict(series_sources.NOT_LEARNABLE)},
                   "values": {"ours": {}}, "missing": {}})


def write_completeness_dump(folder: Path, doc: dict) -> Path:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    path = folder / f"{PREFIX}{doc['case']}.json"
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return path


def test_the_completeness_dump_carries_the_fixture_registry_and_both_lists():
    doc = completeness_doc(FIXTURES / "results" / "registry.csv")
    assert doc["inputs"]["registered"] == ["overnight_v0", "volmanaged_v0"]
    assert doc["inputs"]["not_learnable"]["finroll_tff_v0"] == C2_REASON
    assert "fxeomhedge_v0" in doc["inputs"]["learned"]


def test_write_the_completeness_dump_from_the_lab_registry():
    path = write_completeness_dump(dump_dir(), completeness_doc())
    back = json.loads(path.read_text(encoding="utf-8"))
    assert back["kind"] == "registry_completeness" and len(back["inputs"]["registered"]) >= len(ORIGINAL_22)
