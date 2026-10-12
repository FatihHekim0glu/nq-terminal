"""SV9 served, dumped for the reference cross-check in `terminal/qa` (wave w3-research-integrity; ANALYTICS_CATALOG SV9).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_w3_sv9_`, two kinds:

- `p12plan`: every 37th design of `qa/crosscheck/p12_plan.py`'s grid, asked of `GET /api/analytics/plan` on the fixture
  app (registry family 2), with the served plans flattened by the reference module's own `flatten_plans`.
- `p12power`: the fixture app's `GET /api/analytics/power` table, one entry per Deflated Sharpe row.

Neither route reads a price or a result file beyond the registry count, so the bar service is never asked and no gate line
is written. The reference modules are loaded by path (the backend never imports the QA package). The cross-check
(`python -m crosscheck`) recomputes both from scipy.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir
from fakes import make_fake_serve
from test_plan_route import PLAN_ROUTE, POWER_ROUTE, client_for, get

PREFIX = "nqt_w3_sv9_"
CROSSCHECK = Path(__file__).resolve().parents[2] / "qa" / "crosscheck"
SAMPLE_EVERY = 37
FIXTURE_REGISTRY_K = 2  # the fixture registry holds two registered hypotheses with a p value


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"sv9_dump_{name}", CROSSCHECK / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def served_plan(client, design: dict) -> dict:
    query = {k: v for k, v in design.items() if v is not None and k not in ("k_registry", "k_typed")}
    query["k"] = design["k_typed"]
    served = get(client, PLAN_ROUTE, **query)
    for key in ("family_k_registry", "registry_note"):
        served.pop(key)
    return served


def plan_doc(client) -> dict:
    plan = load("p12_plan")
    designs = [{**d, "k_registry": FIXTURE_REGISTRY_K} for d in plan.grid_inputs()[::SAMPLE_EVERY]]
    flat = plan.flatten_plans([served_plan(client, d) for d in designs])
    return _clean({"schema": SCHEMA, "kind": "p12plan", "case": "plan_grid_sample",
                   "source": f"GET {PLAN_ROUTE} on the fixture app, every {SAMPLE_EVERY}th design of the grid",
                   "inputs": {"designs": designs}, "values": {"ours": flat}, "missing": {}})


def power_doc(client) -> dict:
    table = get(client, POWER_ROUTE)
    ours = {f"power.{key}": [row[key] for row in table["rows"]]
            for key in ("mde_nominal", "mde_family", "power_nominal", "power_family")}
    rows = [{"name": row["name"], "periods": row["periods"], "n": row["n"]} for row in table["rows"]]
    return _clean({"schema": SCHEMA, "kind": "p12power", "case": "power_fixture",
                   "source": f"GET {POWER_ROUTE} on the fixture app",
                   "inputs": {"rows": rows, "alpha": table["alpha"], "k": table["k"]},
                   "values": {"ours": ours}, "missing": {}})


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for d in docs:
        path = folder / f"{PREFIX}{d['kind']}_{d['case']}.json"
        path.write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


@pytest.fixture(scope="module")
def docs(tmp_path_factory) -> list[dict]:
    client = client_for(make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"))
    return [plan_doc(client), power_doc(client)]


def test_the_plan_dump_carries_the_designs_and_one_flat_plan_each(docs):
    doc = docs[0]
    assert doc["kind"] == "p12plan" and len(doc["inputs"]["designs"]) > 50
    assert {d["k_registry"] for d in doc["inputs"]["designs"]} == {FIXTURE_REGISTRY_K}
    assert len(doc["values"]["ours"]["plan.numbers"]) > 0 and len(doc["values"]["ours"]["plan.labels"]) > 0


def test_the_flattened_served_plans_equal_the_flattened_reference(docs):
    """Born failing in the QA package (`qa/tests/test_p12_sv9.py`); here the served side meets the reference side."""
    plan = load("p12_plan")
    doc = docs[0]
    want = plan.flatten_plans([plan.reference_plan(**d) for d in doc["inputs"]["designs"]])
    ours = doc["values"]["ours"]
    assert ours["plan.labels"] == want["plan.labels"]
    assert len(ours["plan.numbers"]) == len(want["plan.numbers"])
    for got, ref in zip(ours["plan.numbers"], want["plan.numbers"]):
        assert (got is None and ref != ref) or abs(got - ref) <= 1e-12 * max(abs(ref), 1e-300)


def test_the_power_dump_has_a_figure_per_book(docs):
    doc = docs[1]
    assert doc["kind"] == "p12power" and doc["inputs"]["k"] == FIXTURE_REGISTRY_K
    assert all(len(v) == len(doc["inputs"]["rows"]) for v in doc["values"]["ours"].values())


def test_write_the_sv9_dumps(docs):
    paths = write_dumps(dump_dir(), docs)
    assert [p.name for p in paths] == [f"{PREFIX}p12plan_plan_grid_sample.json", f"{PREFIX}p12power_power_fixture.json"]
    assert json.loads(paths[0].read_text(encoding="utf-8"))["schema"] == SCHEMA
