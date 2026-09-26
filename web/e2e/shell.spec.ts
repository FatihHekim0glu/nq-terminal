// Shell E2E (TASKS 4.4): the app loads; Esc and Ctrl+K focus the command line; Tab visits every panel
// with a visible focus ring; every HELP mnemonic resolves (unbuilt screens show a labelled
// placeholder); axe is clean with the WCAG 2.2 AA tags; every request is a same-origin GET carrying
// the client header; no console errors and no CSP violations under the backend's policy; layouts
// reflow at 400% zoom; screenshot baselines at 1920x1080 and 1366x768 with a frozen clock.
// Runs against the fixture-mode backend.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG', 'LIVE', 'OOS']
const CLIENT_HEADER = 'x-nqt-client'
// 14:02:11 ET, the status-bar time in UI_SPEC section 2. Fixed so the baselines show the real clock.
const FROZEN_NOW = new Date('2026-09-25T18:02:11Z')

// A context from the fixture index (GET /api/commands) for each registry context rule.
const CONTEXT_FOR_RULE: Readonly<Record<string, string>> = {
  none: '',
  instrument: 'NQ',
  hypothesis: 'volmanaged_v0',
  run: 'nt_volmanaged_v0_fixture_m1',
  universe: '27F',
  'hypothesis or instrument': 'volmanaged_v0',
  'run or hypothesis': 'nt_volmanaged_v0_fixture_m1',
}
const ARGUMENT_FOR: Readonly<Record<string, string>> = { GIP: '2019-03-14' }
const MULTI_PANEL_SCREENS: Readonly<Record<string, readonly string[]>> = {
  HOME: HOME_TITLES,
  REG: ['REG', 'MT'],
  LIVE: ['LIVE', 'JRNL'],
}

interface Watch {
  readonly requests: Request[]
  readonly errors: string[]
}

function watch(page: Page): Watch {
  const requests: Request[] = []
  const errors: string[] = []
  page.on('request', (r) => requests.push(r))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { requests, errors }
}

const commandLine = (page: Page) => page.getByRole('combobox', { name: 'Command line' })
const workspace = (page: Page) => page.getByRole('main', { name: 'Workspace' })
const panelHeadings = (page: Page) => workspace(page).getByRole('heading', { level: 2 })
const panelBody = (page: Page, title: string) => page.getByRole('group', { name: `${title} content`, exact: true })

test.beforeEach(async ({ page }) => {
  // Every CSP violation the page reports, read back by expectNoCspViolations.
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.defineProperty(window, '__nqtCsp', { value: seen })
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
})

async function expectNoCspViolations(page: Page): Promise<void> {
  const seen = await page.evaluate(() => (window as unknown as { __nqtCsp: string[] }).__nqtCsp)
  expect(seen).toEqual([])
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(panelHeadings(page)).toHaveCount(HOME_TITLES.length)
  await expect(page.getByRole('contentinfo')).toContainText('KILL: off')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function runCommand(page: Page, line: string): Promise<void> {
  const input = commandLine(page)
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  await input.fill(line)
  await input.press('Enter')
  await expect(input).toHaveValue('')
}

async function expectSameOriginGets(watched: Watch, baseURL: string): Promise<void> {
  expect(watched.requests.length).toBeGreaterThan(0)
  const origin = new URL(baseURL).origin
  for (const r of watched.requests) {
    expect(r.method(), r.url()).toBe('GET')
    expect(new URL(r.url()).origin, r.url()).toBe(origin)
  }
  const api = watched.requests.filter((r) => new URL(r.url()).pathname.startsWith('/api/'))
  expect(api.length).toBeGreaterThan(0)
  for (const r of api) expect(await r.headerValue(CLIENT_HEADER), r.url()).toBe('nq-lab-terminal')
}

async function expectAxeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary).toEqual([])
}

