"""Research files for the terminal (TASKS 2.2): registry, screens, specs, series, multiple testing, sealed.

Sources, all read-only through `FileCache` (confined to the data root; parquet refused):
- `results/registry.csv` is authoritative for n, p, the stored adjusted p values and the verdict. Rows and
  counts are read from the file on every request (PRD DL12); a truncated file is an error, not a short list.
- Each registry row joins its screen (`results/screens/<name>.json`, or the alias in
  `constants.SCREEN_ALIASES`) and its spec (`experiments/<spec>.json`). The spec is re-hashed (sha256) and
  must equal both the registry's `spec_sha256` and the screen's (RI1); a mismatch or a missing file shows
  as `spec_rehash_ok: false`, never as an exception.
- Hypothesis series (Basis A) come from the screen CSVs named in `constants.SERIES_SOURCES`; only the time
  column and the value columns for the asked cost are read, and a row on or after the fence is refused.
- Registry freshness (V031, `services/registry_freshness.py`): the modification time of `results/registry.md`
  against the newest of `results/screens/*.json` and `experiments/*.json` (drafts excluded); no file is opened for it.
- Sealed files (`results/sealed/`, 2022+): CSVs only through `constants.SEALED_CSV_ALLOWLIST`, JSON with
  every price-like key removed at any depth, the markdown as text; every view carries the spent label.
  Confirmations come from `results/oos_openings.json` and each opening's sealed result, outside the family.

Names from a request are checked against the index built from disk before any path is joined.
Nothing here reads prices, calls the gate or writes a file.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import threading
from pathlib import Path
from stat import S_ISDIR
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab import vt_har_stats
from nq_lab.config import IS_END
from nq_lab.sessions import nyse_sessions
from nq_terminal import des_shapes
from nq_terminal.constants import (
    CONFIRMS,
    MONTH_END_SESSION,
    PRICE_COLUMN,
    PRICE_KEY_LETTERS,
    PRICE_KEY_SUFFIXES,
    PRICE_KEY_WORDS,
    ROUNDS,
    SCREEN_ALIASES,
    SEALED_BY_PARENT,
    SEALED_CSV_ALLOWLIST,
    SERIES_SOURCES,
    SPENT_LABEL,
    SPENT_LABEL_UNDATED,
    SeriesSource,
)
from nq_terminal.models.research import (
    AmendmentAcceptances,
    BlockValue,
    Confirmation,
    DesExtract,
    HypothesisCard,
    HypothesisDetail,
    HypothesisSeries,
    LadderPoint,
    MultipleTesting,
    MultipleTestingRow,
    PassCheck,
    RegistryCounts,
    RegistryRow,
    RegistryView,
    SealedItem,
    SealedView,
    SpecCheck,
)
from nq_terminal.services import amendments, result_cache
from nq_terminal.services.files import (
    RETRY_DELAY_S,
    FileCache,
    FileDecodeError,
    file_cache,
    redact_local_paths,
    sanitise,
    thaw,
)
from nq_terminal.services.registry_freshness import registry_freshness

NAME_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
WORD_SPLIT = re.compile(r"[^a-z0-9]+")
REGISTRY_FIELDS = ("name", "registered", "n", "p", "control_p", "verdict", "family_k", "bonferroni_p", "holm_p",
                   "bh_q", "spec", "spec_sha256", "spec_sha_ok")
# Columns later registries carry (tag and amendments, round 13 on); read when present, else their defaults.
OPTIONAL_FIELDS = ("overlay", "amendments", "amendment_files", "amendments_ok")
AMENDMENT_SEPARATOR = ";"
VERDICT_TOKENS = ("PASS", "FAIL")
HISTORY_MARKS = (".first.", ".prev_")
FAMILY_ALPHA = 0.05
MT_TOLERANCE = 1e-12
SEALED_KINDS = {".json": "json", ".csv": "csv", ".md": "markdown"}


class UnknownNameError(LookupError):
    """The name is not in the index built from disk (or the cost is not recorded): a 404."""


class ResearchDataError(RuntimeError):
    """A research file is missing, unreadable or inconsistent."""


class RegistryMissing(ResearchDataError):
    """results/registry.csv does not exist under the data root (an empty registry, not a broken one)."""


class SealedAllowlistError(ResearchDataError):
    """A sealed allowlist names a column the file lacks, or a price column."""


# ---------------------------------------------------------------- pure helpers


def is_price_column(name: str) -> bool:
    """True for `px`, `raw` or `price` in any case, a name ending `_c`, or a bare `O`, `H`, `L` or `C`."""
    return PRICE_COLUMN.search(str(name)) is not None


def is_price_key(name: str) -> bool:
    """The sealed JSON rule (see `constants.PRICE_KEY_WORDS`): stricter than `is_price_column`."""
    text = str(name)
    if is_price_column(text) or text in PRICE_KEY_LETTERS or text.lower().endswith(PRICE_KEY_SUFFIXES):
        return True
    return any(word in PRICE_KEY_WORDS for word in WORD_SPLIT.split(text.lower()))


def strip_price_keys(value: Any) -> Any:
    """A copy with every mapping key that looks like a price (`is_price_key`) removed, at any depth."""
    if isinstance(value, Mapping):
        return {key: strip_price_keys(item) for key, item in value.items() if not is_price_key(str(key))}
    if isinstance(value, (list, tuple)):
        return [strip_price_keys(item) for item in value]
    return value


def select_sealed_columns(frame: pd.DataFrame, allowlist: Sequence[str], file_name: str) -> pd.DataFrame:
    """Exactly the allowlisted columns, in allowlist order; refuses price names and names the file lacks."""
    priced = [c for c in allowlist if is_price_column(c)]
    if priced:
        raise SealedAllowlistError(f"{file_name}: the allowlist names price columns: {', '.join(priced)}")
    missing = [c for c in allowlist if c not in frame.columns]
    if missing:
        raise SealedAllowlistError(f"{file_name}: the allowlist names columns the file does not have: "
                                   f"{', '.join(missing)}")
    return frame.loc[:, list(allowlist)].copy()


def verdict_parts(text: str) -> tuple[str, str | None]:
    """The badge (PASS, FAIL, or CHECK for a row without its own pass bar) and the rest as a note."""
    text = (text or "").strip()
    first, _, rest = text.partition(" ")
    first = first.rstrip(",;:")  # `PASS, not family-wise significant [...]` is still a PASS
    if first.upper() in VERDICT_TOKENS:
        note = rest.strip()
        if note[:1] in "[(" and note[-1:] in "])":
            note = note[1:-1].strip()
        return first.upper(), note or None
    return "CHECK", text or None


def bonferroni(ps: Sequence[float]) -> list[float]:
    k = len(ps)
    return [min(1.0, k * p) for p in ps]


def holm(ps: Sequence[float]) -> list[float]:
    """Holm step-down adjusted p values, in input order (as `nq_lab.registry.holm`)."""
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [math.nan] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def benjamini_hochberg(ps: Sequence[float]) -> list[float]:
    """Benjamini-Hochberg q values, in input order (as `nq_lab.registry.bh`)."""
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [math.nan] * len(ps), 1.0
    for rank in range(len(ps) - 1, -1, -1):
        i = order[rank]
        running = min(running, ps[i] * len(ps) / (rank + 1))
        out[i] = min(1.0, running)
    return out


def safe_name(name: str) -> bool:
    return isinstance(name, str) and NAME_RE.fullmatch(name) is not None and ".." not in name


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _blank_to_none(value: str | None) -> str | None:
    return None if value is None or value.strip() == "" else value


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def registry_tag(overlay: bool, registered: bool) -> str:
    """As `nq_lab.registry`: overlay, else check for a row outside the family, else edge."""
    return "overlay" if overlay else ("edge" if registered else "check")


def _optional(record: Mapping[str, str | None], present: set[str]) -> dict[str, Any]:
    """The tag and amendment columns of one record; defaults when the file has no such column."""
    out: dict[str, Any] = {}
    if "overlay" in present:
        out["overlay"] = (record.get("overlay") or "").strip() == "True"
    if "amendment_files" in present:
        text = record.get("amendment_files") or ""
        out["amendment_files"] = [f.strip() for f in text.split(AMENDMENT_SEPARATOR) if f.strip()]
    if "amendments" in present:
        out["amendments"] = _blank_to_none(record.get("amendments")) or 0
    if "amendments_ok" in present:
        out["amendments_ok"] = _blank_to_none(record.get("amendments_ok"))
    return out


def parse_registry(raw: bytes) -> tuple[RegistryRow, ...]:
    """Typed registry rows; ValueError (so FileCache retries once) on a missing column or a cut-off file."""
    text = raw.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    fields = set(reader.fieldnames or ())
    missing = set(REGISTRY_FIELDS) - fields
    if missing:
        raise ValueError(f"registry.csv lacks the columns {', '.join(sorted(missing))}")
    present = fields & set(OPTIONAL_FIELDS)
    rows = []
    for record in reader:
        if None in record or any(record.get(f) is None for f in (*REGISTRY_FIELDS, *present)):
            raise ValueError(f"registry.csv row {len(rows) + 1} is cut off")
        values = {f: _blank_to_none(record[f]) for f in REGISTRY_FIELDS} | _optional(record, present)
        row = RegistryRow.model_validate(values)
        rows.append(row.model_copy(update={"tag": registry_tag(row.overlay, row.registered)}))
    if not text.endswith("\n"):
        raise ValueError("registry.csv does not end with a newline (still being written)")
    return tuple(rows)


def _headline(name: str, screen: Mapping[str, Any] | None) -> dict[str, Any]:
    """Headline, unit and t from the frozen shape table (`des_shapes`); a screen without a shape falls back to its
    first plain headline number (never the `dsr` Sharpe difference) with no unit or t."""
    shape = des_shapes.SHAPES.get(name)
    if screen is None:
        return {"headline_label": None, "headline_value": None, "headline_display": None, "headline_unit": None,
                "t_stat": None, "t_label": None}
    if shape is None:
        label, value = des_shapes.fallback_headline(screen)
        return {"headline_label": label, "headline_value": value, "headline_display": label, "headline_unit": None,
                "t_stat": None, "t_label": None}
    return {"headline_label": shape.headline, "headline_value": des_shapes.resolve(screen, shape.headline),
            "headline_display": shape.display, "headline_unit": shape.unit,
            "t_stat": des_shapes.resolve(screen, shape.t) if shape.t else None, "t_label": shape.t_label}


def _des(name: str, screen: Mapping[str, Any] | None) -> DesExtract:
    shape = des_shapes.SHAPES.get(name)
    if screen is None or shape is None:
        return DesExtract(blocks=[], blocks_unit=None, cost_ladder=[], cost_ladder_unit=None,
                          break_even_ticks_per_side=None)
    return DesExtract(
        blocks=[BlockValue(label=label, value=value) for label, value in des_shapes.blocks(screen, shape)],
        blocks_unit=shape.blocks_unit,
        cost_ladder=[LadderPoint(ticks_per_side=k, value=v) for k, v in des_shapes.ladder(screen, shape)],
        cost_ladder_unit=shape.ladder_unit,
        break_even_ticks_per_side=des_shapes.resolve(screen, shape.break_even) if shape.break_even else None)


def _own_pass_checks(name: str, screen: Mapping[str, Any] | None) -> list[PassCheck]:
    """A row that is a check inside another hypothesis's screen (C3) has no pass bar of its own."""
    shape = des_shapes.SHAPES.get(name)
    if screen is None or (shape is not None and shape.block is not None):
        return []
    return _pass_checks(screen)


