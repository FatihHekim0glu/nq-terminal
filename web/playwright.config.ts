// Playwright E2E (TASKS 4.4, ARCHITECTURE section 11). Two web servers, both on spare loopback ports
// and never reused, so a run cannot touch the user's real backend on 8765 or the real audit log:
//   1. the backend in FIXTURE mode: backend/tests/fixture_app.py (fake serve, temporary audit log),
//      with NQT_FIXTURE_DIR pointing at backend/tests/fixtures;
//   2. `vite build --mode gallery` then `vite preview`, proxying /api to that backend
//      (e2e/vite.preview.config.ts); the gallery build adds /__gallery/<name> (e2e/gallery.ts).
// Ports: NQT_E2E_API_PORT (default 8795) and NQT_E2E_WEB_PORT (default 4273).
//
// The backend is behind the session token (03 section 2.6): it takes its own temporary state folder (so its own lock and
// token, never the user's), a global set-up (e2e/session.setup.ts) reads the token from that lock, mints a one-time code
// and redeems it on the preview origin through session.html in a headless browser, and every test context starts with
// the cookie it got (use.storageState). The performance project shares the run, so it gets the cookie the same way.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLEAN_DIRS_ENV } from './scripts/e2eTeardown.ts'

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
const MACHINE_SETTINGS = ['NQT_IB_READONLY', 'IB_HOST', 'IB_PORT','IB_ACCOUNT_ID', 'IB_BASE_USD_RATE', 'IB_PAPER_DELAYED_DATA', 'VOLMAN_C'] as const
const FIXTURE_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...Object.fromEntries(MACHINE_SETTINGS.map((key) => [key, ''])),
}

const BUDGETS_SPEC = /perf[\\/]budgets\.spec\.ts$/

const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
const q = (p: string) => `"${p}"`

// The app is built into a folder of this run's own and served from it (improvement run 3). The preview used
// to serve dist-gallery, which any other gallery build (`pnpm build:gallery`, another E2E start) empties and
// rewrites: a page then asked for a chunk that was gone (404) and never booted. That was the QA round's failing
// keyboard flow (an empty workspace) and gallery entries that never finished loading. One folder per web port:
// Playwright refuses a web port already in use before it runs the build, so no two runs share a folder.
const RUN_TMP = path.join(WEB_DIR, 'node_modules', '.tmp')
const E2E_DIST = path.join(RUN_TMP, `e2e-gallery-${WEB_PORT}`)
// The backend's own state folder (its lock, token and caches) and the session cookie the set-up saves, both named
// e2e-* directly under node_modules/.tmp, which is what the teardown removes.
const E2E_STATE = path.join(RUN_TMP, `e2e-state-${WEB_PORT}`)
const E2E_STORAGE = path.join(RUN_TMP, `e2e-session-${WEB_PORT}.json`)
const ENSURE_RUN_DIR = path.join(WEB_DIR, 'scripts', 'start', 'ensureRunDir.ts')
const PROOF_URL = `${API_ORIGIN}/api/desktop/proof?nonce=${'0'.repeat(64)}`
// The build folder and the cookie are removed when the run ends (scripts/e2eTeardown.ts), so runs on different ports
// leave nothing behind on the system drive but the backend's small state folder.
// The state folder is not listed: the backend still holds its lock when the teardown runs, so it is emptied by the next run's
// start instead (ensureRunDir.ts --fresh).
process.env[CLEAN_DIRS_ENV] = JSON.stringify([E2E_DIST, E2E_STORAGE])
// Read by e2e/session.setup.ts (this process); the cookie file is also named for specs that make a context of their own.
process.env.NQT_E2E_SESSION = JSON.stringify({ stateDir: E2E_STATE, apiPort: API_PORT, webOrigin: WEB_ORIGIN, storage: E2E_STORAGE })
process.env.NQT_E2E_STORAGE_STATE = E2E_STORAGE

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  globalSetup: './e2e/session.setup.ts',
  globalTeardown: './scripts/e2eTeardown.ts',
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
    storageState: E2E_STORAGE,
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
  // sockets in TIME_WAIT at the start of a run (Windows holds each for two minutes; two workers peaked at about
  // 1,200), and one run lost a page load there to net::ERR_NO_BUFFER_SPACE.
  projects: [
    { name: 'chromium', testIgnore: BUDGETS_SPEC, workers: 2 },
    { name: 'perf', testMatch: BUDGETS_SPEC },
  ],
  webServer: [
    {
      name: 'backend (fixture mode)',
      // The state folder must exist before the backend starts (it refuses a given NQT_STATE_DIR that is missing).
      command: `node ${q(ENSURE_RUN_DIR)} --fresh ${q(E2E_STATE)} && ${q(PYTHON)} -m uvicorn fixture_app:app --app-dir ${q(BACKEND_TESTS)} --host 127.0.0.1 --port ${API_PORT}`,
      // Every other /api path needs a session; the proof route needs none (an answer of 200 means the backend is up).
      url: PROOF_URL,
      env: {
        ...FIXTURE_ENV,
        // Its own state folder: its own lock and token, never the user's terminal/state.
        NQT_STATE_DIR: E2E_STATE,
        NQT_FIXTURE_DIR: FIXTURES,
        // JOBS runs a stand-in script in a temporary folder, never the real run_base (backend/tests/fixture_app.py).
        NQT_FIXTURE_JOBS: 'fake',
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
      // The gallery build (the production app plus /__gallery/<name> for the component screenshots) in this
      // run's own folder (E2E_DIST). It never writes dist, which start.ps1 serves, nor dist-gallery.
      command: `pnpm exec vite build --mode gallery --outDir ${q(E2E_DIST)} --emptyOutDir && pnpm exec vite preview --mode gallery --config e2e/vite.preview.config.ts --outDir ${q(E2E_DIST)} --port ${WEB_PORT} --strictPort`,
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
