"""SV9 served, as dump kinds (`p12plan` and `p12power`): the planner and the power table the backend serves, against
scipy, in the cross-check.

`p12_plan.py` and `p12_power.py` are the references and stay free of the cross-check package, because the backend tests
load them by path. This module is the thin layer that lets `compare.py` use them.

- `p12plan`: `inputs.designs` is a list of planner designs (`periods`, `n`, `alpha`, `k_registry`, `k_typed`, `sharpe`,
  `event_sd`); `values.ours["plan.numbers"]` and `["plan.labels"]` are the served plans for those designs, flattened by
  `p12_plan.flatten_plans` (every number in key order, a missing figure as NaN; every word and flag in key order). The reference
  is `p12_plan.reference_plan` over the same designs, flattened the same way, so a different structure (a slot more or
  less) changes the length and fails.
- `p12power`: `inputs.rows` is a list of books (`periods`, `n`), `inputs.alpha` and `inputs.k` the family; the served
  figures are `values.ours["power.<figure>"]`, one entry per book. The reference is `p12_power.mde` and `power_at` at
  the family alpha, `alpha / k`, power 0.8 and the reference Sharpe 0.5.

The dump writer is `backend/tests/test_dump_for_qa_p12_sv9.py`.
"""
from __future__ import annotations

from crosscheck.p12_plan import POWER_TARGET, REFERENCE_SHARPE, flatten_plans, reference_plan
from crosscheck.p12_power import mde, power_at
from crosscheck.reference import Ref

PLAN_SOURCE = "qa/crosscheck/p12_plan.py (scipy.stats.norm)"
POWER_SOURCE = "qa/crosscheck/p12_power.py (scipy.stats.norm)"
PLAN_KEYS = ("plan.numbers", "plan.labels")
POWER_KEYS = ("power.mde_nominal", "power.mde_family", "power.power_nominal", "power.power_family")


def plan_references(inputs: dict) -> dict[str, Ref]:
    flat = flatten_plans([reference_plan(**design) for design in inputs["designs"]])
    return {key: Ref(flat[key], PLAN_SOURCE) for key in PLAN_KEYS}


def power_references(inputs: dict) -> dict[str, Ref]:
    alpha, k = float(inputs["alpha"]), int(inputs["k"])
    family = alpha / k
    books = [(int(row["n"]), int(row["periods"])) for row in inputs["rows"]]
    figures = {
        "power.mde_nominal": [mde(n, p, alpha, POWER_TARGET) for n, p in books],
        "power.mde_family": [mde(n, p, family, POWER_TARGET) for n, p in books],
        "power.power_nominal": [power_at(REFERENCE_SHARPE, n, p, alpha) for n, p in books],
        "power.power_family": [power_at(REFERENCE_SHARPE, n, p, family) for n, p in books],
    }
    return {key: Ref(figures[key], POWER_SOURCE) for key in POWER_KEYS}


P12_SV9_REFERENCES = {"p12plan": plan_references, "p12power": power_references}
