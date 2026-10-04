// The Phase 11 screens in the real app on the fixture backend: VCONE (MV9), SEAS (MV7), EVT (MV8), ROLL (MV10)
// and DQ (RI4, RI5). For each: the panel shows what the API serves, carries the [POST HOC] label and prints no
// p-value or test statistic as a figure (a note saying there is none is allowed); Number <GO> from the command
// line drives it; axe is clean at 1920x1080 and 1366x768 (WCAG 2.2 AA tags); no console error; GET only.
// Baselines at both sizes, with the gate line and the status bar's read count masked in black (they depend on
// what ran before in this backend process). ROLL's paper-book tab follows today's New York date, so it has no
// baseline. SEAS's first full-window read builds 12 years of synthetic 1m bars in the fixture backend, so its
// waits are longer.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { AXE_TAGS, MASK_COLOR } from './gallery.ts'
import { expectWatchSegment } from './watchReady.ts'

const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }] as const
const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')
const SLOW = 60_000
/** A p-value or a test statistic printed as a figure; the words "no p-value" in a note do not match. */
const P_FIGURE = /\bp(?:[- ]?value)?\s*[=<>:]\s*-?\d|\bt(?:[- ]stat(?:istic)?)?\s*=\s*-?\d|\bz[- ]score\s*[=:]?\s*-?\d/i
const TEST_HEADER = /^(?:p|p[- ]?value|t|t[- ]stat(?:istic)?|z|z[- ]score)$/i

interface Watch {
  readonly errors: string[]
  readonly requests: Request[]
}

async function startApp(page: Page): Promise<Watch> {
  const watch: Watch = { errors: [], requests: [] }
  page.on('console', (m) => { if (m.type() === 'error') watch.errors.push(m.text()) })
  page.on('pageerror', (e) => watch.errors.push(String(e)))
  page.on('request', (r) => watch.requests.push(r))
  const index = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/commands' && r.ok())
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
  await index
  return watch
}

async function openLine(page: Page, line: string, timeout = 10_000): Promise<Locator> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Command line' })
  await box.fill(line)
  // The preview names what <GO> will do, so it shows only once the command index has reached the page: the index response
  // arriving is not that (an Enter pressed in between is refused as an unknown line and leaves the text in the box).
  await expect(page.locator('.cmd-preview')).toContainText('<GO>')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const panel = page.locator(`[data-nqt-title="${line}"]`)
  await expect(panel).toHaveCount(1)
  await expect(panel.locator('p.ws-empty')).toHaveCount(0, { timeout })
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0, { timeout })
  return panel
}

/** Number <GO> typed on the command line: runs numbered item `n` of the focused panel. */
async function numberGo(page: Page, n: number): Promise<void> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Command line' })
  await box.fill(String(n))
  await box.press('Enter')
  await expect(box).toHaveValue('')
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path, { timeout: SLOW })
  expect(response.status(), path).toBe(200)
  return (await response.json()) as T
}

/** The [POST HOC] label is on the panel and no p-value or test statistic appears as a figure or a column. */
async function expectDescriptive(panel: Locator): Promise<void> {
  await expect(panel).toContainText('[POST HOC]')
  expect(await panel.innerText()).not.toMatch(P_FIGURE)
  const headers = await panel.locator('th').allInnerTexts()
  expect(headers.filter((h) => TEST_HEADER.test(h.trim()))).toEqual([])
}

async function axeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

