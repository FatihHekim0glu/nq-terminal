"""`SeriesSource.keep_where`: rows kept where named columns hold named values (wave w3, release fix 3).

Three registered rows state their headline sample as a row filter the older fields could not say: airfx_v0 leaves out
its flat month (`held` False), hvix_nd_v0 keeps the spike sessions (`headline` True) and apieia_ho_v0 keeps the event
rows with an empty `void`. The rule lives in `ResearchService._series_frame`; these tests feed it synthetic files
only (the repository is public), and each guard is born failing against the state it refuses.
"""
from __future__ import annotations

import dataclasses
from pathlib import Path
from types import MappingProxyType

import pandas as pd
import pytest

from nq_terminal import constants
from nq_terminal.analytics import series as series_mod
from nq_terminal.constants import SeriesSource
from nq_terminal.services import research as research_mod
from nq_terminal.services.research import ResearchDataError, ResearchService

REGISTRY_HEADER = "name,registered,n,p,control_p,verdict,family_k,bonferroni_p,holm_p,bh_q,spec,spec_sha256,spec_sha_ok"
NAME = "keep_probe_v0"
FILE = "keep_probe_v0_events.csv"


def _source(**keep) -> SeriesSource:
    return SeriesSource(FILE, "date", MappingProxyType({1: "net"}), "basis points of capital per trade", "trades",
                        keep_where=MappingProxyType(keep))


def _root(tmp: Path, frame: pd.DataFrame) -> Path:
    screens = tmp / "results" / "screens"
    screens.mkdir(parents=True)
    (tmp / "results" / "registry.csv").write_text(
        f"{REGISTRY_HEADER}\n{NAME},True,3,0.5,,FAIL,1,1,1,1,{NAME},{'0' * 64},True\n", encoding="utf-8")
    frame.to_csv(screens / FILE, index=False, lineterminator="\n")
    return tmp


def _use(monkeypatch, source: SeriesSource) -> None:
    merged = MappingProxyType({**constants.SERIES_SOURCES, NAME: source})
    monkeypatch.setattr(research_mod, "SERIES_SOURCES", merged)
    monkeypatch.setattr(series_mod, "SERIES_SOURCES", merged)


def _events() -> pd.DataFrame:
    return pd.DataFrame({
        "date": ["2015-03-02", "2015-03-03", "2015-03-04", "2015-03-05", "2015-03-06"],
        "kind": ["event", "event", "event", "control", "event"],
        "void": [None, "thin book", None, None, None],
        "held": [True, True, False, True, True],
        "net": [1.0, 2.0, 4.0, 8.0, 16.0],
    })


def _served(root: Path) -> list[float]:
    return ResearchService(root).series(NAME, 1).r


def test_a_row_is_kept_only_where_every_named_column_holds_its_value(tmp_path, monkeypatch):
    _use(monkeypatch, _source(kind="event", void=None))
    assert _served(_root(tmp_path, _events())) == [1.0, 4.0, 16.0]


def test_a_true_requirement_leaves_out_the_false_rows(tmp_path, monkeypatch):
    _use(monkeypatch, _source(held=True))
    assert _served(_root(tmp_path, _events())) == [1.0, 2.0, 8.0, 16.0]


def test_a_false_requirement_keeps_only_the_false_rows(tmp_path, monkeypatch):
    _use(monkeypatch, _source(held=False))
    assert _served(_root(tmp_path, _events())) == [4.0]


def test_a_string_requirement_is_an_exact_match(tmp_path, monkeypatch):
    _use(monkeypatch, _source(kind="contr"))
    with pytest.raises(ResearchDataError, match="no row"):
        _served(_root(tmp_path, _events()))


def test_regression_guard_a_source_without_the_field_keeps_every_filled_row(tmp_path, monkeypatch):
    _use(monkeypatch, _source())
    assert _served(_root(tmp_path, _events())) == [1.0, 2.0, 4.0, 8.0, 16.0]


def test_a_flag_requirement_on_a_column_that_is_not_true_or_false_is_refused(tmp_path, monkeypatch):
    frame = _events().assign(held=["yes", "yes", "no", "yes", "yes"])
    _use(monkeypatch, _source(held=True))
    with pytest.raises(ResearchDataError, match="held column is not True or False"):
        _served(_root(tmp_path, frame))


def test_a_missing_keep_column_is_refused_by_name(tmp_path, monkeypatch):
    _use(monkeypatch, _source(kind="event", gone=True))
    with pytest.raises(ResearchDataError, match="lacks the columns gone"):
        _served(_root(tmp_path, _events()))


def test_a_rule_that_keeps_no_row_is_refused_not_served_empty(tmp_path, monkeypatch):
    _use(monkeypatch, _source(kind="event", void="never written"))
    with pytest.raises(ResearchDataError, match="no row"):
        _served(_root(tmp_path, _events()))


def test_the_series_is_the_kept_rows_before_the_empty_value_rule(tmp_path, monkeypatch):
    frame = _events().assign(net=[1.0, 2.0, None, 8.0, 16.0])
    _use(monkeypatch, _source(held=True))
    assert _served(_root(tmp_path, frame)) == [1.0, 2.0, 8.0, 16.0]


def test_a_requirement_names_a_boolean_a_string_or_empty_and_nothing_else():
    with pytest.raises(ValueError, match="keep_where"):
        _source(kind=3)
    with pytest.raises(ValueError, match="keep_where"):
        dataclasses.replace(_source(kind="event"), keep_where=MappingProxyType({"kind": ["event"]}))


@pytest.mark.parametrize("column", ["px", "close_price", "raw_close", "C"])
def test_a_price_column_cannot_be_a_keep_column(column):
    with pytest.raises(ValueError, match="price"):
        _source(**{column: True})
