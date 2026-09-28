// Audit bodies of the demo dataset, built from the fixture backend's own files:
// - the OOS log is backend/tests/fixtures/results/oos_access_log.jsonl (14 real lines over the four key sets, both
//   sealed lines verbatim, and 2 synthetic terminal lines), each line annotated by the rules of
//   backend/nq_terminal/services/audit.py (line_no, key_set, is_sealed, past_fence, epoch seconds, severity, alert);
//   the handler pages and counts it as api/audit.py does;
// - the openings are backend/tests/fixtures/results/oos_openings.json, which hashes to the pinned sha256 (its
//   manifest note), so both pins hold as they do on the fixture backend. The sealed-log digest is not reproduced.
import type { Schemas } from '../../api/types'
import { NOT_IN_DEMO, PAGE_LIMITS, intParam, served, utcMs, type DemoBody, type DemoRefusal } from './answer'
import { DEMO_TEXT } from './text'

type Entry = Schemas['OosLogEntry']

export const OOS_ENTRIES: readonly Entry[] = [
  {"ts_utc": "2026-09-25T21:32:05.600302+00:00", "caller": "za_screen", "reason": "pre-registered za_v0 screen, spec sha256 b02fa22b1550", "start": "2010-09-28T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 3129157, "line_no": 1, "key_set": "basic", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790371925, "start_epoch_s": 1285632000, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "symbol": null, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-25T21:32:20.627016+00:00", "caller": "za_screen", "reason": "pre-registered za_v0 screen, spec sha256 b02fa22b1550", "start": "2010-09-28T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 3129157, "line_no": 2, "key_set": "basic", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790371940, "start_epoch_s": 1285632000, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "symbol": null, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-25T21:33:33.815579+00:00", "caller": "c1_diagnostic", "reason": "post-hoc C1 random-direction diagnostic in gross R (not a pre-registered test)", "start": "2010-09-28T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 3129157, "line_no": 3, "key_set": "basic", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790372013, "start_epoch_s": 1285632000, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "symbol": null, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T06:43:18.373186+00:00", "caller": "fomccycle_v0", "reason": "pre-registered FOMC-cycle even/odd week test, in-sample only", "start": "2010-09-28T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 3318549, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "repaired", "line_no": 4, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790404998, "start_epoch_s": 1285632000, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T06:53:00.240153+00:00", "caller": "gate_selfcheck", "reason": "verify the served-rows gate check on real frames after the 2026-09-26 change", "start": "2015-03-02T00:00:00+00:00", "end": "2015-03-03T00:00:00+00:00", "rows": 1121, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "repaired", "line_no": 5, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790405580, "start_epoch_s": 1425254400, "end_epoch_s": 1425340800, "severity": 2, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T06:53:00.254194+00:00", "caller": "gate_selfcheck", "reason": "verify the served-rows gate check on real frames after the 2026-09-26 change", "start": "2015-03-02T00:00:00+00:00", "end": "2015-03-03T00:00:00+00:00", "rows": 1189, "symbol": "ZN.V.0", "timeframe": "1m", "variant": "vendor", "line_no": 6, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790405580, "start_epoch_s": 1425254400, "end_epoch_s": 1425340800, "severity": 2, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T07:22:32.993146+00:00", "caller": "eurodrift_v0_rsv", "reason": "pre-registered eurodrift_v0 secondary S2: closing order imbalance from trades, in-sample only", "start": "2010-11-19T20:15:00+00:00", "end": "2010-11-19T21:15:00+00:00", "rows": 18375, "symbol": "NQ.V.0", "schema": "trades", "line_no": 7, "key_set": "trades", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790407352, "start_epoch_s": 1290197700, "end_epoch_s": 1290201300, "severity": 2, "alert": false, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T07:22:33.061684+00:00", "caller": "eurodrift_v0_rsv", "reason": "pre-registered eurodrift_v0 secondary S2: closing order imbalance from trades, in-sample only", "start": "2010-10-15T19:15:00+00:00", "end": "2010-10-15T20:15:00+00:00", "rows": 29311, "symbol": "NQ.V.0", "schema": "trades", "line_no": 8, "key_set": "trades", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790407353, "start_epoch_s": 1287170100, "end_epoch_s": 1287173700, "severity": 2, "alert": false, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T07:22:33.066684+00:00", "caller": "eurodrift_v0_rsv", "reason": "pre-registered eurodrift_v0 secondary S2: closing order imbalance from trades, in-sample only", "start": "2010-10-01T19:15:00+00:00", "end": "2010-10-01T20:15:00+00:00", "rows": 19353, "symbol": "NQ.V.0", "schema": "trades", "line_no": 9, "key_set": "trades", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790407353, "start_epoch_s": 1285960500, "end_epoch_s": 1285964100, "severity": 2, "alert": false, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T08:00:27.934386+00:00", "caller": "eurodrift_v0_rsv", "reason": "pre-registered eurodrift_v0 secondary S2: closing order imbalance from trades, in-sample only", "start": "2021-10-07T19:15:00+00:00", "end": "2021-10-07T20:15:00+00:00", "rows": 37498, "symbol": "NQ.V.0", "schema": "trades", "line_no": 10, "key_set": "trades", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790409627, "start_epoch_s": 1633634100, "end_epoch_s": 1633637700, "severity": 2, "alert": false, "timeframe": null, "variant": null, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T11:14:36.841684+00:00", "caller": "rebal_v1_confirm", "reason": "rebal_v1_confirm sealed read under the user's opening of 2026-09-26: NQ.V.0 1m vendor, structural QA then the frozen confirmatory test and the descriptive volmanaged_oos", "start": "2021-10-01T00:00:00+00:00", "end": "2026-09-01T00:00:00+00:00", "rows": 1739792, "sealed": true, "spec_sha256": "64bf34d5b9f0b88287830b1af373d26248e11ce224a94ce0a97d28019dce0f33", "symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", "line_no": 11, "key_set": "sealed", "is_sealed": true, "past_fence": true, "ts_epoch_s": 1790421276, "start_epoch_s": 1633046400, "end_epoch_s": 1788220800, "severity": 4, "alert": true},
  {"ts_utc": "2026-09-26T11:14:37.256931+00:00", "caller": "rebal_v1_confirm", "reason": "rebal_v1_confirm sealed read under the user's opening of 2026-09-26: ZN.V.0 1m vendor, structural QA then the frozen confirmatory test and the descriptive volmanaged_oos", "start": "2021-10-01T00:00:00+00:00", "end": "2026-09-01T00:00:00+00:00", "rows": 1636292, "sealed": true, "spec_sha256": "64bf34d5b9f0b88287830b1af373d26248e11ce224a94ce0a97d28019dce0f33", "symbol": "ZN.V.0", "timeframe": "1m", "variant": "vendor", "line_no": 12, "key_set": "sealed", "is_sealed": true, "past_fence": true, "ts_epoch_s": 1790421277, "start_epoch_s": 1633046400, "end_epoch_s": 1788220800, "severity": 4, "alert": true},
  {"ts_utc": "2026-09-26T12:18:49.342150+00:00", "caller": "run_base", "reason": "Nautilus run nt_dtsmom_v0_ts1_haltfix_r1: dtsmom on ES.V.0 1d vendor bars", "start": "2010-06-01T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 2915, "symbol": "ES.V.0", "timeframe": "1d", "variant": "vendor", "line_no": 13, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790425129, "start_epoch_s": 1275350400, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-26T12:18:49.373263+00:00", "caller": "run_base", "reason": "Nautilus run nt_dtsmom_v0_ts1_haltfix_r1: dtsmom on NQ.V.0 1d vendor bars", "start": "2010-06-01T00:00:00+00:00", "end": "2022-01-01T00:00:00+00:00", "rows": 2915, "symbol": "NQ.V.0", "timeframe": "1d", "variant": "vendor", "line_no": 14, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790425129, "start_epoch_s": 1275350400, "end_epoch_s": 1640995200, "severity": 2, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-27T09:00:00.000000+00:00", "caller": "terminal", "reason": "terminal display: NQ.V.0 1m vendor 2019 (chart only, not a registered test)", "start": "2019-01-01T00:00:00+00:00", "end": "2020-01-01T00:00:00+00:00", "rows": 350000, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", "line_no": 15, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790499600, "start_epoch_s": 1546300800, "end_epoch_s": 1577836800, "severity": 1, "alert": false, "sealed": null, "spec_sha256": null},
  {"ts_utc": "2026-09-27T09:00:00.000000+00:00", "caller": "terminal", "reason": "terminal display: NQ.V.0 1m vendor 2020 (chart only, not a registered test)", "start": "2020-01-01T00:00:00+00:00", "end": "2021-01-01T00:00:00+00:00", "rows": 350000, "symbol": "NQ.V.0", "timeframe": "1m", "variant": "vendor", "line_no": 16, "key_set": "series", "is_sealed": false, "past_fence": false, "ts_epoch_s": 1790499600, "start_epoch_s": 1577836800, "end_epoch_s": 1609459200, "severity": 1, "alert": false, "sealed": null, "spec_sha256": null},
]

