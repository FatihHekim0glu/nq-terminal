// Fixture responses for the P2 panels (RG2, EX5, MV6), captured from the backend's own routes on 2026-09-27: the trend
// view from the real volmanaged_v0 screen series against the tests' synthetic NQ closes (session arrays cut to 24
// rows), the monthly dtsmom_v0 book (no view), the capacity of the fixture dtsmom run against synthetic volume, and
// CL's term structure from the synthetic calendar chain (session arrays cut to the last 24). Synthetic prices: the
// numbers exercise the panels, they are not market facts. Typed as the response interfaces, so `tsc -b` checks the
// captured payloads against them field for field.
import type { RunCapacity, TermStructure, TrendRegimeView } from './types'

export const TREND_VIEW: TrendRegimeView = {
  "context": {
    "kind": "hypothesis",
    "name": "volmanaged_v0",
    "cost": 1,
    "freq": "D"
  },
  "tag": "[POST HOC]",
  "label": "trend regime: NQ's back-adjusted close at the session before, above or below the mean of its last 200 session closes; descriptive, in-sample, not a registered test",
  "basis": "NQ 1d vendor c_back through the OOS gate, as of each NYSE session (dtsmom_panel rule); the close and its 200-session simple mean at the session before each return",
  "source": "NQ.V.0 1d vendor, back-adjusted close, through the gate (caller terminal)",
  "unit": "fraction of K",
  "window": 200,
  "available": true,
  "note": null,
  "rows": [
    {
      "regime": "above",
      "n": 2478,
      "mean": 0.0007507196771589989,
      "sharpe": 1.2633203733585103,
      "hit_rate": 0.5685957102387698
    },
    {
      "regime": "below",
      "n": 208,
      "mean": -0.0012480649038461554,
      "sharpe": -1.8694276697616188,
      "hit_rate": 0.4855769230769231
    }
  ],
  "welch_t": 2.6338320614532003,
  "welch_df": 235.36023048848836,
  "unlabelled": 0,
  "t": [1328054400, 1328140800, 1328227200, 1328486400, 1328572800, 1328659200, 1328745600, 1328832000, 1329091200, 1329177600, 1329264000, 1329350400, 1329436800, 1329782400, 1329868800, 1329955200, 1330041600, 1330300800, 1330387200, 1330473600, 1330560000, 1330646400, 1330905600, 1330992000],
  "date": ["2012-02-01", "2012-02-02", "2012-02-03", "2012-02-06", "2012-02-07", "2012-02-08", "2012-02-09", "2012-02-10", "2012-02-13", "2012-02-14", "2012-02-15", "2012-02-16", "2012-02-17", "2012-02-21", "2012-02-22", "2012-02-23", "2012-02-24", "2012-02-27", "2012-02-28", "2012-02-29", "2012-03-01", "2012-03-02", "2012-03-05", "2012-03-06"],
  "regime": ["above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above", "above"],
  "close": [2900.25, 2864.5, 2801.0, 2823.5, 2824.25, 2846.25, 2827.0, 2823.25, 2873.25, 2958.0, 2907.25, 2894.5, 2935.75, 2952.0, 3021.25, 3055.75, 3091.0, 3014.25, 3120.75, 3089.75, 3028.75, 3078.75, 3069.5, 3034.0],
  "mean_close": [2670.39625, 2672.8875, 2674.6825, 2676.52, 2678.155, 2680.03375, 2681.14875, 2681.96625, 2682.8875, 2684.36125, 2685.54, 2686.16625, 2687.00125, 2687.92, 2689.1425, 2690.8925, 2692.74875, 2694.68125, 2696.8, 2699.09375, 2701.10375, 2703.6875, 2706.17875, 2708.63125],
  "gate": {
    "caller": "terminal",
    "served_years": [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021],
    "cached": false,
    "reads_this_process": 1
  }
}

