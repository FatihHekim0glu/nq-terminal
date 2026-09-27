// Shell E2E (TASKS 4.4, updated for the look spec): the app loads; Esc and Ctrl+K focus the command
// line; Tab visits every panel with a visible focus ring; every HELP mnemonic resolves (unbuilt screens
// show a labelled placeholder, the P0 screens show themselves); axe is clean with the WCAG 2.2 AA tags;
// every request is a same-origin GET carrying the client header; no console errors and no CSP violations under the backend's policy;
// layouts reflow at 400% zoom; screenshot baselines at 1920x1080 and 1366x768 with a frozen clock.
// Runs against the fixture-mode backend.
//
// Changes for the look spec (section 12, "After the merge"), each with its reason:
// - HOME has four panels in a 2x2 grid (7.1), not six: LIVE and OOS open with Shift+Enter.
// - A panel is found by its data-nqt-title (the command it shows). The h2 now reads `1-GP [A] NQ1 Index`
//   (4.3), so the heading text is no longer the command.
// - The status line reads `Screen HOME`, `TWS not monitored` and `KILL off` (4.10), not `SCR 00 HOME`,
//   `TWS: not monitored` and `KILL: off`; instruments show with their sector (`NQ1 Index`, 5.1 item 2).
// - Errors go to the message line, a polite status region with data-tone="error" (4.2), not an alert
//   in the banner.
// - The HELP index caption is 'Mnemonic index, numbered for <GO>' (7.12): numbers serve Number <GO>.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const CLIENT_HEADER = 'x-nqt-client'
// 14:02:11 ET, the status-line time in the look spec 4.10. Fixed so the baselines show the real clock.
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
// Every P0 screen is built after Phases 6 and 7 (src/chrome/WorkspaceScreens.tsx BUILT_SCREENS).
const BUILT: ReadonlySet<string> = new Set([
  'HOME', 'GP', 'GIP', 'MON', 'CORR', 'OOS', 'LIVE', 'JRNL', 'DES', 'REG', 'MT', 'RUNS', 'RUN', 'LEDG',
  'EQ', 'DD', 'RET', 'RR', 'MRET', 'HELP',
])
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
const panelTitles = (page: Page) => page.getByRole('main', { name: 'Workspace' }).locator('[data-nqt-title]')
const panelBody = (page: Page, title: string) => page.getByRole('group', { name: `${title} content`, exact: true })
const message = (page: Page) => page.locator('.msg-line[role="status"]')

