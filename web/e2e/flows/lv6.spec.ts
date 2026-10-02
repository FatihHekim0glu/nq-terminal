// LV6 and LV6b on LIVE in the real app on the fixture backend: the paper book against its expectation, with the toggle
// between the backtest-start cone and the live-start cone (GET /api/analytics/paper-expectation, served).
//
// The fixture backend's paper book has no value yet, so the card says so and offers no toggle. The two served views the
// card needs are therefore given to the page by the test (page.route, as the IB flows do), captured from the fixture
// backend over a two session book (the backtest-start cone drawn, the live-start cone refused in words: it needs 30
// sessions with a value) and over a seeded 40 session synthetic book (both cones drawn). The toggle is offered because
// both cones are served. Every flow runs at
// 1920x1080 and 1366x768 and in both looks (standard and amber classic) with axe (wcag2a to wcag22aa) clean, no console
// error, no CSP report and every request a same-origin GET. The toggle is driven with the keyboard only. Screenshot
// baselines are taken of the cone chart with the mask colour black.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MASK_COLOR } from '../gallery.ts'
import { axeViolations, FROZEN_NOW, VIEWPORTS, type Viewport } from '../visual/screens.ts'
import { expectCleanFlow, openScreen, openTerminal, settle, watchFlow } from './support.ts'

/** The two served views (captured from the fixture backend, kept equal to src/screens/live/expectationFixtures.ts by a unit test). */
const SERVED = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lv6.served.json'), 'utf8')) as Record<'twoSessions' | 'fortySessions', object>
const PAPER_EXPECTATION = SERVED.twoSessions
const PAPER_EXPECTATION_LIVE = SERVED.fortySessions

test.describe.configure({ timeout: 180_000 })

const ROUTE = '/api/analytics/paper-expectation'
const CARD_LABEL = 'Paper book against its backtest expectation (SV6 cone)'
const TOGGLE_LABEL = 'Cone the paths are placed on'
const LIVE_SHORT = 'The live-start cone needs at least 30 paper sessions with a value; there are 2 so far.'

const LIVE_ANCHOR = "resampled from the paper book's own 40 sessions"

const size = (v: Viewport): string => `${v.width}x${v.height}`
const card = (page: Page): Locator => page.getByRole('region', { name: CARD_LABEL })
const toggle = (page: Page): Locator => card(page).getByRole('group', { name: TOGGLE_LABEL })
const backtest = (page: Page): Locator => toggle(page).getByRole('button', { name: 'Backtest start' })
const live = (page: Page): Locator => toggle(page).getByRole('button', { name: 'Live start' })

const frameOptions = (page: Page): Locator => page.locator('.frame-btn[aria-label="Options"]')

async function serveExpectation(page: Page, body: object): Promise<void> {
  await page.route('**' + ROUTE + '*', (route) => route.fulfill({ json: body }))
}

async function start(page: Page, viewport: Viewport) {
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.setViewportSize(viewport)
  const watch = await watchFlow(page)
  await openTerminal(page)
  return watch
}

// The cone chart alone: the card is clipped by its panel, so a screenshot of the card would also catch the panels around it.
async function shot(page: Page, name: string, viewport: Viewport): Promise<void> {
  await page.mouse.move(0, 0)
  await expect(card(page).locator('.live-expectation-chart')).toHaveScreenshot(`lv6-${name}-${size(viewport)}.png`, { maskColor: MASK_COLOR })
}

async function chooseAmberClassic(page: Page): Promise<void> {
  await frameOptions(page).focus()
  await page.keyboard.press('Enter')
  const group = page.getByRole('group', { name: 'Theme' })
  await expect(group).toBeVisible()
  await group.getByRole('button', { name: 'Amber classic theme' }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber-classic')
  await page.keyboard.press('Escape')
}

const expectationReads = (urls: readonly string[]): number => urls.filter((u) => new URL(u).pathname === ROUTE).length

for (const viewport of VIEWPORTS) {
  test.describe(`LV6 cone toggle at ${size(viewport)}`, () => {
    test('LIVE offers Backtest start and Live start: the chart first, the live-start words after the keyboard moves on', async ({ page }) => {
      await serveExpectation(page, PAPER_EXPECTATION)
      const watch = await start(page, viewport)
      await openScreen(page, 'LIVE', 'LIVE')
      await expect(card(page)).toContainText('[POST HOC]')
      await expect(toggle(page)).toBeVisible()
      await expect(backtest(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(live(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(card(page).locator('canvas, svg[role="img"], [role="img"]').first()).toBeVisible()
      await settle(page)
      expect(expectationReads(watch.requests.map((r) => r.url())), 'one served read').toBe(1)
      expect(await axeViolations(page), 'axe on the backtest-start cone').toEqual([])
      await shot(page, 'backtest', viewport)

      // The keyboard only: focus the pressed button, Tab or an arrow reaches the other, Space presses it.
      await backtest(page).focus()
      await page.keyboard.press('ArrowRight')
      await expect(live(page)).toBeFocused()
      await page.keyboard.press('Space')
      await expect(live(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(backtest(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(card(page)).toContainText(LIVE_SHORT)
      await expect(live(page)).toBeFocused()
      expect(await axeViolations(page), 'axe on the live-start words').toEqual([])

      await page.keyboard.press('ArrowLeft')
      await expect(backtest(page)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(backtest(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(card(page)).not.toContainText(LIVE_SHORT)
      await settle(page)
      expect(expectationReads(watch.requests.map((r) => r.url())), 'the toggle reads nothing').toBe(1)
      expect(await axeViolations(page), 'axe back on the backtest-start cone').toEqual([])
      await expectCleanFlow(page, watch)
    })

    test('both looks: the card and the live-start words are axe clean in the standard and the amber classic look', async ({ page }) => {
      await serveExpectation(page, PAPER_EXPECTATION_LIVE)
      const watch = await start(page, viewport)
      await chooseAmberClassic(page)
      await openScreen(page, 'LIVE', 'LIVE')
      await expect(toggle(page)).toBeVisible()
      expect(await axeViolations(page), 'axe, amber classic, backtest start').toEqual([])
      await live(page).focus()
      await page.keyboard.press('Space')
      await expect(card(page)).toContainText(LIVE_ANCHOR)
      await expect(card(page).locator('[role="img"], canvas').first()).toBeVisible()
      expect(await axeViolations(page), 'axe, amber classic, live start').toEqual([])
      await shot(page, 'live-start-amber', viewport)
      await backtest(page).focus()
      await page.keyboard.press('Space')
      await expect(card(page)).not.toContainText(LIVE_ANCHOR)
      await shot(page, 'backtest-amber', viewport)
      await expectCleanFlow(page, watch)
    })
  })
}
