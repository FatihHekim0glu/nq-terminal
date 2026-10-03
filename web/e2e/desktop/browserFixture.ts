// The browser fixture backend (backend/tests/fixture_app.py under uvicorn, the one e2e/playwright.config.ts starts) for the
// desktop project's parity checks: the same synthetic serve and catalogue, started on a spare table port with a state folder
// of its own, so what the app-launched fixture backend answers can be compared with what the browser's answers. Nothing here
// touches 8765 or any other process; the backend is ended with the tree this file started.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { mintCode, readLock, verifyBackend } from '../../scripts/start/session.ts'
import { OWNER_PORT, TERMINAL_DIR, endOwnedTree, newRunDir } from './launch.ts'

/** The W0A probes row of the port table (8796), free since W0A; NQT_PARITY_PORT moves it. */
export const PARITY_PORT_DEFAULT = 8796
const MACHINE_SETTINGS = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C'] as const
const START_WAIT_MS = 90_000

export interface BrowserFixture {
  readonly origin: string
  /** `GET` a path with the session this fixture minted; the body as text. */
  readonly get: (pathAndQuery: string) => Promise<{ status: number; text: string }>
  readonly stop: () => void
}

function parityPort(): number {
  const port = Number(process.env.NQT_PARITY_PORT ?? PARITY_PORT_DEFAULT)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || port === OWNER_PORT) throw new Error(`the parity backend needs a spare port other than ${OWNER_PORT}; got ${port}`)
  return port
}

function realLabPython(): string {
  const real = process.env.NQT_REAL_LAB ?? path.join(process.env.USERPROFILE ?? '', 'nq-lab')
  const python = path.join(real, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(python)) throw new Error(`no lab interpreter at ${python} (set NQT_REAL_LAB)`)
  return python
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function proofAnswers(port: number): Promise<boolean> {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/api/desktop/proof?nonce=${'0'.repeat(64)}`)
    return reply.status === 200
  } catch {
    return false
  }
}

/** Starts the fixture backend on its table port and opens a session on it. */
export async function startBrowserFixture(): Promise<BrowserFixture> {
  const port = parityPort()
  if (await proofAnswers(port)) throw new Error(`port ${port} already answers; the parity backend does not share a port`)
  const runDir = newRunDir('parity')
  const stateDir = path.join(runDir, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const tests = path.join(TERMINAL_DIR, 'backend', 'tests')
  const env: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(MACHINE_SETTINGS.map((k) => [k, ''])), NQT_STATE_DIR: stateDir, NQT_FIXTURE_DIR: path.join(tests, 'fixtures'), NQT_PORT: String(port), PYTHONUTF8: '1' }
  const out = fs.openSync(path.join(runDir, 'backend.out.log'), 'w')
  const err = fs.openSync(path.join(runDir, 'backend.err.log'), 'w')
  const child = spawn(realLabPython(), ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', tests, '--host', '127.0.0.1', '--port', String(port)], { env, cwd: path.join(TERMINAL_DIR, 'backend'), stdio: ['ignore', out, err], windowsHide: true })
  fs.closeSync(out)
  fs.closeSync(err)
  const pid = child.pid
  if (pid === undefined) throw new Error('the parity backend did not start')
  const stop = (): void => void endOwnedTree(pid, () => child.exitCode !== null || child.signalCode !== null)
  try {
    const end = Date.now() + START_WAIT_MS
    while (!(await proofAnswers(port))) {
      if (Date.now() > end || child.exitCode !== null) throw new Error(`the parity backend did not answer on ${port}; see ${runDir}`)
      await sleep(300)
    }
    const lock = readLock(stateDir)
    if (lock === null) throw new Error(`no backend.lock in ${stateDir}`)
    if (!(await verifyBackend(lock.token, port, lock.port))) throw new Error('the parity backend did not prove that it holds its token')
    const code = await mintCode(port, lock.token)
    if (code === null) throw new Error('the parity backend issued no launch code')
    const redeemed = await fetch(`http://127.0.0.1:${port}/api/session/redeem`, { headers: { 'X-NQT-Code': code } })
    const cookie = (redeemed.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
    if (redeemed.status !== 200 || cookie === '') throw new Error(`the parity backend refused its launch code (HTTP ${redeemed.status})`)
    const origin = `http://127.0.0.1:${port}`
    return {
      origin,
      get: async (pathAndQuery) => {
        const reply = await fetch(`${origin}${pathAndQuery}`, { headers: { cookie, 'X-NQT-Client': 'nq-lab-terminal' } })
        return { status: reply.status, text: await reply.text() }
      },
      stop,
    }
  } catch (error) {
    stop()
    throw error
  }
}
