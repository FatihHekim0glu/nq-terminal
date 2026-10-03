// A 200% zoom step in the app (04 D5.2; WCAG 1.4.4 and 1.4.10; 03 section 15.4). The smoke build's own `--zoom 200` makes the
// WebView2 zoom factor 2, so the page is laid out at half the window's width with the engine's real zoom, which the browser
// specs only imitate with a narrower viewport. This is a second app of its own (hidden, under the same global watch), launched
// by the spec, so the main app of the run stays at 100%.
//
// On HOME, the command line, the REG grid and a chart with its ChartA11y table: nothing scrolls the page sideways, every
// control the 100% page has is still there and reachable (on screen and not cut off by a clipping box), no text is cut off,
// and the chart's table shows whole. In the two smallest windows of the contract (1366x768, 1024x640) every HOME panel, maximised,
// keeps every control reachable with nothing overlapping and nothing but a data table scrolling sideways; the browser survey of
// every panel of every screen in those two windows is e2e/reflow-200.spec.ts, and both judge with e2e/reflow.ts.
import type { Browser, Page } from '@playwright/test'
import { showEveryTable } from '../visual/screens.ts'
import { HOME_READY } from '../perf/pages.ts'
import { attach, expect, test, VIEWPORT } from './fixtures.ts'
import { controlsIn, cutOffIn, missingFrom, overlapsIn, sidewaysIn } from '../reflow.ts'
import { commandLine, open, openHome } from './app.ts'
import { launchApp, newRunDir, type AppHandle } from './launch.ts'
import type { RunInfo } from './run.ts'

const ZOOM_PERCENT = 200
const ZOOM_SIZE = '1920x1080'
const SLACK_PX = 1

/** Brings every panel into view in turn, as a person scrolls a stacked layout (panels may mount their content on arrival). */
async function visitPanels(page: Page): Promise<void> {
  for (const panel of await page.locator('[data-nqt-panel]').all()) {
    await panel.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

const BAR_CONTROLS = '.fn-bar button, .fn-bar [role="button"], .fn-bar input'

/** The red function bars' controls on the page, after every panel has been visited. */
async function barControls(page: Page): Promise<string[]> {
  await visitPanels(page)
  return controlsIn(page, 'body', BAR_CONTROLS)
}

async function controls(page: Page): Promise<string[]> {
  await visitPanels(page)
  return controlsIn(page, 'body')
}

/** The controls of one panel (by its command line) that have a size. */
const panelControls = (page: Page, title: string): Promise<string[]> => controlsIn(page, `[data-nqt-title="${title}"]`)

/** Text that a clipping box or an ellipsis cuts off (the shared detector of e2e/reflow.ts), outside any scroller and any data table. */
const cutOffText = (page: Page): Promise<string[]> => cutOffIn(page, 'body')

interface LayoutFacts {
  readonly width: number
  readonly height: number
  readonly controls: string[]
  readonly clippedChrome: string[]
  readonly cutText: string[]
}

/** The CSS size of the window and what is whole or cut off in it, after every panel has been visited. */
async function layoutFacts(page: Page): Promise<LayoutFacts> {
  const controlList = await controls(page)
  const cutText = await cutOffText(page)
  const found = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    clippedChrome: Array.from(document.querySelectorAll<HTMLElement>('[data-nqt-panel] .fn-bar, [data-nqt-panel] [role="tablist"], [data-nqt-panel] .ptitle'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
      .map((el) => `${el.className || el.tagName}: ${el.textContent?.slice(0, 30)}`),
  }))
  return { ...found, controls: controlList, cutText }
}

/** The page does not scroll sideways, and the control sits inside the viewport. */
async function expectFits(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, inner: window.innerWidth }))
  expect(overflow.scroll, `${label}: the page scrolls sideways (${JSON.stringify(overflow)})`).toBeLessThanOrEqual(overflow.client + SLACK_PX)
}

async function expectInViewport(page: Page, selector: string, label: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox()
  const width = await page.evaluate(() => window.innerWidth)
  expect(box, `${label}: no box`).not.toBeNull()
  expect(box!.x, `${label}: starts left of the viewport`).toBeGreaterThanOrEqual(-SLACK_PX)
  expect(box!.x + box!.width, `${label}: runs past the viewport (${width} px)`).toBeLessThanOrEqual(width + SLACK_PX)
}

/** The same page at the 100% app's own width and height of the zoomed window's CSS size, then back to 1920x1080. */
async function narrowLayout(main: Page, like: LayoutFacts): Promise<LayoutFacts> {
  await main.setViewportSize({ width: like.width, height: like.height })
  try {
    await openHome(main)
    return await layoutFacts(main)
  } finally {
    await main.setViewportSize(VIEWPORT)
  }
}

