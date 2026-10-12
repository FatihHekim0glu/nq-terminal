// The start-up rows (Roadmap v2, startup.md section 11; informational in wave w1). Every test reads the committed excerpts in
// fixtures/startrows (log lines of the 0.3.2 G2 run, paths removed) or a log built in the test; none reads D:.
//   usual-*.txt   one shared shell.log and backend.log holding four usual launches
//   first-*.txt   one first launch (.txt, not .log: the repository ignores *.log)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  splitShellLaunches, splitBackendLaunches, startRowsOfLogs, startRowsOfFiles, parseRequestLine, summariseStartRows,
  importTimeCommand, summariseImportRuns, NEEDED_FLAGS, stampImportBackend, startRowLines, startRowsOfRecord, writeImportRow,
} from '../lib/startrows.mjs'
import { parseShellLog } from '../lib/shelllog.mjs'
import { START_ROWS, ROWS } from '../lib/rows.mjs'
import { PY, TERMINAL } from '../lib/paths.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'startrows')
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8')
const usual = () => startRowsOfLogs(read('usual-shell.txt'), read('usual-backend.txt'))
const val = (launch, id) => launch.rows[id].value

test('a log with no supervise_spawned line reads missing, never 0 (born failing)', () => {
  const noSpawn = read('first-shell.txt').split('\n').filter((l) => !l.includes('"supervise_spawned"')).join('\n')
  const [l] = startRowsOfLogs(noSpawn, read('first-backend.txt')).launches
  assert.equal(l.rows.spawn_offset_ms.status, 'missing')
  assert.equal(l.rows.spawn_offset_ms.value, null)
  assert.equal(l.rows.spawn_to_ready_ms.status, 'missing', 'spawn to READY needs the spawn line too')
  assert.equal(l.rows.spawn_to_ready_ms.value, null)
  assert.match(l.rows.spawn_offset_ms.reason, /supervise_spawned/)
  assert.equal(l.rows.home_stage_ms.status, 'ok', 'the rows that do not need the spawn line are still read')
})

test('a usual-launch log holding two launches is parsed per launch; the first launch never feeds the second (born failing)', () => {
  const shell = read('usual-shell.txt').split('\n')
  // Launch 1 loses its spawn line: it must read missing, not launch 0's spawn line.
  const idx = shell.findIndex((l, i) => i > 2 && l.includes('"supervise_spawned"'))
  const cut = shell.filter((_, i) => i !== idx).join('\n')
  const out = startRowsOfLogs(cut, read('usual-backend.txt')).launches
  assert.equal(out.length, 4)
  assert.equal(out[0].rows.spawn_offset_ms.value, 585)
  assert.equal(out[1].rows.spawn_offset_ms.status, 'missing')
  assert.equal(out[1].rows.spawn_to_ready_ms.status, 'missing')
  assert.equal(out[2].rows.spawn_offset_ms.value, 441)
  // The page files of one launch are its own 107, not the shared log's 428.
  assert.deepEqual(out.map((l) => val(l, 'page_files_served')), [107, 107, 107, 107])
})

test('the usual launches read the values the research read by hand (startup.md section 4)', () => {
  const { launches } = usual()
  assert.deepEqual(launches.map((l) => val(l, 'spawn_offset_ms')), [585, 515, 441, 432])
  assert.deepEqual(launches.map((l) => val(l, 'spawn_to_ready_ms')), [1562, 1604, 1480, 1508])
  assert.deepEqual(launches.map((l) => val(l, 'home_stage_ms')), [2044, 1226, 992, 1079])
  assert.deepEqual(launches.map((l) => l.pid), [12988, 28300, 4300, 33288])
})

test('the first launch reads its own rows', () => {
  const [l] = startRowsOfLogs(read('first-shell.txt'), read('first-backend.txt')).launches
  assert.equal(val(l, 'spawn_offset_ms'), 436)
  assert.equal(val(l, 'spawn_to_ready_ms'), 1466)
  assert.equal(val(l, 'home_stage_ms'), 1833)
  assert.equal(val(l, 'page_files_served'), 107)
})