export const TREND_MONTHLY: TrendRegimeView = {
  "context": {
    "kind": "hypothesis",
    "name": "dtsmom_v0",
    "cost": 1,
    "freq": "D"
  },
  "tag": "[POST HOC]",
  "label": "trend regime: NQ's back-adjusted close at the session before, above or below the mean of its last 200 session closes; descriptive, in-sample, not a registered test",
  "basis": "NQ 1d vendor c_back through the OOS gate, as of each NYSE session (dtsmom_panel rule); the close and its 200-session simple mean at the session before each return",
  "source": "NQ.V.0 1d vendor, back-adjusted close, through the gate (caller terminal)",
  "unit": "fraction of K",
  "window": 200,
  "available": false,
  "note": "trend regimes are a daily view; a monthly book has none",
  "rows": [],
  "welch_t": null,
  "welch_df": null,
  "unlabelled": 0,
  "t": [],
  "date": [],
  "regime": [],
  "close": [],
  "mean_close": [],
  "gate": null
}

export const RUN_CAPACITY: RunCapacity = {
  "run_id": "nt_dtsmom_v0_fixture_ts1",
  "tag": "[POST HOC]",
  "label": "capacity: contracts traded per session over that session's volume (the vendor 1d bar of the continuous series); descriptive, in-sample",
  "basis": "contracts per session (every fill side; one contract at each trade's entry and exit when a run has no fills) over the vendor 1d volume of the continuous series on that session, New York dates",
  "unit": "fraction of the session's volume (0.01 is 1%)",
  "source": "fills",
  "instruments": [
    {
      "instrument": "ES.XCME",
      "symbol": "ES.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "NQ.XCME",
      "symbol": "NQ.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "YM.XCME",
      "symbol": "YM.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZT.XCME",
      "symbol": "ZT.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZF.XCME",
      "symbol": "ZF.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZN.XCME",
      "symbol": "ZN.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZB.XCME",
      "symbol": "ZB.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6E.XCME",
      "symbol": "6E.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6J.XCME",
      "symbol": "6J.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6B.XCME",
      "symbol": "6B.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6A.XCME",
      "symbol": "6A.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6C.XCME",
      "symbol": "6C.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "6S.XCME",
      "symbol": "6S.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "CL.XCME",
      "symbol": "CL.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "NG.XCME",
      "symbol": "NG.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "HO.XCME",
      "symbol": "HO.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "RB.XCME",
      "symbol": "RB.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "GC.XCME",
      "symbol": "GC.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "SI.XCME",
      "symbol": "SI.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "HG.XCME",
      "symbol": "HG.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZC.XCME",
      "symbol": "ZC.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZS.XCME",
      "symbol": "ZS.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZW.XCME",
      "symbol": "ZW.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZL.XCME",
      "symbol": "ZL.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "ZM.XCME",
      "symbol": "ZM.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "LE.XCME",
      "symbol": "LE.V.0",
      "factor": 1.0,
      "note": null
    },
    {
      "instrument": "HE.XCME",
      "symbol": "HE.V.0",
      "factor": 1.0,
      "note": null
    }
  ],
  "rows": [
    {
      "symbol": "CL.V.0",
      "sessions": 3,
      "sessions_with_volume": 3,
      "void": 0,
      "contracts_total": 24.0,
      "contracts_mean": 8.0,
      "ratio_mean": 6.68511859045879e-05,
      "ratio_median": 5.790332075544533e-05,
      "ratio_p95": 9.205024597537122e-05,
      "ratio_max": 9.584434877758521e-05,
      "ratio_max_date": "2012-01-23",
      "volume_median": 125203.0
    },
    {
      "symbol": "ES.V.0",
      "sessions": 2,
      "sessions_with_volume": 2,
      "void": 0,
      "contracts_total": 20.0,
      "contracts_mean": 10.0,
      "ratio_mean": 8.350144834915245e-05,
      "ratio_median": 8.350144834915245e-05,
      "ratio_p95": 8.71606318837252e-05,
      "ratio_max": 8.756720783201107e-05,
      "ratio_max_date": "2012-01-24",
      "volume_median": 120043.0
    },
    {
      "symbol": "GC.V.0",
      "sessions": 3,
      "sessions_with_volume": 3,
      "void": 0,
      "contracts_total": 8.0,
      "contracts_mean": 2.6666666666666665,
      "ratio_mean": 1.9526360586075233e-05,
      "ratio_median": 2.371279067929241e-05,
      "ratio_p95": 2.647121346255228e-05,
      "ratio_max": 2.6777704882914486e-05,
      "ratio_max_date": "2012-01-03",
      "volume_median": 126514.0
    },
    {
      "symbol": "ZN.V.0",
      "sessions": 2,
      "sessions_with_volume": 2,
      "void": 0,
      "contracts_total": 10.0,
      "contracts_mean": 5.0,
      "ratio_mean": 4.137778372598406e-05,
      "ratio_median": 4.137778372598406e-05,
      "ratio_p95": 4.690978456978686e-05,
      "ratio_max": 4.752445133020939e-05,
      "ratio_max_date": "2012-01-17",
      "volume_median": 123564.5
    }
  ],
  "worst": [
    {
      "date": "2012-01-23",
      "symbol": "CL.V.0",
      "contracts": 12.0,
      "volume": 125203.0,
      "ratio": 9.584434877758521e-05
    },
    {
      "date": "2012-01-24",
      "symbol": "ES.V.0",
      "contracts": 10.0,
      "volume": 114198.0,
      "ratio": 8.756720783201107e-05
    },
    {
      "date": "2012-01-03",
      "symbol": "ES.V.0",
      "contracts": 10.0,
      "volume": 125888.0,
      "ratio": 7.943568886629384e-05
    },
    {
      "date": "2012-01-03",
      "symbol": "CL.V.0",
      "contracts": 6.0,
      "volume": 103621.0,
      "ratio": 5.790332075544533e-05
    },
    {
      "date": "2012-01-17",
      "symbol": "ZN.V.0",
      "contracts": 5.0,
      "volume": 105209.0,
      "ratio": 4.752445133020939e-05
    },
    {
      "date": "2012-01-24",
      "symbol": "CL.V.0",
      "contracts": 6.0,
      "volume": 128189.0,
      "ratio": 4.6805888180733133e-05
    },
    {
      "date": "2012-01-20",
      "symbol": "ZN.V.0",
      "contracts": 5.0,
      "volume": 141920.0,
      "ratio": 3.5231116121758736e-05
    },
    {
      "date": "2012-01-03",
      "symbol": "GC.V.0",
      "contracts": 4.0,
      "volume": 149378.0,
      "ratio": 2.6777704882914486e-05
    },
    {
      "date": "2012-01-24",
      "symbol": "GC.V.0",
      "contracts": 3.0,
      "volume": 126514.0,
      "ratio": 2.371279067929241e-05
    },
    {
      "date": "2012-01-12",
      "symbol": "GC.V.0",
      "contracts": 1.0,
      "volume": 123631.0,
      "ratio": 8.088586196018798e-06
    }
  ],
  "max_ratio": 9.584434877758521e-05,
  "max_symbol": "CL.V.0",
  "gate": {
    "caller": "terminal",
    "served_years": [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021],
    "cached": false,
    "reads_this_process": 4
  }
}

