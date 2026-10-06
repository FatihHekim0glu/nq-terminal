// The system contrast modes (roadmap Phase D9, WCAG 2.2 AA): every mnemonic screen of the workspace opened under an
// emulated Windows contrast theme (forced-colors: active) and under prefers-contrast: more, against the fixture-mode
// backend (playwright.config.ts, the main chromium project), at 1,920 x 1,080. For each screen and mode:
//   - axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) finds no violation;
//   - no line of text is invisible: its computed colour differs from the background it is drawn on (ancestor fills
//     composited, ratio at least 1.1, so equal or near-equal colours fail);
//   - the keyboard ring shows on the first focusable element of the page and on the focused panel's body: an outline of
//     2px or more (on the element, its ::after overlay or the box that draws it for the element) at 3:1 or more against
//     what it is drawn on.
// The default look is not tested here: its baselines (e2e/visual) stay as they are, since the contrast sheets apply only
// inside their media queries (src/theme/forcedColors.css, src/theme/contrastMore.css). Canvas charts follow the modes
// through the chart kit; their pixels are not read here.
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { dismissOrientation } from './orientation.ts'
import { axeViolations, openScreen, SCREENS, type ScreenCase, type Viewport } from './visual/screens.ts'

const VIEWPORT: Viewport = { width: 1920, height: 1080 }
const HYP = 'volmanaged_v0'
const RUN = 'nt_volmanaged_v0_fixture_m1'
/** Below this ratio a text colour counts as the same as its background. */
const SAME_COLOUR = 1.1
/** WCAG 1.4.11 and 2.4.13: the keyboard ring against what it is drawn on. */
const RING_MIN = 3
const RING_WIDTH = 2

interface Mode {
  readonly name: string
  readonly query: string
  readonly media: Parameters<Page['emulateMedia']>[0]
}

const MODES: readonly Mode[] = [
  { name: 'forced colours', query: '(forced-colors: active)', media: { forcedColors: 'active' } },
  { name: 'more contrast', query: '(prefers-contrast: more)', media: { contrast: 'more' } },
]

/** One case per mnemonic: the first SCREENS entry of each code, then the screens SCREENS does not hold (the lines e2e/reflow-200 uses). */
const FIRST_OF_EACH: readonly ScreenCase[] = SCREENS.filter((s, i) => SCREENS.findIndex((t) => t.code === s.code) === i)
const MORE_SCREENS: readonly ScreenCase[] = [
  { name: 'VCONE', line: 'NQ VCONE', code: 'VCONE', charts: 0 },
  { name: 'SEAS', line: 'NQ SEAS', code: 'SEAS', charts: 0 },
  { name: 'EVT', line: 'NQ EVT', code: 'EVT', charts: 0 },
  { name: 'ROLL', line: 'NQ ROLL', code: 'ROLL', charts: 0 },
  { name: 'COST', line: `${HYP} COST`, code: 'COST', charts: 0 },
  { name: 'BLK', line: `${HYP} BLK`, code: 'BLK', charts: 0 },
  { name: 'SEAL', line: `${HYP} SEAL`, code: 'SEAL', charts: 0 },
  { name: 'EXPO', line: `${RUN} EXPO`, code: 'EXPO', charts: 0 },
  { name: 'DQ', line: 'NQ DQ', code: 'DQ', charts: 0 },
  { name: 'JOBS', line: 'JOBS', code: 'JOBS', charts: 0 },
]
// Charts are not counted here (the visual spec does): the opener waits for none, then for the page to settle.
const CASES: readonly ScreenCase[] = [...FIRST_OF_EACH, ...MORE_SCREENS].map((s) => ({ ...s, charts: 0 }))