/** axe at both sizes, then no console error and no request other than GET. */
async function expectClean(page: Page, watch: Watch): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size)
    await axeClean(page)
  }
  expect(watch.errors).toEqual([])
  expect(watch.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

interface VolCone { readonly label: string; readonly horizons: ReadonlyArray<{ readonly sessions: number }> }
interface EventStudy { readonly label: string; readonly events: ReadonlyArray<{ readonly n: number; readonly date: string; readonly used: boolean }> }
interface RollCalendar { readonly markets: ReadonlyArray<{ readonly root: string; readonly count: number }> }
interface DqCalendar { readonly label: string }
interface GuardReport { readonly ok: number; readonly mismatch: number; readonly no_record: number; readonly groups: ReadonlyArray<unknown> }

test.describe('Phase 11 screens: served values, [POST HOC], no p-value, Number <GO>, axe, GET only', () => {
  test('NQ VCONE: one row per served horizon; Number <GO> 3 opens the 27 futures at 21 sessions', async ({ page }) => {
    const watch = await startApp(page)
    const api = await apiJson<VolCone>(page, '/api/market/vcone?symbol=NQ.V.0')
    const panel = await openLine(page, 'NQ VCONE')
    await expect(panel.getByRole('img', { name: /volatility cone/ })).toBeVisible()
    const grid = panel.getByRole('table', { name: /Cone by horizon/ })
    await expect(grid.locator('tbody tr')).toHaveCount(api.horizons.length)
    await expect(panel).toContainText(api.label)
    await expectDescriptive(panel)
    await numberGo(page, 3)
    await expect(panel.getByRole('img', { name: /27 futures, realised volatility at 21 sessions/ })).toBeVisible()
    await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0)
    await expectDescriptive(panel)
    await expectClean(page, watch)
  })

  test('NQ SEAS and volmanaged_v0 SEAS: tabs and rows by Number <GO>, the one standard error band', async ({ page }) => {
    test.setTimeout(3 * SLOW)
    const watch = await startApp(page)
    const panel = await openLine(page, 'NQ SEAS', SLOW)
    await expect(panel.getByRole('img', { name: /NQ\.V\.0 mean monthly return by calendar month/ })).toBeVisible({ timeout: SLOW })
    await expectDescriptive(panel)
    await numberGo(page, 82)
    await expect(panel.getByRole('img', { name: /by weekday/ })).toBeVisible()
    await numberGo(page, 2)
    await expect(panel.getByText(/^Row Tue: mean/)).toBeVisible()
    await numberGo(page, 84)
    await expect(panel.getByRole('img', { name: /30-minute return by bucket/ })).toBeVisible({ timeout: SLOW })
    await expect(panel.getByText(/sessions left out of the 30-minute buckets/)).toBeVisible()
    await expectDescriptive(panel)
    const hypothesis = await openLine(page, 'volmanaged_v0 SEAS', SLOW)
    await expect(hypothesis.getByRole('img', { name: /volmanaged_v0 mean monthly return/ })).toBeVisible()
    await expectDescriptive(hypothesis)
    await expectClean(page, watch)
  })

  test('NQ EVT: the served study; Number <GO> on a used row draws that event; the intraday study', async ({ page }) => {
    test.setTimeout(2 * SLOW)
    const watch = await startApp(page)
    const api = await apiJson<EventStudy>(page, '/api/events/study?symbol=NQ.V.0&event=FOMC&mode=daily&pre=5&post=5')
    const panel = await openLine(page, 'NQ EVT', SLOW)
    await expect(panel.getByRole('img', { name: /NQ around FOMC/ })).toBeVisible()
    await expect(panel).toContainText(api.label)
    await expect(panel.getByRole('grid', { name: `Events, ${api.events.length} rows` })).toBeVisible()
    await expectDescriptive(panel)
    const used = api.events.find((e) => e.used)
    expect(used, 'a used event in the fixture study').toBeTruthy()
    await numberGo(page, used?.n ?? 1)
    await expect(panel.locator('.evt-note')).toContainText(`Event ${used?.date ?? ''}`)
    await panel.getByRole('button', { name: 'Intraday' }).click()
    await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: SLOW })
    await expect(panel.getByRole('grid', { name: /^Events, \d+ rows/ })).toBeVisible({ timeout: SLOW })
    await expectDescriptive(panel)
    await expectClean(page, watch)
  })

  test('NQ ROLL: the strip for 2021; Number <GO> opens a market; the paper book tab reads dates only', async ({ page }) => {
    const watch = await startApp(page)
    const api = await apiJson<RollCalendar>(page, '/api/market/rolls')
    const panel = await openLine(page, 'NQ ROLL', SLOW)
    const strip = panel.getByTestId('roll-strip')
    await expect(strip.locator('tbody tr')).toHaveCount(api.markets.length)
    expect(await strip.innerText()).not.toContain('2022')
    await expectDescriptive(panel)
    const nq = api.markets.findIndex((m) => m.root === 'NQ')
    await numberGo(page, 11 + nq)
    await expect(panel.getByRole('img', { name: /^NQ roll gap in percent/ })).toBeVisible()
    const rolls = panel.getByRole('table', { name: /NQ rolls, oldest first/ })
    await expect(rolls.locator('tbody tr')).toHaveCount(api.markets[nq]?.count ?? -1)
    await expectDescriptive(panel)
    await numberGo(page, 3)
    await expect(panel.getByRole('table', { name: /MNQ contracts around the one the book holds/ })).toBeVisible()
    await expectClean(page, watch)
  })

  test('NQ DQ: the calendar named by its summary; Number <GO> picks a flagged day; 86 shows the guards', async ({ page }) => {
    const watch = await startApp(page)
    const calendar = await apiJson<DqCalendar>(page, '/api/dq/calendar/NQ.V.0')
    const guards = await apiJson<GuardReport>(page, '/api/dq/guards')
    const panel = await openLine(page, 'NQ DQ')
    await expect(panel.getByRole('img', { name: /NQ\.V\.0 data quality calendar/ })).toBeVisible()
    await expect(panel).toContainText(calendar.label)
    await expectDescriptive(panel)
    await numberGo(page, 1)
    await expect(panel.getByText(/^Selected \d{4}-\d{2}-\d{2}: /)).toBeVisible()
    await numberGo(page, 86)
    const grid = panel.getByRole('grid', { name: 'Guard groups' })
    await expect(grid).toBeVisible()
    await expect(panel).toContainText(`${guards.ok} OK, ${guards.mismatch} mismatch, ${guards.no_record} with no record.`)
    expect(guards.ok).toBe(guards.groups.length)
    expect(await panel.innerText()).not.toMatch(P_FIGURE)
    await expectClean(page, watch)
  })
})

