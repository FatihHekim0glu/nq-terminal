// The live stream on LIVE and JRNL (TASKS 9.2): GET /api/live/stream as Server-Sent Events replaces polling.
// Runs against the fixture-mode backend (playwright.config.ts) through the gallery entry /__gallery/LiveScreen
// (LIVE above JRNL, each in its panel):
// - one stream serves both screens, the line says it is live, and /api/live/status is not polled while it is;
// - a journal row written to the fixture live folder reaches JRNL through the stream (a new file, then an
//   appended row), with no request in between; the file is removed in `finally`;
// - when a stream ends (a synthetic first stream with an id and `bye`) the browser reconnects to the real
//   server and sends the last event id back (Last-Event-ID); the server does not know that synthetic id,
//   starts afresh and says why in hello.resume_note, and the line shows it;
// - a refused stream (503, too many open) falls back to polling and says so.
// Every test checks axe WCAG 2.2 AA, no console errors (a refused stream's own EventSource message apart) and
// that every request is a same-origin GET.
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectGalleryAxeClean, openGallery, watchGallery, type GalleryWatch } from './gallery.ts'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_LOGS = path.resolve(WEB_DIR, '..', 'backend', 'tests', 'fixtures', 'live', 'logs')
const PROBE = path.join(FIXTURE_LOGS, 'e2e_stream_probe.PLUMBING_DELAYED.jsonl')
const STREAM_WAIT_MS = 15_000
const QUIET_MS = 5_000
const PROBE_ROW = { type: 'skipped', date: '2026-10-05', reason: 'e2e stream probe', mode: 'plumbing test, delayed data', strategy_performance: false }

const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const streamLine = (scope: Locator): Locator => scope.getByRole('group', { name: 'Live stream state' })
const isStream = (r: Request): boolean => new URL(r.url()).pathname === '/api/live/stream'
const isPath = (r: Request, p: string): boolean => new URL(r.url()).pathname === p

