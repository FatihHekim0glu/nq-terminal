// The backends the harness starts itself (never the shell's: those the shell spawns and the harness only reads):
//  - the fixture backend on the T2 port (fixture_app, same origin as the page), for the reproduction of the W0B figures;
//  - the real backend alone, for the standalone backend-ready reading (the W0B baseline method: process start to the
//    first answer).
// Both are started hidden, with a PYTHONPATH naming this tree's backend (so a worktree imports itself, not the editable
// install of the main tree; `-E` ignores it and the working folder does the same job), and stopped by creation-time-checked
// pids only. Never port 8765.
//
// Since D2 every /api path but the shell routes is behind the session token, so /api/health answers 401 to a bare request. The
// harness asks the desktop proof route (200 with no session) whether a backend is up, and gets a session the way a launcher does:
// the token from the backend's lock, a one-time launch code, and a redeem on the page's origin.
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './cdp.mjs'
import { stopOwned } from './stop.mjs'
import { proofOk, spawnHidden } from './proc.mjs'
import { PY, TERMINAL, assertPortAllowed } from './paths.mjs'
import { treeIdentity } from './mem.mjs'

const MACHINE_SETTINGS = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C']
const blank = () => Object.fromEntries(MACHINE_SETTINGS.map((k) => [k, '']))
const BACKEND_DIR = path.join(TERMINAL, 'backend')
const LOOPBACK = '127.0.0.1'
const CODE_PATTERN = /^[0-9a-f]{64}$/

export const healthOk = proofOk

/** The lock of a backend's state folder: { pid, port, token } or null (backend.lock, version 1). */
export function readLock(stateDir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(stateDir, 'backend.lock'), 'utf8'))
    if (doc.v !== 1 || !/^[0-9a-f]{64}$/.test(doc.token ?? '')) return null
    return { pid: doc.pid, port: doc.port, token: doc.token }
  } catch { return null }
}

async function waitLock(stateDir, ms) {
  const end = Date.now() + ms
  for (;;) {
    const lock = readLock(stateDir)
    if (lock) return lock
    if (Date.now() > end) throw new Error(`no backend.lock in ${stateDir}`)
    await sleep(100)
  }
}

/** A one-time launch code (valid 60 s, single use) minted with the token of the backend in `stateDir`. */
export async function mintCode(port, stateDir) {
  const lock = await waitLock(stateDir, 30_000)
  const r = await fetch(`http://${LOOPBACK}:${port}/api/session/code`, { headers: { authorization: `NQT ${lock.token}` }, signal: AbortSignal.timeout(5000) })
  if (r.status !== 200) throw new Error(`the backend refused a launch code (HTTP ${r.status})`)
  const code = (await r.json()).code
  if (!CODE_PATTERN.test(code ?? '')) throw new Error('the backend returned a malformed launch code')
  return code
}

/** The launch page address for a fresh code: the page redeems it from its fragment and leaves for the terminal. */
export async function launchLink(port, stateDir) {
  return `http://${LOOPBACK}:${port}/session.html#${await mintCode(port, stateDir)}`
}

/** A session cookie header value for Node-side GETs (the warm-up): mint a code and redeem it on the backend's own origin. */
export async function sessionCookie(port, stateDir) {
  const code = await mintCode(port, stateDir)
  const origin = `http://${LOOPBACK}:${port}`
  const r = await fetch(`${origin}/api/session/redeem`, { headers: { 'x-nqt-code': code, origin }, signal: AbortSignal.timeout(5000) })
  if (r.status !== 200) throw new Error(`the launch code was refused (HTTP ${r.status})`)
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
  if (cookies.length === 0) throw new Error('the redeem set no session cookie')
  return cookies.join('; ')
}

export async function startFixtureBackend(port, logDir, stateDir = path.join('D:\\dev\\tmp', `nqt-repro-state-${process.pid}-${Date.now()}`)) {
  assertPortAllowed(port)
  if (await proofOk(port)) throw new Error(`port ${port} already answers; not started by this harness`)
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(stateDir, { recursive: true })
  const env = { ...blank(), NQT_PORT: String(port), PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR, NQT_STATE_DIR: stateDir, NQT_JOBS: 'off', NQT_FIXTURE_DIR: path.join(BACKEND_DIR, 'tests', 'fixtures'), NQT_FIXTURE_JOBS: 'fake', NQT_FIXTURE_LOG_DIR: logDir }
  const t0 = Date.now()
  const out = fs.openSync(path.join(logDir, 'backend.out.log'), 'w')
  const child = spawnHidden(PY, ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', path.join(BACKEND_DIR, 'tests'), '--host', LOOPBACK, '--port', String(port)], { cwd: BACKEND_DIR, env, stdio: ['ignore', out, out] })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('fixture backend exited early')
    if (await proofOk(port)) return { child, pid: child.pid, readyMs: Date.now() - t0, stateDir }
    await sleep(100)
  }
  await stopOwned(child)
  throw new Error('fixture backend never answered')
}

/** GET-only warm-up of HOME's API reads, as bench_browser.warm_home_api does, with a session cookie. */
export async function warmHomeApi(port, cookie) {
  const get = async (p) => { const r = await fetch(`http://${LOOPBACK}:${port}${p}`, { headers: { cookie }, signal: AbortSignal.timeout(120_000) }); return r.json().catch(() => null) }
  const uni = await get('/api/market/universe?window=22')
  for (const p of ['/api/market/universe?window=252', '/api/data/catalog', '/api/market/rv?symbol=NQ.V.0&window=22']) await get(p)
  for (const r of uni.rows) await get(`/api/market/two-day?symbols=${r.symbol}`)
  return uni.rows.length
}

/**
 * One standalone backend-ready reading: `-E -s -X utf8 -m nq_terminal` from this tree's backend folder with a temporary state
 * folder and jobs off; the figure is process start to the first answer of the proof route. The state folder is removed afterwards.
 */
export async function backendReadyOnce(port, { stateRoot = 'D:\\dev\\tmp' } = {}) {
  assertPortAllowed(port)
  if (await proofOk(port)) throw new Error(`port ${port} already answers; not started by this harness`)
  const stateDir = fs.mkdtempSync(path.join(stateRoot, 'nqt-ready-state-'))
  const env = { ...blank(), NQT_PORT: String(port), PYTHONUTF8: '1', PYTHONPATH: BACKEND_DIR, NQT_STATE_DIR: stateDir, NQT_JOBS: 'off' }
  const t0 = performance.now()
  const child = spawnHidden(PY, ['-E', '-s', '-X', 'utf8', '-m', 'nq_terminal'], { cwd: BACKEND_DIR, env })
  let tree = []
  const rec = { port, rootPid: child.pid, readyMs: null }
  try {
    const deadline = performance.now() + 60_000
    while (performance.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`backend exited early (${child.exitCode})`)
      if (await proofOk(port)) { rec.readyMs = Math.round(performance.now() - t0); break }
      await sleep(10)
    }
    if (rec.readyMs === null) throw new Error('no answer from the proof route in 60 s')
    tree = treeIdentity(child.pid)
  } catch (e) { rec.fatal = String(e.message ?? e) } finally {
    const stopped = await stopOwned(child, tree, { wait: () => sleep(1500) })
    rec.survivors = stopped.survivors
    rec.portStillAnswers = await proofOk(port)
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
  return rec
}
