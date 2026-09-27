"""GET /api/commands: the mnemonic list and the context index for the command line and HELP (UI_SPEC s5).

The mnemonic table lives in `constants.MNEMONICS` (ARCHITECTURE s2) and a test pins it to UI_SPEC section 5; the
web registry (`web/src/commands/registry.ts`) is the single source for the parser and HELP and is checked against
this list by the front-end tests. The context index is read from the files at request time, never hard-coded:
instruments from the frozen dtsmom universe (`nq_lab.dtsmom_universe.TABLE`) plus the catalog-only roots in
`constants.EXTRA_INSTRUMENTS` (RTY has a 1m series but no daily file), hypothesis names from
`results/registry.csv` through the shared research reader (none, with the reason, while the file is half
written), confirmations from the openings file, and run ids from the folder names under `backtests/output/` that
hold a `result.json` (names only; nothing is opened).
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Request

from nq_lab.dtsmom_universe import TABLE
from nq_terminal.constants import EXTRA_INSTRUMENTS, MNEMONICS
from nq_terminal.models.common import ResponseModel
from nq_terminal.services import audit
from nq_terminal.services.research import ResearchDataError

router = APIRouter(prefix="/api", tags=["commands"])

GRAMMAR = "<context> <FUNCTION> [args]"
UNIVERSE = "27F"
RUN_ID = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")


class Mnemonic(ResponseModel):
    code: str
    screen: str
    priority: str
    context: str


class Instrument(ResponseModel):
    root: str
    symbol: str
    sector: str


class CommandIndex(ResponseModel):
    grammar: str
    mnemonics: list[Mnemonic]
    instruments: list[Instrument]
    universe: list[str]
    hypotheses: list[str]
    confirmations: list[str]
    runs: list[str]
    registry_error: str | None = None


def run_ids(root: Path) -> list[str]:
    """Folder names under backtests/output that hold a result.json, sorted; odd names are skipped."""
    folder = root / "backtests" / "output"
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir()
                  if RUN_ID.fullmatch(p.name) and p.is_dir() and (p / "result.json").is_file())


def _hypotheses(root: Path) -> tuple[list[str], str | None]:
    """Registry names through the shared reader; none (with the reason) while the file is half written."""
    try:
        rows = audit.read_registry(root) or ()
    except ResearchDataError as exc:
        return [], str(exc)
    return [name for r in rows if (name := r.name.strip())], None


def command_index(root: Path) -> CommandIndex:
    hypotheses, registry_error = _hypotheses(root)
    return CommandIndex(
        grammar=GRAMMAR,
        mnemonics=[Mnemonic(code=c, screen=s, priority=p, context=x) for c, s, p, x in MNEMONICS],
        instruments=[Instrument(root=root, symbol=f"{root}.V.0", sector=sector)
                     for root, sector in [*((c.root, c.sector) for c in TABLE), *EXTRA_INSTRUMENTS]],
        universe=[UNIVERSE],
        hypotheses=hypotheses,
        confirmations=audit.opening_callers(root),
        runs=run_ids(root),
        registry_error=registry_error,
    )


@router.get("/commands", response_model=CommandIndex)
def commands(request: Request) -> CommandIndex:
    """Mnemonics and the context index (instruments, hypotheses, confirmations, runs) for the command line."""
    return command_index(request.app.state.settings.data_root)
