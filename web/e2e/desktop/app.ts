// Steps the desktop specs share: a fresh HOME in the app's page, the command line, a same-origin API read with the app's
// session, and the one-run-wide clean checks (no console error, no failed answer, every request a same-origin GET).
import { expect, type Page } from '@playwright/test'
import { ORIENTATION_DISMISSED, ORIENTATION_KEY } from '../orientation.ts'
import { HOME_READY, offOriginOrNotGet, panel, runLine, settle, type Watch } from '../perf/pages.ts'

export { commandLine, panel, runLine, settle, watch } from '../perf/pages.ts'
export type { Watch } from '../perf/pages.ts'

/** HOME on a cold backend: a minute on the fixture, three on the real files (the real-data smoke's own allowance). */
const HOME_TIMEOUT_MS = process.env.NQT_DESKTOP_MODE === 'real' ? 180_000 : 60_000

/** Empties the page's own storage (never the session cookie: it is not storage), so the next load is a first-time viewer's. */
export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* a page without storage */ } })
}

/**
 * Clears the page's own storage (never the session cookie: it is not storage) and loads HOME as a first-time viewer sees
 * it, with the first-run orientation line. `dismissed` starts as a returning viewer does (the line adds four Tab stops
 * between the command line and the first panel, so the key walks start without it; e2e/orientation.ts).
 */
export async function openHome(page: Page, options: { readonly dismissed?: boolean } = {}): Promise<void> {
  await page.goto('/')
  await page.evaluate(([key, value]) => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      if (value !== '') localStorage.setItem(key as string, value as string)
    } catch { /* a page without storage */ }
  }, [ORIENTATION_KEY, options.dismissed === true ? ORIENTATION_DISMISSED : ''])
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_READY.length, { timeout: HOME_TIMEOUT_MS })
  await settle(page, HOME_TIMEOUT_MS)
  for (const [title, selectors] of HOME_READY) {
    for (const selector of selectors) await expect(panel(page, title).locator(selector).first()).toBeAttached({ timeout: HOME_TIMEOUT_MS })
  }
}

export interface ApiAnswer {
  readonly status: number
  readonly text: string
}

/** A GET of the app's own origin from inside the page, so it carries the session cookie the shell set. */
export async function apiGet(page: Page, pathAndQuery: string): Promise<ApiAnswer> {
  return page.evaluate(async (url) => {
    const reply = await fetch(url, { credentials: 'same-origin', headers: { 'X-NQT-Client': 'nq-lab-terminal' } })
    return { status: reply.status, text: await reply.text() }
  }, pathAndQuery)
}

/** Every API answer that failed, as `<status> <path>`. */
export function failedAnswers(w: Watch): string[] {
  return w.responses
    .filter((r) => new URL(r.url()).pathname.startsWith('/api/') && r.status() >= 400)
    .map((r) => `${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`)
}

/** The clean-flow checks every walk ends with. */
export function expectClean(w: Watch, origin: string): void {
  expect.soft(w.errors, 'console and page errors').toEqual([])
  expect.soft(failedAnswers(w), 'failed API answers').toEqual([])
  expect(offOriginOrNotGet(w, origin), 'requests that were not same-origin GETs').toEqual([])
}

/** Opens one line in the focused panel; returns the panel that carries it. */
export async function open(page: Page, line: string) {
  const target = await runLine(page, line)
  await settle(page, HOME_TIMEOUT_MS)
  return target
}

/**
 * Runs `body` with the page believing it has focus. A hidden window never has the focus (and must not take it), and the
 * Clipboard API refuses an unfocused document; the emulation changes what the page is told, not the machine's focus.
 */
export async function withFocusEmulation<T>(page: Page, body: () => Promise<T>): Promise<T> {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  try {
    return await body()
  } finally {
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined)
    await session.detach().catch(() => undefined)
  }
}

/** Types a line into the command line and runs it, without waiting for a panel of that title (HOME opens four). */
export async function typeLine(page: Page, line: string): Promise<void> {
  const input = page.getByRole('combobox', { name: 'Command line' })
  await page.keyboard.press('Control+k')
  await expect(input).toBeFocused()
  await input.fill(line)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await settle(page, HOME_TIMEOUT_MS)
}
