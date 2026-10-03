// The report and its --check (born failing): a missing row, a figure that does not match its raw record and a ceiling breach
// must each be caught; a complete synthetic set must pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, checkEvidence, overCeiling, collectFigures } from '../report.mjs'
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