test('launches pair by the backend pid, not by position', () => {
  const sections = splitBackendLaunches(read('usual-backend.txt'))
  const swapped = sections.slice().reverse().flatMap((s) => s.lines).join('\n')
  const { launches } = startRowsOfLogs(read('usual-shell.txt'), swapped)
  assert.deepEqual(launches.map((l) => val(l, 'home_stage_ms')), [2044, 1226, 992, 1079])
})

test('a launch whose backend log is absent reads missing for the backend rows and zero is never invented', () => {
  const { launches } = startRowsOfLogs(read('usual-shell.txt'), '')
  for (const l of launches) {
    for (const id of ['home_stage_ms', 'page_files_served', 'slow_requests']) {
      assert.equal(l.rows[id].status, 'missing', id)
      assert.equal(l.rows[id].value, null, id)
    }
    assert.equal(l.rows.spawn_offset_ms.status, 'ok')
  }
  const { launches: none } = startRowsOfLogs('', '')
  assert.deepEqual(none, [])
})

test('a HOME stage that never finished reads missing, and a negative span is refused', () => {
  const unfinished = read('first-backend.txt').split('\n').filter((l) => !l.includes('prewarm finished')).join('\n')
  const [l] = startRowsOfLogs(read('first-shell.txt'), unfinished).launches
  assert.equal(l.rows.home_stage_ms.status, 'missing')
  assert.match(l.rows.home_stage_ms.reason, /prewarm finished/)
  const backwards = ['INFO:     Started server process [18564]',
    '2026-10-07 23:19:51,341 INFO nq_terminal.services.prewarm: prewarm started: 5 tasks',
    '2026-10-07 23:19:49,508 INFO nq_terminal.services.prewarm: prewarm finished: 5 of 5 tasks ok in 1.83 s'].join('\n')
  assert.equal(startRowsOfLogs(read('first-shell.txt'), backwards).launches[0].rows.home_stage_ms.status, 'missing')
})

test('page files served counts GET /assets/ lines of that launch only, and 304 answers are told apart', () => {
  const log = ['INFO:     Started server process [18564]',
    'INFO:     127.0.0.1:1 - "GET /assets/a.js HTTP/1.1" 200 OK',
    'INFO:     127.0.0.1:1 - "GET /assets/b.js HTTP/1.1" 304 Not Modified',
    'INFO:     127.0.0.1:1 - "GET /api/runs HTTP/1.1" 200 OK',
    'INFO:     Started server process [99]',
    'INFO:     127.0.0.1:1 - "GET /assets/c.js HTTP/1.1" 200 OK'].join('\n')
  const [l] = startRowsOfLogs(read('first-shell.txt'), log).launches
  assert.equal(val(l, 'page_files_served'), 2)
  assert.equal(l.rows.page_files_served.notModified, 1)
})

test('a launch that loads the page again counts every /assets/ line and also the first load apart', () => {
  const get = (p) => `INFO:     127.0.0.1:1 - "GET ${p} HTTP/1.1" 200 OK`
  const log = ['INFO:     Started server process [18564]', get('/'), get('/assets/a.js'), get('/assets/b.js'), get('/'), get('/assets/a.js'), get('/assets/b.js'), get('/assets/c.js')].join(String.fromCharCode(10))
  const [l] = startRowsOfLogs(read('first-shell.txt'), log).launches
  assert.deepEqual([val(l, 'page_files_served'), l.rows.page_files_served.firstLoad, l.rows.page_files_served.pageLoads], [5, 2, 2])
  const s = summariseStartRows([{ launches: [l] }])
  assert.equal(s.rows.page_files_served.firstLoad, 2)
})

// The per-request lines of the pre-ready slice's middleware (backend/tests/test_request_timing.py pins the same form). The 0.3.2 backend
// wrote none, so the lines are built here.
const REQ = (path_, start, end, cpu, extra = '') => `2026-10-07 23:19:50,000 INFO nq_terminal.request_timing: request timing: GET ${path_} status=200 start=${start} end=${end} wall_ms=${(end - start) * 1000} thread_cpu_ms=${cpu * 1000} process_cpu_ms=${cpu * 1500}${extra}`

