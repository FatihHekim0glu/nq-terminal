// The start-path parity check (perf-5). The fixture backend is started two ways, one after the other, on two spare ports:
//   shell  the way the shell starts it (the interpreter switches and the BASE_ENV-only environment of supervise_check.rs), port 8792;
//   plain  `python -m` with the parent environment and the launcher's stdin control, port 8791.
// Each start gets the TOKEN and NONCE lines on stdin like a real launcher, is left to settle, and its interpreter's private working
// set, private bytes and thread count are read. The run fails (exit 1) when the private working sets differ by more than 5 MB or the
// thread counts differ. Fixture data only (NQT_FIXTURE_DIR inside backend/tests/fixtures), no window, never 8765, and only the
// processes this run started are ended (by identity). --shell-port and --plain-port move the two ports when a spare one is busy. Output: parity.json in the run folder.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { sleep } from '../lib/cdp.mjs'
import { LAB, TERMINAL } from '../lib/paths.mjs'
import { proofOk } from '../lib/proc.mjs'
import { stopOwned } from '../lib/stop.mjs'
import { memTree, treeIdentity } from '../lib/mem.mjs'
import { MB } from '../lib/rows.mjs'
import { PARITY, shellStart, plainStart, compareParity, pickInterpreter, summariseRuns } from '../lib/parity.mjs'

const BACKEND_DIR = path.join(TERMINAL, 'backend')
const FIXTURE_DIR = path.join(BACKEND_DIR, 'tests', 'fixtures')
const STATE_ROOT = 'D:\\dev\\tmp'
const READY_TIMEOUT_MS = 90_000
const round1 = (v) => Math.round(v * 10) / 10

/** Thread count of one process (the interpreter, not the tree). */
export function threadCount(pid) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).Threads.Count`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  return Number(out.trim())
}

function waitReady(child) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`no NQT-READY in ${READY_TIMEOUT_MS / 1000} s`)), READY_TIMEOUT_MS)
    child.stdout.on('data', (d) => { buf += d; if (/^NQT-READY /m.test(buf)) { clearTimeout(timer); resolve() } })
    child.stderr.on('data', () => {})
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the backend exited early (${code})`)) })
  })
}

/** One start: spawn hidden, hand over the token, wait for READY, settle, read the interpreter, stop what this run started. */
async function measureStart(label, spec, port, settleS) {
  if (await proofOk(port)) throw new Error(`port ${port} already answers; not started by this harness`)
  const stateDir = fs.mkdtempSync(path.join(STATE_ROOT, `nqt-parity-${label}-`))
  const child = spawn(spec.python, spec.args, { cwd: BACKEND_DIR, env: { ...spec.env, NQT_STATE_DIR: stateDir }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let tree = []
  const row = { label, port, args: spec.args }
  try {
    child.stdin.write(`TOKEN ${crypto.randomBytes(32).toString('hex')}\nNONCE ${crypto.randomBytes(32).toString('hex')}\n`)
    const t0 = Date.now()
    await waitReady(child)
    row.readyMs = Date.now() - t0
    await sleep(settleS * 1000)
    tree = treeIdentity(child.pid)
    const procs = memTree(child.pid).procs
    const py = pickInterpreter(Array.isArray(procs) ? procs : procs ? [procs] : [])
    if (!py) throw new Error('no python process in the start\'s tree')
    Object.assign(row, { pid: py.pid, wsPrivateMB: round1(py.wsPrivate / MB), privateBytesMB: round1(py.privateBytes / MB), threads: threadCount(py.pid) })
  } catch (e) { row.fatal = String((e && e.message) || e).slice(0, 300) } finally {
    try { child.stdin.end() } catch { /* already closed */ }
    await sleep(2000)
    const stopped = await stopOwned(child, tree, { wait: () => sleep(1500) })
    row.survivors = stopped.survivors.length
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
  return row
}

export async function run({ args, outDir }) {
  const dry = args.flag('dry')
  const runs = Number(args.opt('runs', 1))
  const settleS = Number(args.opt('settle-s', dry ? 2 : 6))
  const ports = { shell: Number(args.opt('shell-port', PARITY.shellPort)), plain: Number(args.opt('plain-port', PARITY.plainPort)) }
  const base = { lab: LAB, stateDir: '(set per start)', fixtureDir: FIXTURE_DIR }
  const rows = { shell: [], plain: [] }
  for (let i = 0; i < runs; i++) {
    // Alternate which start goes first so a drifting machine shows in both.
    const order = i % 2 === 0 ? ['shell', 'plain'] : ['plain', 'shell']
    for (const label of order) {
      const spec = label === 'shell' ? shellStart(process.env, { ...base, port: ports.shell }) : plainStart(process.env, { ...base, port: ports.plain })
      rows[label].push(await measureStart(label, spec, ports[label], settleS))
    }
  }
  const failedStarts = [...rows.shell, ...rows.plain].filter((r) => r.fatal).map((r) => `${r.label}: ${r.fatal}`)
  const shell = summariseRuns(rows.shell.filter((r) => !r.fatal))
  const plain = summariseRuns(rows.plain.filter((r) => !r.fatal))
  const verdict = compareParity(shell.runs ? shell : null, plain.runs ? plain : null)
  const problems = [...failedStarts, ...verdict.problems, ...(shell.threadsStable && plain.threadsStable ? [] : ['the thread count changed between runs of one start'])]
  const result = { schema: 'd5-parity-1', mode: 'parity', dry, runs, settleS, ports, maxWsDeltaMB: PARITY.maxWsDeltaMB, shell, plain, wsDeltaMB: verdict.wsDeltaMB, pass: problems.length === 0, problems, rows }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'parity.json'), JSON.stringify(result, null, 1) + '\n', 'utf8')
  console.log(JSON.stringify({ mode: 'parity', pass: result.pass, wsDeltaMB: result.wsDeltaMB, shell: { ws: shell.wsPrivateMB, threads: shell.threads }, plain: { ws: plain.wsPrivateMB, threads: plain.threads }, problems }))
  if (!result.pass) console.error(`parity FAILED: ${problems.join('; ')}`)
  return { ...result, failed: !result.pass }
}