def _pass_checks(screen: Mapping[str, Any]) -> list[PassCheck]:
    checks = screen.get("pass_checks", screen.get("criteria"))
    if not isinstance(checks, Mapping):
        return []
    return [PassCheck(name=str(key), passed=value if isinstance(value, bool) else None,
                      value=None if isinstance(value, bool) else thaw(value)) for key, value in checks.items()]


def _month_end_sessions(source: SeriesSource, frame: pd.DataFrame) -> pd.Series:
    """Each `YYYY-MM` label dated at the last NYSE session of its month, never after the guard column."""
    try:
        labels = pd.PeriodIndex(frame[source.time_column].astype(str), freq="M")
    except (ValueError, TypeError) as exc:
        raise ResearchDataError(f"{source.file}: the {source.time_column} column is not a YYYY-MM label") from exc
    if not len(labels):
        return pd.Series([], dtype="datetime64[ns, UTC]")
    table = nyse_sessions(labels.min().start_time.date(), labels.max().end_time.date())
    days = pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in table.index]))
    last = pd.Series(days, index=days.to_period("M")).groupby(level=0).max()
    stamps = pd.Series(last.reindex(labels).to_numpy(), index=frame.index)
    if stamps.isna().any():
        raise ResearchDataError(f"{source.file}: a {source.time_column} month has no NYSE session")
    if source.guard_column:
        guard = pd.to_datetime(frame[source.guard_column], errors="coerce")
        if guard.isna().any() or (stamps > guard).any():
            raise ResearchDataError(f"{source.file}: a row would be dated after its {source.guard_column} column")
    return stamps.dt.tz_localize("UTC")


