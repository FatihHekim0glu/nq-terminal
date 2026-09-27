# nq-lab terminal: analytics catalogue

Status: plan, 2026-09-26. Each row gives the ID, priority, formula, inputs, chart and QA reference. **[verified]** means confirmed on 2026-09-26 from code on disk, a numeric check or a fetched source; **[unverified]** means the QA gate of the phase that builds it must confirm it first.

The terminal never produces a new pass or fail. Verdicts come from the result files. Everything computed here is descriptive and says so.

## 0. Conventions that bind every metric

**C1. Two return bases. Every number names its basis.**
- **Basis A, "screen"** (registered hypotheses): `r_t = PnL_t / K`, arithmetic, K the fixed starting capital. Equity `K·(1 + cumsum r)`. Drawdown in units of K, peak to trough of `cumsum r` with a floor at 0. Matches `sizing_stats.max_drawdown` and the screen JSONs [verified, `src/nq_lab/sizing_stats.py`].
- **Basis B, "account"** (Nautilus runs): `r_t = E_t / E_{t-1} - 1` from `strategy_log.snapshots[].equity`, one snapshot per session (2,517 for `nt_dtsmom_v0_ts1`), compounding from `E_0 = K`.
- Runs without snapshots (`za_orb`, `overnight`): daily P&L from `trades` grouped by date, one row for every gated session with 0 on days with no trade, as `metrics.daily_pnl` does [verified, `src/nq_lab/metrics.py`]. Labelled "realised, no MTM".
- One-contract screen series (Basis A in USD): zero-filled over the window the screen served (`serve.start` to `serve.end`, else 2010-09-28 to the fence), never from the first to the last trade, so n and MinTRL (and SV3's common daily basis) are the screen's own (halloween_v0 Sharpe 0.8836 first to last, 0.8731 over the window). `eurodrift_v0` void nights count as 0, as the screen's unconditional book (`eurodrift_stats.daily_books`): 0.3923 over 2,835 nights, against 0.4340 on the 2,317 valid nights alone and C6.sharpe_uncond 0.3930 on the 2,825 sessions with both NQ closes (a set that needs prices).
- An account whose equity reaches zero or below cannot compound: its Basis B series is refused (the three lookahead probe runs) and served as 422 with the first such session.

**C2. Calendar and annualisation.** Trading sessions only, never calendar days. P = 252 for daily series, 12 for monthly books; never mixed. mean·P; sd(ddof=1)·√P; Sharpe = mean/sd(ddof=1)·√P; years = n/252 (as `volmanaged_v0.json`: 2686/252 = 10.6587) [verified]. Risk-free rate 0: futures P&L is already an excess return and the backtests earn no interest on cash.

**C3. Nautilus paths not used for displayed numbers.** `PortfolioAnalyzer.portfolio_returns()` and the tearsheet resample to calendar days, forward-fill and add a zero return on weekends, then annualise with √252 [verified, `analysis/analyzer.py:854-864`, `tearsheet.py:770-785`]. On a synthetic 5-year business-day series: correct Sharpe 0.2679, CAGR 3.01%, vol 15.64%; analyser path 0.2264, 2.14%, 13.21% [verified numerically]. Nautilus `Alpha` annualises geometrically (9.87% against 9.41% arithmetic on the same test) and has no Newey-West t [verified]. Nautilus pyo3 statistics are used only as a second implementation in tests, fed `{ts_ns: r}` on a session index.

**C4. Name collision.** In the screen JSONs `headline.*.dsr` is the **Sharpe difference** (managed minus buy-and-hold), not the Deflated Sharpe Ratio (`volmanaged_v0` 0tick: `dsr = -0.000281` = 0.99671 - 0.99699) [verified]. The UI labels it "Sharpe difference (m - BH)". "DSR" means only Bailey and López de Prado's statistic.

**C5. Prices only through the gate.** Views that need prices use `/api/bars` and `/api/market/*`, which go through `nq_lab.data.serve(caller="terminal")` with the in-memory year cache (`ARCHITECTURE.md` section 5). They end at 2021-12-31. 2022+ appears only from `results/sealed/` result columns, labelled "spent window, opened 2026-09-26, descriptive only".

**C6. Benchmark comes from the run's spec, never a default.** NQ sizing books: the same-exposure buy-and-hold columns `r_bh_k` in `*_daily.csv`. NQ intraday strategies: NQ buy-and-hold close to close. `dtsmom`: the long-only equal-risk book (`nt_dtsmom_v0_lo1`, or `r_lo_*` in `dtsmom_v0_monthly.csv`).

**C7. Tags.** Values read from a registered result carry `[PRE-REG]`. Values the terminal computes carry `[POST HOC]`. No p-value is shown on a slice the user picked interactively.

**C8. Implementation.** All formulas live as pure functions in `terminal/backend/nq_terminal/analytics/` (numpy and pandas, no hidden state, inputs as session-indexed Series); only `analytics/series.py`, which builds those Series, and `services/run_books.py`, which reads a run's rows (trades, fills, snapshots) and a book's raw closes through the gate for TA and EX, call the injected services. Where nq-lab already has the function (`sizing_stats.sharpe`, `max_drawdown`, `spanning_alpha`, `tails`, `lw_sharpe_test`, `memmel_z`; `metrics.daily_pnl`), the terminal imports it and tests that its own path agrees.

## 1. Performance

| ID | Pri | Metric and chart | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| PF1 | P0 | Equity curve (uPlot line, log toggle, benchmark overlay, roll and rebalance markers, fence) | A: `K·(1+cumsum r)`. B: `E_t` | snapshots `equity`; trades to daily P&L; `*_daily.csv` | Final value equals `balance_check.final_usd` (B) or `pnl_total` (realised); quantstats `plots.returns` for shape |
| PF2 | P0 | Total return, CAGR (KPI tiles) | `(E_T/E_0)^(252/n) - 1`, n sessions | PF1 | Nautilus `CAGR` [verified src]; quantstats `cagr` |
| PF3 | P0 | Annualised volatility | `sd(r, ddof=1)·√252` | daily r | Nautilus `ReturnsVolatility`; empyrical `annual_volatility` |
| PF4 | P0 | Sharpe with 95% CI | `mean/sd(ddof=1)·√252`; 95% CI `SR ± 1.96·SE` with the Mertens (2002) standard error for the daily Sharpe, `SE_d = sqrt((1 - γ3·SR_d + (γ4-1)/4·SR_d²)/(n-1))`, annualised by √252 (same moments as SV1) in P0; bootstrap (SV5) in P1 | daily r | Nautilus `SharpeRatio` [verified]; `sizing_stats.sharpe`; anchor `volmanaged_v0_daily.csv r_m_1` = **0.9914875364356387** against stored 0.9914875364356394 (tolerance 1e-12) [verified] |
| PF5 | P0 | Sortino | `mean / sqrt(mean(min(r,0)²))·√252`, denominator over all n, target 0 | daily r | Nautilus `SortinoRatio` [verified src]; quantstats `sortino`; empyrical `sortino_ratio` |
| PF6 | P0 | Calmar | `CAGR / abs(MaxDD)` over the full sample (label says so; not the 36-month classic) | PF2, DD1 | Nautilus `CalmarRatio`; quantstats `calmar` |
| PF7 | P1 | Omega(0) | `Σmax(r,0) / Σmax(-r,0)` | daily r | empyrical `omega_ratio` |
| PF8 | P1 | Tail ratio | `abs(Q95/Q5)`, linear quantiles | daily r | quantstats and empyrical `tail_ratio` |
| PF9 | P1 | Gain to pain (monthly) | `Σ r_m / abs(Σ min(r_m,0))`; A: month sums, B: compounded months | monthly r | quantstats `gain_to_pain_ratio` [argument name unverified] |
| PF10 | P0 | Stats table: hit rate, best and worst day and month, % positive months, skew, excess kurtosis, n, years | hit rate = periods with r > 0 over periods with r != 0 (flat periods are left out of the denominator, as quantstats `win_rate`; the tile says "non-zero periods"); skew `scipy.stats.skew(bias=False)`, kurtosis `kurtosis(fisher=True, bias=False)` as the screens | daily r | scipy |
| PF11 | P2 | Ulcer index, recovery factor | `sqrt(mean(DD²))` (n, documented); total return / abs(MaxDD) | DD1 | quantstats `ulcer_index` (n-1: document the difference) |

## 2. Drawdowns

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| DD1 | P0 | Underwater chart (filled area, strategy against benchmark) | B: `E_t / max_{s≤t} E_s - 1` with baseline `E_0 = K`. A: `cumsum r - max(0, cummax(cumsum r))` in % of K | PF1 | Nautilus `MaxDrawdown` (compounded, baseline 1.0) [verified src]; `sizing_stats.max_drawdown` (A); anchor dtsmom 32.9% against 57.3% long-only and volmanaged 22.6% against 32.9% (nq-lab project rules) |
| DD2 | P0 | Top-10 drawdown table | Per episode: peak date, trough date, recovery date (first t after trough with `E_t ≥ E_peak`, else "open"), depth, peak to trough sessions, trough to recovery sessions, total length | DD1 | quantstats `drawdown_details`; a second loop-based implementation |
| DD3 | P1 | Time-to-recovery histogram, longest time under water | from DD2 | DD2 | loop against vectorised |

## 3. Rolling statistics

Line charts with a zero line and the full-sample value dashed (DL8).

| ID | Pri | Item | Definition | QA reference |
|---|---|---|---|---|
| RL1 | P0 | Rolling Sharpe, 63 and 252 sessions (12 and 36 months for a monthly book, P = 12) | rolling mean / rolling sd(ddof=1) · √P; NaN until the window fills, no line across NaN. A 252-month window exceeds every monthly sample and a 3-month one has too few points, so monthly books use 12 and 36 | numpy loop against pandas rolling; empyrical `roll_sharpe_ratio` [name unverified] |
| RL2 | P0 | Rolling volatility, 63 and 252 (12 and 36 months, P = 12) | rolling sd · √P | numpy against pandas |
| RL3 | P1 | Rolling beta, 126 | `cov(r,b)/var(b)`, ddof=1 | Nautilus `BetaRatio` per window (0.59624 = OLS on test) [verified] |
| RL4 | P1 | Rolling correlation to benchmark, 126 | Pearson | numpy `corrcoef` |
| RL5 | P0 | Block bars 2010-13, 2014-17, 2018-21 | read from `summary.blocks` / screen `blocks` / `blocks_1tick`; never recomputed | anchor to the JSON values |

## 4. Return distributions

| ID | Pri | Item | Definition | QA reference |
|---|---|---|---|---|
| RD1 | P0 | Daily return histogram | Freedman-Diaconis bins, fitted normal overlay, VaR 95 and 99 lines; Sturges when the interquartile range is 0 (a mostly zero-filled one-contract series, where Freedman-Diaconis gives one bin), named in `bin_rule` | numpy `histogram_bin_edges(bins="fd")` |
| RD2 | P0 | Monthly returns heatmap (year × month) plus yearly bars | A: month sums. B: `Π(1+r)-1` within the month (as Nautilus `_aggregate_period_returns(compounding=True)`) [verified src] | quantstats `monthly_returns` |
| RD3 | P1 | QQ plot against normal | `scipy.stats.probplot` | scipy |
| RD4 | P1 | Jarque-Bera | `scipy.stats.jarque_bera` | scipy |

## 5. Risk

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| RK1 | P0 | Historical VaR and CVaR, 95% and 99%, 1 day | `VaR_α = -Q_α(r)`, linear interpolation; `CVaR_α = -mean(r | r ≤ Q_α)` | daily r | empyrical `value_at_risk`, `conditional_value_at_risk`. Not quantstats `value_at_risk` (parametric normal) [verified] |
| RK2 | P0 | 21-session loss distribution: overlapping 21-session sums, 1% and 5% mean shortfall | same code path as `sizing_stats.tails`; never √-time scaling | daily r | anchor `sizing_stats.tails` |
| RK3 | P1 | Normal and Cornish-Fisher VaR | `z_cf = z + (z²-1)S/6 + (z³-3z)K/24 - (2z³-5z)S²/36`, K excess kurtosis, `VaR = -(μ + σ z_cf)`; tile greyed outside the monotone domain [bound unverified; QA derives it] | μ, σ, S, K | PerformanceAnalytics `VaR(method="modified")` (R, run once by hand; not a dependency) |
| RK4 | P2 | Modified ES | Boudt, Peterson and Croux 2008 | same | PerformanceAnalytics `ES(method="modified")` |
| RK5 | P1 | Stress windows table | Top-5 in-sample NQ buy-and-hold drawdown episodes from the gated daily series, frozen in `constants.py` before any strategy is shown; columns: strategy return, benchmark return, strategy MaxDD in window. 2022 only from `results/sealed/volmanaged_oos_daily.csv`, labelled spent | NQ daily BH, strategy daily | two implementations |

## 6. Benchmark-relative

| ID | Pri | Item | Definition | QA reference |
|---|---|---|---|---|
| BR1 | P0 | Alpha and beta (headline) | The project's spanning regression `r = a + b·r_b + e`, alpha_ann = 252·a (arithmetic), Newey-West t at lags 5 and 21, gating t = min [verified `sizing_stats.spanning_alpha`]. Read from the result JSON where present; for Nautilus runs computed with `spanning_alpha` itself. A one-contract series (USD, no K) shows `a` in its own unit and no alpha in % per year | anchor `volmanaged_v0.json blocks_1tick.*.alpha_annual_pct`; statsmodels OLS with HAC |
| BR2 | P0 | Information ratio, tracking error | `IR = mean(r-b)/sd(r-b)·√252`; `TE = sd(r-b)·√252` | Nautilus `InformationRatio`, `TrackingError` (agree to 1e-12) [verified] |
| BR3 | P1 | Up and down capture | Nautilus definition: ratio of geometric annualised returns over benchmark-up (down) sessions [verified docstring]; label "annualised geometric" (0.373 against 0.64 for the naive ratio on the test) | Nautilus `UpCaptureRatio`, `DownCaptureRatio`; empyrical `up_capture` |
| BR4 | P1 | Scatter of r against r_b with the OLS line | chart only | as BR1 |
| BR5 | P2 | Treynor | `CAGR / beta` | Nautilus `TreynorRatio` |

## 7. Statistical validity

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| SV1 | P0 | Probabilistic Sharpe Ratio | `PSR(SR*) = Φ((SR - SR*)·√(n-1) / √(1 - γ3·SR + (γ4-1)/4·SR²))`, SR per period (daily, not annualised), γ4 raw kurtosis (normal 3). Shown at SR* = 0 and SR* = benchmark Sharpe; the latter treats the benchmark Sharpe as a fixed threshold, so it is not a test of the Sharpe difference (that is SV7) and says so | daily r | Bailey and López de Prado, DSR paper eq. 2; not quantstats (kurtosis convention unverified) |
| SV2 | P0 | Minimum track record length | `MinTRL = 1 + [1 - γ3·SR + (γ4-1)/4·SR²]·(z_{1-α}/(SR - SR*))²` sessions, shown in years next to the actual length; "not reachable" when SR ≤ SR*, "not defined" when n ≤ 3 or the variance term is not positive (`reason`) | daily r | SSRN 1821643; PerformanceAnalytics `MinTrackRecord` |
| SV3 | P1 | Deflated Sharpe over the registry (DL9) | `SR0 = √V·((1-γ)Φ⁻¹(1-1/N) + γΦ⁻¹(1-1/(Ne)))`, γ = 0.5772, `DSR = PSR(SR0)`, N = 15, V = variance of per-period Sharpes on a common Basis A daily basis (0 on days with no trade). Extra view only; never overrides a frozen pass bar | registry and each screen's daily series | Golden fixture: paper example (N=100, V=1/(2·250), T=1250, γ3=-3, γ4=10, SR=2.5/√250) gives SR0 = 0.1132, DSR = 0.9004 [verified] |
| SV4 | P0 | Multiple-testing view of `registry.csv` | Sorted p against rank with Bonferroni α/k, Holm α/(k-i+1) and BH iα/k lines; table of stored adjusted values; sealed confirmations listed separately with their own α | `results/registry.csv` (15 registered rows) | `scipy.stats.false_discovery_control` reproduces stored BH q (max abs diff 8e-16) [verified]; statsmodels `multipletests` for Holm and Bonferroni |
| SV5 | P1 | Bootstrap CIs (Sharpe, CAGR, MaxDD) | Stationary bootstrap (Politis and Romano), Politis-White block length, 10,000 reps, fixed seed; implemented in numpy | daily r | arch `StationaryBootstrap`, `optimal_block_length` in the QA env |
| SV6 | P1 | Monte Carlo cone (5/25/50/75/95 over 252 sessions, realised path overlaid, labelled "resampled history, not a forecast") | same bootstrap; paths summed (A) or compounded (B) | daily r | arch |
| SV7 | P0 | Sharpe difference against benchmark | Show `lw_sharpe_test` (Ledoit-Wolf) and `memmel_z` values from the screen JSON; never recompute | screen JSONs | anchor to JSON |
| SV8 | P2 | White's Reality Check, Hansen SPA, StepM | losses `-r_i` against `-r_bh` on NQ hypotheses sharing a daily basis | daily series | arch `SPA`, `StepM` |

## 8. Trade analytics

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| TA1 | P0 | Trade stats tiles | win rate, profit factor, expectancy, average win and loss, payoff, max win and loss, n; mean net R and t from `summary` | `trades[].pnl_usd`, `summary` | Nautilus `WinRate`, `ProfitFactor`, `Expectancy`, `AvgWinner`, `AvgLoser`, `MaxWinner`, `MaxLoser` via `calculate_from_realized_pnls` [API verified; values to QA]; anchor `summary.hit_rate`, ledger `t_net_r` |
| TA2 | P1 | MAE and MFE scatter (against final P&L, coloured win or loss, in R where `r_pts` exists) | over 1m bars from the entry minute to the exit minute: `MAE = min(dir·(adverse extreme - entry_px))`, `MFE = max(dir·(favourable extreme - entry_px))`; intrabar order unknown, entry bar treated conservatively and labelled | trades plus gated 1m bars; intraday strategies only | three hand-built fixture trades; vectorised second implementation |
| TA3 | P0 | P&L by entry hour (ET), weekday, month | mean net P&L ± 95% t CI, n shown, `[POST HOC]` | trades | pandas groupby twice (two code paths) |
| TA4 | P1 | Holding time histogram (log x) | `exit_ts - entry_ts` | trades | direct |
| TA5 | P1 | Streaks | longest win and loss runs; Wald-Wolfowitz runs test | trades | quantstats `consecutive_wins`, `consecutive_losses` |
| TA6 | P0 | Fill slippage distribution | ticks (0.25 pt), positive adverse, by entry, close, stop: `results/quote_check_v1.json` (entry +0.72, close +1.0, stop -0.73) and live `slippage_ticks` from close rows. Backtest fills are modelled and get no slippage chart | as listed | recompute from the JSON rows |

## 9. Exposure and costs

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| EX1 | P0 | Gross and net exposure (stacked area per instrument for dtsmom) | `gross = Σ|N_i·pv_i·px_i| / E_t`; `net = Σ N_i·pv_i·px_i / E_t`, px the raw contract close: the sized books' `strategy_log.closes[].raw`, dtsmom's 1d vendor `c_none` through the gate. The snapshot px is back adjusted (it carries the cumulative roll gaps) and is used only for P&L: at that price volmanaged would show 4.1x against its 2x cap, at the raw close 1.63x (born-failing note) | `snapshots[].net_qty`, raw close; multipliers from `venue` | recompute from cumulative fill quantities |
| EX2 | P0 | Turnover | daily one-way `Σ|ΔN_i|·pv_i·px_i / E_t`; annualised mean × 252 | `fills` | fills path against snapshot differences |
| EX3 | P0 | Cost waterfall | gross, commissions, modelled slippage, net | `fees_total`, `fills.commission`, `data.cost_per_contract_side_usd`, ticks | totals equal `pnl_total` and `balance_check` |
| EX4 | P0 | Cost sensitivity (net P&L or alpha against ticks per side 0 to 4, break-even marker) | screens: `cost_ladder`, `break_even_ticks_per_side`, `stress_2tick_ge_0`. Nautilus runs: `net(τ) = gross - fees - τ·tick_value·sides` (linear) | screen JSONs, fills | anchor to `cost_ladder` |
| EX5 | P2 | Capacity | contracts per session / session volume | fills, 1d `v` | direct |

## 10. Regimes

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| RG1 | P1 | Volatility regimes | NQ 22-session RTH realised variance known at t-1 (reuse `sizing_rv`); terciles from expanding percentiles with at least 252 sessions of history (no look-ahead); per-regime Sharpe, mean, hit, n; Welch t high against low | gated NQ, daily r | scipy `ttest_ind(equal_var=False)` |
| RG2 | P2 | Trend regime (NQ above or below its 200-session mean) | same | same | same |

## 11. Market views (all end 2021-12-31)

| ID | Pri | Item | Definition | Inputs | QA reference |
|---|---|---|---|---|---|
| MV1 | P0 | Candles with volume (1m, 5m, 1h, 1d), fills overlaid, roll markers, fence | OHLCV bucket aggregation from the served frame (first o, max h, min l, last c, sum v) | `/api/bars`, `fills` | daily resample of 1m against the vendor 1d file on sampled days |
| MV2 | P0 | Roll-gap markers and table | at each `instrument_id` change: `gap_pts = offset_t - offset_{t-1}` in points, and `gap_pct = 100 * gap_pts /` the raw close of the bar before the roll (`c_none` in 1d files, `raw_c` in 1m files) | 1d `offset`, `instrument_id` | `results/qa_report_universe.json` roll counts |
| MV3 | P0 | Realised volatility | close to close `sd(log r, 22)·√252`; intraday `√(Σ r_1m²)·√252` per session | served bars | numpy |
| MV4 | P0 | 27-future return heatmap (1D, 1W, 1M, 3M, YTD, 12M; and vol-normalised) | `r_t = ΔB_t / (N_t - ΔB_t)`, B = `c_back`, N = `c_none` (the project's convention) [verified `dtsmom_panel.py`]. Never percent change of the back-adjusted series | 1d served frames | reuse the `dtsmom_panel` builder and compare |
| MV5 | P0 | Correlation matrix (252 sessions and full sample; average-linkage order on 1-ρ) | Pearson on MV4 returns, pairwise complete | MV4 | pandas `.corr` against `numpy.corrcoef`; `scipy.cluster.hierarchy` |
| MV6 | P2 | Term structure from roll gaps | front to next spread, annualised with contract months [month map unverified] | MV2 | none until data exists |

## 12. Research integrity

| ID | Pri | Item | Definition | Inputs |
|---|---|---|---|---|
| RI1 | P0 | Spec hash check | re-hash `experiments/*.json` (sha256) and compare with each result's `spec_sha256` and `registry.csv spec_sha_ok`; mismatch shows red. Born failing: a copied spec with one byte changed must fail | registry, experiments, screens |
| RI2 | P0 | OOS access log timeline | swimlanes by caller; each read's window drawn against the 2022-01-01 fence; sealed reads highlighted; openings with decided and closed times; `check_sealed_log_pin` and `check_openings_pin` status | `oos_access_log.jsonl`, `oos_openings.json` |
| RI3 | P0 | Ledger and anchors | ledger rows (10 today); anchor pairs match exactly on trades, P&L and Sharpe; `balance_check.ok`, `mtm.max_abs_diff_usd`, `coverage_check.ok`; `regress_check.json.identical` | `ledger.csv`, `backtests/output/*` |
| RI4 | P1 | Data quality calendar (gated, rejected, repaired, unrepairable days) | calendar heatmap | `qa_report*.json`, `repair_report.json`, `*_rejected_days.json` |
| RI5 | P1 | Guard fingerprint status | compare `results/guard_constants.json` with `nq_lab.guards` | same |

## 13. Live paper monitoring (read-only)

| ID | Pri | Item | Definition | Inputs |
|---|---|---|---|---|
| LV1 | P0 | Plumbing labelling | hatched rows under `paper_plumbing.BANNER`; performance uses `paper_plumbing.performance_rows` and `is_plumbing`, imported | `live/logs/*.jsonl` |
| LV2 | P0 | Target against actual (step lines) and reconciliation table | close rows: `target`, `n_star`, `expected`, `actual`, `reconciled`, `exposure`, `slippage_ticks` | journals |
| LV3 | P0 | Guard and state strip | `halted`, `blocked`, `refused`, `sent`; kill switch from `live_guards.kill_switch_on`; delayed flag set or not; age of last journal row and last log line | journals, logs, env |
| LV4 | P0 | Journal table, filter by file and type | raw rows, ns shown as ISO | journals |
| LV5 | P1 | Paper against model tracking | daily paper P&L from `actual × Δclose_px` against the backtest model for the same days | journals |

## 14. QA protocol (applied at every phase gate)

1. **Three-way agreement.** For every P0 scalar: the terminal's `analytics/` package, the Nautilus pyo3 statistic where one exists (fed a session index), and the independent library in `terminal/qa`. Tolerance 1e-9 relative for closed forms (1e-12 for the anchors below). Bootstrap results exact under a fixed seed.
2. **Anchors to the project's own files** (exact):
   - `volmanaged_v0_daily.csv r_m_1` Sharpe 0.9914875364356387 (stored 0.9914875364356394), `r_bh_1` 0.9946882195853758;
   - `dtsmom_v0_monthly.csv r_ts_1` Sharpe (√12) 0.25493487321272734, 120 months;
   - `volmanaged_v0.json` `years` 10.6587 and block alphas and t values;
   - ledger `t_net_r` equals `summary.t_net_r` for every ledgered run;
   - registry Bonferroni, Holm and BH columns;
   - equity from snapshots ends at `balance_check.final_usd`; realised curves end at `pnl_total`.
3. **Golden fixtures:** DSR paper example (0.1132, 0.9004); the C3 weekend-bias series, which must give the wrong Sharpe when fed the analyser path; three hand-computed MAE and MFE trades; a Cornish-Fisher case checked against PerformanceAnalytics; a 10-session hand-computed drawdown table.
4. **Born-failing checks (rule 5):** tampered spec hash (RI1); shifted anchor; a plumbing row reaching a performance series (LV1); a price read that bypasses the gate (AST ban); a wrong annualisation factor (√365) must fail the Sharpe anchor.
5. **Text check:** every label passes the house style lint (a local tool, not in this repo).

## Sources

- NautilusTrader 1.231.0 Rust statistics: `crates/analysis/src/statistic.rs`, `statistics/sharpe_ratio.rs`, `sortino_ratio.rs`, `cagr.rs`, `max_drawdown.rs`, `calmar_ratio.rs` (tag v1.231.0 on GitHub); `analysis/analyzer.py` and `tearsheet.py` in `.venv`.
- Bailey and López de Prado, The Deflated Sharpe Ratio (davidhbailey.com PDF; SSRN 2460551); The Sharpe Ratio Efficient Frontier (SSRN 1821643).
- Mertens, E. (2002), Comments on the variance of the IID estimator in Lo (2002), working paper; the same standard error appears in Bailey and López de Prado's PSR.
- quantstats (Apache-2.0), empyrical-reloaded (Apache-2.0), arch (NCSA), statsmodels (BSD-3, unverified), PerformanceAnalytics (GPL, R; used by hand only).
- Boudt, Peterson and Croux (2008), Estimation and decomposition of downside risk for portfolios with non-normal returns.
