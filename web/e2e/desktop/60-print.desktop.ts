// The print path in the app (04 D5.2; 03 section 15.4), by emulating print media. A real window.print() opens the engine's own
// print dialog, a window the run must never show, so the page's print function is replaced with a counter before the click,
// and the print stylesheet is judged by switching the page's media to print (CDP media emulation). The real print dialog and
// the printed sheet stay the owner's check (desktop-v0.1 G2, "plus print").
//
// What it proves: Print dossier mounts the dossier and asks the page to print once; in print media the terminal is gone and
// only the dossier shows, black on white whatever the screen theme, on the named A4 landscape page; its charts are images that
// have loaded; and the page goes back to screen media with the dossier removed after the print.
import { expect, test } from './fixtures.ts'
import { expectClean, open, openHome, watch } from './app.ts'

const LINE = 'volmanaged_v0 EQ'
const ROOT = '#nqt-print-root'
const LIGHT_MIN = 240
const DARK_MAX = 60

interface PrintFacts {
  readonly rootDisplay: string
  readonly visibleAppPanels: number
  readonly bodyChildrenShown: string[]
  readonly background: number[]
  readonly colour: number[]
  readonly headings: number
  readonly tables: number
  readonly images: number
  readonly imagesLoaded: number
  readonly pageRule: string | null
}

test('Print dossier: the print stylesheet shows only the dossier, black on white, A4 landscape', async ({ page, run }) => {
  const w = watch(page)
  await openHome(page)
  const panel = await open(page, LINE)
  await page.evaluate(() => {
    const seen = { prints: 0 }
    Object.defineProperty(window, '__nqtPrint', { value: seen, configurable: true })
    window.print = () => { seen.prints += 1 }
  })
  await panel.getByRole('button', { name: 'Options' }).click()
  await page.getByRole('menuitem', { name: 'Print dossier' }).click()
  await expect(page.locator(ROOT)).toBeAttached({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nqtPrint: { prints: number } }).__nqtPrint.prints), { message: 'window.print calls', timeout: 30_000 }).toBe(1)
  // Images are decoded before the print call; wait for them in case the call came first.
  await expect.poll(() => page.evaluate((root) => Array.from(document.querySelectorAll(`${root} img`)).every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), ROOT)).toBe(true)

  let facts: PrintFacts
  await page.emulateMedia({ media: 'print' })
  try {
    facts = await page.evaluate((root) => {
      const rootEl = document.querySelector(root) as HTMLElement
      const shown = (el: Element): boolean => getComputedStyle(el).display !== 'none'
      const rule = Array.from(document.styleSheets).flatMap((s) => { try { return Array.from(s.cssRules) } catch { return [] } })
        .flatMap((r) => (r instanceof CSSMediaRule ? Array.from(r.cssRules) : [r]))
        .find((r) => r instanceof CSSPageRule && r.selectorText === 'dossier')
      const images = Array.from(rootEl.querySelectorAll('img'))
      const channels = (rgb: string): number[] => (rgb.match(/\d+/g) ?? []).slice(0, 3).map(Number)
      return {
        rootDisplay: getComputedStyle(rootEl).display,
        visibleAppPanels: Array.from(document.querySelectorAll('[data-nqt-panel]')).filter((p) => p.getClientRects().length > 0).length,
        bodyChildrenShown: Array.from(document.body.children).filter(shown).map((c) => c.id || c.tagName.toLowerCase()),
        background: channels(getComputedStyle(rootEl).backgroundColor),
        colour: channels(getComputedStyle(rootEl).color),
        headings: rootEl.querySelectorAll('h1, h2').length,
        tables: rootEl.querySelectorAll('table').length,
        images: images.length,
        imagesLoaded: images.filter((i) => i.complete && i.naturalWidth > 0).length,
        pageRule: rule instanceof CSSPageRule ? rule.style.getPropertyValue('size').trim() : null,
      }
    }, ROOT)
  } finally {
    await page.emulateMedia({ media: null })
  }
  expect(facts.rootDisplay, 'the dossier shows in print media').toBe('block')
  expect(facts.visibleAppPanels, 'terminal panels still showing in print media').toBe(0)
  expect(facts.bodyChildrenShown, 'what shows in print media').toEqual([ROOT.slice(1)])
  expect(Math.min(...facts.background), 'the dossier background (white)').toBeGreaterThanOrEqual(LIGHT_MIN)
  expect(Math.max(...facts.colour), 'the dossier text (black)').toBeLessThanOrEqual(DARK_MAX)
  expect(facts.headings, 'headings in the dossier').toBeGreaterThan(0)
  expect(facts.tables, 'tables in the dossier').toBeGreaterThan(0)
  expect(facts.imagesLoaded, 'chart images loaded').toBe(facts.images)
  expect(facts.pageRule?.toLowerCase(), 'the dossier page').toBe('a4 landscape')

  // Back on the screen: the terminal shows again, and the dossier goes when the print is over.
  await expect(panel).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator(ROOT)).toHaveCount(0)
  expectClean(w, run.origin)
})