async function expectTitles(page: Page, titles: readonly string[], note?: string): Promise<void> {
  await expect(panelTitles(page), note).toHaveCount(titles.length)
  expect(await panelTitles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-nqt-title'))), note).toEqual([...titles])
}

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
  await expect(panelTitles(page)).toHaveCount(HOME_TITLES.length)
  await expect(page.getByRole('contentinfo')).toContainText('KILL off')
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
  test('loads HOME with its four panels, the safety labels and fixture health', async ({ page, baseURL }) => {
    const watched = watch(page)
    await openApp(page)
    await expectTitles(page, HOME_TITLES)
    const status = page.getByRole('contentinfo')
    await expect(status).toContainText('Screen HOME')
    await expect(status).toContainText('READ ONLY')
    await expect(status).toContainText('NO ORDER PATH')
    await expect(status).toContainText('TWS not monitored')
    await expect(status).toContainText('FIXTURE DATA')
    // The safety chips also sit in the frame strip, always in view (4.2).
    const safety = page.getByRole('group', { name: 'Safety' })
    await expect(safety).toContainText('READ ONLY')
    await expect(safety).toContainText('NO ORDER PATH')
    // The link groups are seeded from the layout, so the strip names what the panels show.
    await expect(page.getByRole('group', { name: 'Link groups' })).toContainText('NQ1 Index')
    await expect(status).toContainText('A NQ1 Index')
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
          title: panel?.getAttribute('data-nqt-title') ?? null,
          focusVisible: el?.matches(':focus-visible') ?? false,
          outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
        }
      })
      expect(info.title, `Tab ${i + 1}`).not.toBeNull()
      expect(info.focusVisible).toBe(true)
      expect(info.outline).toBe('solid 2px')
      visited.push(info.title ?? '')
    }
    expect(visited).toEqual(HOME_TITLES)

    await page.keyboard.press('Shift+Tab')
    await expect(panelBody(page, 'volmanaged_v0 EQ')).toBeFocused()
  })

  test('a contextless command uses the focused panel as it is after the last command', async ({ page }) => {
    await openApp(page)
    await panelBody(page, 'NQ GP 1d').focus()
    await runCommand(page, 'ES GP')
    await expect(panelTitles(page).first()).toHaveAttribute('data-nqt-title', 'ES GP')
    await runCommand(page, 'GIP 2019-03-14')
    await expect(panelTitles(page).first()).toHaveAttribute('data-nqt-title', 'ES GIP 2019-03-14')
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
    const index = page.getByRole('table', { name: 'Mnemonic index, numbered for <GO>' })
    await expect(index).toBeVisible()
    const rows = await index.locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => cell.textContent ?? '')),
    )
    expect(rows.length).toBeGreaterThanOrEqual(30)

    for (const [number, code, , rule] of rows) {
      expect(number).toMatch(/^\d+\)$/)
      const context = CONTEXT_FOR_RULE[rule ?? ''] ?? ''
      const argument = ARGUMENT_FOR[code ?? ''] ?? ''
      const line = [context, code, argument].filter(Boolean).join(' ')
      await runCommand(page, line)
      await expect(message(page), line).not.toHaveAttribute('data-tone', 'error')
      await expect(page.getByRole('contentinfo')).toContainText(`Screen ${code}`)
      const expected = MULTI_PANEL_SCREENS[code ?? '']
      if (expected) {
        await expectTitles(page, expected, line)
        continue
      }
      const panel = panelBody(page, line)
      await expect(panel, line).toBeVisible()
      if (code === 'HELP') await expect(panel.getByRole('table').first()).toBeVisible()
      else if (BUILT.has(code ?? '')) {
        // Phases 6 and 7 built every P0 screen: the panel shows the screen, never the placeholder.
        await expect(panel.locator('[data-placeholder]'), line).toHaveCount(0)
        await expect(panel.locator('p.ws-empty'), line).toHaveCount(0, { timeout: 15_000 })
      } else await expect(panel.locator(`[data-placeholder="${code}"]`), line).toContainText('Not built yet.')
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
    await expect(message(page)).toHaveAttribute('data-tone', 'error')
    await expect(message(page)).toContainText('XYZ')
    await expectAxeClean(page)
    await runCommand(page, 'HELP')
    await expect(page.getByRole('table', { name: 'Keyboard reference' })).toBeVisible()
    await expectAxeClean(page)
  })

  // Strengthened after the accessibility review: the page showing no sideways scroll was not enough,
  // because the workspace kept a 640px floor and scrolled sideways inside itself. Now the panels must
  // stack at full width, nothing in their chrome may overflow, and vertical scrolling alone reaches each.
  test('reflows at 400% zoom (320 CSS px): panels stack full width and vertical scrolling reaches each (1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 })
    await openApp(page)
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }))
    expect(widths.page).toBeLessThanOrEqual(widths.view)
    await expect(page.getByRole('group', { name: 'Safety' })).toBeInViewport()
    const layout = await page.evaluate(() => {
      const ws = document.querySelector('main.nqt-workspace') as HTMLElement
      const panels = Array.from(document.querySelectorAll('[data-nqt-panel]')).map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }
      })
      const sel = '[data-nqt-panel] .fn-bar, [data-nqt-panel] [role="tablist"], [data-nqt-panel] .ptitle, [data-nqt-panel] .ws-placeholder td'
      const clipped = Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.className || el.tagName}: ${el.textContent?.slice(0, 30)}`)
      return { inner: ws.scrollWidth - ws.clientWidth, panels, clipped, view: window.innerWidth }
    })
    expect(layout.inner).toBeLessThanOrEqual(0)
    expect(layout.clipped).toEqual([])
    expect(layout.panels).toHaveLength(HOME_TITLES.length)
    layout.panels.forEach((box, i) => {
      expect(box.left, `panel ${i + 1}`).toBeGreaterThanOrEqual(0)
      expect(box.right, `panel ${i + 1}`).toBeLessThanOrEqual(layout.view)
      expect(box.right - box.left, `panel ${i + 1}`).toBeGreaterThan(layout.view - 2)
      expect(box.height, `panel ${i + 1}`).toBeGreaterThan(200)
      if (i > 0) expect(box.top, `panel ${i + 1}`).toBeGreaterThanOrEqual(layout.panels[i - 1]?.bottom ?? 0)
    })
    for (const title of HOME_TITLES) {
      const target = page.locator(`[data-nqt-title="${title}"]`)
      await target.scrollIntoViewIfNeeded()
      await expect(target).toBeInViewport()
      expect(await page.evaluate(() => window.scrollX)).toBe(0)
    }
    await expectAxeClean(page)
  })

  test('the status line is set at 13px with the clock and <Esc> hint at 11px; every safety segment stays whole at 1366x768', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openApp(page)
    const status = await page.getByRole('contentinfo').evaluate((bar) => {
      const r = bar.getBoundingClientRect()
      const size = (sel: string) => getComputedStyle(bar.querySelector(sel) as Element).fontSize
      const cut = Array.from(bar.querySelectorAll<HTMLElement>('.seg.keep')).filter((el) => {
        const b = el.getBoundingClientRect()
        return b.right > r.right + 0.5 || b.left < r.left - 0.5 || el.scrollWidth > el.clientWidth + 1
      })
      return { label: size('.status-label'), seg: size('.seg b'), time: size('time'), cut: cut.map((el) => el.textContent) }
    })
    expect(status).toEqual({ label: '13px', seg: '13px', time: '11px', cut: [] })
  })

  test('keeps chrome and panel text whole under the 1.4.12 text-spacing overrides', async ({ page }) => {
    await openApp(page)
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' })
    const sel = '.ptitle-name, .fn-btn, .fn-title, .nqt-grid td, .nqt-grid th, .nqt-status .seg.keep, .msg-line, .key-btn, .nav-btn, .tab'
    const cut = await page.evaluate((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.getClientRects().length > 0 && el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${el.className}: ${el.textContent?.slice(0, 20)} ${el.scrollHeight}/${el.clientHeight}`), sel)
    expect(cut).toEqual([])
    const safety = await page.getByRole('contentinfo').evaluate((bar) => {
      const r = bar.getBoundingClientRect()
      return Array.from(bar.querySelectorAll<HTMLElement>('.seg.keep')).filter((el) => el.getBoundingClientRect().right > r.right + 0.5).map((el) => el.textContent)
    })
    expect(safety).toEqual([])
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

  // The fixture backend counts gate reads over the whole E2E run, so the status line's `Gate reads N`
  // (and the flags after it, which it moves), the GP footer's reads and the market gate line depend on
  // the specs run before this one. They are masked; every other pixel is compared. A mask is drawn over
  // an element's whole box, so a footer scrolled out of its panel (1366x768) is left unmasked: it is not
  // painted, and a mask there would cover the panel below it.
  const runCounters = async (page: Page) => {
    const status = page.getByRole('contentinfo')
    const painted = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      const body = el.closest('.nqt-panel-body')?.getBoundingClientRect()
      return body === undefined || (r.top < body.bottom && r.bottom > body.top)
    }))
    const masks = [status.locator('.seg').filter({ hasText: 'Gate reads' }), status.locator('.seg.flag')]
    for (const sel of ['.gp-footer', '.mkt-gate']) {
      const shown = await painted(sel)
      shown.forEach((on, i) => (on ? masks.push(page.locator(sel).nth(i)) : undefined))
    }
    return masks
  }

  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    test(`screenshot baselines at ${size.width}x${size.height}`, async ({ page }) => {
      await page.clock.setFixedTime(FROZEN_NOW)
      await page.setViewportSize(size)
      await openApp(page)
      await expect(page.getByRole('contentinfo').locator('time')).toHaveText('14:02:11 ET')
      // The HOME screens load lazily; on a slow machine a panel can still read "Loading this screen."
      // (a stable frame) when the screenshot is taken, so wait for every screen and chart to settle.
      await expect(page.getByText('Loading this screen.')).toHaveCount(0)
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      // MON's 2Day cells ask for their bars only once their row is in view (an observer callback a frame
      // after the rows mount), so a busy check alone can pass before they start: wait until every cell
      // in view has drawn its line (the fixture serves 1m bars for every universe symbol).
      await expect.poll(() => page.locator('.mon-spark').evaluateAll((cells) => cells.filter((cell) => {
        const r = cell.getBoundingClientRect()
        const body = cell.closest('.nqt-panel-body')?.getBoundingClientRect()
        return body !== undefined && r.bottom > body.top && r.top < body.bottom && cell.querySelector('svg') === null
      }).length)).toBe(0)
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(page).toHaveScreenshot(`home-${size.width}x${size.height}.png`, { mask: await runCounters(page) })
      await runCommand(page, 'HELP')
      await expect(page.getByRole('table', { name: 'Keyboard reference' })).toBeVisible()
      await expect(page).toHaveScreenshot(`help-${size.width}x${size.height}.png`, { mask: await runCounters(page) })
    })
  }
})