test('a request line reads path, duration and thread CPU; the query string never reaches a row', () => {
  const r = parseRequestLine(REQ('/api/runs?token=abc', 10.5, 11.25, 0.125))
  assert.deepEqual({ method: r.method, path: r.path, ms: r.ms, cpuMs: r.cpuMs }, { method: 'GET', path: '/api/runs', ms: 750, cpuMs: 125 })
  const ms = parseRequestLine('2026-10-07 23:19:50,000 DEBUG nq_terminal.desktop.request_timing: GET /x start_ms=1000 end_ms=1040 cpu_ms=12')
  const wall = parseRequestLine('2026-10-07 23:19:50,000 INFO nq_terminal.request_timing: request timing: POST /api/x status=200 start=1.0 end=1.5 wall_ms=480.25 thread_cpu_ms=3.5 process_cpu_ms=9')
  assert.deepEqual({ method: wall.method, ms: wall.ms, cpuMs: wall.cpuMs }, { method: 'POST', ms: 480.3, cpuMs: 3.5 }, 'wall_ms and thread_cpu_ms are the figures when present')
  assert.deepEqual({ ms: ms.ms, cpuMs: ms.cpuMs }, { ms: 40, cpuMs: 12 })
  const loop = parseRequestLine('2026-10-07 23:19:50,000 INFO nq_terminal.request_timing: request timing: GET /api/x status=200 start=1.0 end=1.5 wall_ms=500.0 event_loop_cpu_ms=4.5 process_cpu_ms=9')
  assert.equal(loop.cpuMs, 4.5, 'event_loop_cpu_ms is read, as thread_cpu_ms of older lines is')
  assert.equal(parseRequestLine('INFO:     127.0.0.1:1 - "GET /api/runs HTTP/1.1" 200 OK'), null)
  assert.equal(parseRequestLine(REQ('/x', 5, 4, 0.1)), null, 'an end before the start is not a reading')
})

test('the slowest five requests of the HOME window are listed with their thread CPU', () => {
  const lines = ['INFO:     Started server process [18564]',
    '2026-10-07 23:19:49,508 INFO nq_terminal.services.prewarm: prewarm started: 5 tasks',
    ...[['/a', 0, 0.1, 0.01], ['/b', 0, 0.9, 0.5], ['/c', 0, 0.3, 0.2], ['/d', 0, 0.5, 0.05], ['/e', 0, 0.2, 0.2], ['/f', 0, 0.7, 0.6], ['/g', 0, 0.05, 0.01]].map(([p, s, e, c]) => REQ(p, s, e, c)),
    '2026-10-07 23:19:51,341 INFO nq_terminal.services.prewarm: prewarm finished: 5 of 5 tasks ok in 1.83 s']
  const [l] = startRowsOfLogs(read('first-shell.txt'), lines.join('\n')).launches
  const row = l.rows.slow_requests
  assert.equal(row.status, 'ok')
  assert.deepEqual(row.items.map((i) => [i.path, i.ms, i.cpuMs]), [['/b', 900, 500], ['/f', 700, 600], ['/d', 500, 50], ['/c', 300, 200], ['/e', 200, 200]])
  assert.equal(row.value, 900)
  assert.equal(row.window, 7)
})

test('a request that began in the HOME window and was logged after the prewarm finished line still counts (the middleware writes at the request end)', () => {
  const lines = ['INFO:     Started server process [18564]',
    REQ('/early', 0, 0.2, 0.01), // began and ended before the prewarm started line: the window was already open
    '2026-10-07 23:19:49,508 INFO nq_terminal.services.prewarm: prewarm started: 5 tasks',
    REQ('/fast', 1, 1.05, 0.001),
    '2026-10-07 23:19:51,341 INFO nq_terminal.services.prewarm: prewarm finished: 5 of 5 tasks ok in 1.83 s',
    REQ('/straddler', 1.1, 1.95, 0.002)] // began before the stage end, finished after it
  const [l] = startRowsOfLogs(read('first-shell.txt'), lines.join('\n')).launches
  const row = l.rows.slow_requests
  assert.deepEqual(row.items.map((i) => [i.path, i.ms]), [['/straddler', 850], ['/early', 200], ['/fast', 50]])
  assert.equal(row.value, 850)
  assert.equal(row.window, 3)
})

