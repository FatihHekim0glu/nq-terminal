"""A grown lab for the cold HOME tests: many run folders laid out as the research writer lays them out.

`add_runs(output, count)` writes `count` run folders under `output` (`backtests/output` of a fixture copy), each with a
`result.json` made by `json.dumps(doc, indent=1, default=str, allow_nan=False)` (the writer in
`backtests/run_base.py`), half of them with CRLF line ends (`Path.write_text` on Windows), plus sidecars and run logs.
The rows cover every badge the run list shows: the three kinds (book, sized, intraday), probes by name and by
`data.lookahead_probe`, anchors with and without a `regress_check` sidecar and terminal re-runs (`t_<base>_regress_rN`),
unusable runs, MTM and coverage flags present, absent and of the wrong type, Decimal strings, nanosecond stamps and
integers wider than JavaScript's safe range. Words such as `"trades"` appear deeper in the tree to tempt a text search.

`add_edges(output)` adds the layouts the fast head reading must hand to the full decoder (compact, indent 2, a
duplicated key, a top level that is not an object, trailing bytes, a truncated file, an empty file, a byte-order mark)
and indent-1 files it must read itself although they are unusual (NaN in a large array or in the head, members after
the large arrays, a strategy log that is null, a list or empty). `EDGE_FALLBACKS` is how many of them a whole-document
decode may read.

Deterministic: the same arguments give the same bytes (a seeded generator; no clock).
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

NS_2015 = 1_420_070_400_000_000_000  # 2015-01-01T00:00:00Z in nanoseconds
STRATEGIES = ("za", "overnight", "volmanaged", "dtsmom", "fedflow", "stratégie")
EDGE_FALLBACKS = 8  # compact, indent2, dup_key, not_object, trailing, truncated, empty, bom


def _trade(rng: random.Random, i: int) -> dict[str, Any]:
    entry = NS_2015 + i * 86_400_000_000_000
    return {"entry_ts": entry, "exit_ts": entry + 3_600_000_000_000, "side": rng.choice(("BUY", "SELL")),
            "qty": rng.randint(1, 3), "pnl": round(rng.uniform(-900, 1200), 2), "pnl_usd": f"{rng.uniform(-9, 9):.2f}",
            "fees": "4.20", "net_r": round(rng.gauss(0.05, 1), 6), "note": "trades [x]: {\"y\": 1}"}


def _snapshot(rng: random.Random, i: int) -> dict[str, Any]:
    return {"ts": NS_2015 + i * 86_400_000_000_000, "date": f"2015-01-{(i % 28) + 1:02d}",
            "equity": round(100_000 + rng.uniform(-5000, 5000), 2), "balance": round(100_000 + rng.uniform(-50, 50), 2),
            "unrealized": round(rng.uniform(-500, 500), 2), "net_qty": rng.randint(-2, 2)}


def _strategy_log(rng: random.Random, kind: str) -> Any:
    if kind == "none":
        return None
    log: dict[str, Any] = {"decisions": [{"ts": NS_2015 + j, "why": "snapshots"} for j in range(rng.randint(20, 40))],
                           "notes": ["instruments", {"snapshots": 1}], "sessions_done": rng.randint(10, 400)}
    if kind == "book":
        log["instruments"] = ["ES", "NQ", "ZN"]
        log["snapshots"] = [_snapshot(rng, j) for j in range(rng.randint(30, 60))]
    elif kind == "sized":
        log["snapshots"] = [_snapshot(rng, j) for j in range(rng.randint(30, 60))]
        log["exits"] = [{"ts": NS_2015 + j, "reason": "stop"} for j in range(3)]
    else:
        log["closes"] = [{"ts": NS_2015 + j, "px": 100.25 + j} for j in range(rng.randint(30, 60))]
    return log


def _coverage(rng: random.Random) -> Any:
    return rng.choice(({"ok": True, "missing": []}, {"ok": False, "missing": ["2015-01-02"]}, "n/a", None))


def result_doc(run_id: str, rng: random.Random, *, probe_data: bool, kind: str, ok: bool) -> dict[str, Any]:
    """One result.json document in the writer's key order."""
    strategy = rng.choice(STRATEGIES)
    trades = [_trade(rng, j) for j in range(rng.randint(0, 1) * rng.randint(10, 30))]
    data: dict[str, Any] = {"variant": "vendor", "start": "2015-01-01 00:00:00+00:00", "sessions": rng.randint(5, 60),
                            "first_ns": NS_2015, "symbols": ["ES", "NQ"], "bars_fed": rng.randint(1000, 90000)}
    if probe_data:
        data["lookahead_probe"] = {"shift": 1}
    mtm = rng.choice(({"ok": True, "diff": 0.0}, {"ok": False, "diff": 12.5}, None, "skipped"))
    doc: dict[str, Any] = {
        "run_id": run_id,
        "config": {"strategy": strategy, "params": {"trades": rng.randint(1, 9), "k": rng.uniform(0, 2),
                                                    "seed": 2**60 + rng.randint(0, 9), "name": "a\n \"b\": c"},
                   "variant": rng.choice(("vendor", "panama")), "start": "2015-01-01", "end": "2016-01-01",
                   "run_id": run_id},
        "nautilus_trader": "1.231.0",
        "created_utc": f"2026-09-{rng.randint(10, 28):02d}T10:{rng.randint(10, 59)}:00.000001+00:00",
        "elapsed_s": round(rng.uniform(0.5, 90), 3),
        "data": data,
        "venue": {"starting_balance_usd": 100000, "oms": "NETTING", "fee": "2.10"},
        "n_trades": len(trades),
        "pnl_total": round(sum(t["pnl"] for t in trades), 2),
        "fees_total": round(4.2 * len(trades), 2),
        "summary": {"hit_rate": round(rng.random(), 4), "mean_net_r": rng.gauss(0, 1), "t_net_r": rng.gauss(0, 2),
                    "t_pnl_usd": f"{rng.uniform(-3, 3):.4f}", "worst": -2**55},
        "balance_check": {"ok": ok, "starting_usd": 100000.0, "final_usd": 100000.0 + rng.uniform(-9e3, 9e3),
                          "mtm": mtm},
    }
    if rng.random() < 0.8:
        doc["coverage_check"] = _coverage(rng)
    doc["strategy_skipped"] = [] if rng.random() < 0.5 else ["2015-03-02"]
    doc["trades"] = trades
    doc["fills"] = [{"ts": t["entry_ts"], "px": "100.25", "qty": t["qty"]} for t in trades]
    doc["strategy_log"] = _strategy_log(rng, kind)
    return doc