def series_stamps(source: SeriesSource, frame: pd.DataFrame) -> pd.Series:
    """The UTC time of each series row under the source's time rule (`constants.SeriesSource`)."""
    if source.time_rule == MONTH_END_SESSION:
        return _month_end_sessions(source, frame)
    try:
        return pd.to_datetime(frame[source.time_column], utc=True)
    except (ValueError, TypeError) as exc:
        raise ResearchDataError(f"{source.file}: the {source.time_column} column is not a date") from exc


def portfolio_columns(source: SeriesSource, frame: pd.DataFrame, value: str, bench: str | None) -> pd.DataFrame:
    """The source's portfolio (`constants.PortfolioRule`): the screen's own P2 construction over the member
    columns, `vt_har_stats.portfolio` divided by the portfolio's own winsorised sd, for the value and the benchmark
    suffix; a member with a missing value makes the whole series unusable (the screen's panel has none)."""
    header = list(frame.columns)
    out = frame.loc[:, [source.time_column, *(c for c in frame.columns if c in (source.guard_column,))]].copy()
    for suffix in (value, *([bench] if bench else [])):
        members = list(source.members(header, suffix))
        block = frame.loc[:, members].to_numpy(dtype=float)
        if not np.isfinite(block).all():
            raise ResearchDataError(f"{source.file}: a {suffix} member column holds an empty or non-finite value")
        combined = vt_har_stats.portfolio(block)
        out[suffix] = combined / float(vt_har_stats.scale(combined))
    return out


