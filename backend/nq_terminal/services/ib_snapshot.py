"""The read-only IB snapshot behind `GET /api/ib/snapshot` (ARCHITECTURE s8 and s9; PRD U3, DL6 and DL15).

Opt-in: nothing happens unless `NQT_IB_READONLY` is exactly `1`. Then:

- host and port come from `IB_HOST` (default 127.0.0.1) and `IB_PORT` (default 7497, TWS paper) and pass
  `live_guards.check_ib_host` with the remote flag never on (the terminal is loopback only, and `IB_ALLOW_REMOTE` of
  the live scripts is not honoured here). The two live-trading ports (7496 TWS, 4001 Gateway) are refused outright:
  the terminal reads paper accounts only.
- every account TWS reports must pass `live_guards.check_account` (DU only) before the first request is sent
  (`ib_readonly_client.fetch_raw`); one live account refuses the whole read.
- the result is cached for `CACHE_SECONDS`, failures included, and one lock makes concurrent requests share a read,
  so a polling screen cannot hammer TWS or pile up connections.
- account ids are masked everywhere (`journals.mask_account`: `DU` plus one star per remaining character), also in
  every message and TWS error text.

States (`models.ib.IbSnapshot.state`): `ok`, `disabled`, `unavailable`, `refused`. Every one is an ordinary 200
answer, so a screen that polls shows an empty state rather than an error.

The IB library is imported only inside `take_snapshot`, so an app that never enables the snapshot never loads it.
"""
from __future__ import annotations

import datetime as dt
import os
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

from nq_lab.live_guards import LiveGuardError, check_account, check_ib_host
from nq_terminal.models.ib import (
    IbExecution,
    IbWorkingRow,
    IbPosition,
    IbSnapshot,
    IbState,
    IbSummaryRow,
)
from nq_terminal.services.journals import mask_account, mask_accounts

if TYPE_CHECKING:
    from nq_terminal.services.ib_readonly_client import RawSnapshot, Timeouts

ENV_FLAG = "NQT_IB_READONLY"
DEFAULT_HOST, DEFAULT_PORT = "127.0.0.1", 7497
LIVE_PORTS = frozenset({7496, 4001})  # TWS and Gateway live trading
MAX_PORT = 65535
CACHE_SECONDS = 5.0
CLIENT_ID = 95  # the same constant as `ib_readonly_client.CLIENT_ID`; a test pins them equal
MESSAGE_CHARS = 200
VALUE_CHARS = 80
OFF_MESSAGE = "The IB snapshot is off. Set NQT_IB_READONLY=1 and restart the terminal to read a paper account."
VIEW_ONLY = "View only: no order can be placed, changed or cancelled from the terminal."


class IbConfigError(ValueError):
    """The IB variables are set to something the terminal refuses (a remote host, a live port, a bad port)."""


@dataclass(frozen=True)
class IbConfig:
    host: str
    port: int
    timeouts: "Timeouts | None" = None  # None: the client module's defaults


def config_from_env(env: Mapping[str, str]) -> IbConfig | None:
    """None when the snapshot is off; an `IbConfig` when on; `IbConfigError` when on with a refused setting."""
    if env.get(ENV_FLAG) != "1":
        return None
    host = env.get("IB_HOST") or DEFAULT_HOST
    try:
        check_ib_host(host, allow_remote=False)
    except LiveGuardError as exc:
        raise IbConfigError(f"IB_HOST is refused: {exc}") from None
    raw = (env.get("IB_PORT") or "").strip() or str(DEFAULT_PORT)
    if not raw.isdigit() or not 0 < int(raw) <= MAX_PORT:
        raise IbConfigError(f"IB_PORT must be a whole number from 1 to {MAX_PORT}, got {raw!r}")
    port = int(raw)
    if port in LIVE_PORTS:
        raise IbConfigError(f"port {port} is a live-trading port; the terminal reads paper accounts only "
                            "(TWS paper 7497, Gateway paper 4002)")
    return IbConfig(host=host, port=port)


def mask_text(text: str, known: Sequence[str] = ()) -> str:
    """`text` with every account-like id and every `known` id masked, cut to a short length."""
    return mask_accounts(str(text), known)[:MESSAGE_CHARS]


