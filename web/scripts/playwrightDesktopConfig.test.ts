// The desktop Playwright project's file layout (04 D5.2, D6.2): which specs each mode of playwright.desktop.config.ts runs.
//
// The fixture run takes every *.desktop.ts file under e2e/desktop; the real-lab run (NQT_DESKTOP_MODE=real, started by
// scripts/smoke_real.ps1 -Mode App and by the weekly parity list) takes two files and nothing else, smoke.app.ts and parity.app.ts.
// The real files are not *.desktop.ts files, so the fixture run never reaches a spec written for the real files, and a spec
// written for the fixture never runs on real files. The attach mode of the measurement harness runs two specs only.
// Born failing: a real-mode spec named *.desktop.ts, a real mode that matches anything beyond the two real specs, a fixture run
// that picks up a real spec, and a parity door that does not notice a figure that differs between the app and the browser.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OWNER_PORT } from '../e2e/desktop/launch.ts'
import {
  GATE_FENCE, GIP_P95_CEILING_MS, PARITY_ROWS, compareFigures, doorOrigin, readGateLog, recordFolders, recordMarkdown, recordProblems, rowCounts, type GateReading, type RowResult,
} from '../e2e/desktop/parityRecord.ts'

const DESKTOP_DIR = path.join(fileURLToPath(new URL('..', import.meta.url)), 'e2e', 'desktop')
const REAL_SPECS = ['parity.app.ts', 'smoke.app.ts']
const MODE_VARS = ['NQT_DESKTOP_MODE', 'NQT_DESKTOP_ATTACH_CDP', 'NQT_DESKTOP_ATTACH_URL'] as const

type TestMatch = string | RegExp | ReadonlyArray<string | RegExp>

/** The config of one mode: the environment is read when the module loads, so each call loads it afresh. */
async function configFor(env: Readonly<Record<string, string>>): Promise<{ testMatch: TestMatch; timeout: number }> {
  vi.resetModules()
  for (const name of MODE_VARS) vi.stubEnv(name, env[name] ?? '')
  const loaded = (await import('../playwright.desktop.config.ts')).default
  return { testMatch: loaded.testMatch as TestMatch, timeout: loaded.timeout as number }
}

const patterns = (testMatch: TestMatch): ReadonlyArray<string | RegExp> => (Array.isArray(testMatch) ? testMatch : [testMatch as string | RegExp])

/** Whether a mode's testMatch picks the file up (a string pattern matches the end of the path). */
export function matches(testMatch: TestMatch, file: string): boolean {
  return patterns(testMatch).some((p) => (p instanceof RegExp ? p.test(file) : file.endsWith(p)))
}

/** What a real-mode testMatch must never do: take a *.desktop.ts file, or a file that is not one of the two real specs. */
export function realModeViolations(testMatch: TestMatch, files: readonly string[]): string[] {
  const taken = files.filter((file) => matches(testMatch, file))
  const desktopNamed = taken.filter((file) => file.endsWith('.desktop.ts')).map((file) => `real mode runs the fixture spec ${file}`)
  const extra = taken.filter((file) => !REAL_SPECS.includes(path.posix.basename(file))).map((file) => `real mode runs ${file}, which is not a real spec`)
  const missing = REAL_SPECS.filter((spec) => !taken.some((file) => path.posix.basename(file) === spec)).map((spec) => `real mode does not run ${spec}`)
  return [...new Set([...desktopNamed, ...extra, ...missing])]
}

const desktopFiles = (): string[] => readdirSync(DESKTOP_DIR).filter((name) => name.endsWith('.ts'))

afterEach(() => { vi.unstubAllEnvs() })

