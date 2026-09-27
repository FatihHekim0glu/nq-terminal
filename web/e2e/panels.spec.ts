// Panels and tables E2E (look spec section 12, task 3 acceptance): the 2x2 HOME at 1920x1080
// meets the 8.5 (c) row budget on the MON and REG grids; the tab slant and square corners hold in
// computed style; the related functions menu dims only its own panel while the command line stays
// usable; hovered cells keep their text at 4.5:1; Tab visits every panel with a 2px white ring;
// back and forward walk a panel's history; axe is clean with every panel menu open.
// Runs against the fixture-mode backend (playwright.config.ts).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const HOME_NUMBERS = ['1-GP', '2-MON', '3-EQ', '4-REG']
// Grid screens on HOME; GP and EQ are chart panels (section 7 row budget).
const GRID_PANELS = ['27F MON', 'REG']
const MIN_ROWS = 19
const WHITE = 'rgb(255, 255, 255)'
const CMD_BLUE = 'rgb(20, 142, 255)'

const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
const panelBody = (page: Page, title: string): Locator => page.getByRole('group', { name: `${title} content`, exact: true })
const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: /command/i }).first()

async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_TITLES.length)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function expectAxeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary).toEqual([])
}

/** Relative luminance contrast of two computed `rgb(...)` colours. */
function contrast(a: string, b: string): number {
  const lum = (css: string): number => {
    // Chromium reports a color-mix() result as color(srgb r g b) with channels from 0 to 1.
    const scale = css.startsWith('color(') ? 255 : 1
    const [r, g, bl] = (css.match(/\d*\.?\d+/g) ?? []).slice(0, 3).map((v) => Number(v) * scale)
    const ch = (v: number) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r ?? 0) + 0.7152 * ch(g ?? 0) + 0.0722 * ch(bl ?? 0)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

async function openActions(page: Page, title: string): Promise<Locator> {
  const button = panel(page, title).getByRole('button', { name: /96\) Actions/ })
  await button.click()
  const menu = page.getByRole('menu', { name: 'Actions menu' })
  await expect(menu).toBeVisible()
  return menu
}

