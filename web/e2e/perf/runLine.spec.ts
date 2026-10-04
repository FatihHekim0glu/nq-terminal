// runLine (pages.ts) against a command index that arrives after HOME's frames. On the real-data smoke a busy backend on a
// cold cache answered GET /api/commands after the four HOME panels had shown, the line was entered before the index, was
// refused ("The command index has not loaded yet") and stayed in the box. The helper waits for the <GO> preview instead.
import { expect, test } from '@playwright/test'
import { commandLine, runLine } from './pages.ts'

const INDEX_DELAY_MS = 3_000

test('runLine waits for a command index that arrives after the HOME panels', async ({ page }) => {
  await page.route('**/api/commands', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, INDEX_DELAY_MS))
    await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
  const target = await runLine(page, 'NQ DES')
  await expect(target).toHaveCount(1)
  await expect(commandLine(page)).not.toHaveAttribute('aria-invalid', 'true')
})
