// The Playwright global set-ups' way into a backend behind the token (03 section 2.6): read the token from the lock of
// the backend's own state folder, check that the backend holds it, mint a one-time launch code, open the launch page
// (session.html) on the origin the tests use in a headless browser, and save the cookie it gets as Playwright storage
// state. Going through the page exercises the same door the owner uses: a broken page fails every run at once.
//
// Nothing here prints or returns the token or the code in a message; the link (which holds the code) is passed by
// value and used once. Headless only: no window is ever shown.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { mintCode, readLock, sessionUrl, verifyBackend } from './session.ts'

const LOCK_WAIT_MS = 30_000
const POLL_MS = 200
const REDEEM_TIMEOUT_MS = 30_000
const REDEEM_PATH = '/api/session/redeem'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface MintInput {
  /** The folder whose backend.lock names the backend (its own temporary NQT_STATE_DIR). */
  readonly stateDir: string
  /** The port the backend actually listens on; it differs from the lock's only for the Playwright fixture. */
  readonly apiPort: number
  /** The origin the tests load pages from (the preview server), which the session will be bound to. */
  readonly webOrigin: string
  readonly waitMs?: number
}

/** The session link for `webOrigin`, made with the token of the backend in `stateDir` once it has proved it holds it. */
export async function mintSessionLink(input: MintInput): Promise<string> {
  const end = Date.now() + (input.waitMs ?? LOCK_WAIT_MS)
  let lock = readLock(input.stateDir)
  while (lock === null && Date.now() < end) {
    await sleep(POLL_MS)
    lock = readLock(input.stateDir)
  }
  if (lock === null) throw new Error(`no backend.lock appeared in ${input.stateDir}: the backend did not start, or it holds another state folder`)
  if (!(await verifyBackend(lock.token, input.apiPort, lock.port))) {
    throw new Error(`the backend on 127.0.0.1:${input.apiPort} did not prove that it holds the token in ${input.stateDir}\\backend.lock`)
  }
  const code = await mintCode(input.apiPort, lock.token)
  if (code === null) throw new Error(`the backend on 127.0.0.1:${input.apiPort} did not issue a launch code`)
  return sessionUrl(input.webOrigin, code)
}

/**
 * Opens `link` in a headless browser, waits for the page to redeem its code and leave for the terminal, and saves the
 * browser's cookies to `storage`. The link is the launch page's address (session.html#<code>), single use.
 */
export async function redeemInBrowser(link: string, storage: string): Promise<void> {
  mkdirSync(dirname(storage), { recursive: true })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const redeem = page.waitForResponse((response) => new URL(response.url()).pathname === REDEEM_PATH, { timeout: REDEEM_TIMEOUT_MS })
    await page.goto(link, { waitUntil: 'commit' })
    const answer = await redeem
    if (answer.status() !== 200) {
      throw new Error(`the launch page was refused its session (HTTP ${answer.status()}): the code was used, expired or never issued`)
    }
    // The page leaves for the terminal once the cookie is set; the fragment is already out of the address bar.
    await page.waitForURL((url) => url.pathname === '/' && url.hash === '', { timeout: REDEEM_TIMEOUT_MS, waitUntil: 'commit' })
    await context.storageState({ path: storage })
  } finally {
    await browser.close()
  }
}

/** The whole set-up for a backend behind a preview: mint the link, redeem it, save the cookie. */
export async function establishSession(input: MintInput & { readonly storage: string }): Promise<void> {
  await redeemInBrowser(await mintSessionLink(input), input.storage)
}
