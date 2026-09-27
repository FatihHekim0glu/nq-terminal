// The E2E run's project layout (TASKS 8.3 budgets; Phase 10 QA; improvement run 3): the wall-clock
// performance budgets are their own project with no dependency on the main one, so a failure elsewhere never
// skips them, and their own command (`pnpm e2e:perf`, one worker) runs them alone, so CPU contention from
// other workers never decides them; `pnpm e2e` runs the main project only.
// Born failing: a layout that lets the budgets share the run with the other specs, or that makes them wait
// on the main project, is caught.
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

  it('caps the main project at two workers, whatever --workers asks for', () => {
    // Four workers left about 5,900 loopback sockets in TIME_WAIT at the start of a run, and runs lost a page
    // load there (an empty workspace, or net::ERR_NO_BUFFER_SPACE); the per-project limit holds under --workers=4.
    const main = (config.projects ?? []).find((p) => p.name === 'chromium')
    expect(main?.workers).toBe(2)
  })

  it('keeps every other spec, including the browserless trace checks, in the main project', () => {
    const projects = config.projects ?? []
    for (const file of ['e2e/runs.spec.ts', 'e2e/perf/trace.spec.ts', 'e2e/visual/screens.spec.ts']) {
      expect(projectsRunning(projects, file).map((p) => p.name)).toEqual(['chromium'])
    }
  })
})
