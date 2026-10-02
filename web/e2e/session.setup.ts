// Global set-up of the Playwright run (playwright.config.ts): gets a session for the preview origin behind the token.
// The fixture backend has its own temporary state folder, so its lock holds its own token. This reads it, mints a
// one-time launch code, redeems it on the preview origin through session.html in a headless browser and saves the
// cookie as storage state; `use.storageState` hands it to every test context. The config passes where everything is
// in NQT_E2E_SESSION (it runs in this same process, before the tests start, after the web servers are up).
import { establishSession } from '../scripts/start/sessionSetup.ts'

interface E2eSession {
  readonly stateDir: string
  readonly apiPort: number
  readonly webOrigin: string
  readonly storage: string
}

function describedSession(): E2eSession {
  const raw = process.env.NQT_E2E_SESSION
  if (raw === undefined || raw === '') throw new Error('NQT_E2E_SESSION is not set: run this through playwright.config.ts')
  const parsed = JSON.parse(raw) as Partial<E2eSession>
  if (typeof parsed.stateDir !== 'string' || typeof parsed.apiPort !== 'number' || typeof parsed.webOrigin !== 'string' || typeof parsed.storage !== 'string') {
    throw new Error('NQT_E2E_SESSION is malformed')
  }
  return { stateDir: parsed.stateDir, apiPort: parsed.apiPort, webOrigin: parsed.webOrigin, storage: parsed.storage }
}

export default async function globalSetup(): Promise<void> {
  await establishSession(describedSession())
}
