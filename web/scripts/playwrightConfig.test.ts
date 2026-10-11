// The E2E run's project layout (TASKS 8.3 budgets; Phase 10 QA; improvement run 3): the wall-clock
// performance budgets are their own project with no dependency on the main one, so a failure elsewhere never
// skips them, and their own command (`pnpm e2e:perf`, one worker) runs them alone, so CPU contention from
// other workers never decides them; `pnpm e2e` runs the main project only.
// Born failing: a layout that lets the budgets share the run with the other specs, or that makes them wait
// on the main project, is caught.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '../playwright.config.ts'
import pkg from '../package.json' with { type: 'json' }

type Project = NonNullable<typeof config.projects>[number]

const BUDGETS = 'e2e/perf/budgets.spec.ts'
const BUDGETS_RE = /perf[\\/]budgets\.spec\.ts$/

function matches(pattern: Project['testMatch'] | Project['testIgnore'], file: string): boolean {
  const list = pattern === undefined ? [] : Array.isArray(pattern) ? pattern : [pattern]
  return list.some((p) => (p instanceof RegExp ? p.test(file) : typeof p === 'string' && file.endsWith(p)))
}

function projectsRunning(projects: readonly Project[], file: string): Project[] {
  return projects.filter((p) => {
    const included = p.testMatch === undefined || matches(p.testMatch, file)
    return included && !matches(p.testIgnore, file)
  })
}

/** Whether the budgets spec has a project of its own that runs nothing else and waits on no other project. */
export function budgetsIsolated(projects: readonly Project[]): boolean {
  const runners = projectsRunning(projects, BUDGETS)
  if (runners.length !== 1 || projects.length < 2) return false
  const [perf] = runners
  const soloFile = projectsRunning(projects, 'e2e/runs.spec.ts').every((p) => p !== perf)
  return soloFile && (perf!.dependencies ?? []).length === 0
}

/** Whether the scripts run the main project and the budgets as two commands, the budgets on one worker. */
export function commandsSeparate(scripts: Readonly<Record<string, string>>): boolean {
  const main = scripts.e2e ?? ''
  const perf = scripts['e2e:perf'] ?? ''
  return /--project[ =]chromium\b/.test(main) && !/perf/.test(main) && /--project[ =]perf\b/.test(perf) && /--workers[ =]1\b/.test(perf)
}

type Server = { name?: string; command?: string; env?: Record<string, string | undefined> }

/**
 * Whether every screenshot of the main run reads the checked-in fixture tree: the backend is the fixture app with
 * NQT_FIXTURE_DIR at backend/tests/fixtures, so a row the research lab adds to its live registry never reaches a baseline.
 */
export function screenshotsReadPinnedData(servers: readonly Server[]): boolean {
  const backends = servers.filter((s) => /\buvicorn\b/.test(s.command ?? ''))
  if (backends.length !== 1) return false
  const [backend] = backends
  const dir = (backend!.env?.NQT_FIXTURE_DIR ?? '').replace(/\\/g, '/')
  return /fixture_app:app/.test(backend!.command ?? '') && /\/backend\/tests\/fixtures$/.test(dir)
}

describe('Playwright data', () => {
  const servers = (Array.isArray(config.webServer) ? config.webServer : [config.webServer]) as Server[]

  it('serves every screenshot of the main run from the checked-in fixture tree, never the live research registry', () => {
    expect(screenshotsReadPinnedData(servers)).toBe(true)
  })

  it('born failing: a backend over the live lab, or one with no fixture folder, is caught', () => {
    const fixture = { command: 'python -m uvicorn fixture_app:app --port 8795', env: { NQT_FIXTURE_DIR: 'C:/x/nq-lab/terminal/backend/tests/fixtures' } }
    expect(screenshotsReadPinnedData([fixture])).toBe(true)
    expect(screenshotsReadPinnedData([{ ...fixture, env: {} }])).toBe(false)
    expect(screenshotsReadPinnedData([{ ...fixture, env: { NQT_FIXTURE_DIR: 'C:/x/nq-lab' } }])).toBe(false)
    expect(screenshotsReadPinnedData([{ ...fixture, command: 'python -m uvicorn nq_terminal.app:app --port 8795' }])).toBe(false)
    expect(screenshotsReadPinnedData([])).toBe(false)
  })
})