/** The mnemonics the workspace registers (src/chrome/WorkspaceScreens.tsx BUILT_SCREENS), read from the source: a spec cannot import src. */
function builtMnemonics(): string[] {
  const source = fs.readFileSync(new URL('../src/chrome/WorkspaceScreens.tsx', import.meta.url), 'utf8')
  const block = /export const BUILT_SCREENS[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  return [...block.matchAll(/^\s*([A-Z0-9]+):/gm)].map((m) => m[1]!)
}

// ---------------------------------------------------------------- the detectors (run in the page)

interface Finding {
  readonly what: string
  readonly detail: string
}

/** Text whose colour is the same as the background it is drawn on, as `tag.class "text": colour on fill`. */
async function invisibleText(page: Page, minRatio: number): Promise<Finding[]> {
  return page.evaluate((min) => {
    type Rgba = { r: number; g: number; b: number; a: number }
    const parse = (value: string): Rgba | null => {
      const m = /rgba?\(([^)]+)\)/.exec(value)
      if (!m) return null
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
      return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 }
    }
    const over = (top: Rgba, under: Rgba): Rgba => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    })
    const lum = (c: Rgba): number => {
      const ch = (v: number) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
    }
    const ratio = (a: Rgba, b: Rgba): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    const pageFill = parse(getComputedStyle(document.documentElement).backgroundColor)
    const root: Rgba = pageFill && pageFill.a > 0 ? { ...pageFill, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
    const fillBehind = (el: Element): Rgba => {
      const layers: Rgba[] = []
      for (let node: Element | null = el; node; node = node.parentElement) {
        const fill = parse(getComputedStyle(node).backgroundColor)
        if (fill && fill.a > 0) layers.push(fill)
        if (fill && fill.a >= 1) break
      }
      return layers.reduceRight((under, top) => over(top, under), root)
    }
    const shown = (el: Element): boolean => {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) return false
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
      }
      return true
    }
    const out: { what: string; detail: string }[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('svg, canvas, .sr-only, script, style, template')) continue
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim()
      if (text === '' || !shown(el)) continue
      const colour = parse(getComputedStyle(el).color)
      if (!colour) continue
      const behind = fillBehind(el)
      const seen = ratio(over(colour, behind), behind)
      if (seen < min) {
        const cls = typeof el.className === 'string' && el.className !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
        out.push({ what: `${el.tagName.toLowerCase()}${cls} "${text.slice(0, 40)}"`, detail: `${getComputedStyle(el).color} on ${JSON.stringify(behind)} (${seen.toFixed(2)})` })
      }
    }
    return out
  }, minRatio)
}

/**
 * Focuses the element as a keyboard user would (a key press first, so the browser shows the keyboard ring) and reads the
 * ring: null when one of 2px or more shows at 3:1 against what it is drawn on, otherwise why not.
 */
async function ringProblem(page: Page, selector: string): Promise<string | null> {
  await page.keyboard.press('Shift')
  return page.evaluate(({ sel, width, min }) => {
    type Rgba = { r: number; g: number; b: number; a: number }
    const parse = (value: string): Rgba | null => {
      const m = /rgba?\(([^)]+)\)/.exec(value)
      if (!m) return null
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
      return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 }
    }
    const lum = (c: Rgba): number => {
      const ch = (v: number) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
    }
    const ratio = (a: Rgba, b: Rgba): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    const fillBehind = (el: Element | null): Rgba => {
      for (let node = el; node; node = node.parentElement) {
        const fill = parse(getComputedStyle(node).backgroundColor)
        if (fill && fill.a >= 0.5) return fill
      }
      return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
    }
    const el = document.querySelector<HTMLElement>(sel)
    if (!el) return `${sel}: not on the page`
    el.focus()
    if (document.activeElement !== el) return `${sel}: did not take focus`
    if (!el.matches(':focus-visible')) return `${sel}: focused without the keyboard ring state`
    // The ring may sit on the element, on its ::after overlay, or on a box up to three levels out that draws it for the element.
    const candidates: [Element, CSSStyleDeclaration][] = [[el, getComputedStyle(el)], [el, getComputedStyle(el, '::after')]]
    for (let up = el.parentElement, i = 0; up && i < 3; up = up.parentElement, i += 1) candidates.push([up, getComputedStyle(up)])
    const notes: string[] = []
    for (const [box, cs] of candidates) {
      if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) < width) continue
      const ring = parse(cs.outlineColor)
      if (!ring) continue
      const behind = parseFloat(cs.outlineOffset) < 0 ? fillBehind(box) : fillBehind(box.parentElement)
      const seen = ratio(ring, behind)
      if (seen >= min) return null
      notes.push(`${cs.outlineColor} on ${JSON.stringify(behind)} (${seen.toFixed(2)})`)
    }
    return `${sel}: no ${width}px ring at ${min}:1${notes.length > 0 ? `; seen ${notes.join(', ')}` : ''}`
  }, { sel: selector, width: RING_WIDTH, min: RING_MIN })
}

