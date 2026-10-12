// The automated weekly parity list, fixture mode (04 D6.2; docs/desktop/checks/2026-10-12_weekly-parity-auto.md): the 16 rows of
// the owner's weekly list that need neither the owner nor the real files (13 run, 3 are marked for the owner), run against the hidden
// smoke build's own fixture backend; row 13 (JOBS) runs on a fixture backend of its own with the fake runner, in this file.
// The app's page is the first door; the second is a headless Chromium holding the app's own session (parityAuto.ts), so the figures
// of a row are read from the DOM in both and compared. The real-lab twin is parity.app.ts. This file runs after 70-parity and before
// 90-look, whose frozen clock stays in the page for good.
//
// Each row is one test and keeps its result in the run folder (a failed test restarts the worker, which loses memory, not files);
// the last test writes the dated record and fails unless every row is green or the owner's, and the gate log reading is clean.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { mintCode, readLock, verifyBackend } from '../../scripts/start/session.ts'
import { offOriginOrNotGet } from '../perf/pages.ts'
import type { Page } from '@playwright/test'
import { expect, test as base } from './fixtures.ts'
import { failedAnswers, open, watch, type Watch } from './app.ts'
import { OWNER_PORT, TERMINAL_DIR, endOwnedTree, newRunDir } from './launch.ts'
import {
  PARITY_ROWS, compareDoors, figuresOf, firstLine, homeIn, keepResult, keptResults, openBrowserDoor, openDoorOn, readGateLogFile, recordProblems, result, runRow, writeRecord,
  type BrowserDoor, type Figures, type ParityContext, type RowRunner,
} from './parityAuto.ts'

const MODE = 'fixture'

// ---- row 13: JOBS queue and stop, on the fixture backend with the fake runner (every smoke build starts its backend with NQT_JOBS=off)

const JOBS_RUN = 't_parityauto_slow'
const JOB_WRITES = ['POST /api/jobs', 'DELETE /api/jobs/<job>']

const jobWrites = (w: Watch): string[] => w.requests.filter((r) => r.method() !== 'GET' && !r.url().includes('/api/workspaces/')).map((r) => `${r.method()} ${new URL(r.url()).pathname.replace(/j_[0-9a-f]{12}/, '<job>')}`)

async function queueAndStop(page: Page): Promise<void> {
  await homeIn(page)
  await open(page, 'JOBS')
  await page.getByRole('textbox', { name: 'Run id', exact: true }).fill(JOBS_RUN)
  await page.getByRole('button', { name: 'Queue run' }).click()
  const row = page.getByRole('row').filter({ hasText: JOBS_RUN })
  await expect(row, 'the queued row appears').toBeVisible()
  await expect(row).toContainText(/QUEUED|RUNNING/, { timeout: 30_000 })
  await row.getByRole('button', { name: `Stop the job ${JOBS_RUN}` }).click()
  await expect(page.getByRole('button', { name: 'Keep it' }), 'the stop asks to confirm').toBeFocused()
  await page.getByRole('button', { name: 'Yes, stop it' }).click()
  await expect(row, 'the row reads STOPPED').toContainText(/STOPPED/, { timeout: 30_000 })
}

export const row13: RowRunner = async () => {
  const fixture = await startJobsFixture()
  let door: BrowserDoor | undefined
  try {
    door = await openDoorOn(fixture.origin, fixture.cookie)
    const page = await door.newPage()
    const w = watch(page)
    const problems: string[] = []
    await queueAndStop(page).catch((e: unknown) => problems.push(firstLine(e)))
    const writes = jobWrites(w)
    if (writes.join() !== JOB_WRITES.join()) problems.push(`the page wrote ${writes.join(', ') || 'nothing'}; expected ${JOB_WRITES.join(', ')}`)
    const stray = offOriginOrNotGet(w, fixture.origin).filter((r) => !/^(POST|DELETE) \S+\/api\/jobs/.test(r))
    problems.push(...w.errors.map((e) => `console error: ${e}`), ...failedAnswers(w).map((a) => `failed answer: ${a}`), ...stray.map((r) => `request that was not a same-origin GET: ${r}`))
    return result(13, problems, 'run on the fixture backend with the fake runner, through the browser door: the app backend never runs jobs')
  } finally {
    await door?.close().catch(() => undefined)
    fixture.stop()
  }
}

// ---------------------------------------------------------------------------------------------------------- the fixture jobs backend

export interface JobsFixture {
  readonly origin: string
  readonly cookie: string
  readonly stop: () => void
}

const START_WAIT_MS = 90_000
const MACHINE_SETTINGS = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C'] as const
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A free loopback port from the system (bound to port 0 and let go), never the owner's. */
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (port === OWNER_PORT) throw new Error('the system offered the owner port')
  return port
}

function labPython(): string {
  const real = process.env.NQT_REAL_LAB ?? path.join(process.env.USERPROFILE ?? '', 'nq-lab')
  const python = path.join(real, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(python)) throw new Error(`no lab interpreter at ${python} (set NQT_REAL_LAB)`)
  return python
}