describe('Playwright projects', () => {
  it('gives the performance budgets their own project, which waits on no other', () => {
    expect(budgetsIsolated(config.projects ?? [])).toBe(true)
  })

  it('born failing: one project for every spec, or budgets that depend on the main project, are caught', () => {
    const perf = { name: 'perf', testMatch: BUDGETS_RE }
    expect(budgetsIsolated([{ name: 'chromium' }])).toBe(false)
    expect(budgetsIsolated([{ name: 'chromium' }, perf])).toBe(false)
    // The Phase 10 layout: a failure in the main project skipped all three budgets.
    expect(budgetsIsolated([{ name: 'chromium', testIgnore: BUDGETS_RE }, { ...perf, dependencies: ['chromium'] }])).toBe(false)
    expect(budgetsIsolated([{ name: 'chromium', testIgnore: BUDGETS_RE }, perf])).toBe(true)
  })

  it('runs the main project and the budgets as two commands, the budgets alone on one worker', () => {
    expect(commandsSeparate(pkg.scripts)).toBe(true)
    expect(commandsSeparate({ e2e: 'playwright test' })).toBe(false)
    expect(commandsSeparate({ e2e: 'playwright test --project chromium', 'e2e:perf': 'playwright test --project perf' })).toBe(false)
  })

  it('holds the main project to one worker, whatever --workers asks for: its workers would share one backend and one state folder', () => {
    // Born failing (test-speed): the project said two workers, which the top-level `workers: 1` hid until someone ran
    // `pnpm e2e --workers=4`; two workers then shared the one backend with flows/p2 (queues runs) and workspace-import
    // (starts the store). Two measured runs of a two-worker layout each lost two tests to the shared backend's latency
    // (docs/desktop/v04/w2a-supply-chain__test-speed.md). Four workers also left about 5,900 loopback sockets in TIME_WAIT.
    const main = (config.projects ?? []).find((p) => p.name === 'chromium')
    expect(main?.workers).toBe(1)
    expect(config.workers).toBe(1)
  })

  it('builds the app into a folder of its own and serves that folder, never the shared dist-gallery', () => {
    // Born failing (improvement run 3): the preview served dist-gallery, which any other gallery build empties and
    // rewrites; a page then asked for a chunk that was gone (404) and never booted, an empty workspace in the
    // keyboard flow and gallery entries that never finished loading.
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer]
    const web = servers.find((s) => s?.name === 'vite preview')
    const command = web?.command ?? ''
    const dirs = [...command.matchAll(/--outDir\s+"([^"]+)"/g)].map((m) => m[1])
    expect(dirs).toHaveLength(2) // the build writes it and the preview serves it
    expect(dirs[0]).toBe(dirs[1])
    expect(dirs[0]).not.toMatch(/dist-gallery["\\/]?$/)
    expect(dirs[0]).toMatch(/e2e-gallery-\d+$/) // one folder per web port: Playwright refuses a busy port before building
  })

  it('leaves the unit tests of e2e/support to vitest: no Playwright project loads them', () => {
    // Born failing (0.3.3 review): Playwright's default match takes any *.test.ts under testDir, and e2e/support holds a
    // vitest file (e2eState.test.ts), which Playwright cannot load.
    const projects = config.projects ?? []
    expect(projectsRunning(projects, 'e2e/support/e2eState.test.ts').map((p) => p.name)).toEqual([])
  })

  it('keeps every other spec, including the browserless trace checks, in the main project', () => {
    const projects = config.projects ?? []
    for (const file of ['e2e/runs.spec.ts', 'e2e/perf/trace.spec.ts', 'e2e/visual/screens.spec.ts']) {
      expect(projectsRunning(projects, file).map((p) => p.name)).toEqual(['chromium'])
    }
  })
})

describe('Screenshots and the global job indicator (release 0.2.0)', () => {
  /** The stylesheet every screenshot of the main run is taken with, or null when none is set. */
  const sheet = (): string | null => {
    const style = (config.expect?.toHaveScreenshot as { stylePath?: string | string[] } | undefined)?.stylePath
    const first = Array.isArray(style) ? style[0] : style
    return typeof first === 'string' ? first : null
  }

  it('takes every screenshot without the job strip, so a job another spec left running cannot move a baseline', () => {
    const file = sheet()
    expect(file, 'expect.toHaveScreenshot.stylePath is not set').not.toBeNull()
    const css = readFileSync(file ?? '', 'utf8')
    expect(css).toMatch(/\[data-chrome="jobs"\]\s*\{[^}]*display:\s*none\s*!important/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// One backend, one state folder, several workers (test-speed). The run starts ONE fixture backend with ONE state folder
// (its lock, its token, its job queue and its workspace store). Workers may share it only while none writes to it: a spec
// that queues a job or starts the workspace store changes what every other spec sees. So a project with more than one
// worker holds only specs that read, and a project with a spec that writes has one worker and, when other projects have
// specs, finishes before they start (Playwright dependencies). The layout in use is one project of one worker; the measured
// two-project layout that failed the three-green-runs test is in the test-speed note, and this function judges it too.

/** What marks a spec as one that changes the backend's state: a write request, a queued run, or the workspace store. */
export const WRITE_SIGNALS = new RegExp(
  [
    String.raw`method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]`,
    String.raw`\b(?:request|api\w*)\.(?:post|put|patch|delete)\(`,
    String.raw`Queue run`,
    String.raw`__NQT_STORE__`,
    String.raw`startStoreInContext`,
    String.raw`NQT_E2E_SESSION`,
    String.raw`\bisStoreWrite\b`,
  ].join('|'),
)

/** The most workers one project may run: three or more left thousands of loopback sockets in TIME_WAIT (see above). */
const MAX_WORKERS = 2

function dependsOn(projects: readonly Project[], from: Project, to: Project, seen = new Set<string>()): boolean {
  for (const name of from.dependencies ?? []) {
    if (seen.has(name)) continue
    seen.add(name)
    const next = projects.find((p) => p.name === name)
    if (next === to || (next !== undefined && dependsOn(projects, next, to, seen))) return true
  }
  return false
}

/** Whether the project is the one that runs the performance budgets (its own file, its own command). */
const isPerf = (p: Project): boolean => p.name === 'perf'

/**
 * Everything wrong with how the projects share the one backend. `specs` maps each spec file (`e2e/...`) to its source.
 * Empty when: the budgets project runs on exactly one worker; every spec runs in exactly one project; a project with
 * more workers than one holds no spec that writes; a project with a spec that writes has one worker and finishes before
 * every other project with specs starts.
 */
export function sharedBackendProblems(projects: readonly Project[], specs: ReadonlyMap<string, string>): string[] {
  const problems: string[] = []
  for (const p of projects.filter(isPerf)) {
    if (p.workers !== 1) problems.push(`perf: workers is ${String(p.workers)}, the budgets need exactly 1 (set it on the project)`)
  }
  const files = new Map<Project, string[]>(projects.map((p) => [p, []]))
  for (const [file] of specs) {
    const runners = projectsRunning(projects, file)
    if (runners.length === 1 && isPerf(runners[0]!)) continue // the budgets spec has its project and its command
    if (runners.length !== 1) problems.push(`${file}: runs in ${runners.length} projects, not exactly one`)
    for (const p of runners) files.get(p)?.push(file)
  }
  const withSpecs = projects.filter((p) => !isPerf(p) && (files.get(p) ?? []).length > 0)
  for (const p of withSpecs) {
    const workers = Number(p.workers ?? 1)
    const writers = (files.get(p) ?? []).filter((f) => WRITE_SIGNALS.test(specs.get(f) ?? ''))
    if (workers > MAX_WORKERS) problems.push(`${p.name}: ${workers} workers, at most ${MAX_WORKERS}`)
    if (writers.length === 0) continue
    if (workers !== 1) problems.push(`${p.name}: ${workers} workers share the one state folder, and ${writers.join(', ')} write to it`)
    for (const other of withSpecs.filter((o) => o !== p && !dependsOn(projects, o, p))) {
      problems.push(`${p.name}: writes state but does not finish before ${other.name} starts (add it to ${other.name}'s dependencies)`)
    }
  }
  return problems
}

/** Every spec file under e2e, as `e2e/<path>`, with its source. The screenshot folders and the results folder are skipped. */
function readSpecs(): Map<string, string> {
  const root = fileURLToPath(new URL('../e2e/', import.meta.url))
  const found = new Map<string, string>()
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('__') || entry.name.startsWith('.')) continue
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}${entry.name}/`)
      else if (entry.name.endsWith('.spec.ts')) found.set(`e2e/${rel}${entry.name}`, readFileSync(path.join(dir, entry.name), 'utf8'))
    }
  }
  walk(root, '')
  return found
}

describe('Playwright workers share one backend only while they read', () => {
  const specs = readSpecs()
  const readers = new Map([['e2e/a.spec.ts', "await page.goto('/')"], ['e2e/b.spec.ts', 'await expect(page).toHaveScreenshot()']])
  const writer = new Map([['e2e/q.spec.ts', "await page.getByRole('button', { name: 'Queue run' }).click()"]])
  const all = new Map([...readers, ...writer])
  const WRITES = { name: 'writes', testMatch: /q\.spec\.ts$/, workers: 1 }
  const READS = { name: 'reads', testIgnore: [/q\.spec\.ts$/], workers: 2, dependencies: ['writes'] }
  const PERF = { name: 'perf', testMatch: /perf[\\/]budgets\.spec\.ts$/, workers: 1 }

  it('finds the specs it is meant to read (a walk that finds none would pass everything)', () => {
    expect(specs.size).toBeGreaterThan(40)
    expect(specs.has('e2e/flows/p2.spec.ts')).toBe(true)
    expect(specs.has('e2e/visual/screens.spec.ts')).toBe(true)
  })

  it('has no problem in the real layout: no project shares the one backend between workers while specs write to it', () => {
    expect(sharedBackendProblems(config.projects ?? [], specs)).toEqual([])
  })

  it('keeps the specs that queue a run or start the workspace store in a project of one worker', () => {
    const projects = config.projects ?? []
    for (const file of ['e2e/flows/p2.spec.ts', 'e2e/workspace-import.spec.ts', 'e2e/desktop-seams.spec.ts', 'e2e/launch.spec.ts']) {
      const names = projectsRunning(projects, file).map((p) => p.name)
      expect(names, file).toHaveLength(1)
      expect(Number(projects.find((p) => p.name === names[0])?.workers), file).toBe(1)
    }
  })

  it('born failing: a budgets project with more than one worker, or with none set, is caught', () => {
    expect(sharedBackendProblems([WRITES, READS, PERF], all)).toEqual([])
    expect(sharedBackendProblems([WRITES, READS, { ...PERF, workers: 2 }], all)).toEqual([expect.stringMatching(/perf: workers is 2/)])
    expect(sharedBackendProblems([WRITES, READS, { name: 'perf', testMatch: PERF.testMatch }], all)).toEqual([expect.stringMatching(/perf: workers is undefined/)])
  })

  it('born failing: workers that share the one state folder with a spec that writes are caught', () => {
    // The shape before test-speed asked for it: one project, two workers, the queue spec among the readers.
    const one = [{ name: 'chromium', testIgnore: [PERF.testMatch], workers: 2 }, PERF]
    const found = sharedBackendProblems(one, all)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/chromium: 2 workers share the one state folder, and e2e\/q\.spec\.ts write to it/)
    // A single worker has the folder to itself, so the writer may sit with the readers when it is alone.
    expect(sharedBackendProblems([{ name: 'chromium', testIgnore: [PERF.testMatch], workers: 1 }, PERF], all)).toEqual([])
  })

  it('born failing: a writer that can run beside the readers, or a reader that gains a write, is caught', () => {
    const beside = sharedBackendProblems([WRITES, { ...READS, dependencies: [] }, PERF], all)
    expect(beside).toEqual([expect.stringMatching(/writes: writes state but does not finish before reads starts/)])
    const sneaky = new Map([...all, ['e2e/c.spec.ts', "await page.request.fetch('/api/jobs', { method: 'POST' })"]])
    expect(sharedBackendProblems([WRITES, READS, PERF], sneaky)).toEqual(expect.arrayContaining([expect.stringMatching(/reads: 2 workers share the one state folder/)]))
    const store = new Map([...readers, ['e2e/d.spec.ts', 'window.__NQT_STORE__ = true']])
    expect(sharedBackendProblems([WRITES, READS, PERF], store)).toEqual(expect.arrayContaining([expect.stringMatching(/reads: 2 workers share the one state folder/)]))
  })

  it('born failing: a spec that no project runs, or two projects run, and more than two workers, are caught', () => {
    const lost = sharedBackendProblems([{ name: 'chromium', testMatch: /a\.spec\.ts$/, workers: 1 }, PERF], all)
    expect(lost).toEqual(expect.arrayContaining([expect.stringMatching(/b\.spec\.ts: runs in 0 projects/)]))
    const twice = sharedBackendProblems([{ name: 'x', workers: 1 }, { name: 'y', workers: 1 }, PERF], readers)
    expect(twice).toEqual(expect.arrayContaining([expect.stringMatching(/a\.spec\.ts: runs in 2 projects/)]))
    expect(sharedBackendProblems([{ name: 'chromium', workers: 3 }, PERF], readers)).toEqual([expect.stringMatching(/chromium: 3 workers, at most 2/)])
  })
})
