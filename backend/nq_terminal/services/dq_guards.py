"""Guard fingerprint status (ANALYTICS RI5): each guard group of `nq_lab.guards` against the lab's own record.

Groups are the upper-case dicts of `nq_lab.guards` (CONSTANTS, SIZING_GUARDS, ...), so a group added later shows up
at once, as NO RECORD until it is pinned. The live fingerprint is `nq_lab.guards.fingerprint(group)`. Records:
- CONSTANTS: `results/guard_constants.json` (`sha256` and the frozen `constants`, written by the lab's freeze
  script); the frozen values also name the changed keys on a mismatch;
- every later group: the sha256 literal the lab pins in its own test of that group (`tests/test_*_guards.py`,
  `tests/test_sealed_pins.py`), read as source text with `ast` (the module is never imported or run).
Read only. Pins are read from the project root even in fixture mode (they are code, not results).
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Any, Mapping

from nq_lab import guards
from nq_terminal.models.dq import GuardGroup, GuardStatusReport
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError

LABEL = ("guard fingerprint status: sha256 of each nq_lab.guards group against the lab's record; "
         "descriptive, no price is read")
CONSTANTS_RECORD = "guard_constants.json"
PINS: Mapping[str, tuple[str, str]] = {
    "SIZING_GUARDS": ("tests/test_sizing_guards.py", "FROZEN_SIZING_SHA"),
    "DTSMOM_GUARDS": ("tests/test_dtsmom_guards.py", "FROZEN_DTSMOM_SHA"),
    "MIM_GUARDS": ("tests/test_mim_guards.py", "FROZEN_MIM_SHA"),
    "SEALED_GATE_PINS": ("tests/test_sealed_pins.py", "FROZEN_SEALED_PINS_SHA"),
    "CARRY_GUARDS": ("tests/test_carry_guards.py", "FROZEN_CARRY_SHA"),
    "EOMTSY_GUARDS": ("tests/test_eomtsy_guards.py", "PINNED"),
    "CSKEW_GUARDS": ("tests/test_cskew_guards.py", "PINNED"),
    "VT_HAR_GUARDS": ("tests/test_vt_har_guards.py", "PINNED"),
    "VT_HAR_AMEND1_GUARDS": ("tests/test_vt_har_guards.py", "AMEND1_PINNED"),
    "VT_HAR_AMEND2_GUARDS": ("tests/test_vt_har_guards.py", "AMEND2_PINNED"),
    "VRP_GUARDS": ("tests/test_vrp_guards.py", "PINNED"),
    "FXEOM_GUARDS": ("tests/test_fxeom_guards.py", "PINNED"),
}
MAX_PIN_BYTES = 1024 * 1024


def live_groups() -> dict[str, dict]:
    return {name: value for name, value in vars(guards).items() if name.isupper() and isinstance(value, dict)}


def read_pin(path: Path, name: str) -> str | None:
    """The string assigned to `name` at module level in `path`; None when absent, not a plain literal, or assigned
    more than once anywhere in the file (an ambiguous pin is no record)."""
    try:
        if Path(path).stat().st_size > MAX_PIN_BYTES:
            return None
        tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError, ValueError):
        return None
    assigns = [node for node in ast.walk(tree) if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign))
               and any(isinstance(t, ast.Name) and t.id == name
                       for t in (node.targets if isinstance(node, ast.Assign) else [node.target]))]
    if len(assigns) != 1 or assigns[0] not in tree.body or not isinstance(assigns[0], ast.Assign):
        return None
    value = assigns[0].value
    return value.value if isinstance(value, ast.Constant) and isinstance(value.value, str) else None


def _status(live: str, recorded: str | None) -> str:
    if recorded is None:
        return "NO RECORD"
    return "OK" if recorded == live else "MISMATCH"


def _constants_group(files: FileCache, results: Path, values: dict) -> GuardGroup:
    live = guards.fingerprint(values)
    try:
        doc: Any = files.read_json(Path(results) / CONSTANTS_RECORD)
    except (FileNotFoundError, FileAccessError, FileDecodeError):
        doc = None
    recorded = doc.get("sha256") if isinstance(doc, Mapping) and isinstance(doc.get("sha256"), str) else None
    frozen = doc.get("constants") if isinstance(doc, Mapping) and isinstance(doc.get("constants"), Mapping) else {}
    changed = sorted(k for k in set(values) | set(frozen) if frozen and values.get(k) != frozen.get(k))
    return GuardGroup(name="CONSTANTS", keys=len(values), live_sha256=live, recorded_sha256=recorded,
                      record=f"results/{CONSTANTS_RECORD}", status=_status(live, recorded), changed_keys=changed)


def _pinned_group(name: str, values: dict, root: Path) -> GuardGroup:
    live = guards.fingerprint(values)
    where = PINS.get(name)
    recorded = read_pin(Path(root) / where[0], where[1]) if where else None
    record = f"{where[0]} {where[1]}" if where else "none"
    return GuardGroup(name=name, keys=len(values), live_sha256=live, recorded_sha256=recorded, record=record,
                      status=_status(live, recorded), changed_keys=[])


def guard_status(files: FileCache, results: Path, root: Path) -> GuardStatusReport:
    groups = [_constants_group(files, results, values) if name == "CONSTANTS" else _pinned_group(name, values, root)
              for name, values in live_groups().items()]
    tally = {s: sum(g.status == s for g in groups) for s in ("OK", "MISMATCH", "NO RECORD")}
    return GuardStatusReport(label=LABEL, groups=groups, ok=tally["OK"], mismatch=tally["MISMATCH"],
                             no_record=tally["NO RECORD"])
