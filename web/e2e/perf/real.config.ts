// Playwright config for the real-data smoke run (TASKS 8.3). terminal/scripts/smoke_real.ps1 starts a
// second backend on a spare port against the real data root and a `vite preview` of a private build in
// front of it, then runs this config with NQT_SMOKE_WEB_ORIGIN set; nothing here starts a server. It runs
// the trace arithmetic checks first (trace.spec.ts), then smoke.real.ts. The default E2E config never
// picks up smoke.real.ts (not a .spec file), so fixture runs cannot reach real files.
import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

const USER_BACKEND_PORT = 8765
const origin = process.env.NQT_SMOKE_WEB_ORIGIN ?? ''
const match = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/.exec(origin)
if (!match || Number(match[1]) === USER_BACKEND_PORT) {
  throw new Error(`NQT_SMOKE_WEB_ORIGIN must be http://127.0.0.1:<spare port> (not ${USER_BACKEND_PORT}); run terminal/scripts/smoke_real.ps1. Got "${origin}"`)
}

export default defineConfig({
  testDir: '.',
  testMatch: ['trace.spec.ts', 'smoke.real.ts'],
  // Outside e2e/.results, which a parallel fixture run empties when it starts.
  outputDir: path.join(os.tmpdir(), 'nqt-smoke-real-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 300_000,
  reporter: [['list']],
  expect: { timeout: 60_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'off',
  },
  projects: [{ name: 'chromium' }],
})
