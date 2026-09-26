"""Sealed results and confirmations (TASKS 2.2, ARCHITECTURE s3.3, PRD DL14).

The sealed CSVs hold 2022+ prices. They are served through an allowlist per file, so a new price column in a
later file cannot leak by default; the allowlist itself is checked against the file (a name the file lacks
fails) and against the price pattern `px|raw|price|_c$|^[OHLC]$` (a price name fails).
"""
from __future__ import annotations

import json
import re

import pandas as pd
import pytest

from nq_lab import registry as nq_registry
from nq_lab.config import ROOT
from nq_terminal import constants
from nq_terminal.services.research import (
    ResearchDataError,
    ResearchService,
    SealedAllowlistError,
    UnknownNameError,
    is_price_column,
    select_sealed_columns,
    strip_price_keys,
)

from test_research_support import PRICE_PATTERN, REAL_SEALED, build_root, build_sealed_root, copy_file, flip_one_byte

SPENT = re.compile(r"^spent window, opened \d{4}-\d{2}-\d{2}, descriptive only$")


@pytest.fixture(scope="module")
def real() -> ResearchService:
    return ResearchService(ROOT)


def _keys(value) -> list[str]:
    if isinstance(value, dict):
        return [k for key, item in value.items() for k in (str(key), *_keys(item))]
    if isinstance(value, list):
        return [k for item in value for k in _keys(item)]
    return []


# ---------------------------------------------------------------- the price pattern


@pytest.mark.parametrize("name", ["px", "entry_px", "raw", "raw_c_entry", "price", "Price", "close_price", "frozen_c",
                                  "O", "H", "L", "C", "raw_c_zn_a", "iid_px"])
def test_price_names_match_the_pattern(name):
    assert is_price_column(name) and re.search(PRICE_PATTERN, name)


@pytest.mark.parametrize("name", ["c", "date", "pct", "x_pct", "s", "r_m_0", "usd_nq_1", "held_exposure", "sigma2",
                                  "long_only_usd_1tick", "N", "roll", "c_range"])
def test_other_names_do_not_match(name):
    assert not is_price_column(name) and not re.search(PRICE_PATTERN, name)


def test_the_allowlists_hold_no_price_column():
    for file_name, columns in constants.SEALED_CSV_ALLOWLIST.items():
        assert columns, file_name
        assert not [c for c in columns if is_price_column(c)], file_name


# ---------------------------------------------------------------- the allowlist, born failing


def test_an_allowlist_naming_a_missing_column_fails():
    frame = pd.DataFrame({"date": ["2022-01-03"], "r_m_1": [0.01], "px": [15000.0]})
    assert list(select_sealed_columns(frame, ("date", "r_m_1"), "x.csv").columns) == ["date", "r_m_1"]
    with pytest.raises(SealedAllowlistError, match="r_bh_1"):
        select_sealed_columns(frame, ("date", "r_m_1", "r_bh_1"), "x.csv")


def test_an_allowlist_naming_a_price_column_fails():
    frame = pd.DataFrame({"date": ["2022-01-03"], "px": [15000.0]})
    with pytest.raises(SealedAllowlistError, match="px"):
        select_sealed_columns(frame, ("date", "px"), "x.csv")


def test_a_real_allowlist_with_one_missing_name_fails_on_the_real_file(tmp_path):
    root = build_sealed_root(tmp_path)
    name = "volmanaged_oos_daily.csv"
    path = root / "results" / "sealed" / name
    frame = pd.read_csv(path, encoding="utf-8")
    frame.drop(columns=["r_bh_2"]).to_csv(path, index=False, encoding="utf-8")
    with pytest.raises(SealedAllowlistError, match="r_bh_2"):
        ResearchService(root).sealed("volmanaged_oos_daily")


def test_every_allowlisted_column_exists_in_the_real_files():
    for file_name, columns in constants.SEALED_CSV_ALLOWLIST.items():
        header = (REAL_SEALED / file_name).read_text(encoding="utf-8").splitlines()[0].split(",")
        assert set(columns) <= set(header), file_name


# ---------------------------------------------------------------- what is served


