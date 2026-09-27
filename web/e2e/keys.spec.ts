// Chrome and keys E2E (spec sections 4.1, 4.2, 5.2 and 8.4): the global frame stack and its heights at
// 1920x1080; the message line; the Esc (CANCEL) cascade; F1 once and twice; F8 to F11 inserting the
// sector keys with the browser kept out; End back; Shift+PgUp history; Alt+n panel focus; NumpadEnter;
// Tab between panels; Number <GO>; the command-line caret states; axe on the chrome with a menu and
// the key map open. Runs against the fixture-mode backend (playwright.config.ts).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })
const workspace = (page: Page) => page.getByRole('main', { name: 'Workspace' })
// The panel title bar reads `1-GP [A] NQ` (spec 4.3); the command a panel shows is its data-nqt-title.
const firstPanelTitle = (page: Page) => workspace(page).locator('[data-nqt-panel]').first()
const message = (page: Page) => page.locator('.msg-line[role="status"]')
const panels = (page: Page) => page.locator('[data-nqt-panel]')

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(panels(page).first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function focusFirstPanel(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Tab')
  await expect(panels(page).first().locator(':focus')).toHaveCount(1)
}

async function runCommand(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Control+k')
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
  await expect(commandLine(page)).toHaveValue('')
}

/** Record whether the page prevented the browser's default for each keydown, after the app ran. */
async function watchKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Array<{ key: string; prevented: boolean }> = []
    Object.defineProperty(window, '__nqtKeys', { value: seen, configurable: true })
    window.addEventListener('keydown', (e) => seen.push({ key: e.key, prevented: e.defaultPrevented }))
  })
}

async function lastKey(page: Page): Promise<{ key: string; prevented: boolean } | undefined> {
  return page.evaluate(() => (window as unknown as { __nqtKeys: Array<{ key: string; prevented: boolean }> }).__nqtKeys.at(-1))
}

async function expectAxeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary).toEqual([])
}

test.describe('frame stack (spec 4.1)', () => {
  test('rows are 37 / 32 / 22 / 50 / workspace / 22 at 1920x1080, top to bottom', async ({ page }) => {
    await openApp(page)
    const box = async (selector: string) => {
      const b = await page.locator(selector).first().boundingBox()
      if (!b) throw new Error(`${selector} has no box`)
      return { y: Math.round(b.y), h: Math.round(b.height) }
    }
    const rows = {
      frame: await box('[data-chrome="frame"]'),
      keys: await box('[data-chrome="keys"]'),
      nav: await box('[data-chrome="nav"]'),
      zone: await box('[data-chrome="zone"]'),
      workspace: await box('main.nqt-workspace'),
      status: await box('[data-chrome="status"]'),
      cmdBox: await box('.cmd-box'),
    }
    test.info().annotations.push({ type: 'chrome-rows', description: JSON.stringify(rows) })
    expect(rows.frame).toEqual({ y: 0, h: 37 })
    expect(rows.keys).toEqual({ y: 37, h: 32 })
    expect(rows.nav).toEqual({ y: 69, h: 22 })
    expect(rows.zone).toEqual({ y: 91, h: 50 })
    expect(rows.workspace).toEqual({ y: 141, h: 917 })
    expect(rows.status).toEqual({ y: 1058, h: 22 })
    expect(rows.cmdBox).toMatchObject({ y: 97, h: 22 })
  })

  test('the event tape takes 57px above the status line when switched on', async ({ page }) => {
    await openApp(page)
    await runCommand(page, 'NO')
    const tape = page.getByRole('complementary', { name: 'Event tape' })
    await expect(tape).toBeVisible()
    const b = await tape.boundingBox()
    expect(Math.round(b?.height ?? 0)).toBe(57)
    expect(Math.round(b?.y ?? 0)).toBe(1058 - 57)
    await runCommand(page, 'NO')
    await expect(tape).toHaveCount(0)
  })

  test('the message line is a polite live region and replaces toasts', async ({ page }) => {
    await openApp(page)
    await expect(message(page)).toHaveAttribute('aria-live', 'polite')
    await runCommand(page, 'REG')
    await expect(message(page)).toHaveText('Opened REG.')
  })
})

