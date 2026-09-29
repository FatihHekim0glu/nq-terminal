// The offline Playwright project's layout (roadmap #18, slice 1): the same specs run against a Node-side demo
// API on a Mac or Linux box with no Python, without ever reaching the Windows run (`pnpm e2e`).
// playwright.config.ts has testDir './e2e' and its chromium project ignores only the budgets spec, so any
// *.spec.ts under e2e/offline would run on the Windows box against the backend preview and fail there.
// Born failing: a spec-named file under e2e/offline, an output folder that lineEndings.test would walk, a
// budgets run that shares a command with the other specs, and a demo refusal filter that drops a real error.
// Files are read as text; the offline config is never imported (it sets the environment and probes the browser).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import {
  DEMO_REFUSAL_HEADER, DEMO_REFUSAL_VALUE, recordDemoRefusals, withoutDemoRefusals, type RefusalPage,
} from '../e2e/target.ts'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const OFFLINE_DIR = path.join(WEB, 'e2e', 'offline')
const read = (...parts: string[]): string => readFileSync(path.join(WEB, ...parts), 'utf8')

/**
 * The reason strings of every offline screen skip in the offline section of e2e/visual/screens.ts: each inline
 * `offlineSkip: '...'` plus each entry of the OFFLINE_SKIPS table (the text between `const OFFLINE_SKIPS` and `const OFFLINE_BASE`).
 */
