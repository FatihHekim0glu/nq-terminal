// A dropdown opened in a panel that is NOT maximised, at 200% zoom (WCAG 2.2 SC 1.4.4 Resize Text and SC 1.4.10 Reflow). The panel
// clips its contents (overflow: hidden) and a stacked panel of a 1,024 x 640 window at 200% is only about 256 CSS px high, so a
// menu at its natural size lost its last rows and, in the 2 x 2 grid of a 1,920 x 1,080 window, its right-hand edge. DropdownMenu
// (src/chrome/FunctionBar.menu.fit.ts) holds the menu to the panel's box and scrolls it inside its own height. For each HOME panel
// the Options menu and every red function bar menu is opened and:
//   - the menu's own box lies inside the panel and inside the viewport;
//   - every row is reachable: scrolled into the menu, its box lies inside the menu, the panel and the viewport;
//   - Escape closes the menu and gives focus back to the button that opened it, and the panel's title bar is still in view.
// The unit test src/chrome/FunctionBar.menu.fit.test.tsx pins the arithmetic; this spec proves the outcome in a browser.
// Runs against the fixture-mode backend (playwright.config.ts), the main chromium project.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { dismissOrientation } from './orientation.ts'
import { openScreen, SCREENS, type Viewport } from './visual/screens.ts'

const WINDOWS: readonly Viewport[] = [
  { width: 512, height: 320 },
  { width: 960, height: 540 },
]
const ZOOM = 2
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG'] as const
/** The slack a browser's sub-pixel layout and a 1px border can leave. */
const SLACK = 1

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

async function boxOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('an element that should be on screen has no box')
  return box
}

function lies(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - SLACK &&
    inner.y >= outer.y - SLACK &&
    inner.x + inner.width <= outer.x + outer.width + SLACK &&
    inner.y + inner.height <= outer.y + outer.height + SLACK
  )
}

/** Opens the menu behind `trigger`, checks it against the panel and the viewport, then closes it with Escape. */
async function checkMenu(page: Page, panel: Locator, trigger: Locator, viewport: Viewport, label: string): Promise<void> {
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu, `${label}: the menu opens`).toHaveCount(1)
  const screen: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height }
  const panelBox = await boxOf(panel)
  expect(lies(await boxOf(menu), panelBox), `${label}: the menu lies inside its panel`).toBe(true)
  expect(lies(await boxOf(menu), screen), `${label}: the menu lies inside the viewport`).toBe(true)
  const rows = menu.getByRole('menuitem')
  const count = await rows.count()
  expect(count, `${label}: the menu has rows`).toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i)
    await row.scrollIntoViewIfNeeded()
    const rowBox = await boxOf(row)
    const name = (await row.textContent()) ?? `row ${i}`
    expect(lies(rowBox, await boxOf(menu)), `${label}: "${name}" is reachable inside the menu`).toBe(true)
    expect(lies(rowBox, panelBox), `${label}: "${name}" is inside the panel`).toBe(true)
    expect(lies(rowBox, screen), `${label}: "${name}" is inside the viewport`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(menu, `${label}: Escape closes the menu`).toHaveCount(0)
  await expect(trigger, `${label}: focus returns to the button`).toBeFocused()
  expect(lies(await boxOf(panel.locator('.ptitle')), panelBox), `${label}: the title bar is still in view`).toBe(true)
}

test.describe.configure({ timeout: 120_000 })

for (const win of WINDOWS) {
  test.describe(`200% zoom in a ${win.width * ZOOM} x ${win.height * ZOOM} window, menus of a panel that is not maximised`, () => {
    test.use({ viewport: win, deviceScaleFactor: ZOOM })

    test.beforeEach(async ({ page }) => {
      await dismissOrientation(page)
      await page.goto('/')
      await expect(page.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 45_000 })
      await openScreen(page, SCREENS[0]!, win)
    })

    for (const title of HOME_TITLES) {
      test(`${title}: the Options menu and the function bar menus stay inside the panel`, async ({ page }) => {
        const panel = page.locator(`[data-nqt-title="${title}"]`)
        await expect(panel).toHaveCount(1)
        await panel.scrollIntoViewIfNeeded()
        await checkMenu(page, panel, panel.getByRole('button', { name: 'Options' }), win, `${title} Options`)
        const bar = panel.getByRole('toolbar')
        const menuButtons = bar.locator('button[aria-haspopup="menu"]')
        const buttons = await menuButtons.count()
        for (let i = 0; i < buttons; i += 1) {
          const button = menuButtons.nth(i)
          await checkMenu(page, panel, button, win, `${title} bar menu ${(await button.textContent()) ?? i}`)
        }
      })
    }
  })
}