def _counts(rows: Sequence[RegistryRow]) -> RegistryCounts:
    badges = [verdict_parts(r.verdict)[0] for r in rows]
    edges = [r.tag == "edge" for r in rows]
    return RegistryCounts(rows=len(rows), registered=sum(r.registered for r in rows), passed=badges.count("PASS"),
                          failed=badges.count("FAIL"), checks=badges.count("CHECK"), edges=sum(edges),
                          overlays=sum(r.tag == "overlay" for r in rows),
                          passed_edges=sum(e and b == "PASS" for e, b in zip(edges, badges)))


# ---------------------------------------------------------------- the service


class _SummaryIndex:
    """The first lines of the round summaries in results/screens, read once and in memory (V032G).

    The rules are the old per-row scan's: files matching `*summary*.md` in sorted order, history copies skipped, a
    row belongs to the first file whose FIRST line contains its name, the round is the digits after `round` in the
    file name. Files are read lazily and only as far as a lookup reaches (so an undecodable file raises for a row
    that gets that far, as before), each at most once for the index's life: a `cards()` call shares one index
    among all its rows, where the scan opened the files again for every row."""

    def __init__(self, service: "ResearchService"):
        self._service = service
        self._paths: list[Path] | None = None
        self._lines: list[tuple[str, str]] = []

    def _read_next(self) -> bool:
        service = self._service
        if self._paths is None:
            result_cache.record_input(service.screens)  # the listing is pinned before it is read: a new file ends a cached body
            self._paths = sorted(p for p in service.screens.glob("*summary*.md")
                                 if not any(mark in p.name for mark in HISTORY_MARKS))
        if len(self._lines) == len(self._paths):
            return False
        path = self._paths[len(self._lines)]
        text = service._read(path, "text", path.name) or ""
        self._lines.append((path.name, text.partition("\n")[0]))
        return True

    def find(self, name: str) -> tuple[int | None, str | None]:
        position = 0
        while position < len(self._lines) or self._read_next():
            file_name, first_line = self._lines[position]
            position += 1
            if name in first_line:
                number = re.search(r"round(\d+)", file_name)
                return (int(number.group(1)) if number else None), file_name
        return None, None


