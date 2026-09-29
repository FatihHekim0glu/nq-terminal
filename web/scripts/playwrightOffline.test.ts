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

  it('test:e2e-types checks both the e2e tsconfig and the offline one', () => {
    expect(scripts['test:e2e-types']).toBe('tsc -p e2e/tsconfig.json && tsc -p e2e/offline/tsconfig.json')
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
