// Offline Playwright (roadmap #18, slice 1): the E2E specs against a Node-side demo API, so they run on a Mac
// or Linux box with no Python and no backend. `pnpm e2e` (playwright.config.ts) is the Windows run against the
// fixture-mode backend and is not touched by this file.
//
//   webServer[0]  the gallery build (the production app plus /__gallery/<name>) behind `vite preview` with the
//                 demo route table served over HTTP as GET /api/* (e2e/offline/vite.offline.config.ts,
//                 src/demo/serve.ts), so page.on('request'), page.route and page.request see real traffic.
//   webServer[1]  the in-page demo build (`--mode demo`) behind the same preview with the API switched off
//                 (NQT_OFFLINE_API=off): it answers /api inside the page, so it gets one smoke spec.
//
// Projects (budgets never share a run with other specs, the rule of scripts/playwrightConfig.test.ts):
//   offline       the specs listed below, at most two workers (one by default, as in playwright.config.ts: the
//                 top-level workers is the total, so pass --workers=2 or more to use both); the two checks that
//                 probe a real backend's routes are skipped
//   offline-perf  e2e/perf/budgets.spec.ts alone (`pnpm e2e:offline:perf`, one worker)
//   offline-demo  e2e/offline/*.offline.ts against the demo build. Named .offline.ts and never .spec.ts: the
//                 Windows config has testDir './e2e' and would otherwise run them (scripts/playwrightOffline.test.ts).
//
// Ports: NQT_E2E_OFFLINE_PORT (default 4373) and NQT_E2E_DEMO_PORT (default 4374), never the user's backend,
// dev server or demo server. Output and each run's builds live under node_modules/.tmp, which no source scan walks.
// Screenshot baselines are this machine's own (offline-{platform}), never compared with the Windows ones.
import { chromium, defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Read by e2e/target.ts in every worker: the config is loaded again in each of them.
process.env.NQT_E2E_TARGET = 'offline'

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url))

const REAL_BACKEND_PORT = 8765
const DEV_SERVER_PORT = 5173
const DEMO_SERVER_PORT = 5174
const OFFLINE_PORT = Number(process.env.NQT_E2E_OFFLINE_PORT ?? 4373)
const DEMO_PORT = Number(process.env.NQT_E2E_DEMO_PORT ?? 4374)
for (const port of [OFFLINE_PORT, DEMO_PORT]) {
  const taken = [REAL_BACKEND_PORT, DEV_SERVER_PORT, DEMO_SERVER_PORT].includes(port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || taken) {
    throw new Error(
      `offline E2E ports must be integers from 1024 to 65535 other than ${REAL_BACKEND_PORT}, ${DEV_SERVER_PORT} and ${DEMO_SERVER_PORT}; got ${port}`,
    )
  }
}
if (OFFLINE_PORT === DEMO_PORT) throw new Error(`NQT_E2E_OFFLINE_PORT and NQT_E2E_DEMO_PORT must differ; both are ${OFFLINE_PORT}`)

const OFFLINE_ORIGIN = `http://127.0.0.1:${OFFLINE_PORT}`
const DEMO_ORIGIN = `http://127.0.0.1:${DEMO_PORT}`

// The bundled Chromium is the default; on a machine without it (no `playwright install`) the installed Chrome
// is used. NQT_E2E_CHANNEL forces a channel ('chrome', 'msedge', ...).
function bundledChromiumMissing(): boolean {
  try {
    return !existsSync(chromium.executablePath())
  } catch {
    return true
  }
}
const CHANNEL = process.env.NQT_E2E_CHANNEL || (bundledChromiumMissing() ? 'chrome' : undefined)

// Each run builds into folders of its own, one per port: no other build (`pnpm build:*`, the Windows run) can
// empty what this run serves. The servers start with the running Node and the local Vite, so no package
// manager has to be on the PATH.
const TMP = path.join(WEB_DIR, 'node_modules', '.tmp')
const OFFLINE_DIST = path.join(TMP, `e2e-offline-${OFFLINE_PORT}`)
const DEMO_DIST = path.join(TMP, `e2e-demo-${DEMO_PORT}`)
const OFFLINE_CONFIG = 'e2e/offline/vite.offline.config.ts'
const q = (p: string) => `"${p}"`
// Vite 8 reads a TypeScript config natively and falls back to bundling it when a module of src has an
// extensionless import (src/demo does): it then prints one warning line per import. The result is the same, so
// the warning is switched off for these servers.
const QUIET_VITE = { VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' }
const vite = (args: string) => `${q(process.execPath)} ${q(path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js'))} ${args}`

// The specs of the offline project, listed one by one: the Windows-only ones (backend, fixture data
// specifics) are not run, and a new spec has to be added here on purpose.
const OFFLINE_SPECS = [
  /flows[\\/](safety|keyboard|scan|rules)\.spec\.ts$/,
  /[\\/]shell\.spec\.ts$/,
  /[\\/]gallery-[a-z-]+\.spec\.ts$/,
  /visual[\\/]screens\.spec\.ts$/,
]
const BUDGETS_SPEC = /perf[\\/]budgets\.spec\.ts$/

export default defineConfig({
  testDir: './e2e',
  outputDir: 'node_modules/.tmp/e2e-offline-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/offline-{platform}/{testFilePath}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  reporter: [['list']],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    ...devices['Desktop Chrome'],
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    baseURL: OFFLINE_ORIGIN,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'offline',
      testMatch: OFFLINE_SPECS,
      // These two probe a real backend's routes with write methods and a cross-site read; the demo API has no
      // such surface (its own refusals are pinned by src/demo/serve.test.ts).
      grepInvert: /no backend route|the backend answers every write method/,
      workers: 2,
    },
    { name: 'offline-perf', testMatch: BUDGETS_SPEC },
    {
      name: 'offline-demo',
      testDir: './e2e/offline',
      testMatch: /\.offline\.ts$/,
      use: { baseURL: DEMO_ORIGIN },
    },
  ],
  webServer: [
    {
      name: 'offline gallery preview',
      command: `${vite(`build --mode gallery --outDir ${q(OFFLINE_DIST)} --emptyOutDir`)} && ${vite(`preview --mode gallery --config ${OFFLINE_CONFIG} --outDir ${q(OFFLINE_DIST)} --port ${OFFLINE_PORT} --strictPort`)}`,
      cwd: WEB_DIR,
      url: `${OFFLINE_ORIGIN}/api/health`,
      env: { ...(process.env as Record<string, string>), ...QUIET_VITE, NQT_OFFLINE_API: 'on' },
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'offline demo preview',
      command: `${vite(`build --mode demo --outDir ${q(DEMO_DIST)} --emptyOutDir`)} && ${vite(`preview --mode demo --config ${OFFLINE_CONFIG} --outDir ${q(DEMO_DIST)} --port ${DEMO_PORT} --strictPort`)}`,
      cwd: WEB_DIR,
      url: `${DEMO_ORIGIN}/`,
      env: { ...(process.env as Record<string, string>), ...QUIET_VITE, NQT_OFFLINE_API: 'off' },
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
