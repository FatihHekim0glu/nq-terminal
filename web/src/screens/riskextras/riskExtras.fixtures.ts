// Risk extras bodies from the fixture backend (backend/tests/fixtures through the production app with the
// risk extras router; captured 2026-09-27): volmanaged_v0 at 1 tick (Basis A, outside the Cornish-Fisher domain,
// Treynor against its same-exposure buy and hold) and the run nt_volmanaged_v0_fixture_m1 (Basis B, no benchmark).
// IN_DOMAIN is the hypothesis body with its 95% row moved inside the domain and its 99% row floored, and INVERSE has
// an ES below zero, so every branch of the RK4 table has a case.
import type { RiskExtrasView } from './types'

export const HYP_RISK_EXTRAS: RiskExtrasView = {
  "context": {
    "kind": "hypothesis",
    "name": "volmanaged_v0",
    "cost": 1,
    "freq": "D"
  },
  "basis": "A",
  "unit": "fraction of K",
  "periods_per_year": 252,
  "n": 39,
  "tag": "[POST HOC]",
  "descriptive": "descriptive, in sample, computed by the terminal; not a registered test and never a verdict",
  "drawdown_tiles": [
    {
      "key": "ulcer_index",
      "label": "Ulcer index",
      "value": 0.04393028150937359,
      "unit": "fraction of K below the running peak",
      "basis": "A",
      "tag": "[POST HOC]",
      "note": null
    },
    {
      "key": "recovery_factor",
      "label": "Recovery factor",
      "value": -0.8431248946879083,
      "unit": "ratio, total return over the deepest drawdown",
      "basis": "A",
      "tag": "[POST HOC]",
      "note": null
    }
  ],
  "modified_es": {
    "basis": "A",
    "unit": "fraction of K",
    "horizon": "1 session",
    "mean": -0.0020515284615384593,
    "sigma": 0.008644955660213009,
    "skew": -0.38660594249908553,
    "excess_kurtosis": -0.41370910485752166,
    "domain": "modified ES rests on the Cornish-Fisher quantile, which is a quantile only where its expansion rises in z (RK3's domain: a = K/8 - S^2/6 > 0 and b^2 - 4ac <= 0 with b = S/3, c = 1 - K/8 + 5 S^2/36; at S = 0: 0 <= K <= 8); outside it, or where the ES falls below zero, the value is not defined and the tile shows the historical CVaR (RK1) beside it, the Gaussian ES greyed. Where the Edgeworth tail mean lies above the quantile the ES is floored at the modified VaR (PerformanceAnalytics' operational rule)",
    "levels": [
      {
        "level": "95",
        "tail": 0.05,
        "z": -1.6448536269514729,
        "cf_quantile": -1.760290781800536,
        "edgeworth_mean": -2.1293523842919964,
        "gaussian": 0.019883589222193646,
        "historical": 0.02017525,
        "raw_expansion": 0.02045968540871162,
        "modified": null,
        "value": 0.02017525,
        "in_domain": false,
        "floored": false,
        "method": "not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the historical CVaR (RK1) is shown beside it, the Gaussian ES only greyed"
      },
      {
        "level": "99",
        "tail": 0.01,
        "z": -2.3263478740408408,
        "cf_quantile": -2.4576561932677228,
        "edgeworth_mean": -2.8189726177092096,
        "gaussian": 0.025092187221397156,
        "historical": 0.020895,
        "raw_expansion": 0.026421421748989173,
        "modified": null,
        "value": 0.020895,
        "in_domain": false,
        "floored": false,
        "method": "not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the historical CVaR (RK1) is shown beside it, the Gaussian ES only greyed"
      }
    ]
  },
  "treynor": {
    "tile": {
      "key": "treynor",
      "label": "Treynor (CAGR / beta)",
      "value": -0.41474465927320225,
      "unit": "ratio, CAGR (fraction per year) over beta",
      "basis": "A",
      "tag": "[POST HOC]",
      "note": null
    },
    "cagr": -0.4165759324636533,
    "beta": 1.0044154231995661,
    "n_pairs": 39,
    "bench_label": "same-exposure buy and hold (r_bh_1)",
    "note": "CAGR on Basis A is (1 + summed return)^(P / n) - 1; Nautilus compounds instead"
  }
}