describe('playwright.desktop.config.ts, real mode', () => {
  it('runs smoke.app.ts and parity.app.ts, and nothing else of e2e/desktop', async () => {
    const { testMatch } = await configFor({ NQT_DESKTOP_MODE: 'real' })
    expect(desktopFiles()).toEqual(expect.arrayContaining(REAL_SPECS))
    expect(realModeViolations(testMatch, desktopFiles())).toEqual([])
  })

  it('born failing: a real mode that takes a *.desktop.ts file, a third *.app.ts file or too little is reported', () => {
    const files = [...new Set([...desktopFiles(), ...REAL_SPECS, 'extra.app.ts'])]
    expect(realModeViolations(/\.desktop\.ts$/, files)).toEqual(expect.arrayContaining(['real mode runs the fixture spec 10-walk.desktop.ts', 'real mode does not run smoke.app.ts']))
    expect(realModeViolations(/\.app\.ts$/, files)).toContain('real mode runs extra.app.ts, which is not a real spec')
    expect(realModeViolations(/(smoke|parity|extra)\.app\.ts$/, files)).toContain('real mode runs extra.app.ts, which is not a real spec')
    expect(realModeViolations(/smoke\.app\.ts$/, files)).toContain('real mode does not run parity.app.ts')
    expect(realModeViolations(/(smoke|parity)\.app\.ts$/, [...files, 'parity.desktop.ts'])).toEqual([])
    expect(realModeViolations(/(smoke|parity)\.(app|desktop)\.ts$/, [...REAL_SPECS, 'parity.desktop.ts'])).toEqual(['real mode runs the fixture spec parity.desktop.ts', 'real mode runs parity.desktop.ts, which is not a real spec'])
  })

  it('gives a real run the long timeouts, so real files have time to load', async () => {
    const real = await configFor({ NQT_DESKTOP_MODE: 'real' })
    const fixture = await configFor({})
    expect(real.timeout).toBeGreaterThan(fixture.timeout)
  })
})

describe('playwright.desktop.config.ts, fixture and attach modes', () => {
  it('runs every *.desktop.ts file, the parity list among them, and no real spec', async () => {
    const { testMatch } = await configFor({})
    const specs = desktopFiles().filter((name) => name.endsWith('.desktop.ts'))
    expect(specs).toContain('80-parity-auto.desktop.ts')
    for (const spec of specs) expect(matches(testMatch, spec), spec).toBe(true)
    for (const spec of REAL_SPECS) expect(matches(testMatch, spec), spec).toBe(false)
  })

  it('born failing: a fixture match that would take a real spec is caught by the same check', () => {
    expect(matches(/\.ts$/, 'parity.app.ts')).toBe(true)
    expect(matches(/\.desktop\.ts$/, 'parity.app.ts')).toBe(false)
    expect(matches(/\.desktop\.ts$/, 'smoke.app.ts')).toBe(false)
  })

  it('runs only 05-selftest and 10-walk when the harness attached a shell: the parity list needs the app state folder', async () => {
    const { testMatch } = await configFor({ NQT_DESKTOP_ATTACH_CDP: '9222', NQT_DESKTOP_ATTACH_URL: 'http://127.0.0.1:8123' })
    const taken = desktopFiles().filter((name) => matches(testMatch, name))
    expect(taken.sort()).toEqual(['05-selftest.desktop.ts', '10-walk.desktop.ts'])
  })
})

const same = (n: number): Readonly<Record<string, string>> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`figure ${i + 1}`, String(i * 7)]))

describe('the parity list: figures compared from door to door', () => {
  it('finds nothing to report when the app and the browser read the same figures', () => {
    expect(compareFigures(same(6), same(6))).toEqual([])
  })

  it('born failing: a planted figure mismatch between the doors is reported with both values', () => {
    const planted = { ...same(6), 'figure 3': '15.0000001' }
    expect(compareFigures(same(6), planted)).toEqual(['figure 3: app 14, browser 15.0000001'])
  })

  it('born failing: a figure only one door has, and a door that read nothing, are reported', () => {
    expect(compareFigures(same(2), { ...same(2), 'figure 9': '1' })).toEqual(['figure 9: app missing, browser 1'])
    expect(compareFigures({ ...same(2), 'figure 9': '1' }, same(2))).toEqual(['figure 9: app 1, browser missing'])
    expect(compareFigures({}, {})).toEqual(['no figure was read from either door'])
  })

  it('treats a difference of white space as no difference, and any other text as one', () => {
    expect(compareFigures({ a: '1.50  %' }, { a: ' 1.50 %' })).toEqual([])
    expect(compareFigures({ a: '1.50 %' }, { a: '1.5 %' })).toEqual(['a: app 1.50 %, browser 1.5 %'])
  })
})

