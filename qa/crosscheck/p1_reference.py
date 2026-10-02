"""Reference values for the P1 dumps (TASKS Phase 10), recomputed with the QA environment's libraries.

Each dump kind maps to one function of its raw inputs. Libraries, and where they legitimately differ:
- PF7 Omega(0): empyrical `omega_ratio` (required return 0).
- PF8 tail ratio: empyrical `tail_ratio`; quantstats `tail_ratio` as a second exact reference.
- PF9 gain to pain: Basis A, quantstats `gain_to_pain_ratio(resolution="ME")` (month sums); Basis B compounds the
  months, which quantstats does not (its value is INFO), so the exact reference is pandas: compounded calendar months.
- RK3: independent scipy (population moments, `norm.ppf`, the expansion written out); the monotone domain is checked
  numerically on a dense grid of z (no closed form), against the terminal's closed-form discriminant. Outside the
  domain the shown value is RK1's historical VaR (pandas quantile), not the normal VaR.
- RD3: Filliben's order statistic medians written out with numpy and `norm.ppf`; the line from statsmodels OLS.
- RD4: statsmodels `jarque_bera`.
- RL3 and RL4: a window-by-window numpy loop (a window holding a benchmark gap is NaN); empyrical `roll_beta` as a
  second exact reference where the benchmark has no gap.
- BR3: empyrical `up_capture` and `down_capture` (geometric annualised, the Nautilus definition); BR4: statsmodels OLS.
- SV5 and SV6: arch `optimal_block_length` and `StationaryBootstrap(block, r, seed=seed)`, every statistic recomputed
  per arch replication with plain numpy, percentiles linear. Exact under the fixed seed (compared at 1e-9).
- SV3: scipy moments (bias=True, raw kurtosis) and the Bailey and Lopez de Prado formulas written out; the paper
  fixture is recomputed and rounded to 4 decimals; the null variance V0 (Mertens written out) and the leave-one-out
  variance (pandas, each trial left out in turn) as SV3a steps 5 and 9 define them.
- SV3b (the effective number of trials the route serves as `effective_n`): when each trial carries its session
  `dates`, the daily trials' common window by a pandas inner join, their Pearson correlation by pandas `corr` and by
  numpy `corrcoef`, the eigenvalues by `numpy.linalg.eigvalsh`, participation and Li and Ji as `p12_neff` writes them,
  the UPGMA clusters by scipy `linkage` ("average") and `fcluster` at 1 - rho = 0.5, and SR0 and every DSR under each
  N at V0 with the monthly books added to N (`p12_neff.expected_max_sr0` and `probabilistic_sharpe`). No key when
  the dates are missing, no trial is daily, the window is shorter than 252 sessions or a trial does not vary on it
  (the route serves a refusal then).
- TA2: a pandas second implementation of the same bar rule (whole bars count both extremes, bars the entry or exit
  falls inside count only the adverse one); TA4 pandas timedeltas; TA5 quantstats `consecutive_wins` and
  `consecutive_losses` on the P&L, statsmodels `runstest_1samp` (no continuity correction).
- RG1: pandas expanding quantiles looked up as of the session before, statsmodels `ttest_ind(usevar="unequal")`.
- RK5 and LV5: independent pandas.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from scipy import stats as sps
from scipy.cluster.hierarchy import linkage
from scipy.spatial.distance import squareform

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import empyrical as ep
    import quantstats.stats as qs
    import statsmodels.api as sm
    from arch.bootstrap import StationaryBootstrap, optimal_block_length
    from statsmodels.sandbox.stats.runs import runstest_1samp
    from statsmodels.stats.stattools import jarque_bera
    from statsmodels.stats.weightstats import ttest_ind

from crosscheck.p12_neff import (
    CLUSTER_CUT,
    clusters_at,
    expected_max_sr0,
    li_ji,
    participation_ratio,
    probabilistic_sharpe,
)
from crosscheck.reference import DOCUMENTED, Ref

TAILS = {"95": 0.05, "99": 0.01}
Z_GRID = np.linspace(-12, 12, 48001)
MINUTE = pd.Timedelta(minutes=1)
EULER = float(np.euler_gamma)
DAILY = 252
CONE_PERCENTILES = (5, 25, 50, 75, 95)


def _floats(values) -> np.ndarray:
    return np.array([math.nan if v is None else float(v) for v in values], dtype=float)


def _quiet(fn, *args, **kwargs):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


# ---------------------------------------------------------------- p1series


def _gain_to_pain(s: pd.Series, basis: str, periods: int) -> dict:
    if basis == "A":
        value = float(_quiet(qs.gain_to_pain_ratio, s, rf=0, resolution="ME"))
        return {"gain_to_pain": Ref(value, "quantstats.gain_to_pain_ratio(resolution='ME')")}
    months = (1.0 + s).groupby(s.index.to_period("M")).prod() - 1.0 if periods == DAILY else s
    pain = abs(months[months < 0].sum())
    return {"gain_to_pain": Ref(float(months.sum() / pain) if pain > 0 else math.nan,
                                "pandas: compounded calendar months, sum over the sum of losing months"),
            "gain_to_pain_quantstats": Ref(float(_quiet(qs.gain_to_pain_ratio, s, rf=0, resolution="ME")),
                                           "quantstats.gain_to_pain_ratio(resolution='ME')", DOCUMENTED,
                                           "quantstats sums the months even for compounded (Basis B) returns",
                                           "gain_to_pain")}


def cornish_fisher(r: np.ndarray, tail: float) -> tuple[float, float, bool]:
    """(normal VaR, raw Cornish-Fisher VaR, monotone on the grid) with population moments."""
    mu, sigma = float(np.mean(r)), float(np.std(r, ddof=0))
    s, k = float(sps.skew(r, bias=True)), float(sps.kurtosis(r, fisher=True, bias=True))
    z = float(sps.norm.ppf(tail))

    def q(x):
        return x + (x ** 2 - 1) * s / 6 + (x ** 3 - 3 * x) * k / 24 - (2 * x ** 3 - 5 * x) * s ** 2 / 36

    return -(mu + sigma * z), -(mu + sigma * q(z)), bool(np.all(np.diff(q(Z_GRID)) > 0))


def _risk(r: np.ndarray) -> dict:
    out = {}
    for level, tail in TAILS.items():
        normal, raw, inside = cornish_fisher(r, tail)
        src = "scipy population moments, Cornish-Fisher written out; domain by a dense grid of z"
        historical = float(-pd.Series(r).quantile(tail))
        out.update({f"var_normal_{level}": Ref(normal, src), f"var_cf_raw_{level}": Ref(raw, src),
                    f"cf_in_domain_{level}": Ref(float(inside), src),
                    f"var_historical_{level}": Ref(historical, "pandas quantile (linear), RK1"),
                    f"var_modified_{level}": Ref(raw if inside else historical,
                                                 src + "; outside the domain the historical VaR")})
    return out


def filliben(n: int) -> np.ndarray:
    m = np.empty(n)
    m[-1] = 0.5 ** (1.0 / n)
    m[0] = 1.0 - m[-1]
    i = np.arange(2, n)
    m[1:-1] = (i - 0.3175) / (n + 0.365)
    return sps.norm.ppf(m)


def _distribution(r: np.ndarray) -> dict:
    jb, p, _, _ = jarque_bera(r)
    theoretical = filliben(len(r))
    fit = sm.OLS(np.sort(r), sm.add_constant(theoretical)).fit()
    src = "Filliben medians (numpy) and statsmodels OLS"
    return {"jb_statistic": Ref(float(jb), "statsmodels jarque_bera"), "jb_p": Ref(float(p), "statsmodels jarque_bera"),
            "qq_theoretical": Ref(theoretical.tolist(), src), "qq_slope": Ref(float(fit.params[1]), src),
            "qq_intercept": Ref(float(fit.params[0]), src),
            "qq_r": Ref(float(np.corrcoef(theoretical, np.sort(r))[0, 1]), "numpy corrcoef")}


BAND_WINDOWS = {252: (63, 252), 12: (12, 36)}


def sharpe_bands(r: np.ndarray, periods: int, windows: tuple[int, ...] | None = None) -> dict:
    """RL1 band: full-sample Sharpe +/- z(0.975) x Mertens' error of a w-period Sharpe, moments written out."""
    m, sd = r.mean(), r.std(ddof=1)
    c = r - m
    g3 = float(np.mean(c ** 3) / np.mean(c ** 2) ** 1.5)
    g4 = float(np.mean(c ** 4) / np.mean(c ** 2) ** 2)
    sr, z = m / sd, float(sps.norm.ppf(0.975))
    src = "numpy population moments, Mertens written out, scipy norm.ppf(0.975)"
    out = {}
    for w in windows or BAND_WINDOWS[periods]:
        se = math.sqrt((1 - g3 * sr + (g4 - 1) / 4 * sr ** 2) / (w - 1)) * math.sqrt(periods)
        out[f"band_lo_{w}"] = Ref(float(sr * math.sqrt(periods) - z * se), src)
        out[f"band_hi_{w}"] = Ref(float(sr * math.sqrt(periods) + z * se), src)
    return out


