"""ROLL endpoints (GET only; TASKS Phase 11): /api/market/rolls (the roll calendar, ANALYTICS MV10, gaps as MV2) and
/api/market/paper-rolls (the MNQ paper book's roll schedule, dates only).

Prices come only through the data services of `api/data.py` (`get_services`, `daily_frames`): the gated, cached
1d frames with caller `terminal`, to 2021-12-31, so the calendar costs no extra serve once MON or CORR has run. In
fixture mode without an injected serve there is no price source and /rolls answers 503. The universe QA report is
read through the results FileCache (confined to the results folder); a missing or unreadable report leaves the QA
fields null. /paper-rolls reads no file and no price: it is `nq_lab.mnq_roll` arithmetic on today's New York date.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from nq_lab.dtsmom_universe import TABLE
from nq_terminal.api.data import DataServices, NO_PRICE_SOURCE, daily_frames, gate_info, get_services
from nq_terminal.models.common import error_responses
from nq_terminal.models.roll import MarketRolls, PaperRoll, PaperRollSchedule, RollCalendar, RollEvent
from nq_terminal.services import journals
from nq_terminal.services.bars import BarService, GateRefusal
from nq_terminal.services.files import FileAccessError, FileDecodeError, thaw
from nq_terminal.services.roll import (
    BASIS,
    LABEL,
    MAX_AHEAD,
    MAX_BEHIND,
    PAPER_LABEL,
    PAPER_RULE,
    PAPER_SOURCE,
    QA_REPORT,
    QA_SOURCE,
    UNIT_NOTE,
    MarketRolls as MarketRollsResult,
    paper_schedule,
    qa_counts,
    roll_calendar,
)

router = APIRouter(prefix="/api/market", tags=["data"], responses=error_responses(403, 422, 503))


def _bars(services: DataServices) -> BarService:
    if services.bars is None:
        raise HTTPException(status_code=503, detail=NO_PRICE_SOURCE)
    return services.bars


def read_qa_report(services: DataServices) -> Any | None:
    """The universe QA report, or None when it is absent, outside the results folder or not valid JSON."""
    try:
        return thaw(services.files.read_json(services.settings.results_dir / QA_REPORT))
    except (FileNotFoundError, FileAccessError, FileDecodeError):
        return None


def market_model(market: MarketRollsResult, report: Any | None) -> MarketRolls:
    total, _ = qa_counts(report, market.root)
    rolls = [RollEvent(date=e.date, t=e.t, last_date=e.last_date, from_id=e.from_id, to_id=e.to_id,
                       close_before=e.close_before, gap_pts=e.gap_pts, gap_pct=e.gap_pct) for e in market.rolls]
    return MarketRolls(symbol=market.symbol, root=market.root, sector=market.sector, units=market.units,
                       tick=market.tick, first_date=market.first_date, last_date=market.last_date, rolls=rolls,
                       per_year=dict(market.per_year), count=len(rolls), mean_abs_gap_pct=market.mean_abs_gap_pct,
                       max_abs_gap_pct=market.max_abs_gap_pct, qa_rolls_total=total,
                       qa_match=None if total is None else total == len(rolls))


@router.get("/rolls", response_model=RollCalendar)
def market_rolls(services: DataServices = Depends(get_services)) -> RollCalendar:
    """Every in-sample roll of the 27 futures (instrument_id changes in the served 1d files) with its gap in points
    and percent, the month axis for the calendar strip, and the universe QA report's roll counts beside ours."""
    service = _bars(services)
    try:
        frames, years, cached = daily_frames(service, services.catalog)
    except GateRefusal as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = roll_calendar(frames, TABLE)
    report = read_qa_report(services)
    return RollCalendar(as_of=result.as_of, label=LABEL, basis=BASIS, unit_note=UNIT_NOTE,
                        months=list(result.months), markets=[market_model(m, report) for m in result.markets],
                        missing=list(result.missing), qa_source=QA_SOURCE, gate=gate_info(service, years, cached))


@router.get("/paper-rolls", response_model=PaperRollSchedule)
def market_paper_rolls(
    behind: int = Query(2, ge=0, le=MAX_BEHIND, description="contracts before the held one"),
    ahead: int = Query(8, ge=1, le=MAX_AHEAD, description="contracts after the held one"),
) -> PaperRollSchedule:
    """The MNQ paper book's roll schedule from `nq_lab.mnq_roll`: dates only, no price and no file is read."""
    schedule = paper_schedule(journals.today_et(), behind=behind, ahead=ahead)
    rows = [PaperRoll(contract=r.contract, expiry=r.expiry, roll_date=r.roll_date, into=r.into, status=r.status)
            for r in schedule.rows]
    return PaperRollSchedule(label=PAPER_LABEL, rule=PAPER_RULE, source=PAPER_SOURCE, today_et=schedule.today_et,
                             held=schedule.held, next_roll=schedule.next_roll, roll_today=schedule.roll_today,
                             rows=rows)
