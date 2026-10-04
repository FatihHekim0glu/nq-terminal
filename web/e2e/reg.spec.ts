// REG and MT E2E (TASKS 6.1; UI_SPEC 7 "REG and MT"; look spec 7.2). Runs against the fixture-mode
// backend (playwright.config.ts), whose registry holds overnight_v0 (PASS) and volmanaged_v0 (FAIL):
// - `REG <GO>` opens the registry board beside its multiple-testing view;
// - counts and every value on screen equal the API's, to the displayed precision;
// - overnight_v0 reads [PASS]; sealed confirmations sit in their own block;
// - MT draws the family with the Bonferroni, Holm and BH lines and says they match the API's;
// - Enter on a row opens DES for it;
// - axe WCAG 2.2 AA clean, no console errors, every request a same-origin GET;
// - screenshots at 1920x1080 and 1366x768.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectGalleryAxeClean, watchGallery, type GalleryWatch } from './gallery.ts'
import { expectWatchSegment } from './watchReady.ts'

// 14:02:11 ET (look spec 4.10), the frozen status-line time the shell baselines use.
const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')
const REG_TITLE = 'REG'
const MT_TITLE = 'MT'
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

interface RegistryRow {
  readonly name: string
  readonly n: number | null
  readonly p: number | null
  readonly control_p: number | null
  readonly bonferroni_p: number | null
  readonly holm_p: number | null
  readonly bh_q: number | null
  readonly spec_sha256: string
  readonly verdict: string
  readonly tag: 'edge' | 'overlay' | 'check'
  readonly amendments: number
}

interface Registry {
  readonly counts: { rows: number; registered: number; passed: number; failed: number; checks: number }
  readonly rows: RegistryRow[]
}

interface MtRow {
  readonly name: string
  readonly tag: 'edge' | 'overlay' | 'check'
  readonly rank: number
  readonly p: number
  readonly bonferroni_line: number
  readonly holm_line: number
  readonly bh_line: number
  readonly bonferroni_p: number | null
  readonly holm_p: number | null
  readonly bh_q: number | null
}

interface MultipleTesting {
  readonly alpha: number
  readonly k: number
  readonly rows: MtRow[]
}

/** The screens' formats: four decimals (`<0.0001` below), `--` for missing, en-GB separators. */
const p4 = (v: number | null): string => (v === null ? '--' : v < 1e-4 ? '<0.0001' : v.toFixed(4))
const count = (v: number | null): string => (v === null ? '--' : new Intl.NumberFormat('en-GB').format(v))
const sha = (s: string): string => `${s.slice(0, 4)}..${s.slice(-4)}`

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.ok(), path).toBe(true)
  return (await response.json()) as T
}