class ResearchService:
    """Read-only research views over one data root (the project root, or the fixture folder)."""

    def __init__(self, root: Path, cache: FileCache | None = None, retry_delay_s: float = RETRY_DELAY_S):
        self.root = Path(root)
        self.results = self.root / "results"
        self.screens = self.results / "screens"
        self.sealed_dir = self.results / "sealed"
        self.experiments = self.root / "experiments"
        self.runs_dir = self.root / "backtests" / "output"
        self.cache = cache if cache is not None else file_cache(_file_cache_cap, roots=[self.root], retry_delay_s=retry_delay_s)

    # file access ------------------------------------------------------------

    def _read(self, path: Path, reader: str, what: str) -> Any:
        """A cached read; None when the file is missing; ResearchDataError when it cannot be decoded."""
        try:
            if reader == "json":
                return self.cache.read_json(path)
            if reader == "csv":
                return self.cache.read_csv(path)
            if reader == "text":
                return self.cache.read_text(path)
            return self.cache.get(path, _sha256, kind="sha256")
        except FileNotFoundError:
            return None
        except FileDecodeError as exc:
            raise ResearchDataError(f"{what} could not be read: {exc}") from exc

    def _inside(self, path: Path, folder: Path) -> bool:
        try:
            return path.resolve().is_relative_to(folder.resolve())
        except OSError:
            return False

    # registry ---------------------------------------------------------------

    def registry_rows(self) -> tuple[RegistryRow, ...]:
        path = self.results / "registry.csv"
        try:
            return self.cache.get(path, parse_registry, kind="registry")
        except FileNotFoundError as exc:
            raise RegistryMissing("results/registry.csv was not found under the data root") from exc
        except FileDecodeError as exc:
            raise ResearchDataError(f"results/registry.csv could not be read: {exc}") from exc

    def registry(self) -> RegistryView:
        rows = self.registry_rows()
        fresh = registry_freshness(self.root)
        return RegistryView(counts=_counts(rows), rows=list(rows), acceptances=self.acceptances(rows),
                            generated_at=fresh.generated_at, newest_input_at=fresh.newest_input_at,
                            newest_input_path=fresh.newest_input_path, stale=fresh.stale)

    def acceptances(self, rows: Sequence[RegistryRow]) -> AmendmentAcceptances:
        """The accepted amendments, each re-hashed now (`services.amendments`)."""
        text = self._read(self.results / "amendment_acceptances.md", "text", amendments.SOURCE)
        return amendments.acceptances(self.root, text, rows,
                                      hasher=lambda path: self._read(path, "sha256", path.name))

    def _row(self, name: str) -> RegistryRow:
        if not safe_name(name):
            raise UnknownNameError("unknown hypothesis")
        row = next((r for r in self.registry_rows() if r.name == name), None)
        if row is None:
            raise UnknownNameError(f"unknown hypothesis: {name}")
        return row

    # screens and specs ------------------------------------------------------

    def _screen(self, name: str) -> tuple[str | None, Mapping[str, Any] | None]:
        stem = SCREEN_ALIASES.get(name, name)
        if not safe_name(stem):
            return None, None
        doc = self._read(self.screens / f"{stem}.json", "json", f"screen {stem}")
        return (stem, doc) if isinstance(doc, Mapping) else (None, None)

    def screen(self, name: str) -> Mapping[str, Any] | None:
        """The screen JSON of a registered hypothesis (its alias where one is set), or None."""
        self._row(name)
        return self._screen(name)[1]

    def _spec_path(self, spec: str) -> Path | None:
        if not safe_name(spec):
            return None
        path = self.experiments / f"{spec}.json"
        return path if self._inside(path, self.experiments) else None

    def _spec_check(self, row: RegistryRow, screened: tuple[str | None, Mapping[str, Any] | None] | None = None
                    ) -> SpecCheck:
        stem, screen = self._screen(row.name) if screened is None else screened
        path = self._spec_path(row.spec)
        rehash = self._read(path, "sha256", f"spec {row.spec}") if path is not None else None
        screen_sha = screen.get("spec_sha256") if screen is not None else None
        problem = None
        if path is None:
            problem = f"the spec name {row.spec!r} is not a file name under experiments/"
        elif rehash is None:
            problem = f"spec experiments/{row.spec}.json is missing"
        elif screen is None:
            problem = f"screen for {row.name} is missing"
        elif not rehash == row.spec_sha256 == screen_sha:
            problem = "the spec no longer hashes to the recorded sha256"
        return SpecCheck(name=row.name, spec=row.spec, screen=stem, registry_sha256=row.spec_sha256,
                         screen_sha256=screen_sha if isinstance(screen_sha, str) else None,
                         rehash_sha256=rehash, ok=problem is None, problem=problem)

    def spec_checks(self) -> list[SpecCheck]:
        return [self._spec_check(row) for row in self.registry_rows()]

    # cards and detail -------------------------------------------------------

    def _has_result(self, folder: Path) -> bool:
        """Whether the run folder holds a result.json; the stat that answers is pinned for the result cache."""
        path = folder / "result.json"
        try:
            stat = path.stat()
        except OSError:
            result_cache.record_missing(path)
            return False
        if S_ISDIR(stat.st_mode):
            result_cache.record_input(path)
            return False
        result_cache.record_file(path, stat.st_mtime_ns, stat.st_size)
        return True

    def _run_names(self) -> tuple[str, ...]:
        """The run folders that hold a result.json. The folder listing and each result.json are pinned for the result
        cache (the listing first), so a new run folder or a new result.json ends a cached card list."""
        result_cache.record_input(self.runs_dir)
        try:
            folders = sorted(p for p in self.runs_dir.iterdir() if p.is_dir())
        except OSError:
            return ()
        return tuple(p.name for p in folders if self._has_result(p))

    def _card(self, row: RegistryRow, runs: Sequence[str], rounds: _SummaryIndex | None = None) -> HypothesisCard:
        screened = self._screen(row.name)
        check = self._spec_check(row, screened)
        screen = screened[1]
        badge, note = verdict_parts(row.verdict)
        source = SERIES_SOURCES.get(row.name)
        prefixes = (f"nt_{row.name}_", f"{row.name}_")
        return HypothesisCard(
            name=row.name, registered=row.registered, verdict=row.verdict, verdict_badge=badge, verdict_note=note,
            n=row.n, p=row.p, control_p=row.control_p, bonferroni_p=row.bonferroni_p, holm_p=row.holm_p,
            bh_q=row.bh_q, spec=row.spec, spec_sha256=row.spec_sha256, spec_sha_ok=row.spec_sha_ok,
            spec_rehash_ok=check.ok, tag=row.tag, amendment_files=list(row.amendment_files),
            amendments_ok=row.amendments_ok, screen=check.screen if screen is not None else None,
            round=self._round(row.name, rounds)[0], pass_checks=_own_pass_checks(row.name, screen),
            **_headline(row.name, screen), series_kind=source.kind if source else None,
            series_costs=sorted(source.values) if source else [],
            nautilus_runs=[r for r in runs if r.startswith(prefixes)],
            confirmations=sorted(c for c, parent in CONFIRMS.items() if parent == row.name),
            sealed=list(SEALED_BY_PARENT.get(row.name, ())))

    def cards(self) -> list[HypothesisCard]:
        runs = self._run_names()
        rounds = _SummaryIndex(self)
        return [self._card(row, runs, rounds) for row in self.registry_rows()]

    def card(self, name: str) -> HypothesisCard:
        return self._card(self._row(name), self._run_names())

    def _round(self, name: str, rounds: _SummaryIndex | None = None) -> tuple[int | None, str | None]:
        if name in ROUNDS:
            return ROUNDS[name]
        return (_SummaryIndex(self) if rounds is None else rounds).find(name)

    def _screen_files(self, stem: str) -> tuple[list[str], dict[str, Any]]:
        history, auxiliaries = [], {}
        for path in sorted(self.screens.glob(f"{stem}*")):
            if not path.is_file() or not path.name.startswith(stem):
                continue
            if any(mark in path.name for mark in HISTORY_MARKS):
                history.append(path.name)
            elif path.suffix == ".json" and path.name.startswith(f"{stem}_"):
                auxiliaries[path.stem] = thaw(self._read(path, "json", path.name))
        return history, auxiliaries

    def detail(self, name: str) -> HypothesisDetail:
        row = self._row(name)
        rounds = _SummaryIndex(self)
        card = self._card(row, self._run_names(), rounds)
        stem, screen = self._screen(name)
        spec_path = self._spec_path(row.spec)
        spec = self._read(spec_path, "json", f"spec {row.spec}") if spec_path is not None else None
        history, auxiliaries = self._screen_files(stem) if stem is not None else ([], {})
        summary_name = self._round(name, rounds)[1]
        summary = self._read(self.screens / summary_name, "text", summary_name) if summary_name else None
        local = self._local
        return HypothesisDetail(card=card, des=_des(name, screen), screen=local(thaw(screen)),
                                spec=local(thaw(spec)) if isinstance(spec, Mapping) else None,
                                auxiliaries=local(auxiliaries), history=history,
                                summary_name=summary_name if summary is not None else None, summary_md=local(summary))

    def _local(self, value: Any) -> Any:
        """No response names a local folder (the research JSON records absolute paths in prose and caches)."""
        return redact_local_paths(value, self.root)

    # series -----------------------------------------------------------------

    def _series_file(self, name: str, source: SeriesSource) -> pd.DataFrame:
        frame = self._read(self.screens / source.file, "csv", source.file)
        if frame is None:
            raise ResearchDataError(f"the series file {source.file} for {name} was not found")
        return frame

    def _series_frame(self, name: str, source: SeriesSource, cost: int) -> tuple[pd.DataFrame, str, str | None]:
        """The rows and columns one series reads at `cost`: (frame, value column, benchmark column or None). A
        portfolio source gets its value and benchmark computed into those two columns (`portfolio_columns`)."""
        raw = self._series_file(name, source)
        value, bench = source.values[cost], source.bench.get(cost)
        extra = [c for c in (source.guard_column, source.void_column) if c]
        wanted = [source.time_column, *extra, *source.columns(list(raw.columns), cost)]
        if source.portfolio is None:
            wanted = [source.time_column, value, *([bench] if bench else []), *extra]
        missing = [c for c in wanted if c not in raw.columns]
        if missing or (source.portfolio is not None and not source.members(list(raw.columns), value)):
            raise ResearchDataError(f"{source.file} lacks the columns {', '.join(missing) or value}")
        frame = raw.loc[:, wanted]
        if source.void_column:
            void = frame[source.void_column]
            if not pd.api.types.is_bool_dtype(void):
                raise ResearchDataError(f"{source.file}: the {source.void_column} column is not True or False")
            frame = frame.loc[~void]
        if source.portfolio is not None:
            frame = portfolio_columns(source, frame, value, bench)
        return frame, value, bench

    def series(self, name: str, cost: int) -> HypothesisSeries:
        self._row(name)
        source = SERIES_SOURCES.get(name)
        if source is None:
            raise UnknownNameError(f"no series is recorded for {name}")
        if cost not in source.values:
            raise UnknownNameError(f"{name} has no series at cost {cost}; recorded costs: "
                                   f"{', '.join(str(c) for c in sorted(source.values))}")
        frame, value, bench = self._series_frame(name, source, cost)
        frame = frame.assign(**{value: frame[value].fillna(0.0)}) if source.void_as_zero else frame.dropna(subset=[value])
        stamps = series_stamps(source, frame)
        if (stamps >= IS_END).any():
            raise ResearchDataError(f"{source.file} has rows on or after {IS_END.date().isoformat()}; in-sample "
                                    "series stop at the fence")
        order = np.argsort(stamps.to_numpy(), kind="stable")
        r = frame[value].to_numpy(dtype=float)[order]
        epoch = (stamps.astype("int64").to_numpy() // 10**9)[order]
        r_bench = sanitise(frame[bench].to_numpy(dtype=float)[order].tolist()) if bench else None
        return HypothesisSeries(name=name, cost=cost, unit=source.unit, kind=source.kind, source=source.file,
                                t=epoch.tolist(), r=r.tolist(), equity=np.cumsum(r).tolist(), r_bench=r_bench,
                                bench_label=source.bench_label if bench else None)

    # multiple testing -------------------------------------------------------

    def multiple_testing(self) -> MultipleTesting:
        rows = [r for r in self.registry_rows() if r.registered and r.p is not None]
        ps = [r.p for r in rows]
        k = len(rows)
        computed = list(zip(bonferroni(ps), holm(ps), benjamini_hochberg(ps)))
        order = sorted(range(k), key=lambda i: ps[i])
        out, diffs, complete = [], [], True
        for rank, i in enumerate(order, start=1):
            row, (b, h, q) = rows[i], computed[i]
            for stored, mine in ((row.bonferroni_p, b), (row.holm_p, h), (row.bh_q, q)):
                complete = complete and stored is not None
                diffs.append(abs(stored - mine) if stored is not None else 0.0)
            complete = complete and row.family_k == k
            out.append(MultipleTestingRow(
                name=row.name, tag=row.tag, rank=rank, p=row.p, bonferroni_p=row.bonferroni_p, holm_p=row.holm_p,
                bh_q=row.bh_q,
                computed_bonferroni=b, computed_holm=h, computed_bh=q, bonferroni_line=FAMILY_ALPHA / k,
                holm_line=FAMILY_ALPHA / (k - rank + 1), bh_line=rank * FAMILY_ALPHA / k))
        worst = max(diffs, default=0.0)
        return MultipleTesting(alpha=FAMILY_ALPHA, k=k, rows=out, max_abs_diff=worst,
                               matches_registry=complete and worst <= MT_TOLERANCE,
                               confirmations=self._confirmations_if_any())

    def _confirmations_if_any(self) -> list[Confirmation]:
        """The confirmations block of the multiple-testing view; empty when the root has no openings file."""
        if not (self.results / "oos_openings.json").is_file():
            return []
        return self.confirmations()

    # sealed window ----------------------------------------------------------

    def _openings(self) -> list[Mapping[str, Any]]:
        doc = self._read(self.results / "oos_openings.json", "json", "results/oos_openings.json")
        if not isinstance(doc, Mapping):
            raise ResearchDataError("results/oos_openings.json was not found under the data root")
        return [o for o in doc.get("openings", ()) if isinstance(o, Mapping)]

    def _label(self, entry: Mapping[str, Any] | None) -> str:
        stamp = str((entry or {}).get("decided_utc") or "")[:10]
        return SPENT_LABEL.format(date=stamp) if DATE_RE.fullmatch(stamp) else SPENT_LABEL_UNDATED

    def _confirmation(self, entry: Mapping[str, Any]) -> Confirmation | None:
        name = str(entry.get("caller", ""))
        doc = self._read(self.sealed_dir / f"{name}.json", "json", f"sealed {name}") if safe_name(name) else None
        if not isinstance(doc, Mapping):
            return None
        spec = str(entry.get("spec", ""))
        path = self.root / spec
        in_experiments = spec.endswith(".json") and self._inside(path, self.experiments)
        actual = self._read(path, "sha256", spec) if in_experiments else None
        own = self._read(path, "json", spec) if in_experiments else None
        own = own if isinstance(own, Mapping) else {}
        head = doc.get("headline") if isinstance(doc.get("headline"), Mapping) else {}
        n = head.get("n_valid")
        return Confirmation(
            name=name, n=n if isinstance(n, int) and not isinstance(n, bool) else None, p=_finite(head.get("p_one_sided")),
            alpha=_finite(head.get("alpha")), verdict=str(doc.get("verdict", "")), spec=spec,
            spec_sha256=doc.get("spec_sha256"),
            spec_sha_ok=actual is not None and actual == doc.get("spec_sha256") == entry.get("spec_sha256"),
            opening_closed=entry.get("closed") is True, label=self._label(entry), parent=CONFIRMS.get(name),
            pass_bar=self._local(thaw(own.get("pass_bar"))), hypothesis=self._local(thaw(own.get("hypothesis"))))

    def confirmations(self) -> list[Confirmation]:
        found = (self._confirmation(entry) for entry in self._openings())
        return [c for c in found if c is not None]

    def _sealed_files(self) -> dict[str, Path]:
        try:
            files = sorted(p for p in self.sealed_dir.iterdir() if p.is_file())
        except OSError:
            return {}
        index = {}
        for path in files:
            kind = SEALED_KINDS.get(path.suffix.lower())
            if kind is None or (kind == "csv" and path.name not in SEALED_CSV_ALLOWLIST):
                continue
            if safe_name(path.stem):
                index.setdefault(path.stem, path)
        return index

    def _sealed_label(self) -> str:
        try:
            openings = self._openings()
        except ResearchDataError:
            return SPENT_LABEL_UNDATED
        return self._label(openings[0] if openings else None)

    def sealed_index(self) -> list[SealedItem]:
        label = self._sealed_label()
        return [SealedItem(name=name, kind=SEALED_KINDS[path.suffix.lower()], label=label)
                for name, path in self._sealed_files().items()]

    def sealed(self, name: str) -> SealedView:
        path = self._sealed_files().get(name) if safe_name(name) else None
        if path is None:
            raise UnknownNameError(f"unknown sealed file: {name}" if safe_name(name) else "unknown sealed file")
        kind, label = SEALED_KINDS[path.suffix.lower()], self._sealed_label()
        if kind == "markdown":
            markdown = self._local(self._read(path, "text", path.name))
            return SealedView(name=name, kind=kind, label=label, markdown=markdown)
        if kind == "json":
            return SealedView(name=name, kind=kind, label=label,
                              data=self._local(strip_price_keys(thaw(self._read(path, "json", path.name)))))
        raw = self._read(path, "csv", path.name)
        if raw is None:
            raise ResearchDataError(f"sealed file {path.name} disappeared while being read")
        frame = select_sealed_columns(raw, SEALED_CSV_ALLOWLIST[path.name], path.name)
        values = {column: sanitise(frame[column].tolist()) for column in frame.columns}
        return SealedView(name=name, kind=kind, label=label, columns=list(frame.columns), values=values,
                          n_rows=len(frame))


_SERVICES: dict[Path, ResearchService] = {}
_SERVICES_LOCK = threading.Lock()
MAX_SERVICES = 8
_file_cache_cap: int | None = None  # settings.file_cache_bytes of the running app (128 MiB in desktop mode, 03 2.6)


def set_file_cache_cap(cap: int | None) -> None:
    """Apply the app's file-cache cap to the research services, which are shared per data root for the process (so
    they cannot take it from a request). `create_app` calls this; a changed cap drops the services built under the
    old one."""
    global _file_cache_cap
    with _SERVICES_LOCK:
        if cap != _file_cache_cap:
            _file_cache_cap = cap
            _SERVICES.clear()


def service_for_root(root: Path) -> ResearchService:
    """One service (and FileCache) per data root, shared by every router that reads research files, so
    /api/hypotheses, /api/audit/spec-hashes and /api/commands read the registry through one parser (RI1)."""
    key = Path(root)
    with _SERVICES_LOCK:
        service = _SERVICES.get(key)
        if service is None:
            if len(_SERVICES) >= MAX_SERVICES:
                _SERVICES.pop(next(iter(_SERVICES)))
            service = _SERVICES[key] = ResearchService(key)
        return service