def rolling_pair(r: np.ndarray, b: np.ndarray, window: int) -> tuple[list, list]:
    beta, corr = [], []
    for end in range(len(r)):
        lo = end - window + 1
        x, y = r[max(lo, 0):end + 1], b[max(lo, 0):end + 1]
        if lo < 0 or np.isnan(y).any():
            beta.append(None)
            corr.append(None)
            continue
        beta.append(float(np.cov(x, y, ddof=1)[0, 1] / np.var(y, ddof=1)))
        corr.append(float(np.corrcoef(x, y)[0, 1]))
    return beta, corr


def _period(periods: int) -> str:
    """empyrical's capture takes a period name, not a number: 'daily' is 252 and 'monthly' 12."""
    return "daily" if periods == DAILY else "monthly"


def _relative(r: np.ndarray, b: np.ndarray | None, periods: int, on_capital: bool) -> dict:
    if b is None:
        return {}
    window = 126 if periods == DAILY else 12
    beta, corr = rolling_pair(r, b, window)
    keep = ~np.isnan(b)
    fit = sm.OLS(r[keep], sm.add_constant(b[keep])).fit()
    out = {"rolling_beta": Ref(beta, f"numpy window loop, {window}"),
           "rolling_correlation": Ref(corr, f"numpy corrcoef window loop, {window}"),
           "scatter_slope": Ref(float(fit.params[1]), "statsmodels OLS"),
           "scatter_intercept": Ref(float(fit.params[0]), "statsmodels OLS")}
    if not np.isnan(b).any():
        rolled = np.asarray(_quiet(ep.roll_beta, r, b, window), dtype=float)
        out["rolling_beta_empyrical"] = Ref([None] * (window - 1) + rolled.tolist(), "empyrical.roll_beta",
                                            against="rolling_beta")
    if on_capital:
        out["up_capture"] = Ref(float(ep.up_capture(r[keep], b[keep], period=_period(periods))), "empyrical.up_capture")
        out["down_capture"] = Ref(float(ep.down_capture(r[keep], b[keep], period=_period(periods))),
                                  "empyrical.down_capture")
    return out