/** Same-origin GETs only, no console error but the ones `allowed` names, axe clean. */
async function expectClean(page: Page, watch: GalleryWatch, allowed: RegExp | null = null): Promise<void> {
  await expectGalleryAxeClean(page)
  expect(watch.errors.filter((e) => !(allowed && allowed.test(e)))).toEqual([])
  const origin = new URL(page.url()).origin
  expect(watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(origin)).map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

async function rowsTotal(jrnl: Locator): Promise<number> {
  const text = (await jrnl.getByText(/^Rows \d+ of \d+\./).first().textContent()) ?? ''
  return Number(/of (\d+)/.exec(text)?.[1] ?? Number.NaN)
}

test.describe('the live stream', () => {
  test.afterEach(() => fs.rmSync(PROBE, { force: true }))

  test('one stream serves LIVE and JRNL, and nothing polls while it is open', async ({ page }) => {
    const watch = await watchGallery(page)
    await openGallery(page, 'LiveScreen')
    for (const title of ['LIVE', 'JRNL']) {
      await expect(streamLine(panel(page, title)).getByRole('status')).toHaveText('live, server events', { timeout: STREAM_WAIT_MS })
    }
    expect(watch.requests.filter(isStream)).toHaveLength(1)
    const before = watch.requests.filter((r) => isPath(r, '/api/live/status')).length
    await page.waitForTimeout(QUIET_MS)
    expect(watch.requests.filter((r) => isPath(r, '/api/live/status')).length).toBe(before)
    await expect(streamLine(panel(page, 'LIVE'))).toContainText('Last event')
    await expectClean(page, watch)
  })

  test('a row written to a journal reaches JRNL through the stream, with no polling in between', async ({ page }) => {
    const watch = await watchGallery(page)
    fs.rmSync(PROBE, { force: true })
    await openGallery(page, 'LiveScreen')
    const jrnl = panel(page, 'JRNL')
    await expect(streamLine(jrnl).getByRole('status')).toHaveText('live, server events', { timeout: STREAM_WAIT_MS })
    await expect(jrnl.getByText(/^Rows \d+ of \d+\./).first()).toBeVisible()
    const start = await rowsTotal(jrnl)
    const journalReads = () => watch.requests.filter((r) => isPath(r, '/api/live/journal')).length
    await page.waitForTimeout(QUIET_MS)
    const quiet = journalReads()
    await page.waitForTimeout(QUIET_MS)
    expect(journalReads(), 'no journal request while nothing changed').toBe(quiet)
    fs.writeFileSync(PROBE, `${JSON.stringify(PROBE_ROW)}\n`, { encoding: 'utf-8' })
    await expect.poll(() => rowsTotal(jrnl), { timeout: STREAM_WAIT_MS }).toBe(start + 1)
    fs.appendFileSync(PROBE, `${JSON.stringify({ ...PROBE_ROW, date: '2026-10-06' })}\n`, { encoding: 'utf-8' })
    await expect.poll(() => rowsTotal(jrnl), { timeout: STREAM_WAIT_MS }).toBe(start + 2)
    expect(journalReads()).toBeGreaterThan(quiet)
    await expect(jrnl.locator('tr.plumbing-row', { hasText: '2026-10-06' }).first()).toBeVisible()
    await expectClean(page, watch)
  })

  test('the browser reconnects after the server ends a stream and sends the last event id back', async ({ page }) => {
    const watch = await watchGallery(page)
    let calls = 0
    await page.route('**/api/live/stream', async (route) => {
      calls += 1
      if (calls > 1) return route.continue()
      const hello = {
        kind: 'hello', schema_version: 1, resumed: false, resume_note: null, poll_s: 1, heartbeat_s: 10, lifetime_s: 1, retry_ms: 300,
        banner: 'PLUMBING TEST, DELAYED DATA: not strategy performance', basis: 'e2e', read_only: true, order_path: 'none',
      }
      const bye = { kind: 'bye', reason: 'stream lifetime reached; reconnect with Last-Event-ID', retry_ms: 300 }
      const body = `retry: 300\nid: e2e-cursor-1\nevent: hello\ndata: ${JSON.stringify(hello)}\n\nid: e2e-cursor-1\nevent: bye\ndata: ${JSON.stringify(bye)}\n\n`
      return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body })
    })
    await openGallery(page, 'LiveScreen')
    const line = streamLine(panel(page, 'LIVE'))
    await expect.poll(() => calls, { timeout: STREAM_WAIT_MS }).toBeGreaterThan(1)
    await expect(line.getByRole('status')).toHaveText('live, server events', { timeout: STREAM_WAIT_MS })
    // Chromium adds Last-Event-ID below the interception point, so the proof is the real server's answer: it
    // writes this note only when a request carried an id it did not issue (here the synthetic e2e-cursor-1).
    await expect(line).toContainText('no, sent afresh: Last-Event-ID not recognised')
    await expectClean(page, watch)
  })

  test('a refused stream falls back to polling and says why', async ({ page }) => {
    const watch = await watchGallery(page)
    await page.route('**/api/live/stream', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'too many live streams are open (at most 8); close one and retry' }),
    }))
    await openGallery(page, 'LiveScreen')
    const line = streamLine(panel(page, 'LIVE'))
    await expect(line.getByRole('status')).toContainText('polling every 2 s: the server refused the stream', { timeout: STREAM_WAIT_MS })
    const before = watch.requests.filter((r) => isPath(r, '/api/live/status')).length
    await page.waitForTimeout(QUIET_MS)
    expect(watch.requests.filter((r) => isPath(r, '/api/live/status')).length).toBeGreaterThanOrEqual(before + 2)
    // The browser reports the refused stream itself (a 503 with a JSON body): that message is the expected one.
    await expectClean(page, watch, /status of 503|EventSource's response has a MIME type/)
  })
})
