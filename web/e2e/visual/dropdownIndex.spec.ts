// The command dropdown of the visual baselines holds the rows of the command index (instruments, hypotheses, runs), which
// arrive with GET /api/commands after the functions have listed. A baseline taken before them shows a shorter list, and
// Playwright's screenshot check accepts two identical frames as stable, so the run failed on a pixel count instead of
// waiting. These cases hold the index back and check what the two openers see.
import { expect, test, type Page } from '@playwright/test'
import { watchGallery } from '../gallery.ts'
import { INDEX_ROWS, openDropdown, openDropdownEarly } from './screens.ts'

const HELD_MS = 8_000

async function holdTheIndex(page: Page): Promise<void> {
  let first = true
  await page.route('**/api/commands', async (route) => {
    if (first) {
      first = false
      await new Promise((resolve) => setTimeout(resolve, HELD_MS))
    }
    await route.continue()
  })
}

async function open(page: Page): Promise<void> {
  await watchGallery(page)
  await holdTheIndex(page)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
}

test('regression guard: while the index is held back the early dropdown lists functions and no index row', async ({ page }) => {
  await open(page)
  await openDropdownEarly(page)
  expect(await page.getByRole('listbox').locator(INDEX_ROWS).count(), 'no index row yet').toBe(0)
})

test('openDropdown waits for the held-back index and lists its rows', async ({ page }) => {
  await open(page)
  await openDropdown(page)
  expect(await page.getByRole('listbox').locator(INDEX_ROWS).count(), 'index rows in the list').toBeGreaterThan(0)
})
