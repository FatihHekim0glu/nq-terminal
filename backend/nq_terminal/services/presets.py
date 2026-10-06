"""Launch presets (vnext product-1): the ledger rows of registered strategies, offered as starting points. Read only.

Built from `results/ledger.csv` alone, read through the run service's file cache (the same parse and cache key as
`/api/ledger`), so no price is read and nothing is written. Newest first (by `ts_utc`), de-duplicated by (strategy,
params, variant, start, end): an older row with the same config is not offered again. A row is skipped when its
strategy is not one the JOBS queue runs, its dates do not parse, or its window leaves `[2010-01-01, 2022-01-01)`.
A row whose params break the launch rules or the job spec is listed with `launchable` false and the reasons, so the
screen can say why it cannot be started.

Each preset carries `spec_sha256`, the sha256 of `experiments/<exp_id>.json` when the exp id is a plain file stem and
that file exists, read through the same file cache (keyed on the file's mtime and size, so an edited spec is hashed
again); else None. The spec file is only read: nothing under `experiments/` is written or edited.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date
from typing import Any, Mapping

from pydantic import ValidationError

from nq_terminal.models.actions import LaunchPreset, PresetList, StrategyParams
from nq_terminal.models.jobs import IN_SAMPLE_END, IN_SAMPLE_START, STRATEGY_NAMES, VARIANTS, JobSpec
from nq_terminal.services import launch_params
from nq_terminal.services.audit import spec_path
from nq_terminal.services.files import FileAccessError
from nq_terminal.services.runs import RUN_ID_RE, RunService, parse_ledger

CHECK_RUN_ID = "t_preset_check"  # a placeholder id: only the spec's other checks matter for a preset
SPEC_HASH_KIND = "presets:spec_sha256"


class UnknownPreset(LookupError):
    """No offered preset has this id."""


def _day(text: Any) -> date | None:
    try:
        return date.fromisoformat(text) if isinstance(text, str) and len(text) == 10 else None
    except ValueError:
        return None


def _params(text: Any) -> dict[str, Any] | None:
    try:
        value = json.loads(text) if isinstance(text, str) and text else {}
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _runtime(text: Any) -> float | None:
    try:
        value = float(text) if isinstance(text, str) and text else None
    except ValueError:
        return None
    return value if value is not None and math.isfinite(value) else None


def _offered(row: Mapping[str, Any]) -> bool:
    start, end = _day(row.get("start")), _day(row.get("end"))
    return (row.get("strategy") in STRATEGY_NAMES and row.get("variant") in VARIANTS
            and isinstance(row.get("run_id"), str) and RUN_ID_RE.fullmatch(row["run_id"]) is not None
            and _params(row.get("params_json")) is not None and start is not None and end is not None
            and IN_SAMPLE_START <= start < end <= IN_SAMPLE_END)


def spec_reasons(strategy: str, params: Mapping[str, Any], variant: str, start: str, end: str) -> list[str]:
    """Why the preset cannot be launched as it stands (launch rules, then the job spec's own checks)."""
    reasons = [msg for _, msg in launch_params.param_problems(strategy, params)]
    try:
        JobSpec.model_validate({"strategy": strategy, "params": dict(params), "variant": variant, "start": start,
                                "end": end, "run_id": CHECK_RUN_ID})
    except ValidationError as exc:
        reasons += [e["msg"] for e in exc.errors(include_url=False, include_context=False, include_input=False)]
    return list(dict.fromkeys(reasons))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def spec_sha256(runs: RunService, exp_id: str | None) -> str | None:
    """The sha256 of `experiments/<exp_id>.json` under the data root, or None (no exp id, not a plain file stem, no
    such file, or a file the cache refuses). Read only."""
    path = spec_path(runs.data_root, exp_id) if exp_id else None
    if path is None:
        return None
    try:
        return runs.cache.get(path, _sha256, kind=SPEC_HASH_KIND)
    except (FileNotFoundError, FileAccessError):
        return None


def _preset(runs: RunService, row: Mapping[str, Any], found: bool) -> LaunchPreset:
    params = _params(row.get("params_json")) or {}
    reasons = spec_reasons(row["strategy"], params, row["variant"], row["start"], row["end"])
    raw_exp = row.get("exp_id")
    exp_id = raw_exp if isinstance(raw_exp, str) and raw_exp else None
    return LaunchPreset(preset_id=row["run_id"], exp_id=exp_id, spec_sha256=spec_sha256(runs, exp_id),
                        ts_utc=row.get("ts_utc") or None, strategy=row["strategy"], variant=row["variant"],
                        start=row["start"], end=row["end"], params=params, runtime_s=_runtime(row.get("runtime_s")),
                        run_found=found, launchable=not reasons, reasons=reasons)


def _key(row: Mapping[str, Any]) -> tuple[str, ...]:
    params = json.dumps(_params(row.get("params_json")), sort_keys=True)
    return row["strategy"], params, row["variant"], row["start"], row["end"]


def ledger_rows(runs: RunService) -> tuple[Mapping[str, Any], ...] | None:
    """The ledger's rows through the run service's cache (None when there is no ledger file)."""
    try:
        return runs.cache.get(runs.ledger_path, parse_ledger, kind="runs:ledger")
    except FileNotFoundError:
        return None


def _newest_unique(rows: tuple[Mapping[str, Any], ...]) -> list[Mapping[str, Any]]:
    ordered = sorted((r for r in rows if _offered(r)), key=lambda r: str(r.get("ts_utc") or ""), reverse=True)
    unique: dict[tuple[str, ...], Mapping[str, Any]] = {}
    for row in ordered:
        unique.setdefault(_key(row), row)
    return list(unique.values())


def list_presets(runs: RunService) -> PresetList:
    rows = ledger_rows(runs)
    if rows is None:
        return PresetList(ledger_found=False, presets=[], strategies=[])
    entries = runs.index.entries()
    presets = [_preset(runs, row, row["run_id"] in entries) for row in _newest_unique(rows)]
    strategies = list(dict.fromkeys(p.strategy for p in presets))
    schemas = [StrategyParams(strategy=s, params=launch_params.schema(s)) for s in strategies]
    return PresetList(ledger_found=True, presets=presets, strategies=schemas)


def find_preset(runs: RunService, preset_id: str) -> LaunchPreset:
    """The offered preset with this id (an unknown, skipped or de-duplicated row is refused)."""
    for preset in list_presets(runs).presets:
        if preset.preset_id == preset_id:
            return preset
    raise UnknownPreset("unknown preset")
