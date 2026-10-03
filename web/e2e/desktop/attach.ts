// The attach contract between the measurement harness (desktop/harness/modes/t8.mjs) and this project: when the harness has
// already started a smoke shell, it names the shell's debugging port and the page server it loaded, and the project drives that
// shell instead of launching its own. Both variables or neither; a loopback address only; never the owner's port 8765.
import { OWNER_PORT } from './launch.ts'

export const ATTACH_CDP_ENV = 'NQT_DESKTOP_ATTACH_CDP'
export const ATTACH_URL_ENV = 'NQT_DESKTOP_ATTACH_URL'

export interface AttachTarget {
  /** `http://127.0.0.1:<port>`: the engine's debugging port. */
  readonly cdpUrl: string
  /** The page server's origin, with no trailing slash. */
  readonly origin: string
}

const MIN_PORT = 1024
const MAX_PORT = 65535

function portOf(text: string, what: string): number {
  const port = Number(text)
  if (!/^\d+$/.test(text) || port < MIN_PORT || port > MAX_PORT || port === OWNER_PORT) throw new Error(`${what} is not a usable port: ${text}`)
  return port
}

/** The shell to attach to, or null when the project is to launch its own. A half-set or unsafe pair throws. */
export function attachTarget(env: NodeJS.ProcessEnv): AttachTarget | null {
  const cdp = env[ATTACH_CDP_ENV] ?? ''
  const url = env[ATTACH_URL_ENV] ?? ''
  if (cdp === '' && url === '') return null
  if (cdp === '' || url === '') throw new Error(`${ATTACH_CDP_ENV} and ${ATTACH_URL_ENV} go together`)
  const debugging = portOf(cdp, ATTACH_CDP_ENV)
  const match = /^http:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(url)
  if (match === null) throw new Error(`${ATTACH_URL_ENV} must be http://127.0.0.1:<port>/ : ${url}`)
  const served = portOf(match[1] ?? '', ATTACH_URL_ENV)
  return { cdpUrl: `http://127.0.0.1:${debugging}`, origin: `http://127.0.0.1:${served}` }
}
