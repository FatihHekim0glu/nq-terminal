"""SV8 dumps for the reference cross-check in `terminal/qa` (TASKS Phase 12; ANALYTICS_CATALOG SV8 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules) with the prefix `nqt_p2_spa_`.
Each dump is a `spa` bundle: one family on its common index in `inputs` (member names, the benchmark's returns and each
member's returns, the replications, seed and size), and in `values.ours` what `analytics.spa.family_test` gives.
`terminal/qa/crosscheck/p2_spa.py` recomputes it with arch's `SPA` and `StepM`.

Four cases, each family against both benchmarks (arch takes any benchmark loss vector): a seeded synthetic family
built so StepM steps down (a large edge on a noisy member sets the first critical value; a small edge on a quiet member
is rejected only at the second step) against a synthetic benchmark and against cash (a zero vector, so d_i = r_i), and
the real family (the eleven registered NQ one-contract hypotheses from the research files, read only) against the
tests' synthetic NQ buy and hold through the fake serve and against cash, labelled as such: its values check the
arithmetic, not the research question.

The bundles go into the shared dump folder only once the `spa` kind is registered in the QA side's `BUNDLE_INPUTS`
(its `dumps.py`, read as text, never imported); before that an unknown kind would stop the whole cross-check, so they
are written into a temporary folder only.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import ROOT
from nq_terminal.analytics import spa
from nq_terminal.services import spa_family
from nq_terminal.services.bars import BarService
from nq_terminal.services.research import ResearchService

from fakes import make_fake_serve

PREFIX = "nqt_p2_spa_"
QA_DUMPS = Path(__file__).resolve().parents[2] / "qa" / "crosscheck" / "dumps.py"
NONE = "none"


def registered_in_qa() -> bool:
    try:
        return '"spa":' in QA_DUMPS.read_text(encoding="utf-8")
    except OSError:
        return False


def synthetic_family() -> tuple[list[str], list[str], np.ndarray, np.ndarray]:
    rng = np.random.default_rng(20260927)
    t = 800
    bench = rng.standard_normal(t) * 150.0
    noise = rng.standard_normal((t, 6)) * np.array([750.0, 150.0, 150.0, 150.0, 150.0, 150.0])
    models = bench[:, None] + noise + np.array([300.0, 22.0, 0.0, 0.0, -10.0, 0.0])
    names = [f"synthetic_{i}" for i in range(6)]
    dates = [f"s{i:04d}" for i in range(t)]
    return names, dates, bench, models


def spa_doc(case: str, source: str, names, dates, bench: np.ndarray, models: np.ndarray) -> dict:
    found = spa.family_test(bench, models)
    ours = {"t": float(found["t"]), "k": float(found["k"]), "block": found["block"],
            "block_per_column": dict(zip(names, found["block_per_column"])),
            "mean_differential": dict(zip(names, found["mean_differential"])),
            "variance": dict(zip(names, found["variance"])),
            "correlation": {f"{a}|{b}": found["correlation"][i][j] for i, a in enumerate(names)
                            for j, b in enumerate(names) if i <= j},
            "consistent_set": {n: float(v) for n, v in zip(names, found["consistent_set"])},
            "statistic": max(found["mean_differential"]),
            "superior": ",".join(names[i] for i in found["stepm"]["superior"]) or NONE,
            "reality_check": found["reality_check"],
            **{f"p_{k}": v for k, v in found["pvalues"].items()},
            **{f"crit_{k}": v for k, v in found["critical_values"].items()}}
    inputs = {"names": list(names), "dates": list(dates), "bench": bench.tolist(),
              "models": {n: models[:, j].tolist() for j, n in enumerate(names)}, "reps": found["reps"],
              "seed": found["seed"], "size": found["size"]}
    return _clean({"schema": SCHEMA, "kind": "spa", "case": case, "source": source, "inputs": inputs,
                   "values": {"ours": ours}, "missing": {}})


def cash_family() -> tuple[list[str], list[str], np.ndarray, np.ndarray]:
    """The synthetic family's excess over its own benchmark, against cash: the same differentials, a zero benchmark."""
    names, dates, bench, models = synthetic_family()
    return names, dates, np.zeros_like(bench), models - bench[:, None]