async function answers(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/desktop/proof?nonce=${'0'.repeat(64)}`)).status === 200
  } catch {
    return false
  }
}

/** The fixture backend with the fake runner (NQT_FIXTURE_JOBS=fake: a stand-in script, never run_base) on a free port, with a session of its own. */
export async function startJobsFixture(): Promise<JobsFixture> {
  const port = await freePort()
  const runDir = newRunDir('parity-jobs')
  const stateDir = path.join(runDir, 'state')
  fs.mkdirSync(stateDir, { recursive: true })
  const tests = path.join(TERMINAL_DIR, 'backend', 'tests')
  const env: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(MACHINE_SETTINGS.map((k) => [k, ''])), NQT_STATE_DIR: stateDir, NQT_FIXTURE_DIR: path.join(tests, 'fixtures'), NQT_FIXTURE_JOBS: 'fake', NQT_PORT: String(port), PYTHONUTF8: '1' }
  const out = fs.openSync(path.join(runDir, 'backend.out.log'), 'w')
  const err = fs.openSync(path.join(runDir, 'backend.err.log'), 'w')
  const child = spawn(labPython(), ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', tests, '--host', '127.0.0.1', '--port', String(port)], { env, cwd: path.join(TERMINAL_DIR, 'backend'), stdio: ['ignore', out, err], windowsHide: true })
  fs.closeSync(out)
  fs.closeSync(err)
  const pid = child.pid
  if (pid === undefined) throw new Error('the jobs fixture backend did not start')
  const stop = (): void => void endOwnedTree(pid, () => child.exitCode !== null || child.signalCode !== null)
  try {
    return await sessionOn(port, stateDir, child, runDir, stop)
  } catch (error) {
    stop()
    throw error
  }
}

async function sessionOn(port: number, stateDir: string, child: { exitCode: number | null }, runDir: string, stop: () => void): Promise<JobsFixture> {
  const end = Date.now() + START_WAIT_MS
  while (!(await answers(port))) {
    if (Date.now() > end || child.exitCode !== null) throw new Error(`the jobs fixture backend did not answer on ${port}; see ${runDir}`)
    await sleep(300)
  }
  const lock = readLock(stateDir)
  if (lock === null) throw new Error(`no backend.lock in ${stateDir}`)
  if (!(await verifyBackend(lock.token, port, lock.port))) throw new Error('the jobs fixture backend did not prove that it holds its token')
  const code = await mintCode(port, lock.token)
  if (code === null) throw new Error('the jobs fixture backend issued no launch code')
  const redeemed = await fetch(`http://127.0.0.1:${port}/api/session/redeem`, { headers: { 'X-NQT-Code': code } })
  const cookie = (redeemed.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  if (redeemed.status !== 200 || cookie === '') throw new Error(`the jobs fixture backend refused its launch code (HTTP ${redeemed.status})`)
  return { origin: `http://127.0.0.1:${port}`, cookie, stop }
}

const test = base.extend<object, { door: BrowserDoor }>({
  door: [async ({ appPage, run }, use) => {
    const door = await openBrowserDoor(appPage, run.origin)
    await use(door)
    await door.close()
  }, { scope: 'worker' }],
})

test.describe.configure({ timeout: 300_000 })

test.describe('the weekly parity list, fixture mode', () => {
  for (const def of PARITY_ROWS) {
    test(`row ${def.row}: ${def.name}`, async ({ page, run, door }) => {
      const ctx: ParityContext = { mode: MODE, origin: run.origin, app: page, door, runDir: run.runDir, lab: run.lab }
      const outcome = await runRow(ctx, def.row, { 13: row13 })
      keepResult(run.runDir, MODE, outcome)
      expect(outcome.differences, `row ${def.row}`).toEqual([])
    })
  }

  test('born failing: a figure planted in one door only makes the row fail, and names the figure', async ({ page, run, door }) => {
    const ctx: ParityContext = { mode: MODE, origin: run.origin, app: page, door, runDir: run.runDir, lab: run.lab }
    const planted = await compareDoors(ctx, 1, async (p, which): Promise<Figures> => {
      await homeIn(p)
      if (which === 'browser') await p.locator('[data-nqt-title="volmanaged_v0 EQ"] .kpi-value').first().evaluate((el) => { el.textContent = '9.99' })
      return figuresOf(p, 'volmanaged_v0 EQ')
    })
    expect(planted.status).toBe('red')
    expect(planted.differences.join('\n')).toMatch(/volmanaged_v0 EQ kpi .*: app .*, browser 9\.99/)
  })

  test('the record: every row green or the owner\'s, the gate log clean; written under the run folder', async ({ run }) => {
    const since = fs.statSync(run.runDir).birthtimeMs
    const input = { mode: MODE, date: new Date().toISOString().slice(0, 10), rows: keptResults(run.runDir, MODE), gate: readGateLogFile(run.lab, since), meta: { 'Backend': 'the hidden smoke build\'s fixture backend', 'Run folder': run.runDir } } as const
    const markdown = writeRecord(input, run.runDir)
    expect(markdown).toContain('Result:')
    expect(recordProblems(input)).toEqual([])
  })
})