def p1series_references(inputs: dict) -> dict:
    r, periods, basis = _floats(inputs["r"]), int(inputs["periods"]), inputs["basis"]
    on_capital = bool(inputs["on_capital"])
    s = pd.Series(r, index=pd.DatetimeIndex(pd.to_datetime(inputs["dates"])))
    b = None if inputs.get("bench") is None else _floats(inputs["bench"])
    out = {"omega": Ref(float(ep.omega_ratio(r, required_return=0.0, annualization=periods)), "empyrical.omega_ratio"),
           "tail_ratio": Ref(float(ep.tail_ratio(r)), "empyrical.tail_ratio"),
           "tail_ratio_quantstats": Ref(float(_quiet(qs.tail_ratio, s, prepare_returns=False)),
                                        "quantstats.tail_ratio", against="tail_ratio")}
    out.update(_gain_to_pain(s, basis if on_capital else "A", periods))
    out.update(_risk(r))
    out.update(_distribution(r))
    out.update(sharpe_bands(r, periods))
    out.update(_relative(r, b, periods, on_capital))
    return out


# ---------------------------------------------------------------- bootstrap


def _replication_stats(x: np.ndarray, basis: str, periods: int) -> tuple[float, float, float]:
    sd = x.std(ddof=1)
    sharpe = x.mean() / sd * math.sqrt(periods) if sd > 0 else math.nan
    # Ruin is the path touching zero at any step (written as a plain loop, apart from the terminal's vectorised rule):
    # Basis A the running equity 1 + sum r, Basis B the compounded equity; ruin is absorbing, so CAGR is -1.
    equity, ruined = 1.0, False
    for value in x:
        equity = equity + value if basis == "A" else equity * (1.0 + value)
        ruined = ruined or equity <= 0.0
    growth = 1.0 + x.sum() if basis == "A" else float(np.prod(1.0 + x))
    cagr = -1.0 if ruined else growth ** (periods / len(x)) - 1.0
    if basis == "A":
        level = np.cumsum(x)
        under = level - np.maximum(0.0, np.maximum.accumulate(level))
    else:
        level = np.cumprod(1.0 + x)
        under = level / np.maximum(1.0, np.maximum.accumulate(level)) - 1.0
    return sharpe, cagr, min(0.0, float(under.min()))


