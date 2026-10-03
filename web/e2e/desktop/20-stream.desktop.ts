// Stream mode in the app (04 D5.2; 03 section 15.4): LIVE and JRNL read the server's event stream, not a polling loop. The
// screens say which they are in ("live, server events" or "polling every N s"), and the page opens one request to
// /api/live/stream. A WebView2 page that cannot hold the stream (a throttled hidden window, a blocked connection) would fall
// back to polling and say so, which this catches.
import { expect, test } from './fixtures.ts'
import { expectClean, open, openHome, watch } from './app.ts'

const STREAM_PATH = '/api/live/stream'
const STREAM_WORDS = 'live, server events'
const SETTLE_MS = 3000

test('LIVE and JRNL are in stream mode over the server events, not polling', async ({ page, run }) => {
  const w = watch(page)
  await openHome(page)
  for (const line of ['LIVE', 'JRNL']) {
    await open(page, line)
    // The state group is read on the page (as e2e/visual/screens.spec.ts does): it sits in the screen's header.
    const states = page.getByRole('group', { name: 'Live stream state' })
    await expect(states.first(), `${line} stream state`).toBeVisible({ timeout: 30_000 })
    for (const state of await states.all()) await expect(state.getByRole('status'), `${line} stream state`).toHaveText(STREAM_WORDS, { timeout: 30_000 })
  }
  const opened = (): number => w.requests.filter((r) => new URL(r.url()).pathname === STREAM_PATH).length
  expect(opened(), 'stream requests').toBeGreaterThan(0)
  // Left alone the stream stays open and in stream mode: no reconnect loop, and the screens still say so.
  const before = opened()
  await page.waitForTimeout(SETTLE_MS)
  expect(opened(), 'stream requests after the wait: no reconnect').toBe(before)
  for (const state of await page.getByRole('group', { name: 'Live stream state' }).all()) {
    await expect(state.getByRole('status')).toHaveText(STREAM_WORDS)
  }
  expectClean(w, run.origin)
})
