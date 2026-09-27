// F-keys and the colour-vision schemes (TASKS 9.3; look spec 2.3, 5.2 and 8.4; PRD DL16 and DL17).
// F2 and F4 have no terminal action (spec 5.2 drops the old F-key plan) but are held back from the
// browser; F8 and F9 insert the Equity and Comdty sector words. For each key, pressed from a panel and
// from the command line, the page prevents the default and the browser does nothing: same URL, one
// page, no full screen, no dialog, focus still in the page. The Options scheme switch sets data-cvd,
// swaps the tokens to the CVD values, says so in the message line, survives a reload and stays axe clean.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })
const panels = (page: Page) => page.locator('[data-nqt-panel]')
const message = (page: Page) => page.locator('.msg-line[role="status"]')

interface KeySeen {
  readonly key: string
  readonly prevented: boolean
}

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); void d.dismiss() })
  await page.goto('/')
  await expect(panels(page).first()).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
  // Record, after the app's own handlers, whether each keydown's default was prevented.
  await page.evaluate(() => {
    const seen: KeySeen[] = []
    Object.defineProperty(window, '__nqtKeys', { value: seen, configurable: true })
    window.addEventListener('keydown', (e) => seen.push({ key: e.key, prevented: e.defaultPrevented }))
  })
  return errors
}

async function lastKey(page: Page): Promise<KeySeen | undefined> {
  return page.evaluate(() => (window as unknown as { __nqtKeys: KeySeen[] }).__nqtKeys.at(-1))
}

async function focusFirstPanel(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Tab')
  await expect(panels(page).first().locator(':focus')).toHaveCount(1)
}

/** Nothing the browser does on its own happened: same URL, one page, no full screen, focus in the page. */
async function expectNoBrowserAction(page: Page, url: string): Promise<void> {
  expect(page.url()).toBe(url)
  expect(page.context().pages()).toHaveLength(1)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  expect(await page.evaluate(() => document.hasFocus() && document.activeElement !== document.body)).toBe(true)
}

const UNBOUND = [
  ['F2', 'F2 has no function in nq-lab. Type REG <GO> for the registry, or use a key on the key toolbar.'],
  ['F4', 'F4 has no function in nq-lab. Type LEDG <GO> for the ledger, or use a key on the key toolbar.'],
] as const

test.describe('F2 and F4 (spec 5.2: no action, held from the browser)', () => {
  for (const [key, text] of UNBOUND) {
    test(`${key} from a panel is prevented, keeps focus and says what to type`, async ({ page }) => {
      const errors = await openApp(page)
      await focusFirstPanel(page)
      const url = page.url()
      const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))
      await page.keyboard.press(key)
      expect(await lastKey(page)).toEqual({ key, prevented: true })
      await expect(message(page)).toHaveText(text)
      expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))).toBe(before)
      await expectNoBrowserAction(page, url)
      expect(errors).toEqual([])
    })

    test(`${key} in the command line is prevented and leaves the typed line alone`, async ({ page }) => {
      await openApp(page)
      await page.keyboard.press('Control+k')
      await page.keyboard.type('nq1 gp')
      const url = page.url()
      await page.keyboard.press(key)
      expect(await lastKey(page)).toEqual({ key, prevented: true })
      await expect(commandLine(page)).toHaveValue('NQ1 GP')
      await expect(commandLine(page)).toBeFocused()
      await expectNoBrowserAction(page, url)
    })
  }

  test('Alt+F4 is left to the system and the browser (not prevented)', async ({ page }) => {
    await openApp(page)
    await focusFirstPanel(page)
    // Dispatched, not pressed: a real Alt+F4 would close the test browser window.
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: 'F4', code: 'F4', altKey: true, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(prevented).toBe(false)
  })
})

test.describe('F8 and F9 from a panel (spec 5.2)', () => {
  for (const [key, suffix] of [['F8', ' Equity'], ['F9', ' Comdty']] as const) {
    test(`${key} from a panel is prevented and puts${suffix} in the command line`, async ({ page }) => {
      const errors = await openApp(page)
      await focusFirstPanel(page)
      const url = page.url()
      await page.keyboard.press(key)
      expect(await lastKey(page)).toEqual({ key, prevented: true })
      await expect(commandLine(page)).toHaveValue(suffix.trim())
      await expectNoBrowserAction(page, url)
      expect(errors).toEqual([])
    })
  }
})

async function chooseScheme(page: Page, name: string): Promise<void> {
  const frame = page.locator('[data-chrome="frame"]')
  await frame.getByRole('button', { name: 'Options' }).click()
  await frame.getByRole('group', { name: 'Colour scheme' }).getByRole('button', { name }).click()
}

/** A colour token as the page resolves it, as #RRGGBB (Chrome may shorten a custom property's text). */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${n})`
    document.body.append(probe)
    const rgb = getComputedStyle(probe).color.match(/\d+/g) ?? []
    probe.remove()
    return `#${rgb.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }, name)

test.describe('colour-vision schemes (spec 2.3)', () => {
  test('Deuteranopia and Protanomaly swap the tokens, say so, survive a reload and stay axe clean', async ({ page }) => {
    const errors = await openApp(page)
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-cvd'))).toBeNull()
    expect(await token(page, '--c-up')).toBe('#51EE6C')

    await chooseScheme(page, 'Deuteranopia colours')
    await expect(page.locator('html')).toHaveAttribute('data-cvd', 'deut')
    await expect(message(page)).toHaveText('New theme applied. Rerun the screen to see the changes.')
    expect(await token(page, '--c-up')).toBe('#3399FF')
    expect(await token(page, '--c-down')).toBe('#FF5566')
    expect(await token(page, '--data')).toBe('#FFA028')
    await page.keyboard.press('Escape')
    const deut = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
    expect(deut.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])

    await page.reload()
    await expect(panels(page).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-cvd', 'deut')

    await chooseScheme(page, 'Protanomaly colours')
    await expect(page.locator('html')).toHaveAttribute('data-cvd', 'prot')
    expect(await token(page, '--c-up')).toBe('#3399FF')
    expect(await token(page, '--c-down')).toBe('#FF7329')
    expect(await token(page, '--data')).toBe('#FEBA11')
    expect(await token(page, '--field-bg')).toBe('#FEBA11')
    await page.keyboard.press('Escape')
    const prot = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
    expect(prot.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])

    await chooseScheme(page, 'Standard colours')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-cvd'))).toBeNull()
    expect(await token(page, '--c-up')).toBe('#51EE6C')
    expect(errors).toEqual([])
  })
})
