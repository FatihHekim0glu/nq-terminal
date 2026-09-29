// Keyboard flows (TASKS 8.1; UI_SPEC section 5, Keys; WCAG 2.1.1): whole research sessions driven
// from the keyboard alone, never the mouse, against the fixture-mode backend. The single keys are
// checked one by one in e2e/keys.spec.ts; these flows chain them the way a person works: open a
// screen, walk into a grid, drill down, go back, add a panel, move between panels, ask for help, read
// a chart bar by bar and switch it to its table. Each flow ends clean: every request a same-origin
// GET, no console error, no CSP report, and no served price point past the fence.
import { expect, test, type Page } from '@playwright/test'
import { OFFLINE } from '../target.ts'
import {
  commandLine,
  expectCleanFlow,
  focusInfo,
  message,
  openTerminal,
  panel,
  panelTitles,
  pressUntil,
  settle,
  status,
  TEAR_SUBJECT,
  watchFlow,
} from './support.ts'

// The demo registry is the real research files' (screens/reg/regFixtures.ts): the row Down lands on is the check
// za_v0_C3_gao_momentum (a capital in its name, and a DES that reads [CHECK], not [PRE-REG]). Offline only, the walk
// goes on to volmanaged_v0, a registered hypothesis whose DES card the demo holds whole.
const DEMO_REGISTERED = 'volmanaged_v0'

/** The name in the grid row the grid's active descendant sits on (the second cell holds the name). */
async function activeRowName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const grid = document.activeElement as HTMLElement | null
    const id = grid?.getAttribute('aria-activedescendant')
    const cell = id ? document.getElementById(id) : null
    const row = cell?.closest('tr')
    return (row?.querySelectorAll('td')[1]?.textContent ?? '').trim()
  })
}

async function focusGridIn(page: Page, title: string): Promise<void> {
  await pressUntil(page, 'ArrowRight', async () => {
    const f = await focusInfo(page)
    return f.panel === title && f.role === 'grid'
  })
}

async function typeLine(page: Page, text: string, key: 'Enter' | 'Shift+Enter' = 'Enter'): Promise<void> {
  await page.keyboard.type(text)
  await page.keyboard.press(key)
  await expect(commandLine(page)).toHaveValue('')
}