/** Marks the first element in Tab order (DOM order, no positive tabindex in this app) and returns its selector. */
async function markFirstFocusable(page: Page): Promise<string> {
  const marked = await page.evaluate(() => {
    const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'
    const first = Array.from(document.querySelectorAll<HTMLElement>(focusable)).find((el) => {
      if (el.tabIndex < 0 || el.closest('[inert], [aria-hidden="true"]')) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    })
    if (!first) return false
    first.setAttribute('data-nqt-first-focusable', '')
    return true
  })
  expect(marked, 'a focusable element on the page').toBe(true)
  return '[data-nqt-first-focusable]'
}

// ---------------------------------------------------------------- tests

test.describe.configure({ timeout: 120_000 })

test('the case list holds every mnemonic the workspace registers', () => {
  const built = builtMnemonics()
  expect(built.length).toBeGreaterThanOrEqual(30)
  expect([...new Set(CASES.map((c) => c.code))].sort()).toEqual([...built].sort())
})

test('born failing: the detectors see text drawn in its own background colour and a focus ring that is not there', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 45_000 })
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:rgb(0,0,0);padding:8px'
    const hidden = document.createElement('span')
    hidden.id = 'nqt-plant-text'
    hidden.style.cssText = 'color:rgb(1,1,1)'
    hidden.textContent = 'Planted text in the background colour'
    const button = document.createElement('button')
    button.id = 'nqt-plant-ring'
    button.style.cssText = 'outline:none;color:rgb(255,255,255);background:rgb(0,0,0)'
    button.textContent = 'Planted button without a ring'
    box.append(hidden, button)
    document.body.append(box)
  })
  const found = await invisibleText(page, SAME_COLOUR)
  expect(found.map((f) => f.what)).toContainEqual(expect.stringContaining('Planted text in the background colour'))
  expect(await ringProblem(page, '#nqt-plant-ring')).toMatch(/no 2px ring/)
})

for (const mode of MODES) {
  test.describe(mode.name, () => {
    for (const screen of CASES) {
      test(`${screen.name}: axe clean, no invisible text, visible keyboard ring`, async ({ page }) => {
        await dismissOrientation(page)
        await page.emulateMedia(mode.media)
        await openScreen(page, screen, VIEWPORT)
        expect(await page.evaluate((q) => window.matchMedia(q).matches, mode.query), mode.query).toBe(true)

        expect(await axeViolations(page), 'axe').toEqual([])
        const invisible = await invisibleText(page, SAME_COLOUR)
        expect(invisible.map((f) => `${f.what}: ${f.detail}`), 'text in its own background colour').toEqual([])

        expect(await ringProblem(page, await markFirstFocusable(page)), 'first focusable element').toBeNull()
        const body = '.nqt-panel[data-focused="true"] .nqt-panel-body'
        await expect(page.locator(body)).toHaveCount(1)
        expect(await ringProblem(page, body), 'the focused panel body').toBeNull()
      })
    }
  })
}

// ---------------------------------------------------------------- JOBS with a row selected

