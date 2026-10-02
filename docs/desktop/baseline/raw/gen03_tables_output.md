<!-- generated: routes -->

Rows: 77 from the inventory route table, 1 found only in the working-tree contract, 7 new. Inventory routes cached in stage 1.2: 8.

| # | Method | Path | Handler | Size | Cost | Cold / warm ms | Desktop form | Stage |
|---:|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/openapi.json` | `fastapi.openapi` | L | heavy | 917 / 6 | unchanged; read by the contract drift test only, never by the page | none |
| 2 | GET | `/api/health` | `system.health` | XS | light | 28 / 34 | unchanged, polled every 2 s; reports the contract version beside today's fields so the page can compare it with bridgeVersion | 1.3 |
| 3 | GET | `/api/audit/oos-log` | `audit.oos_log` | L | medium | 160 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 4 | GET | `/api/audit/openings` | `audit.openings` | XS | light | 39 / 34 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 5 | GET | `/api/audit/spec-hashes` | `audit.spec_hashes` | S | light | 19 / 14 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 6 | GET | `/api/live/status` | `live.status` | XS | light | 4 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 7 | GET | `/api/live/journal` | `live.journal` | XS | light | 3 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 8 | GET | `/api/live/log` | `live.log` | M | light | 7 / 104 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 9 | GET | `/api/live/performance` | `live.performance` | XS | light | 3 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 10 | GET | `/api/live/routes` | `live.routes` | XS | light | 4 / 2 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 11 | GET | `/api/commands` | `commands.commands` | S | light | 12 / 11 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 12 | GET | `/api/registry` | `research.registry` | S | light | 5 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 13 | GET | `/api/hypotheses` | `research.hypotheses` | M | light | 40 / 37 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 14 | GET | `/api/hypotheses/{name}` | `research.hypothesis` | S | light | 14 / 13 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 15 | GET | `/api/hypotheses/{name}/series` | `research.hypothesis_series` | M | light | 17 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 16 | GET | `/api/multiple-testing` | `research.multiple_testing` | S | light | 7 / 5 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 17 | GET | `/api/confirmations` | `research.confirmations` | XS | light | 5 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 18 | GET | `/api/sealed` | `research.sealed_index` | XS | light | 5 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 19 | GET | `/api/sealed/{name}` | `research.sealed` | XS | light | 6 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 20 | GET | `/api/runs` | `runs.list_runs` | M | light | 50 / 33 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 21 | GET | `/api/runs/compare` | `runs.compare_runs` | M | heavy | 1145 / 280 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 22 | GET | `/api/runs/stats` | `runs.run_stats` | XS | medium | 260 / 240 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 23 | GET | `/api/runs/{run_id}` | `runs.run_detail` | S | light | 8 / 6 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 24 | GET | `/api/runs/{run_id}/trades` | `runs.run_trades` | M | medium | 217 / 18 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 25 | GET | `/api/runs/{run_id}/fills` | `runs.run_fills` | M | heavy | 535 / 12 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 26 | GET | `/api/runs/{run_id}/log/{section}` | `runs.run_log` | L | light | 29 / 27 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 27 | GET | `/api/runs/{run_id}/equity` | `runs.run_equity` | L | medium | 60 / 56 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 28 | GET | `/api/runs/{run_id}/sidecar/{name}` | `runs.run_sidecar` | S | light | 8 / 6 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 29 | GET | `/api/ledger` | `runs.ledger` | S | very heavy | 4312 / 671 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 30 | GET | `/api/bars` | `data.get_bars` | M | medium | 34 / 9; 55 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 31 | GET | `/api/data/catalog` | `data.data_catalog` | M | light | 49 / 12 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 32 | GET | `/api/market/universe` | `data.market_universe` | M | medium | 436 / 16 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 33 | GET | `/api/market/pair-corr` | `data.market_pair_corr` | M | light | 34 / 31 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 34 | GET | `/api/qa` | `data.qa_index` | XS | light | 9 / 7 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 35 | GET | `/api/qa/{name}` | `data.qa_report` | S | light | 12 / 10 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 36 | GET | `/api/market/rv` | `data.market_rv` | M | light | 20 / 21 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 37 | GET | `/api/market/two-day` | `data.market_two_day` | M | heavy | 1260 / 891 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 38 | GET | `/api/analytics/hypothesis/{name}` | `analytics.hypothesis_analytics` | L | medium | 390 / 178 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 39 | GET | `/api/analytics/hypothesis/{name}/panel` | `analytics.hypothesis_panel` | L | medium | 113 / 111 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 40 | GET | `/api/analytics/run/{run_id}` | `analytics.run_analytics` | L | medium | 180 / 130 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 41 | GET | `/api/analytics/run/{run_id}/panel` | `analytics.run_panel` | M | medium | 80 / 79 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 42 | GET | `/api/analytics/run/{run_id}/trades` | `analytics.run_trades` | S | medium | 258 / 86 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 43 | GET | `/api/analytics/run/{run_id}/costs` | `analytics.run_costs` | S | medium | 298 / 314 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 44 | GET | `/api/analytics/run/{run_id}/exposure` | `analytics.run_exposure` | XL | heavy | 667 / 718 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 45 | GET | `/api/analytics/hypothesis/{name}/extended` | `analytics.hypothesis_extended` | L | medium | 279 / 270 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 46 | GET | `/api/analytics/run/{run_id}/extended` | `analytics.run_extended` | M | medium | 258 / 272 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 47 | GET | `/api/analytics/hypothesis/{name}/bootstrap` | `analytics.hypothesis_bootstrap` | M | heavy | 1408 / 1450 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 48 | GET | `/api/analytics/run/{run_id}/bootstrap` | `analytics.run_bootstrap` | M | heavy | 1405 / 1410 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 49 | GET | `/api/analytics/deflated` | `analytics.deflated_sharpe` | S | heavy | 1062 / 459 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 50 | GET | `/api/analytics/run/{run_id}/trade-paths` | `analytics.run_trade_paths` | XS | medium | 111 / 102 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 51 | GET | `/api/analytics/run/{run_id}/excursions` | `analytics.run_excursions` | XS | light | 6 / 5 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 52 | GET | `/api/analytics/paper-tracking` | `analytics.paper_tracking` | XS | light | 4 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 53 | GET | `/api/instruments/{root}` | `instruments.instrument` | S | light | 17 / 12 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 54 | GET | `/api/live/stream` | `live_stream.stream` | stream | - | - | same-origin SSE, cookie checked by the token middleware (EventSource sends same-origin cookies); app smoke asserts stream mode, not polling; minimise-and-restore case | 1.4, 2.4 |
| 55 | GET | `/api/market/vcone` | `vcone.market_vcone` | S | medium | 228 / 22 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 56 | GET | `/api/market/vcone/universe` | `vcone.market_vcone_universe` | S | medium | 308 / 320 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 57 | GET | `/api/seasonality/instrument/{root}` | `seasonality.instrument_seasonality` | S | very heavy | 2268 / 2066 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 58 | GET | `/api/seasonality/hypothesis/{name}` | `seasonality.hypothesis_seasonality` | S | medium | 249 / 48 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 59 | GET | `/api/events/calendar` | `events.event_calendar` | M | light | 21 / 14 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 60 | GET | `/api/events/study` | `events.event_study` | M | medium | 197 / 22 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 61 | GET | `/api/market/rolls` | `roll.market_rolls` | L | medium | 272 / 265 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 62 | GET | `/api/market/paper-rolls` | `roll.market_paper_rolls` | XS | light | 4 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 63 | GET | `/api/dq/symbols` | `dq.symbols` | S | medium | 364 / 394 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 64 | GET | `/api/dq/calendar/{symbol}` | `dq.calendar` | M | light | 13 / 13 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 65 | GET | `/api/dq/guards` | `dq.guard_status` | S | light | 41 / 223 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 66 | GET | `/api/analytics/spa` | `spa.family_spa` | S | very heavy | 3575 / 307 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 67 | GET | `/api/analytics/hypothesis/{name}/risk-extras` | `risk_extras.hypothesis_risk_extras` | S | medium | 225 / 50 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 68 | GET | `/api/analytics/run/{run_id}/risk-extras` | `risk_extras.run_risk_extras` | S | medium | 87 / 55 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 69 | GET | `/api/analytics/hypothesis/{name}/trend-regime` | `regimes_capacity_term.hypothesis_trend_regime` | M | medium | 76 / 79 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 70 | GET | `/api/analytics/run/{run_id}/trend-regime` | `regimes_capacity_term.run_trend_regime` | M | medium | 96 / 91 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 71 | GET | `/api/analytics/run/{run_id}/capacity` | `regimes_capacity_term.run_capacity` | S | heavy | 647 / 618 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 72 | GET | `/api/market/term-structure/{root}` | `regimes_capacity_term.market_term_structure` | L | heavy | 546 / 316 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 73 | GET | `/api/ib/snapshot` | `ib.ib_snapshot` | XS | light | 4 / 2 | unchanged, opt-in (NQT_IB_READONLY=1); one backend per lab, so one client id 95 | 1.3 |
| 74 | GET | `/api/jobs` | `jobs.list_jobs` | XS | light | 2 / 2 | unchanged read; loads nautilus_trader lazily as today | 1.4 |
| 75 | POST | `/api/jobs` | `jobs.queue_job` | - | - | - | unchanged write (one of three); refused unless sys.prefix is ROOT/.venv and, in desktop mode, NQT_FIXTURE_DIR is unset; child gets the allow-listed environment | 1.3, 1.5 |
| 76 | GET | `/api/jobs/{job_id}` | `jobs.read_job` | XS | light | 3 / 3 | unchanged read; loads nautilus_trader lazily as today | 1.4 |
| 77 | DELETE | `/api/jobs/{job_id}` | `jobs.remove_job` | - | - | - | unchanged write (one of three); refused unless sys.prefix is ROOT/.venv and, in desktop mode, NQT_FIXTURE_DIR is unset; child gets the allow-listed environment | 1.3, 1.5 |
| 78 | GET | `/api/analytics/paper-expectation` | working tree only (uncommitted) | not measured | not measured | not measured | unchanged GET once committed; measured at the start of stage 1 | 1.4 |
| new | GET | `/api/desktop/proof` | new (stage 1.3) | XS | light | not built | header `Authorization: NQT <token>` and a nonce; answers the HMAC of token, nonce, port and pid, plus ROOT, sys.prefix and the contract version; re-run by the shell on every top-level navigation | 1.3 |
| new | GET | `/api/session` | new (stage 1.4) | XS | light | not built | token header plus the caller's origin; returns a session value bound to that one origin and sets the HttpOnly, SameSite=Strict cookie on Path=/api; used by the shells, which then set the cookie in the webview | 1.4 |
| new | GET | `/api/session/code` | new (stage 1.4) | XS | light | not built | token header; mints a single-use launch code that lives 60 s; used by start.ps1 and the Mac launcher | 1.4 |
| new | GET | `/api/session/redeem` | new (stage 1.4) | XS | light | not built | code in a header, sent by the static `session.html` page that read it from the URL fragment; sets the cookie bound to the browser's origin; the code dies on first use | 1.4 |
| new | GET | `/api/workspaces` | new (stage 1.6) | XS | light | not built | lists stored documents with their versions | 1.6 |
| new | GET | `/api/workspaces/{doc}` | new (stage 1.6) | XS | light | not built | reads one stored document | 1.6 |
| new | PUT | `/api/workspaces/{doc}` | new (stage 1.6) | XS | light | not built | the third write: versioned (If-Match), size-capped, schema-checked, writes only terminal/state/workspaces/<doc>.json; doc from a fixed allow list of ten names | 1.6 |

<!-- generated: backend 110 -->

| # | Path (`backend/nq_terminal/`) | Lines | Fate | Target | Stage | Test that proves parity |
|---:|---|---:|---|---|---|---|
| 1 | `__init__.py` | 3 | keep | unchanged | none | full backend suite and the contract drift test (no test imports it by name) |
| 2 | `__main__.py` | 34 | rewrite | binds port 0, prints the handshake line on stdout, starts the stdin watchdog, takes the lock or exits with ATTACH | 1.3, 1.5 | `test_app.py`, `test_live_stream_server.py`; plus a new seam test (section 15) |
| 3 | `analytics/__init__.py` | 9 | keep | unchanged | none | `test_analytics_api.py`, `test_analytics_distribution.py` (+45) |
| 4 | `analytics/_inputs.py` | 56 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series` |
| 5 | `analytics/bootstrap.py` | 272 | keep | unchanged; never ported (reproduces NumPy's PCG64 draws; out of G3) | none | crosscheck `bootstrap`; `test_dump_for_qa_lv6.py`, `test_lv6_expectation.py` (+4) |
| 6 | `analytics/capacity.py` | 172 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `p2capacity`; `test_p2_capacity.py`, `test_p2_rct_api.py` |
| 7 | `analytics/deflated.py` | 134 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `deflated`; `test_p1_deflated.py`, `test_p2_neff.py` (+1) |
| 8 | `analytics/distribution.py` | 96 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_distribution.py` (+3) |
| 9 | `analytics/drawdown.py` | 79 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`; `test_analytics_api.py`, `test_analytics_drawdown.py` (+4) |
| 10 | `analytics/excursions.py` | 157 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `paths`; `test_p1_trade_paths.py` |
| 11 | `analytics/expectation.py` | 300 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `lv6`; `test_lv6_expectation.py`, `test_lv6_expectation_api.py` |
| 12 | `analytics/exposure.py` | 482 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `costs`; `test_exposure.py`, `test_run_views_api.py` |
| 13 | `analytics/neff.py` | 252 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | golden `p2_neff_served.json`; `test_p2_neff.py`, `test_p2_neff_api.py` (+1) |
| 14 | `analytics/perf.py` | 229 | wrap | scipy.stats imported inside the functions that need it | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_parity.py` (+11); plus a new seam test (section 15) |
| 15 | `analytics/regimes.py` | 79 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `regimes`; `test_p1_regimes_stress.py` |
| 16 | `analytics/relative.py` | 137 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`; `test_analytics_api.py`, `test_p1_metrics.py` (+4) |
| 17 | `analytics/risk.py` | 167 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_distribution.py` (+3) |
| 18 | `analytics/risk_extras.py` | 176 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `p2risk`; `test_dump_for_qa_p2_risk_extras.py`, `test_p2_risk_extras.py` (+1) |
| 19 | `analytics/rolling.py` | 145 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`, `p1series`; `test_analytics_api.py`, `test_analytics_rolling.py` (+3) |
| 20 | `analytics/seasonality.py` | 201 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `seasonality`; `test_dump_for_qa_p11_seas.py`, `test_seasonality.py` |
| 21 | `analytics/series.py` | 455 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`, `p1series`; `test_analytics_api.py`, `test_dump_for_qa.py` (+16) |
| 22 | `analytics/spa.py` | 208 | keep | unchanged; never ported (reproduces NumPy's PCG64 draws; out of G3) | none | crosscheck `spa`; `test_dump_for_qa_p2_spa.py`, `test_p2_neff.py` (+2) |
| 23 | `analytics/stress.py` | 76 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `stress`; `test_p1_regimes_stress.py` |
| 24 | `analytics/term_structure.py` | 146 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `p2term`; `test_dump_for_qa_p2_rct.py`, `test_p2_term_structure.py` |
| 25 | `analytics/tracking.py` | 124 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `tracking`; `test_p1_tracking.py` |
| 26 | `analytics/trades.py` | 301 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `trades`; `test_p1_trade_paths.py`, `test_run_views_api.py` (+1) |
| 27 | `analytics/trend_regime.py` | 84 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `p2trend`; `test_dump_for_qa_p2_rct.py`, `test_p2_rct_api.py` (+2) |
| 28 | `analytics/validity.py` | 279 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`, `registry`; `test_analytics_api.py`, `test_p1_deflated.py` (+2) |
| 29 | `api/__init__.py` | 1 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_app.py`, `test_bars_api.py` (+14) |
| 30 | `api/analytics.py` | 360 | wrap | result cache on both bootstrap routes and /api/analytics/deflated; lazy import of analytics.perf | 1.1, 1.2 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 31 | `api/audit.py` | 153 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 32 | `api/commands.py` | 92 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 33 | `api/data.py` | 473 | wrap | result cache on /api/market/two-day | 1.2 | `test_bars_api.py`; plus a new seam test (section 15) |
| 34 | `api/dq.py` | 45 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_dq_api.py` |
| 35 | `api/events.py` | 195 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_events_api.py` |
| 36 | `api/ib.py` | 41 | keep | unchanged | none | `test_ib_api.py` |
| 37 | `api/instruments.py` | 50 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 38 | `api/jobs.py` | 163 | keep | unchanged; ALLOWED_WRITE_ROUTES joined by the workspace PUT in app.py | 1.6 | `test_app.py`, `test_dq_api.py` (+8) |
| 39 | `api/live.py` | 238 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_live_stream.py` |
| 40 | `api/live_stream.py` | 309 | keep | unchanged; cookie checked by middleware | 1.4 | `test_app.py`, `test_live_stream.py` (+1) |
| 41 | `api/paper_expectation.py` | 51 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_lv6_expectation_api.py` |
| 42 | `api/regimes_capacity_term.py` | 105 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_p2_rct_api.py` |
| 43 | `api/research.py` | 114 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 44 | `api/risk_extras.py` | 48 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_p2_risk_extras_api.py` |
| 45 | `api/roll.py` | 95 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 46 | `api/runs.py` | 156 | wrap | result cache on /api/ledger and /api/runs/compare | 1.2 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 47 | `api/seasonality.py` | 157 | wrap | result cache on /api/seasonality/instrument/{root} | 1.2 | `test_seasonality_api.py`; plus a new seam test (section 15) |
| 48 | `api/spa.py` | 35 | wrap | result cache on /api/analytics/spa | 1.2 | `test_p2_spa_api.py`; plus a new seam test (section 15) |
| 49 | `api/system.py` | 90 | wrap | health also reports the contract version | 1.3 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 50 | `api/vcone.py` | 88 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 51 | `app.py` | 155 | wrap | registers the token middleware, the proof, session and workspace routers; assert_get_only allows exactly three writes | 1.3, 1.4, 1.6 | `test_analytics_api.py`, `test_analytics_errors.py` (+39); plus a new seam test (section 15) |
| 52 | `constants.py` | 286 | keep | mnemonic table unchanged; Mac key alternatives live in the page | none | `test_dump_for_qa_p1.py`, `test_mnemonics.py` (+9) |
| 53 | `des_shapes.py` | 204 | keep | unchanged | none | `test_research_des.py`, `test_screen_api_gaps.py` |
| 54 | `models/__init__.py` | 1 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_dump_for_qa_lv6.py` (+12) |
| 55 | `models/analytics.py` | 411 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_p2_risk_extras_api.py`, `test_p2_trend_entry_lag.py` |
| 56 | `models/analytics_p1.py` | 353 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_lv6_expectation_api.py` |
| 57 | `models/audit.py` | 124 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 58 | `models/common.py` | 100 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_models_common.py`, `test_runs_api.py` |
| 59 | `models/data.py` | 202 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py` |
| 60 | `models/dq.py` | 86 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 61 | `models/events.py` | 96 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 62 | `models/expectation.py` | 81 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_dump_for_qa_lv6.py` |
| 63 | `models/ib.py` | 104 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_ib_api.py`, `test_ib_snapshot.py` |
| 64 | `models/instruments.py` | 87 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 65 | `models/jobs.py` | 244 | keep | lazy registry import kept; nautilus_trader stays out of start-up | 1.1 | `test_p2_jobs_models.py`, `test_p2_jobs_service.py` |
| 66 | `models/live.py` | 318 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_live_stream.py` |
| 67 | `models/neff.py` | 99 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 68 | `models/regimes_capacity_term.py` | 176 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_p2_rct_types_sync.py` |
| 69 | `models/research.py` | 247 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 70 | `models/risk_extras.py` | 72 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 71 | `models/roll.py` | 78 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 72 | `models/run_views.py` | 267 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 73 | `models/runs.py` | 240 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_screen_api_gaps.py` |
| 74 | `models/seasonality.py` | 66 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 75 | `models/spa.py` | 91 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 76 | `models/vcone.py` | 68 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 77 | `security.py` | 128 | wrap | adds the token cookie check on every /api call (hmac.compare_digest); exactly one origin in desktop mode | 1.4 | `test_csp_wasm.py`; plus a new seam test (section 15) |
| 78 | `services/amendments.py` | 76 | keep | unchanged service; reads only through FileCache and the gate | none | `test_registry_drift.py` |
| 79 | `services/audit.py` | 331 | keep | unchanged service; reads only through FileCache and the gate | none | `test_audit.py`, `test_contract_cleanups.py` (+2) |
| 80 | `services/bars.py` | 389 | keep | same gate injection; desktop default cap 512 MiB | 1.5 | `test_bars.py`, `test_bars_fixes.py` (+14) |
| 81 | `services/catalog.py` | 249 | keep | unchanged service; reads only through FileCache and the gate | none | `test_catalog.py`, `test_catalog_drift.py` (+1) |
| 82 | `services/dq.py` | 233 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `dq_nq`, `dq_sidecar`; `test_dq.py`, `test_dump_for_qa_p11_dq.py` (+1) |
| 83 | `services/dq_guards.py` | 96 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `guards`; `test_dq_guards.py`, `test_dump_for_qa_p11_dq.py` |
| 84 | `services/events.py` | 424 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `evt`; `test_events_api.py`, `test_events_dump_for_qa.py` (+2) |
| 85 | `services/fence.py` | 93 | keep | unchanged service; reads only through FileCache and the gate | none | `test_qa_fence.py` |
| 86 | `services/files.py` | 400 | keep | FileCache reused as the key scheme of the result cache | 1.2 | `test_dq.py`, `test_dq_guards.py` (+8) |
| 87 | `services/ib_readonly_client.py` | 392 | keep | unchanged; AST ban unchanged | none | `test_fixture_mode.py`, `test_ib_api.py` (+3) |
| 88 | `services/ib_snapshot.py` | 219 | keep | unchanged; code 326 already fatal | none | `test_ib_api.py`, `test_ib_snapshot.py` |
| 89 | `services/instruments.py` | 171 | keep | unchanged service; reads only through FileCache and the gate | none | full backend suite and the contract drift test (no test imports it by name) |
| 90 | `services/jobs.py` | 346 | wrap | allow-listed _child_env; refuses unless sys.prefix is ROOT/.venv; close() called by the watchdog | 1.3, 1.5 | `test_p2_jobs_api.py`, `test_p2_jobs_service.py`; plus a new seam test (section 15) |
| 91 | `services/journals.py` | 519 | keep | unchanged service; reads only through FileCache and the gate | none | `test_contract_cleanups.py`, `test_dump_for_qa_p1.py` (+7) |
| 92 | `services/live_routes.py` | 132 | keep | unchanged service; reads only through FileCache and the gate | none | full backend suite and the contract drift test (no test imports it by name) |
| 93 | `services/market.py` | 229 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `market`; `test_bars_api.py`, `test_contract_cleanups.py` (+6) |
| 94 | `services/neff_view.py` | 57 | keep | unchanged service; reads only through FileCache and the gate | none | `test_dump_for_qa_p2_spa.py`, `test_p2_neff_bridge.py` |
| 95 | `services/paper_expectation.py` | 194 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `lv6`; `test_dump_for_qa_lv6.py`, `test_lv6_expectation_api.py` |
| 96 | `services/regimes_capacity_term.py` | 285 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p2capacity`, `p2term`, `p2trend`; `test_dump_for_qa_p2_rct.py`, `test_p2_rct_api.py` (+1) |
| 97 | `services/research.py` | 715 | keep | unchanged service; reads only through FileCache and the gate | none | `test_analytics_api.py`, `test_dump_for_qa.py` (+23) |
| 98 | `services/risk_extras.py` | 107 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p2risk`; `test_p2_risk_extras_api.py` |
| 99 | `services/roll.py` | 222 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `roll`; `test_dump_for_qa_p11_roll.py`, `test_p11_fixes.py` (+1) |
| 100 | `services/run_books.py` | 209 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `costs`, `trades`; `test_dump_for_qa.py`, `test_dump_for_qa_p1.py` (+3) |
| 101 | `services/runs.py` | 737 | keep | unchanged service; reads only through FileCache and the gate | none | `test_dump_for_qa.py`, `test_dump_for_qa_p1.py` (+7) |
| 102 | `services/seasonality.py` | 245 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `seasonality`; `test_dump_for_qa_p11_seas.py`, `test_p11_fixes.py` (+2) |
| 103 | `services/sessions.py` | 116 | keep | unchanged service; reads only through FileCache and the gate | none | `test_seasonality_service.py` |
| 104 | `services/spa_family.py` | 310 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `spa`; `test_dump_for_qa_p2_spa.py`, `test_p2_spa_api.py` |
| 105 | `services/stored_alpha.py` | 134 | keep | unchanged service; reads only through FileCache and the gate | none | `test_analytics_api.py`, `test_registry_drift.py` (+2) |
| 106 | `services/tearsheet.py` | 445 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `series`; `test_p1_bootstrap.py`, `test_p2_risk_extras_api.py` (+1) |
| 107 | `services/tearsheet_extended.py` | 282 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p1series`; `test_dump_for_qa_p1.py`, `test_p1_api.py` (+3) |
| 108 | `services/tearsheet_trades.py` | 127 | keep | unchanged service; reads only through FileCache and the gate | none | `test_p1_api.py` |
| 109 | `services/vcone.py` | 166 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `vcone`; `test_vcone.py`, `test_vcone_api.py` (+1) |
| 110 | `settings.py` | 113 | wrap | NQT_PORT accepts 0; NQT_DESKTOP mode flag; desktop cache defaults (512 MiB bars, 128 MiB files) | 1.3, 1.5 | `test_analytics_api.py`, `test_analytics_errors.py` (+41); plus a new seam test (section 15) |

<!-- generated: front 25 screens, 24 support -->

| # | Path (`web/src/`) | Non-test files | Test files | Fate | Target | Stage | Test that proves parity |
|---:|---|---:|---:|---|---|---|---|
| 1 | `screens/blk` | 3 | 1 | keep | unchanged screen, same contract | none | vitest `screens/blk` (1 file); Playwright books.spec.ts; Mac smoke set (3.1) |
| 2 | `screens/corr` | 4 | 3 | keep | unchanged screen, same contract | none | vitest `screens/corr` (3 files); Playwright market.spec.ts; Mac smoke set (3.1) |
| 3 | `screens/cost` | 5 | 4 | keep | unchanged screen, same contract | none | vitest `screens/cost` (4 files); Playwright books.spec.ts; Mac smoke set (3.1) |
| 4 | `screens/des` | 29 | 21 | keep | Save rows call bridge.saveFile instead of the anchor | 1.7 | vitest `screens/des` (21 files); Playwright des.spec.ts; Mac smoke set (3.1) |
| 5 | `screens/dq` | 6 | 3 | keep | unchanged screen, same contract | none | vitest `screens/dq` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 6 | `screens/evt` | 8 | 3 | keep | unchanged screen, same contract | none | vitest `screens/evt` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 7 | `screens/expo` | 2 | 2 | keep | unchanged screen, same contract | none | vitest `screens/expo` (2 files); Playwright books.spec.ts; Mac smoke set (3.1) |
| 8 | `screens/gp` | 12 | 6 | keep | unchanged; GIP pan and zoom traced at 20,000 bars | 2.4 | vitest `screens/gp` (6 files); Playwright gp.spec.ts, gallery-candles.spec.ts; Mac smoke set (3.1) |
| 9 | `screens/help` | 9 | 4 | wrap | shows the Mac bindings and the desktop key notes; licence list completed | 3.3 | vitest `screens/help` (4 files); Playwright keys.spec.ts, fkeys.spec.ts; Mac smoke set (3.1) |
| 10 | `screens/home` | 8 | 7 | keep | orientation flag moves to the workspace store (nqt.orientation) | 1.6 | vitest `screens/home` (7 files); Playwright home.spec.ts, perf/budgets.spec.ts; Mac smoke set (3.1) |
| 11 | `screens/jobs` | 11 | 4 | keep | unchanged screen, same contract | none | vitest `screens/jobs` (4 files); Playwright flows/safety.spec.ts, flows/p2.spec.ts; Mac smoke set (3.1) |
| 12 | `screens/layouts` | 3 | 1 | keep | default layouts unchanged; saved layouts read from the store | 1.6 | vitest `screens/layouts` (1 file); Playwright panels.spec.ts; Mac smoke set (3.1) |
| 13 | `screens/ledg` | 6 | 3 | keep | unchanged screen, same contract | none | vitest `screens/ledg` (3 files); Playwright perspective.spec.ts, books.spec.ts; Mac smoke set (3.1) |
| 14 | `screens/live` | 27 | 16 | keep | unchanged; countdown re-synced on visibility change after a restore | 2.4 | vitest `screens/live` (16 files); Playwright live.spec.ts, stream.spec.ts; Mac smoke set (3.1) |
| 15 | `screens/mon` | 14 | 7 | keep | MON defaults move to the workspace store (nqt.mon.defaults) | 1.6 | vitest `screens/mon` (7 files); Playwright market.spec.ts; Mac smoke set (3.1) |
| 16 | `screens/oos` | 10 | 5 | keep | CSV export through bridge.saveFile | 1.7 | vitest `screens/oos` (5 files); Playwright perspective.spec.ts; Mac smoke set (3.1) |
| 17 | `screens/p2rct` | 8 | 2 | keep | unchanged screen, same contract | none | vitest `screens/p2rct` (2 files); Playwright flows/p2.spec.ts; Mac smoke set (3.1) |
| 18 | `screens/reg` | 44 | 44 | keep | Export rows call bridge.saveFile | 1.7 | vitest `screens/reg` (44 files); Playwright reg.spec.ts, flows/p2.spec.ts; Mac smoke set (3.1) |
| 19 | `screens/riskextras` | 7 | 4 | keep | unchanged screen, same contract | none | vitest `screens/riskextras` (4 files); Playwright flows/p2.spec.ts; Mac smoke set (3.1) |
| 20 | `screens/roll` | 10 | 3 | keep | unchanged screen, same contract | none | vitest `screens/roll` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 21 | `screens/runs` | 19 | 11 | keep | run id copy through bridge.copyText (clipboard API first) | 1.7 | vitest `screens/runs` (11 files); Playwright runs.spec.ts, perspective.spec.ts; Mac smoke set (3.1) |
| 22 | `screens/seal` | 2 | 1 | keep | Save row calls bridge.saveFile | 1.7 | vitest `screens/seal` (1 file); Playwright books.spec.ts; Mac smoke set (3.1) |
| 23 | `screens/seas` | 7 | 2 | keep | unchanged screen, same contract | none | vitest `screens/seas` (2 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 24 | `screens/tear` | 26 | 20 | keep | unchanged screen, same contract | none | vitest `screens/tear` (20 files); Playwright tear.spec.ts; Mac smoke set (3.1) |
| 25 | `screens/vcone` | 9 | 4 | keep | unchanged screen, same contract | none | vitest `screens/vcone` (4 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 26 | `(src root)` | 3 | 6 | wrap | main.tsx installs the bridge implementation chosen at start | 1.7 | vitest `(src root)` (6 files); new bridge or store tests (section 15) |
| 27 | `api` | 15 | 12 | wrap | client gains no new channel; health carries the contract version; bridgeVersion check; workspace client added beside jobsClient (the write scan allows exactly it) | 1.3, 1.6, 1.7 | vitest `api` (12 files); new bridge or store tests (section 15) |
| 28 | `assets` | 6 | 0 | keep | unchanged | none | covered through its callers' tests |
| 29 | `charts` | 31 | 26 | keep | unchanged; forced-colours drawing in the later accessibility phase | later | vitest `charts` (26 files) |
| 30 | `charts/echarts` | 28 | 18 | keep | unchanged | none | vitest `charts/echarts` (18 files) |
| 31 | `charts/theme` | 9 | 7 | keep | unchanged tokens; contrast re-run on WebKit | 3.1 | vitest `charts/theme` (7 files) |
| 32 | `chrome` | 107 | 86 | wrap | download.ts and panelExport.ts go through the bridge; key map gains Mac alternatives; deep links read from a launch argument in the app | 1.7, 3.3 | vitest `chrome` (86 files); new bridge or store tests (section 15) |
| 33 | `commands` | 12 | 14 | wrap | history moves to the store (nqt.cmd.history); Mac key alternatives in the grammar | 1.6, 3.3 | vitest `commands` (14 files); new bridge or store tests (section 15) |
| 34 | `copy` | 72 | 24 | wrap | new strings for the splash, backend stopped page and Mac keys; copy rules test | 2.1, 3.3 | vitest `copy` (24 files) |
| 35 | `demo` | 17 | 12 | keep | unchanged; ships only in the demo build; feeds the self-test page's offline mode | none | vitest `demo` (12 files) |
| 36 | `export` | 1 | 1 | wrap | saveBlob and saveText through the bridge | 1.7 | vitest `export` (1 file); new bridge or store tests (section 15) |
| 37 | `export/dossier` | 4 | 3 | keep | unchanged | none | vitest `export/dossier` (3 files) |
| 38 | `export/grab` | 4 | 4 | wrap | PNG save through bridge.saveFile; image copy through bridge.copyImage | 1.7 | vitest `export/grab` (4 files); new bridge or store tests (section 15) |
| 39 | `export/pack` | 2 | 2 | wrap | evidence pack saved through bridge.saveFile | 1.7 | vitest `export/pack` (2 files); new bridge or store tests (section 15) |
| 40 | `export/print` | 3 | 3 | keep | window.print() kept; checked in WebView2 and WKWebView | 2.4, 3.1 | vitest `export/print` (3 files) |
| 41 | `format` | 1 | 0 | keep | unchanged | none | covered through its callers' tests |
| 42 | `gallery` | 7 | 2 | keep | unchanged; screenshot gallery stays on Chromium | none | vitest `gallery` (2 files) |
| 43 | `grids` | 12 | 12 | keep | unchanged | none | vitest `grids` (12 files) |
| 44 | `perspective` | 16 | 8 | keep | wasm32 server pinned by a test; worker same-origin | 1.7 | vitest `perspective` (8 files) |
| 45 | `quant` | 6 | 6 | keep | golden tests also run under JavaScriptCore in CI | 3.1 | vitest `quant` (6 files) |
| 46 | `state` | 8 | 10 | wrap | zustand stores keep localStorage as a cache and sync to the workspace store; one-time import from browser storage | 1.6 | vitest `state` (10 files); new bridge or store tests (section 15) |
| 47 | `theme` | 11 | 10 | wrap | look and scheme move to the store (nqt.theme, nqt.cvd); forced-colors and prefers-contrast rules in the later accessibility phase | 1.6, later | vitest `theme` (10 files); new bridge or store tests (section 15) |
| 48 | `tiles` | 7 | 6 | keep | unchanged | none | vitest `tiles` (6 files) |
| 49 | `vendor` | 4 | 4 | keep | unchanged | none | vitest `vendor` (4 files) |

<!-- generated: other 35 -->

| # | Path | Fate | Target | Stage | Test that proves parity |
|---:|---|---|---|---|---|
| 1 | `qa/crosscheck/__init__.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 2 | `qa/crosscheck/__main__.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 3 | `qa/crosscheck/compare.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 4 | `qa/crosscheck/dumps.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 5 | `qa/crosscheck/lv6_live_cone.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 6 | `qa/crosscheck/market_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 7 | `qa/crosscheck/p11_dq.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 8 | `qa/crosscheck/p11_evt.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 9 | `qa/crosscheck/p11_roll.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 10 | `qa/crosscheck/p11_seas.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 11 | `qa/crosscheck/p11_vcone.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 12 | `qa/crosscheck/p12_expectation.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 13 | `qa/crosscheck/p12_neff.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 14 | `qa/crosscheck/p12_power.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 15 | `qa/crosscheck/p1_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 16 | `qa/crosscheck/p2_amber_classic.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 17 | `qa/crosscheck/p2_regimes_capacity_term.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 18 | `qa/crosscheck/p2_risk_extras.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 19 | `qa/crosscheck/p2_spa.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 20 | `qa/crosscheck/paths.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 21 | `qa/crosscheck/reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 22 | `qa/crosscheck/report.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 23 | `qa/crosscheck/trade_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 24 | `qa/golden/p12_expectation.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 25 | `qa/golden/p12_neff.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 26 | `qa/golden/p12_power.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 27 | `qa/golden/p2_neff_served.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 28 | `start.ps1` | wrap | allow-listed environment; lock file attach; one-time launch code for the browser door | 1.4, 1.5 | launcher plan tests; `-DryRun` output check |
| 29 | `start.sh` | keep | unchanged hand-off to scripts/start.mjs | none | launcher tests |
| 30 | `scripts/start.mjs` | keep | unchanged Node version guard | none | `nodeGuard.test.ts` |
| 31 | `web/scripts/start/` | wrap | same changes as start.ps1 for the Mac browser door | 1.4, 1.5 | `plan.test.ts`, `doctor.test.ts`, `entry.test.ts` |
| 32 | `scripts/smoke_real.ps1` | wrap | second mode that drives the packaged app (hidden window) instead of a browser | 2.4 | the smoke itself: hashes unchanged, only terminal gate lines appended |
| 33 | `contract/openapi.json` | keep | regenerated once for the seven new routes | 1.3, 1.4, 1.6 | contract drift test; `pnpm test` codegen check |
| 34 | `web/scripts/bundleCheck.ts` | keep | budgets unchanged; desktop budgets live in the shell harness | none | `bundleCheck.test.ts`, `shellBudget.test.ts` |
| 35 | `web/e2e/` | keep | unchanged on Chromium; a desktop project reuses the specs against the app-launched backend | 2.4 | the suite itself |

<!-- generated: deps -->

| # | Python distribution (backend runtime) | Version | Installed MB | Loaded | Fate | Note |
|---:|---|---|---:|---|---|---|
| 1 | `nautilus_trader` | 1.231.0 | 317.2 | on first use of a route | keep, out of the start path | loaded only by GET /api/jobs and the JOBS child; never in the shell |
| 2 | `scipy` | 1.18.1 | 103.0 | app start | keep, lazy | imported inside the 14 functions' callers after stage 1.1; not ported |
| 3 | `pyarrow` | 25.0.1 | 82.5 | app start | keep | catalogue footers; rows only inside nq_lab |
| 4 | `numpy` | 2.5.3 | 40.1 | app start | keep | PCG64 draw order pinned by the crosscheck; never replaced |
| 5 | `pandas` | 2.3.3 | 36.6 | app start | keep | the real coupling; no port planned |
| 6 | `pydantic_core` | 2.46.5 | 5.2 | app start | keep | response validation |
| 7 | `pydantic` | 2.13.5 | 1.8 | app start | keep | response models, new workspace schemas |
| 8 | `zstandard` | 0.25.0 | 1.3 | on first use of a route | keep | transitive; follows its parent |
| 9 | `pytz` | 2026.4 | 1.0 | app start | keep | transitive; follows its parent |
| 10 | `exchange_calendars` | 4.13.2 | 0.8 | app start | keep | DQ calendar |
| 11 | `fastapi` | 0.141.1 | 0.8 | app start | keep | same contract |
| 12 | `fsspec` | 2026.2.0 | 0.7 | on first use of a route | keep | transitive; follows its parent |
| 13 | `charset-normalizer` | 3.5.1 | 0.6 | app start | keep | transitive; follows its parent |
| 14 | `tzdata` | 2026.4 | 0.6 | app start | keep | transitive; follows its parent |
| 15 | `anyio` | 4.15.1 | 0.5 | app start | keep | stream and stdin watchdog thread |
| 16 | `python-dateutil` | 2.9.0.post0 | 0.4 | app start | keep | transitive; follows its parent |
| 17 | `httpx2` | 2.13.1 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 18 | `idna` | 3.20 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 19 | `msgspec` | 0.21.1 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 20 | `orjson` | 3.12.0 | 0.3 | app start | keep | unchanged |
| 21 | `starlette` | 1.7.0 | 0.3 | app start | keep | middleware gains the token check |
| 22 | `toolz` | 1.1.0 | 0.2 | app start | keep | transitive; follows its parent |
| 23 | `typing_extensions` | 4.16.0 | 0.2 | app start | keep | transitive; follows its parent |
| 24 | `cloudpickle` | 3.1.2 | 0.1 | app start | keep | transitive; follows its parent |
| 25 | `portion` | 2.6.2 | 0.1 | on first use of a route | keep | transitive; follows its parent |
| 26 | `pyluach` | 2.3.0 | 0.1 | app start | keep | transitive; follows its parent |
| 27 | `sortedcontainers` | 2.4.0 | 0.1 | on first use of a route | keep | transitive; follows its parent |
| 28 | `typing-inspection` | 0.4.4 | 0.1 | app start | keep | transitive; follows its parent |
| 29 | `annotated-doc` | 0.0.5 | 0.0 | app start | keep | transitive; follows its parent |
| 30 | `annotated-types` | 0.8.0 | 0.0 | app start | keep | transitive; follows its parent |
| 31 | `korean_lunar_calendar` | 0.4.0 | 0.0 | app start | keep | transitive; follows its parent |
| 32 | `six` | 1.17.0 | 0.0 | app start | keep | transitive; follows its parent |
| 33 | `sniffio` | 1.3.1 | 0.0 | app start | keep | transitive; follows its parent |
| 34 | `uvicorn` | 0.54.0 | 0.3 | server entry point; plain install, so no `uvloop` and no `httptools`: it runs on the standard asyncio loop | keep | binds port 0 in desktop mode |
| 35 | `h11` | 0.16.0 | 0.1 | HTTP/1.1 parser used by uvicorn | keep | unchanged |
| 36 | `click` | 8.5.0 | 0.4 | imported by uvicorn | keep | transitive; follows its parent |
| 37 | `nautilus_ibapi` | 10.45.1 | 1.1 | only with `NQT_IB_READONLY=1`, and only inside `take_snapshot` | keep, opt-in | read-only snapshot, client id 95 |
| 38 | `protobuf` | 5.29.6 | 1.6 | dependency of the IB library | keep | transitive; follows its parent |
| 39 | `scikit-learn 1.9.1` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | research code only |
| 40 | `langchain-typesafe and its tree` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | lab text pipeline only |
| 41 | `quantpad-data 0.8.0` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | lab data pulls only |
| 42 | `pytest` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | backend test runner |

| # | QA environment (pinned in `qa/pyproject.toml`) | Fate | Note |
|---:|---|---|---|
| 1 | `quantstats==0.0.82` | keep | the oracle; runs in CI on Windows; never shipped |
| 2 | `empyrical-reloaded==0.5.12` | keep | the oracle; runs in CI on Windows; never shipped |
| 3 | `arch==8.0.0` | keep | the oracle; runs in CI on Windows; never shipped |
| 4 | `statsmodels==0.15.0` | keep | the oracle; runs in CI on Windows; never shipped |
| 5 | `scipy==1.18.1` | keep | the oracle; runs in CI on Windows; never shipped |
| 6 | `pytest==9.0.2` | keep | the oracle; runs in CI on Windows; never shipped |

| # | npm production dependency | Version | Fate | Note |
|---:|---|---|---|---|
| 1 | `@fontsource/pt-mono` | 5.3.0 | keep | self-hosted; same glyphs on both engines |
| 2 | `@fontsource/source-sans-3` | 5.3.0 | keep | self-hosted |
| 3 | `@perspective-dev/client` | 5.5.1 | keep | unchanged |
| 4 | `@perspective-dev/server` | 5.5.1 | keep | wasm32 build pinned by a test (memory64 absent in Safari) |
| 5 | `@perspective-dev/viewer` | 5.5.1 | keep | unchanged |
| 6 | `@perspective-dev/viewer-datagrid` | 5.5.1 | keep | unchanged |
| 7 | `@tanstack/react-query` | 5.103.2 | keep | networkMode always kept |
| 8 | `@tanstack/react-table` | 9.2.4 | keep | unchanged |
| 9 | `@tanstack/react-virtual` | 3.14.13 | keep | unchanged |
| 10 | `cmdk` | 1.1.1 | keep | unchanged |
| 11 | `dockview-react` | 8.3.1 | keep | drag and drop stays off; checked in WKWebView at G1 |
| 12 | `echarts` | 6.1.0 | keep | Apache-2.0 notice added to HELP licences |
| 13 | `lightweight-charts` | 5.2.1 | keep | Apache-2.0 notice; attribution link opens in the system browser |
| 14 | `react` | 19.3.0 | keep | unchanged |
| 15 | `react-dom` | 19.3.0 | keep | unchanged |
| 16 | `uplot` | 1.6.32 | keep | unchanged |
| 17 | `zustand` | 5.0.15 | keep | stores sync to the workspace store |

| # | npm development dependency | Version | Fate | Note |
|---:|---|---|---|---|
| 1 | `@axe-core/playwright` | 4.13.0 | keep | also injected into the Mac self-test page (axe-core build) |
| 2 | `@playwright/test` | 1.63.0 | keep | stays the Chromium suite; drives Electron only if T1 or T2 fires |
| 3 | `@tailwindcss/vite` | 4.3.3 | keep | unchanged |
| 4 | `@testing-library/dom` | 10.4.2 | keep | unchanged |
| 5 | `@testing-library/react` | 16.3.3 | keep | unchanged |
| 6 | `@types/node` | 24.19.0 | keep | unchanged |
| 7 | `@types/react` | 19.3.0 | keep | unchanged |
| 8 | `@types/react-dom` | 19.3.0 | keep | unchanged |
| 9 | `@vitejs/plugin-react` | 6.1.1 | keep | unchanged |
| 10 | `jsdom` | 30.1.1 | keep | unchanged |
| 11 | `openapi-typescript` | 7.13.0 | keep | regenerates types for the seven new routes |
| 12 | `tailwindcss` | 4.3.3 | keep | unchanged |
| 13 | `typescript` | 6.0.3 | keep | unchanged |
| 14 | `vite` | 8.3.1 | keep | unchanged |
| 15 | `vitest` | 5.0.2 | keep | unchanged; plus a JavaScriptCore runner for `web/src/quant` golden tests |

<!-- unmapped rows: 0 -->
