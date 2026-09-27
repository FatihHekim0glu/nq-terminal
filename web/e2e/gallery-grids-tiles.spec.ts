// Grids and tiles in the component gallery (TASKS 5.4): MonitorGrid (27F monitor and 10,000 runs),
// JournalTable, KpiTile, SpecCard, BalanceCheck and Countdown. Each entry: screenshots at 1920x1080
// and 1366x768, axe WCAG 2.2 AA with no console error and GET only, and its keyboard path. The
// 10,000-row entry is scrolled frame by frame and its frame times are measured and reported.
import { expect, test, type Page } from '@playwright/test'
import { expectGalleryAxeClean, expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'

const BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

/** The text of the cell the grid marks active (aria-activedescendant). */
async function activeCellText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    const id = grid?.getAttribute('aria-activedescendant')
    return id ? (document.getElementById(id)?.textContent ?? '') : ''
  })
}

test.describe('MonitorGrid', () => {
  test('27F monitor: sections, 20px rows, keyboard drill-down, axe clean', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'MonitorGrid')
    const grid = main.getByRole('grid', { name: 'Futures monitor, fixture data to 2021-12-31' })
    await expect(grid).toHaveAttribute('aria-rowcount', '34')
    const firstData = grid.locator('tbody tr[aria-selected]').first()
    expect((await firstData.boundingBox())?.height).toBe(20)
    await expect(grid.locator('tbody tr.group-row').first()).toHaveText('1) Equity')
    await expect(firstData.locator('td').first()).toHaveText('10)')

    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    expect(await activeCellText(page)).toBe('NQ E-mini Nasdaq-100')
    await page.keyboard.press('Enter')
    await expect(main.getByTestId('opened')).toHaveText('Opened: NQ')
    // The active cell carries the 2px white focus ring (look spec 4.12).
    const ring = await page.evaluate(() => {
      const el = document.querySelector('.is-active')
      return el ? getComputedStyle(el).outlineWidth + ' ' + getComputedStyle(el).outlineStyle : ''
    })
    expect(ring).toBe('2px solid')
    await expectGalleryClean(page, watch)
  })

  test('27F monitor sorts from the keyboard, missing values last', async ({ page }) => {
    const main = await openGallery(page, 'MonitorGrid')
    const grid = main.getByRole('grid')
    await grid.focus()
    await page.keyboard.press('ArrowUp')
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
    expect(await activeCellText(page)).toContain('12M')
    await page.keyboard.press('Enter')
    await expect(grid.getByRole('columnheader', { name: /12M/ })).toHaveAttribute('aria-sort', 'ascending')
    await expect(grid.locator('tbody tr.group-row').last()).toHaveText('7) Livestock')
    await expect(grid.locator('tbody tr[aria-selected]').last().locator('td').nth(1)).toHaveText('HE Lean hogs')
  })

  test('MonitorGrid screenshots', async ({ page }) => {
    await screenshotGallery(page, 'MonitorGrid')
  })

  test('10,000 rows scroll smoothly, stay virtualised, and Enter opens the last row', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'MonitorGrid.large')
    const grid = main.getByRole('grid', { name: 'Runs, 10,000 fixture rows' })
    await expect(grid).toHaveAttribute('aria-rowcount', '10001')

    const perf = await page.evaluate(async () => {
      const box = document.querySelector<HTMLElement>('.nqt-grid-scroll')
      if (!box) throw new Error('no scroll box')
      const target = box.scrollHeight - box.clientHeight
      const frames: number[] = []
      let maxRows = 0
      let last = performance.now()
      await new Promise<void>((done) => {
        const tick = (now: number) => {
          frames.push(now - last)
          last = now
          maxRows = Math.max(maxRows, box.querySelectorAll('tbody tr[aria-rowindex]').length)
          if (box.scrollTop >= target - 1 || frames.length > 2000) return done()
          box.scrollTop += 400
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const sorted = frames.slice(1).sort((a, b) => a - b)
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
      return { frames: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1), over33: sorted.filter((f) => f > 33.4).length, maxRows }
    })
    process.stdout.write(`MonitorGrid.large scroll (400px, 20 rows, per frame over 10,000 rows): ${JSON.stringify(perf)}\n`)
    expect(perf.frames).toBeGreaterThan(400)
    expect(perf.maxRows).toBeLessThan(120)
    expect(perf.p95).toBeLessThan(34)
    expect(perf.over33 / perf.frames).toBeLessThan(0.05)

    await grid.focus()
    const t0 = Date.now()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Home')
    expect(await activeCellText(page)).toBe('10000)')
    await page.keyboard.press('Enter')
    await expect(main.getByTestId('opened')).toHaveText('Opened: nt_tsmom_v0_fx10000')
    process.stdout.write(`MonitorGrid.large Control+End, Home, Enter to readout: ${Date.now() - t0} ms\n`)
    await expectGalleryClean(page, watch)
  })

  test('MonitorGrid.large screenshots', async ({ page }) => {
    await screenshotGallery(page, 'MonitorGrid.large')
  })
})