describe('the parity list: the rows and the record', () => {
  it('lists the 16 rows of the owner template once each, each with its way of being checked', () => {
    expect(PARITY_ROWS.map((r) => r.row)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(PARITY_ROWS.filter((r) => r.way === 'owner').map((r) => r.row)).toEqual([10, 11, 12])
    expect(PARITY_ROWS.find((r) => r.row === 13)?.way).toBe('fixture')
    for (const row of [1, 3, 5, 6, 7, 8, 9, 15, 16]) expect(PARITY_ROWS.find((r) => r.row === row)?.way, `row ${row}`).toBe('doors')
  })

  const reading = (over: Partial<GateReading> = {}): GateReading => ({ lines: 40, otherCallers: 0, afterFence: 0, torn: 0, tornInRun: 0, unparsed: 0, ...over })
  const result = (row: number, status: RowResult['status']): RowResult => ({ row, status, note: '', differences: [] })

  it('reads the gate log: counts lines since a time, other callers and lines ending after the fence, and skips torn lines', () => {
    const log = [
      '{"ts_utc":"2026-10-01T10:00:00Z","caller":"research","end":"2030-01-01"}',
      '{"ts_utc":"2026-10-12T10:00:00Z","caller":"terminal","end":"2021-12-31"}',
      '{"ts_utc":"2026-10-12T10:00:01Z","caller":"terminal","end":"2022-01-01"}',
      '}',
      '{"ts_utc":"2026-10-12T10:00:02Z","caller":"someone","end":"2022-01-02"}',
    ].join('\n')
    expect(readGateLog(log, Date.parse('2026-10-12T00:00:00Z'))).toEqual({ lines: 3, otherCallers: 1, afterFence: 1, torn: 1, tornInRun: 1, unparsed: 0 })
    expect(GATE_FENCE).toBe('2022-01-01')
  })

  describe('born failing: a gate line that cannot be read never passes', () => {
    const since = Date.parse('2026-10-12T00:00:00Z')
    const good = '{"ts_utc":"2026-10-12T10:00:00Z","caller":"terminal","end":"2021-12-31 00:00:00+00:00"}'
    const rowsOk = Array.from({ length: 16 }, (_, i) => result(i + 1, [10, 11, 12].includes(i + 1) ? 'owner' : 'green'))
    const verdict = (log: string): string => recordMarkdown({ mode: 'real', date: '2026-10-12', rows: rowsOk, gate: readGateLog(log, since) })

    it('reads the real log format as a clean pass', () => {
      expect(readGateLog(good, since)).toEqual({ lines: 1, otherCallers: 0, afterFence: 0, torn: 0, tornInRun: 0, unparsed: 0 })
      expect(verdict(good)).toContain('Result: PASS')
    })

    it('counts a line in the window with a missing end as unparsed and fails the record', () => {
      const log = `${good}\n{"ts_utc":"2026-10-12T10:00:01Z","caller":"terminal"}`
      expect(readGateLog(log, since).unparsed).toBe(1)
      expect(verdict(log)).toContain('Result: FAIL')
    })

    it('counts a line in the window with an unparseable end as unparsed and fails the record', () => {
      const log = `${good}\n{"ts_utc":"2026-10-12T10:00:01Z","caller":"terminal","end":"sometime"}`
      expect(readGateLog(log, since).unparsed).toBe(1)
      expect(verdict(log)).toMatch(/Result: FAIL[\s\S]*unreadable/)
    })

    it('counts a line after the run began whose ts_utc does not parse as unparsed', () => {
      const log = `{"ts_utc":"2026-10-01T10:00:00Z","caller":"terminal","end":"2021-12-31"}\n${good}\n{"ts_utc":"yesterday","caller":"terminal","end":"2021-12-31"}`
      expect(readGateLog(log, since).unparsed).toBe(1)
      expect(verdict(log)).toContain('Result: FAIL')
    })

    it('counts a torn tail line as torn in the run and fails the record', () => {
      const log = `${good}\n{"ts_utc":"2026-10-12T10:00:01Z","caller":"term`
      const reading = readGateLog(log, since)
      expect(reading).toMatchObject({ lines: 1, torn: 1, tornInRun: 1 })
      expect(verdict(log)).toMatch(/Result: FAIL[\s\S]*torn/)
    })

    it('still tolerates a torn line from before the run, which a later old line shows was already there', () => {
      const log = `{"ts_utc":"2026-09-01T10:00:00Z","caller":"terminal","end":"2021-12-31"}\n{"ts_utc":"2026-09-01\n{"ts_utc":"2026-09-02T10:00:00Z","caller":"terminal","end":"2021-12-31"}\n${good}`
      expect(readGateLog(log, since)).toEqual({ lines: 1, otherCallers: 0, afterFence: 0, torn: 1, tornInRun: 0, unparsed: 0 })
      expect(verdict(log)).toContain('Result: PASS')
    })
  })

  it('born failing: a gate reading with another caller or a line after the fence fails the record', () => {
    const rows = Array.from({ length: 16 }, (_, i) => result(i + 1, [10, 11, 12].includes(i + 1) ? 'owner' : 'green'))
    expect(recordMarkdown({ mode: 'fixture', date: '2026-10-12', rows, gate: reading() })).toContain('Result: PASS')
    expect(recordMarkdown({ mode: 'fixture', date: '2026-10-12', rows, gate: reading({ otherCallers: 1 }) })).toContain('Result: FAIL')
    expect(recordMarkdown({ mode: 'real', date: '2026-10-12', rows, gate: reading({ afterFence: 2 }) })).toContain('Result: FAIL')
    const red = rows.map((r) => (r.row === 4 ? { ...r, status: 'red' as const, differences: ['pivot total: app 3, browser 4'] } : r))
    const failed = recordMarkdown({ mode: 'real', date: '2026-10-12', rows: red, gate: reading() })
    expect(failed).toContain('Result: FAIL')
    expect(failed).toContain('pivot total: app 3, browser 4')
    expect(rowCounts(red)).toEqual({ green: 12, red: 1, owner: 3, skipped: 0 })
  })

  it('records a row that did not run as a failure, never as green', () => {
    const rows = Array.from({ length: 16 }, (_, i) => result(i + 1, [10, 11, 12].includes(i + 1) ? 'owner' : 'green')).slice(0, 15)
    expect(recordMarkdown({ mode: 'fixture', date: '2026-10-12', rows, gate: reading() })).toContain('Result: FAIL')
  })
})

describe('the parity door', () => {
  it('is the app backend origin on a loopback port other than the owner port', () => {
    expect(doorOrigin('http://127.0.0.1:50123')).toBe('http://127.0.0.1:50123')
    expect(OWNER_PORT).toBe(8765)
  })

  it('born failing: the owner port, a remote host and a malformed origin are refused', () => {
    expect(() => doorOrigin(`http://127.0.0.1:${OWNER_PORT}`)).toThrow(/8765/)
    expect(() => doorOrigin('http://192.168.1.5:50123')).toThrow(/loopback/)
    expect(() => doorOrigin('https://127.0.0.1:50123')).toThrow(/loopback/)
    expect(() => doorOrigin('not a url')).toThrow(/loopback/)
    expect(() => doorOrigin('http://localhost:8765')).toThrow()
  })
})

describe('the parity list: its output and its bound', () => {
  it('writes the record into the run folder, and into NQT_PARITY_OUT when that is set', () => {
    expect(recordFolders('D:/dev/d5/app/runs/x', {})).toEqual(['D:/dev/d5/app/runs/x'])
    expect(recordFolders('D:/dev/d5/app/runs/x', { NQT_PARITY_OUT: 'D:/dev/v04/measure/w5-mac-kit' })).toEqual(['D:/dev/d5/app/runs/x', path.resolve('D:/dev/v04/measure/w5-mac-kit')])
  })

  it('born failing: a record folder on C: is refused', () => {
    expect(() => recordFolders('D:/dev/d5/app/runs/x', { NQT_PARITY_OUT: 'C:/Users/someone/records' })).toThrow(/D: or E: only/)
  })

  it('born failing: a real run whose gate log was not read is not a pass, and a fixture run without a log is', () => {
    const rows = PARITY_ROWS.map((r) => ({ row: r.row, status: (r.way === 'owner' ? 'owner' : r.row === 13 && r.way === 'fixture' ? 'skipped' : 'green') as RowResult['status'], note: '', differences: [] }))
    expect(recordProblems({ mode: 'real', date: '2026-10-12', rows, gate: null })).toEqual(['the gate log was not read'])
    expect(recordProblems({ mode: 'fixture', date: '2026-10-12', rows, gate: null })).toEqual(['row 13 was skipped'])
    expect(recordProblems({ mode: 'fixture', date: '2026-10-12', rows: rows.map((r) => (r.row === 13 ? { ...r, status: 'green' as const } : r)), gate: null })).toEqual([])
  })

  it('keeps the GIP frame bound equal to the harness ceiling for gip_pan_zoom_p95', () => {
    const rowsMjs = readFileSync(path.join(DESKTOP_DIR, '..', '..', '..', 'desktop', 'harness', 'lib', 'rows.mjs'), 'utf8')
    const ceiling = /id: 'gip_pan_zoom_p95'[^\n]*ceiling: (\d+)/.exec(rowsMjs)?.[1]
    expect(Number(ceiling)).toBe(GIP_P95_CEILING_MS)
  })
})
