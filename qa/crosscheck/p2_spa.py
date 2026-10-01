"""Reference values for the SV8 dumps (TASKS Phase 12; ANALYTICS_CATALOG SV8), recomputed with arch 8.0.0.

The `spa` bundle holds one family on its common index: the member names, the benchmark's returns `bench` and each
member's returns `models[name]`, with the replications, the seed and the StepM size. The reference builds the losses
itself (`-bench`, `-models`), takes each loss differential's block length from arch's `optimal_block_length` on a
DataFrame of `-bench - (-models)` (column by column) and uses their mean floored at 1 (a block below 1 makes
`p = 1/block` exceed 1 and breaks the kernel variance; arch's own `_compute_variance` has the same flaw, so the
crosscheck cannot catch it and the floor is pinned by a backend test), then runs arch's `SPA` and `StepM` with that
block and seed. The terminal draws arch's random numbers in arch's order, so every value is exact under the seed.

Nautilus has no Reality Check, SPA or StepM statistic, so there is no third implementation; the observed statistic,
the maximum mean differential, is recomputed with pandas as a second exact reference. `statistic_note` records (INFO)
that arch 8.0.0 does not studentise the statistic: its variances only set the consistent recentring.

`correlation` is the Pearson correlation of the loss differentials (the series the bootstrap resamples), recomputed
with pandas and again with numpy, both against the terminal's own centred-and-scaled product.

The StepM result compares as one word (the rejected names joined by commas, or "none"), so an empty set and a
non-empty one never pass each other.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from arch.bootstrap import SPA, StepM, optimal_block_length

from crosscheck.reference import DOCUMENTED, Ref

BUNDLE_INPUTS = ("names", "dates", "bench", "models", "reps", "seed", "size")
NONE = "none"
MIN_BLOCK = 1.0
CORRELATION_KEYS = ("correlation", "correlation_numpy")
STATISTIC_NOTE = ("arch 8.0.0 SPA: the statistic is max mean(d_i), not studentised; the kernel variances set only the "
                  "consistent recentring (White's form, not Hansen's studentised T^SPA)")


class CumulativeStepM(StepM):
    """arch 8.0.0 StepM with Romano-Wolf's stopping rule: stop when nothing new is rejected or nothing is left.

    arch's own loop tests the last step's rejections against k, so when a later step rejects every remaining model it
    runs a step on an empty set and raises a ValueError. This copy tests the cumulative count; where arch does not
    raise, the two loops are the same.
    """

    def compute(self) -> None:
        self.spa.compute()
        better_models = [int(i) for i in self.spa.better_models(self.size)]
        all_better_models = better_models[:]
        while better_models and len(all_better_models) < self.k:
            selector = np.ones(self.k, dtype=np.bool_)
            selector[np.array(all_better_models)] = False
            self.spa.subset(selector)
            self.spa.compute()
            better_models = list(self.spa.better_models(self.size))
            all_better_models.extend(better_models)
        self.spa.subset(np.ones(self.k, dtype=np.bool_))
        all_better_models.sort()
        self._superior_models = all_better_models


def superior_word(names) -> str:
    """StepM's rejected names as one comparable word."""
    return ",".join(names) if names else NONE


def _family(inputs: dict) -> tuple[list[str], np.ndarray, np.ndarray]:
    names = [str(n) for n in inputs["names"]]
    bench = np.array(inputs["bench"], dtype=float)
    models = np.column_stack([np.array(inputs["models"][n], dtype=float) for n in names])
    return names, -bench, -models


def correlation_word(names: list[str], matrix) -> dict:
    """The upper triangle with the diagonal as `a|b` words: a flat dict the comparison already judges."""
    return {f"{a}|{b}": float(matrix[i][j]) for i, a in enumerate(names) for j, b in enumerate(names) if i <= j}


def spa_references(inputs: dict) -> dict:
    names, loss_bench, loss_models = _family(inputs)
    reps, seed, size = int(inputs["reps"]), int(inputs["seed"]), float(inputs["size"])
    d = loss_bench[:, None] - loss_models
    blocks = optimal_block_length(pd.DataFrame(d, columns=names))["stationary"].to_numpy()
    block = max(MIN_BLOCK, float(np.mean(blocks)))  # the terminal floors the family block at 1 session
    test = SPA(loss_bench, loss_models, block_size=block, reps=reps, seed=seed)
    test.compute()
    step = CumulativeStepM(loss_bench, loss_models, size=size, block_size=block, reps=reps, seed=seed)
    step.compute()
    src = f"arch SPA and StepM(size={size}, cumulative stop), block {block:.6g}, {reps} replications, seed {seed}"
    pvalues, crit = test.pvalues, test.critical_values(size)
    means = pd.DataFrame(d, columns=names).mean()
    correlation = pd.DataFrame(d, columns=names).corr().to_numpy()
    out = {"t": Ref(float(len(d)), "rows of the common index"), "k": Ref(float(len(names)), "members"),
           "block": Ref(block, "mean of arch optimal_block_length(DataFrame(d))['stationary'], floored at 1"),
           "block_per_column": Ref({n: float(b) for n, b in zip(names, blocks)}, "arch optimal_block_length"),
           "mean_differential": Ref({n: float(means[n]) for n in names}, "pandas DataFrame.mean of d"),
           "variance": Ref({n: float(v) for n, v in zip(names, test._loss_diff_var)}, "arch SPA kernel variance"),
           "consistent_set": Ref({n: float(v) for n, v in zip(names, test._valid_columns)},
                                 "arch SPA ln ln t bound (1 in the set, 0 out)"),
           "statistic": Ref(float(means.max()), "pandas: max over members of mean(d)"),
           "superior": Ref(superior_word([names[i] for i in step.superior_models]), src),
           "correlation": Ref(correlation_word(names, correlation), "pandas DataFrame.corr of d (Pearson)"),
           "correlation_numpy": Ref(correlation_word(names, np.corrcoef(d, rowvar=False)),
                                    "numpy corrcoef of d (rowvar False)", against="correlation"),
           "statistic_note": Ref(STATISTIC_NOTE, "arch/bootstrap/multiple_comparison.py, SPA.compute", DOCUMENTED)}
    for kind in ("lower", "consistent", "upper"):
        out[f"p_{kind}"] = Ref(float(pvalues[kind]), src)
        out[f"crit_{kind}"] = Ref(float(crit[kind]), src)
    out["reality_check"] = Ref(float(pvalues["upper"]), "arch SPA upper p-value (White's Reality Check)")
    return out


P2_SPA_INPUTS = {"spa": BUNDLE_INPUTS}
P2_SPA_REFERENCES = {"spa": spa_references}