/** With the panel maximised from its own button, every control in `want` shows within a few seconds; the panel is put back afterwards. */
async function expectControlsWhenMaximised(zoomed: Page, title: string, want: readonly string[]): Promise<void> {
  const toggle = zoomed.locator(`[data-nqt-title="${title}"]`).getByRole('button', { name: 'Maximise panel' })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  try {
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const lost = async (): Promise<string[]> => { const got = await panelControls(zoomed, title); return want.filter((c) => !got.includes(c)) }
    await expect.poll(lost, { message: `${title}: controls lost at 200% with the panel maximised`, timeout: 10_000 }).toEqual([])
  } finally {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
}

test.describe('200% zoom', () => {
  let zoomed: AppHandle
  let browser: Browser
  let page: Page

  test.beforeAll(async ({ run }: { run: RunInfo }) => {
    zoomed = await launchApp({ exe: run.exe, fixture: true, lab: run.lab, runDir: newRunDir('zoom'), size: ZOOM_SIZE, zoom: ZOOM_PERCENT })
    const attached = await attach(zoomed.cdpUrl, zoomed.origin)
    browser = attached.browser
    page = attached.page
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  })

  test.afterAll(async () => {
    await browser?.close().catch(() => undefined)
    const stopped = await zoomed?.stop()
    expect(stopped?.backendGone, 'the zoomed backend is gone').toBe(true)
  })

  test('born failing: the detectors see planted cut-off text and a planted collapsed control', async ({ page: main }) => {
    await openHome(main)
    await main.evaluate(() => {
      const text = document.createElement('span')
      text.id = 'nqt-plant-text'
      text.textContent = 'a planted line of text that is much too long for its box'
      text.style.cssText = 'position:fixed;left:0;top:0;display:block;width:20px;overflow:hidden;white-space:nowrap;z-index:9'
      const shown = document.createElement('button')
      shown.textContent = 'Planted visible'
      shown.style.cssText = 'position:fixed;left:0;top:30px;z-index:9'
      const collapsed = document.createElement('button')
      collapsed.textContent = 'Planted collapsed'
      collapsed.style.cssText = 'position:fixed;left:0;top:60px;width:0;height:0;padding:0;border:0;z-index:9'
      // Reachability: a control past the edge of a clipping box, and one past the right edge of the viewport, both with a size.
      const clipper = document.createElement('div')
      clipper.id = 'nqt-plant-clipper'
      clipper.style.cssText = 'position:fixed;left:0;top:90px;width:40px;height:30px;overflow:hidden;z-index:9'
      const cutOff = document.createElement('button')
      cutOff.textContent = 'Planted cut off'
      cutOff.style.cssText = 'margin-left:120px'
      clipper.append(cutOff)
      const offscreen = document.createElement('button')
      offscreen.textContent = 'Planted offscreen'
      offscreen.style.cssText = `position:fixed;top:130px;left:${window.innerWidth + 50}px;z-index:9`
      document.body.append(text, shown, collapsed, clipper, offscreen)
    })
    try {
      expect((await cutOffText(main)).some((c) => c.includes('a planted line of text')), 'the cut-off detector sees the planted text').toBe(true)
      const listed = await controlsIn(main, 'body')
      expect(listed, 'a control with a size is listed').toContain('button: Planted visible')
      expect(listed.some((c) => c.includes('Planted collapsed')), 'a control with no size is not listed').toBe(false)
      expect(listed.some((c) => c.includes('Planted cut off')), 'a control cut off by a clipping box is not listed').toBe(false)
      expect(listed.some((c) => c.includes('Planted offscreen')), 'a control past the viewport is not listed').toBe(false)
      expect(missingFrom(['button: a', 'button: a', 'button: b'], ['button: a', 'button: b']), 'a repeated name that is lost once is reported').toEqual(['button: a'])
    } finally {
      await main.evaluate(() => { for (const el of Array.from(document.querySelectorAll('span#nqt-plant-text, div#nqt-plant-clipper, button'))) if ((el.textContent ?? '').startsWith('Planted') || el.id === 'nqt-plant-text' || el.id === 'nqt-plant-clipper') el.remove() })
    }
  })

  test('the engine zoom is 200%', async () => {
    await openHome(page)
    const scale = await page.evaluate(() => ({ dpr: window.devicePixelRatio, inner: window.innerWidth }))
    // force-device-scale-factor=1 in smoke builds, so the zoom factor shows as the device pixel ratio.
    expect(scale.dpr, `the zoom as the page reports it (${JSON.stringify(scale)})`).toBeCloseTo(ZOOM_PERCENT / 100, 1)
  })

  test('HOME at 200%: nothing scrolls sideways, every panel is reachable, and the layout is the one the same width gives at 100%', async ({ page: main }) => {
    await openHome(page)
    await expectFits(page, 'HOME')
    await expectInViewport(page, '[data-chrome="status"]', 'the status line')
    await expect(page.getByRole('group', { name: 'Safety' }), 'the safety segments').toBeInViewport()
    for (const [title] of HOME_READY) {
      const target = page.locator(`[data-nqt-title="${title}"]`)
      await target.scrollIntoViewIfNeeded()
      await expect(target, `HOME panel ${title}`).toBeInViewport()
    }
    const zoomedFacts = await layoutFacts(page)
    // The same page at the same CSS width in the 100% app: real engine zoom must not lose or move anything the narrow layout has.
    const narrowFacts = await narrowLayout(main, zoomedFacts)
    expect(zoomedFacts.controls, 'controls: engine zoom against the same width at 100%').toEqual(narrowFacts.controls)
    // Zoomed, the red bars wrap (FunctionBar.css, min-resolution), which the plain 100% page at the same width does not do, so the
    // zoomed page may cut off less chrome than the narrow one, never more.
    expect(zoomedFacts.clippedChrome.length, 'cut-off chrome: engine zoom against the same width at 100%').toBeLessThanOrEqual(narrowFacts.clippedChrome.length)
    // The same holds for cut-off text (the narrow page's red bar is one nowrap row and cuts a title bar that the zoomed bars wrap),
    // so what the zoomed page cuts off must be among what the narrow page cuts off, and the status segments that both cut by design stay.
    expect(missingFrom(zoomedFacts.cutText, narrowFacts.cutText), 'cut-off text of the zoomed page that the same width at 100% does not cut off').toEqual([])
    // Absolute, not relative to the narrow layout: no panel chrome is cut off (the red bars wrap up to 1000 px of viewport,
    // FunctionBar.css), and every function bar control of the 100% page is still reachable in the 2 x 2 grid at 200%.
    expect(zoomedFacts.clippedChrome, 'panel chrome that is cut off at 200%').toEqual([])
    await openHome(main)
    const barsAt100 = await barControls(main)
    expect(barsAt100.length, 'the 100% page has function bar controls to lose').toBeGreaterThan(0)
    expect(missingFrom(barsAt100, await barControls(page)), 'function bar controls of the 100% page that are cut off or off screen at 200%').toEqual([])
  })

  test('no control of the 100% HOME is lost at 200%: each panel, maximised from its own button, shows all of its controls', async ({ page: main }) => {
    await openHome(main)
    const at100 = await controls(main)
    await openHome(page)
    // In the 2 x 2 grid at 200% a panel is short and some of its chart's own controls have no size (the same in plain Chromium at
    // this width, asserted in the test above); maximising the panel gives them room. This test uses the 1920x1080 window; the
    // small windows (1366x768, 1024x640) are the tests at the end of this file.
    const zoomedControls = await controls(page)
    const collapsed = at100.filter((c) => !zoomedControls.includes(c))
    test.info().annotations.push({ type: 'collapsed-in-grid', description: collapsed.length + ' controls have no size in the panels of the 2 x 2 grid and show when their panel is maximised: ' + collapsed.join(' | ') })
    for (const [title] of HOME_READY) {
      await expectControlsWhenMaximised(page, title, await panelControls(main, title))
    }
  })

  test('the command line at 200%: it takes a line and its dropdown stays on screen', async () => {
    await openHome(page)
    await page.keyboard.press('Control+k')
    await expect(commandLine(page)).toBeFocused()
    await expectInViewport(page, '[role="combobox"][aria-label="Command line"]', 'the command line')
    await commandLine(page).fill('RE')
    await expect(page.getByRole('listbox')).toBeVisible()
    await expectInViewport(page, '[role="listbox"]', 'the dropdown')
    await commandLine(page).fill('')
    await page.keyboard.press('Escape')
  })

  test('the REG grid: its text is whole and the page does not scroll sideways', async () => {
    await openHome(page)
    await open(page, 'REG')
    const grid = page.getByRole('grid').first()
    await expect(grid).toBeVisible()
    await expectFits(page, 'REG')
    for (const header of await grid.getByRole('columnheader').all()) {
      const full = await header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
      expect(full, `column header ${JSON.stringify(await header.textContent())} is cut off`).toBe(true)
    }
  })

  test('a chart and its table: the figure is named, the Table toggle works, the table shows whole', async () => {
    await openHome(page)
    await open(page, 'NQ GP')
    await expect(page.locator('.chart-a11y-figure[role="img"]').first()).toBeVisible()
    await expectFits(page, 'GP')
    const tables = await showEveryTable(page)
    expect(tables.length, 'one table view per chart').toBeGreaterThan(0)
    for (const t of tables) {
      expect(t.headers, `${t.caption}: column headers`).toBeGreaterThan(0)
      expect(t.rows, `${t.caption}: rows`).toBeGreaterThan(0)
      expect(t.clipped, `${t.caption}: shown whole`).toBe(false)
    }
  })
})

/**
 * Windows smaller than the 1920x1080 one above, still in contract (03 section 12: no control lost at 200% in a window of down to
 * 1,024x640; WCAG 1.4.4, 1.4.10). Each is an app of its own at 200%. A maximised panel shows all of its controls there: the
 * stylesheets that fold a parameter row or the criteria away in a short panel leave a maximised one alone (PanelChrome.css marks
 * it), the stacked layout of a narrow window gives it the viewport (Workspace.css), the chart keeps a floor that leaves its panes
 * readable and the panel body scrolls what is left. Until the decision of 3 October 2026 this was an expected failure (a maximised
 * GP left a body too short for its controls, 194 CSS px of chrome above it). The launch is in beforeAll, so an app that does not
 * start fails the run. The browser survey of every panel is e2e/reflow-200.spec.ts; this holds the four HOME panels in the real
 * engine's zoom.
 */
const SMALL_WINDOWS = ['1366x768', '1024x640'] as const
const MAXIMISED_POLL_MS = 4_000

interface MaximisedFacts {
  /** Controls the panel has at 100% in the roomy window that have no size, or are cut off or off screen, with it maximised. */
  readonly lost: string[]
  /** Pairs of controls or lines of text that overlap. */
  readonly overlapping: string[]
  /** What makes the page or the panel body scroll sideways, a data table apart. */
  readonly sideways: string[]
}

/** What is lost, overlapping or running sideways with the panel maximised, after a short wait (a panel may mount controls on arrival). */
async function factsWhenMaximised(zoomed: Page, title: string, want: readonly string[]): Promise<MaximisedFacts> {
  const toggle = zoomed.locator(`[data-nqt-title="${title}"]`).getByRole('button', { name: 'Maximise panel' })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  try {
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    let lost = want.slice()
    await expect.poll(async () => { lost = missingFrom(want, await panelControls(zoomed, title)); return lost.length }, { timeout: MAXIMISED_POLL_MS }).toBe(0).catch(() => undefined)
    const scope = `[data-nqt-title="${title}"]`
    return { lost, overlapping: await overlapsIn(zoomed, scope), sideways: await sidewaysIn(zoomed, scope) }
  } finally {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
}

for (const size of SMALL_WINDOWS) {
  test.describe(`200% zoom in a ${size} window`, () => {
    let small: AppHandle
    let smallBrowser: Browser
    let smallPage: Page

    test.beforeAll(async ({ run }: { run: RunInfo }) => {
      small = await launchApp({ exe: run.exe, fixture: true, lab: run.lab, runDir: newRunDir(`zoom-${size}`), size, zoom: ZOOM_PERCENT })
      const attached = await attach(small.cdpUrl, small.origin)
      smallBrowser = attached.browser
      smallPage = attached.page
      await smallPage.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    })

    test.afterAll(async () => {
      await smallBrowser?.close().catch(() => undefined)
      const stopped = await small?.stop()
      expect(stopped?.backendGone, 'the small window backend is gone').toBe(true)
    })

    test(`every HOME panel, maximised, keeps every control reachable, nothing overlaps and nothing scrolls sideways (${size})`, async ({ page: main }) => {
      await openHome(main)
      const wantByPanel: Record<string, string[]> = {}
      for (const [title] of HOME_READY) wantByPanel[title] = await panelControls(main, title)
      await openHome(smallPage)
      const inner = await smallPage.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio }))
      test.info().annotations.push({ type: 'window', description: `${size} window at 200%: ${JSON.stringify(inner)} CSS px` })
      const factsByPanel: Record<string, MaximisedFacts> = {}
      for (const [title] of HOME_READY) factsByPanel[title] = await factsWhenMaximised(smallPage, title, wantByPanel[title] ?? [])
      const clean: MaximisedFacts = { lost: [], overlapping: [], sideways: [] }
      const broken = Object.fromEntries(Object.entries(factsByPanel).filter(([, facts]) => JSON.stringify(facts) !== JSON.stringify(clean)))
      expect(broken, `controls lost, overlaps and sideways scrolling at 200% in ${size} with the panel maximised, by panel`).toEqual({})
    })
  })
}