def bootstrap_references(inputs: dict) -> dict:
    r, basis, periods = _floats(inputs["r"]), inputs["basis"], int(inputs["periods"])
    seed, reps, horizon = int(inputs["seed"]), int(inputs["reps"]), int(inputs["horizon"])
    tail = 50 * (1 - float(inputs["confidence"]))
    blocks = optimal_block_length(r)
    block = float(blocks["stationary"].iloc[0])
    src = f"arch StationaryBootstrap({block:.6g}, r, seed={seed}), {reps} replications, numpy per replication"
    rows, heads = [], []
    for data in StationaryBootstrap(block, r, seed=seed).bootstrap(reps):
        sample = data[0][0]
        rows.append(_replication_stats(sample, basis, periods))
        heads.append(sample[:horizon])
    stats = np.array(rows)
    out = {"block_stationary": Ref(block, "arch optimal_block_length"),
           "block_circular": Ref(float(blocks["circular"].iloc[0]), "arch optimal_block_length")}
    names = ("sharpe", "cagr", "max_drawdown") if inputs["on_capital"] else ("sharpe", "max_drawdown")
    for name in names:
        values = stats[:, ("sharpe", "cagr", "max_drawdown").index(name)]
        values = values[np.isfinite(values)]
        lo, mid, hi = np.percentile(values, [tail, 50, 100 - tail])
        if name == "cagr":
            out["cagr_ruin"] = Ref(float(np.sum(values == -1.0)), "replications whose book touches zero at any point")
        out.update({f"{name}_lo": Ref(float(lo), src), f"{name}_median": Ref(float(mid), src),
                    f"{name}_hi": Ref(float(hi), src)})
    paths = np.vstack(heads)
    summed = basis == "A" or not inputs["on_capital"]
    levels = np.cumsum(paths, axis=1) if summed else np.cumprod(1.0 + paths, axis=1) - 1.0
    for q in CONE_PERCENTILES:
        out[f"cone_{q}"] = Ref(np.percentile(levels, q, axis=0).tolist(), src)
    last = r[-horizon:]
    out["cone_realised"] = Ref((np.cumsum(last) if summed else np.cumprod(1.0 + last) - 1.0).tolist(),
                               "numpy, the last year of the series")
    return out


# ---------------------------------------------------------------- deflated


def expected_max(n: int, variance: float) -> float:
    return math.sqrt(variance) * ((1 - EULER) * sps.norm.ppf(1 - 1 / n) + EULER * sps.norm.ppf(1 - 1 / (n * math.e)))


def psr(sr: float, sr0: float, n: int, skew: float, kurt: float) -> float:
    return float(sps.norm.cdf((sr - sr0) * math.sqrt(n - 1) / math.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr ** 2)))


