// Shared steps for the Phase 8 visual and accessibility pass (TASKS 8.2). Every P0 screen is opened in
// the workspace against the fixture-mode backend (playwright.config.ts) at 1920x1080 and 1366x768, and:
// - every chart is audited: each drawn canvas sits inside a ChartA11y figure (role="img") whose name is
//   a data summary, and each figure has a Table toggle that swaps it for a real table with a caption,
//   column headers and rows (UI_SPEC section 9, "Every canvas chart");
// - axe runs with the WCAG 2.2 AA tags at rest, with the command dropdown open, and with every chart in
//   its table view while the dropdown is open;
// - a screenshot baseline is taken with the command dropdown open.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'
import { AXE_TAGS } from '../gallery.ts'

export interface Viewport {
  readonly width: number
  readonly height: number
}

export const VIEWPORTS: readonly Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]

// 14:02:11 ET (look spec 4.10), the frozen status-line time the other baselines use.
export const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')

/** What the command dropdown is opened with: the suggestion list the shell spec also checks. */
export const DROPDOWN_QUERY = 'RE'

export interface ScreenCase {
  /** Baseline name and test title. */
  readonly name: string
  /** The command line that opens the screen; null for HOME, which the app opens on load. */
  readonly line: string | null
  /** The mnemonic the status line names once the screen is open. */
  readonly code: string
  /** The charts the screen draws with the fixture data (the audit checks the count, so it is never empty). */
  readonly charts: number
}

const HYP = 'volmanaged_v0'
const RUN = 'nt_volmanaged_v0_fixture_m1'

/** Every P0 screen (src/chrome/WorkspaceScreens.tsx BUILT_SCREENS), with both DES and tear variants. */
export const SCREENS: readonly ScreenCase[] = [
  { name: 'HOME', line: null, code: 'HOME', charts: 2 },
  { name: 'GP', line: 'NQ GP', code: 'GP', charts: 1 },
  { name: 'GIP', line: 'NQ GIP 2019-03-14', code: 'GIP', charts: 1 },
  { name: 'MON', line: '27F MON', code: 'MON', charts: 0 },
  { name: 'CORR', line: '27F CORR', code: 'CORR', charts: 2 },
  { name: 'OOS', line: 'OOS', code: 'OOS', charts: 0 },
  { name: 'LIVE', line: 'LIVE', code: 'LIVE', charts: 1 },
  { name: 'JRNL', line: 'JRNL', code: 'JRNL', charts: 0 },
  { name: 'DES-hypothesis', line: `${HYP} DES`, code: 'DES', charts: 1 },
  { name: 'DES-instrument', line: 'NQ DES', code: 'DES', charts: 1 },
  { name: 'REG', line: 'REG', code: 'REG', charts: 1 },
  { name: 'MT', line: 'MT', code: 'MT', charts: 1 },
  { name: 'RUNS', line: 'RUNS', code: 'RUNS', charts: 0 },
  { name: 'RUN', line: `${RUN} RUN`, code: 'RUN', charts: 1 },
  { name: 'LEDG', line: 'LEDG', code: 'LEDG', charts: 0 },
  { name: 'EQ-run', line: 'smoke_2015_01 EQ', code: 'EQ', charts: 3 },
  { name: 'EQ', line: `${HYP} EQ`, code: 'EQ', charts: 1 },
  { name: 'DD', line: `${HYP} DD`, code: 'DD', charts: 1 },
  { name: 'RET', line: `${HYP} RET`, code: 'RET', charts: 1 },
  { name: 'RR', line: `${HYP} RR`, code: 'RR', charts: 0 },
  { name: 'RR-run', line: 'nt_dtsmom_v0_fixture_ts1 RR', code: 'RR', charts: 3 },
  { name: 'MRET', line: `${HYP} MRET`, code: 'MRET', charts: 2 },
  { name: 'HELP', line: 'HELP', code: 'HELP', charts: 0 },
]

export const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const message = (page: Page): Locator => page.locator('.msg-line[role="status"]')

