// Playwright E2E (TASKS 4.4, ARCHITECTURE section 11). Two web servers, both on spare loopback ports
// and never reused, so a run cannot touch the user's real backend on 8765 or the real audit log:
//   1. the backend in FIXTURE mode: backend/tests/fixture_app.py (fake serve, temporary audit log),
//      with NQT_FIXTURE_DIR pointing at backend/tests/fixtures;
//   2. `vite build` then `vite preview`, proxying /api to that backend (e2e/vite.preview.config.ts).
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
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      name: 'backend (fixture mode)',
      command: `${q(PYTHON)} -m uvicorn fixture_app:app --app-dir ${q(BACKEND_TESTS)} --host 127.0.0.1 --port ${API_PORT}`,
      url: `${API_ORIGIN}/api/health`,
      env: {
        ...(process.env as Record<string, string>),
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
      command: `pnpm exec vite build && pnpm exec vite preview --config e2e/vite.preview.config.ts --port ${WEB_PORT} --strictPort`,
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
