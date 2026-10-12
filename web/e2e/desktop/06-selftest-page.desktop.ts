// The self-test page in the app (04 D7.2): axe at WCAG 2.2 AA, the four quant goldens at 1e-9 relative and the feature probes
// (Perspective wasm32, dockview layout restore, stream mode, text copy, blob export through the bridge), run inside the hidden
// smoke build's own WebView2 page. The page is built by `vite build --mode selftest` (dist-selftest, under /__selftest/) and is in
// no production build; the shell is not changed. Here it is put into the app's page without touching the backend: this spec answers
// the page's own requests under /__selftest/ from dist-selftest (page.route), with the backend's own Content-Security-Policy, so
// the page runs under the policy the app does, on the app's origin, through the app's own bridge and download handler.
// The page publishes its report as `window.__selftest`; this spec reads it over the debugging protocol, as the others read the
// page (attach.ts), and judges it with the same judge the page's tests use (src/selftest/report.ts). It then checks the other
// end of the two probes the page cannot see: the Windows clipboard and the file in --save-dir.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page, Route } from '@playwright/test'
import { selftestBuildIsCurrent } from '../../scripts/selftestBuild.ts'
import { COPY_PROBE_TEXT, EXPORT_PROBE_NAME, EXPORT_PROBE_TEXT, GOLDEN_NAMES, judgeReport } from '../../src/selftest/report.ts'
import { changed, passingReport } from '../../src/selftest/report.testUtil.ts'
import { readClipboardText, writeClipboardText } from './clipboard.ts'
import { expectClean, watch, withFocusEmulation } from './app.ts'
import { expect, test } from './fixtures.ts'
import { TERMINAL_DIR } from './launch.ts'

const WEB_DIR = path.join(TERMINAL_DIR, 'web')
// NQT_SELFTEST_DIST names another build of the page (the born-failing run points it at a copy with one golden altered).
const OVERRIDE = process.env.NQT_SELFTEST_DIST ?? ''
const DIST_DIR = OVERRIDE === '' ? path.join(WEB_DIR, 'dist-selftest') : path.resolve(OVERRIDE)
const BASE = '/__selftest/'
const START_BUTTON = 'Run the clipboard and export probes'
const PAGE_WAIT_MS = 60_000
const RUN_WAIT_MS = 120_000

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

/** The file of dist-selftest a request path under /__selftest/ names, or null: outside the folder, absent or not a file. */
function distFileFor(dist: string, pathname: string): string | null {
  if (!pathname.startsWith(BASE)) return null
  const relative = decodeURIComponent(pathname.slice(BASE.length)) || 'index.html'
  const file = path.resolve(dist, relative)
  if (file !== path.resolve(dist) && !file.startsWith(path.resolve(dist) + path.sep)) return null
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null
}

