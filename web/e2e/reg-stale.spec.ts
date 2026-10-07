// REG registry staleness banner and the round rail's scroll region (V031), against the fixture-mode backend
// (playwright.config.ts), whose registry is fresh and holds two rows:
// - a stale registry (the backend's `stale`, `generated_at` and `newest_input_at`, put into the answer here, since the
//   fixture backend serves a fresh one) shows one polite line with an icon in REG and in HOME's REG cell, naming the
//   newest result and scripts/registry.py, with no control that writes anything, and axe stays clean;
// - the fixture's fresh registry shows no banner and the same default look (the region is empty and has no height);
// - with as many rounds and rows as the real registry has, axe reports no `scrollable-region-focusable` on HOME or REG:
//   the round rail no longer scrolls inside the panel, whose body is the one Tab stop.
// Headless only. The page's own requests stay GET.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { AXE_TAGS } from './gallery.ts'

const SIZE = { width: 1920, height: 1080 } as const
const REG_TITLE = 'REG'
/** Registry rows and rounds in the size of results/registry.csv today (60 rows), so the rail has more rounds than a panel has room for. */
const REAL_ROWS = 60
const REAL_ROUNDS = 45

const STALE_FIELDS = {
  stale: true,
  generated_at: '2026-10-05T09:15:30Z',
  newest_input_at: '2026-10-06T07:42:10Z',
  newest_input_path: 'results/nt_newest_run/summary.json',
} as const
const STALE_LINE =
  'Registry is older than the newest result (results/nt_newest_run/summary.json, 2026-10-06 07:42 UTC); rebuild it with scripts/registry.py.'

interface Row { readonly name: string }
interface RegistryBody { readonly counts: Readonly<Record<string, number>>; readonly rows: readonly Row[] }

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const banner = (page: Page, title: string): Locator => panel(page, title).locator('[data-reg-stale]')

/** Puts the stale fields into the registry answer, as a rebuilt-later research folder would make the backend serve them. */
async function serveStale(page: Page): Promise<void> {
  await page.route('**/api/registry', async (route) => {
    const body = (await (await route.fetch()).json()) as RegistryBody
    await route.fulfill({ json: { ...body, ...STALE_FIELDS } })
  })
}

/** Pads the registry and the hypothesis cards to REAL_ROWS rows spread over REAL_ROUNDS rounds. */
async function serveRealSize(page: Page): Promise<void> {
  await page.route('**/api/registry', async (route) => {
    const body = (await (await route.fetch()).json()) as RegistryBody
    const rows = [...body.rows]
    for (let i = 0; rows.length < REAL_ROWS; i++) rows.push({ ...body.rows[i % body.rows.length]!, name: `${body.rows[i % body.rows.length]!.name}_pad${i}` })
    await route.fulfill({ json: { ...body, rows, counts: { ...body.counts, rows: REAL_ROWS } } })
  })
  await page.route('**/api/hypotheses', async (route) => {
    const cards = (await (await route.fetch()).json()) as Row[]
    const padded: unknown[] = [...cards]
    for (let i = 0; padded.length < REAL_ROWS; i++) padded.push({ ...cards[i % cards.length]!, name: `${cards[i % cards.length]!.name}_pad${i}`, round: i % REAL_ROUNDS })
    await route.fulfill({ json: padded })
  })
}

function watchRequests(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`)
  })
  return writes
}

async function openHome(page: Page): Promise<void> {
  await page.setViewportSize(SIZE)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
  await expect(panel(page, REG_TITLE).getByRole('grid', { name: /Registry board/ })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function openReg(page: Page): Promise<void> {
  await page.setViewportSize(SIZE)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await page.keyboard.press('Control+k')
  await commandLine(page).fill('REG')
  await commandLine(page).press('Enter')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(2)
  await expect(panel(page, REG_TITLE).getByRole('grid', { name: /Registry board/ })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function scrollableRegionNodes(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withRules(['scrollable-region-focusable']).analyze()
  return result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`))
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

test.describe('REG staleness banner', () => {
  test('a stale registry shows one polite line with an icon, no control, and axe stays clean', async ({ page }) => {
    const writes = watchRequests(page)
    await serveStale(page)
    await openReg(page)
    const line = banner(page, REG_TITLE)
    await expect(line).toContainText(STALE_LINE)
    await expect(line).toContainText('Registry built 2026-10-05 09:15 UTC.')
    await expect(line).toHaveAttribute('aria-live', 'polite')
    await expect(line.locator('svg[aria-hidden="true"]')).toHaveCount(1)
    await expect(line.locator('button, a, input, [tabindex]')).toHaveCount(0)
    expect(await axeViolations(page)).toEqual([])
    expect(writes).toEqual([])
  })

  test('HOME shows the same line in its REG cell and stays axe clean', async ({ page }) => {
    await serveStale(page)
    await openHome(page)
    await expect(banner(page, REG_TITLE)).toContainText(STALE_LINE)
    expect(await axeViolations(page)).toEqual([])
  })

  test('a fresh registry shows no banner and the region takes no room', async ({ page }) => {
    await openReg(page)
    const line = banner(page, REG_TITLE)
    await expect(line).toHaveCount(1)
    await expect(line).toHaveText('')
    await expect(page.getByText(/Registry is older than the newest result/)).toHaveCount(0)
    const box = await line.boundingBox()
    expect(box?.height ?? 0).toBe(0)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
    await expect(panel(page, REG_TITLE).locator('[data-reg-stale]')).toHaveText('')
  })
})

test.describe('REG and HOME at the real registry size: no scroll region without a Tab stop (axe scrollable-region-focusable)', () => {
  test('HOME', async ({ page }) => {
    await serveRealSize(page)
    await openHome(page)
    // The rail is the box that used to scroll inside the panel; it must not any more.
    const rail = panel(page, REG_TITLE).locator('.reg-rail')
    if ((await rail.count()) > 0) {
      const scrolls = await rail.evaluate((el) => getComputedStyle(el).overflowY === 'auto' || getComputedStyle(el).overflowY === 'scroll')
      expect(scrolls).toBe(false)
    }
    expect(await scrollableRegionNodes(page)).toEqual([])
  })

  test('REG', async ({ page }) => {
    await serveRealSize(page)
    await openReg(page)
    const rail = panel(page, REG_TITLE).locator('.reg-rail')
    await expect(rail.getByRole('button')).toHaveCount(REAL_ROUNDS + 1)
    const overflowY = await rail.evaluate((el) => getComputedStyle(el).overflowY)
    expect(['auto', 'scroll']).not.toContain(overflowY)
    expect(await scrollableRegionNodes(page)).toEqual([])
  })
})
