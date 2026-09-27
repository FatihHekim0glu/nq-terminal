// Page helpers for the E2E flows (TASKS 8.1). A flow drives the terminal the way a person does, from
// the command line and the keys, against the fixture-mode backend that playwright.config.ts starts
// (synthetic bars through the fake gate, a temporary audit log). Every flow ends with expectCleanFlow:
// every request a same-origin GET carrying the client header, no console error, no page error, no
// CSP report, and no served price point past the fence.
import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test'
import { isPriceEndpoint, nonGetRequests, pointsPastFence } from './scan.ts'

export const CLIENT_HEADER = 'x-nqt-client'
export const CLIENT_NAME = 'nq-lab-terminal'
export const PLUMBING_BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

export interface FlowWatch {
  readonly requests: Request[]
  readonly errors: string[]
  /** Served price points past the fence, one line per offending response. */
  readonly fence: string[]
  /** Price responses read so far (bodies are read as they arrive). */
  readonly priceReads: Array<Promise<void>>
}

function watchPrices(page: Page, fence: string[], priceReads: Array<Promise<void>>): void {
  page.on('response', (r: Response) => {
    const url = new URL(r.url())
    if (!isPriceEndpoint(url.pathname) || r.status() !== 200) return
    priceReads.push(
      r.json().then(
        (body: unknown) => {
          for (const hit of pointsPastFence(body)) fence.push(`${url.pathname}${url.search} ${hit}`)
        },
        () => undefined,
      ),
    )
  })
}

/** Record requests, console errors, page errors, CSP reports and price bodies. Call before goto. */
export async function watchFlow(page: Page): Promise<FlowWatch> {
  const requests: Request[] = []
  const errors: string[] = []
  const fence: string[] = []
  const priceReads: Array<Promise<void>> = []
  page.on('request', (r) => requests.push(r))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`)
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  watchPrices(page, fence, priceReads)
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.defineProperty(window, '__nqtCsp', { value: seen, configurable: true })
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  return { requests, errors, fence, priceReads }
}

export const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
export const workspace = (page: Page): Locator => page.getByRole('main', { name: 'Workspace' })
export const panels = (page: Page): Locator => workspace(page).locator('[data-nqt-panel]')
export const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)
export const message = (page: Page): Locator => page.locator('.msg-line[role="status"]')
export const status = (page: Page): Locator => page.getByRole('contentinfo')

/** The commands the panels show, in reading order. */
export async function panelTitles(page: Page): Promise<string[]> {
  return panels(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-nqt-title') ?? ''))
}

/** The screen chunk loaded, its API reads answered, fonts loaded and two frames painted. */
export async function settle(page: Page): Promise<void> {
  await expect(page.locator('p.ws-empty')).toHaveCount(0)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

export async function openTerminal(page: Page): Promise<void> {
  await page.goto('/')
  await expect(panels(page)).toHaveCount(4)
  await expect(status(page)).toContainText('KILL off')
  await settle(page)
}

/** Type a line into the command line and run it with Enter (or Shift+Enter for a new panel). */
export async function runLine(page: Page, line: string, key: 'Enter' | 'Shift+Enter' = 'Enter'): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(line)
  await page.keyboard.press(key)
  await expect(commandLine(page)).toHaveValue('')
}

/** Run a line that opens a screen, and wait until it is on screen and settled. */
export async function openScreen(page: Page, line: string, code: string): Promise<void> {
  await runLine(page, line)
  await expect(message(page), line).not.toHaveAttribute('data-tone', 'error')
  await expect(status(page)).toContainText(`Screen ${code}`)
  await settle(page)
}

/** The element that has focus, described by its panel and accessible name. */
export async function focusInfo(page: Page): Promise<{ panel: string | null; role: string | null; name: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      panel: el?.closest('[data-nqt-panel]')?.getAttribute('data-nqt-title') ?? null,
      role: el?.getAttribute('role') ?? null,
      name: (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim(),
    }
  })
}

/** Press a key until the focused element matches, as a keyboard user would; fails after `limit`. */
export async function pressUntil(page: Page, key: string, done: () => Promise<boolean>, limit = 40): Promise<number> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await done()) return presses
    await page.keyboard.press(key)
  }
  throw new Error(`${key} pressed ${limit} times without reaching the target`)
}

/** The flow's end state: GET only, same origin, client header, no errors, no CSP report, fence held. */
export async function expectCleanFlow(page: Page, watch: FlowWatch): Promise<void> {
  const origin = new URL(page.url()).origin
  expect(watch.requests.length).toBeGreaterThan(0)
  expect(nonGetRequests(watch.requests.map((r) => ({ method: r.method(), url: r.url() })), origin)).toEqual([])
  const api = watch.requests.filter((r) => new URL(r.url()).pathname.startsWith('/api/'))
  expect(api.length).toBeGreaterThan(0)
  const headers = await Promise.all(api.map((r) => r.headerValue(CLIENT_HEADER)))
  const unmarked = api.filter((_, i) => headers[i] !== CLIENT_NAME).map((r) => r.url())
  expect(unmarked).toEqual([])
  expect(watch.errors).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __nqtCsp: string[] }).__nqtCsp)).toEqual([])
  await Promise.all(watch.priceReads)
  expect(watch.fence).toEqual([])
}
