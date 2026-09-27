// Playwright E2E (TASKS 4.4, ARCHITECTURE section 11). Two web servers, both on spare loopback ports
// and never reused, so a run cannot touch the user's real backend on 8765 or the real audit log:
//   1. the backend in FIXTURE mode: backend/tests/fixture_app.py (fake serve, temporary audit log),
//      with NQT_FIXTURE_DIR pointing at backend/tests/fixtures;
//   2. `vite build --mode gallery` then `vite preview`, proxying /api to that backend
//      (e2e/vite.preview.config.ts); the gallery build adds /__gallery/<name> (e2e/gallery.ts).
// Ports: NQT_E2E_API_PORT (default 8795) and NQT_E2E_WEB_PORT (default 4273).
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url))
const TERMINAL_DIR = path.resolve(WEB_DIR, '..')
const PROJECT_DIR = path.resolve(TERMINAL_DIR, '..')
const BACKEND_TESTS = path.join(TERMINAL_DIR, 'backend', 'tests')
const FIXTURES = path.join(BACKEND_TESTS, 'fixtures')
const PYTHON = process.platform === 'win32'
  ? path.join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(PROJECT_DIR, '.venv', 'bin', 'python')

const REAL_BACKEND_PORT = 8765
const API_PORT = Number(process.env.NQT_E2E_API_PORT ?? 8795)
const WEB_PORT = Number(process.env.NQT_E2E_WEB_PORT ?? 4273)
for (const port of [API_PORT, WEB_PORT]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === REAL_BACKEND_PORT) {
    throw new Error(`E2E ports must be spare loopback ports other than ${REAL_BACKEND_PORT}; got ${port}`)
  }
}

// The paper-book settings of this machine are blanked in the fixture backend's environment: LIVE shows
// whether each is set, so a baseline must not depend on the shell it ran in. Playwright spreads
// process.env under a web server's env, so each key is overridden with an empty value (read as unset).
const MACHINE_SETTINGS = ['IB_HOST', 'IB_PORT', 'IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C'] as const
const FIXTURE_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...Object.fromEntries(MACHINE_SETTINGS.map((key) => [key, ''])),
}

const BUDGETS_SPEC = /perf[\\/]budgets\.spec\.ts$/

const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
const q = (p: string) => `"${p}"`

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
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
    baseURL: WEB_ORIGIN,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
  },
  // The wall-clock performance budgets (e2e/perf/budgets.spec.ts) are their own project and their own command:
  // `pnpm e2e` runs the main project (with --workers=4 if wanted), then `pnpm e2e:perf` runs the budgets alone
  // in one worker, so CPU contention from other specs never decides them. The budgets depend on no other
  // project: a failure in the main run no longer skips them (improvement run 3).
  // The main project runs at most two workers, even under --workers=4: four workers left about 5,900 loopback
  // sockets in TIME_WAIT at the start of a run (Windows holds each for two minutes), and runs lost a page load
  // there to net::ERR_NO_BUFFER_SPACE or an empty workspace (a keyboard flow and a books spec failed that way).
  projects: [
    { name: 'chromium', testIgnore: BUDGETS_SPEC, workers: 2 },
    { name: 'perf', testMatch: BUDGETS_SPEC },
  ],
  webServer: [
    {
      name: 'backend (fixture mode)',
      command: `${q(PYTHON)} -m uvicorn fixture_app:app --app-dir ${q(BACKEND_TESTS)} --host 127.0.0.1 --port ${API_PORT}`,
      url: `${API_ORIGIN}/api/health`,
      env: {
        ...FIXTURE_ENV,
        NQT_FIXTURE_DIR: FIXTURES,
        // The backend's same-origin check lists the terminal origins by port: the preview is one.
        NQT_PORT: String(WEB_PORT),
        PYTHONUTF8: '1',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'vite preview',
      // The gallery build (dist-gallery): the production app plus /__gallery/<name> for the
      // component screenshots. It never writes dist, which start.ps1 serves.
      command: `pnpm exec vite build --mode gallery && pnpm exec vite preview --mode gallery --config e2e/vite.preview.config.ts --port ${WEB_PORT} --strictPort`,
      cwd: WEB_DIR,
      url: `${WEB_ORIGIN}/`,
      env: { ...(process.env as Record<string, string>), NQT_E2E_API_ORIGIN: API_ORIGIN },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