/** Relative luminance contrast of two computed `rgb(...)` colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string): number => {
    const [r, g, bl] = (c.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

test.describe('Phase 11 keyboard focus and contrast in the browser (WCAG 2.4.3 and 1.4.3)', () => {
  test('a VCONE row button keeps focus in the panel on the small multiples toggle', async ({ page }) => {
    await startApp(page)
    const panel = await openLine(page, 'NQ VCONE')
    const row = panel.getByRole('table', { name: /Cone by horizon/ }).getByRole('button', { name: /^1\) / })
    await row.focus()
    await page.keyboard.press('Enter')
    const toggle = panel.getByRole('button', { name: '27F at one horizon' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toBeFocused()
    await expect(panel.getByRole('img', { name: /27 futures, realised volatility at/ })).toBeVisible()
    await expect(toggle).toBeFocused()
  })

  test('a ROLL ticker keeps focus in the panel on the selected Market tab', async ({ page }) => {
    await startApp(page)
    const panel = await openLine(page, 'NQ ROLL', SLOW)
    const pick = panel.getByTestId('roll-strip').locator('button.roll-pick').first()
    await pick.focus()
    await page.keyboard.press('Enter')
    // The tab strip renders into the panel's tab slot, outside the screen's own root.
    const tab = panel.locator('[role="tab"][aria-selected="true"]')
    await expect(tab).toContainText('Market')
    await expect(tab).toBeFocused()
  })

  test('down text on a ROLL cell passes 4.5:1 on the cell background', async ({ page }) => {
    await startApp(page)
    const panel = await openLine(page, 'NQ ROLL', SLOW)
    await page.mouse.move(0, 0)
    const cells = panel.locator('.roll-strip td.roll-on.down')
    expect(await cells.count(), 'a roll with a negative gap in the fixture strip').toBeGreaterThan(0)
    const colours = await cells.evaluateAll((els) => els.map((el) => {
      const s = getComputedStyle(el)
      return { fg: s.color, bg: s.backgroundColor }
    }))
    for (const c of colours) expect(contrast(c.fg, c.bg), `${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5)
  })
})

async function settle(page: Page): Promise<void> {
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: SLOW })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

interface Shot {
  readonly name: string
  readonly line: string
  /** Number <GO> steps after the screen opens; a function reads the API first. */
  readonly steps?: (page: Page) => Promise<number[]>
}

const rollMarketNumber = async (page: Page): Promise<number[]> => {
  const api = await apiJson<RollCalendar>(page, '/api/market/rolls')
  return [11 + api.markets.findIndex((m) => m.root === 'NQ')]
}

const SHOTS: readonly Shot[] = [
  { name: 'vcone', line: 'NQ VCONE' },
  { name: 'vcone-27f', line: 'NQ VCONE', steps: async () => [3] },
  { name: 'seas', line: 'NQ SEAS' },
  { name: 'seas-hypothesis', line: 'volmanaged_v0 SEAS' },
  { name: 'evt', line: 'NQ EVT' },
  { name: 'roll', line: 'NQ ROLL' },
  { name: 'roll-market', line: 'NQ ROLL', steps: rollMarketNumber },
  { name: 'dq', line: 'NQ DQ' },
  { name: 'dq-guards', line: 'NQ DQ', steps: async () => [86] },
]

test.describe('Phase 11 screenshots', () => {
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${size.width}x${size.height}`, async ({ page }) => {
        test.setTimeout(2 * SLOW)
        await page.clock.setFixedTime(FROZEN_NOW)
        await page.setViewportSize(size)
        await startApp(page)
        await openLine(page, shot.line, SLOW)
        for (const n of shot.steps ? await shot.steps(page) : []) await numberGo(page, n)
        await settle(page)
        await page.mouse.move(0, 0)
        await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
        await expectWatchSegment(page)
        const gate = page.getByRole('contentinfo').locator('.seg', { hasText: /^Gate reads/ })
        await expect(page).toHaveScreenshot(`p11-${shot.name}-${size.width}x${size.height}.png`, {
          mask: [gate, page.locator('.mkt-gate')],
          maskColor: MASK_COLOR,
        })
      })
    }
  }
})
