// The look in the app (04 D5.2; 03 section 15.1): HOME, GP, REG, the LEDG pivot and LIVE, plus HOME and REG in the amber classic
// look, compared pixel for pixel with the existing Windows Chromium baselines of the browser project (e2e/__screenshots__,
// read only: the baseline name is a path into that folder, and the config never updates a snapshot). WebView2 is the same
// engine, so the same frozen clock, reduced motion, 1920x1080 page and masks must give the same picture; a difference is a
// finding, and the allowance is the browser project's own (0.2% of the pixels).
//
// The baselines used (the app and the fixture backend are the same for both projects):
//   HOME, GP, REG, LEDG, LIVE with the command dropdown open  e2e/visual/screens.spec.ts  <NAME>-dropdown-1920x1080.png
//   HOME and REG in amber classic                              e2e/flows/p2.spec.ts       p2-<home|reg>-amber-classic-1920x1080.png
//
// This file runs last: the frozen clock is installed in the page for good (the engine's one context cannot be thrown away).
import type { Locator, Page } from '@playwright/test'
import { MASK_COLOR } from '../gallery.ts'
import { FROZEN_NOW, SCREENS, closeDropdown, openDropdown, openScreen, type ScreenCase } from '../visual/screens.ts'
import { expect, test, VIEWPORT } from './fixtures.ts'
import { clearStorage, openHome, settle, watch } from './app.ts'

const SIZE = `${VIEWPORT.width}x${VIEWPORT.height}`
const LOOK_SCREENS = ['HOME', 'GP', 'REG', 'LEDG', 'LIVE']
const baseline = (...parts: string[]): string[] => parts

/** The areas that follow the run's history or the wall clock (the same masks as e2e/visual/screens.spec.ts). */
function runCounters(page: Page): Locator[] {
  const status = page.getByRole('contentinfo')
  return [
    status.locator('.seg').filter({ hasText: 'Gate reads' }), status.locator('.seg.flag'), page.locator('.gp-footer'),
    page.locator('[data-key="stream-lastEvent"], [data-key="stream-rows"]'),
  ]
}

const screenCase = (name: string): ScreenCase => {
  const found = SCREENS.find((s) => s.name === name)
  if (found === undefined) throw new Error(`no screen ${name} in e2e/visual/screens.ts`)
  return found
}

/** The screen as the visual spec opens it, with its dropdown open and the mouse out of the way. */
async function showWithDropdown(page: Page, name: string): Promise<void> {
  await clearStorage(page)
  await openScreen(page, screenCase(name), VIEWPORT)
  await hideScrollbars(page)
  for (const line of await page.getByRole('group', { name: 'Live stream state' }).all()) {
    await expect(line.getByRole('status')).toHaveText('live, server events', { timeout: 15_000 })
  }
  await openDropdown(page)
  await page.mouse.move(0, 0)
}

const frameOptions = (page: Page): Locator => page.locator('.frame-btn[aria-label="Options"]')

/**
 * The one explained difference from the baselines: Playwright's headless Chromium hides scrollbars (--hide-scrollbars), the
 * app's real window draws the classic 15 px ones, which narrow every panel that scrolls and shift its text. They are hidden
 * here (the page's own scrollbar-width) so that every other difference shows; the app itself is not changed.
 */
async function hideScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({ content: '* { scrollbar-width: none !important }' })
  await settle(page)
}

test.describe('the look against the Windows Chromium baselines', () => {
  test.describe.configure({ timeout: 180_000 })

  for (const name of LOOK_SCREENS) {
    test(`${name} with the dropdown open equals e2e/visual baseline ${name}-dropdown-${SIZE}`, async ({ page, run }) => {
      const w = watch(page)
      await showWithDropdown(page, name)
      await expect(page).toHaveScreenshot(baseline('visual', 'screens.spec.ts', `${name}-dropdown-${SIZE}.png`), { mask: runCounters(page), maskColor: MASK_COLOR })
      await closeDropdown(page)
      expect.soft(w.errors, 'console errors').toEqual([])
      expect(new URL(page.url()).origin).toBe(run.origin)
    })
  }

  test('HOME and REG in the amber classic look equal e2e/flows baselines p2-home|reg-amber-classic', async ({ page }) => {
    await page.clock.setFixedTime(FROZEN_NOW)
    await openHome(page)
    await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
    try {
      await frameOptions(page).click()
      await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Amber classic theme' }).click()
      await page.keyboard.press('Escape')
      await page.reload()
      await expect(page.getByRole('contentinfo')).toContainText('KILL off')
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic')
      await settle(page)
      await hideScrollbars(page)
      await page.mouse.move(0, 0)
      await expect(page).toHaveScreenshot(baseline('flows', 'p2.spec.ts', `p2-home-amber-classic-${SIZE}.png`), { mask: runCounters(page), maskColor: MASK_COLOR })
      await openScreen(page, screenCase('REG'), VIEWPORT)
      await hideScrollbars(page)
      await page.mouse.move(0, 0)
      await expect(page).toHaveScreenshot(baseline('flows', 'p2.spec.ts', `p2-reg-amber-classic-${SIZE}.png`), { mask: runCounters(page), maskColor: MASK_COLOR })
    } finally {
      // Back to the standard look from the same menu, so nothing after this file inherits the theme.
      await clearStorage(page)
      await page.reload()
    }
  })

  test('born failing: a planted block of pixels makes the comparison fail', async ({ page }) => {
    await showWithDropdown(page, 'HOME')
    // The unplanted picture is the baseline (the first test of this file); a 120 x 120 block is 0.7% of the page, over the 0.2%.
    await page.addStyleTag({ content: '#nqt-plant { position: fixed; left: 600px; top: 400px; width: 120px; height: 120px; background: #ff00ff; z-index: 2147483647 }' })
    await page.evaluate(() => { const el = document.createElement('div'); el.id = 'nqt-plant'; document.body.append(el) })
    try {
      await expect(page).not.toHaveScreenshot(baseline('visual', 'screens.spec.ts', `HOME-dropdown-${SIZE}.png`), { mask: runCounters(page), maskColor: MASK_COLOR })
    } finally {
      await page.evaluate(() => document.getElementById('nqt-plant')?.remove())
    }
  })
})
