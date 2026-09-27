// The Perspective pivot grid (TASKS 9.1) in a real browser under the production CSP: the engine and its
// WebAssembly binaries load lazily from this origin with no CSP report; 8,411 fills go from rows in hand
// to a painted grid under 500 ms; the grid is keyboard reachable (Tab lands on it, Page Down scrolls it);
// axe finds nothing around it (the viewer's own shadow DOM is the library's and is left out); no console
// error; every request a same-origin GET. Timings are attached to the report.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { AXE_TAGS, openGallery, watchGallery } from './gallery.ts'

const FILLS = 8411
const BUDGET_MS = 500

async function gridHost(page: Page): Promise<Locator> {
  const main = await openGallery(page, 'PerspectiveGrid')
  const host = main.getByRole('group', { name: `Fills of gallery_run, ${FILLS.toLocaleString('en-GB')} rows, pivot grid` })
  await expect(host).toHaveAttribute('data-psp-state', 'ready', { timeout: 20_000 })
  return host
}

async function scrollTop(host: Locator): Promise<number> {
  return host.evaluate((el) => {
    const find = (root: Element | ShadowRoot): HTMLElement | null => {
      const direct = root.querySelector<HTMLElement>('regular-table')
      if (direct) return direct
      for (const child of Array.from(root.querySelectorAll('*'))) {
        const inner = child.shadowRoot ? find(child.shadowRoot) : null
        if (inner) return inner
      }
      return null
    }
    return find(el)?.scrollTop ?? -1
  })
}