test.describe('terminal shell', () => {
  test('loads HOME with its six panels, the safety labels and fixture health', async ({ page, baseURL }) => {
    const watched = watch(page)
    await openApp(page)
    await expect(panelHeadings(page)).toHaveText(HOME_TITLES)
    const status = page.getByRole('contentinfo')
    await expect(status).toContainText('SCR 00 HOME')
    await expect(status).toContainText('READ ONLY')
    await expect(status).toContainText('NO ORDER PATH')
    await expect(status).toContainText('TWS: not monitored')
    await expect(status).toContainText('FIXTURE DATA')
    // The link groups are seeded from the layout, so the strip names what the panels show.
    await expect(page.getByRole('group', { name: 'Link groups' })).toContainText('[A]NQ')
    await expect(status).toContainText('A NQ')
    await expect(status).toContainText('B volmanaged_v0')
    await expectSameOriginGets(watched, baseURL ?? '')
    expect(watched.errors).toEqual([])
    await expectNoCspViolations(page)
  })

  test('Esc and Ctrl+K focus the command line; a second Esc returns to the panel', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toBeFocused()
    // Nothing focused yet: the second Esc lands on the first panel, never on the page body.
    await page.keyboard.press('Escape')
    await expect(panelBody(page, 'NQ GP 1d')).toBeFocused()

    await page.keyboard.press('Control+k')
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.press('Tab')
    const firstBody = panelBody(page, 'NQ GP 1d')
    await expect(firstBody).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(commandLine(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(firstBody).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(commandLine(page)).toBeFocused()
  })

  test('Tab visits every panel once, in reading order, with a visible focus ring', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+k')
    const visited: string[] = []
    for (let i = 0; i < HOME_TITLES.length; i += 1) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        const panel = el?.closest('[data-nqt-panel]')
        const style = el ? getComputedStyle(el) : null
        return {
          title: panel?.querySelector('h2')?.textContent ?? null,
          focusVisible: el?.matches(':focus-visible') ?? false,
          outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
        }
      })
      expect(info.title, `Tab ${i + 1}`).not.toBeNull()
      expect(info.focusVisible).toBe(true)
      expect(info.outline).toBe('solid 2px')
      visited.push(info.title ?? '')
    }
    expect(visited).toEqual(['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG', 'LIVE', 'OOS'])

    await page.keyboard.press('Shift+Tab')
    await expect(panelBody(page, 'LIVE')).toBeFocused()
  })

  test('a contextless command uses the focused panel as it is after the last command', async ({ page }) => {
    await openApp(page)
    await panelBody(page, 'NQ GP 1d').focus()
    await runCommand(page, 'ES GP')
    await expect(panelHeadings(page).first()).toHaveText('ES GP')
    await runCommand(page, 'GIP 2019-03-14')
    await expect(panelHeadings(page).first()).toHaveText('ES GIP 2019-03-14')
  })

  test('panel sashes do not drag: layouts are fixed (2.1.1, 2.5.7)', async ({ page }) => {
    await openApp(page)
    const events = await page.locator('.dv-sash').evaluateAll((sashes) => sashes.map((s) => getComputedStyle(s).pointerEvents))
    expect(events.length).toBeGreaterThan(0)
    expect(new Set(events)).toEqual(new Set(['none']))
  })

  test('every HELP mnemonic resolves to a screen or a labelled placeholder', async ({ page, baseURL }) => {
    const watched = watch(page)
    await openApp(page)
    await runCommand(page, 'HELP')
    const index = page.getByRole('table', { name: 'Mnemonic index, numbered as on the status bar' })
    await expect(index).toBeVisible()
    const rows = await index.locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => cell.textContent ?? '')),
    )
    expect(rows.length).toBeGreaterThanOrEqual(30)

    for (const [number, code, , rule] of rows) {
      const context = CONTEXT_FOR_RULE[rule ?? ''] ?? ''
      const argument = ARGUMENT_FOR[code ?? ''] ?? ''
      const line = [context, code, argument].filter(Boolean).join(' ')
      await runCommand(page, line)
      await expect(page.getByRole('banner').getByRole('alert'), line).toHaveCount(0)
      await expect(page.getByRole('contentinfo')).toContainText(`SCR ${number} ${code}`)
      const expected = MULTI_PANEL_SCREENS[code ?? '']
      if (expected) {
        await expect(panelHeadings(page), line).toHaveText([...expected])
        continue
      }
      const panel = panelBody(page, line)
      await expect(panel, line).toBeVisible()
      if (code === 'HELP') await expect(panel.getByRole('table').first()).toBeVisible()
      else await expect(panel.locator(`[data-placeholder="${code}"]`), line).toContainText('Not built yet.')
    }
    await expectSameOriginGets(watched, baseURL ?? '')
    expect(watched.errors).toEqual([])
    await expectNoCspViolations(page)
  })

  test('axe finds no WCAG 2.2 AA violation on HOME, HELP, the open suggestion list or an error', async ({ page }) => {
    await openApp(page)
    await expectAxeClean(page)
    await page.keyboard.press('Control+k')
    await commandLine(page).fill('RE')
    await expect(page.getByRole('listbox')).toBeVisible()
    await expectAxeClean(page)
    await commandLine(page).fill('XYZ')
    await commandLine(page).press('Enter')
    await expect(page.getByRole('banner').getByRole('alert')).toBeVisible()
    await expectAxeClean(page)
    await runCommand(page, 'HELP')
    await expect(page.getByRole('table', { name: 'Keyboard reference' })).toBeVisible()
    await expectAxeClean(page)
  })

  test('reflows at 400% zoom (320 CSS px) with no sideways page scroll (1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 })
    await openApp(page)
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }))
    expect(widths.page).toBeLessThanOrEqual(widths.view)
    await expect(page.getByRole('group', { name: 'Safety' })).toBeInViewport()
  })

  test('HELP prose wraps to its panel at 200% zoom; only tables may scroll (1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 683, height: 384 })
    await openApp(page)
    await runCommand(page, 'HELP')
    await expect(page.getByRole('table', { name: 'Keyboard reference' })).toBeAttached()
    const fit = await page.locator('.help-intro').evaluate((p) => {
      const body = p.closest('.nqt-panel-body') as HTMLElement
      return { prose: p.getBoundingClientRect().width, body: body.clientWidth }
    })
    expect(fit.prose).toBeLessThanOrEqual(fit.body)
  })

  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    test(`screenshot baselines at ${size.width}x${size.height}`, async ({ page }) => {
      await page.clock.setFixedTime(FROZEN_NOW)
      await page.setViewportSize(size)
      await openApp(page)
      await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
      await expect(page).toHaveScreenshot(`home-${size.width}x${size.height}.png`)
      await runCommand(page, 'HELP')
      await expect(page.getByRole('table', { name: 'Keyboard reference' })).toBeVisible()
      await expect(page).toHaveScreenshot(`help-${size.width}x${size.height}.png`)
    })
  }
})