export function screenSkipReasons(section: string): string[] {
  const reasons = [...section.matchAll(/offlineSkip: '([^']*)'/g)].map((m) => m[1] ?? '')
  const start = section.indexOf('const OFFLINE_SKIPS')
  const end = section.indexOf('const OFFLINE_BASE')
  const table = start < 0 || end < start ? '' : section.slice(start, end)
  reasons.push(...[...table.matchAll(/'[A-Za-z-]+': '([^']*)'/g)].map((m) => m[1] ?? ''))
  return reasons
}

/** Playwright's own default testMatch: what a project without a testMatch runs. */
const DEFAULT_TEST_MATCH = /.*\.(spec|test)\.(c|m)?[jt]sx?$/
const OFFLINE_NAME = /(^tsconfig\.json$)|(\.offline\.ts$)|(\.config\.ts$)/

/** Files of e2e/offline (relative, forward slashes) whose name is neither *.offline.ts, *.config.ts nor tsconfig.json. */
export function strayOfflineFiles(files: readonly string[]): string[] {
  return files.filter((file) => !OFFLINE_NAME.test(path.posix.basename(file)) || DEFAULT_TEST_MATCH.test(file))
}

function offlineFiles(): string[] {
  return readdirSync(OFFLINE_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(OFFLINE_DIR, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    // Baselines an offline-demo run may write next to it are ignored by git (web/.gitignore).
    .filter((file) => !file.startsWith('__screenshots__/'))
}

const scripts = pkg.scripts as Readonly<Record<string, string>>

describe('e2e/offline naming', () => {
  it('holds only *.offline.ts, *.config.ts and tsconfig.json, so nothing matches the Windows default testMatch', () => {
    const files = offlineFiles()
    expect(files).toEqual(expect.arrayContaining(['demo.offline.ts', 'vite.offline.config.ts', 'tsconfig.json']))
    expect(strayOfflineFiles(files)).toEqual([])
    expect(files.filter((file) => DEFAULT_TEST_MATCH.test(file))).toEqual([])
  })

  it('born failing: a spec or test named file is caught, and the allowed names are not', () => {
    expect(strayOfflineFiles(['demo.offline.ts', 'vite.offline.config.ts', 'tsconfig.json'])).toEqual([])
    expect(strayOfflineFiles(['demo.offline.ts', 'demo.spec.ts'])).toEqual(['demo.spec.ts'])
    expect(strayOfflineFiles(['home.test.ts', 'a.spec.mts', 'notes.md', 'sub/tsconfig.json.bak'])).toEqual([
      'home.test.ts', 'a.spec.mts', 'notes.md', 'sub/tsconfig.json.bak',
    ])
    // Only the final extension decides: demo.spec.offline.ts is not a default match, demo.offline.spec.ts is.
    expect(strayOfflineFiles(['demo.spec.offline.ts', 'demo.offline.spec.ts'])).toEqual(['demo.offline.spec.ts'])
  })

  it('has a Playwright default testMatch that matches the names the guard refuses', () => {
    for (const name of ['demo.spec.ts', 'demo.test.ts', 'demo.spec.mjs', 'x/y.test.tsx']) expect(DEFAULT_TEST_MATCH.test(name), name).toBe(true)
    for (const name of ['demo.offline.ts', 'vite.offline.config.ts', 'tsconfig.json']) expect(DEFAULT_TEST_MATCH.test(name), name).toBe(false)
  })
})

describe('playwright.offline.config.ts', () => {
  const config = read('playwright.offline.config.ts')

  it('writes its output under node_modules/.tmp, which no source walk (lineEndings, Workspace.safety) enters', () => {
    const outputDir = /outputDir:\s*'([^']+)'/.exec(config)?.[1]
    expect(outputDir).toBe('node_modules/.tmp/e2e-offline-results')
    expect(outputDir?.startsWith('node_modules/.tmp/')).toBe(true)
    expect(config).not.toMatch(/e2e\/\.results/)
  })

  it('keeps its baselines local to the platform, beside the specs and away from the Windows ones', () => {
    expect(config).toContain(`snapshotPathTemplate: '{testDir}/__screenshots__/offline-{platform}/{testFilePath}/{arg}{ext}'`)
    expect(read('.gitignore').split(/\r?\n/)).toEqual(expect.arrayContaining(['e2e/__screenshots__/offline-*', 'e2e/offline/__screenshots__']))
  })

  it('runs the in-page demo smoke from e2e/offline, matching *.offline.ts only', () => {
    expect(config).toMatch(/name:\s*'offline-demo'[\s\S]*?testDir:\s*'\.\/e2e\/offline'[\s\S]*?testMatch:\s*\/\\\.offline\\\.ts\$\//)
  })

  it('names the projects offline, offline-perf and offline-demo, and marks the target for the watchers', () => {
    for (const name of ['offline', 'offline-perf', 'offline-demo']) expect(config).toContain(`name: '${name}'`)
    expect(config).toContain(`process.env.NQT_E2E_TARGET = 'offline'`)
  })

  it('guards its ports: spare, distinct, and never the backend, the dev server or the demo server', () => {
    expect(config).toContain('NQT_E2E_OFFLINE_PORT')
    expect(config).toContain('NQT_E2E_DEMO_PORT')
    for (const port of ['8765', '5173', '5174']) expect(config).toContain(port)
    expect(config).toMatch(/4373/)
    expect(config).toMatch(/4374/)
  })

  it('starts its servers with the running Node and the local Vite, never through pnpm', () => {
    expect(config).toContain('process.execPath')
    expect(config).toContain(`'vite', 'bin', 'vite.js'`)
    expect(config).not.toMatch(/pnpm (exec|run|dlx)/)
  })

  it('serves the demo smoke without the demo API, and each build from its own folder', () => {
    expect(config).toContain(`NQT_OFFLINE_API: 'off'`)
    expect(config).toMatch(/e2e-offline-\$\{/)
    expect(config).toMatch(/e2e-demo-\$\{/)
  })

  it('leaves the Windows config alone: it does not import or name the offline one', () => {
    expect(read('playwright.config.ts')).not.toContain('offline')
  })
})

describe('e2e/offline/vite.offline.config.ts, as vite preview resolves it', () => {
  // vite.config.ts proxies /api to the real backend on 8765 outside the demo mode, and Vite's preview falls back
  // to server.proxy when preview.proxy is unset (preview.proxy ?? server.proxy). The offline gallery preview must
  // proxy nothing: a path the demo middleware passes on (/apix, /api%2Fhealth) would otherwise reach 8765.
  // Resolved through Vite itself (not imported: tsc -b types this file under the node config).
  async function previewProxy(mode: string): Promise<Record<string, unknown> | undefined> {
    const previous = process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING
    process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true'
    try {
      const resolved = await resolveConfig(
        { configFile: path.join(WEB, 'e2e', 'offline', 'vite.offline.config.ts'), mode, logLevel: 'silent' },
        'serve',
        'production',
        'production',
        true,
      )
      return resolved.preview.proxy as Record<string, unknown> | undefined
    } finally {
      if (previous === undefined) delete process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING
      else process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = previous
    }
  }

  it('proxies nothing in the gallery preview, so no request can reach the backend on 8765', async () => {
    const proxy = previewProxy('gallery')
    expect(Object.keys((await proxy) ?? {})).toEqual([])
  })

  it('born failing: the base config does proxy /api to 8765 in that mode, which the offline config must undo', () => {
    expect(read('vite.config.ts')).toMatch(/proxy: mode === DEMO_MODE \? undefined : \{ '\/api': API_ORIGIN \}/)
  })
})

describe('package.json scripts', () => {
  it('e2e:offline runs the offline and offline-demo projects and never the budgets', () => {
    const line = scripts['e2e:offline'] ?? ''
    expect(line).toMatch(/playwright test -c playwright\.offline\.config\.ts/)
    expect(line).toMatch(/--project[ =]offline(?![-\w])/)
    expect(line).toMatch(/--project[ =]offline-demo\b/)
    expect(line).not.toContain('offline-perf')
    expect(line).not.toMatch(/perf/)
  })

  it('e2e:offline:perf runs offline-perf alone, on one worker', () => {
    const line = scripts['e2e:offline:perf'] ?? ''
    expect(line).toMatch(/-c playwright\.offline\.config\.ts/)
    expect(line).toMatch(/--project[ =]offline-perf\b/)
    expect(line).not.toMatch(/--project[ =]offline(?![-\w])/)
    expect(line).not.toContain('offline-demo')
    expect(line).toMatch(/--workers[ =]1\b/)
  })

  it('e2e:offline:baseline is e2e:offline that rewrites every baseline', () => {
    const line = scripts['e2e:offline:baseline'] ?? ''
    expect(line).toBe(`${scripts['e2e:offline']} --update-snapshots=all`)
  })

  it('test:e2e-types checks the e2e, offline, flows, perf and visual tsconfigs', () => {
    expect(scripts['test:e2e-types']).toBe(
      'tsc -p e2e/tsconfig.json && tsc -p e2e/offline/tsconfig.json && tsc -p e2e/flows/tsconfig.json && tsc -p e2e/perf/tsconfig.json && tsc -p e2e/visual/tsconfig.json',
    )
  })

  it('leaves the Windows scripts as they were', () => {
    expect(scripts['e2e']).toBe('playwright test --project=chromium')
    expect(scripts['e2e:perf']).toBe('playwright test --project=perf --workers=1')
  })
})

describe('the tsconfigs', () => {
  it('e2e/offline extends the app config, with node and vite types, and its build info under node_modules/.tmp', () => {
    const tsconfig = JSON.parse(read('e2e', 'offline', 'tsconfig.json')) as {
      extends: string
      compilerOptions: { types: string[]; incremental: boolean; tsBuildInfoFile: string }
      include: string[]
    }
    expect(tsconfig.extends).toBe('../../tsconfig.app.json')
    expect(tsconfig.compilerOptions.types).toEqual(['node', 'vite/client'])
    expect(tsconfig.compilerOptions.incremental).toBe(true)
    expect(tsconfig.compilerOptions.tsBuildInfoFile).toBe('../../node_modules/.tmp/tsconfig.e2e-offline.tsbuildinfo')
    expect(tsconfig.include).toEqual(['./*.ts'])
  })

  it('e2e/tsconfig.json also checks the offline config', () => {
    const tsconfig = JSON.parse(read('e2e', 'tsconfig.json')) as { include: string[] }
    expect(tsconfig.include).toEqual(['./*.ts', '../playwright.config.ts', '../playwright.offline.config.ts'])
  })
})

describe('demo refusals in e2e/target.ts', () => {
  const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404 (Not Found)'

  /** A page that keeps its response listener, as Playwright's does. */
  function fakePage() {
    const listeners: Array<(response: { url(): string; headers(): Record<string, string> }) => void> = []
    const page: RefusalPage = {
      on: (_event, listener) => {
        listeners.push(listener)
      },
    }
    const respond = (url: string, headers: Record<string, string>) => listeners.forEach((l) => l({ url: () => url, headers: () => headers }))
    return { page, respond }
  }

  it('records the URL of a response that carries the refusal header, and no other', () => {
    const { page, respond } = fakePage()
    const refused = new Set<string>()
    recordDemoRefusals(page, refused)
    respond('http://127.0.0.1:4373/api/qa', { [DEMO_REFUSAL_HEADER]: DEMO_REFUSAL_VALUE })
    respond('http://127.0.0.1:4373/api/health', { 'content-type': 'application/json' })
    respond('http://127.0.0.1:4373/api/bars?end=2022-06-30', { [DEMO_REFUSAL_HEADER]: 'something-else' })
    respond('http://127.0.0.1:4373/api/no_such_path', {})
    expect([...refused]).toEqual(['http://127.0.0.1:4373/api/qa'])
  })

  it('drops the console line of a refused URL, and only that line', () => {
    const refused = new Set(['http://127.0.0.1:4373/api/qa'])
    const errors = [
      `${NOT_FOUND} http://127.0.0.1:4373/api/qa`,
      `${NOT_FOUND} http://127.0.0.1:4373/api/runs/x`,
      'Uncaught TypeError: x is not a function',
      `Some other message about http://127.0.0.1:4373/api/qa`,
      `Failed to load resource: net::ERR_FAILED http://127.0.0.1:4373/api/qa`,
    ]
    expect(withoutDemoRefusals(errors, refused)).toEqual([
      `${NOT_FOUND} http://127.0.0.1:4373/api/runs/x`,
      'Uncaught TypeError: x is not a function',
      `Some other message about http://127.0.0.1:4373/api/qa`,
    ])
  })

  it('born failing: with nothing refused (the fixture backend never sends the header) every error stays', () => {
    const errors = [`${NOT_FOUND} http://127.0.0.1:4273/api/qa`, 'Uncaught Error']
    expect(withoutDemoRefusals(errors, new Set())).toEqual(errors)
  })

  it('a refusal of one URL does not excuse the same path with another query', () => {
    const refused = new Set(['http://127.0.0.1:4373/api/runs/x?a=1'])
    const errors = [`${NOT_FOUND} http://127.0.0.1:4373/api/runs/x?a=2`, `${NOT_FOUND} http://127.0.0.1:4373/api/runs/x?a=1`]
    expect(withoutDemoRefusals(errors, refused)).toEqual([`${NOT_FOUND} http://127.0.0.1:4373/api/runs/x?a=2`])
  })
})

// The offline run drives the finished UI against the demo dataset (roadmap #18, slice 2). Its lists and skips are read as text:
// the specs are Playwright files, which a unit test does not run. Born failing: a skip with no reason, one that does not name
// the demo, and a list that still holds a screen the demo cannot draw.
describe('the offline screens and skips (roadmap #18, slice 2)', () => {
  const screens = read('e2e', 'visual', 'screens.ts')
  const offlineSection = screens.slice(screens.indexOf('the offline run (playwright.offline.config.ts)'))

  /** The reason strings of every offline skip in a spec: test.skip(OFFLINE ..., 'reason') and leaveOutOffline('reason'). */
  function offlineSkipReasons(source: string): string[] {
    const found: string[] = []
    for (const match of source.matchAll(/test\.skip\(\s*OFFLINE[^,]*,\s*(['`"])((?:(?!\1)[\s\S])*)\1/g)) found.push(match[2] ?? '')
    for (const match of source.matchAll(/leaveOutOffline\(\s*(['`"])((?:(?!\1)[\s\S])*)\1/g)) found.push(match[2] ?? '')
    return found
  }
  /** Skip calls that carry no string reason at all (a silent skip). */
  function silentOfflineSkips(source: string): number {
    const calls = [...source.matchAll(/test\.skip\(\s*OFFLINE[^)]*\)/g)].length + [...source.matchAll(/leaveOutOffline\(/g)].length
    return calls - offlineSkipReasons(source).length
  }
  const NAMES_THE_DEMO = /demo (dataset|API)|demo holds/i

  it('keeps SCREENS for the Windows run and adds OFFLINE_SCREENS beside it, without GIP', () => {
    expect(screens).toMatch(/export const SCREENS: readonly ScreenCase\[\] = \[/)
    expect(screens).toMatch(/export const OFFLINE_SCREENS: readonly ScreenCase\[\] = \[/)
    // The offline list is SCREENS filtered, so a Windows screen is never re-typed: GIP is the one taken out, and its reason is written down.
    expect(offlineSection).toMatch(/SCREENS\.filter\(\(screen\) => screen\.name !== 'GIP'\)/)
    expect(offlineSection).toContain('1m bars are not in the demo dataset')
    expect(offlineSection).not.toMatch(/name: 'GIP'/)
  })

  it('adds the P1 screens and the numbered tabs of waves 1 to 11', () => {
    for (const name of ['VCONE', 'SEAS', 'EVT', 'ROLL', 'DES-robustness', 'REG-evidence', 'REG-costs', 'REG-map', 'MT-replication', 'MT-trials', 'RUNS-compare']) {
      expect(offlineSection, name).toContain(`name: '${name}'`)
    }
    for (const line of ["'5'", "'92'", "'93'", "'94'", "'86'", "'87'", "'90'"]) expect(offlineSection, line).toContain(`line: ${line}`)
    // A chart-count override names the demo body that differs (a comment on the line before it).
    expect(offlineSection).toMatch(/\/\/ [^\n]*\n[^\n]*\n?\s*LIVE: 3,/)
  })

  it('gives every offline screen skip a reason that names the demo dataset', () => {
    const reasons = screenSkipReasons(offlineSection)
    // No screen is skipped offline since P5 (src/demo/offlineScreens.test.ts pins the empty table), and SEAS and EVT are driven to
    // the request the demo holds. Any skip added later must name the demo dataset; the planted case below keeps this loop honest.
    for (const reason of reasons) expect(reason, reason).toMatch(/not in the demo dataset/)
  })

  it('drives SEAS and EVT to the request the demo holds instead of skipping them', () => {
    // The entry: from `name: '<name>'` to the next `{ name: '`.
    const entry = (name: string): string => {
      const start = offlineSection.indexOf(`name: '${name}'`)
      expect(start, name).toBeGreaterThanOrEqual(0)
      const next = offlineSection.indexOf("{ name: '", start + 1)
      return offlineSection.slice(start, next < 0 ? undefined : next)
    }
    const seas = entry('SEAS')
    const evt = entry('EVT')
    expect(seas).not.toContain('offlineSkip')
    expect(evt).not.toContain('offlineSkip')
    // The demo holds NQ.V.0 seasonality for 2020 to 2021 only (the screen opens on 2010 to 2021), and the FOMC daily study at
    // 2 sessions before and 2 after only (the screen opens on 5 and 5): the screens' own fields are set to that.
    expect(seas).toContain('From')
    expect(seas).toContain('2020')
    expect(evt).toContain('Before')
    expect(evt).toContain('After')
    expect(evt).toContain('2 sessions')
  })

  it('makes screens.spec.ts iterate the offline list offline, skipping by name first thing in the test', () => {
    const spec = read('e2e', 'visual', 'screens.spec.ts')
    expect(spec).toContain('OFFLINE ? OFFLINE_SCREENS : SCREENS')
    expect(spec).toMatch(/async \(\{ page \}\) => \{\s*test\.skip\(OFFLINE && screen\.offlineSkip !== undefined, screen\.offlineSkip\)/)
  })

  it('makes budgets.spec.ts skip the warm-up and the GIP test offline, with the reason, and keep the fills budgets', () => {
    const spec = read('e2e', 'perf', 'budgets.spec.ts')
    expect(spec).toContain('if (!OFFLINE) await warmBackend(request)')
    expect(spec).toMatch(/GIP pan and zoom run near 60 fps[^\n]*\n\s*test\.skip\(OFFLINE, '1m bars are not in the demo dataset/)
    expect(spec).toContain('expect(t.openMs).toBeLessThan(BUDGETS.fillsGridMs)')
    expect(spec).toContain('expect(t.sortMs).toBeLessThan(BUDGETS.fillsGridMs)')
    expect(spec).toContain('expect(t.pageMs).toBeLessThan(BUDGETS.fillsGridMs)')
  })

  it('has no silent offline skip in any spec: each names the demo', () => {
    // screens.spec.ts passes the reason of the case (screen.offlineSkip); the test above pins every one of those.
    const specs = ['flows/keyboard.spec.ts', 'flows/rules.spec.ts', 'flows/safety.spec.ts', 'perf/budgets.spec.ts']
    for (const spec of specs) {
      const source = read('e2e', ...spec.split('/'))
      expect(silentOfflineSkips(source), spec).toBe(0)
      for (const reason of offlineSkipReasons(source)) expect(reason, `${spec}: ${reason}`).toMatch(NAMES_THE_DEMO)
    }
    expect(offlineSkipReasons(read('e2e', 'flows', 'keyboard.spec.ts')).length).toBeGreaterThanOrEqual(1)
    // rules.spec.ts leaves out one step, the fence test's GIP read (1m bars). The tags test's run tear sheet runs offline since the
    // demo holds the volmanaged run's record (P5, src/demo/data/runs.ts), so the run-reads-[POST HOC] check is never lost.
    const rules = read('e2e', 'flows', 'rules.spec.ts')
    expect(offlineSkipReasons(rules)).toHaveLength(1)
    expect(offlineSkipReasons(rules).some((r) => r.includes('RunDetail'))).toBe(false)
    expect(rules).not.toContain('TEAR_SUBJECT')
  })

  it('prints each step skip to the run output, since the list reporter does not show annotations', () => {
    const support = read('e2e', 'flows', 'support.ts')
    const start = support.indexOf('export function leaveOutOffline')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = support.slice(start, support.indexOf('\n}', start))
    expect(body).toMatch(/console\.info\(`\[offline-skip\] /)
  })

  it('born failing: a skip with no reason, or one that never names the demo, is caught', () => {
    expect(silentOfflineSkips(`test.skip(OFFLINE)`)).toBe(1)
    expect(silentOfflineSkips(`if (leaveOutOffline(reason)) return`)).toBe(1)
    expect(silentOfflineSkips(`test.skip(OFFLINE, 'no bars')`)).toBe(0)
    expect(offlineSkipReasons(`test.skip(OFFLINE, 'no bars')`).every((r) => NAMES_THE_DEMO.test(r))).toBe(false)
    expect(offlineSkipReasons(`test.skip(OFFLINE && x, '1m bars are not in the demo dataset')`)).toEqual(['1m bars are not in the demo dataset'])
    expect(offlineSkipReasons(`leaveOutOffline('1m bars are not in the demo dataset (a)')`)).toEqual(['1m bars are not in the demo dataset (a)'])
  })

  it('born failing: the screen skip extraction finds inline and table reasons, so the per-reason loop cannot pass empty by accident', () => {
    const planted =
      "{ name: 'X', offlineSkip: 'bars are not in the demo dataset' }\n" +
      'const OFFLINE_SKIPS: Readonly<Record<string, string>> = {\n' +
      "  'EQ-run': 'GET /api/runs/x is not in the demo dataset',\n" +
      '}\n' +
      'const OFFLINE_BASE'
    expect(screenSkipReasons(planted)).toEqual(['bars are not in the demo dataset', 'GET /api/runs/x is not in the demo dataset'])
    expect(screenSkipReasons('const OFFLINE_SKIPS = {}\nconst OFFLINE_BASE')).toEqual([])
  })

  it('leaves the Windows list alone: no spec reads OFFLINE_SCREENS outside the offline branch', () => {
    const spec = read('e2e', 'visual', 'screens.spec.ts')
    expect(spec.match(/for \(const screen of SCREENS_UNDER_TEST\)/g)?.length).toBe(1)
    expect(spec.match(/const SCREENS_UNDER_TEST[^\n]*= OFFLINE \? OFFLINE_SCREENS : SCREENS\n/g)?.length).toBe(1)
    for (const file of ['flows/support.ts', 'perf/pages.ts']) expect(read('e2e', ...file.split('/'))).not.toContain('OFFLINE_SCREENS')
  })
})

// The budgets spec records console errors with its own watcher (e2e/perf/pages.ts). Offline, the demo declines a request it has
// no body for and the browser logs "Failed to load resource" for it: that line is the demo declining, not a page error.
// Against the fixture backend nothing carries the refusal header, so every error stays (the Windows budgets are as strict as ever).
describe('the perf watcher (e2e/perf/pages.ts)', () => {
  type Listener = (arg: never) => void
  const ORIGIN = 'http://127.0.0.1:4373'
  const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404 (Not Found)'

  /** A page that keeps its listeners, as Playwright's does. */
  function fakePage() {
    const listeners = new Map<string, Listener[]>()
    const page = { on: (event: string, listener: Listener) => void listeners.set(event, [...(listeners.get(event) ?? []), listener]) }
    const emit = (event: string, arg: unknown) => (listeners.get(event) ?? []).forEach((l) => l(arg as never))
    const refuse = (url: string, refused: boolean) => emit('response', { url: () => url, headers: () => (refused ? { [DEMO_REFUSAL_HEADER]: DEMO_REFUSAL_VALUE } : {}) })
    const consoleError = (text: string, url: string) => emit('console', { type: () => 'error', text: () => text, location: () => ({ url }) })
    return { page, refuse, consoleError, pageError: (e: Error) => emit('pageerror', e) }
  }

  // Imported by a computed URL, so the node tsconfig that types this file does not also type pages.ts (which is browser code: no DOM lib here).
  const PAGES = new URL('../e2e/perf/pages.ts', import.meta.url).href

  async function watcher() {
    const { watch } = (await import(/* @vite-ignore */ PAGES)) as { watch(page: never): { readonly errors: string[] } }
    const fake = fakePage()
    return { ...fake, w: watch(fake.page as never) }
  }

  it('drops the "Failed to load resource" line of a refused URL, whichever event came first', async () => {
    const { w, refuse, consoleError } = await watcher()
    consoleError(NOT_FOUND, `${ORIGIN}/api/market/universe?window=22`)
    refuse(`${ORIGIN}/api/market/universe?window=22`, true)
    refuse(`${ORIGIN}/api/qa`, true)
    consoleError(NOT_FOUND, `${ORIGIN}/api/qa`)
    expect(w.errors).toEqual([])
  })

  it('keeps every other error: an unrefused 404, a page error, a console error that is not a load failure', async () => {
    const { w, refuse, consoleError, pageError } = await watcher()
    refuse(`${ORIGIN}/api/qa`, true)
    consoleError(NOT_FOUND, `${ORIGIN}/api/qa`)
    consoleError(NOT_FOUND, `${ORIGIN}/api/runs/x`)
    consoleError('Uncaught TypeError: x is not a function', `${ORIGIN}/assets/index.js`)
    pageError(new Error('boom'))
    expect(w.errors).toHaveLength(3)
    expect(w.errors[0]).toContain(`${ORIGIN}/api/runs/x`)
    expect(w.errors[1]).toContain('Uncaught TypeError')
    expect(w.errors[2]).toContain('boom')
  })

  it('born failing: against the fixture backend (no refusal header) a load failure stays an error', async () => {
    const { w, refuse, consoleError } = await watcher()
    refuse(`${ORIGIN}/api/qa`, false)
    consoleError(NOT_FOUND, `${ORIGIN}/api/qa`)
    expect(w.errors).toEqual([expect.stringContaining(NOT_FOUND)])
  })
})
