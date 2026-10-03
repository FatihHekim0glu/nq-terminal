// The desktop project's `test`: the page every spec drives is the hidden smoke build's own WebView2 page, attached over the
// Chrome debugging protocol (Microsoft documents `connectOverCDP` for WebView2; 03 section 15.4), never a browser Playwright
// launched. The browser fixture is the attach (with `noDefaults`, so the shell's own download handler and the engine's settings
// stay as the shell made them), the context is the engine's one default context (a WebView2 cannot make another: a new target
// would be a new window, and the shell denies those), and the page is the backend page the shell loaded. Closing any of them is a
// disconnect; the set-up's tear-down ends the app.
//
// The page keeps its state from one test to the next, so a test that changes what the next one sees (an emulated media, a
// frozen clock, storage) undoes it itself. Relative URLs resolve against the backend's origin (the default context has no
// baseURL option), so the shared helpers of e2e/visual and e2e/flows, which `goto('/')`, work unchanged.
import { chromium, test as base, expect, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import { readRun, type RunInfo } from './run.ts'

export const VIEWPORT = { width: 1920, height: 1080 } as const
const PAGE_WAIT_MS = 60_000

interface WorkerFixtures {
  readonly run: RunInfo
  readonly appPage: Page
}

/** The page whose URL is on the backend's origin, waiting for the shell to have navigated there. */
async function backendPage(context: BrowserContext, origin: string): Promise<Page> {
  const end = Date.now() + PAGE_WAIT_MS
  for (;;) {
    const found = context.pages().find((p) => p.url().startsWith(origin))
    if (found !== undefined) return found
    if (Date.now() > end) throw new Error(`no page on ${origin} among ${context.pages().map((p) => p.url()).join(', ')}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/**
 * Attaches to the app on `cdpUrl` and returns its engine and its backend page, with `goto('/...')` resolved against `origin`.
 * `noDefaults`: Playwright leaves the engine's own settings alone. Without it Playwright takes every download itself (the shell's
 * DownloadStarting handler, which writes into --save-dir, never runs and the engine shows its own download window), turns on focus
 * emulation and applies media emulation to the app's page.
 */
export async function attach(cdpUrl: string, origin: string): Promise<{ readonly browser: Browser; readonly page: Page }> {
  const browser = await chromium.connectOverCDP(cdpUrl, { isLocal: true, noDefaults: true })
  const context = browser.contexts()[0]
  if (context === undefined) throw new Error('the engine has no default context')
  const page = await backendPage(context, origin)
  const goto = page.goto.bind(page)
  page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) => goto(url.startsWith('/') ? `${origin}${url}` : url, options)) as Page['goto']
  return { browser, page }
}

/** The look's fixed conditions, as the Windows Chromium baselines were taken: Europe/London and en-GB. */
async function fixedConditions(page: Page): Promise<void> {
  const session: CDPSession = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/London' })
    // A second locale override on the same target is refused by the engine; the first one stays.
    await session.send('Emulation.setLocaleOverride', { locale: 'en-GB' }).catch(() => undefined)
  } finally {
    await session.detach().catch(() => undefined)
  }
}

export const test = base.extend<object, WorkerFixtures & { readonly attached: { readonly browser: Browser; readonly page: Page } }>({
  run: [async ({}, use) => { await use(readRun()) }, { scope: 'worker' }],
  attached: [async ({ run }, use) => {
    const attached = await attach(run.cdpUrl, run.origin)
    await use(attached)
    await attached.browser.close()
  }, { scope: 'worker' }],
  browser: [async ({ attached }, use) => { await use(attached.browser) }, { scope: 'worker' }],
  context: async ({ attached }, use) => {
    const context = attached.browser.contexts()[0]
    if (context === undefined) throw new Error('the engine has no default context')
    await use(context)
  },
  appPage: [async ({ attached }, use) => {
    await fixedConditions(attached.page)
    await use(attached.page)
  }, { scope: 'worker' }],
  page: async ({ appPage }, use) => {
    await appPage.setViewportSize(VIEWPORT)
    await appPage.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await use(appPage)
  },
})

export { expect }