test.describe('keys (spec 5.2 and 8.4)', () => {
  test('Esc cascade: close the list, clear the line, return to the panel; Esc from a panel focuses the line', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.type('re')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(commandLine(page)).toHaveValue('RE')
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(panels(page).first().locator(':focus')).toHaveCount(1)
  })

  test('F1 once opens the focused screen help; twice opens the HELP index', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    await watchKeys(page)
    await page.keyboard.press('F1')
    expect(await lastKey(page)).toEqual({ key: 'F1', prevented: true })
    await expect(page.getByRole('listbox', { name: /^GP/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('F1')
    await page.keyboard.press('F1')
    await expect(page.getByRole('contentinfo')).toContainText('Screen HELP')
    expect(page.context().pages()).toHaveLength(1)
  })

  for (const [key, suffix] of [['F8', ' Equity'], ['F9', ' Comdty'], ['F10', ' Index'], ['F11', ' Curncy']] as const) {
    test(`${key} inserts${suffix}, prevented, with no browser action`, async ({ page }) => {
      await openApp(page)
      await watchKeys(page)
      await page.keyboard.press('Control+k')
      await page.keyboard.type('nq1')
      await page.keyboard.press(key)
      expect(await lastKey(page)).toEqual({ key, prevented: true })
      await expect(commandLine(page)).toHaveValue(`NQ1${suffix}`)
      await expect(commandLine(page)).toBeFocused()
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
      if (key === 'F8') await expect(message(page)).toHaveText('No equities in nq-lab: Equity is accepted but matches nothing.')
    })
  }

  test('NQ COMDTY names F10 in the message line', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    await commandLine(page).fill('NQ COMDTY')
    await commandLine(page).press('Enter')
    await expect(message(page)).toHaveText('NQ is an Index future: use INDEX (F10).')
  })

  test('End with an empty line goes back in the focused panel', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    const before = await firstPanelTitle(page).getAttribute('data-nqt-title')
    await runCommand(page, 'ES GP')
    await expect(firstPanelTitle(page)).toHaveAttribute('data-nqt-title', 'ES GP')
    await page.keyboard.press('End')
    await expect(firstPanelTitle(page)).toHaveAttribute('data-nqt-title', before ?? '')
  })

  test('Shift+PgUp walks the command history', async ({ page }) => {
    await openApp(page)
    await runCommand(page, 'REG')
    await runCommand(page, 'HELP')
    await page.keyboard.press('Shift+PageUp')
    await expect(commandLine(page)).toHaveValue('HELP')
    await page.keyboard.press('Shift+PageUp')
    await expect(commandLine(page)).toHaveValue('REG')
    await page.keyboard.press('Shift+PageDown')
    await expect(commandLine(page)).toHaveValue('HELP')
  })

  test('Alt+1 to Alt+4 focus panels 1 to 4 and the command zone shows the number', async ({ page }) => {
    await openApp(page)
    const count = Math.min(4, await panels(page).count())
    for (let n = 1; n <= count; n += 1) {
      await page.keyboard.press(`Alt+Digit${n}`)
      await expect(panels(page).nth(n - 1).locator(':focus')).toHaveCount(1)
      await expect(page.locator('.ctx-panel')).toHaveText(String(n))
    }
  })

  test('the nav toolbar and the command zone name the panel the command line addresses, before any focus', async ({ page }) => {
    await openApp(page)
    const nav = page.locator('[data-chrome="nav"]')
    await expect(page.locator('.ctx-panel')).toHaveText('1')
    await expect(nav).toContainText('NQ1 Index')
    await expect(nav).toContainText('GP')
    await expect(page.locator('[data-nqt-panel][data-focused="true"]')).toHaveCount(1)
    await runCommand(page, 'NQ GP')
    await expect(nav).toContainText('NQ1 Index')
    await expect(nav).toContainText('GP')
    await expect(page.locator('.ctx-panel')).toHaveText('1')
    await runCommand(page, 'REG')
    await expect(nav).toContainText('REG')
    await expect(page.locator('.ctx-panel')).toHaveText('1')
  })

  test('NumpadEnter runs the line', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    await commandLine(page).fill('REG')
    await page.keyboard.press('NumpadEnter')
    await expect(page.getByRole('contentinfo')).toContainText('Screen REG')
  })

  test('Tab still moves from the command line to the panels, one stop each', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    const count = await panels(page).count()
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press('Tab')
      await expect(panels(page).nth(i).locator(':focus')).toHaveCount(1)
    }
  })

  test('Number <GO>: 42 says there is no such item on this screen', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    await runCommand(page, '42')
    await expect(message(page)).toHaveText('No item 42 on this screen.')
  })

  test('a context on its own opens its numbered function menu; 1 <GO> runs the first', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    await page.keyboard.press('Control+k')
    await commandLine(page).fill('NQ1 INDEX')
    await commandLine(page).press('Enter')
    const menu = page.getByRole('listbox', { name: 'NQ1 Index' })
    await expect(menu).toBeVisible()
    await commandLine(page).fill('1')
    await commandLine(page).press('Enter')
    await expect(firstPanelTitle(page)).toHaveAttribute('data-nqt-title', 'NQ GP')
  })
})