def test_real_sealed_csvs_serve_the_allowlist_only(real):
    for file_name, columns in constants.SEALED_CSV_ALLOWLIST.items():
        view = real.sealed(file_name.removesuffix(".csv"))
        assert view.kind == "csv" and view.columns == list(columns)
        assert set(view.values) == set(columns)
        assert not [c for c in view.values if re.search(PRICE_PATTERN, c)]
        assert all(len(v) == view.n_rows for v in view.values.values())
        assert SPENT.match(view.label)


def test_real_sealed_json_serves_no_price_key(real):
    items = [i for i in real.sealed_index() if i.kind == "json"]
    assert {"rebal_v1_confirm", "volmanaged_oos"} <= {i.name for i in items}
    for item in items:
        view = real.sealed(item.name)
        assert not [k for k in _keys(view.data) if re.search(PRICE_PATTERN, k)], item.name
        assert SPENT.match(view.label)


def test_price_keys_are_stripped_from_sealed_json(tmp_path):
    """Born failing: a sealed JSON with price keys at any depth is served without them."""
    root = build_sealed_root(tmp_path)
    doc = {"px": 1, "nested": {"raw_c": 2, "ok": 3, "rows": [{"entry_px": 4, "pct": 5}]}, "C": 6, "c": 7}
    (root / "results" / "sealed" / "extra.json").write_text(json.dumps(doc), encoding="utf-8")
    assert strip_price_keys(doc) == {"nested": {"ok": 3, "rows": [{"pct": 5}]}, "c": 7}
    view = ResearchService(root).sealed("extra")
    assert view.data == {"nested": {"ok": 3, "rows": [{"pct": 5}]}, "c": 7}


def test_a_sealed_csv_without_an_allowlist_is_not_served(tmp_path):
    root = build_sealed_root(tmp_path)
    (root / "results" / "sealed" / "new_prices.csv").write_text("date,px\n2022-01-03,1\n", encoding="utf-8")
    service = ResearchService(root)
    assert "new_prices" not in {i.name for i in service.sealed_index()}
    with pytest.raises(UnknownNameError):
        service.sealed("new_prices")


def test_sealed_code_and_path_like_names_are_refused(real):
    for name in ("code", "code/exposure_options", "../registry", "exposure_options.py", ""):
        with pytest.raises(UnknownNameError):
            real.sealed(name)


def test_the_sealed_markdown_is_served_with_the_label(real):
    view = real.sealed("SEALED_RESULT")
    assert view.kind == "markdown" and view.markdown.startswith("# Sealed window result")
    assert SPENT.match(view.label)


# ---------------------------------------------------------------- confirmations


def test_confirmations_match_nq_lab_registry(real):
    ours = {c.name: c for c in real.confirmations()}
    theirs = {c["name"]: c for c in nq_registry.confirmations(ROOT)}
    assert set(ours) == set(theirs)
    for name, c in theirs.items():
        mine = ours[name]
        assert (mine.n, mine.p, mine.alpha, mine.verdict) == (c["n"], c["p"], c["alpha"], c["verdict"])
        assert mine.spec_sha_ok is c["spec_sha_ok"] is True
        assert mine.opening_closed is c["opening_closed"] is True
        assert SPENT.match(mine.label)


def test_confirmations_are_not_registry_rows(real):
    registry_names = {c.name for c in real.cards()}
    assert registry_names.isdisjoint(c.name for c in real.confirmations())


def test_a_tampered_confirmation_spec_fails(tmp_path):
    """Born failing: the confirmation spec copy with one byte changed no longer matches its opening's hash."""
    root = build_sealed_root(tmp_path)
    service = ResearchService(root)
    assert all(c.spec_sha_ok for c in service.confirmations())
    flip_one_byte(root / "experiments" / "rebal_v1_confirm.json")
    assert not any(c.spec_sha_ok for c in service.confirmations())


def test_an_opening_spec_outside_experiments_is_refused(tmp_path):
    root = build_sealed_root(tmp_path)
    path = root / "results" / "oos_openings.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["openings"][0]["spec"] = "results/oos_openings.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    assert not any(c.spec_sha_ok for c in ResearchService(root).confirmations())


def test_missing_openings_give_a_clear_error(tmp_path):
    copy_file(REAL_SEALED / "rebal_v1_confirm.json", tmp_path, "results", "sealed", "rebal_v1_confirm.json")
    with pytest.raises(ResearchDataError, match="oos_openings.json"):
        ResearchService(build_root(tmp_path, ())).confirmations()