MIN_COMMON_SESSIONS = 252
ESTIMATORS = ("participation", "li_ji", "clusters")


def _pair_word(names: list[str], matrix: np.ndarray) -> dict:
    """The upper triangle with the diagonal as `a|b` keys: a flat dict the comparison already judges."""
    return {f"{a}|{b}": float(matrix[i][j]) for i, a in enumerate(names) for j, b in enumerate(names) if i <= j}


def average_tree(corr: np.ndarray) -> np.ndarray:
    """scipy's average linkage of the distance 1 - rho."""
    return linkage(squareform(1.0 - corr, checks=False), "average")


def neff_references(trials: list[dict], moments: dict, v0: float, sr0_null: float) -> dict:
    """SV3b from the trials' dates and returns (no key unless the route would serve a view, not a refusal)."""
    daily = [t for t in trials if int(t["periods"]) == DAILY and "dates" in t]
    if not daily or len(daily) != sum(1 for t in trials if int(t["periods"]) == DAILY):
        return {}
    panel = pd.concat([pd.Series(_floats(t["r"]), index=t["dates"], name=t["name"]) for t in daily], axis=1,
                      join="inner").sort_index()
    if len(panel) < MIN_COMMON_SESSIONS or bool((panel.nunique() < 2).any()):
        return {}
    names = list(panel.columns)
    corr = panel.corr().to_numpy()
    eig = np.linalg.eigvalsh(corr)[::-1]
    tree = average_tree(corr)
    groups = clusters_at(tree, CLUSTER_CUT)
    ranked = sorted(groups, key=lambda m: (-len(m), m[0]))
    monthly = sum(1 for t in trials if int(t["periods"]) != DAILY)
    n_daily = {"participation": participation_ratio(eig), "li_ji": li_ji(eig), "clusters": float(len(groups))}
    n_total = {k: v + monthly for k, v in n_daily.items()}
    sr0 = {k: expected_max_sr0(v0, n, EULER) for k, n in n_total.items()}
    src = "pandas inner join and corr, numpy eigvalsh, scipy linkage('average') and fcluster, SV3a closed forms"
    out = {"neff_window_sessions": Ref(float(len(panel)), "pandas inner join of the daily trials' session dates"),
           "neff_correlation": Ref(_pair_word(names, corr), "pandas DataFrame.corr (Pearson) on the common window"),
           "neff_correlation_numpy": Ref(_pair_word(names, np.corrcoef(panel.to_numpy(), rowvar=False)),
                                         "numpy corrcoef on the common window", against="neff_correlation"),
           "neff_eigenvalues": Ref([float(x) for x in eig], "numpy eigvalsh of the correlation, largest first"),
           "neff_participation": Ref(n_daily["participation"], src), "neff_li_ji": Ref(n_daily["li_ji"], src),
           "neff_clusters": Ref(";".join(",".join(names[i] for i in g) for g in ranked), src),
           "neff_n_total": Ref(n_total, src + ": N daily plus the monthly books"),
           "neff_sr0_session": Ref({"registered": sr0_null, **sr0}, src)}
    for key in ESTIMATORS:
        out[f"neff_dsr_{key}"] = Ref(
            {name: probabilistic_sharpe(m[0], sr0[key] * math.sqrt(DAILY / m[4]), m[1], m[2], m[3])
             for name, m in moments.items()}, src)
    return out


