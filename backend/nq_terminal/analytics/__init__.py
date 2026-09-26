"""Pure analytics functions over numpy and pandas arrays (ANALYTICS_CATALOG.md; TASKS Phase 3).

One module per family (series, perf, drawdown, rolling, distribution, risk, relative, validity, trades, exposure).
No module here reads files or holds state: callers pass session-indexed series and plain rows in. The bridges to
the injected services are `series`, which builds the session series from the research, runs and bar services, and
`services/run_books.py`, which reads a run's trades, fills and snapshots (`load_book`) and a book's raw closes
through the gate (`gated_raw_prices`) for `trades` and `exposure`. Prices only ever come through the gate, caller
"terminal".
"""