test.describe('JournalTable', () => {
  test('plumbing rows are hatched and show the exact banner; Enter drills down', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'JournalTable')
    const plumbing = main.locator('tbody tr.plumbing-row')
    expect(await plumbing.count()).toBeGreaterThan(3)
    await expect(plumbing.first().locator('.plumbing-banner')).toHaveText(BANNER)
    await expect(plumbing.first().locator('.src')).toHaveText('PLMB')
    const hatch = await plumbing.first().locator('td').first().evaluate((td) => getComputedStyle(td).backgroundImage)
    expect(hatch).toMatch(/repeating-linear-gradient/)
    await expect(main.locator('tbody tr:not(.plumbing-row) .plumbing-banner')).toHaveCount(0)

    await main.getByRole('grid').focus()
    await page.keyboard.press('Enter')
    await expect(main.getByTestId('opened')).toHaveText(/^Opened: volmanaged_paper_journal\.jsonl:\d+$/)
    await expectGalleryClean(page, watch)
  })

  test('JournalTable screenshots', async ({ page }) => {
    await screenshotGallery(page, 'JournalTable')
  })
})

test.describe('Tiles', () => {
  test('KpiTile opens its basis and unit, closes with Escape, axe clean open and closed', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'KpiTile')
    await expect(main.getByRole('list', { name: 'Key figures' }).getByRole('listitem')).toHaveCount(12)
    const sharpe = main.getByRole('button', { name: /Sharpe/ })
    await sharpe.focus()
    await page.keyboard.press('Enter')
    await expect(sharpe).toHaveAttribute('aria-expanded', 'true')
    await expect(main.locator('.kpi-pop')).toContainText('Basis B: an account value, from the Nautilus account.')
    await expect(main.locator('.kpi-pop')).toContainText('Unit: ratio')
    await expectGalleryAxeClean(page)
    await page.keyboard.press('Escape')
    await expect(sharpe).toHaveAttribute('aria-expanded', 'false')
    await expectGalleryClean(page, watch)
  })

  test('KpiTile screenshots, closed and with a popover open', async ({ page }) => {
    await screenshotGallery(page, 'KpiTile')
    await screenshotGallery(page, 'KpiTile', {
      variant: 'popover',
      prepare: async (_p, main) => {
        await main.getByRole('button', { name: /MinTRL/ }).click()
      },
    })
  })

  test('SpecCard shows verdicts, hashes and the pass bar behind More', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'SpecCard')
    await expect(main.getByRole('region', { name: /^Registration and spec: / })).toHaveCount(3)
    const rebal = main.getByRole('region', { name: 'Registration and spec: rebal_v0' })
    await expect(rebal).toContainText('[FAIL]')
    await expect(rebal).toContainText('d594...0b74')
    const more = rebal.getByRole('button', { name: 'More' })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(rebal.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
    await expect(main.getByRole('region', { name: /za_v0_C3_gao_momentum/ })).toContainText('[CHECK]')
    await expectGalleryClean(page, watch)
  })

  test('SpecCard screenshots', async ({ page }) => {
    await screenshotGallery(page, 'SpecCard')
  })

  test('BalanceCheck marks the unbalanced run unusable', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'BalanceCheck')
    await expect(main.getByRole('region', { name: 'Balance check: nt_dtsmom_v0_fixture_ts1' })).toContainText(
      'Balance [OK] diff 0.00 USD | MTM [OK] max abs diff 0.00 USD, 0 bad rows | Coverage 15/15 | Anchor IDENTICAL',
    )
    const bad = main.getByRole('region', { name: 'Balance check: nt_za_v0_fixture_unbalanced' })
    await expect(bad).toContainText('Balance [FAIL] diff 12.34 USD')
    await expect(bad).toContainText('[UNUSABLE: BALANCE]')
    await expectGalleryClean(page, watch)
  })

  test('BalanceCheck screenshots', async ({ page }) => {
    await screenshotGallery(page, 'BalanceCheck')
  })

  test('Countdown shows the three clock states', async ({ page }) => {
    const watch = await watchGallery(page)
    const main = await openGallery(page, 'Countdown')
    const groups = main.getByRole('group', { name: 'Paper book times for 2021-11-10 (ET)' })
    await expect(groups).toHaveCount(3)
    await expect(groups.nth(0)).toContainText('Decision 15:55:05 ET in 01:23:10')
    await expect(groups.nth(1)).toContainText('Decision 15:55:05 ET passed')
    await expect(groups.nth(1)).toContainText('Order 15:59:30 ET in 00:02:30')
    await expect(groups.nth(2)).toContainText('Roll 2021-12-07 (MNQZ1) in 27 days')
    await expectGalleryClean(page, watch)
  })

  test('Countdown screenshots', async ({ page }) => {
    await screenshotGallery(page, 'Countdown')
  })
})
