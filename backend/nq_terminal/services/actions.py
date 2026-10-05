"""The two actions (vnext product-1 and product-3): a backtest from a launch preset, and a regression-anchor re-run.

Both end in `JobService.enqueue` with a `JobSpec`, so the one worker runs the one runner `backtests/run_base.py` with
a JSON config string, exactly as a job queued on JOBS: no other process, no shell, the same environment allow list,
and the in-sample fence checked by the spec before the child starts and by the OOS gate inside it. The server builds
the config from the preset (a ledger row) or from the base run's own `result.json`; the client names only the preset
or the base, the named parameters, the window and the run id. This module writes nothing: it never touches the
ledger, `results/`, `experiments/` or a run folder, and it never reaches the sealed door.

Run ids
- A backtest may not choose a regression-anchor id (`_regress_r<N>`, `_haltfix_r<N>`): only an anchor re-run mints one,
  so a run with that suffix is always the base's own config.
- A backtest without a chosen id gets `t_<exp_id>_<N>`, N the smallest free from 1.
- An anchor re-run gets `<base>_regress_r<N>` when the base already starts with `t_`, else `t_<base>_regress_r<N>`,
  N the smallest free from 1; an id past the job spec's 82 characters is refused. Taken means a run folder, or any
  job, already holds the id (the queue checks it again on enqueue).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Mapping

from pydantic import ValidationError

from nq_terminal.models.actions import ActionResult, AnchorAction, BacktestAction
from nq_terminal.models.jobs import RUN_ID, Job, JobSpec
from nq_terminal.services import launch_params
from nq_terminal.services.anchor_check import UnknownAnchor
from nq_terminal.services.jobs import JobService
from nq_terminal.services.launch_params import Problem
from nq_terminal.services.presets import UnknownPreset, find_preset
from nq_terminal.services.runs import ANCHOR_RE, RunNotFound, RunService

__all__ = ["ActionRefused", "UnknownAnchor", "UnknownBase", "UnknownPreset", "anchor_run_id", "rerun_anchor",
           "start_backtest", "suggest_run_id"]

RUN_PREFIX = "t_"
MAX_RUN_ID = 82  # models.jobs.RUN_ID_PATTERN: t_ and 1 to 80 characters
MAX_SUFFIX_TRIES = 10_000
CONFIG_KEYS = ("strategy", "params", "variant", "start", "end")


class ActionRefused(ValueError):
    """The action breaks a launch rule; `problems` holds (location, reason) pairs for the 422 detail."""

    def __init__(self, problems: Iterable[Problem]) -> None:
        self.problems = list(problems)
        super().__init__("; ".join(msg for _, msg in self.problems))


class UnknownBase(LookupError):
    """The base run of an anchor re-run is not in the run index."""


def taken_ids(runs: RunService, jobs: JobService) -> set[str]:
    return set(runs.index.rescan()) | {job.run_id for job in jobs.list_jobs().jobs}


def _first_free(stem: str, taken: set[str]) -> str:
    for number in range(1, MAX_SUFFIX_TRIES):
        candidate = f"{stem}{number}"
        if candidate not in taken:
            return candidate
    raise ActionRefused([(("run_id",), "no free run id is left for this name")])


def suggest_run_id(name: str, taken: set[str]) -> str:
    """`t_<name>_<N>`; a long name is cut so the id stays within the limit (it is only a suggestion)."""
    room = MAX_RUN_ID - len(RUN_PREFIX) - 1 - len(str(MAX_SUFFIX_TRIES))
    return _first_free(f"{RUN_PREFIX}{name[:room]}_", taken)


def anchor_run_id(base: str, taken: set[str]) -> str:
    """The next free regression-anchor id of `base` (module docstring); refused when it would be too long."""
    stem = (base if base.startswith(RUN_PREFIX) else RUN_PREFIX + base) + "_regress_r"
    run_id = _first_free(stem, taken)
    if len(run_id) > MAX_RUN_ID or not RUN_ID.fullmatch(run_id):
        raise ActionRefused([(("base_run_id",), f"the re-run id would be longer than {MAX_RUN_ID} characters")])
    return run_id


def _spec(config: Mapping[str, Any], run_id: str) -> JobSpec:
    """The job spec of `config` under `run_id`; its own refusals become ActionRefused."""
    try:
        return JobSpec.model_validate({**{k: config.get(k) for k in CONFIG_KEYS}, "run_id": run_id})
    except ValidationError as exc:
        problems = [(tuple(str(part) for part in e["loc"]) or ("config",), e["msg"])
                    for e in exc.errors(include_url=False, include_context=False, include_input=False)]
        raise ActionRefused(problems) from None


def _enqueue(jobs: JobService, spec: JobSpec) -> Job:
    problems = [*launch_params.param_problems(spec.strategy, spec.params),
                *launch_params.window_problems(spec.start, spec.end)]
    if problems:
        raise ActionRefused(problems)
    return jobs.enqueue(spec)


def start_backtest(action: BacktestAction, *, runs: RunService, jobs: JobService) -> ActionResult:
    """Queue a backtest of the preset's config with the action's named parameters, window and run id."""
    preset = find_preset(runs, action.preset_id)
    edits = launch_params.param_problems(preset.strategy, {**preset.params, **action.params})
    if edits:
        raise ActionRefused(edits)
    params = launch_params.normalised(preset.strategy, {**preset.params, **action.params})
    start = action.start or date.fromisoformat(preset.start)
    end = action.end or date.fromisoformat(preset.end)
    window = launch_params.window_problems(start, end)
    if window:
        raise ActionRefused(window)
    if action.run_id and ANCHOR_RE.fullmatch(action.run_id):  # only rerun_anchor mints a rule 3 id
        raise ActionRefused([(("run_id",), "a regression-anchor id is only given by an anchor re-run")])
    run_id = action.run_id or suggest_run_id(preset.exp_id or preset.preset_id, taken_ids(runs, jobs))
    config = {"strategy": preset.strategy, "params": params, "variant": preset.variant, "start": start.isoformat(),
              "end": end.isoformat()}
    job = _enqueue(jobs, _spec(config, run_id))
    changed = sorted(name for name in params if name not in preset.params or params[name] != preset.params[name])
    resolved = action.model_copy(update={"params": params, "start": start, "end": end, "run_id": run_id})
    return ActionResult(kind="backtest", job=job, action=resolved, preset_id=preset.preset_id, base_run_id=None,
                        changed_params=changed)


def rerun_anchor(action: AnchorAction, *, runs: RunService, jobs: JobService) -> ActionResult:
    """Queue the base run's own config under a fresh regression-anchor id (rule 3)."""
    try:
        config = runs.detail(action.base_run_id, anchor=False).config
    except RunNotFound:
        raise UnknownBase("unknown base run") from None
    run_id = anchor_run_id(action.base_run_id, taken_ids(runs, jobs))
    job = _enqueue(jobs, _spec(config, run_id))
    return ActionResult(kind="anchor", job=job, action=action, preset_id=None, base_run_id=action.base_run_id,
                        changed_params=[])