def deflated_references(inputs: dict) -> dict:
    trials = inputs["trials"]
    moments = {}
    for t in trials:
        r = _floats(t["r"])
        moments[t["name"]] = (float(r.mean() / r.std(ddof=1)), len(r), float(sps.skew(r, bias=True)),
                              float(sps.kurtosis(r, fisher=False, bias=True)), int(t["periods"]))
    session = {name: m[0] * math.sqrt(m[4] / DAILY) for name, m in moments.items()}
    variance = float(np.var(list(session.values()), ddof=1))
    sr0 = expected_max(len(trials), variance)
    dsr = {name: psr(m[0], sr0 * math.sqrt(DAILY / m[4]), m[1], m[2], m[3]) for name, m in moments.items()}
    # V0: the mean over trials of the Mertens sampling variance of SR at SR = 0 (1/(n - 1)), moved to sessions.
    v0 = float(np.mean([1 / (m[1] - 1) * m[4] / DAILY for m in moments.values()]))
    sr0_null = expected_max(len(trials), v0)
    dsr_null = {name: psr(m[0], sr0_null * math.sqrt(DAILY / m[4]), m[1], m[2], m[3]) for name, m in moments.items()}
    # Leave-one-out: a plain loop over the trials, the smallest V without one of them, N kept.
    names = list(session)
    loo = {name: float(pd.Series([session[k] for k in names if k != name]).var(ddof=1)) for name in names}
    drop = min(loo, key=loo.get)
    paper = inputs["paper"]
    p_sr0 = expected_max(int(paper["n_trials"]), float(paper["variance"]))
    src = "scipy moments (bias=True, raw kurtosis), Bailey and Lopez de Prado written out"
    neff = neff_references(trials, moments, v0, sr0_null)
    return {**neff, "n_trials": Ref(float(len(trials)), "len(trials)"), "variance": Ref(variance, src),
            "sr0_session": Ref(sr0, src), "sr0_annual": Ref(sr0 * math.sqrt(DAILY), src), "dsr": Ref(dsr, src),
            "sr_session": Ref(session, src), "variance_null": Ref(v0, src), "sr0_null_session": Ref(sr0_null, src),
            "sr0_null_annual": Ref(sr0_null * math.sqrt(DAILY), src), "dsr_null": Ref(dsr_null, src),
            "loo_variance": Ref({drop: loo[drop]}, "pandas var(ddof=1) without each trial in turn"),
            "loo_sr0_session": Ref({drop: expected_max(len(trials), loo[drop])}, "pandas, N kept"),
            "paper_sr0": Ref(round(p_sr0, 4), "the paper example, recomputed"),
            "paper_dsr": Ref(round(psr(float(paper["sr"]), p_sr0, int(paper["t"]), float(paper["skew"]),
                                       float(paper["kurt"])), 4), "the paper example, recomputed")}


# ---------------------------------------------------------------- paths


def _off_bars(stamp: pd.Timestamp, px: float, bars: pd.DataFrame, tick: float) -> float | None:
    """1.0 when a fill lies more than a tick outside every bar opening in [stamp - 1 min, stamp], None without one."""
    near = bars[(bars["ts"] >= stamp - MINUTE) & (bars["ts"] <= stamp)]
    if near.empty:
        return None
    return float(px < near["l"].min() - tick * (1 + 1e-9) or px > near["h"].max() + tick * (1 + 1e-9))


def excursion(trade: dict, bars: pd.DataFrame, tick: float) -> tuple[float, float, int, float]:
    """MAE, MFE, whole bars and the off-basis flag, written out with pandas masks (the catalogue's TA2 rules)."""
    entry, exit_ = pd.Timestamp(trade["entry_ts"]), pd.Timestamp(trade["exit_ts"])
    d, px = int(trade["direction"]), float(trade["entry_px"])
    final = d * (float(trade["exit_px"]) - px)
    reason = trade.get("reason")
    opens, closes = bars["ts"], bars["ts"] + MINUTE
    touched = (closes > entry) & (opens < exit_)
    exit_bar = touched & (opens >= exit_ - MINUTE)
    whole = (opens >= entry) & (closes <= exit_) & ~(exit_bar & (reason in ("stop", "target")))
    counted = touched & ~exit_bar if reason == "stop" else touched
    adverse = (bars["l"] - px) if d == 1 else -(bars["h"] - px)
    favourable = (bars["h"] - px) if d == 1 else -(bars["l"] - px)
    mae = min([0.0, final] + adverse[counted].tolist())
    mfe = max([0.0, final] + favourable[whole].tolist())
    flags = [f for f in (_off_bars(entry, px, bars, tick), _off_bars(exit_, float(trade["exit_px"]), bars, tick))
             if f is not None]
    return float(mae), float(mfe), int(whole.sum()), float(max(flags)) if flags else 0.0