async function openReg(page: Page, size: (typeof SIZES)[number] = SIZES[0]): Promise<void> {
  await page.setViewportSize(size)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
  await page.keyboard.press('Control+k')
  await commandLine(page).fill('REG')
  await commandLine(page).press('Enter')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(2)
  await expect(panel(page, REG_TITLE).getByRole('grid', { name: /Registry board/ })).toBeVisible()
  await expect(panel(page, MT_TITLE).getByRole('grid', { name: /Adjusted p-values/ })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

function expectGetOnly(page: Page, watch: GalleryWatch): void {
  const origin = new URL(page.url()).origin
  const bad = watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(origin))
  expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}

async function gridRows(grid: Locator): Promise<string[][]> {
  return grid.locator('tbody tr[role="row"]').evaluateAll((rows) =>
    rows.map((r) => Array.from(r.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  )
}

test.describe('REG and MT', () => {
  test('REG shows the API counts and every row with values equal to the API', async ({ page }) => {
    const watch = await watchGallery(page)
    await openReg(page)
    const registry = await apiJson<Registry>(page, '/api/registry')
    const reg = panel(page, REG_TITLE)
    const criteria = reg.getByRole('region', { name: 'Screening criteria' })
    await expect(criteria.getByRole('button', { name: /Registered hypotheses/ })).toContainText(String(registry.counts.registered))
    await expect(criteria.getByRole('button', { name: /Passed own bar/ })).toContainText(String(registry.counts.passed))
    await expect(criteria.getByRole('button', { name: /Failed own bar/ })).toContainText(String(registry.counts.failed))
    const grid = reg.getByRole('grid', { name: /Registry board/ })
    const rows = await gridRows(grid)
    expect(rows).toHaveLength(registry.counts.rows)
    // A half-width panel drops round, control p, Bonferroni and the spec sha (Phase 8, no sideways
    // scroll) and says so; every column it shows still equals the API.
    const heads = (await grid.locator('thead th').allTextContents()).map((h) => h.trim())
    const at = (h: string) => heads.indexOf(h)
    const TAGS = { edge: 'edge', overlay: '[OVERLAY]', check: 'check' } as const
    for (const src of registry.rows) {
      const row = rows.find((cells) => cells[at('Name')] === src.name)
      expect(row, src.name).toBeDefined()
      const want: Array<readonly [string, string]> = [
        ['n', count(src.n)], ['p', p4(src.p)], ['Holm', p4(src.holm_p)], ['BH q', p4(src.bh_q)], ['Tag', TAGS[src.tag]],
        ['Amend', String(src.amendments)], ['Ctrl p', p4(src.control_p)], ['Bonf', p4(src.bonferroni_p)], ['Spec sha', sha(src.spec_sha256)],
      ]
      for (const [head, value] of want) if (at(head) >= 0) expect(row?.[at(head)], `${src.name} ${head}`).toBe(value)
    }
    if (at('Bonf') < 0) await expect(reg.getByText(/Columns hidden here/)).toBeVisible()
    const overnight = rows.find((cells) => cells[at('Name')] === 'overnight_v0')
    expect(overnight?.[at('Verdict')]).toBe('[PASS]')
    const confirm = reg.getByRole('region', { name: /Sealed confirmations/ })
    await expect(confirm).toContainText('[SPENT]')
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('MT draws the family and its boundary lines equal the API lines', async ({ page }) => {
    const watch = await watchGallery(page)
    await openReg(page)
    const mt = await apiJson<MultipleTesting>(page, '/api/multiple-testing')
    const view = panel(page, MT_TITLE)
    // MT also draws SV3's DSR ladder under the confirmations; the p-value scatter is the one named by its family.
    await expect(view.getByRole('img', { name: /p-values against rank/ })).toHaveAttribute('aria-label', new RegExp(`${mt.k} p-values at alpha ${mt.alpha}`))
    await expect(view.getByRole('region', { name: 'Multiple-testing family' })).toContainText('Boundary lines match the API at every rank.')
    const rows = await gridRows(view.getByRole('grid', { name: /Adjusted p-values/ }))
    expect(rows).toHaveLength(mt.k)
    mt.rows.forEach((src, i) => {
      expect(rows[i]?.slice(1, 11)).toEqual([
        String(src.rank), src.name, src.tag === 'overlay' ? '[OVERLAY]' : src.tag, p4(src.p), p4(src.bonferroni_line), p4(src.holm_line),
        p4(src.bh_line), p4(src.bonferroni_p), p4(src.holm_p), p4(src.bh_q),
      ])
      // The lines themselves: Bonferroni alpha/k, Holm alpha/(k-i+1), BH i alpha/k.
      expect(src.bonferroni_line).toBeCloseTo(mt.alpha / mt.k, 12)
      expect(src.holm_line).toBeCloseTo(mt.alpha / (mt.k - src.rank + 1), 12)
      expect(src.bh_line).toBeCloseTo((src.rank * mt.alpha) / mt.k, 12)
    })
    await view.locator('.mt-chart').getByRole('button', { name: 'Table', exact: true }).click()
    await expect(view.getByRole('table', { name: /p-values against rank/ })).toBeVisible()
    await expectGalleryAxeClean(page)
    expect(watch.errors).toEqual([])
    expectGetOnly(page, watch)
  })

  test('Enter on a registry row opens DES for it in the same panel', async ({ page }) => {
    await openReg(page)
    const grid = panel(page, REG_TITLE).getByRole('grid', { name: /Registry board/ })
    const first = (await gridRows(grid))[0]?.[1]
    expect(first).toBeTruthy()
    await grid.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator(`[data-nqt-title="${first} DES"]`)).toBeVisible()
  })

  for (const size of SIZES) {
    test(`screenshot ${size.width}x${size.height}`, async ({ page }) => {
      await page.clock.setFixedTime(FROZEN_NOW)
      await openReg(page, size)
      await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
      await expectWatchSegment(page)
      await expect(page).toHaveScreenshot(`reg-${size.width}x${size.height}.png`)
    })
  }
})
