// Every panel, maximised, at 200% zoom in the two smallest windows of the contract (03 section 12: 1,366 x 768 and 1,024 x 640;
// WCAG 2.2 SC 1.4.4 Resize Text and SC 1.4.10 Reflow). At 200% a window of that size gives the page half its width and height in
// CSS pixels, which a browser context shows as a viewport of that size with a device pixel ratio of 2 (the red bars' `min-resolution`
// rule keys on the ratio, as it does under the engine's own zoom). For each panel of HOME and each screen the workspace opens:
//   - every control the panel has in a roomy window (1,920 x 1,080 at 100%) is still there, with a size, inside the viewport
//     sideways and not cut off by a clipping box (a scroller is reachable by scrolling);
//   - no two controls or lines of text overlap;
//   - nothing but a data grid or table, scrolling inside its own box, makes the panel body scroll sideways;
//   - no text or control is cut off by an ellipsis or a box that clips (a data table's cells and column headers may be shortened).
// The desktop spec (desktop/50-zoom.desktop.ts) holds the same bar for the app's own engine zoom on the HOME panels.
// Runs against the fixture-mode backend (playwright.config.ts), the main chromium project.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { dismissOrientation } from './orientation.ts'
import { controlsIn, cutOffIn, missingFrom, overlapsIn, sidewaysIn } from './reflow.ts'
import { OFFLINE_SCREENS, openScreen, SCREENS, type ScreenCase, type Viewport } from './visual/screens.ts'

const ROOMY: Viewport = { width: 1920, height: 1080 }
/**
 * The CSS size of a 1,366 x 768 and a 1,024 x 640 window at 200% (both under 700 px wide, where the workspace stacks its panels),
 * and of a 1,920 x 1,080 window (960 px wide, the side-by-side workspace).
 */
const WINDOWS: readonly Viewport[] = [
  { width: 683, height: 384 },
  { width: 512, height: 320 },
  { width: 960, height: 540 },
]
const ZOOM = 2
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG'] as const
const HYP = 'volmanaged_v0'
const RUN = 'nt_volmanaged_v0_fixture_m1'

/** The screens the workspace opens beyond the P0 list of SCREENS: the P1 screens, the numbered tabs and JOBS. */
const OFFLINE_ONLY = OFFLINE_SCREENS.filter((s) => !SCREENS.some((p) => p.name === s.name)).map(({ prepare: _prepare, ...rest }): ScreenCase => ({ ...rest, charts: 0 }))
const MORE_SCREENS: readonly ScreenCase[] = [
  ...OFFLINE_ONLY,
  { name: 'SEAS-hypothesis', line: `${HYP} SEAS`, code: 'SEAS', charts: 0 },
  { name: 'COST', line: `${HYP} COST`, code: 'COST', charts: 0 },
  { name: 'BLK', line: `${HYP} BLK`, code: 'BLK', charts: 0 },
  { name: 'SEAL', line: `${HYP} SEAL`, code: 'SEAL', charts: 0 },
  { name: 'EXPO', line: `${RUN} EXPO`, code: 'EXPO', charts: 0 },
  { name: 'DQ', line: 'NQ DQ', code: 'DQ', charts: 0 },
  { name: 'JOBS', line: 'JOBS', code: 'JOBS', charts: 0 },
]

interface Case {
  readonly id: string
  readonly screen: ScreenCase
  /** HOME's four panels share one screen; each is its own case, found by title. Otherwise the focused panel is the one opened. */
  readonly title: string | null
}

const CASES: readonly Case[] = [
  ...HOME_TITLES.map((title): Case => ({ id: `HOME ${title}`, screen: SCREENS[0]!, title })),
  ...[...SCREENS.slice(1), ...MORE_SCREENS].map((screen): Case => ({ id: screen.name, screen, title: null })),
]

const panelOf = (page: Page, c: Case) => (c.title === null ? page.locator('[data-nqt-panel][data-focused="true"]') : page.locator(`[data-nqt-title="${c.title}"]`))