/** services/audit.py SEVERITY_LEVELS, word for word. */
const SEVERITY_LEVELS: Schemas['SeverityLevel'][] = [
  { level: 1, meaning: 'terminal display read, inside the in-sample window' },
  { level: 2, meaning: 'research read by another caller, inside the in-sample window' },
  { level: 3, meaning: 'window past the fence, before the in-sample start, or unreadable: check it' },
  { level: 4, meaning: 'sealed read (spent window)' },
]
const TERMINAL_CALLER = 'terminal'

function countBy(entries: readonly Entry[], key: (e: Entry) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of entries) counts[key(e)] = (counts[key(e)] ?? 0) + 1
  return counts
}

/** GET /api/audit/oos-log: whole-log counts, and the page of matching entries `offset` back from the newest. */
export function oosLog(query: URLSearchParams): DemoBody<Schemas['OosLog']> | DemoRefusal {
  const caller = query.get('caller')
  const since = query.get('since')
  const limit = intParam(query, 'limit', PAGE_LIMITS.default)
  const offset = intParam(query, 'offset', 0)
  const floor = since === null ? null : utcMs(since)
  if (limit === null || offset === null || limit < 1 || limit > PAGE_LIMITS.max || Number.isNaN(floor)) return NOT_IN_DEMO
  const matched = OOS_ENTRIES.filter((e) =>
    (caller === null || e.caller === caller) && (floor === null || (e.ts_epoch_s !== null && e.ts_epoch_s * 1000 >= floor)))
  const stop = matched.length - offset
  const entries = stop > 0 ? matched.slice(Math.max(stop - limit, 0), stop) : []
  const callers = countBy(OOS_ENTRIES, (e) => e.caller)
  return served({
    log_present: true,
    total: OOS_ENTRIES.length,
    returned: entries.length,
    matched: matched.length,
    partial_tail: false,
    parse_errors: [],
    key_sets: countBy(OOS_ENTRIES, (e) => e.key_set),
    counts_by_caller: callers,
    terminal_reads: callers[TERMINAL_CALLER] ?? 0,
    sealed_reads: OOS_ENTRIES.filter((e) => e.is_sealed).length,
    severity_levels: SEVERITY_LEVELS,
    severity_counts: countBy(OOS_ENTRIES, (e) => String(e.severity)),
    fence_end: '2022-01-01',
    filters: { caller, since, limit, offset },
    entries,
  })
}