export const RUN_RISK_EXTRAS: RiskExtrasView = {
  "context": {
    "kind": "run",
    "name": "nt_volmanaged_v0_fixture_m1",
    "cost": null,
    "freq": "D"
  },
  "basis": "B",
  "unit": "fraction of the account",
  "periods_per_year": 252,
  "n": 10,
  "tag": "[POST HOC]",
  "descriptive": "descriptive, in sample, computed by the terminal; not a registered test and never a verdict",
  "drawdown_tiles": [
    {
      "key": "ulcer_index",
      "label": "Ulcer index",
      "value": 0.0018861022262857538,
      "unit": "fraction below the running peak, compounded",
      "basis": "B",
      "tag": "[POST HOC]",
      "note": null
    },
    {
      "key": "recovery_factor",
      "label": "Recovery factor",
      "value": -1.0,
      "unit": "ratio, total return over the deepest drawdown",
      "basis": "B",
      "tag": "[POST HOC]",
      "note": null
    }
  ],
  "modified_es": {
    "basis": "B",
    "unit": "fraction of the account",
    "horizon": "1 session",
    "mean": -0.00035817612007459364,
    "sigma": 0.0009271252223135588,
    "skew": -0.3177431075971437,
    "excess_kurtosis": 0.02277873838493738,
    "domain": "modified ES rests on the Cornish-Fisher quantile, which is a quantile only where its expansion rises in z (RK3's domain: a = K/8 - S^2/6 > 0 and b^2 - 4ac <= 0 with b = S/3, c = 1 - K/8 + 5 S^2/36; at S = 0: 0 <= K <= 8); outside it, or where the ES falls below zero, the value is not defined and the tile shows the historical CVaR (RK1) beside it, the Gaussian ES greyed. Where the Edgeworth tail mean lies above the quantile the ES is floored at the modified VaR (PerformanceAnalytics' operational rule)",
    "levels": [
      {
        "level": "95",
        "tail": 0.05,
        "z": -1.6448536269514729,
        "cf_quantile": -1.7328183986763042,
        "edgeworth_mean": -2.2112913342731138,
        "gaussian": 0.0022705691903039406,
        "historical": 0.0021764333487168663,
        "raw_expansion": 0.0024083200899626,
        "modified": null,
        "value": 0.0021764333487168663,
        "in_domain": false,
        "floored": false,
        "method": "not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the historical CVaR (RK1) is shown beside it, the Gaussian ES only greyed"
      },
      {
        "level": "99",
        "tail": 0.01,
        "z": -2.3263478740408408,
        "cf_quantile": -2.5273194557543053,
        "edgeworth_mean": -2.971684575141457,
        "gaussian": 0.002829163446625959,
        "historical": 0.0021764333487168663,
        "raw_expansion": 0.0031132998424483905,
        "modified": null,
        "value": 0.0021764333487168663,
        "in_domain": false,
        "floored": false,
        "method": "not defined: skewness and kurtosis are outside the region where the expansion is a quantile; the historical CVaR (RK1) is shown beside it, the Gaussian ES only greyed"
      }
    ]
  },
  "treynor": {
    "tile": {
      "key": "treynor",
      "label": "Treynor (CAGR / beta)",
      "value": null,
      "unit": "ratio, CAGR (fraction per year) over beta",
      "basis": "B",
      "tag": "[POST HOC]",
      "note": "no benchmark for this series"
    },
    "cagr": null,
    "beta": null,
    "n_pairs": 0,
    "bench_label": null,
    "note": "no benchmark for this series"
  }
}

const [HYP_95, HYP_99] = HYP_RISK_EXTRAS.modified_es.levels as readonly [RiskExtrasView['modified_es']['levels'][number], RiskExtrasView['modified_es']['levels'][number]]
const INSIDE = 'modified ES (Cornish-Fisher quantile, Edgeworth tail mean; inside the monotone domain)'

export const IN_DOMAIN: RiskExtrasView = {
  ...HYP_RISK_EXTRAS,
  modified_es: {
    ...HYP_RISK_EXTRAS.modified_es,
    levels: [
      { ...HYP_95, in_domain: true, modified: 0.0213, value: 0.0213, raw_expansion: 0.0213, method: INSIDE },
      { ...HYP_99, in_domain: true, floored: true, modified: 0.0301, value: 0.0301, raw_expansion: 0.0301, method: INSIDE },
    ],
  },
}

export const INVERSE: RiskExtrasView = {
  ...HYP_RISK_EXTRAS,
  modified_es: {
    ...HYP_RISK_EXTRAS.modified_es,
    levels: [{ ...HYP_95, in_domain: true, modified: null, raw_expansion: -0.004, method: 'not defined: the modified ES is below zero (inverse risk, where PerformanceAnalytics returns NA); the historical CVaR (RK1) is shown beside it' }],
  },
}