test('a launch whose log holds no request line reads missing (the backend predates the middleware), never an empty list', () => {
  const [l] = startRowsOfLogs(read('first-shell.txt'), read('first-backend.txt')).launches
  assert.equal(l.rows.slow_requests.status, 'missing')
  assert.equal(l.rows.slow_requests.value, null)
  assert.ok(!('items' in l.rows.slow_requests) || l.rows.slow_requests.items.length === 0)
})

test('splitters keep the lines of each launch apart', () => {
  const events = parseShellLog(read('usual-shell.txt'))
  const parts = splitShellLaunches(events)
  assert.equal(parts.length, 4)
  assert.ok(parts.every((p) => p[0].event === 'start' && p.filter((e) => e.event === 'start').length === 1))
  assert.deepEqual(splitBackendLaunches(read('usual-backend.txt')).map((s) => s.pid), [12988, 28300, 4300, 33288])
  assert.deepEqual(splitBackendLaunches('no launch marker here\n'), [])
})

test('the summary takes the median per row over every launch and counts what is missing', () => {
  const s = summariseStartRows([usual(), startRowsOfLogs(read('first-shell.txt'), read('first-backend.txt'))])
  assert.equal(s.launches, 5)
  assert.equal(s.rows.spawn_offset_ms.n, 5)
  assert.equal(s.rows.spawn_offset_ms.median, 441)
  assert.equal(s.rows.spawn_to_ready_ms.median, 1508)
  assert.equal(s.rows.page_files_served.median, 107)
  assert.equal(s.rows.slow_requests.n, 0)
  assert.equal(s.rows.slow_requests.missing, 5)
})

test('startRowsOfFiles reads the two logs and reports an unreadable one as missing', () => {
  const ok = startRowsOfFiles(path.join(FIX, 'first-shell.txt'), path.join(FIX, 'first-backend.txt'))
  assert.equal(val(ok.launches[0], 'home_stage_ms'), 1833)
  const gone = startRowsOfFiles(path.join(FIX, 'nope-shell.log'), path.join(FIX, 'first-backend.txt'))
  assert.equal(gone.launches.length, 0)
  assert.match(gone.problems.join(' '), /shell log/)
  const noBack = startRowsOfFiles(path.join(FIX, 'first-shell.txt'), path.join(FIX, 'nope-backend.log'))
  assert.equal(noBack.launches[0].rows.home_stage_ms.status, 'missing')
  assert.match(noBack.problems.join(' '), /backend log/)
})

test('the HOME stage row says its task list differs from the base build and names the rows that decide a before/after comparison', () => {
  const def = START_ROWS.find((r) => r.id === 'home_stage_ms')
  assert.match(def.method, /task list differs/)
  assert.match(def.method, /runs/)
  assert.match(def.method, /cold_home/)
  const s = summariseStartRows([startRowsOfLogs(read('first-shell.txt'), read('first-backend.txt'))])
  const line = startRowLines(s, 'smoke', 'informational, not the row')[0]
  assert.match(line, /HOME stage 1833 ms \(task list differs: base build includes runs\)/)
})

test('the start rows are informational: listed, with no target or ceiling, and apart from the G2 rows', () => {
  assert.deepEqual(START_ROWS.map((r) => r.id), ['spawn_offset_ms', 'spawn_to_ready_ms', 'home_stage_ms', 'page_files_served', 'import_time_ms', 'modules_without_bytecode', 'slow_requests'])
  assert.ok(START_ROWS.every((r) => r.informational === true && r.target === undefined && r.ceiling === undefined && r.method))
  assert.ok(START_ROWS.every((r) => !ROWS.some((g) => g.id === r.id)))
})