test.describe('command-line caret (spec 4.2 and 8.4)', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('blinks with --caret-phase while focused and is hidden when the line loses focus', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    const style = await page.locator('.cmd-cursor').evaluate((el) => {
      const s = getComputedStyle(el)
      const phase = getComputedStyle(document.documentElement).getPropertyValue('--caret-phase').trim()
      return { name: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction, display: s.display, phase }
    })
    // The token may compute as 1000ms or 1s (a registered <time> property); compare in seconds.
    const phase = /^([\d.]+)(ms|s)$/.exec(style.phase)
    expect(phase).not.toBeNull()
    const seconds = Number(phase?.[1]) / (phase?.[2] === 'ms' ? 1000 : 1)
    expect(style.name).toBe('caret')
    expect(style.duration).toBe(`${2 * seconds}s`)
    expect(style.timing).toMatch(/^steps\(1(, end)?\)$/)
    expect(style.display).not.toBe('none')
    expect(await page.locator('#cmd').evaluate((el) => getComputedStyle(el).caretColor)).toBe('rgba(0, 0, 0, 0)')
    await focusFirstPanel(page)
    await expect(page.locator('.cmd-cursor')).toBeHidden()
  })
})

test.describe('command-line caret under reduced motion', () => {
  test('stays steady in the bright colour', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    const style = await page.locator('.cmd-cursor').evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--cmd-cursor)'
      document.body.append(probe)
      const bright = getComputedStyle(probe).color
      probe.remove()
      const s = getComputedStyle(el)
      return { name: s.animationName, background: s.backgroundColor, bright }
    })
    expect(style.name).toBe('none')
    expect(style.background).toBe(style.bright)
  })
})

test.describe('chrome accessibility', () => {
  test('axe finds no WCAG 2.2 AA violation with a menu open, the options open and the key map open', async ({ page }) => {
    await openApp(page)
    await expectAxeClean(page)
    await page.keyboard.press('Control+k')
    await commandLine(page).fill('INDEX')
    await commandLine(page).press('Enter')
    await expect(page.getByRole('listbox', { name: 'Index' })).toBeVisible()
    await expectAxeClean(page)
    await page.keyboard.press('Escape')
    await page.locator('[data-chrome="frame"]').getByRole('button', { name: 'Options' }).click()
    await expectAxeClean(page)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Alt+KeyK')
    const map = page.getByRole('dialog', { name: 'Keyboard map' })
    await expect(map).toBeVisible()
    await expectAxeClean(page)
    await page.keyboard.press('Alt+KeyK')
    await expect(map).toHaveCount(0)
  })

  test('every key toolbar button is at least 24px tall and names its key', async ({ page }) => {
    await openApp(page)
    const buttons = page.locator('[data-chrome="keys"] button')
    const count = await buttons.count()
    expect(count).toBe(13)
    for (let i = 0; i < count; i += 1) {
      const b = await buttons.nth(i).boundingBox()
      expect(Math.round(b?.height ?? 0)).toBeGreaterThanOrEqual(24)
      expect(await buttons.nth(i).getAttribute('aria-label')).toBeTruthy()
    }
  })
})