/** Opens the case's screen, maximises its panel from the panel's own button, and returns the selector that names the panel. */
async function openMaximised(page: Page, c: Case, viewport: Viewport): Promise<string> {
  // The first load of a context can be slow on a busy machine (the fixture backend and the browser share it with other work):
  // wait for HOME here, with room, so a slow start is not read as a missing panel by the shared opener's 10 s.
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 45_000 })
  await openScreen(page, c.screen, viewport)
  const target = panelOf(page, c)
  await expect(target).toHaveCount(1)
  const id = await target.getAttribute('data-nqt-panel')
  const toggle = target.getByRole('button', { name: 'Maximise panel' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  return `[data-nqt-panel="${id}"]`
}

test.describe.configure({ timeout: 120_000 })

test.describe('the detectors', () => {
  test('born failing: planted overlap, planted sideways scroll, a planted cut-off control and planted cut-off text are all seen', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]').first()).toBeVisible()
    await page.evaluate(() => {
      // Built with createElement: the safety scan of the page bans a string parsed as HTML, in e2e files too.
      const make = (tag: string, style: string, text = '', ...children: Element[]): HTMLElement => {
        const el = document.createElement(tag)
        el.style.cssText = style
        el.textContent = text
        el.append(...children)
        return el
      }
      const panelBody = (style: string, ...children: Element[]): HTMLElement => {
        const body = make('div', style, '', ...children)
        body.className = 'nqt-panel-body'
        return body
      }
      const plant = make('div', 'position:absolute;left:0;top:0;width:300px;height:200px;z-index:9;background:#000', '',
        panelBody('position:absolute;left:0;top:0;width:300px;height:200px;overflow:auto',
          make('button', 'position:absolute;left:10px;top:10px;width:80px;height:24px', 'First'),
          make('button', 'position:absolute;left:50px;top:20px;width:80px;height:24px', 'Second'),
          make('span', 'position:absolute;left:10px;top:80px', 'A line of text'),
          make('span', 'position:absolute;left:12px;top:84px', 'over another line'),
          make('span', 'position:absolute;left:260px;top:120px;white-space:nowrap', 'A line that runs past the right edge of the body'),
          make('div', 'position:absolute;left:0;top:150px;width:60px;height:20px;overflow:hidden', '', make('button', 'margin-left:100px', 'Cut off'))))
      plant.id = 'nqt-plant'
      // Cut-off text: an ellipsis label, a button with a shortened label, a clipping block with a line running past it, a wide
      // data cell (exempt) and a scroller (reached by scrolling, so nothing is cut off).
      const ellipsis = 'position:absolute;left:0;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      const cutText = make('div', 'position:absolute;left:0;top:200px;width:300px;height:140px', '',
        make('span', `${ellipsis};top:0`, 'A planted label that the ellipsis shortens'),
        make('button', `${ellipsis};top:20px`, 'A planted button label that the ellipsis shortens'),
        make('div', 'position:absolute;left:0;top:40px;width:60px;height:20px;overflow:hidden', '', make('span', 'white-space:nowrap', 'A planted heading cut by a clipping box')),
        make('div', 'position:absolute;left:0;top:60px;width:60px;height:20px;overflow:auto', 'A planted line that a scroller reaches by scrolling'),
        make('div', 'position:absolute;left:0;top:80px;width:200px;height:20px;overflow:hidden', 'A planted line that fits'))
      cutText.id = 'nqt-plant-cut'
      const table = document.createElement('table')
      table.style.cssText = 'table-layout:fixed;width:60px'
      const cell = table.insertRow().insertCell()
      cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      cell.textContent = 'A planted data cell that the ellipsis shortens'
      const tableCut = make('div', 'position:absolute;left:0;top:360px;width:300px;height:40px', '', table)
      tableCut.id = 'nqt-plant-cut-table'
      const wide = document.createElement('table')
      wide.style.cssText = 'width:600px'
      wide.insertRow().insertCell().textContent = 'A wide cell of a data table'
      const tablePlant = make('div', 'position:absolute;left:320px;top:0;width:300px;height:200px;z-index:9;background:#000', '',
        panelBody('position:absolute;inset:0;overflow:auto', wide))
      tablePlant.id = 'nqt-plant-table'
      document.body.append(plant, tablePlant, cutText, tableCut)
    })
    try {
      const overlaps = await overlapsIn(page, '#nqt-plant')
      expect(overlaps.some((o) => o.includes('First') && o.includes('Second')), 'two overlapping controls are a pair').toBe(true)
      expect(overlaps.some((o) => o.includes('A line of text') && o.includes('over another line')), 'two overlapping lines are a pair').toBe(true)
      const sideways = await sidewaysIn(page, '#nqt-plant')
      expect(sideways.some((s) => s.includes('scrolls sideways')), 'the body scrolling sideways is seen').toBe(true)
      expect(sideways.some((s) => s.includes('runs past')), 'text past the body edge is seen').toBe(true)
      expect(await sidewaysIn(page, '#nqt-plant-table'), 'a wide data table scrolling in the body is exempt (WCAG 1.4.10)').toEqual([])
      const reachable = await controlsIn(page, '#nqt-plant')
      expect(reachable, 'a control cut off by a clipping box is not reachable').not.toContain('button: Cut off')
      expect(reachable, 'a control in the open is reachable').toContain('button: First')
      const cut = await cutOffIn(page, '#nqt-plant-cut')
      expect(cut.some((c) => c.includes('A planted label')), 'an ellipsis that shortens a line of text is seen').toBe(true)
      expect(cut.some((c) => c.includes('A planted button label')), 'an ellipsis that shortens a control label is seen').toBe(true)
      expect(cut.some((c) => c.includes('A planted heading')), 'a clipping box that hides part of a heading is seen').toBe(true)
      expect(cut.some((c) => c.includes('scroller')), 'a scroller cuts nothing off').toBe(false)
      expect(cut.some((c) => c.includes('that fits')), 'a line that fits is not cut off').toBe(false)
      expect(await cutOffIn(page, '#nqt-plant-cut-table'), 'a data cell shortened by an ellipsis is exempt').toEqual([])
    } finally {
      await page.evaluate(() => { for (const id of ['nqt-plant', 'nqt-plant-table', 'nqt-plant-cut', 'nqt-plant-cut-table']) document.getElementById(id)?.remove() })
    }
  })
})