test.describe('keyboard flows', () => {
  test('registry session: REG, into the grid, drill to DES, back, a second panel, help and the key map', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)

    // Esc from anywhere reaches the command line; typed letters show in upper case.
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.type('reg')
    await expect(commandLine(page)).toHaveValue('REG')
    await page.keyboard.press('Enter')
    await expect(status(page)).toContainText('Screen REG')
    expect(await panelTitles(page)).toEqual(['REG', 'MT'])
    await settle(page)

    // Tab: one stop per panel. Arrows walk the panel's items to the grid; Down picks a row.
    await page.keyboard.press('Tab')
    expect((await focusInfo(page)).panel).toBe('REG')
    await focusGridIn(page, 'REG')
    await page.keyboard.press('ArrowDown')
    if (OFFLINE) await pressUntil(page, 'ArrowDown', async () => (await activeRowName(page)) === DEMO_REGISTERED)
    const name = await activeRowName(page)
    expect(name).toMatch(/^[a-z0-9_]+$/)

    // Enter drills down to DES in the same panel; End walks the panel's history back.
    await page.keyboard.press('Enter')
    await expect(panel(page, `${name} DES`)).toBeVisible()
    await settle(page)
    await expect(panel(page, `${name} DES`)).toContainText('[PRE-REG]')
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.press('End')
    await expect(panel(page, 'REG')).toBeVisible()
    expect(await panelTitles(page)).toEqual(['REG', 'MT'])

    // Shift+Enter opens the result in a new panel; Alt+N focuses panel N and the zone shows N.
    await page.keyboard.press('Control+k')
    await typeLine(page, '27F MON', 'Shift+Enter')
    await expect(panel(page, '27F MON')).toBeVisible()
    const titles = await panelTitles(page)
    expect(titles).toHaveLength(3)
    const n = titles.indexOf('27F MON') + 1
    await settle(page)
    await page.keyboard.press(`Alt+Digit${n}`)
    expect((await focusInfo(page)).panel).toBe('27F MON')
    await expect(page.locator('.ctx-panel')).toHaveText(String(n))

    // F1 opens the focused screen's help; Esc closes it. Alt+K opens and closes the key map.
    await page.keyboard.press('F1')
    await expect(page.getByRole('listbox', { name: /^MON/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.keyboard.press('Alt+KeyK')
    await expect(page.getByRole('dialog', { name: 'Keyboard map' })).toBeVisible()
    await page.keyboard.press('Alt+KeyK')
    await expect(page.getByRole('dialog', { name: 'Keyboard map' })).toHaveCount(0)

    // Up in the empty line walks the command history, newest first; Esc clears the line.
    await page.keyboard.press('Control+k')
    await page.keyboard.press('ArrowUp')
    await expect(commandLine(page)).toHaveValue('27F MON')
    // The drill-down ran as a command too, so it sits between them.
    await page.keyboard.press('ArrowUp')
    await expect(commandLine(page)).toHaveValue(`${name.toUpperCase()} DES`)
    await page.keyboard.press('ArrowUp')
    await expect(commandLine(page)).toHaveValue('REG')
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toHaveValue('')
    await expectCleanFlow(page, watch)
  })

  // UI_SPEC section 5: each panel is one Tab stop, and Left and Right walk its items. The chart is
  // the GP panel's last item, so a keyboard user reaches it by walking right from the Tab stop.
  for (const line of ['NQ GP', 'NQ GIP 2019-03-14']) {
    test(`${line}: Left and Right from the panel's Tab stop reach the chart`, async ({ page }) => {
      test.skip(OFFLINE && line.includes('GIP'), '1m bars are not in the demo dataset (src/demo/data/market.ts serves daily vendor bars only)')
      const watch = await watchFlow(page)
      await openTerminal(page)
      await page.keyboard.press('Control+k')
      await typeLine(page, line)
      await expect(panel(page, line)).toBeVisible()
      await settle(page)
      await page.keyboard.press('Tab')
      expect((await focusInfo(page)).panel).toBe(line)
      await pressUntil(page, 'ArrowRight', async () => (await focusInfo(page)).role === 'img')
      await expect(panel(page, line).getByRole('img', { name: /^NQ1 Index/ })).toBeFocused()
      await expectCleanFlow(page, watch)
    })
  }

  test('chart session: in the NQ GP chart, jump to the ends, zoom, switch to the table and back', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await page.keyboard.press('Control+k')
    await typeLine(page, 'NQ GP')
    await expect(panel(page, 'NQ GP')).toBeVisible()
    await settle(page)
    // Reaching the chart with the arrows is the test above; this one starts with the chart focused.
    const chart = panel(page, 'NQ GP').getByRole('img', { name: /^NQ1 Index/ })
    await chart.focus()
    const [, first, final] = /from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec((await chart.getAttribute('aria-label')) ?? '') ?? []
    expect(first).toBeTruthy()
    const readout = panel(page, 'NQ GP').getByRole('status', { name: 'Crosshair readout' })

    // Home and End jump to the data ends and the readout names the bar; focus stays on the chart.
    await page.keyboard.press('Home')
    await expect(readout).toContainText(`T ${first}`)
    await page.keyboard.press('End')
    await expect(readout).toContainText(`T ${final}`)
    await expect(chart).toBeFocused()

    // + and - zoom: the readout counts the bars in view. The keys stay in the chart.
    const shown = async (): Promise<number> => Number(/(\d+) of \d+ bars shown/.exec((await readout.textContent()) ?? '')?.[1] ?? Number.NaN)
    const all = await shown()
    expect(all).toBeGreaterThan(10)
    await page.keyboard.press('+')
    await expect.poll(shown).toBeLessThan(all)
    const zoomed = await shown()
    await page.keyboard.press('-')
    await expect.poll(shown).toBeGreaterThan(zoomed)
    await expect(chart).toBeFocused()
    await expect(commandLine(page)).toHaveValue('')

    // T switches to the table view, which takes focus, and back to the chart.
    await page.keyboard.press('t')
    const table = panel(page, 'NQ GP').getByRole('region').filter({ has: page.locator('table') })
    await expect(table).toBeVisible()
    await expect(table).toBeFocused()
    await expect(table.locator('tbody tr').first()).toBeVisible()
    await page.keyboard.press('t')
    await expect(chart).toBeVisible()
    await expect(chart).toBeFocused()
    await expect(commandLine(page)).toHaveValue('')
    await expectCleanFlow(page, watch)
  })

  // UI_SPEC section 5: in a focused grid the arrows move the cell, in a focused chart Left and Right
  // step the crosshair one bar. Either way focus stays where it is; only keys the item leaves unused
  // move to the panel's next item.
  test('Left and Right inside a focused grid or chart stay inside it', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await page.keyboard.press('Control+k')
    await typeLine(page, 'REG')
    await settle(page)
    await page.keyboard.press('Tab')
    await focusGridIn(page, 'REG')
    const grid = panel(page, 'REG').getByRole('grid', { name: /Registry board/ })
    const cell = async () => (await grid.getAttribute('aria-activedescendant')) ?? ''
    const start = await cell()
    await page.keyboard.press('ArrowRight')
    expect(await cell()).not.toBe(start)
    await page.keyboard.press('ArrowLeft')
    await expect.soft(grid, 'Left in the grid moves the cell, not the focus').toBeFocused()
    expect.soft(await cell()).toBe(start)

    for (const line of ['NQ GP', `${TEAR_SUBJECT} EQ`]) {
      await page.keyboard.press('Control+k')
      await typeLine(page, line)
      await settle(page)
      // The first chart of the panel and its own readout (EQ stacks more than one chart).
      const figure = panel(page, line).locator('.chart-a11y').first()
      const chart = figure.getByRole('img')
      await chart.focus()
      const readout = figure.getByRole('status', { name: 'Crosshair readout' })
      await page.keyboard.press('End')
      const last = (await readout.textContent()) ?? ''
      await page.keyboard.press('ArrowLeft')
      await expect(readout).not.toHaveText(last)
      await expect.soft(chart, `${line}: Left steps the crosshair and keeps focus on the chart`).toBeFocused()
      await page.keyboard.press('Escape')
    }
    await expectCleanFlow(page, watch)
  })

  test('runs session: RUNS grid, drill to RUN, Number <GO> on the tear sheet tabs, Tab completion, End back', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    await page.keyboard.press('Control+k')
    await typeLine(page, 'RUNS')
    await expect(panel(page, 'RUNS')).toBeVisible()
    await settle(page)

    await page.keyboard.press('Tab')
    await focusGridIn(page, 'RUNS')
    await page.keyboard.press('ArrowDown')
    const run = await page.evaluate(() => {
      const grid = document.activeElement as HTMLElement | null
      const id = grid?.getAttribute('aria-activedescendant')
      const row = id ? document.getElementById(id)?.closest('tr') : null
      return Array.from(row?.querySelectorAll('td') ?? []).map((td) => (td.textContent ?? '').trim()).find((t) => /^(nt_|smoke_)/.test(t)) ?? ''
    })
    expect(run).not.toBe('')
    await page.keyboard.press('Enter')
    await expect(panel(page, `${run} RUN`)).toBeVisible()
    await settle(page)

    // A context and a function on the line; then Number <GO> runs the panel's numbered tab.
    await page.keyboard.press('Control+k')
    await typeLine(page, `${TEAR_SUBJECT} EQ`)
    await expect(panel(page, `${TEAR_SUBJECT} EQ`)).toBeVisible()
    await settle(page)
    await page.keyboard.press('Control+k')
    await typeLine(page, '2')
    await expect(panel(page, `${TEAR_SUBJECT} DD`)).toBeVisible()
    await settle(page)

    // Tab completes the open suggestion list; Enter then runs the completed line.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('led')
    await expect(page.getByRole('option').first()).toContainText('LEDG')
    await page.keyboard.press('Tab')
    await expect(commandLine(page)).toHaveValue(/^LEDG\s*$/)
    await page.keyboard.press('Enter')
    // LEDG replaces the panel inside the RUNS layout, so the status line keeps naming the layout (RUNS, edited): the panel is the proof.
    await expect(panel(page, 'LEDG')).toBeVisible()
    await expect(message(page)).toContainText('Opened LEDG')
    await settle(page)

    // End in the empty line walks the panel history back through DD and EQ.
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.press('End')
    await expect(panel(page, `${TEAR_SUBJECT} DD`)).toBeVisible()
    await page.keyboard.press('End')
    await expect(panel(page, `${TEAR_SUBJECT} EQ`)).toBeVisible()
    await expect(message(page)).not.toHaveAttribute('data-tone', 'error')
    await settle(page)
    await expectCleanFlow(page, watch)
  })
})
