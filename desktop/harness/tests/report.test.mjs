// The report and its --check (born failing): a missing row, a figure that does not match its raw record and a ceiling breach
// must each be caught; a complete synthetic set must pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, checkEvidence, overCeiling, collectFigures, reportLines } from '../report.mjs'
import { ROWS, rowsForLaunch } from '../lib/rows.mjs'
import { figure } from '../lib/record.mjs'

const STAMP = { head: 'abc', diffSha256: 'd', untrackedSha256: 'u' }

/** One synthetic record of `build` with `values` for its rows. */
function record(build, slot, values, over = {}) {
  const rows = { ...values }
  const units = Object.fromEntries(ROWS.map((r) => [r.id, r.unit]))
  return { schema: 'd5-run-1', mode: 'rows', build, slot, status: 'accepted', provenance: STAMP, rows, file: `D:\\x\\${build}-${slot}.json`,
    figures: Object.entries(rows).map(([row, value]) => figure({ row, build, value, unit: units[row], method: 'm', cpuLoadPct: 3, provenance: STAMP })), ...over }
}

const GOOD = { smoke: { backend_ready: 1200, splash_painted: 300, cold_home: 3000, warm_home: 900, eq_warm: 800, reg_warm: 700, grid_open: 80, gip_pan_zoom_p95: 16, keystroke_p95: 40, idle_mem_home: 380 }, measure: { backend_ready: 1250, splash_painted: 310, cold_home: 3100, idle_mem_home: 390 } }
const soak = record('smoke', 9, { soak_mem: 900 }, { mode: 'soak' })
const installer = record('release', 1, { installer_mb: 4 }, { mode: 'installer' })
const minimise = (id, ms) => ({ schema: 'd5-run-1', mode: 'minimise-sim', build: 'smoke', status: 'accepted', provenance: STAMP, rows: { [id]: ms }, file: 'D:\\x\\m.json', figures: [figure({ row: id, build: 'smoke', value: ms, unit: 'ms', method: 'm', cpuLoadPct: 2, provenance: STAMP })] })

function complete() {
  const recs = []
  for (const build of ['smoke', 'measure']) for (let s = 1; s <= 3; s++) recs.push(record(build, s, GOOD[build]))
  return [...recs, soak, installer, minimise('minimise_sim_stream_back_ms', 2500), minimise('minimise_real_stream_back_ms', 3000)]
}

test('the rows the launches take match the G2 table (ids, targets, ceilings)', () => {
  const t = Object.fromEntries(ROWS.map((r) => [r.id, [r.target, r.ceiling]]))
  assert.deepEqual(t.backend_ready, [1500, 2500])
  assert.deepEqual(t.splash_painted, [500, 1000])
  assert.deepEqual(t.cold_home, [3500, 5000])
  assert.deepEqual(t.warm_home, [1000, 1500])
  assert.deepEqual(t.grid_open, [100, 500])
  assert.deepEqual(t.gip_pan_zoom_p95, [16.7, 25])
  assert.deepEqual(t.keystroke_p95, [50, 100])
  assert.deepEqual(t.idle_mem_home, [400, 500])
  assert.deepEqual(t.soak_mem, [1000, 1500])
  assert.deepEqual(t.installer_mb, [15, 30])
  assert.deepEqual(rowsForLaunch('measure').map((r) => r.id), ['backend_ready', 'splash_painted', 'cold_home', 'idle_mem_home'])
})

test('a complete synthetic set passes the check, with medians and verdicts', () => {
  const recs = complete()
  const report = buildReport(recs)
  assert.deepEqual(checkEvidence(recs, report), [])
  const idle = report.rows.find((r) => r.id === 'idle_mem_home')
  assert.equal(idle.builds.smoke.median, 380)
  assert.equal(idle.builds.measure.median, 390)
  assert.equal(idle.verdict, 'within-target')
  assert.equal(report.agreement.backend_ready.agree, true)
  assert.deepEqual(overCeiling(report), [])
})

test('a missing row is caught by --check (born failing)', () => {
  const recs = complete().map((r) => { if (r.build !== 'smoke' || r.mode !== 'rows') return r; const { grid_open, ...rows } = r.rows; return { ...r, rows, figures: r.figures.filter((f) => f.row !== 'grid_open') } })
  const problems = checkEvidence(recs, buildReport(recs))
  assert.ok(problems.some((p) => /grid_open/.test(p) && /no reading/.test(p)), problems.join('; '))
})

