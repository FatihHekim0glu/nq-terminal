// PLAN (research_ux.md item 2) in the real app on the fixture backend: the pre-registration planner opens from the
// command line, is operated by the keyboard alone (Tab to the typed family size, type, the tables follow), reads no
// price and no result file (the only data request is GET /api/analytics/plan), prints no p-value, and axe is clean at
// 1920x1080 and 1366x768 (WCAG 2.2 AA tags). No console error; GET only.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { AXE_TAGS } from './gallery.ts'

const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }] as const
const MAX_KEYS = 40
const P_FIGURE = /\bp(?:[- ]?value)?\s*[=<>:]\s*-?\d/i
/** The routes PLAN may ask: the command index and the job indicator the shell loads, and the planner itself. */
const ALLOWED_PATHS = new Set(['/api/commands', '/api/analytics/plan', '/api/jobs'])
/** A route that reads a price or a result file: PLAN must never ask any of them. */
const DATA_PATHS = /^\/api\/(bars|market|hypotheses|runs|analytics\/(?!plan$)|seasonality|events|dq|audit|live|sealed|ledger)/

interface Watch {
  readonly errors: string[]
  readonly requests: Request[]
}

interface Plan {
  readonly n: number
  readonly family_k_registry: number | null
  readonly slots: ReadonlyArray<{ readonly source: string; readonly k: number; readonly slot: number }>
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

async function openPlan(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Command line' })
  await box.fill('PLAN')
  await expect(page.locator('.cmd-preview')).toContainText('<GO>')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const panel = page.locator('[data-nqt-title="PLAN"]')
  await expect(panel).toHaveCount(1)
  await expect(panel.getByRole('table', { name: /One sided Bonferroni and Holm bars/ })).toBeVisible({ timeout: 30_000 })
  return panel
}

/**
 * Reaches `target` the way the workspace lets a keyboard in: the panel is one Tab stop and its controls are roving items, so
 * one Tab from the command line puts the focus on the panel body and ArrowRight walks the items (WorkspaceFocus.ts). Fails if the control is not reached,
 * which would be a control a keyboard cannot reach.
 */
async function arrowTo(page: Page, panel: Locator, target: Locator): Promise<void> {
  await page.keyboard.press('Tab') // from the command line the one Tab stop of the panel takes the focus
  await expect(panel.getByRole('group', { name: 'PLAN content' })).toBeFocused()
  for (let presses = 0; presses < MAX_KEYS; presses += 1) {
    await page.keyboard.press('ArrowRight')
    if (await target.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error(`the control was not reached within ${MAX_KEYS} ArrowRight presses`)
}

async function axeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

test.describe('PLAN: the pre-registration planner', () => {
  test('opens from the command line, answers from the registry family, and asks no data route', async ({ page }) => {
    const watch = await startApp(page)
    const panel = await openPlan(page)
    await expect(panel).toContainText('Descriptive only: no verdict')
    expect(await panel.innerText()).not.toMatch(P_FIGURE)
    const bars = panel.getByRole('table', { name: /One sided Bonferroni and Holm bars/ })
    await expect(bars.getByRole('columnheader', { name: 'Bonferroni bar' })).toBeVisible()
    await expect(bars.getByRole('rowheader').first()).toBeVisible()
    const design = panel.getByRole('table', { name: /Minimum detectable annual Sharpe/ })
    await expect(design.locator('tbody tr').first()).toBeVisible()
    const paths = new Set(watch.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.startsWith('/api/')))
    expect([...paths].filter((p) => DATA_PATHS.test(p))).toEqual([])
    expect([...paths].filter((p) => !ALLOWED_PATHS.has(p) && !p.startsWith('/api/health'))).toEqual([])
    expect(watch.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${r.url()}`)).toEqual([])
    expect(watch.errors).toEqual([])
  })

  test('by keyboard alone: arrow to the typed family size, type it, and the next slot follows', async ({ page }) => {
    const watch = await startApp(page)
    const panel = await openPlan(page)
    await arrowTo(page, panel, panel.getByRole('textbox', { name: 'Typed family size k' }))
    const served = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/analytics/plan' && r.url().includes('k=80'))
    await page.keyboard.type('80')
    const plan = (await (await served).json()) as Plan
    expect(plan.slots.map((s) => [s.source, s.k, s.slot])).toContainEqual(['typed', 80, 81])
    await expect(panel.getByRole('rowheader', { name: 'Typed 80', exact: true })).toBeVisible()
    await expect(panel.getByRole('table', { name: /One sided Bonferroni and Holm bars/ })).toContainText('81')
    expect(watch.errors).toEqual([])
  })

  test('a typed size outside its bound is not asked: the screen says so and shows no stale answer as new', async ({ page }) => {
    const watch = await startApp(page)
    const panel = await openPlan(page)
    await arrowTo(page, panel, panel.getByRole('textbox', { name: 'Typed family size k' }))
    await page.keyboard.type('1001')
    await expect(panel.getByText(/^Not asked yet:/)).toBeVisible()
    await expect(panel.getByText(/must be from 0 to 1000/)).toBeVisible()
    expect(watch.requests.filter((r) => new URL(r.url()).searchParams.get('k') === '1001')).toEqual([])
  })

  test('axe is clean at both sizes', async ({ page }) => {
    await startApp(page)
    await openPlan(page)
    for (const size of SIZES) {
      await page.setViewportSize(size)
      await axeClean(page)
    }
  })
})