test.describe('panels and tables', () => {
  test('HOME is the 2x2 home layout, numbered in reading order', async ({ page }) => {
    await openHome(page)
    const titles = await page.locator('[data-nqt-title]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nqt-title')))
    expect(titles).toEqual(HOME_TITLES)
    await expect(page.locator('[data-nqt-panel] .ptitle-no')).toHaveText(HOME_NUMBERS)
    const boxes = await Promise.all(HOME_TITLES.map((t) => panel(page, t).boundingBox()))
    const [gp, mon, eq, reg] = boxes.map((b) => b ?? { x: 0, y: 0, width: 0, height: 0 })
    expect(Math.abs((gp?.x ?? 0) - (eq?.x ?? 1))).toBeLessThan(1)
    expect(Math.abs((mon?.x ?? 0) - (reg?.x ?? 1))).toBeLessThan(1)
    expect(Math.abs((gp?.y ?? 0) - (mon?.y ?? 1))).toBeLessThan(1)
    expect(Math.abs((eq?.y ?? 0) - (reg?.y ?? 1))).toBeLessThan(1)
    // 2px black gutters between panels.
    expect(Math.round((mon?.x ?? 0) - ((gp?.x ?? 0) + (gp?.width ?? 0)))).toBe(2)
    expect(Math.round((eq?.y ?? 0) - ((gp?.y ?? 0) + (gp?.height ?? 0)))).toBe(2)
  })

  test(`every grid panel shows at least ${MIN_ROWS} whole 20px rows at 1920x1080 (8.5 c)`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHome(page)
    for (const title of GRID_PANELS) {
      // The grid rows arrive with their API reads after the layout: wait for the first two.
      await expect(panel(page, title).locator('tbody tr').nth(1)).toBeAttached()
      const counts = await panel(page, title).evaluate((el) => {
        const body = el.querySelector('.nqt-panel-body') as HTMLElement
        const box = body.getBoundingClientRect()
        const head = body.querySelector('thead')?.getBoundingClientRect()
        const top = head ? head.bottom : box.top
        const rows = Array.from(body.querySelectorAll('tbody tr')).map((r) => r.getBoundingClientRect())
        const pitch = rows[1] && rows[0] ? rows[1].top - rows[0].top : (rows[0]?.height ?? 0)
        return {
          // Rows the panel shows whole under the header: counted when the grid fills the body, else the
          // room the layout gives it (the fixture registry has only 2 rows, the real one 20).
          whole: Math.max(
            rows.filter((r) => r.top >= top - 0.5 && r.bottom <= box.bottom + 0.5).length,
            pitch > 0 && rows[0] && rows[0].top >= top - 0.5 ? Math.floor((box.bottom - rows[0].top + 0.5) / pitch) : 0,
          ),
          pitch,
          panel: Math.round(el.getBoundingClientRect().height),
          body: Math.round(box.height),
          header: head ? Math.round(head.height) : 0,
        }
      })
      test.info().annotations.push({ type: `row-budget ${title}`, description: JSON.stringify(counts) })
      expect(counts.pitch, title).toBeCloseTo(20, 0)
      expect(counts.whole, title).toBeGreaterThanOrEqual(MIN_ROWS)
    }
  })

  test('title bars, red bars and tabs keep the measured look in computed style', async ({ page }) => {
    await openHome(page)
    const reg = panel(page, 'REG')
    const title = await reg.locator('.ptitle').evaluate((el) => {
      const s = getComputedStyle(el)
      return { h: el.getBoundingClientRect().height, bg: s.backgroundColor, fg: s.color }
    })
    expect(title).toEqual({ h: 24, bg: 'rgb(205, 205, 205)', fg: 'rgb(0, 0, 0)' })
    const bar = await reg.locator('.fn-bar').evaluate((el) => ({ h: el.getBoundingClientRect().height, bg: getComputedStyle(el).backgroundColor }))
    expect(bar.bg).toBe('rgb(135, 15, 30)')
    expect(bar.h).toBeGreaterThanOrEqual(24)
    // Each red-bar button ends with a 2px dark divider, so a lone 96) Actions shows its extent at rest.
    const cellEdges = await reg.locator('.fn-cell').evaluateAll((els) => els.map((el) => {
      const s = getComputedStyle(el)
      return `${s.borderRightWidth} ${s.borderRightStyle} ${s.borderRightColor}`
    }))
    expect(cellEdges.length).toBeGreaterThan(0)
    for (const edge of cellEdges) expect(edge).toBe('2px solid rgb(0, 0, 0)')
    await expect(page.locator('[data-chrome="nav"] .nav-msg-label')).toBeVisible()
    await expect(page.locator('[data-chrome="nav"] .nav-msg-label')).toHaveText('Message')
    // A real table: the header row spans the panel (a utility class must never restyle it).
    const table = await reg.locator('table').evaluate((t) => ({
      display: getComputedStyle(t).display,
      width: Math.round(t.getBoundingClientRect().width),
      header: Math.round(Array.from(t.querySelectorAll('thead th')).reduce((w, th) => w + th.getBoundingClientRect().width, 0)),
    }))
    expect(table.display).toBe('table')
    expect(Math.abs(table.width - table.header)).toBeLessThanOrEqual(1)
    const radii = await page.locator('[data-nqt-panel], .fn-btn, .ptitle-btn, .tab').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).borderRadius))])
    expect(radii).toEqual(['0px'])

    // HOME panel 3 is the light equity panel (no tabs); the tear sheet with its tabs opens with DD.
    await commandLine(page).click()
    await commandLine(page).fill('volmanaged_v0 DD')
    await commandLine(page).press('Enter')
    const tabs = panel(page, 'volmanaged_v0 DD').getByRole('tab')
    await expect(tabs).toHaveText(['1) Equity', '2) Drawdown', '3) Returns', '4) Rolling', '5) Monthly'])
    const tab = await panel(page, 'volmanaged_v0 DD').getByRole('tab', { selected: true }).evaluate((el) => ({ clip: getComputedStyle(el).clipPath, bg: getComputedStyle(el).backgroundColor, h: el.getBoundingClientRect().height }))
    expect(tab.clip).toContain('calc(100% - 5px)')
    expect(tab.bg).toBe('rgb(158, 158, 158)')
    expect(tab.h).toBeGreaterThanOrEqual(24)
  })

  test('the related functions menu dims only its own panel; the command line stays usable', async ({ page }) => {
    await openHome(page)
    const menu = await openActions(page, 'REG')
    await menu.getByRole('menuitem', { name: 'Related functions' }).click()
    const dialog = page.getByRole('dialog', { name: 'Related functions' })
    await expect(dialog).toBeVisible()
    const geometry = await panel(page, 'REG').evaluate((el) => {
      const dim = el.querySelector('.menu-dim') as HTMLElement
      const p = el.getBoundingClientRect()
      const d = dim.getBoundingClientRect()
      const t = (el.querySelector('.ptitle') as HTMLElement).getBoundingClientRect()
      return { inside: d.left >= p.left && d.right <= p.right && d.top >= t.bottom - 0.5 && d.bottom <= p.bottom + 0.5, bg: getComputedStyle(dim).backgroundColor }
    })
    expect(geometry.inside).toBe(true)
    expect(geometry.bg).toBe('rgba(0, 0, 0, 0.5)')
    for (const other of ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ']) {
      const covered = await panel(page, other).evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return hit?.closest('.menu-dim') !== null
      })
      expect(covered, other).toBe(false)
    }
    await commandLine(page).click()
    await expect(commandLine(page)).toBeFocused()
    await expect(dialog).toBeVisible()
    await expectAxeClean(page)
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('a menu row opens a function in the panel; Back and Forward walk the panel history', async ({ page }) => {
    await openHome(page)
    await panelBody(page, 'NQ GP 1d').focus()
    const options = panel(page, 'NQ GP 1d').getByRole('button', { name: 'Options' })
    await options.click()
    await page.getByRole('menuitem', { name: 'Related functions' }).click()
    const dialog = page.getByRole('dialog', { name: 'Related functions' })
    await dialog.getByRole('menuitem', { name: /\bGIP\b/ }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-nqt-title]').first()).toHaveAttribute('data-nqt-title', 'NQ GIP')
    const back = await openActions(page, 'NQ GIP')
    await back.getByRole('menuitem', { name: 'Back' }).click()
    await expect(page.locator('[data-nqt-title]').first()).toHaveAttribute('data-nqt-title', 'NQ GP 1d')
    const fwd = await openActions(page, 'NQ GP 1d')
    await fwd.getByRole('menuitem', { name: 'Forward' }).click()
    await expect(page.locator('[data-nqt-title]').first()).toHaveAttribute('data-nqt-title', 'NQ GIP')
  })

  // The placeholder grids had muted cells; the built screens on HOME have none in fixture mode, so a MON
  // cell in down red is hovered, then given the muted class in place, and both tones are measured.
  test('a hovered cell keeps down and muted text at 4.5:1 or more (4.12)', async ({ page }) => {
    await openHome(page)
    const found = panel(page, '27F MON').locator('tbody td.down').first()
    await found.hover()
    // A handle, not the locator: once its class changes, `td.down` would name another cell.
    const cell = await found.elementHandle()
    if (!cell) throw new Error('no down cell in MON')
    const colours = () => cell.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }))
    const down = await colours()
    expect(down.bg).toBe('rgb(60, 60, 60)')
    expect(contrast(down.fg, down.bg)).toBeGreaterThanOrEqual(4.5)
    await cell.evaluate((el) => el.classList.replace('down', 'muted'))
    const muted = await colours()
    expect(muted.bg).toBe('rgb(60, 60, 60)')
    expect(contrast(muted.fg, muted.bg)).toBeGreaterThanOrEqual(4.5)
  })

  test('Tab visits every panel once with a 2px white ring; the focused panel carries the blue line', async ({ page }) => {
    await openHome(page)
    await panelBody(page, HOME_TITLES[0] ?? '').focus()
    const visited: string[] = []
    for (let i = 0; i < HOME_TITLES.length; i += 1) {
      if (i > 0) await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        const section = el?.closest('[data-nqt-panel]') as HTMLElement | null
        const s = el ? getComputedStyle(el) : null
        return {
          title: section?.getAttribute('data-nqt-title') ?? null,
          ring: s ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` : '',
          focusVisible: el?.matches(':focus-visible') ?? false,
        }
      })
      expect(info.focusVisible, `panel ${i + 1}`).toBe(true)
      expect(info.ring, `panel ${i + 1}`).toBe(`solid 2px ${WHITE}`)
      visited.push(info.title ?? '')
      // The blue line is an overlay above the red bar, the header and the body (visual review: an
      // outline on the panel was painted over below the title bar).
      const line = await panel(page, info.title ?? '').evaluate((el) => {
        const after = getComputedStyle(el, '::after')
        const r = el.getBoundingClientRect()
        const body = el.querySelector('.nqt-panel-body')?.getBoundingClientRect()
        return { border: `${after.borderLeftWidth} ${after.borderLeftStyle} ${after.borderLeftColor}`, position: after.position, full: after.width === `${r.width}px` && after.height === `${r.height}px`, z: Number(after.zIndex), bodyInside: body ? body.bottom <= r.bottom + 0.5 : false }
      })
      expect(line).toEqual({ border: `1px solid ${CMD_BLUE}`, position: 'absolute', full: true, z: expect.any(Number), bodyInside: true })
      expect(line.z).toBeGreaterThan(1)
    }
    expect(visited).toEqual(HOME_TITLES)
    await expect(page.locator('[data-nqt-panel][data-focused="true"]')).toHaveCount(1)
  })

  test('HELP carries the red function bar: <Search help>, 96) Actions and the title Help (7.12)', async ({ page }) => {
    await openHome(page)
    await commandLine(page).click()
    await commandLine(page).fill('HELP')
    await commandLine(page).press('Enter')
    const help = panel(page, 'HELP')
    await expect(help).toBeVisible()
    const bar = help.locator('.fn-bar')
    await expect(bar).toHaveCount(1)
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(135, 15, 30)')
    await expect(bar.getByRole('textbox', { name: 'Search help' })).toHaveAttribute('placeholder', '<Search help>')
    await expect(bar.getByRole('button', { name: /96\) Actions/ })).toBeVisible()
    await expect(bar.locator('.fn-title')).toHaveText('Help')
    const fieldEdge = await bar.locator('.fn-field').evaluate((el) => {
      const s = getComputedStyle(el)
      return `${s.borderRightWidth} ${s.borderRightStyle} ${s.borderRightColor}`
    })
    expect(fieldEdge).toBe('2px solid rgb(0, 0, 0)')
    const barBox = await bar.boundingBox()
    const titleBox = await help.locator('.ptitle').boundingBox()
    expect(Math.round((barBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0)))).toBe(0)
    await bar.getByRole('textbox', { name: 'Search help' }).fill('drawdown')
    await bar.getByRole('textbox', { name: 'Search help' }).press('Enter')
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(page.getByRole('listbox')).toContainText('DD')
  })

  test('a title-bar tooltip appears after the pointer rests and Escape dismisses it (1.4.13)', async ({ page }) => {
    await openHome(page)
    const max = panel(page, 'REG').getByRole('button', { name: 'Maximise panel' })
    await max.hover()
    await page.mouse.move(((await max.boundingBox())?.x ?? 0) + 6, ((await max.boundingBox())?.y ?? 0) + 6)
    const tip = page.getByRole('tooltip')
    await expect(tip).toHaveText('Maximise panel')
    await max.focus()
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)
    await expect(max).toBeFocused()
  })

  test('axe finds no WCAG 2.2 AA violation on HOME or with the red menu or the options menu open', async ({ page }) => {
    await openHome(page)
    await expectAxeClean(page)
    await openActions(page, 'REG')
    await expectAxeClean(page)
    await page.keyboard.press('Escape')
    await panel(page, 'REG').getByRole('button', { name: 'Options' }).click()
    await expect(page.getByRole('menu', { name: /Panel options/ })).toBeVisible()
    await expectAxeClean(page)
  })
})
