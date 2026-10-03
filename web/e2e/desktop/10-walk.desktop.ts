// HOME and the eight screens of the spike, in the hidden smoke build (04 D5.2; 03 section 15.4; 00_spike_webview2): HOME,
// then LEDG, OOS, NQ GP 1d, volmanaged_v0 EQ, LIVE, 27F MON, REG and HOME again, each opened from the command line the way a
// person does. The page is the shell's own WebView2 page over the app-launched fixture backend, so this also proves the
// chain the owner uses: spawn, handshake, session cookie, page.
//
// A hidden window gets no frames and throttled timers unless the shell makes the page visible behind it (put_IsVisible); the
// first test asserts that, with the page's visibility state and its animation frame rate.
import { expect, test } from './fixtures.ts'
import { HOME_READY } from '../perf/pages.ts'
import { expectClean, open, openHome, panel, typeLine, watch } from './app.ts'

interface Stop {
  readonly line: string
  /** The code the status line names once the screen is open. */
  readonly code: string
  /** Charts the screen draws on the fixture data (each in a ChartA11y figure). */
  readonly charts: number
}

const WALK: readonly Stop[] = [
  { line: 'LEDG', code: 'LEDG', charts: 0 },
  { line: 'OOS', code: 'OOS', charts: 0 },
  { line: 'NQ GP 1d', code: 'GP', charts: 1 },
  { line: 'volmanaged_v0 EQ', code: 'EQ', charts: 2 },
  { line: 'LIVE', code: 'LIVE', charts: 1 },
  { line: '27F MON', code: 'MON', charts: 0 },
  { line: 'REG', code: 'REG', charts: 2 },
]

const FRAME_WINDOW_MS = 1000
/** A visible page runs near the display rate (about 240 frames a second was measured); a hidden, throttled one stops. */
const MIN_FRAMES = 20

test.describe('the app walk', () => {
  test('the page is visible behind the hidden window: frames run and timers tick', async ({ page }) => {
    await openHome(page)
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
    const frames = await page.evaluate((ms) => new Promise<number>((resolve) => {
      let n = 0
      const t0 = performance.now()
      const tick = (): void => { n += 1; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(n) }
      requestAnimationFrame(tick)
    }), FRAME_WINDOW_MS)
    expect(frames, 'animation frames in one second').toBeGreaterThan(MIN_FRAMES)
  })

  test('HOME opens its four panels with their data', async ({ page, run }) => {
    const w = watch(page)
    await openHome(page)
    await expect(page.getByRole('contentinfo')).toContainText('KILL off')
    expectClean(w, run.origin)
  })

  test('LEDG, OOS, NQ GP 1d, volmanaged_v0 EQ, LIVE, 27F MON, REG and HOME again open from the command line', async ({ page, run }) => {
    const w = watch(page)
    await openHome(page)
    for (const stop of WALK) {
      const target = await open(page, stop.line)
      await expect(page.getByRole('contentinfo'), stop.line).toContainText(`Screen ${stop.code}`)
      expect(await target.locator('[role="alert"]').count(), `${stop.line}: an alert on screen`).toBe(0)
      expect(await target.locator('[data-placeholder]').count(), `${stop.line}: a placeholder screen`).toBe(0)
      // Charts are counted on the page: REG's two sit in the MT panel it opens beside itself.
      await expect.poll(() => page.locator('.chart-a11y').count(), { message: `${stop.line}: charts` }).toBeGreaterThanOrEqual(stop.charts)
    }
    // HOME again: the four launchpad panels, not one panel titled HOME.
    await typeLine(page, 'HOME')
    await expect(page.getByRole('contentinfo')).toContainText('Screen HOME')
    for (const [title] of HOME_READY) await expect(panel(page, title), `HOME panel ${title}`).toBeVisible()
    expectClean(w, run.origin)
  })
})