// ---- the in-process import time (importtime.py) ----------------------------------------------------------------------------
test('the import-time command uses the shell flags, a bytecode prefix and a scratch state folder under the run folder, and NQT_JOBS=off', () => {
  const run = path.join(os.tmpdir(), 'startrows-run')
  const c = importTimeCommand({ python: 'C:/lab/.venv/Scripts/python.exe', runDir: run })
  assert.equal(c.python, 'C:/lab/.venv/Scripts/python.exe')
  for (const f of NEEDED_FLAGS) assert.ok(c.args.join(' ').includes(f), f)
  assert.ok(c.args.includes(`pycache_prefix=${c.pycachePrefix}`))
  assert.ok(c.pycachePrefix.startsWith(run) && c.scratch.startsWith(run))
  assert.equal(c.env.NQT_JOBS, 'off')
  assert.ok(c.args.includes(c.scratch) && c.args.some((a) => a.endsWith('importtime.py')))
})

test('the import-time command refuses a run folder inside the repository (nothing is written to it)', () => {
  assert.throws(() => importTimeCommand({ python: 'python.exe', runDir: path.join(TERMINAL, 'desktop', 'harness', 'scratch') }), /repository/)
})

test('import runs are summarised by the median after the warm-up run, and a run without a total reads missing', () => {
  const run = (total, extra = {}) => ({ import_total_s: total, modules_loaded: 1100, bytecode: { checked: 3, missing: [], stale: [] }, ...extra })
  const s = summariseImportRuns([run(5.2), run(1.12), run(1.1), run(1.2)])
  assert.equal(s.status, 'ok')
  assert.equal(s.value, 1120)
  assert.equal(s.runs, 3)
  assert.equal(s.warmup, 5200)
  assert.equal(s.bytecode.status, 'ok')
  assert.equal(s.bytecode.value, 0)
  const bad = summariseImportRuns([run(5.2), {}])
  assert.equal(bad.status, 'missing')
  assert.equal(bad.value, null)
  assert.equal(summariseImportRuns([]).status, 'missing')
  const stale = summariseImportRuns([run(5), run(1, { bytecode: { checked: 9, missing: ['a.b'], stale: ['c'] } })])
  assert.equal(stale.bytecode.value, 2)
  assert.deepEqual(stale.bytecode.names, ['a.b', 'c'])
})

test('the import row keeps the backend tree, the interpreter, its version and the flags of the runs (born failing)', () => {
  const id = { nq_terminal_file: 'E:/t/wt/backend/nq_terminal/app.py', executable: 'C:/lab/.venv/Scripts/python.exe', python: '3.13.5 (tags) [MSC]', flags: { ignore_environment: 1, no_user_site: 1, utf8_mode: 1 } }
  const run = (total) => ({ import_total_s: total, modules_loaded: 1100, bytecode: { checked: 3, missing: [], stale: [] }, ...id })
  const s = summariseImportRuns([run(5), run(1.1), run(1.2)])
  assert.equal(s.tree, 'E:/t/wt/backend')
  assert.equal(s.executable, id.executable)
  assert.equal(s.pythonVersion, '3.13.5')
  assert.deepEqual(s.flags, id.flags)
  assert.equal(summariseImportRuns([{ import_total_s: 5 }, { import_total_s: 1 }]).tree, null, 'a run that names no tree leaves it null')
})

const importRowOf = (tree) => ({ status: 'ok', value: 900, reason: null, tree, executable: 'C:/lab/.venv/Scripts/python.exe', pythonVersion: '3.13.5', flags: {} })

test('stampImportBackend marks an import row timed in another backend tree than the launch used (born failing)', () => {
  const own = path.join(TERMINAL, 'backend')
  assert.equal(stampImportBackend(importRowOf(own), TERMINAL).backend, 'same')
  const other = stampImportBackend(importRowOf('D:/elsewhere/terminal/backend'), TERMINAL)
  assert.equal(other.backend, 'other')
  assert.equal(other.launchTerminal, TERMINAL)
  assert.equal(stampImportBackend(importRowOf('D:/x/terminal/backend'), 'D:/x/terminal').backend, 'same')
  assert.equal(stampImportBackend(importRowOf(null), TERMINAL).backend, 'unknown')
  assert.equal(stampImportBackend({ status: 'missing', value: null, reason: 'x' }, TERMINAL).backend, undefined, 'a missing row is left as it is')
})

