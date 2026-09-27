"""The instrument DES (the look spec, section 7.3: `3) Notes`, `4) Contracts (CT)`, related dates, data coverage).

Read only, and no price is read: every value comes from a frozen table or rule module in nq-lab, the processed
files' parquet footers (the catalog), the OOS log, or a results file.
- Contract: `nq_lab.dtsmom_universe.TABLE` (tick, tick value, USD per served unit, venue, units; fee `FEE`).
- Month codes: the twelve CME codes (`carry_expiry.MONTH_CODES`). A code is marked active only where nq-lab records
  the listing cycle (`CYCLES`: NQ from the paper book's MNQ roll module, the four Treasuries from the month-end
  Treasury book); elsewhere `active` is null, never guessed.
- Related dates: the last-trading-day rule (`carry_expiry.RULES`), the Treasury first notice rule
  (`carry_expiry.FND_RULE`), and for NQ and MNQ the paper book's contract and roll date as of today ET.
- Coverage: the root's processed series from the catalog, the in-sample window, and the gate reads (OOS log lines
  with caller terminal for this symbol, and this process's count).
- Notes: the fence; the session QA counts where the terminal has them (`services.sessions.SESSION_QA`); the
  futures repair provenance (`results/repair_provenance_futures_v2/index.json` first, then the v1 index); the
  reason a root was dropped from the universe (`dtsmom_universe.DROPPED`). Text from files is path-redacted.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import pandas as pd

from nq_lab import carry_expiry, eomtsy_book, mnq_roll
from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_universe import DROPPED, FEE, TABLE, Contract
from nq_terminal.constants import EXTRA_INSTRUMENTS
from nq_terminal.models.common import Fence
from nq_terminal.models.instruments import (
    ContractSpec,
    Coverage,
    CoverageSeries,
    InstrumentDes,
    InstrumentNote,
    MonthCode,
    NamedValue,
    RelatedDates,
)
from nq_terminal.services import journals
from nq_terminal.services.bars import CALLER, TS_CONVENTION
from nq_terminal.services.catalog import SeriesMeta
from nq_terminal.services.sessions import SESSION_QA, session_flags

MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
QUARTERS = "".join(mnq_roll.QUARTER_CODES[m] for m in sorted(mnq_roll.QUARTER_CODES))
CYCLES: Mapping[str, tuple[str, str]] = {
    "NQ": (QUARTERS, "nq_lab.mnq_roll.QUARTER_CODES (the micro contract on the same index)"),
    "MNQ": (QUARTERS, "nq_lab.mnq_roll.QUARTER_CODES"),
    **{root: (eomtsy_book.QUARTERLY, "nq_lab.eomtsy_book.QUARTERLY") for root in ("ZT", "ZF", "ZN", "ZB")},
}
PAPER_BOOK_ROOTS = ("NQ", "MNQ")
CONTRACT_SOURCE = "nq_lab.dtsmom_universe.TABLE (the frozen dtsmom spec's current CME specifications)"
PROVENANCE = (("v2", "results/repair_provenance_futures_v2/index.json"),
              ("v1", "results/repair_provenance_futures/index.json"))
HOURS_NOTE = ("trading hours are not recorded in nq-lab; only the times the terminal can source are shown")
LABEL = "instrument description from frozen tables, rule modules and results files; no price is read"


def known_roots(catalog_roots: Sequence[str]) -> set[str]:
    return {c.root for c in TABLE} | {root for root, _ in EXTRA_INSTRUMENTS} | set(catalog_roots)


def contract_spec(contract: Contract) -> ContractSpec:
    return ContractSpec(root=contract.root, symbol=f"{contract.root}.V.0", sector=contract.sector,
                        venue=contract.venue, units=contract.units, tick=float(contract.tick),
                        tick_usd=float(contract.tick_usd), point_value_usd=float(contract.mult),
                        cost_per_side_1tick_usd=float(contract.tick_usd) + FEE, source=CONTRACT_SOURCE)


def month_codes(root: str) -> tuple[list[MonthCode], str | None]:
    cycle, source = CYCLES.get(root, (None, None))
    return [MonthCode(month=i + 1, name=MONTH_NAMES[i], code=code, active=None if cycle is None else code in cycle)
            for i, code in enumerate(carry_expiry.MONTH_CODES)], source


def hours(root: str) -> list[NamedValue]:
    out = [NamedValue(label="Bar times", value=TS_CONVENTION, source="the processed series (catalog)")]
    if root in PAPER_BOOK_ROOTS:
        out += [NamedValue(label="Paper book decision", value=f"{journals.DECISION_ET} ET",
                           source="nq_lab.strategies.volmanaged_live"),
                NamedValue(label="Paper book orders", value=f"{journals.ORDER_ET} ET",
                           source="nq_lab.strategies.volmanaged_live")]
    return out


def related(root: str, today_et: Any) -> RelatedDates:
    fnd = carry_expiry.FND_RULE
    book = journals.next_times(today_et) if root in PAPER_BOOK_ROOTS else None
    return RelatedDates(
        last_trading_rule=carry_expiry.RULES.get(root),
        first_notice_rule=fnd["first_notice_day"] if root in fnd["roots"] else None,
        roll_rule=(f"{mnq_roll.ROLL_BUSINESS_DAYS} business days before expiry (the paper book's MNQ roll)"
                   if book else None),
        next_contract=book["contract"] if book else None, next_roll=book["roll_date"] if book else None,
        as_of_et=book["today_et"] if book else None,
        source="nq_lab.carry_expiry" + (" and nq_lab.mnq_roll" if book else ""))


def _iso(stamp: pd.Timestamp | None) -> str | None:
    return None if stamp is None else stamp.tz_convert("UTC").isoformat().replace("+00:00", "Z")


def coverage(root: str, entries: Sequence[SeriesMeta], logged: int, this_process: int) -> Coverage:
    mine = [e for e in entries if e.series_id.root == root]
    firsts = [e.first_ts for e in mine if e.first_ts is not None]
    start = max(IS_START, min(firsts).tz_convert("UTC")) if firsts else None
    return Coverage(fence=Fence(is_start=IS_START.date().isoformat(), is_end=IS_END.date().isoformat()),
                    in_sample_from=None if start is None else start.date().isoformat(),
                    in_sample_to=(IS_END - pd.Timedelta(days=1)).date().isoformat(),
                    series=[CoverageSeries(root=root, timeframe=e.series_id.timeframe, variant=e.series_id.variant,
                                           file=e.file, rows=e.rows, first_ts=_iso(e.first_ts),
                                           extends_past_fence=e.extends_past_fence, error=e.error) for e in mine],
                    gate_reads_logged=logged, gate_reads_this_process=this_process)


def logged_reads(entries: Sequence[Mapping[str, Any]], root: str) -> int:
    symbol = f"{root}.V.0"
    return sum(1 for e in entries if e.get("caller") == CALLER and e.get("symbol") == symbol)


def _session_note(files: Any, results_dir: Path, symbol: str) -> InstrumentNote | None:
    if symbol not in SESSION_QA:
        return None
    vendor = session_flags(files, results_dir, symbol, "vendor", IS_START, IS_END)
    fixed = session_flags(files, results_dir, symbol, "repaired", IS_START, IS_END)
    if not vendor["assessed"]:
        return None
    text = f"qa.day_gate rejects {len(vendor['gated']):,} in-sample sessions of the vendor 1m series."
    if fixed["assessed"]:
        text += (f" {len(fixed['repaired']):,} of them are rebuilt from trades in the repaired variant and "
                 f"{len(fixed['gated']):,} stay gated.")
    return InstrumentNote(title="Collapsed 1m days", text=text, source=fixed["source"] or vendor["source"] or "")


def _repair_note(read_json: Callable[[str], Any], root: str) -> InstrumentNote | None:
    for version, path in PROVENANCE:
        doc = read_json(path)
        entry = doc.get("symbols", {}).get(root) if isinstance(doc, Mapping) else None
        if not isinstance(entry, Mapping):
            continue
        counts = entry.get("counts") if isinstance(entry.get("counts"), Mapping) else {}
        state = str(entry.get("status", "unknown")).replace("_", " ")
        text = (f"{state}: {counts.get('rebuilt', 0):,} sessions rebuilt from trades, "
                f"{counts.get('candidate_not_repaired', 0):,} candidates kept as vendor bars, of "
                f"{counts.get('sessions', 0):,} sessions.")
        why = entry.get("why_not_repaired")
        return InstrumentNote(title=f"1m repair ({version})", text=text + (f" {why}" if why else ""), source=path)
    return None


def notes(root: str, files: Any, results_dir: Path, read_json: Callable[[str], Any]) -> list[InstrumentNote]:
    out = [InstrumentNote(title="Fence", text="Prices end at 2021-12-31: every read goes through the OOS gate as "
                                              "caller terminal, and 2022 onwards is refused.",
                          source="nq_lab.oos_gate")]
    for note in (_session_note(files, results_dir, f"{root}.V.0"), _repair_note(read_json, root)):
        if note is not None:
            out.append(note)
    out += [InstrumentNote(title="Not in the futures universe", text=str(d["reason"]),
                           source="nq_lab.dtsmom_universe.DROPPED") for d in DROPPED if d.get("root") == root]
    return out


def describe(root: str, *, entries: Sequence[SeriesMeta], files: Any, results_dir: Path,
             read_json: Callable[[str], Any], logged: int, this_process: int, today_et: Any) -> InstrumentDes:
    contract = next((c for c in TABLE if c.root == root), None)
    codes, cycle_source = month_codes(root)
    return InstrumentDes(root=root, symbol=f"{root}.V.0", in_universe=contract is not None,
                         contract=None if contract is None else contract_spec(contract), month_codes=codes,
                         cycle_source=cycle_source, hours=hours(root), hours_note=HOURS_NOTE,
                         related=related(root, today_et), coverage=coverage(root, entries, logged, this_process),
                         notes=notes(root, files, results_dir, read_json), label=LABEL)
