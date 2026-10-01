"""P2 risk extras dumps for the reference cross-check in `terminal/qa` (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11,
BR5 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_p2_risk_`, one
`p2risk` bundle per series: the served series of volmanaged_v0, dtsmom_v0 and za_v0 at 1 tick (no bar service, so no
gate read), the run nt_dtsmom_v0_ts1, a seeded synthetic account series, a seeded t(12) series inside the
Cornish-Fisher domain and the PerformanceAnalytics fixture (sixteen returns). `ours` holds the terminal's values
(`nq_terminal.analytics.risk_extras`), `nautilus` the pyo3 `TreynorRatio` on Basis B series whose benchmark has no
gap, and `stored` the PerformanceAnalytics case done by hand (50-digit decimals, exact moments; see
`test_p2_risk_extras.py`). `terminal/qa/crosscheck/p2_risk_extras.py` recomputes every value.

The shared dump folder is read by `python -m crosscheck`, which refuses a kind it does not know; so these bundles go
there only once `crosscheck/dumps.py` and `crosscheck/compare.py` register the `p2risk` kind. Until then the test
writes them into a temporary folder and checks them there. Read-only on `results/`.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, _synthetic, checked_dump_dir, dump_dir

from nq_lab.config import ROOT
from nq_terminal.analytics import risk_extras, series
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService

PREFIX = "nqt_p2_risk_"
KIND = "p2risk"
QA_CROSSCHECK = Path(__file__).resolve().parents[2] / "qa" / "crosscheck"
SERIES_CASES = (("volmanaged_v0", 1), ("dtsmom_v0", 1), ("za_v0", 1))
RUN_CASES = ("nt_dtsmom_v0_ts1",)
PA_CASE = np.array([10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6]) / 1000
PA_MES = {"95": 0.040574792447599579352, "99": 0.088666361185136973576}
LEVELS = ("95", "99")
RK4_KEYS = ("cf_quantile", "raw_expansion", "floored", "in_domain", "gaussian", "historical", "modified", "value")


class Case:
    def __init__(self, name: str, basis: str, periods: int, r: pd.Series, bench: pd.Series | None, on_capital: bool,
                 source: str):
        self.name, self.basis, self.periods, self.r, self.bench = name, basis, periods, r, bench
        self.on_capital, self.source = on_capital, source


def registered() -> bool:
    """Whether the cross-check knows the `p2risk` kind (both its dump reader and its comparison)."""
    try:
        dumps = (QA_CROSSCHECK / "dumps.py").read_text(encoding="utf-8")
        compare = (QA_CROSSCHECK / "compare.py").read_text(encoding="utf-8")
    except OSError:
        return False
    return f'"{KIND}"' in dumps and "P2_RISK_REFERENCES" in compare


def _t_case() -> Case:
    rng = np.random.default_rng(20260927)
    dates = pd.bdate_range("2013-01-02", periods=2000)
    bench = 0.0004 + 0.011 * rng.standard_normal(len(dates))
    r = 0.0002 + 0.4 * bench + 0.006 * rng.standard_t(12, len(dates))
    return Case("synthetic_t12", "B", 252, pd.Series(r, index=dates), pd.Series(bench, index=dates), True,
                "seeded synthetic account series, t(12) noise, inside the Cornish-Fisher domain (not project data)")


def build_cases() -> list[Case]:
    research, runs = ResearchService(ROOT), RunService(data_root=ROOT, project_root=ROOT)
    out = []
    for name, cost in SERIES_CASES:
        s = series.hypothesis_series(research, name, cost)
        out.append(Case(name, s.basis, s.periods, s.r, s.bench, s.on_capital, f"{s.source}, {s.label}"))
    for run_id in RUN_CASES:
        s = series.run_series(runs, research, run_id)
        out.append(Case(run_id, s.basis, s.periods, s.r, s.bench, s.on_capital, f"{s.source}, {s.label}"))
    r, b = _synthetic()
    out.append(Case("synthetic_b", "B", 252, r, b, True, "seeded synthetic account series (not project data)"))
    out.append(_t_case())
    pa_dates = pd.bdate_range("2015-01-05", periods=len(PA_CASE))
    out.append(Case("pa_fixture", "B", 252, pd.Series(PA_CASE, index=pa_dates), None, True,
                    "the PerformanceAnalytics fixture of test_p1_metrics.py (sixteen returns)"))
    return out


def _summed(case: Case) -> str:
    return case.basis if case.on_capital else "A"


def ours(case: Case) -> dict:
    out = {}
    for level, row in risk_extras.modified_es_table(case.r).items():
        out |= {f"rk4.{level}.{k}": float(row[k]) if isinstance(row[k], bool) else row[k] for k in RK4_KEYS}
    out["pf11.ulcer_index"] = risk_extras.ulcer_index(case.r, _summed(case))
    out["pf11.recovery_factor"] = risk_extras.recovery_factor(case.r, _summed(case))
    if case.on_capital and case.bench is not None:
        parts = risk_extras.treynor_parts(case.r, case.bench, case.basis, case.periods)
        out |= {"br5.cagr": parts["cagr"], "br5.beta": parts["beta"], "br5.treynor": parts["value"]}
    return out


def nautilus(case: Case) -> dict:
    """Nautilus `TreynorRatio` (compounded CAGR over beta) where it applies: Basis B, a benchmark without a gap."""
    if case.basis != "B" or not case.on_capital or case.bench is None or case.bench.isna().any():
        return {}
    from nautilus_trader.analysis import TreynorRatio
    stamps = pd.DatetimeIndex(case.r.index).tz_localize("UTC").as_unit("ns").asi8.tolist()
    value = TreynorRatio(case.periods).calculate_from_returns_with_benchmark(
        dict(zip(stamps, case.r.tolist())), dict(zip(stamps, case.bench.tolist())))
    return {"br5.treynor": math.nan if value is None else value}


def doc(case: Case) -> dict:
    values = {"ours": ours(case), "nautilus": nautilus(case)}
    if case.name == "pa_fixture":
        # the hand case pins the formula (raw expansion), not the served value: at 95% the Edgeworth density is negative
        # below h, so the served value there is the historical CVaR
        values["stored"] = {f"rk4.{level}.raw_expansion": PA_MES[level] for level in LEVELS}
    dates = [pd.Timestamp(d).strftime("%Y-%m-%d") for d in case.r.index]
    bench = None if case.bench is None else case.bench.reindex(case.r.index).tolist()
    return _clean({"schema": SCHEMA, "kind": KIND, "case": f"p2risk_{case.name}", "source": case.source,
                   "inputs": {"dates": dates, "r": case.r.tolist(), "bench": bench, "basis": case.basis,
                              "periods": case.periods, "on_capital": case.on_capital},
                   "values": values, "missing": {}})


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for d in docs:
        path = folder / f"{PREFIX}{d['case'].removeprefix('p2risk_')}.json"
        path.write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


@pytest.fixture(scope="module")
def docs() -> list[dict]:
    return [doc(c) for c in build_cases()]


def test_docs_hold_every_metric(docs):
    names = [d["case"] for d in docs]
    assert names == [f"p2risk_{n}" for n in ("volmanaged_v0", "dtsmom_v0", "za_v0", "nt_dtsmom_v0_ts1",
                                              "synthetic_b", "synthetic_t12", "pa_fixture")]
    for d in docs:
        assert d["schema"] == SCHEMA and d["kind"] == KIND
        assert len(d["inputs"]["dates"]) == len(d["inputs"]["r"]) and d["inputs"]["dates"][-1] <= "2021-12-31"
        values = d["values"]["ours"]
        assert all(f"rk4.{level}.value" in values for level in LEVELS) and values["pf11.ulcer_index"] is not None


def test_the_in_domain_cases_are_inside_and_nautilus_applies_to_basis_b(docs):
    by = {d["case"]: d for d in docs}
    assert by["p2risk_synthetic_t12"]["values"]["ours"]["rk4.95.in_domain"] == 1.0
    pa = by["p2risk_pa_fixture"]["values"]["ours"]
    assert pa["rk4.99.in_domain"] == 1.0 and pa["rk4.99.value"] == pytest.approx(PA_MES["99"], rel=1e-12)
    assert pa["rk4.95.in_domain"] == 0.0 and pa["rk4.95.raw_expansion"] == pytest.approx(PA_MES["95"], rel=1e-12)
    assert "br5.treynor" in by["p2risk_synthetic_b"]["values"]["nautilus"]
    assert "br5.treynor" not in by["p2risk_za_v0"]["values"]["ours"]  # one-contract: no CAGR, no Treynor
    assert by["p2risk_volmanaged_v0"]["values"]["nautilus"] == {}  # Basis A: Nautilus compounds


def test_write_p2risk_dumps(docs, tmp_path):
    folder = dump_dir() if registered() else tmp_path / "p2risk"
    paths = write_dumps(folder, docs)
    assert len(paths) == len(docs)
    back = json.loads(paths[0].read_text(encoding="utf-8"))
    assert back["kind"] == KIND and back["values"]["ours"]


def test_the_dump_folder_rules_hold():
    from nq_lab.config import RESULTS
    with pytest.raises(ValueError):
        write_dumps(RESULTS / "nqt_dump_probe", [])