test('the summary leaves an other-backend import out of the median and the report line names the tree (born failing)', () => {
  const [l] = startRowsOfLogs(read('first-shell.txt'), read('first-backend.txt')).launches
  const mk = (value, backend, tree) => ({ launches: [l], import: { status: 'ok', value, tree, backend, bytecode: { status: 'ok', value: 0 } } })
  const s = summariseStartRows([mk(900, 'same', 'E:/t/a/backend'), mk(5000, 'other', 'D:/z/backend')])
  assert.equal(s.rows.import_time_ms.n, 1)
  assert.equal(s.rows.import_time_ms.median, 900)
  assert.equal(s.rows.import_time_ms.otherBackend, 1)
  assert.deepEqual(s.rows.import_time_ms.trees, ['E:/t/a/backend'])
  const line = startRowLines(s, 'smoke', 'info')[0]
  assert.match(line, /import time 900 ms \(tree E:\/t\/a\/backend; 1 of 2 record\(s\) timed another backend\)/)
  const only = summariseStartRows([mk(5000, 'other', 'D:/z/backend')])
  assert.match(startRowLines(only, 'measure', 'info')[0], /import time other backend \(tree D:\/z\/backend\)/)
  assert.equal(only.rows.modules_without_bytecode.n, 0, 'the bytecode check of another backend is not this build\'s either')
})

// importtime.py itself, run with the lab's interpreter (a stand-in venv on CI; no application module is imported by these cases).
const havePy = fs.existsSync(PY)
const py = (args, opts = {}) => spawnSync(PY, ['-E', '-s', '-X', 'utf8', path.join(TERMINAL, 'desktop', 'harness', 'lib', 'importtime.py'), ...args], { encoding: 'utf8', windowsHide: true, ...opts })