def paths_references(inputs: dict) -> dict:
    bars = pd.DataFrame({"ts": pd.to_datetime(inputs["bars"]["ts"], utc=True), "h": _floats(inputs["bars"]["h"]),
                         "l": _floats(inputs["bars"]["l"])})
    found = [excursion(t, bars, float(inputs["tick"])) for t in inputs["trades"]]
    everything = inputs["all_trades"]
    minutes = [(pd.Timestamp(t["exit_ts"]) - pd.Timestamp(t["entry_ts"])) / MINUTE for t in everything]
    pnl = pd.Series(_floats([t["pnl_usd"] for t in everything]))
    nonzero = pnl[pnl != 0].to_numpy()
    src = "pandas second implementation of the TA2 bar rule"
    out = {"mae_pts": Ref([f[0] for f in found], src), "mfe_pts": Ref([f[1] for f in found], src),
           "whole_bars": Ref([float(f[2]) for f in found], src),
           "off_basis": Ref([f[3] for f in found], "pandas masks over the bars around each fill, one tick of slack"),
           "holding_minutes": Ref([float(m) for m in minutes], "pandas Timedelta"),
           "holding_median": Ref(float(np.median(minutes)), "numpy median"),
           "longest_win": Ref(float(qs.consecutive_wins(pnl, prepare_returns=False)), "quantstats.consecutive_wins"),
           "longest_loss": Ref(float(qs.consecutive_losses(pnl, prepare_returns=False)),
                               "quantstats.consecutive_losses"),
           "runs": Ref(float(1 + np.count_nonzero(np.diff(nonzero > 0))), "numpy sign changes")}
    if (nonzero > 0).any() and (nonzero < 0).any():
        z, p = runstest_1samp((nonzero > 0).astype(float), cutoff=0.5, correction=False)
        out.update(runs_z=Ref(float(z), "statsmodels runstest_1samp(correction=False)"),
                   runs_p=Ref(float(p), "statsmodels runstest_1samp(correction=False)"))
    return out


# ---------------------------------------------------------------- regimes, stress, tracking


def regimes_references(inputs: dict) -> dict:
    dates = pd.DatetimeIndex(pd.to_datetime(inputs["dates"]))
    r = pd.Series(_floats(inputs["r"]), index=dates)
    rv = pd.Series(_floats(inputs["rv"]), index=pd.DatetimeIndex(pd.to_datetime(inputs["rv_dates"])))
    lo_q, hi_q = rv.expanding().quantile(1 / 3), rv.expanding().quantile(2 / 3)
    count = rv.expanding().count()
    labels = []
    for t in dates:
        before = rv.index[rv.index < t]
        if len(before) == 0 or count[before[-1]] < inputs["min_history"]:
            labels.append(None)
            continue
        x, lo, hi = rv[before[-1]], lo_q[before[-1]], hi_q[before[-1]]
        labels.append(0.0 if x <= lo else 2.0 if x > hi else 1.0)
    codes = pd.Series(labels, index=dates, dtype=float)
    src = "pandas expanding quantiles as of the session before"
    out = {"labels": Ref(labels, src), "unlabelled": Ref(float(codes.isna().sum()), src)}
    for code, name in ((0.0, "low"), (1.0, "mid"), (2.0, "high")):
        part = r[codes == code]
        nonzero = (part != 0).sum()
        out.update({f"{name}_n": Ref(float(len(part)), src), f"{name}_mean": Ref(float(part.mean()), src),
                    f"{name}_sharpe": Ref(float(part.mean() / part.std(ddof=1) * math.sqrt(DAILY)), src),
                    f"{name}_hit_rate": Ref(float((part > 0).sum() / nonzero), src)})
    t, _, _ = ttest_ind(r[codes == 2.0].to_numpy(), r[codes == 0.0].to_numpy(), usevar="unequal")
    out["welch_t"] = Ref(float(t), "statsmodels ttest_ind(usevar='unequal')")
    return out