def writer_bytes(doc: Any, *, crlf: bool) -> bytes:
    """What `Path.write_text(json.dumps(doc, indent=1, default=str, allow_nan=False))` leaves on disk."""
    text = json.dumps(doc, indent=1, default=str, allow_nan=False)
    return (text.replace("\n", "\r\n") if crlf else text).encode("utf-8")


def _write_run(output: Path, run_id: str, raw: bytes, sidecars: dict[str, Any] | None = None, log: bool = False):
    folder = output / run_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "result.json").write_bytes(raw)
    for name, value in (sidecars or {}).items():
        (folder / f"{name}.json").write_text(json.dumps(value, indent=1), encoding="utf-8")
    if log:
        (output / f"{run_id}.log").write_text("run log\n", encoding="utf-8")


def run_ids(count: int) -> list[str]:
    """The ids `add_runs(output, count)` writes, in the order written."""
    ids = []
    for i in range(count):
        flavour = i % 10
        j = i - flavour  # flavour 0: a plain run, the base of the anchors written after it
        base = f"nt_grow_v{j % 7}_r{j:05d}"
        if flavour == 3:
            ids.append(f"nt_grow_v{i % 7}_r{i:05d}_probe_a")
        elif flavour == 6:
            ids.append(f"nt_gone_r{i:05d}_regress_r1" if i % 40 == 16 else f"{base}_regress_r{i % 4 + 1}")
        elif flavour == 8:
            ids.append(f"{base}_haltfix_r1")
        elif flavour == 9:
            ids.append(f"t_{base}_regress_r2")
        else:
            ids.append(f"nt_grow_v{i % 7}_r{i:05d}")
    return ids


