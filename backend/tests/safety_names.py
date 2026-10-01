"""The order-style call names of the IB client library, derived from the library itself.

`ib_must_override` is the set the read-only client has to override: every public `EClient` method whose name looks
like an order, a cancel or an exercise (the text call and its `ProtoBuf` twin alike), except the data and read
requests listed in `REVIEWED_READ_ONLY`. The list is a deny-by-default review list, not a ban list: a method a new
library version adds is in the set until someone reads it and either overrides it or adds it to the read list, so a
new library call shows up as a failing test instead of passing silently.

The read-only client tests and the IB AST test never write the banned names: the scan's own ban list
(`test_safety_ast.ORDER_NAMES`) must cover every name derived here, and the names used by the tests are the union.
"""
from __future__ import annotations

import re

from nq_terminal.services.ib_readonly_client import ReadOnlyClient
from test_safety_ast import ORDER_NAMES

ORDER_LIKE = re.compile(r"(?i)(order|cancel|exercise)")
PROTOBUF = "ProtoBuf"
# Reviewed as read-only (ibapi 10.45.1): each asks for data, ends a data subscription, or validates locally.
# The ProtoBuf twin of a name is covered by its stem, whose spelling the library varies (Fundamentals, Timestamp,
# Market, TickByTick).
REVIEWED_READ_ONLY = frozenset({
    "reqAllOpenOrders", "reqCompletedOrders", "validateOrderParameters", "validateAttachedOrdersParameters",
    "cancelAccountSummary", "cancelPositions", "cancelPositionsMulti", "cancelAccountUpdatesMulti",
    "cancelCalculateImpliedVolatility", "cancelCalculateOptionPrice", "cancelContractData",
    "cancelFundamentalData", "cancelFundamentalsData", "cancelHeadTimeStamp", "cancelHeadTimestamp",
    "cancelHistogramData", "cancelHistoricalData", "cancelHistoricalTicks", "cancelMktData", "cancelMarketData",
    "cancelMktDepth", "cancelMarketDepth", "cancelNewsBulletins", "cancelPnL", "cancelPnLSingle",
    "cancelRealTimeBars", "cancelScannerSubscription", "cancelTickByTickData", "cancelTickByTick",
    "cancelWshEventData", "cancelWshMetaData",
})


def ib_client_base() -> type:
    return next(cls for cls in ReadOnlyClient.__mro__ if cls.__name__ == "EClient")


def ib_must_override(base: type | None = None) -> list[str]:
    """Every public method of `base` (default: the library's `EClient`) that looks like an order path and is not
    on the reviewed read list."""
    base = base or ib_client_base()
    public = (name for name in dir(base) if not name.startswith("_") and callable(getattr(base, name, None)))
    return sorted(n for n in public if ORDER_LIKE.search(n) and n.removesuffix(PROTOBUF) not in REVIEWED_READ_ONLY)


def ib_order_names() -> list[str]:
    base = ib_client_base()
    return sorted(set(ib_must_override(base)) | {name for name in ORDER_NAMES if hasattr(base, name)})