test('importtime.py reads a module as current, stale or missing without writing bytecode', { skip: !havePy && 'no lab interpreter' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startrows-pyc-'))
  try {
    const src = path.join(dir, 'm.py')
    fs.writeFileSync(src, 'X = 1\n')
    const gone = py(['--check-bytecode', src])
    assert.equal(gone.status, 0, gone.stderr)
    assert.equal(JSON.parse(gone.stdout)[src], 'missing')
    assert.ok(!fs.existsSync(path.join(dir, '__pycache__')), 'the check wrote no bytecode')
    const compiled = spawnSync(PY, ['-E', '-s', '-m', 'py_compile', src], { encoding: 'utf8', windowsHide: true })
    assert.equal(compiled.status, 0, compiled.stderr)
    assert.equal(JSON.parse(py(['--check-bytecode', src]).stdout)[src], 'current')
    const later = new Date(Date.now() + 60_000)
    fs.utimesSync(src, later, later)
    assert.equal(JSON.parse(py(['--check-bytecode', src]).stdout)[src], 'stale', 'a source newer than its bytecode is stale')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('importtime.py refuses to import the application without a bytecode prefix outside the repository (born failing)', { skip: !havePy && 'no lab interpreter' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startrows-refuse-'))
  try {
    const scratch = path.join(dir, 's')
    fs.mkdirSync(scratch)
    const none = py(['--scratch', scratch])
    assert.equal(none.status, 2, none.stdout + none.stderr)
    assert.match(none.stderr, /pycache_prefix/)
    const inside = spawnSync(PY, ['-B', '-E', '-s', '-X', 'utf8', '-X', `pycache_prefix=${path.join(TERMINAL, 'desktop', 'pyc-x')}`, path.join(TERMINAL, 'desktop', 'harness', 'lib', 'importtime.py'), '--scratch', scratch], { encoding: 'utf8', windowsHide: true })
    assert.equal(inside.status, 2, inside.stdout + inside.stderr)
    assert.deepEqual(fs.readdirSync(scratch), [], 'a refused run writes nothing')
    assert.equal(fs.existsSync(path.join(TERMINAL, 'desktop', 'pyc-x')), false)
    const absent = spawnSync(PY, ['-E', '-s', '-X', 'utf8', '-X', `pycache_prefix=${path.join(dir, 'pyc')}`, path.join(TERMINAL, 'desktop', 'harness', 'lib', 'importtime.py'), '--scratch', path.join(dir, 'nope')], { encoding: 'utf8', windowsHide: true })
    assert.equal(absent.status, 2, absent.stdout + absent.stderr)
    assert.match(absent.stderr, /does not exist/)
    assert.equal(fs.existsSync(path.join(dir, 'nope')), false, 'the script does not make the scratch folder')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// Reading the rows back from a record (wave w1). The start rows are read from the run folder the record names, after the launch:
// no launch path carries them. A smoke record names <run>/state, whose logs sit beside <run>/config/logs/shell.log; the import row is
// taken once per run set by `node startrows.mjs import-time OUTDIR`, which writes OUTDIR/importtime/import-time.json, and the record
// files of that folder pick it up.
const IMPORT = { status: 'ok', value: 777, reason: null, tree: path.join(TERMINAL, 'backend'), bytecode: { status: 'ok', value: 0 } }

/** A run folder holding the logs a smoke launch leaves, and the record that names it. */
function seededRecord(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startrows-rec-'))
  const runDir = path.join(dir, 'launch', 'smoke-s1-a1')
  fs.mkdirSync(path.join(runDir, 'config', 'logs'), { recursive: true })
  fs.mkdirSync(path.join(runDir, 'state', 'logs'), { recursive: true })
  fs.writeFileSync(path.join(runDir, 'config', 'logs', 'shell.log'), read('first-shell.txt'))
  fs.writeFileSync(path.join(runDir, 'state', 'logs', 'backend.log'), read('first-backend.txt'))
  const record = { build: 'smoke', stateFolder: path.join(runDir, 'state'), file: path.join(dir, 'smoke-s1-a1.json'), ...over }
  return { dir, record, done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('startRowsOfRecord reads the launch rows back from the run folder the record names', () => {
  const r = seededRecord()
  try {
    const rows = startRowsOfRecord(r.record)
    assert.equal(rows.launches.length, 1)
    assert.equal(rows.launches[0].rows.spawn_offset_ms.status, 'ok', 'the shell log was read')
    assert.equal(rows.launches[0].rows.home_stage_ms.status, 'ok', 'the backend log was read')
    assert.equal('import' in rows, false, 'no import file beside the record, no import row')
  } finally { r.done() }
})

test('startRowsOfRecord takes the run set import row from the importtime folder beside the record (born failing)', () => {
  const r = seededRecord()
  try {
    writeImportRow(path.dirname(r.record.file), IMPORT)
    const rows = startRowsOfRecord(r.record)
    assert.equal(rows.import?.value, 777, 'the import row reaches the record rows')
    assert.equal(rows.import.backend, 'same', 'and is stamped against the tree of this harness')
    assert.equal(summariseStartRows([rows]).rows.import_time_ms.median, 777)
  } finally { r.done() }
})

test('startRowsOfRecord leaves an unreadable import file out and says so', () => {
  const r = seededRecord()
  try {
    const dest = path.join(path.dirname(r.record.file), 'importtime')
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, 'import-time.json'), '{not json')
    const rows = startRowsOfRecord(r.record)
    assert.equal('import' in rows, false)
    assert.ok(rows.problems.some((p) => /import-time\.json/.test(p)))
  } finally { r.done() }
})

test('a record that carries its own startRows keeps them, and the measure build is not read back', () => {
  const own = { schema: 'start-rows-1', launches: [] }
  assert.equal(startRowsOfRecord({ build: 'smoke', startRows: own }), own)
  assert.equal(startRowsOfRecord({ build: 'measure', stateFolder: 'D:/lab/terminal/state', file: 'x.json' }), null)
})

test('writeImportRow writes the row where startRowsOfRecord looks for it, and a missing row too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startrows-imp-'))
  try {
    const file = writeImportRow(dir, { status: 'missing', value: null, reason: 'x' })
    assert.equal(file, path.join(dir, 'importtime', 'import-time.json'))
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).status, 'missing')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