/**
 * What a person with no zoom has in each maximised panel, and must not lose: the controls of the panel in the roomy window at
 * 100%, read once per case from a page of its own (a context of the roomy size and a device pixel ratio of 1).
 */
const roomyControlsOf = new Map<string, string[]>()
let roomyContext: BrowserContext | null = null
let roomyPage: Page | null = null

async function roomyControls(browser: Browser, baseURL: string | undefined, c: Case): Promise<string[]> {
  const known = roomyControlsOf.get(c.id)
  if (known !== undefined) return known
  if (roomyPage === null) {
    roomyContext = await browser.newContext({
      baseURL,
      storageState: process.env.NQT_E2E_STORAGE_STATE,
      viewport: ROOMY,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    })
    roomyPage = await roomyContext.newPage()
    await dismissOrientation(roomyPage)
  }
  const scope = await openMaximised(roomyPage, c, ROOMY)
  const controlList = await controlsIn(roomyPage, scope)
  roomyControlsOf.set(c.id, controlList)
  return controlList
}

test.afterAll(async () => {
  await roomyContext?.close().catch(() => undefined)
  roomyContext = null
  roomyPage = null
})

for (const win of WINDOWS) {
  test.describe(`200% zoom in a ${win.width * ZOOM} x ${win.height * ZOOM} window, every panel maximised`, () => {
    test.use({ viewport: win, deviceScaleFactor: ZOOM })

    test.beforeEach(async ({ page }) => {
      await dismissOrientation(page)
    })

    for (const c of CASES) {
      test(`${c.id}: every control is reachable, nothing overlaps, nothing scrolls sideways, no text is cut off`, async ({ page, browser }, info) => {
        const want = await roomyControls(browser, info.project.use.baseURL, c)
        expect(want.length, `${c.id}: the roomy window has controls to lose`).toBeGreaterThan(0)
        const scope = await openMaximised(page, c, win)
        const facts = {
          lost: missingFrom(want, await controlsIn(page, scope)),
          overlapping: await overlapsIn(page, scope),
          sideways: await sidewaysIn(page, scope),
          cutOff: await cutOffIn(page, scope),
        }
        expect(facts, `${c.id} at ${win.width * ZOOM} x ${win.height * ZOOM} and 200%`).toEqual({ lost: [], overlapping: [], sideways: [], cutOff: [] })
      })
    }
  })
}
