// Steps the desktop specs share: a fresh HOME in the app's page, the command line, a same-origin API read with the app's
// session, and the one-run-wide clean checks (no console error, no failed answer, every request a same-origin GET).
import { expect, type Page } from '@playwright/test'
import { ORIENTATION_DISMISSED, ORIENTATION_KEY } from '../orientation.ts'
import { HOME_READY, offOriginOrNotGet, panel, runLine, settle, type Watch } from '../perf/pages.ts'

export { commandLine, panel, runLine, settle, watch } from '../perf/pages.ts'
export type { Watch } from '../perf/pages.ts'

/** HOME on a cold backend: a minute on the fixture, three on the real files (the real-data smoke's own allowance). */
const HOME_TIMEOUT_MS = process.env.NQT_DESKTOP_MODE === 'real' ? 180_000 : 60_000

/**
 * What each of the store's documents holds before anything is written (backend models/workspaces.py default_data). `meta` is
 * left out on purpose: it records which origins were imported, and a reset must not make the page import again.
 */
export const STORE_DEFAULTS: Readonly<Record<string, unknown>> = {
  workspaces: { list: {}, last: null },
  layouts: {},
  linkGroups: { contexts: { A: null, B: null, C: null } },
  watch: {},
  history: [],
  prefs: {},
}

/**
 * Puts the app's workspace store back to its defaults, through the page's own session and the store's own versioned PUT (the
 * only write the page makes). The app keeps the workspace, the link groups and the look in its state folder, so a panel or
 * a theme left by one spec would otherwise open in the next one. A store that is off or unreadable has nothing to reset.
 * `prefs` is the look and settings the next load should find (the page reads them from the store, not from localStorage).
 */
export async function resetWorkspaceStore(page: Page, prefs: Readonly<Record<string, string>> = {}): Promise<void> {
  await page.evaluate(async (defaults) => {
    // First let the page send what it still holds, through the hook the shell itself calls before it stops the backend: a
    // change sent after the reset would carry the old version and the page-hide flush (which never retries) would log a 412.
    const sync = (window as unknown as Record<string, unknown>).__NQT_STORE_SYNC__
    for (let attempt = 0; typeof sync === 'function' && attempt < 50; attempt += 1) {
      const state = JSON.parse((sync as () => string)()) as { pending: number }
      if (state.pending === 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const read = { credentials: 'same-origin', headers: { 'X-NQT-Client': 'nq-lab-terminal' } } as const
    for (const [doc, data] of Object.entries(defaults)) {
      const current = await fetch(`/api/workspaces/${doc}`, read)
      if (!current.ok) continue
      const { version } = (await current.json()) as { version: number }
      if (version === 0) continue
      await fetch(`/api/workspaces/${doc}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'X-NQT-Client': 'nq-lab-terminal', 'X-NQT': '1', 'Content-Type': 'application/json', 'If-Match': String(version) },
        body: JSON.stringify({ data }),
      })
    }
  }, { ...STORE_DEFAULTS, prefs })
}

/** Empties the page's own storage (never the session cookie: it is not storage) and the app's workspace store, so the next load is a first-time viewer's. */
export async function clearStorage(page: Page, prefs: Readonly<Record<string, string>> = {}): Promise<void> {
  await resetWorkspaceStore(page, prefs)
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* a page without storage */ } })
}

/**
 * Clears the page's own storage (never the session cookie: it is not storage) and loads HOME as a first-time viewer sees
 * it, with the first-run orientation line. `dismissed` starts as a returning viewer does (the line adds four Tab stops
 * between the command line and the first panel, so the key walks start without it; e2e/orientation.ts).
 */
export async function openHome(page: Page, options: { readonly dismissed?: boolean } = {}): Promise<void> {
  await page.goto('/')
  // The line's dismissal is a preference: the page reads it from the store, so the store holds it (and so does localStorage).
  const dismissed = options.dismissed === true
  await clearStorage(page, dismissed ? { orientation: ORIENTATION_DISMISSED } : {})
  await page.evaluate(([key, value]) => {
    try {
      if (value !== '') localStorage.setItem(key as string, value as string)
    } catch { /* a page without storage */ }
  }, [ORIENTATION_KEY, dismissed ? ORIENTATION_DISMISSED : ''])
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
