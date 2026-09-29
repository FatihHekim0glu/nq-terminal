// Playwright helper for the component gallery (TASKS Phase 5). The E2E run serves the gallery build,
// so /__gallery/<name> renders one component with fixture data (src/gallery). A stage B spec
// (e2e/gallery-<task>.spec.ts) typically reads:
//
//   import { expect, test } from '@playwright/test'
//   import { expectGalleryClean, openGallery, screenshotGallery, watchGallery } from './gallery.ts'
//
//   test('LineStack gallery', async ({ page }) => {
//     const watch = await watchGallery(page)
//     await screenshotGallery(page, 'LineStack')          // 1920x1080 and 1366x768 baselines
//     const main = await openGallery(page, 'LineStack')   // back at 1920x1080, ready
//     await expect(main.getByRole('img')).toHaveAttribute('aria-label', /points from/)
//     await expectGalleryClean(page, watch)               // axe WCAG 2.2 AA, no console errors, GET only, no CSP report
//   })
//
// "Ready" means: the entry module loaded and rendered, the chart fonts loaded, two frames painted
// (data-gallery-state="ready"), and nothing inside the page is aria-busy="true" (a chart whose library
// is still loading, see useChartLibrary in src/charts/lazy.ts).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Locator, type Page, type PageScreenshotOptions, type Request } from '@playwright/test'
import { recordDemoRefusals, withoutDemoRefusals } from './target.ts'

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Masked areas are painted the page black (--bg), not Playwright's default magenta, in every baseline. */
export const MASK_COLOR = '#000000'

export interface GalleryViewport {
  readonly width: number
  readonly height: number
}

/** The two sizes every gallery baseline is taken at (TASKS standard QA gate). */
export const GALLERY_VIEWPORTS: readonly GalleryViewport[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]

export interface GalleryWatch {
  readonly requests: Request[]
  /** Console errors as `<text> <url of the source>` (the URL names the resource of a "Failed to load resource" line), and page errors. */
  readonly errors: string[]
  /** URLs the offline demo API declined (its refusal header); always empty against the fixture backend. */
  readonly demoRefused: Set<string>
}

/** Start recording requests, console errors, page errors and CSP reports. Call before openGallery. */
export async function watchGallery(page: Page): Promise<GalleryWatch> {
  const requests: Request[] = []
  const errors: string[] = []
  const demoRefused = new Set<string>()
  page.on('request', (r) => requests.push(r))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`)
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  recordDemoRefusals(page, demoRefused)
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.defineProperty(window, '__nqtCsp', { value: seen, configurable: true })
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  return { requests, errors, demoRefused }
}

/** Load one entry at the given size and wait until it is ready; returns the gallery's <main>. */
export async function openGallery(page: Page, name: string, viewport: GalleryViewport = GALLERY_VIEWPORTS[0]!): Promise<Locator> {
  await page.setViewportSize(viewport)
  await page.goto(`/__gallery/${encodeURIComponent(name)}`)
  const main = page.locator('main[data-gallery-state]')
  await expect(main, `gallery entry ${name} did not finish loading`).not.toHaveAttribute('data-gallery-state', 'loading')
  const state = await main.getAttribute('data-gallery-state')
  if (state !== 'ready') throw new Error(`gallery entry ${name} is ${state}: ${(await main.innerText()).trim()}`)
  await expect(main.locator('[aria-busy="true"]'), `a chart in ${name} is still loading`).toHaveCount(0)
  // Let a chart that draws on the next frame (lightweight-charts) finish.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  return main
}

export interface GalleryScreenshotOptions {
  /** Areas to mask (a live clock, for example). */
  readonly mask?: readonly Locator[]
  readonly maxDiffPixelRatio?: number
  /** Screenshot only this element instead of the whole page. */
  readonly target?: (page: Page) => Locator
  /** Baseline name suffix for a variant, e.g. 'log' gives LineStack-log-1920x1080.png. */
  readonly variant?: string
  /** Runs after the entry is ready and before each screenshot (open the table view, hover, etc.). */
  readonly prepare?: (page: Page, main: Locator) => Promise<void>
}

/** `<name>[-<variant>]-<width>x<height>.png`, the baseline file name for one size. */
export function galleryBaselineName(name: string, viewport: GalleryViewport, variant?: string): string {
  return `${name}${variant ? `-${variant}` : ''}-${viewport.width}x${viewport.height}.png`
}

/** Compare the entry against its baselines at 1920x1080 and 1366x768, then return to 1920x1080. */
export async function screenshotGallery(page: Page, name: string, opts: GalleryScreenshotOptions = {}): Promise<void> {
  for (const viewport of GALLERY_VIEWPORTS) {
    const main = await openGallery(page, name, viewport)
    await opts.prepare?.(page, main)
    const shot: PageScreenshotOptions & { maxDiffPixelRatio?: number } = { mask: [...(opts.mask ?? [])], maskColor: MASK_COLOR }
    if (opts.maxDiffPixelRatio !== undefined) shot.maxDiffPixelRatio = opts.maxDiffPixelRatio
    const file = galleryBaselineName(name, viewport, opts.variant)
    if (opts.target) await expect(opts.target(page)).toHaveScreenshot(file, shot)
    else await expect(page).toHaveScreenshot(file, shot)
  }
  await page.setViewportSize(GALLERY_VIEWPORTS[0]!)
}

/** axe with the WCAG 2.2 AA tags on the current page. */
export async function expectGalleryAxeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

/** axe clean, no console or page errors, no CSP report, and every request a same-origin GET. */
export async function expectGalleryClean(page: Page, watch: GalleryWatch): Promise<void> {
  await expectGalleryAxeClean(page)
  expect(withoutDemoRefusals(watch.errors, watch.demoRefused)).toEqual([])
  const csp = await page.evaluate(() => (window as unknown as { __nqtCsp?: string[] }).__nqtCsp ?? [])
  expect(csp).toEqual([])
  const origin = new URL(page.url()).origin
  const bad = watch.requests.filter((r) => r.method() !== 'GET' || !r.url().startsWith(origin))
  expect(bad.map((r) => `${r.method()} ${r.url()}`)).toEqual([])
}