test('too few accepted runs is caught', () => {
  const recs = complete().filter((r) => !(r.build === 'measure' && r.slot === 3))
  const problems = checkEvidence(recs, buildReport(recs))
  assert.ok(problems.some((p) => /measure build has 2 accepted/.test(p)), problems.join('; '))
})

test('a figure that differs from its raw record is caught', () => {
  const recs = complete()
  recs[0].figures[0] = { ...recs[0].figures[0], value: 1 }
  const problems = checkEvidence(recs, buildReport(recs))
  assert.ok(problems.some((p) => /record's own row says/.test(p)))
})

test('a figure without its method, CPU load or stamp is caught', () => {
  const recs = complete()
  recs[1].figures[0] = { ...recs[1].figures[0], stamp: null }
  assert.ok(checkEvidence(recs, buildReport(recs)).some((p) => /provenance stamp/.test(p)))
})

test('a missing minimise check is caught', () => {
  const recs = complete().filter((r) => r.mode !== 'minimise-sim')
  assert.ok(checkEvidence(recs, buildReport(recs)).some((p) => /minimise_sim_stream_back_ms/.test(p)))
})

test('rejected, dry and warm-up records are never counted, but rejected ones are listed', () => {
  const recs = [...complete(), record('smoke', 4, { idle_mem_home: 9999 }, { status: 'rejected', gate: { avgPct: 44 } }), record('smoke', 5, { idle_mem_home: 9999 }, { status: 'dry' }), record('smoke', 6, { idle_mem_home: 9999 }, { status: 'warmup' })]
  const report = buildReport(recs)
  assert.equal(report.rows.find((r) => r.id === 'idle_mem_home').builds.smoke.median, 380)
  assert.equal(report.rejectedKept.length, 1)
  assert.equal(report.rejectedKept[0].avgPct, 44)
})

test('provisional runs are reported apart and label the row PROVISIONAL', () => {
  const recs = complete().filter((r) => r.build !== 'measure').concat([1, 2, 3].map((s) => record('measure', s, GOOD.measure, { status: 'provisional', label: 'PROVISIONAL' })))
  const report = buildReport(recs)
  const b = report.rows.find((r) => r.id === 'backend_ready').builds.measure
  assert.equal(b.label, 'PROVISIONAL')
  assert.equal(b.accepted, 0)
  assert.equal(b.provisional, 3)
})

test('a ceiling breach on either build fails the row, and disagreeing builds are named', () => {
  const recs = complete().map((r) => (r.build === 'measure' && r.mode === 'rows' ? { ...r, rows: { ...r.rows, idle_mem_home: 700 }, figures: r.figures.map((f) => (f.row === 'idle_mem_home' ? { ...f, value: 700 } : f)) } : r))
  const report = buildReport(recs)
  assert.equal(report.rows.find((r) => r.id === 'idle_mem_home').verdict, 'over-ceiling')
  const bad = overCeiling(report)
  assert.ok(bad.some((b) => /idle_mem_home is over/.test(b)))
  assert.ok(bad.some((b) => /builds disagree on idle_mem_home/.test(b)))
  assert.deepEqual(checkEvidence(recs, report), [], 'the evidence is complete even though a ceiling fails')
})

test('collectFigures returns only counted records', () => {
  const figs = collectFigures(complete())
  assert.ok(figs.every((f) => f.status === 'accepted'))
})

test('runs taken without the reproduction are counted and fail a strict check', () => {
  const recs = complete().map((r, i) => (i === 0 ? { ...r, unreproduced: true } : r))
  const report = buildReport(recs)
  assert.equal(report.unreproducedRuns, 1)
  assert.ok(overCeiling(report).some((b) => /UNREPRODUCED/.test(b)))
  assert.equal(buildReport(complete()).unreproducedRuns, 0)
})

test('the reproduction verdict is the newest real one, not the first record found (an older dry verdict never stands in for it)', () => {
  const verdict = (file, over) => ({ schema: 'd5-run-1', mode: 'reproduce', status: 'accepted', provenance: STAMP, file, verdict: {}, ...over })
  const older = verdict('D:/x/a-dry/reproduce-verdict.json', { dry: true, reproduced: true, writtenAtIso: '2026-10-03T02:00:00.000Z' })
  const real1 = verdict('D:/x/b/reproduce-verdict.json', { dry: false, reproduced: true, writtenAtIso: '2026-10-03T12:00:00.000Z' })
  const real2 = verdict('D:/x/c/reproduce-verdict.json', { dry: false, reproduced: false, writtenAtIso: '2026-10-03T21:00:00.000Z' })
  const report = buildReport([older, real1, real2, ...complete()])
  assert.equal(report.reproduction.dry, false)
  assert.equal(report.reproduction.reproduced, false, 'the newest non-dry verdict')
  assert.equal(buildReport([older, ...complete()]).reproduction.dry, true, 'a dry verdict is reported only when it is the only one')
})

test('a simulated minimise taken by a page-level driver reads NOT TESTED, never within ceiling (born failing)', () => {
  const pageLevel = { schema: 'd5-run-1', mode: 'minimise-sim', build: 'smoke', status: 'accepted', provenance: STAMP, rows: { minimise_sim_stream_back_ms: 0 }, file: 'D:/x/p.json',
    figures: [figure({ row: 'minimise_sim_stream_back_ms', build: 'smoke', value: 0, unit: 'ms', method: 'm', cpuLoadPct: 2, provenance: STAMP, extra: { driver: 'page-override', engineLevel: false } })] }
  const recs = [...complete().filter((r) => r.mode !== 'minimise-sim' || r.rows.minimise_real_stream_back_ms !== undefined), pageLevel]
  const report = buildReport(recs)
  assert.equal(report.checks.minimise_sim_stream_back_ms.verdict, 'not-tested')
  assert.ok(checkEvidence(recs, report).some((p) => /minimise_sim_stream_back_ms/.test(p) && /not tested/i.test(p)))
})

test('an engine-level simulated minimise still reads within ceiling', () => {
  const engine = { schema: 'd5-run-1', mode: 'minimise-sim', build: 'smoke', status: 'accepted', provenance: STAMP, rows: { minimise_sim_stream_back_ms: 2500 }, file: 'D:/x/e.json',
    figures: [figure({ row: 'minimise_sim_stream_back_ms', build: 'smoke', value: 2500, unit: 'ms', method: 'm', cpuLoadPct: 2, provenance: STAMP, extra: { driver: 'controller-file', engineLevel: true } })] }
  const report = buildReport([engine])
  assert.equal(report.checks.minimise_sim_stream_back_ms.verdict, 'within-ceiling')
})

// Informational lines (born failing: reportLines did not exist). They sit beside the row verdicts and never change them.
const BREAKDOWN = { backendMB: 164.5, uiTreeMB: 180.9, shellMB: 4.2, perType: { renderer: 93.7, 'gpu-process': 36.4, browser: 35.7 } }
const idleRecord = (slot, over = {}) => record('smoke', slot, GOOD.smoke, { idleBreakdown: BREAKDOWN, uiOver350: false, ...over })
const soakRecord = (maxMB, extra = {}) => record('smoke', 9, { soak_mem: maxMB }, { mode: 'soak', soak: { n: 4, maxMB, lastMB: 700, slopeMBPerHour: -300, firstSampleAtS: 5, startupPeakMB: maxMB, settledMaxMB: 1290, ...extra } })
const info = (lines) => lines.filter((l) => /informational, not the row/.test(l))

test('a soak record over 1,500 MB still fails its row, with the informational lines beside it', () => {
  const recs = [...complete().filter((r) => r.mode !== 'soak'), soakRecord(1577.4)]
  const report = buildReport(recs)
  const row = report.rows.find((r) => r.id === 'soak_mem')
  assert.equal(row.builds.smoke.verdict, 'over-ceiling')
  assert.equal(row.verdict, 'over-ceiling')
  assert.ok(overCeiling(report).some((b) => /soak_mem is over/.test(b)))
  const lines = reportLines(report, recs)
  assert.ok(lines.some((l) => /^soak_mem \| smoke \|.*over-ceiling ACCEPTED$/.test(l)), 'the row line is the one of today')
  const soakInfo = info(lines).filter((l) => /soak/i.test(l))
  assert.equal(soakInfo.length, 1)
  assert.match(soakInfo[0], /start-up peak 1577\.4 MB/)
  assert.match(soakInfo[0], /first sample at 5 s/)
  assert.match(soakInfo[0], /settled maximum 1290 MB/)
  assert.match(soakInfo[0], /from 900 s/)
})

test('the informational lines are added after the table and leave every existing line as it was', () => {
  const plain = [...complete().filter((r) => r.mode !== 'soak'), soakRecord(900)].map((r) => { const { soak, ...rest } = r; return r.mode === 'soak' ? { ...rest, soak: { n: 4, maxMB: 900, lastMB: 700, slopeMBPerHour: 0 } } : r })
  const rich = [...complete().filter((r) => r.mode !== 'soak'), soakRecord(900)].map((r) => (r.build === 'smoke' && r.mode === 'rows' ? { ...r, idleBreakdown: BREAKDOWN, uiOver350: false } : r))
  const before = reportLines(buildReport(plain), plain)
  const after = reportLines(buildReport(rich), rich)
  assert.equal(info(before).length, 0, 'no new fields, no informational line')
  assert.equal(info(after).length, 2, 'one for the idle breakdown, one for the soak')
  assert.deepEqual(after.filter((l) => !/informational, not the row/.test(l)), before)
  assert.ok(after.indexOf(info(after)[0]) > after.findIndex((l) => /^rejected runs kept/.test(l)))
})

test('the idle breakdown is one labelled line per build, and a UI tree over 350 MB prints the T4 canvas note', () => {
  const recs = [...complete(), idleRecord(11), idleRecord(12)]
  const lines = info(reportLines(buildReport(recs), recs)).filter((l) => /idle/i.test(l))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /backend 164\.5 MB/)
  assert.match(lines[0], /UI tree 180\.9 MB/)
  assert.match(lines[0], /shell 4\.2 MB/)
  assert.match(lines[0], /renderer 93\.7/)
  assert.doesNotMatch(reportLines(buildReport(recs), recs).join('\n'), /canvas/i)
  const tall = [...complete(), idleRecord(11, { uiOver350: true, idleBreakdown: { ...BREAKDOWN, uiTreeMB: 412 } })]
  const text = reportLines(buildReport(tall), tall).join('\n')
  assert.match(text, /T4/)
  assert.match(text, /canvas backing stores per panel/)
})

test('rejected and dry records add nothing to the informational lines', () => {
  const recs = [...complete(), idleRecord(11, { status: 'rejected' }), idleRecord(12, { status: 'dry' })]
  assert.equal(info(reportLines(buildReport(recs), recs)).length, 0)
})

test('the informational lines carry no em or en dash', () => {
  const recs = [...complete().filter((r) => r.mode !== 'soak'), soakRecord(1577.4), idleRecord(11, { uiOver350: true })]
  assert.doesNotMatch(reportLines(buildReport(recs), recs).join('\n'), /[\u2013\u2014]/)
})

// "Not read" must not look like "not over" (born failing: a null breakdown printed nothing and --check was silent).
const unreadRecord = (slot, why) => record('smoke', slot, GOOD.smoke, { idleBreakdown: null, uiOver350: null, ...(why ? { idleBreakdownError: why } : {}) })

test('runs whose idle breakdown was not read print a not-read line and say the T4 canvas clause was not evaluated', () => {
  const recs = [...complete(), unreadRecord(11, 'powershell timed out'), unreadRecord(12, 'powershell timed out'), idleRecord(13)]
  const lines = info(reportLines(buildReport(recs), recs))
  assert.ok(lines.some((l) => /idle breakdown not read in 2 of 3 runs: powershell timed out/.test(l) && /T4 canvas clause not evaluated/.test(l)), lines.join('\n'))
  const all = [...complete(), unreadRecord(11), unreadRecord(12)]
  const allLines = info(reportLines(buildReport(all), all))
  assert.ok(allLines.some((l) => /idle breakdown not read in 2 of 2 runs: no reason recorded/.test(l)), allLines.join('\n'))
  assert.doesNotMatch(allLines.join('\n'), /[\u2013\u2014]/)
})

test('--check refuses to call the T4 clause clear while a counted run has no breakdown, and passes when every run was read', () => {
  const bad = [...complete(), unreadRecord(11, 'cim error')]
  assert.ok(checkEvidence(bad, buildReport(bad)).some((p) => /T4 canvas clause not evaluated/.test(p) && /1 of 1/.test(p)))
  const ok = [...complete(), idleRecord(11)]
  assert.deepEqual(checkEvidence(ok, buildReport(ok)), [])
  const old = complete()
  assert.deepEqual(checkEvidence(old, buildReport(old)), [], 'records from before the field existed are not accused')
})

test('a failed command-line lookup and failed soak breakdown reads each print an informational line', () => {
  const cmd = [...complete(), idleRecord(11, { idleBreakdown: { ...BREAKDOWN, commandLineError: 'cim failed' } })]
  assert.ok(info(reportLines(buildReport(cmd), cmd)).some((l) => /command lines not read/.test(l) && /cim failed/.test(l) && /unknown/.test(l)))
  const sk = [...complete().filter((r) => r.mode !== 'soak'), soakRecord(900, { breakdownFailures: 3, breakdownError: 'timeout' })]
  assert.ok(info(reportLines(buildReport(sk), sk)).some((l) => /soak breakdown not read in 3 samples: timeout/.test(l)))
})
