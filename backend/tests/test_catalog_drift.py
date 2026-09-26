"""PY7, the catalog drift test: the synthetic series in `tests/fakes.py` must mirror the real processed listing.

Metadata only: the listing is by file name and the dtypes come from parquet footers, both through
`services/catalog.py` (the one module allowed to look at the processed folder).

Vendor 1m and 1d series must match exactly: a fake series with no real file would invent data, and a real series
the fakes lack would go untested. Repaired files are handled generically, because the futures repair workflow adds
`<root>_1m_back_repaired.parquet` files while this runs: every fake repaired series must exist for real, and every
real repaired series must belong to a root whose vendor 1m series the fakes mirror (so its schema is covered).
"""
from __future__ import annotations

import pandas as pd
import pyarrow as pa

from nq_terminal.services.catalog import Catalog, SeriesId, diff_series

import fakes

UTC = "UTC"
REAL = Catalog()


def real_series() -> set[SeriesId]:
    return set(REAL.listing().series)


def fake_minute_series(variant: str | None = None) -> set[SeriesId]:
    return {SeriesId(symbol, "1m", v) for symbol, v in fakes.MINUTE_SERIES if variant in (None, v)}


def real_minute_series(variant: str) -> set[SeriesId]:
    return {s for s in real_series() if s.timeframe == "1m" and s.variant == variant}


def fake_daily_series() -> set[SeriesId]:
    return {SeriesId(f"{root}.V.0", "1d", "vendor") for root in fakes.DAILY_ROOTS}


def test_the_real_listing_is_not_empty():
    series = real_series()
    assert SeriesId("NQ.V.0", "1m", "vendor") in series
    assert SeriesId("NQ.V.0", "1m", "repaired") in series


def test_daily_series_match_the_fakes_exactly():
    real_daily = {s for s in real_series() if s.timeframe == "1d"}
    assert diff_series(fake_daily_series(), real_daily) == ((), ())


def test_every_fake_minute_series_exists_for_real():
    real_minute = {s for s in real_series() if s.timeframe == "1m"}
    missing, _ = diff_series(fake_minute_series(), real_minute)
    assert missing == (), f"fakes.MINUTE_SERIES names series with no processed file: {missing}"


def test_vendor_minute_series_match_the_fakes_exactly():
    assert diff_series(fake_minute_series("vendor"), real_minute_series("vendor")) == ((), ())


def test_repaired_minute_series_belong_to_mirrored_roots():
    missing, _ = diff_series(fake_minute_series("repaired"), real_minute_series("repaired"))
    assert missing == (), f"fakes.REPAIRED_ROOTS names repaired series with no processed file: {missing}"
    mirrored = {s.symbol for s in fake_minute_series("vendor")}
    orphans = sorted(s.symbol for s in real_minute_series("repaired") if s.symbol not in mirrored)
    assert orphans == [], f"repaired files whose root has no mirrored vendor 1m series: {orphans}"


def test_the_repaired_rule_is_born_failing():
    """A repaired file for a root the fakes do not mirror must be flagged (the rule is not vacuous)."""
    mirrored = {s.symbol for s in fake_minute_series("vendor")}
    assert "QQ.V.0" not in mirrored and "NQ.V.0" in mirrored


def synthetic_schema(sid: SeriesId) -> dict[str, str]:
    loader = fakes.synthetic_loader(sid.symbol, sid.timeframe, sid.variant)
    frame = loader(pd.Timestamp("2019-05-06", tz=UTC), pd.Timestamp("2019-05-08", tz=UTC))
    return {f.name: str(f.type) for f in pa.Schema.from_pandas(frame, preserve_index=False)}


def test_fake_dtypes_equal_the_real_parquet_schemas():
    fake_ids = fake_minute_series() | fake_daily_series()
    fake_ids |= {SeriesId(s.symbol, "1m", "repaired") for s in real_minute_series("repaired")
                 if SeriesId(s.symbol, "1m", "vendor") in fake_ids}  # same schema as the vendor file
    checked = []
    for entry in REAL.entries():
        if entry.series_id not in fake_ids or entry.error:
            continue  # unmirrored or being written right now
        real = {c.name: c.type for c in entry.columns}
        sid = entry.series_id
        model = sid if (sid.symbol, sid.variant) in fakes.MINUTE_SERIES or sid.timeframe == "1d" \
            else SeriesId(sid.symbol, sid.timeframe, "vendor")
        assert real == synthetic_schema(model), sid
        checked.append(entry.series_id)
    assert SeriesId("NQ.V.0", "1m", "vendor") in checked and SeriesId("NQ.V.0", "1d", "vendor") in checked


def test_the_project_dtypes_hold():
    for entry in REAL.entries():
        if entry.error:
            continue
        types = {c.name: c.type for c in entry.columns}
        assert types["v"] == "double", entry.series_id
        assert types["instrument_id"] == ("int32" if entry.series_id.timeframe == "1m" else "int64"), entry.series_id
        assert types["ts"] == "timestamp[ns, tz=UTC]"