/** sha256 of backend/tests/fixtures/results/oos_openings.json, which is also the pinned value. */
const OPENINGS_SHA256 = '3feef9ab9491b901d282493935a77a049b7784959ef4537eddbe9b6dcaa1e4b0'

/** GET /api/audit/openings over the fixture openings file. */
export const OPENINGS: Schemas['Openings'] = {
  openings: [{"caller": "rebal_v1_confirm", "spec": "experiments/rebal_v1_confirm.json", "spec_sha256": "64bf34d5b9f0b88287830b1af373d26248e11ce224a94ce0a97d28019dce0f33", "window": ["2021-10-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00"], "symbols": ["NQ.V.0", "ZN.V.0"], "max_serves": 2, "decided_by": "user", "decided_utc": "2026-09-26T10:47:46.666928+00:00", "decision_quote": "open it, get a quote on bigdata, and let me do the IB account and you do whats on your side", "closed": true, "closed_utc": "2026-09-26T11:15:20.324713+00:00"}],
  openings_pin_ok: true,
  sealed_log_pin_ok: true,
  openings_closed: true,
  openings_sha256: OPENINGS_SHA256,
  sealed_log: null,
  pinned: { openings_sha256: OPENINGS_SHA256, sealed_log_lines: 2, sealed_log_sha256: DEMO_TEXT.unknownPin },
  label: 'spent window, opened 2026-09-26, descriptive only',
}