def real_doc(serve, benchmark: str) -> dict:
    fam = spa_family.family_inputs(ResearchService(ROOT), BarService(serve, cache_bytes=1 << 30), None,
                                   benchmark=benchmark)
    cash = benchmark == spa_family.CASH
    against = "cash (a zero benchmark)" if cash else "the tests' synthetic NQ buy and hold through the fake serve"
    return spa_doc("spa_registered_nq_family" + ("_cash" if cash else ""),
                   f"the registered NQ one-contract family at 1 tick (research files, read only) against {against}",
                   list(fam.names), [d.strftime("%Y-%m-%d") for d in fam.index], fam.bench.to_numpy(dtype=float),
                   fam.models.to_numpy(dtype=float))


def write_spa_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    written = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case'][len('spa_'):]}.json"
        path.write_text(json.dumps(doc, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        written.append(path)
    return written


@pytest.fixture(scope="module")
def docs(tmp_path_factory) -> list[dict]:
    serve = make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl")
    names, dates, bench, models = synthetic_family()
    cash_names, cash_dates, cash_bench, cash_models = cash_family()
    out = [spa_doc("spa_synthetic_step_down", "seeded synthetic family (not project data)", names, dates, bench,
                   models),
           spa_doc("spa_synthetic_step_down_cash", "the same synthetic family against cash, a zero benchmark (not "
                   "project data)", cash_names, cash_dates, cash_bench, cash_models),
           real_doc(serve, spa_family.NQ_BUY_AND_HOLD), real_doc(serve, spa_family.CASH)]
    assert serve.calls and all(c.caller == "terminal" for c in serve.calls)
    return out


def test_the_synthetic_family_steps_down():
    _, _, bench, models = synthetic_family()
    found = spa.family_test(bench, models)
    assert found["stepm"]["per_step"][0] == [0] and 1 in found["stepm"]["superior"]


def test_the_cash_cases_have_a_zero_benchmark_and_the_others_do_not(docs):
    zero = {d["case"]: not any(d["inputs"]["bench"]) for d in docs}
    assert zero == {"spa_synthetic_step_down": False, "spa_synthetic_step_down_cash": True,
                    "spa_registered_nq_family": False, "spa_registered_nq_family_cash": True}


def test_the_cash_synthetic_family_steps_down_as_the_benchmark_one_does():
    _, _, bench, models = cash_family()
    found = spa.family_test(bench, models)
    assert found["stepm"]["per_step"][0] == [0] and 1 in found["stepm"]["superior"]


def test_spa_docs_carry_the_inputs_and_the_served_values(docs):
    for doc in docs:
        inputs, ours = doc["inputs"], doc["values"]["ours"]
        assert set(inputs) == {"names", "dates", "bench", "models", "reps", "seed", "size"}
        assert len(inputs["dates"]) == len(inputs["bench"]) == ours["t"]
        assert list(inputs["models"]) == inputs["names"] and ours["k"] == len(inputs["names"])
        k = len(inputs["names"])
        assert len(ours["correlation"]) == k * (k + 1) // 2
        assert ours["correlation"][f'{inputs["names"][0]}|{inputs["names"][0]}'] == 1.0
        assert inputs["reps"] == 10_000 and inputs["seed"] == 20260927 and inputs["size"] == 0.05
    assert all(d["inputs"]["dates"][-1] <= "2021-12-31" for d in docs[2:])


def test_write_spa_dumps(docs, tmp_path):
    folder = dump_dir() if registered_in_qa() else tmp_path
    paths = write_spa_dumps(folder, docs)
    assert [json.loads(p.read_text(encoding="utf-8"))["case"] for p in paths] == [d["case"] for d in docs]


def test_the_prefix_leaves_other_dumps_alone(tmp_path):
    (tmp_path / "nqt_qa_keep.json").write_text("{}", encoding="utf-8")
    write_spa_dumps(tmp_path, [])
    assert (tmp_path / "nqt_qa_keep.json").exists()