/** The lazy screen chunks, their API reads and the chart libraries have all finished; fonts loaded. */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByText('Loading this screen.')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('p.ws-empty')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** Loads the app at the given size with a frozen clock and opens the screen from the command line. */
export async function openScreen(page: Page, screen: ScreenCase, viewport: Viewport): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  if (screen.line !== null) {
    await page.keyboard.press('Control+k')
    await expect(commandLine(page)).toBeFocused()
    await commandLine(page).fill(screen.line)
    await commandLine(page).press('Enter')
    await expect(commandLine(page)).toHaveValue('')
    await expect(message(page), screen.line).not.toHaveAttribute('data-tone', 'error')
  }
  await expect(page.getByRole('contentinfo')).toContainText(`Screen ${screen.code}`)
  await settle(page)
  // A screen can settle before its chart chunk mounts; wait for the charts it is known to draw.
  await expect.poll(() => page.locator('.chart-a11y').count(), { message: `${screen.name}: charts`, timeout: 20_000 })
    .toBeGreaterThanOrEqual(screen.charts)
  await settle(page)
  await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
}

/** Focuses the command line and types the query, so the suggestion dropdown is open. */
export async function openDropdown(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(DROPDOWN_QUERY)
  await expect(commandLine(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
}

/** Empties the command line and leaves it, so the dropdown closes. */
export async function closeDropdown(page: Page): Promise<void> {
  await commandLine(page).fill('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/** axe with the WCAG 2.2 AA tags; each violation reads `rule (impact): targets`. */
export async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

export interface ChartAudit {
  /** Drawn canvases that no ChartA11y figure names, by panel title. */
  readonly bareCanvases: readonly string[]
  /** The accessible name of every chart figure on screen. */
  readonly summaries: readonly string[]
  /** Figures without a `Table` toggle in their own bar. */
  readonly withoutToggle: number
  /** Graphics outside a chart (in-cell sparklines) that are not hidden from assistive technology with text beside them. */
  readonly bareGraphics: readonly string[]
}

/** Reads every chart and graphic on the page (see ChartAudit). */
export async function auditCharts(page: Page, toggleLabel: string): Promise<ChartAudit> {
  return page.evaluate((label) => {
    const panelOf = (el: Element): string => el.closest('[data-nqt-title]')?.getAttribute('data-nqt-title') ?? '(no panel)'
    const drawn = (el: Element): boolean => el.getClientRects().length > 0
    const bareCanvases = Array.from(document.querySelectorAll('canvas'))
      .filter((c) => drawn(c) && !c.closest('.chart-a11y-figure[role="img"]'))
      .map(panelOf)
    const figures = Array.from(document.querySelectorAll('.chart-a11y-figure'))
    const summaries = figures.map((f) => f.getAttribute('aria-label') ?? '')
    const withoutToggle = figures.filter((f) => {
      const toggle = f.closest('.chart-a11y')?.querySelector(':scope > .chart-a11y-bar > button.chart-a11y-toggle')
      return toggle?.textContent !== label || !toggle.hasAttribute('aria-pressed')
    }).length
    const bareGraphics = Array.from(document.querySelectorAll('svg'))
      .filter((s) => drawn(s) && !s.closest('.chart-a11y-figure'))
      .filter((s) => s.getAttribute('aria-hidden') !== 'true' || (s.parentElement?.textContent ?? '').trim() === '')
      .map(panelOf)
    return { bareCanvases, summaries, withoutToggle, bareGraphics }
  }, toggleLabel)
}

export interface TableCheck {
  readonly caption: string
  readonly name: string
  readonly headers: number
  readonly rows: number
  /** The table is cut off by its box (the box scrolls or clips instead of growing). */
  readonly clipped: boolean
}

/** Turns every chart on screen into its table view and reads each table back. */
export async function showEveryTable(page: Page): Promise<TableCheck[]> {
  const toggles = page.locator('.chart-a11y:visible > .chart-a11y-bar > button.chart-a11y-toggle')
  const count = await toggles.count()
  for (let i = 0; i < count; i += 1) {
    const toggle = toggles.nth(i)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.locator('.chart-a11y-figure')).toHaveCount(0)
  return page.locator('.chart-a11y-tablewrap[role="region"]').evaluateAll((regions) => regions.map((r) => ({
    caption: (r.querySelector('table > caption')?.textContent ?? '').trim(),
    name: r.getAttribute('aria-label') ?? '',
    headers: r.querySelectorAll('thead th[scope="col"]').length,
    rows: r.querySelectorAll('tbody tr').length,
    clipped: r.getBoundingClientRect().height + 1 < (r.querySelector('table')?.getBoundingClientRect().height ?? 0),
  })))
}