def add_runs(output: Path, count: int, *, seed: int = 31) -> list[str]:
    """Write `count` run folders under `output`; returns their ids."""
    rng = random.Random(seed)
    ids = run_ids(count)
    for i, run_id in enumerate(ids):
        kind = ("book", "sized", "intraday", "none")[i % 4]
        doc = result_doc(run_id, rng, probe_data=i % 13 == 0, kind=kind, ok=i % 11 != 0)
        sidecars = {"compare_screen": {"rows": i}}
        if "_regress_" in run_id and i % 20 in (6, 9):
            base = run_id.split("_regress_")[0].removeprefix("t_")
            sidecars["regress_check"] = {"old": base, "identical": i % 3 == 0}
        _write_run(output, run_id, writer_bytes(doc, crlf=i % 2 == 0), sidecars, log=i % 5 == 0)
    return ids


def _indent1(doc: Any) -> bytes:
    return writer_bytes(doc, crlf=False)


def add_edges(output: Path, *, seed: int = 77) -> list[str]:
    """Write the unusual layouts (see the module docstring); returns their ids."""
    rng = random.Random(seed)

    def doc(run_id: str, kind: str = "sized") -> dict[str, Any]:
        return result_doc(run_id, rng, probe_data=False, kind=kind, ok=True)

    edges: dict[str, bytes] = {}
    edges["edge_compact"] = json.dumps(doc("edge_compact")).encode("utf-8")
    edges["edge_indent2"] = json.dumps(doc("edge_indent2", "book"), indent=2).encode("utf-8")
    dup = _indent1(doc("edge_dup_key"))
    edges["edge_dup_key"] = dup[:-2] + b',\n "summary": {"hit_rate": 0.99}\n}'
    edges["edge_not_object"] = _indent1([doc("edge_not_object")])
    edges["edge_trailing"] = _indent1(doc("edge_trailing")) + b"\n}"
    edges["edge_truncated"] = _indent1(doc("edge_truncated"))[:-40]
    edges["edge_empty"] = b""
    edges["edge_bom"] = b"\xef\xbb\xbf" + _indent1(doc("edge_bom"))
    nan_trades = doc("edge_nan_trades")
    nan_trades["trades"] = [{"pnl": float("nan"), "net_r": float("inf")}]
    edges["edge_nan_trades"] = json.dumps(nan_trades, indent=1, default=str).encode("utf-8")
    nan_head = doc("edge_nan_head", "book")
    nan_head["summary"]["t_net_r"] = float("nan")
    nan_head["pnl_total"] = float("-inf")
    edges["edge_nan_head"] = json.dumps(nan_head, indent=1, default=str).encode("utf-8")
    late = doc("edge_late_members", "intraday")
    late_doc = {k: v for k, v in late.items() if k not in ("summary", "balance_check", "n_trades")}
    late_doc.update(summary=late["summary"], balance_check=late["balance_check"], n_trades=late["n_trades"])
    edges["edge_late_members"] = _indent1(late_doc)
    for name, log in (("edge_log_null", None), ("edge_log_list", ["snapshots", "instruments"]), ("edge_log_empty", {})):
        d = doc(name)
        d["strategy_log"] = log
        edges[name] = _indent1(d)
    wide = doc("edge_wide_int")
    wide["data"]["huge"] = 2**70
    edges["edge_wide_int"] = _indent1(wide)
    no_large = doc("edge_no_large", "book")
    for key in ("trades", "fills", "strategy_log"):
        no_large.pop(key)
    edges["edge_no_large"] = _indent1(no_large)
    for run_id, raw in edges.items():
        _write_run(output, run_id, raw)
    return list(edges)
