"""The exact comparison of an anchor re-run with its base (rule 3; vnext product-3). Read only, price free.

The base of `t_<base>_regress_r<N>` (or `<base>_regress_r<N>` for a base that starts with `t_`) is found from the
name: the name's base when that run exists, else the name's base without its leading `t_`. So no record of the pair
is kept anywhere: the terminal writes no sidecar, and the formal `regress_check.json` stays the lab scripts' job. An
anchor made by the lab whose name does not lead to its base (`x_regress_r8` of the run `x_a`) uses the base its own
or a sibling's `regress_check.json` names (`RunService`'s `anchor_of`).

Fields, in order: `n_trades`, `trades` (every trade row, field by field), `pnl_total`, `fees_total` and `sharpe`
(the tear sheet's own Basis B Sharpe, `RunService.account_stats`, so a run never shows two Sharpe values). Equality
is exact: no tolerance. The first field that differs makes the verdict MISMATCH and is named (a trade field as
`trades[i].key`); the first field missing on either side (an unusable run has no Sharpe) makes it NOT COMPARABLE,
because two missing values are never a match. All equal is MATCH. A re-run whose job has not left a result yet is
PENDING.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from nq_terminal.models.actions import COMPARISON_NOTE, AnchorCheck, FieldCheck
from nq_terminal.services.files import FileAccessError, FileDecodeError, thaw
from nq_terminal.services.jobs import JobService
from nq_terminal.services.runs import ANCHOR_RE, SECTION_PARSERS, RunEntry, RunService, RunUnreadable, unreadable

__all__ = ["UnknownAnchor", "base_of", "check_anchor", "first_trade_difference"]

RUN_PREFIX = "t_"
SCALARS = ("pnl_total", "fees_total")
LIVE_STATES = ("queued", "running")


class UnknownAnchor(LookupError):
    """No run folder and no job holds this re-run id."""


def _name_base(run_id: str) -> str | None:
    match = ANCHOR_RE.fullmatch(run_id) if isinstance(run_id, str) else None
    return match.group("base") if match else None


def base_of(run_id: str, entries: Mapping[str, Any]) -> str | None:
    """The base run of a re-run id among `entries` (the run index), or None."""
    base = _name_base(run_id)
    if base is None:
        return None
    if base in entries:
        return base
    plain = base[len(RUN_PREFIX):] if base.startswith(RUN_PREFIX) else None
    return plain if plain and plain in entries else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _scalar(value: Any) -> Any:
    return value if value is None or isinstance(value, (bool, int, float, str)) else str(value)


def first_trade_difference(mine: Sequence[Any], theirs: Sequence[Any]) -> tuple[str, Any, Any] | None:
    """(field, anchor value, base value) of the first trade field that differs, or None when every row is equal."""
    for index, (a, b) in enumerate(zip(mine, theirs)):
        if a == b:
            continue
        if isinstance(a, Mapping) and isinstance(b, Mapping):
            for key in [*a, *(k for k in b if k not in a)]:
                if key not in a or key not in b or a[key] != b[key]:
                    return f"trades[{index}].{key}", _scalar(a.get(key)), _scalar(b.get(key))
        return f"trades[{index}]", None, None
    if len(mine) != len(theirs):
        return "trades.length", len(mine), len(theirs)
    return None


class _Pair:
    """The two runs' heads and trades, read once through the run service's cache."""

    def __init__(self, runs: RunService, anchor: RunEntry, base: RunEntry) -> None:
        self.runs, self.anchor, self.base = runs, anchor, base

    def summary(self, entry: RunEntry) -> Mapping[str, Any]:
        return self.runs.detail(entry.run_id, anchor=False).model_dump()["summary"]

    def trades(self, entry: RunEntry) -> list[Any]:
        try:
            rows = self.runs.cache.get(entry.result, SECTION_PARSERS["trades"], kind="runs:trades")
        except (FileDecodeError, FileAccessError, OSError) as exc:
            raise RunUnreadable(unreadable(entry.run_id, "result.json", exc)) from exc
        return list(thaw(rows)) if isinstance(rows, (list, tuple)) else []


def _value_check(field: str, mine: Any, theirs: Any) -> FieldCheck:
    if mine is None or theirs is None:
        return FieldCheck(field=field, equal=None, anchor=mine, base=theirs)
    return FieldCheck(field=field, equal=mine == theirs, anchor=mine, base=theirs)


def _checks(runs: RunService, anchor: RunEntry, base: RunEntry) -> tuple[list[FieldCheck], str | None]:
    """Every field check, and the name of the first trade field that differs (if any)."""
    pair = _Pair(runs, anchor, base)
    mine, theirs = pair.summary(anchor), pair.summary(base)
    checks = [_value_check("n_trades", _number(mine.get("n_trades")), _number(theirs.get("n_trades")))]
    difference = first_trade_difference(pair.trades(anchor), pair.trades(base))
    trade_field = difference[0] if difference else None
    checks.append(FieldCheck(field="trades", equal=difference is None, anchor=difference[1] if difference else None,
                             base=difference[2] if difference else None))
    checks += [_value_check(key, _number(mine.get(key)), _number(theirs.get(key))) for key in SCALARS]
    checks.append(_value_check("sharpe", runs.account_stats(anchor.run_id)[0], runs.account_stats(base.run_id)[0]))
    return checks, trade_field


def _verdict(checks: Sequence[FieldCheck], trade_field: str | None) -> tuple[str, str | None]:
    for check in checks:
        if check.equal is None:
            return "NOT COMPARABLE", check.field
        if check.equal is False:
            return "MISMATCH", trade_field if check.field == "trades" and trade_field else check.field
    return "MATCH", None


def _job_state(jobs: JobService, run_id: str) -> str | None:
    states = [job.state for job in jobs.list_jobs().jobs if job.run_id == run_id]
    return states[0] if states else None


def check_anchor(run_id: str, *, runs: RunService, jobs: JobService) -> AnchorCheck:
    """MATCH, MISMATCH, NOT COMPARABLE or PENDING for a re-run and its base (module docstring)."""
    entries = runs.index.rescan()
    state = _job_state(jobs, run_id)
    base = base_of(run_id, entries)
    if base is None and run_id in entries:  # a lab anchor names its base in regress_check.json
        recorded = runs.detail(run_id, anchor=False).summary.anchor_of
        base = recorded if recorded in entries and recorded != run_id else None
    base_name = base or _name_base(run_id)
    common = {"anchor": run_id, "base": base_name, "base_found": base is not None, "job_state": state,
              "note": COMPARISON_NOTE}
    if run_id not in entries:
        if state in LIVE_STATES:
            return AnchorCheck(**common, verdict="PENDING", first_difference=None, checks=[])
        raise UnknownAnchor("unknown re-run")
    if base is None:
        return AnchorCheck(**common, verdict="NOT COMPARABLE", first_difference="base", checks=[])
    checks, trade_field = _checks(runs, entries[run_id], entries[base])
    verdict, first = _verdict(checks, trade_field)
    return AnchorCheck(**common, verdict=verdict, first_difference=first, checks=checks)