test.describe('Perspective pivot grid (TASKS 9.1)', () => {
  test('8,411 fills load under 500 ms under the production CSP, with no console error', async ({ page }, info) => {
    const watch = await watchGallery(page)
    const host = await gridHost(page)
    const loadMs = Number(await host.getAttribute('data-psp-load-ms'))
    const engineMs = Number(await host.getAttribute('data-psp-engine-ms'))
    info.annotations.push({ type: 'perspective-timing', description: JSON.stringify({ rows: FILLS, loadMs, coldEngineMs: engineMs }) })
    expect(loadMs).toBeGreaterThan(0)
    expect(loadMs).toBeLessThan(BUDGET_MS)
    // The grid really painted body rows, and its header names the first column.
    await expect(host.locator('regular-table tbody tr').first()).toBeVisible()
    await expect(host.locator('regular-table thead')).toContainText('Time (UTC)')
    await expect(page.getByRole('status')).toHaveText(`${FILLS.toLocaleString('en-GB')} rows in the pivot grid.`)
    // The binaries and the worker came from this origin.
    const assets = watch.requests.map((r) => new URL(r.url()).pathname).filter((p) => /\.wasm$|worker/.test(p))
    expect(assets.some((p) => p.endsWith('.wasm'))).toBe(true)
    expect(assets.some((p) => p.includes('perspective-server.worker'))).toBe(true)
    const csp = await page.evaluate(() => (window as unknown as { __nqtCsp?: string[] }).__nqtCsp ?? [])
    expect(csp).toEqual([])
    expect(watch.errors).toEqual([])
  })

  test('the grid is keyboard reachable and scrolls with Page Down, Home and the arrows', async ({ page }) => {
    const host = await gridHost(page)
    for (let i = 0; i < 12; i += 1) {
      if (await host.evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(host).toBeFocused()
    const outline = await host.evaluate((el) => getComputedStyle(el, '::after').outlineStyle)
    expect(outline).toBe('solid')
    expect(await scrollTop(host)).toBe(0)
    await page.keyboard.press('PageDown')
    await expect.poll(() => scrollTop(host)).toBeGreaterThan(100)
    await page.keyboard.press('Home')
    await expect.poll(() => scrollTop(host)).toBe(0)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => scrollTop(host)).toBeGreaterThan(0)
    await expect(host).toBeFocused()
  })

  test('Tab from the grid never traps focus: inside the viewer, Escape brings it back to the grid', async ({ page }) => {
    const host = await gridHost(page)
    await host.focus()
    await expect(host).toBeFocused()
    await page.keyboard.press('Tab')
    const inside = await host.evaluate((el) => el.contains(document.activeElement) && document.activeElement !== el)
    if (inside) {
      await page.keyboard.press('Escape')
      await expect(host).toBeFocused()
    }
    // Shift+Tab from the grid leaves it for the panel's previous stop, never into the viewer.
    await host.focus()
    await page.keyboard.press('Shift+Tab')
    expect(await host.evaluate((el) => el.contains(document.activeElement))).toBe(false)
  })

  test('Escape inside the viewer returns focus to the grid host', async ({ page }) => {
    const host = await gridHost(page)
    const viewer = host.locator('perspective-viewer')
    await viewer.evaluate((el) => { (el as HTMLElement).tabIndex = -1; (el as HTMLElement).focus() })
    await page.keyboard.press('Escape')
    await expect(host).toBeFocused()
  })

  test('axe is clean around the viewer, and the page stays clean', async ({ page }) => {
    const watch = await watchGallery(page)
    await gridHost(page)
    const around = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('perspective-viewer').analyze()
    expect(around.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(watch.errors).toEqual([])
    await expect(page.locator('perspective-viewer')).toHaveCount(1)
    // The full gallery check minus the library's own shadow DOM: GET only, same origin, no CSP report.
    const bad = watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(new URL(page.url()).origin))
    expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
  })
})

// The four screens (TASKS 9.1): RUN 2) Trades and 3) Fills, LEDG and OOS open their rows in the pivot.
const FIXTURE_RUN = 'nt_dtsmom_v0_fixture_ts1'
const ROOTS = ['ES', 'NQ', 'YM', 'ZT', 'ZF', 'ZN', 'ZB', '6E', '6J', '6B', '6A', '6C', '6S', 'CL', 'NG', 'HO', 'RB', 'GC', 'SI', 'HG', 'ZC', 'ZS', 'ZW', 'ZL', 'ZM', 'LE', 'HE']

/** 8,411 fills in the API's shape, answered in the page (the fixture run has 11), as e2e/perf does. */
async function serveSyntheticFills(page: Page, run: string, total: number): Promise<void> {
  const first = Date.UTC(2012, 0, 4) / 1000
  const all = Array.from({ length: total }, (_, i) => {
    const root = ROOTS[i % ROOTS.length] ?? 'NQ'
    const day = first + Math.floor(i / ROOTS.length) * 86_400 * 7
    const qty = 1 + ((i * 37) % 180)
    return {
      ts: `${new Date(day * 1000).toISOString().slice(0, 19)}.000000000Z`, ts_epoch_s: day, instrument: `${root}.XCME`,
      side: i % 3 === 0 ? 'SELL' : 'BUY', qty, px: Math.round((100 + ((i * 7919) % 400_000) / 100) * 100) / 100,
      commission: (qty * 7.5).toFixed(4), commission_float: qty * 7.5, position_id: `P-${root}`, order_id: `O-${i}`, tags: 'REBAL',
    }
  })
  await page.route(`**/api/runs/${run}/fills?*`, async (route) => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const limit = Number(url.searchParams.get('limit') ?? '500')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: all.slice(offset, offset + limit), offset, limit, total }) })
  })
}

async function openLine(page: Page, line: string): Promise<Locator> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Command line' })
  await box.fill(line)
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const panel = page.locator(`[data-nqt-title="${line}"]`)
  await expect(panel).toHaveCount(1)
  return panel
}

async function startApp(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(4)
  return errors
}

/** View Pivot, then Show as Pivot grid: the run uses reduced motion, so a pivot view opens as its table until
 * Pivot grid is chosen once in the page. It is clicked only when not already chosen: a click makes the button
 * the panel's roving Tab stop, and the checks below expect Tab to land on the grid. */