/** A job as GET /api/jobs answers it (the contract's Job), with the fields the row reads. */
function fixtureJob(id: string, state: 'running' | 'ok', exitCode: number | null, finished: string | null): Record<string, unknown> {
  const runId = `t_tsmom_v0_fixture_${id}`
  return {
    id: `j-${id}`,
    run_id: runId,
    spec: { strategy: 'tsmom', params: {}, variant: 'vendor', start: '2010-06-01', end: '2021-12-31', run_id: runId },
    state,
    exit_code: exitCode,
    created: '2026-09-25T17:50:00Z',
    started: '2026-09-25T17:51:00Z',
    finished,
    message: '',
    log_tail: ['loading bars', 'running'],
  }
}
/** One running job (its row offers Stop) and one finished with exit 0 (its row offers Open in RUN). */
const SELECT_JOBS = [fixtureJob('live', 'running', null, null), fixtureJob('done', 'ok', 0, '2026-09-25T17:58:00Z')]

/** The queue is answered by the spec, so both row kinds show whatever the fixture backend holds. GETs only. */
async function serveJobs(page: Page): Promise<void> {
  await page.route((url) => url.pathname === '/api/jobs', (route) =>
    route.fulfill({ json: { jobs: SELECT_JOBS, queue_cap: 10, queued: 0, running: 1, enabled: true } }))
  await page.route((url) => /^\/api\/jobs\/j-[a-z]+$/.test(url.pathname), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    const job = SELECT_JOBS.find((j) => j.id === id)
    return job ? route.fulfill({ json: job }) : route.fulfill({ status: 404, json: { detail: 'Not found' } })
  })
}

const JOBS_CASE: ScreenCase = { name: 'JOBS', line: 'JOBS', code: 'JOBS', charts: 0 }

for (const mode of MODES) {
  // A selected row takes the selection fill; its grey buttons keep their own fill, which the theme repaints as ButtonFace,
  // so their labels must not take the row's HighlightText (they would almost vanish in every Windows contrast theme).
  test(`${mode.name}: JOBS with a row selected (View log on a finished and on a running job, then Stop asked): axe clean, no invisible text, visible ring`, async ({ page }) => {
    await dismissOrientation(page)
    await page.emulateMedia(mode.media)
    await serveJobs(page)
    await openScreen(page, JOBS_CASE, VIEWPORT)
    const table = page.locator('.live-table')

    const viewDone = table.getByRole('button', { name: 'View log for t_tsmom_v0_fixture_done' })
    await viewDone.click()
    await expect(viewDone).toHaveAttribute('aria-pressed', 'true')
    await expect(table.locator('tr.jobs-selected').getByRole('button', { name: 'Open in RUN for t_tsmom_v0_fixture_done' })).toBeVisible()
    expect(await axeViolations(page), 'axe, finished row selected').toEqual([])
    expect((await invisibleText(page, SAME_COLOUR)).map((f) => `${f.what}: ${f.detail}`), 'finished row selected').toEqual([])
    // The keyboard ring of a button in the selected row is drawn on the row's Highlight fill.
    await table.locator('tr.jobs-selected button[aria-label="Open in RUN for t_tsmom_v0_fixture_done"]').evaluate((el) => el.setAttribute('data-nqt-ring', ''))
    expect(await ringProblem(page, '[data-nqt-ring]'), 'Open in RUN ring in the selected row').toBeNull()

    const viewLive = table.getByRole('button', { name: 'View log for t_tsmom_v0_fixture_live' })
    await viewLive.click()
    await expect(viewLive).toHaveAttribute('aria-pressed', 'true')
    const stop = table.locator('tr.jobs-selected').getByRole('button', { name: 'Stop the job t_tsmom_v0_fixture_live' })
    await expect(stop).toBeVisible()
    expect(await axeViolations(page), 'axe, running row selected').toEqual([])
    expect((await invisibleText(page, SAME_COLOUR)).map((f) => `${f.what}: ${f.detail}`), 'running row selected').toEqual([])

    // Stop asks first (no request is sent until Yes): the confirmation's two buttons sit in the selected row too.
    await stop.click()
    await expect(table.locator('tr.jobs-selected').getByRole('button', { name: 'Keep it' })).toBeFocused()
    expect(await axeViolations(page), 'axe, Stop confirmation in the selected row').toEqual([])
    expect((await invisibleText(page, SAME_COLOUR)).map((f) => `${f.what}: ${f.detail}`), 'Stop confirmation in the selected row').toEqual([])
  })
}