def _iso(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _number(text: str) -> float | None:
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value == value and abs(value) != float("inf") else None


def _paper_only(accounts: Sequence[str]) -> None:
    """The guard handed to the client: every reported account must be a paper one, or the read ends."""
    for account in accounts:
        try:
            check_account(account, allow_live=False)
        except LiveGuardError:
            raise LiveGuardError(f"account {mask_account(account)} is not a paper account (DU...): "
                                 "the terminal reads paper accounts only") from None


def _blank(state: IbState, message: str, now: dt.datetime | None) -> IbSnapshot:
    return IbSnapshot(
        state=state, message=message, read_only=True, order_path="none", client_id=CLIENT_ID, accounts_masked=[],
        server_time_utc=None, fetched_at_utc=None if now is None else _iso(now), cached=False, age_s=0.0,
        cache_seconds=CACHE_SECONDS, incomplete=[], truncated=False, notes=[], summary=[], positions=[],
        open_orders=[], executions=[])


def _masked(account: Any) -> str:
    return mask_account(str(account)) or ""


def _rows(raw: "RawSnapshot") -> dict[str, list]:
    summary = [IbSummaryRow(account_masked=_masked(r["account"]), tag=r["tag"], value=r["value"][:VALUE_CHARS],
                            number=_number(r["value"]), currency=r["currency"]) for r in raw.summary]
    positions = [IbPosition(
        account_masked=_masked(r["account"]), symbol=r["symbol"], local_symbol=r["local_symbol"],
        sec_type=r["sec_type"], exchange=r["exchange"], currency=r["currency"], expiry=r["expiry"],
        quantity=r["quantity"] if r["quantity"] is not None else 0.0, average_cost=r["average_cost"])
        for r in raw.positions]
    orders = [IbWorkingRow(
        order_id=r["order_id"], perm_id=r["perm_id"], client_id=r["client_id"], account_masked=_masked(r["account"]),
        symbol=r["symbol"], local_symbol=r["local_symbol"], sec_type=r["sec_type"], action=r["action"],
        order_type=r["order_type"], quantity=r["quantity"], limit_price=r["limit_price"],
        stop_price=r["stop_price"], tif=r["tif"], status=r["status"], filled=r["filled"], remaining=r["remaining"])
        for r in raw.open_orders]
    fills = [IbExecution(
        exec_id=r["exec_id"], time=r["time"], account_masked=_masked(r["account"]), symbol=r["symbol"],
        local_symbol=r["local_symbol"], sec_type=r["sec_type"], exchange=r["exchange"], side=r["side"],
        shares=r["shares"], price=r["price"], cumulative_quantity=r["cumulative_quantity"],
        average_price=r["average_price"], order_id=r["order_id"], perm_id=r["perm_id"], client_id=r["client_id"])
        for r in raw.executions]
    return {"summary": summary, "positions": positions, "open_orders": orders, "executions": fills}


def _from_raw(raw: "RawSnapshot", now: dt.datetime) -> IbSnapshot:
    server_time = None
    if raw.server_time_epoch_s is not None:
        server_time = _iso(dt.datetime.fromtimestamp(raw.server_time_epoch_s, tz=dt.timezone.utc))
    said = f"Read from a paper account at {now.strftime('%H:%M:%S')} UTC. {VIEW_ONLY}"
    if raw.incomplete:
        said += " No reply in time for: " + ", ".join(raw.incomplete) + "."
    return IbSnapshot(
        state="ok", message=said, read_only=True, order_path="none", client_id=CLIENT_ID,
        accounts_masked=[_masked(a) for a in raw.accounts], server_time_utc=server_time, fetched_at_utc=_iso(now),
        cached=False, age_s=0.0, cache_seconds=CACHE_SECONDS, incomplete=list(raw.incomplete),
        truncated=raw.truncated, notes=[mask_text(n, raw.accounts) for n in raw.notes], **_rows(raw))


def take_snapshot(config: IbConfig, now: Callable[[], dt.datetime] = _utc_now) -> IbSnapshot:
    """One uncached read. Guard refusals and an absent TWS become states; anything else propagates to the caller."""
    from nq_terminal.services.ib_readonly_client import IbUnavailable, Timeouts, fetch_raw

    try:
        raw = fetch_raw(config.host, config.port, timeouts=config.timeouts or Timeouts(), check_accounts=_paper_only)
    except LiveGuardError as exc:
        return _blank("refused", mask_text(str(exc)), now())
    except IbUnavailable as exc:
        return _blank("unavailable", mask_text(str(exc)), now())
    return _from_raw(raw, now())


class IbSnapshotService:
    """Holds the config, the cache and the lock; `snapshot()` is what the route calls."""

    def __init__(self, config: IbConfig | None, *, problem: str | None = None,
                 clock: Callable[[], float] = time.monotonic, taker: Callable[[IbConfig], IbSnapshot] = take_snapshot):
        self._config, self._problem, self._clock, self._taker = config, problem, clock, taker
        self._lock = threading.Lock()
        self._cached: IbSnapshot | None = None
        self._cached_at = 0.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, **kwargs: Any) -> "IbSnapshotService":
        env = os.environ if env is None else env
        try:
            return cls(config_from_env(env), **kwargs)
        except IbConfigError as exc:
            return cls(None, problem=str(exc), **kwargs)

    def snapshot(self) -> IbSnapshot:
        if self._config is None:
            if self._problem is not None:
                return _blank("refused", mask_text(self._problem), None)
            return _blank("disabled", OFF_MESSAGE, None)
        with self._lock:
            now = self._clock()
            if self._cached is not None and now - self._cached_at < CACHE_SECONDS:
                return self._cached.model_copy(update={"cached": True, "age_s": round(now - self._cached_at, 3)})
            self._cached = self._read(self._config)
            self._cached_at = self._clock()
            return self._cached

    def _read(self, config: IbConfig) -> IbSnapshot:
        from nq_terminal.services.ib_readonly_client import OrderPathError

        try:
            return self._taker(config)
        except OrderPathError:
            raise  # a bug in the read-only client, never a state to show
        except Exception as exc:  # TWS and the socket do odd things; the screen gets a state, the log gets the type
            return _blank("unavailable", mask_text(f"The read failed unexpectedly ({type(exc).__name__}: {exc})"),
                          _utc_now())
