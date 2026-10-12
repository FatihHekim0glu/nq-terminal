// Playwright project of the desktop app (04 D5.2; 03 section 15.4): `pnpm e2e:desktop`.
//
// It drives the hidden smoke build of the Windows shell, not a browser. The global set-up (e2e/desktop/setup.ts) starts the
// global window watch, launches the smoke exe with --fixture (fixture_main, the same synthetic serve and catalogue as the
// browser fixture backend), --size 1920x1080 and debugging port 0, reads DevToolsActivePort and attaches over the debugging
// protocol; e2e/desktop/fixtures.ts hands the app's own page to every spec. The launch has a PATH without D:/dev/mingw and
// D:/dev/cargo, no WEBVIEW2_* variable and windowsHide; the set-up's tear-down ends only the tree it started.
//
// The specs are named *.desktop.ts, not *.spec.ts: the browser project (playwright.config.ts) takes every *.spec.ts under e2e and
// must never pick these up. One app, one window: one worker, in file order (the look runs last, because its frozen clock stays in the page). The one browser a spec may launch is the headless
// Chromium door of the parity list (e2e/desktop/parityAuto.ts), from the browsers already installed (never `playwright install`); no web server is started, and the owner's backend on 8765 is
// never touched. Needs a smoke build (NQT_SMOKE_EXE, or D:/dev/targets/w5a-app-smoke/release) and a built web/dist.
// Everything the run writes goes under D:/dev/d5/app (NQT_APP_RUNS moves it, never onto C:).
//
// The look compares with the existing Windows Chromium baselines in e2e/__screenshots__ (read only: updateSnapshots is
// 'none', so a missing baseline fails and nothing is ever rewritten).
import { defineConfig } from '@playwright/test'
import path from 'node:path'

const RUNS = process.env.NQT_APP_RUNS ?? 'D:/dev/d5/app'
if (/^c:/i.test(path.resolve(RUNS))) throw new Error(`the desktop project writes under D: only; NQT_APP_RUNS is ${RUNS}`)

// The real-data runs in app mode run the same project against the real backend: scripts/smoke_real.ps1 -Mode App runs one spec,
// e2e/desktop/smoke.app.ts, and the weekly parity list (D6.2) runs the other, e2e/desktop/parity.app.ts. Neither is a *.desktop.ts file,
// so the fixture run never reaches real files, and the real run takes these two and nothing else (scripts/playwrightDesktopConfig.test.ts).
// The fixture run of the parity list is e2e/desktop/80-parity-auto.desktop.ts; both share e2e/desktop/parityAuto.ts.
const REAL = process.env.NQT_DESKTOP_MODE === 'real'
const REAL_SPECS = /(smoke|parity)\.app\.ts$/

// The harness's t8 mode starts the shell itself and names it in NQT_DESKTOP_ATTACH_CDP and NQT_DESKTOP_ATTACH_URL (e2e/desktop/attach.ts):
// the set-up launches nothing then, and only the specs that need no folder of the shell and no fixture backend run.
const ATTACHED = (process.env.NQT_DESKTOP_ATTACH_CDP ?? '') !== '' || (process.env.NQT_DESKTOP_ATTACH_URL ?? '') !== ''
const ATTACH_SPECS = /(05-selftest|10-walk)\.desktop\.ts$/

export default defineConfig({
  testDir: './e2e/desktop',
  testMatch: REAL ? REAL_SPECS : ATTACHED ? ATTACH_SPECS : /\.desktop\.ts$/,
  globalSetup: './e2e/desktop/setup.ts',
  outputDir: path.join(RUNS, 'playwright-output'),
  snapshotPathTemplate: '{testDir}/../__screenshots__/{arg}{ext}',
  updateSnapshots: 'none',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: REAL ? 300_000 : 120_000,
  reporter: [['list']],
  expect: {
    timeout: REAL ? 60_000 : 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: { trace: 'off' },
  projects: [{ name: 'desktop' }],
})
