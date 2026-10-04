"""Instrument endpoint (GET only): `/api/instruments/{root}`, the instrument DES tabs (`services.instruments`).

`root` must match `^[A-Z0-9]{1,5}$` (else 422) and name a root the terminal knows: the 27 universe futures, the
catalog-only extras (`constants.EXTRA_INSTRUMENTS`) or a root with a processed series in the catalog (else 404,
before any file is read). No price is read: the catalog describes files from their parquet footers, the OOS log
and the results files are read through the data services' confined caches; the logged-read count comes from the
OOS log's compact index (W5C D6), so no log entry is decoded. Errors never carry a path.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import Path as PathParam

from nq_terminal.api.audit import read_log
from nq_terminal.api.data import DataServices, get_services
from nq_terminal.api.system import gate_stats
from nq_terminal.models.common import error_responses
from nq_terminal.models.instruments import InstrumentDes
from nq_terminal.services import instruments, journals
from nq_terminal.services.bars import CALLER
from nq_terminal.services.files import FileAccessError, FileDecodeError, redact_local_paths, thaw

router = APIRouter(prefix="/api", tags=["instruments"], responses=error_responses(404, 422, 503))
ROOT_PATTERN = r"^[A-Z0-9]{1,5}$"


def _reader(services: DataServices):
    """A JSON reader for results files under the data root; None for a missing or unreadable file."""
    def read(relative: str) -> Any:
        try:
            return thaw(services.files.read_json(services.settings.data_root / relative))
        except (FileNotFoundError, FileAccessError, FileDecodeError):
            return None
    return read


@router.get("/instruments/{root}", response_model=InstrumentDes)
def instrument(request: Request, root: str = PathParam(..., pattern=ROOT_PATTERN, max_length=5),
               services: DataServices = Depends(get_services)) -> InstrumentDes:
    """Contract, month codes, related dates, data coverage and notes for one root; no price is read."""
    catalog_roots = [sid.root for sid in services.catalog.listing().series]
    if root not in instruments.known_roots(catalog_roots):
        raise HTTPException(status_code=404, detail=f"unknown instrument root {root}")
    parsed, _ = read_log(request)
    found = instruments.describe(
        root, entries=services.catalog.entries(), files=services.files,
        results_dir=services.settings.results_dir, read_json=_reader(services),
        logged=parsed.count_reads(caller=CALLER, symbol=f"{root}.V.0"),
        this_process=gate_stats(request.app.state)[0],
        today_et=journals.today_et())
    return InstrumentDes.model_validate(redact_local_paths(found.model_dump(), services.settings.data_root))