export const TERM_CL: TermStructure = {
  "root": "CL",
  "symbol": "CL.V.0",
  "sector": "energy",
  "units": "USD per barrel",
  "tag": "[POST HOC]",
  "label": "term structure: the front and next calendar-chain contracts on each session, their spread annualised by the days between their pinned CME expiries; descriptive, in-sample, not a registered test",
  "basis": "C.0 and C.1 closes on the same session (unadjusted, 1d, through the OOS gate); carry = (F1 - F2) / (F2 x tau), tau = days between the pinned CME expiries / 365.25 (nq_lab.carry_signal.carry_value)",
  "unit": "carry: fraction per year (0.01 is 1% a year), positive in backwardation; spread in the root's units",
  "expiry_source": "nq_lab.carry_expiry.last_trading_day (the pinned CME last trading day table)",
  "ranks": [0, 1, 2, 3],
  "sessions": 2958,
  "fenced": 0,
  "void": {
    "missing_front": 0,
    "missing_next": 0,
    "unresolved": 1,
    "order": 0,
    "thin": 1,
    "price": 0
  },
  "summary": {
    "n": 2956,
    "mean": 0.020049521836448512,
    "median": 0.020049403046521155,
    "min": 0.020030711014833568,
    "max": 0.020069232671227528,
    "share_backwardation": 1.0,
    "last": 0.020058211373184455,
    "last_date": "2021-12-31"
  },
  "t": [1638230400, 1638316800, 1638403200, 1638489600, 1638748800, 1638835200, 1638921600, 1639008000, 1639094400, 1639353600, 1639440000, 1639526400, 1639612800, 1639699200, 1639958400, 1640044800, 1640131200, 1640217600, 1640304000, 1640563200, 1640649600, 1640736000, 1640822400, 1640908800],
  "date": ["2021-11-30", "2021-12-01", "2021-12-02", "2021-12-03", "2021-12-06", "2021-12-07", "2021-12-08", "2021-12-09", "2021-12-10", "2021-12-13", "2021-12-14", "2021-12-15", "2021-12-16", "2021-12-17", "2021-12-20", "2021-12-21", "2021-12-22", "2021-12-23", "2021-12-24", "2021-12-27", "2021-12-28", "2021-12-29", "2021-12-30", "2021-12-31"],
  "front": ["CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLF2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022"],
  "next": ["CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLG2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022", "CLH2022"],
  "f1": [102.51332843462623, 102.4960441298758, 102.47958213557592, 102.46396461680483, 102.4604425894735, 102.44657591101492, 102.43361655745873, 102.42158414783826, 102.41049762687545, 102.41159505825617, 102.40245276636416, 102.39430912439067, 102.38718024749443, 102.38108151198715, 102.38724038348752, 102.20946128452259, 102.20655122062827, 102.20472347409357, 102.2039895503375, 102.21556892692303, 102.21705351692752, 102.21966175556953, 102.22340191565101, 102.22828144468897],
  "f2": [102.33912461489355, 102.32187922906039, 102.305454752189, 102.2898733119285, 102.2863858878118, 102.2725523019713, 102.25962449623952, 102.24762205658095, 102.23656389580118, 102.23768804684559, 102.22857080455563, 102.22045051380017, 102.213343262656, 102.20726440161327, 102.21344137174827, 102.0244667844601, 102.0215721332188, 102.01975783891601, 102.01903538647245, 102.0306242343996, 102.0321162781842, 102.03472993692785, 102.03847346880089, 102.04335430818495],
  "expiry_front": ["2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2021-12-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20"],
  "expiry_next": ["2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-01-20", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22", "2022-02-22"],
  "spread": [0.17420381973268206, 0.1741649008154127, 0.17412738338693146, 0.1740913048763275, 0.17405670166169784, 0.17402360904361558, 0.1739920612192094, 0.17396209125730877, 0.17393373107427124, 0.17390701141057718, 0.173881961808533, 0.1738586105905, 0.1738369848384309, 0.17381711037387504, 0.1737990117392485, 0.18499450006248708, 0.18497908740947366, 0.18496563517756215, 0.1849541638650436, 0.18494469252343038, 0.18493723874331636, 0.18493181864168662, 0.18492844685012244, 0.18492713650402948],
  "carry": [0.020056008566016227, 0.020054907343856176, 0.02005380624262234, 0.02005270526229156, 0.020049403046520028, 0.02004830254960617, 0.020047202173495177, 0.020046101918167736, 0.020045001783607255, 0.020041702104309184, 0.020040602452608833, 0.020039502921569877, 0.020038403511179196, 0.020037304221412595, 0.02003400707566519, 0.020069232671227528, 0.020068129996428104, 0.020067027442794184, 0.020065925010299978, 0.02006261843948332, 0.02006151649136363, 0.020060414664286038, 0.02005931295823394, 0.020058211373184455],
  "curve": {
    "date": "2021-12-31",
    "points": [
      {
        "rank": 0,
        "contract": "CLG2022",
        "expiry": "2022-01-20",
        "days_to_expiry": 20,
        "close": 102.22828144468897,
        "volume": 200030.0,
        "thin": false
      },
      {
        "rank": 1,
        "contract": "CLH2022",
        "expiry": "2022-02-22",
        "days_to_expiry": 53,
        "close": 102.04335430818495,
        "volume": 10030.0,
        "thin": false
      },
      {
        "rank": 2,
        "contract": "CLJ2022",
        "expiry": "2022-03-22",
        "days_to_expiry": 81,
        "close": 101.88644643478759,
        "volume": 6696.666666666667,
        "thin": false
      },
      {
        "rank": 3,
        "contract": "CLK2022",
        "expiry": "2022-04-20",
        "days_to_expiry": 110,
        "close": 101.7239347087689,
        "volume": 5030.0,
        "thin": false
      }
    ],
    "missing_ranks": []
  },
  "gate": {
    "caller": "terminal",
    "served_years": [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021],
    "cached": false,
    "reads_this_process": 8
  }
}
