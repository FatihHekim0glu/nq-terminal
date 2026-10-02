// Global set-up of the real-data smoke run (real.config.ts): redeems the one-time launch code that smoke_real.ps1 minted
// with the token of its second backend, on the preview origin, and saves the cookie as Playwright storage state.
// The script passes the session page address in NQT_SMOKE_SESSION_URL (http://127.0.0.1:<web port>/session.html#<code>);
// a code works once and lives 60 seconds, so it is used here, at once, in a headless browser, and dropped from the
// environment. The preview origin is the one the session is bound to. The cookie file is removed when the run ends.
import { rmSync } from 'node:fs'
import { codeFromUrl } from '../../scripts/start/session.ts'
import { redeemInBrowser } from '../../scripts/start/sessionSetup.ts'

const USER_BACKEND_PORT = 8765

export default async function globalSetup(): Promise<() => void> {
  const link = process.env.NQT_SMOKE_SESSION_URL ?? ''
  const origin = process.env.NQT_SMOKE_WEB_ORIGIN ?? ''
  const storage = process.env.NQT_SMOKE_STORAGE_STATE ?? ''
  delete process.env.NQT_SMOKE_SESSION_URL
  if (storage === '') throw new Error('NQT_SMOKE_STORAGE_STATE is not set: run this through e2e/perf/real.config.ts')
  if (new URL(origin).port === String(USER_BACKEND_PORT)) throw new Error(`the smoke run never uses port ${USER_BACKEND_PORT}`)
  if (!link.startsWith(`${origin}/session.html#`) || codeFromUrl(link) === null) {
    throw new Error(`NQT_SMOKE_SESSION_URL must be ${origin}/session.html#<launch code>: run terminal/scripts/smoke_real.ps1, which mints it`)
  }
  await redeemInBrowser(link, storage)
  return () => rmSync(storage, { force: true })
}
