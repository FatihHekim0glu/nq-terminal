// The automated weekly parity list on the real lab (04 D6.2): run only from the main tree, by scripts/smoke_real.ps1 -Mode App (the
// script refuses app mode in a worktree, and wraps this run in its own checks: a temporary state folder, NQT_JOBS=off, the window
// watch, the research files byte for byte, the gate log's new lines). Not a *.desktop.ts file, so the fixture run never reaches it.
// It runs only when NQT_PARITY_REAL=1, so an ordinary real-data smoke run does not carry it. The command is in
// docs/desktop/v04/w5-mac-kit__parity-auto.md.
//
// The rows are the ones of 80-parity-auto.desktop.ts (parityAuto.ts), read on real files in both doors: the app's page and a
// headless Chromium holding the app's own session. Row 13 is skipped (the real row writes a run folder under backtests/output).
// The fenced reads are the gate's: this file reads no price and no data file itself; it reads the gate log, read only.
import fs from 'node:fs'
import { expect, test as base } from './fixtures.ts'
import { openBrowserDoor, keepResult, keptResults, readGateLogFile, runRow, writeRecord, recordProblems, PARITY_ROWS, type BrowserDoor, type ParityContext } from './parityAuto.ts'

const MODE = 'real'
const ENABLED = process.env.NQT_PARITY_REAL === '1'

const test = base.extend<object, { door: BrowserDoor }>({
  door: [async ({ appPage, run }, use) => {
    const door = await openBrowserDoor(appPage, run.origin)
    await use(door)
    await door.close()
  }, { scope: 'worker' }],
})

test.describe.configure({ timeout: 600_000 })

test.describe('the weekly parity list, real lab', () => {
  test.skip(!ENABLED, 'set NQT_PARITY_REAL=1 (docs/desktop/v04/w5-mac-kit__parity-auto.md)')

  test('the backend is the real one, not the fixture', async ({ page, run }) => {
    const reply = await page.evaluate(async () => (await fetch('/api/health', { credentials: 'same-origin', headers: { 'X-NQT-Client': 'nq-lab-terminal' } })).json())
    expect((reply as { fixture_mode: boolean }).fixture_mode).toBe(false)
    expect(run.origin).not.toContain(':8765')
  })

  for (const def of PARITY_ROWS) {
    test(`row ${def.row}: ${def.name}`, async ({ page, run, door }) => {
      const ctx: ParityContext = { mode: MODE, origin: run.origin, app: page, door, runDir: run.runDir, lab: run.lab }
      const outcome = await runRow(ctx, def.row)
      keepResult(run.runDir, MODE, outcome)
      expect(outcome.differences, `row ${def.row}`).toEqual([])
    })
  }

  test('the record: every row green or the owner\'s, the gate log clean', async ({ run }) => {
    const since = fs.statSync(run.runDir).birthtimeMs
    const input = { mode: MODE, date: new Date().toISOString().slice(0, 10), rows: keptResults(run.runDir, MODE), gate: readGateLogFile(run.lab, since), meta: { 'Backend': 'the hidden smoke build over the real lab', 'Run folder': run.runDir } } as const
    writeRecord(input, run.runDir)
    expect(recordProblems(input)).toEqual([])
  })
})