function answer(route: Route, dist: string, policy: string): Promise<void> {
  const file = distFileFor(dist, new URL(route.request().url()).pathname)
  if (file === null) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not in the self-test build' })
  const headers = { 'content-security-policy': policy, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', headers, body: fs.readFileSync(file) })
}

/** dist-selftest, built now when it is missing or older than any input of the page: all of web/src, package.json, pnpm-lock.yaml and the goldens, at any depth (`vite build --mode selftest`, as `pnpm build:selftest`). */
function ensureSelftestBuild(dist: string = DIST_DIR): string {
  const index = path.join(dist, 'index.html')
  if (OVERRIDE !== '') {
    if (!fs.existsSync(index)) throw new Error(`NQT_SELFTEST_DIST has no index.html: ${dist}`)
    return dist
  }
  if (selftestBuildIsCurrent(index, WEB_DIR, TERMINAL_DIR)) return dist
  const vite = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
  execFileSync(process.execPath, [vite, 'build', '--mode', 'selftest', '--logLevel', 'error'], { cwd: WEB_DIR, windowsHide: true, stdio: 'pipe' })
  return dist
}

/** The Content-Security-Policy the backend sends the page it serves: read from the app's own answer, never copied here. */
async function backendPolicy(page: Page): Promise<string> {
  const policy = await page.evaluate(async () => (await fetch('/', { credentials: 'same-origin' })).headers.get('content-security-policy'))
  if (policy === null || policy === '') throw new Error('the backend sent no Content-Security-Policy with its page')
  return policy
}

test.describe('the self-test page guards fail on planted trouble', () => {
  test('born failing: a page report with one golden off by 1e-6 fails, and so does axe, a probe and an unfinished run', () => {
    expect(judgeReport(passingReport())).toEqual([])
    const off = changed(passingReport(), (r) => {
      const golden = r.goldens.find((g) => g.name === 'p12_power')
      if (golden === undefined) throw new Error('the passing report has no p12_power')
      golden.maxRelativeError = 1e-6
      golden.failed = 1
    })
    const failures = judgeReport(off)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('p12_power')
    expect(judgeReport(changed(passingReport(), (r) => { r.goldens[1]!.maxRelativeError = 5e-10 })), 'inside the tolerance').toEqual([])
    expect(judgeReport(changed(passingReport(), (r) => { r.axe!.violations = [{ id: 'color-contrast', impact: 'serious', help: 'h', nodes: 1 }] }))).toHaveLength(1)
    expect(judgeReport(changed(passingReport(), (r) => { r.probes[3]!.status = 'fail' }))).toHaveLength(1)
    expect(judgeReport(changed(passingReport(), (r) => { r.state = 'running' }))).toHaveLength(1)
    expect(GOLDEN_NAMES).toHaveLength(4)
  })

  test('the file server answers only files inside dist-selftest', () => {
    const dist = path.join(WEB_DIR, 'src', 'selftest')
    expect(distFileFor(dist, `${BASE}index.html`)).toBe(path.join(dist, 'index.html'))
    expect(distFileFor(dist, BASE)).toBe(path.join(dist, 'index.html'))
    for (const planted of [`${BASE}../report.ts`, `${BASE}..%2freport.ts`, `${BASE}nothing.js`, '/other/index.html', `${BASE}assets`]) {
      expect(distFileFor(dist, planted), planted).toBeNull()
    }
  })
})

test('the self-test page passes in the app: axe clean, four goldens of four, five probes', async ({ page, run }) => {
  const dist = ensureSelftestBuild()
  const w = watch(page)
  const owners = readClipboardText()
  const savedFile = path.join(run.saveDir, EXPORT_PROBE_NAME)
  const policy = await backendPolicy(page)
  await page.route(`${run.origin}${BASE}**`, (route) => answer(route, dist, policy))
  try {
    await withFocusEmulation(page, async () => {
      await page.goto(`${BASE}index.html`)
      const start = page.getByRole('button', { name: START_BUTTON })
      await expect(start, 'the page waits for its click').toBeVisible({ timeout: PAGE_WAIT_MS })
      writeClipboardText('')
      await start.click()
      await page.waitForFunction(() => (window as unknown as { __selftest?: { state?: string } }).__selftest?.state === 'done', null, { timeout: RUN_WAIT_MS })
    })
    const report: unknown = await page.evaluate(() => (window as unknown as { __selftest?: unknown }).__selftest)
    expect(judgeReport(report), 'the self-test report').toEqual([])
    expect(report, 'the page ran in the Windows shell').toMatchObject({ engine: { shell: 'windows', keys: 'pc', webAssembly: true } })
    expect(readClipboardText(), 'what the bridge put on the Windows clipboard').toBe(COPY_PROBE_TEXT)
    await expect.poll(() => fs.existsSync(savedFile), { message: `${savedFile} written`, timeout: 20_000 }).toBe(true)
    expect(fs.readFileSync(savedFile, 'utf8'), 'the exported file').toBe(EXPORT_PROBE_TEXT)
    expectClean(w, run.origin)
  } finally {
    await page.unroute(`${run.origin}${BASE}**`).catch(() => undefined)
    writeClipboardText(owners)
    fs.rmSync(savedFile, { force: true })
    await page.goto('/').catch(() => undefined)
  }
})