def _window_total(x: pd.Series, basis: str):
    if not len(x):
        return None
    return float(x.sum()) if basis == "A" else float((1.0 + x).prod() - 1.0)


def _window_mdd(x: pd.Series, basis: str):
    if not len(x):
        return None
    if basis == "A":
        level = x.cumsum()
        under = level - level.clip(lower=0.0).cummax()
    else:
        level = (1.0 + x).cumprod()
        under = level / level.clip(lower=1.0).cummax() - 1.0
    return min(0.0, float(under.min()))


def stress_references(inputs: dict) -> dict:
    dates = pd.DatetimeIndex(pd.to_datetime(inputs["dates"]))
    r = pd.Series(_floats(inputs["r"]), index=dates)
    b = None if inputs.get("bench") is None else pd.Series(_floats(inputs["bench"]), index=dates)
    basis, out, src = inputs["basis"], {}, "pandas over the window's sessions (after the peak, to the trough)"
    monthly = int(inputs.get("periods", DAILY)) == 12
    if monthly:
        src = "pandas: the months holding a weekday after the peak up to the trough"
    for i, w in enumerate(inputs["windows"]):
        if monthly:
            weekdays = pd.bdate_range(pd.Timestamp(w["peak"]) + pd.Timedelta(days=1), w["trough"])
            wanted = {(d.year, d.month) for d in weekdays}
            inside = np.array([(d.year, d.month) in wanted for d in dates], dtype=bool)
        else:
            inside = np.asarray((dates > pd.Timestamp(w["peak"])) & (dates <= pd.Timestamp(w["trough"])))
        held = dates[inside]
        out.update({f"w{i}_first": Ref(float(held[0].strftime("%Y%m%d")) if len(held) else None, src),
                    f"w{i}_last": Ref(float(held[-1].strftime("%Y%m%d")) if len(held) else None, src)})
        out.update({f"w{i}_n": Ref(float(inside.sum()), src),
                    f"w{i}_strategy": Ref(_window_total(r[inside], basis), src),
                    f"w{i}_bench": Ref(None if b is None else _window_total(b[inside].dropna(), basis), src),
                    f"w{i}_mdd": Ref(_window_mdd(r[inside], basis), src)})
    return out


def _held_move(held, before: dict, after: dict, mult: float):
    if not isinstance(held, dict):
        return None
    total = 0.0
    for contract, qty in held.items():
        if qty == 0:
            continue
        if contract not in before or contract not in after or before[contract] is None or after[contract] is None:
            return None
        total += qty * (after[contract] - before[contract]) * mult
    return total


def tracking_references(inputs: dict) -> dict:
    mult = float(inputs["multiplier"])
    closes = [row for row in inputs["rows"] if row.get("type") == "close"]
    paper, model = [], []
    for before, after in zip(closes, closes[1:]):
        p0 = before.get("close_px_by_contract") if isinstance(before.get("close_px_by_contract"), dict) else {}
        p1 = after.get("close_px_by_contract") if isinstance(after.get("close_px_by_contract"), dict) else {}
        p = _held_move(before.get("actual"), p0, p1, mult)
        target, contract = before.get("target"), before.get("contract")
        m = None if target is None else _held_move({contract: target}, p0, p1, mult)
        both = p is not None and m is not None
        paper.append(p if both else None)
        model.append(m if both else None)
    diff = [p - m if p is not None else None for p, m in zip(paper, model)]
    kept = pd.Series([d for d in diff if d is not None], dtype=float)
    src = "pandas second implementation (held contracts at their own closes; target on the previous contract)"
    return {"paper": Ref(paper, src), "model": Ref(model, src), "difference": Ref(diff, src),
            "n": Ref(float(len(kept)), src), "total_difference": Ref(float(kept.sum()), src),
            "tracking_sd": Ref(float(kept.std(ddof=1)) if len(kept) > 1 else math.nan, src)}


P1_REFERENCES = {"p1series": p1series_references, "bootstrap": bootstrap_references,
                 "deflated": deflated_references, "paths": paths_references, "regimes": regimes_references,
                 "stress": stress_references, "tracking": tracking_references}
