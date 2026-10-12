// The report and its --check (born failing): a missing row, a figure that does not match its raw record and a ceiling breach
// must each be caught; a complete synthetic set must pass.
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

// ---- the start-up rows (wave w1, start-rows): informational lines beside the verdicts, never a verdict -------------------------
import { startRowsOfLogs } from '../lib/startrows.mjs'

const FIXDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'startrows')
const fixture = (name) => fs.readFileSync(path.join(FIXDIR, name), 'utf8')
const usualRows = () => startRowsOfLogs(fixture('usual-shell.txt'), fixture('usual-backend.txt'))
const startInfo = (lines) => info(lines).filter((l) => /start-up rows|slowest HOME requests/.test(l))
const withRows = (slot, startRows, over = {}) => record('smoke', slot, GOOD.smoke, { startRows, ...over })

test('a counted record without start rows adds no start-up line, and the existing lines stay as they were (regression guard)', () => {
  const plain = complete()
  const lines = reportLines(buildReport(plain), plain)
  assert.equal(startInfo(lines).length, 0)
  const rich = plain.map((r, i) => (i === 0 ? { ...r, startRows: usualRows() } : r))
  assert.deepEqual(reportLines(buildReport(rich), rich).filter((l) => !/informational, not the row/.test(l)), lines.filter((l) => !/informational, not the row/.test(l)))
})

test('start rows print one informational line per build with the median of every launch and "missing" where nothing was read (born failing)', () => {
  const recs = [...complete(), withRows(11, usualRows())]
  const report = buildReport(recs)
  const lines = startInfo(reportLines(report, recs))
  const main = lines.find((l) => /start-up rows, smoke build/.test(l))
  assert.ok(main, lines.join('\n'))
  assert.match(main, /median of 4 launch\(es\)/)
  assert.match(main, /spawn offset 478 ms/)
  assert.match(main, /spawn to READY 1535 ms/)
  assert.match(main, /HOME stage 1152\.5 ms/)
  assert.match(main, /page files served 107/)
  assert.match(main, /import time missing/)
  assert.match(main, /modules without current bytecode missing/)
  assert.match(main, /slowest HOME requests missing/)
  assert.ok(!lines.some((l) => /measure build/.test(l)), 'a build with no start rows prints nothing')
  assert.equal(report.startRows.smoke.rows.home_stage_ms.n, 4)
})

test('a launch that lacks a figure is counted as missing beside the median of the rest', () => {
  const shell = fixture('usual-shell.txt').split('\n').filter((l) => !(l.includes('"supervise_spawned"') && l.includes('57184'))).join('\n')
  const recs = [...complete(), withRows(11, startRowsOfLogs(shell, fixture('usual-backend.txt')))]
  const main = startInfo(reportLines(buildReport(recs), recs)).find((l) => /start-up rows/.test(l))
  assert.match(main, /spawn offset 441 ms \(1 of 4 launch\(es\) missing\)/)
})

test('the slowest HOME requests print wall time only (no CPU claim), from the launches of the build', () => {
  const log = ['INFO:     Started server process [18564]', '2026-10-07 23:19:49,508 INFO nq_terminal.services.prewarm: prewarm started: 5 tasks',
    '2026-10-07 23:19:50,000 INFO nq_terminal.request_timing: request timing: GET /api/runs?x=1 status=200 start=1 end=1.9 wall_ms=900 thread_cpu_ms=500 process_cpu_ms=700',
    '2026-10-07 23:19:50,100 INFO nq_terminal.request_timing: request timing: GET /api/eq status=200 start=1 end=1.2 wall_ms=200 thread_cpu_ms=200 process_cpu_ms=210',
    '2026-10-07 23:19:51,341 INFO nq_terminal.services.prewarm: prewarm finished: 5 of 5 tasks ok in 1.83 s'].join('\n')
  const rows = startRowsOfLogs(fixture('first-shell.txt'), log)
  const recs = [...complete(), withRows(11, rows)]
  const lines = startInfo(reportLines(buildReport(recs), recs))
  const slow = lines.find((l) => /slowest HOME requests, smoke build/.test(l))
  assert.ok(slow, lines.join('\n'))
  assert.match(slow, /GET \/api\/runs 900 ms, GET \/api\/eq 200 ms$/)
  assert.doesNotMatch(slow, /CPU/, 'event-loop CPU is not a per-request CPU, so the line leaves it out')
  assert.doesNotMatch(slow, /x=1/, 'the query string never reaches the report')
  assert.ok(!/slowest HOME requests missing/.test(lines.find((l) => /start-up rows/.test(l))))
})