async function openPivot(panel: Locator): Promise<Locator> {
  await panel.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
  const toGrid = panel.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Pivot grid' })
  if ((await toGrid.getAttribute('aria-pressed')) !== 'true') await toGrid.click()
  const host = panel.locator('.nqt-psp-host')
  await expect(host).toHaveAttribute('data-psp-state', 'ready', { timeout: 20_000 })
  return host
}

async function axeAround(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('perspective-viewer').analyze()
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

test.describe('pivot views on the screens (TASKS 9.1)', () => {
  test('RUN 3) Fills opens 8,411 fills in the pivot, from the click to the painted grid under 500 ms', async ({ page }, info) => {
    await serveSyntheticFills(page, FIXTURE_RUN, FILLS)
    const errors = await startApp(page)
    const run = await openLine(page, `${FIXTURE_RUN} RUN`)
    await run.getByRole('tab', { name: /Fills/ }).click()
    await expect(run.getByRole('grid', { name: `Fills of ${FIXTURE_RUN}, ${FILLS} rows` })).toBeVisible()
    // From the click on Pivot to the painted grid, measured in the page: the first time (the engine and
    // its binaries load, both pages are read) and again after Grid (engine running, rows read again).
    const clickToPainted = (label: string) => run.evaluate(async (root, label) => {
      const pivot = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label)
      if (!pivot) throw new Error(`no ${label} button`)
      const t0 = performance.now()
      pivot.click()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 20_000)
        const check = () => {
          if (root.querySelector('.nqt-psp-host[data-psp-state="ready"]')) { clearTimeout(timer); resolve() } else requestAnimationFrame(check)
        }
        check()
      })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return performance.now() - t0
    }, label)
    const host = run.locator('.nqt-psp-host')
    // Under reduced motion the pivot view opens as its accessible table; the cold time runs from Show as Pivot grid.
    await run.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
    await expect(run.getByRole('grid', { name: `Fills of ${FIXTURE_RUN}, ${FILLS.toLocaleString('en-GB')} rows, table` })).toBeVisible({ timeout: 20_000 })
    const coldOpenMs = await clickToPainted('Pivot grid')
    const coldLoadMs = Number(await host.getAttribute('data-psp-load-ms'))
    const coldEngineMs = Number(await host.getAttribute('data-psp-engine-ms'))
    await expect(run.getByText(`${FILLS.toLocaleString('en-GB')} rows in the pivot grid.`)).toBeVisible()
    await run.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Grid' }).click()
    await expect(host).toHaveCount(0)
    // The Pivot grid choice holds for the page, so View Pivot now opens straight into the pivot grid.
    const warmOpenMs = await clickToPainted('Pivot')
    const warmLoadMs = Number(await host.getAttribute('data-psp-load-ms'))
    info.annotations.push({ type: 'perspective-run-fills', description: JSON.stringify({ rows: FILLS, coldOpenMs: Math.round(coldOpenMs), coldEngineMs, coldLoadMs, warmOpenMs: Math.round(warmOpenMs), warmLoadMs }) })
    // The budget holds the pivot load itself (rows in hand to painted) and a warm open from the click;
    // the first open also starts the engine, reported above.
    expect(coldLoadMs).toBeLessThan(BUDGET_MS)
    expect(warmLoadMs).toBeLessThan(BUDGET_MS)
    expect(warmOpenMs).toBeLessThan(BUDGET_MS)
    expect(await axeAround(page)).toEqual([])
    expect(errors).toEqual([])
  })

  test('RUN 2) Trades, LEDG and OOS open their rows in the pivot, keyboard reachable and axe clean around it', async ({ page, request }) => {
    const errors = await startApp(page)
    const trades = (await (await request.get(`/api/runs/${FIXTURE_RUN}/trades?limit=5000`)).json()) as { total: number }
    const run = await openLine(page, `${FIXTURE_RUN} RUN`)
    await run.getByRole('tab', { name: /Trades/ }).click()
    await openPivot(run)
    await expect(run.getByText(`${trades.total} rows in the pivot grid.`)).toBeVisible()
    await expect(run.getByRole('group', { name: `Trades of ${FIXTURE_RUN}, ${trades.total} rows, pivot grid` })).toBeVisible()
    expect(await axeAround(page)).toEqual([])

    const ledger = (await (await request.get('/api/ledger')).json()) as { rows: Array<{ strategy: string | null }> }
    const ledg = await openLine(page, 'LEDG')
    const ledgHost = await openPivot(ledg)
    await expect(ledg.getByText(`${ledger.rows.length} rows in the pivot grid.`)).toBeVisible()
    // Grouped by strategy: the tree column holds the strategy names under the total row.
    await expect(ledgHost.locator('regular-table tbody')).toContainText(ledger.rows[0]?.strategy ?? '')
    expect(await axeAround(page)).toEqual([])
    // Tab into the panel lands on the pivot grid (it takes the panel's Tab stop), and Left reaches the toggle.
    await page.keyboard.press('Control+k')
    for (let i = 0; i < 8; i += 1) {
      if (await ledgHost.evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(ledgHost).toBeFocused()

    const log = (await (await request.get('/api/audit/oos-log?limit=5000')).json()) as { entries: Array<{ caller: string }> }
    const oos = await openLine(page, 'OOS')
    const oosHost = await openPivot(oos)
    await expect(oosHost.locator('regular-table tbody')).toContainText(log.entries[0]?.caller ?? '')
    expect(await axeAround(page)).toEqual([])
    expect(errors).toEqual([])
  })
})