test('the in-process import time and the bytecode count come from the record and print beside the launch rows', () => {
  const imp = { status: 'ok', value: 1120, runs: 3, warmup: 5200, bytecode: { status: 'ok', value: 0, names: [], checked: 1168 } }
  const recs = [...complete(), withRows(11, { ...usualRows(), import: imp })]
  const main = startInfo(reportLines(buildReport(recs), recs)).find((l) => /start-up rows/.test(l))
  assert.match(main, /import time 1120 ms/)
  assert.match(main, /modules without current bytecode 0/)
})

test('a smoke record is read back from its own run folder when it carries no start rows, and a measure record never reads the lab state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startrows-report-'))
  try {
    const launch = path.join(root, 'launch', 'smoke-s2-a1')
    fs.mkdirSync(path.join(launch, 'config', 'logs'), { recursive: true })
    fs.mkdirSync(path.join(launch, 'state', 'logs'), { recursive: true })
    fs.writeFileSync(path.join(launch, 'config', 'logs', 'shell.log'), fixture('first-shell.txt'))
    fs.writeFileSync(path.join(launch, 'state', 'logs', 'backend.log'), fixture('first-backend.txt'))
    const smoke = record('smoke', 12, GOOD.smoke, { stateFolder: path.join(launch, 'state') })
    const measure = record('measure', 12, GOOD.measure, { stateFolder: path.join(launch, 'state') })
    const recs = [...complete(), smoke, measure]
    const lines = startInfo(reportLines(buildReport(recs), recs))
    assert.match(lines.find((l) => /smoke build/.test(l)), /median of 1 launch\(es\): spawn offset 436 ms, spawn to READY 1466 ms, HOME stage 1833 ms/)
    assert.ok(!lines.some((l) => /measure build/.test(l)), lines.join('\n'))
    const gone = [...complete(), record('smoke', 13, GOOD.smoke, { stateFolder: path.join(root, 'no-such-run', 'state') })]
    const goneLine = startInfo(reportLines(buildReport(gone), gone)).find((l) => /smoke build/.test(l))
    assert.match(goneLine, /median of 0 launch\(es\)/, 'unreadable logs read as nothing, not as zero')
    assert.match(goneLine, /spawn offset missing/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('rejected and dry records add no start-up line, the lines carry no em or en dash, and --check ignores the rows', () => {
  const bad = [...complete(), withRows(11, usualRows(), { status: 'rejected' }), withRows(12, usualRows(), { status: 'dry' })]
  assert.equal(startInfo(reportLines(buildReport(bad), bad)).length, 0)
  const recs = [...complete(), withRows(11, usualRows())]
  assert.doesNotMatch(reportLines(buildReport(recs), recs).join('\n'), /[\u2013\u2014]/)
  assert.deepEqual(checkEvidence(recs, buildReport(recs)), [], 'no start row gates anything yet')
  assert.deepEqual(overCeiling(buildReport(recs)), [])
})

// ---- start rows carry the accepted/provisional basis (born failing) --------------------------------------------------------
test('start rows use accepted launches when any exist, count both kinds and carry no PROVISIONAL label', () => {
  const slowShell = fixture('usual-shell.txt')
  const recs = [...complete(), withRows(11, usualRows()), withRows(12, startRowsOfLogs(slowShell, fixture('usual-backend.txt')), { status: 'provisional' })]
  const report = buildReport(recs)
  assert.equal(report.startRows.smoke.basis, 'accepted')
  assert.equal(report.startRows.smoke.accepted, 1)
  assert.equal(report.startRows.smoke.provisional, 1)
  assert.equal(report.startRows.smoke.launches, 4, 'the provisional record is left out of the figure')
  const main = startInfo(reportLines(report, recs)).find((l) => /start-up rows.*smoke build/.test(l))
  assert.match(main, /median of 4 launch\(es\)/)
  assert.doesNotMatch(main, /PROVISIONAL/)
  assert.match(main, /basis accepted: 1 accepted and 1 provisional record\(s\)/)
})

test('start rows built only from provisional (loaded-machine) records are labelled PROVISIONAL', () => {
  const recs = [...complete(), withRows(11, usualRows(), { status: 'provisional' })]
  const report = buildReport(recs)
  assert.equal(report.startRows.smoke.basis, 'provisional')
  const main = startInfo(reportLines(report, recs)).find((l) => /start-up rows.*smoke build/.test(l))
  assert.match(main, /PROVISIONAL/)
  assert.match(main, /median of 4 launch\(es\)/)
})

test('start rows whose import reading is provisional (loaded machine) print PROVISIONAL even on accepted records', () => {
  const recs = [...complete(), withRows(11, { ...usualRows(), import: { status: 'ok', value: 900, provisional: true, cpuLoadPct: 40 } })]
  const main = startInfo(reportLines(buildReport(recs), recs)).find((l) => /start-up rows.*smoke build/.test(l))
  assert.match(main, /import time 900 ms/)
  assert.match(main, /PROVISIONAL/)
})

// The spawn-offset check (startup.md 7.2; wave w4b): a G2 launch whose supervise_spawned comes more than 150 ms after the shell's
// start line fails; the target is a median of 120 ms or less. Born failing: before the check, a 151 ms launch passed unseen.
import { spawnOffsetCheck, spawnOffsetFailures, SPAWN_OFFSET } from '../report.mjs'
import { milestones as shellMilestones, parseShellLog as parseShell } from '../lib/shelllog.mjs'

const SPAWN_T0 = 1_760_000_000_000
/** A counted G2 launch record whose shell log has its start line at 20 ms and supervise_spawned `offset` ms later. */
function launchWithOffset(slot, offset, over = {}) {
  const log = [{ t: SPAWN_T0 + 20, event: 'start' }, { t: SPAWN_T0 + 20 + offset, event: 'supervise_spawned', launcher_pid: 7, route: 'job_list' }]
  const ms = shellMilestones(parseShell(log.map((l) => JSON.stringify(l)).join('\n')), SPAWN_T0)
  return record('measure', slot, GOOD.measure, { milestones: ms, ...over })
}

test('the spawn-offset ceiling is 150 ms and the target a median of 120 ms', () => {
  assert.deepEqual([SPAWN_OFFSET.ceiling, SPAWN_OFFSET.target], [150, 120])
})

test('a launch with supervise_spawned 151 ms after start is flagged; one at 150 ms is not (born failing)', () => {
  const at150 = [launchWithOffset(1, 100), launchWithOffset(2, 150), launchWithOffset(3, 90)]
  const check150 = spawnOffsetCheck(at150)
  assert.equal(check150.readings, 3)
  assert.deepEqual(check150.over, [])
  assert.deepEqual(spawnOffsetFailures(check150), [])
  const at151 = [launchWithOffset(1, 100), launchWithOffset(2, 151), launchWithOffset(3, 90)]
  const check151 = spawnOffsetCheck(at151)
  assert.equal(check151.verdict, 'over-ceiling')
  assert.deepEqual(check151.over.map((o) => o.ms), [151])
  const failures = spawnOffsetFailures(check151)
  assert.equal(failures.length, 1)
  assert.match(failures[0], /measure-2\.json/)
  assert.match(failures[0], /151 ms/)
  const report = { ...buildReport([...complete(), ...at151]), spawnOffset: check151 }
  assert.ok(overCeiling(report).some((l) => /spawn_offset/.test(l) && /151 ms/.test(l)), overCeiling(report).join('; '))
  const clean = { ...buildReport([...complete(), ...at150]), spawnOffset: check150 }
  assert.ok(!overCeiling(clean).some((l) => /spawn_offset/.test(l)))
})

test('the spawn-offset verdict tells the target from the ceiling, and the median is printed with both', () => {
  const quick = spawnOffsetCheck([launchWithOffset(1, 60), launchWithOffset(2, 120), launchWithOffset(3, 140)])
  assert.equal(quick.medianMs, 120)
  assert.equal(quick.verdict, 'within-target')
  const slow = spawnOffsetCheck([launchWithOffset(1, 125), launchWithOffset(2, 130), launchWithOffset(3, 140)])
  assert.equal(slow.verdict, 'within-ceiling')
  const recs = [...complete(), launchWithOffset(4, 125)]
  const line = reportLines({ ...buildReport(recs), spawnOffset: spawnOffsetCheck(recs) }, recs).find((l) => l.startsWith('check spawn_offset'))
  assert.match(line, /median 125 ms/)
  assert.match(line, /target 120/)
  assert.match(line, /ceiling 150/)
})

test('only counted G2 launches are read, and a launch with no spawn line is unread, never 0 ms', () => {
  const rejected = launchWithOffset(1, 400, { status: 'rejected' })
  const soakLike = launchWithOffset(2, 400, { mode: 'soak' })
  const noSpawn = record('measure', 3, GOOD.measure, { milestones: shellMilestones(parseShell(JSON.stringify({ t: SPAWN_T0 + 20, event: 'start' })), SPAWN_T0) })
  const firstLaunch = launchWithOffset(4, 110, { mode: 'first-launch' })
  const check = spawnOffsetCheck([rejected, soakLike, noSpawn, firstLaunch])
  assert.equal(check.readings, 1)
  assert.equal(check.unread, 1)
  assert.equal(check.medianMs, 110)
  assert.equal(spawnOffsetCheck([]).verdict, 'missing')
  assert.deepEqual(spawnOffsetFailures(undefined), [])
})

// Fixer 12 (born failing): the 150 ms gate must not pass with zero readings, must be read per build, and the CLI path must exit 4.
test('counted launches with no spawn reading fail the strict gate (verdict missing is not a pass)', () => {
  const nulls = [1, 2, 3, 4, 5].map((s) => record('measure', s, GOOD.measure, { milestones: { spawnOffsetMs: null } }))
  const check = spawnOffsetCheck(nulls)
  assert.equal(check.verdict, 'missing')
  const bad = overCeiling({ ...buildReport([...complete(), ...nulls]), spawnOffset: check })
  assert.ok(bad.some((l) => /spawn_offset/.test(l) && /measure/.test(l) && /0 spawn reading/.test(l)), bad.join('; '))
  // a launch record that lost its milestones altogether (shell log gone) counts as unread too
  const lost = [1, 2, 3].map((s) => record('smoke', s, GOOD.smoke))
  assert.equal(spawnOffsetCheck(lost).unread, 3)
  assert.ok(overCeiling({ ...buildReport(lost), spawnOffset: spawnOffsetCheck(lost) }).some((l) => /spawn_offset/.test(l)))
})

test('one unread launch, or too few readings, fails even when the readings that exist are under the ceiling', () => {
  const some = [launchWithOffset(1, 100), launchWithOffset(2, 100), launchWithOffset(3, 100), record('measure', 4, GOOD.measure, { milestones: { spawnOffsetMs: null } })]
  const bad = overCeiling({ ...buildReport(some), spawnOffset: spawnOffsetCheck(some) })
  assert.ok(bad.some((l) => /1 launch\(es\) with no spawn reading/.test(l)), bad.join('; '))
  const few = [launchWithOffset(1, 100), launchWithOffset(2, 100)]
  assert.ok(overCeiling({ ...buildReport(few), spawnOffset: spawnOffsetCheck(few) }).some((l) => /2 spawn reading/.test(l) && /3 needed/.test(l)))
  const ok = [launchWithOffset(1, 100), launchWithOffset(2, 100), launchWithOffset(3, 100)]
  assert.deepEqual(overCeiling({ ...buildReport(ok), spawnOffset: spawnOffsetCheck(ok) }).filter((l) => /spawn_offset/.test(l)), [])
})

test('the check is computed per build: a slow smoke launch is not hidden by fast measure launches', () => {
  const recs = [1, 2, 3].map((s) => launchWithOffset(s, 60)).concat([1, 2, 3].map((s) => ({ ...launchWithOffset(s, 140), build: 'smoke', file: `D:/x/smoke-${s}.json` })))
  const check = spawnOffsetCheck(recs)
  assert.equal(check.builds.measure.medianMs, 60)
  assert.equal(check.builds.smoke.medianMs, 140)
  assert.equal(check.builds.smoke.verdict, 'within-ceiling')
  assert.equal(check.builds.measure.verdict, 'within-target')
})

test('report.mjs --check --strict exits 4 for a 151 ms launch and 0 at 150 ms (the CLI path, end to end)', () => {
  const run = (offset) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-cli-'))
    try {
      const read100 = launchWithOffset(0, 100).milestones // every counted launch of the folder needs its own reading
      const recs = [...complete().map((r) => (r.mode === 'rows' ? { ...r, milestones: read100 } : r)), ...[1, 2, 3].map((s) => launchWithOffset(s + 10, s === 2 ? offset : 100, { file: undefined }))]
      recs.forEach((r, i) => { const { file, ...rest } = r; fs.writeFileSync(path.join(dir, `r${i}.json`), JSON.stringify(rest)) })
      return spawnSync(process.execPath, [fileURLToPath(new URL('../report.mjs', import.meta.url)), dir, '--check', '--strict'], { encoding: 'utf8', windowsHide: true })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  const over = run(151)
  assert.match(over.stderr, /spawn_offset/, over.stderr + over.stdout)
  assert.equal(over.status, 4, over.stderr + over.stdout)
  const at150 = run(150)
  assert.equal(at150.status, 0, at150.stderr + at150.stdout)
})

// Issue: the spawn-offset check pooled provisional with accepted readings, needed no minimum count and never failed --check.
test('spawn offset: accepted readings win over provisional ones, and provisional-only readings carry the PROVISIONAL label', () => {
  const mixed = spawnOffsetCheck([...[1, 2, 3, 4, 5].map((s) => launchWithOffset(s, 100)), launchWithOffset(6, 140, { status: 'provisional' })])
  assert.equal(mixed.label, 'ACCEPTED')
  assert.equal(mixed.readings, 5)
  assert.equal(mixed.worstMs, 100)
  const loaded = spawnOffsetCheck([1, 2, 3, 4, 5].map((s) => launchWithOffset(s, 30, { status: 'provisional' })))
  assert.equal(loaded.verdict, 'within-target')
  assert.equal(loaded.label, 'PROVISIONAL')
  const recs = [1, 2, 3, 4, 5].map((s) => launchWithOffset(s, 30, { status: 'provisional' }))
  const line = reportLines({ ...buildReport(recs), spawnOffset: spawnOffsetCheck(recs) }, recs).find((l) => l.startsWith('check spawn_offset'))
  assert.match(line, /PROVISIONAL/)
})

test('spawn offset: fewer readings than minRuns is too-few, never within-target (one provisional 30 ms record included)', () => {
  const one = spawnOffsetCheck([launchWithOffset(1, 30, { status: 'provisional' })])
  assert.equal(one.verdict, 'too-few')
  assert.equal(one.label, 'PROVISIONAL')
  assert.equal(spawnOffsetCheck([1, 2, 3, 4].map((s) => launchWithOffset(s, 30)), { minRuns: 5 }).verdict, 'too-few')
  assert.equal(spawnOffsetCheck([1, 2, 3, 4, 5].map((s) => launchWithOffset(s, 30)), { minRuns: 5 }).verdict, 'within-target')
  assert.equal(spawnOffsetCheck([launchWithOffset(1, 400)]).verdict, 'over-ceiling')
})

test('spawn offset: --check fails on a missing, too-few or unread spawn-offset check (born failing)', () => {
  const launches = (n) => Array.from({ length: n }, (_, i) => launchWithOffset(i + 1, 100))
  const problemsOf = (recs, opts) => checkEvidence(recs, { ...buildReport(recs), spawnOffset: spawnOffsetCheck(recs, opts) })
  assert.deepEqual(problemsOf(launches(5), { minRuns: 5 }).filter((p) => /spawn_offset/.test(p)), [])
  // counted G2 launches none of which has a spawn line: missing (and unread), not 'check ok'
  assert.ok(problemsOf(complete()).some((p) => /spawn_offset/.test(p) && /no reading/.test(p)))
  assert.ok(problemsOf(launches(2)).some((p) => /spawn_offset/.test(p) && /2 on the measure build/.test(p) && /3 needed/.test(p)))
  const noSpawn = record('measure', 9, GOOD.measure, { milestones: shellMilestones(parseShell(JSON.stringify({ t: SPAWN_T0 + 20, event: 'start' })), SPAWN_T0) })
  assert.ok(problemsOf([...launches(5), noSpawn]).some((p) => /spawn_offset/.test(p) && /1 of 6/.test(p) && /no spawn line/.test(p)))
  const bare = complete()
  assert.deepEqual(checkEvidence(bare, buildReport(bare)), [])
})