// The accessible equivalent (WCAG 1.3.1, 2.1.1, 4.1.2): the viewer's grid is a shadow tree axe leaves out and no
// screen reader has been run over, so every pivot view also shows the same rows in the house MonitorGrid, on a
// visible Show as [Table | Pivot grid] toggle. It is the default under reduced motion (this run's setting) and
// when the pivot grid cannot start. axe runs over the whole page here, with nothing excluded.
async function axeAll(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

/** Tab from the command line until focus lands on `target`. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press('Control+k')
  for (let i = 0; i < 16; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

interface TableView {
  readonly line: string
  readonly tab?: RegExp
  readonly name: string
  readonly rows: number
  readonly shows: string
}

test.describe('the accessible table in every pivot view', () => {
  test('LEDG, RUN 2) Trades, 3) Fills and OOS open as a table under reduced motion: same rows, announced, keyboard, axe clean', async ({ page, request }) => {
    const errors = await startApp(page)
    const ledger = (await (await request.get('/api/ledger')).json()) as { rows: Array<{ strategy: string | null }> }
    const trades = (await (await request.get(`/api/runs/${FIXTURE_RUN}/trades?limit=5000`)).json()) as { total: number }
    const fills = (await (await request.get(`/api/runs/${FIXTURE_RUN}/fills?limit=5000`)).json()) as { total: number; items: Array<{ instrument: string }> }
    const log = (await (await request.get('/api/audit/oos-log?limit=5000')).json()) as { entries: Array<{ caller: string }> }
    const views: TableView[] = [
      { line: 'LEDG', name: 'Run ledger', rows: ledger.rows.length, shows: ledger.rows[0]?.strategy ?? '' },
      { line: `${FIXTURE_RUN} RUN`, tab: /Trades/, name: `Trades of ${FIXTURE_RUN}`, rows: trades.total, shows: 'Exit (UTC)' },
      { line: `${FIXTURE_RUN} RUN`, tab: /Fills/, name: `Fills of ${FIXTURE_RUN}`, rows: fills.total, shows: fills.items[0]?.instrument ?? '' },
      { line: 'OOS', name: 'Gate access log', rows: log.entries.length, shows: log.entries[0]?.caller ?? '' },
    ]
    for (const v of views) {
      const panel = await openLine(page, v.line)
      if (v.tab) await panel.getByRole('tab', { name: v.tab }).click()
      await panel.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
      const show = panel.getByRole('group', { name: 'Show as' })
      await expect(show.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
      const count = v.rows.toLocaleString('en-GB')
      const grid = panel.getByRole('grid', { name: `${v.name}, ${count} rows, table` })
      await expect(grid).toBeVisible({ timeout: 20_000 })
      await expect(grid).toContainText(v.shows)
      await expect(panel.getByRole('status').filter({ hasText: `Table of ${v.name}: ${count} rows.` })).toHaveCount(1)
      await expect(panel.getByText('Opened as a table because this browser asks for reduced motion')).toBeVisible()
      // No viewer was started for the table.
      await expect(panel.locator('perspective-viewer')).toHaveCount(0)
      // Keyboard: Tab reaches the table; Down moves its active cell and focus stays on it.
      await tabTo(page, grid)
      const before = (await grid.getAttribute('aria-activedescendant')) ?? ''
      await page.keyboard.press('ArrowDown')
      await expect(grid).not.toHaveAttribute('aria-activedescendant', before)
      await expect(grid).toBeFocused()
      expect(await axeAll(page)).toEqual([])
    }
    expect(errors).toEqual([])
  })

  test('the toggle switches the same view between the table and the pivot grid, both ways, from the keyboard', async ({ page }) => {
    const errors = await startApp(page)
    const ledg = await openLine(page, 'LEDG')
    await ledg.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
    const show = ledg.getByRole('group', { name: 'Show as' })
    await show.getByRole('button', { name: 'Pivot grid' }).focus()
    await page.keyboard.press('Enter')
    await expect(ledg.locator('.nqt-psp-host')).toHaveAttribute('data-psp-state', 'ready', { timeout: 20_000 })
    await expect(ledg.getByRole('grid', { name: /rows, table$/ })).toHaveCount(0)
    await show.getByRole('button', { name: 'Table' }).focus()
    await page.keyboard.press('Enter')
    await expect(ledg.getByRole('grid', { name: /^Run ledger, \d+ rows, table$/ })).toBeVisible()
    await expect(ledg.locator('perspective-viewer')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('born failing: when the pivot grid cannot start, the table takes over and an alert says why', async ({ page }) => {
    // The engine's WebAssembly is refused, so the viewer cannot start.
    await page.route('**/*.wasm', (route) => route.abort())
    await startApp(page)
    const ledg = await openLine(page, 'LEDG')
    await ledg.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Pivot' }).click()
    await ledg.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Pivot grid' }).click()
    await expect(ledg.getByRole('alert')).toContainText('The pivot grid could not start', { timeout: 20_000 })
    await expect(ledg.getByRole('grid', { name: /^Run ledger, \d+ rows, table$/ })).toBeVisible()
    await expect(ledg.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(await axeAll(page)).toEqual([])
  })
})

// Born failing (numerics review): the pivots' "(UTC)" columns showed the browser's zone. The OOS pivot's
// latest read per caller must print in UTC in New York (5 hours behind in summer) and in London (1 hour).
for (const zone of ['America/New_York', 'Europe/London']) {
  test.describe(`pivot times in UTC with the browser in ${zone}`, () => {
    test.use({ timezoneId: zone })

    test('the OOS pivot prints the latest read of each caller in UTC', async ({ page, request }) => {
      const errors = await startApp(page)
      const log = (await (await request.get('/api/audit/oos-log?limit=5000')).json()) as { entries: Array<{ caller: string; ts_epoch_s: number | null }> }
      const latest = Math.max(...log.entries.filter((e) => e.caller === 'terminal').map((e) => e.ts_epoch_s ?? 0))
      const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'medium' }).format(latest * 1000)
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'short', timeStyle: 'medium' }).format(latest * 1000)
      expect(local).not.toBe(utc) // a summer read, so the zone matters
      const host = await openPivot(await openLine(page, 'OOS'))
      const body = host.locator('regular-table tbody')
      await expect(body).toContainText(utc)
      await expect(body).not.toContainText(local)
      expect(errors).toEqual([])
    })
  })
}
