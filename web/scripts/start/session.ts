// The launchers' side of the backend's session door (03 sections 2.4 and 4.2): read the lock file the backend holds,
// check the backend's identity with a fresh nonce, and mint a one-time launch code with the token. Shared by the
// Node launcher, the Vite dev proxy (it reads the port from the lock) and the Playwright global set-ups.
//
// The token is the backend's master secret. It lives in the lock file and in memory here; it is never put in a URL,
// a log line, an argument list or an environment variable. Every request goes to 127.0.0.1 and nowhere else.
// Plain erasable TypeScript: scripts/start.mjs reaches this through the launcher under Node 24.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { get } from 'node:http'
import { join } from 'node:path'

export const LOOPBACK = '127.0.0.1'
export const LOCK_NAME = 'backend.lock'
export const LOCK_VERSION = 1
export const CODE_PATTERN = /^[0-9a-f]{64}$/
export const SESSION_PAGE = 'session.html'
const HEX64 = /^[0-9a-f]{64}$/
const MAX_LOCK_BYTES = 64 * 1024
const MAX_BODY_BYTES = 65_536
const REQUEST_TIMEOUT_MS = 3000

export interface LockInfo {
  readonly pid: number
  readonly port: number
  readonly token: string
  readonly root: string
  readonly started: string
}

/** What a repr, a log line or a failed assertion may show of a lock: everything but the token. */
export function describeLock(info: LockInfo): string {
  return `lock(pid ${info.pid}, port ${info.port})`
}

export function lockPath(stateDir: string): string {
  return join(stateDir, LOCK_NAME)
}

/** The lock's contents, or null when the file is missing, unreadable, too large, malformed or of another version. */
export function parseLock(text: string): LockInfo | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof doc !== 'object' || doc === null) return null
  const fields = doc as Record<string, unknown>
  const { v, pid, port, token, root, started } = fields
  if (v !== LOCK_VERSION) return null
  if (!Number.isInteger(pid) || !Number.isInteger(port)) return null
  if ((port as number) < 1 || (port as number) > 65_535) return null
  if (typeof token !== 'string' || !HEX64.test(token)) return null
  if (typeof root !== 'string' || typeof started !== 'string') return null
  return { pid: pid as number, port: port as number, token, root, started }
}

/**
 * Reads `<stateDir>/backend.lock`. The backend holds the file open with share-read only, which Node's reads allow.
 * This does not decide whether the holder is alive: `verifyBackend` does, with a proof.
 */
export function readLock(stateDir: string): LockInfo | null {
  let text: string
  try {
    text = readFileSync(lockPath(stateDir), { encoding: 'utf8', flag: 'r' })
  } catch {
    return null
  }
  return text.length > MAX_LOCK_BYTES ? null : parseLock(text)
}

/** HMAC-SHA256 keyed by the token's 32 raw bytes over `kind|nonce|port|pid` (backend desktop/handshake.py `mac`). */
export function mac(token: string, kind: 'ready' | 'proof', nonce: string, port: number, pid: number): string {
  return createHmac('sha256', Buffer.from(token, 'hex')).update(`${kind}|${nonce}|${port}|${pid}`, 'ascii').digest('hex')
}

export function newNonce(): string {
  return randomBytes(32).toString('hex')
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** Whether a proof route answer is the MAC the token holder would give for this nonce, port and pid. */
export function verifyProof(body: unknown, token: string, nonce: string, port: number): boolean {
  if (typeof body !== 'object' || body === null) return false
  const { proof, pid } = body as Record<string, unknown>
  if (typeof proof !== 'string' || !HEX64.test(proof) || !Number.isInteger(pid)) return false
  const expected = Buffer.from(mac(token, 'proof', nonce, port, pid as number), 'hex')
  const given = Buffer.from(proof, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}


export interface Reply {
  readonly status: number
  readonly body: string
}

/** One GET to 127.0.0.1 with the given headers; null when the request fails, times out or aims elsewhere. */
export function getLoopback(url: string, headers: Readonly<Record<string, string>> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Reply | null> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolve(null)
      return
    }
    if (target.protocol !== 'http:' || target.hostname !== LOOPBACK) {
      resolve(null)
      return
    }
    const request = get(target, { agent: false, timeout: timeoutMs, headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        if (body.length < MAX_BODY_BYTES) body += chunk
      })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      response.on('error', () => resolve(null))
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function proofUrl(port: number, nonce: string): string {
  return `http://${LOOPBACK}:${port}/api/desktop/proof?nonce=${nonce}`
}

/**
 * Asks the backend on `connectPort` to prove itself with a fresh nonce and checks the answer with `token`.
 * `macPort` is the port the backend signs (the lock's port); it differs from `connectPort` only for a test backend
 * that listens on one port and names another in its settings (the Playwright fixture).
 */
export async function verifyBackend(token: string, connectPort: number, macPort: number = connectPort, expectedPid?: number): Promise<boolean> {
  const nonce = newNonce()
  const reply = await getLoopback(proofUrl(connectPort, nonce))
  if (reply === null || reply.status !== 200) return false
  const body = parseJson(reply.body)
  if (!verifyProof(body, token, nonce, macPort)) return false
  return expectedPid === undefined || (body as { pid: number }).pid === expectedPid
}

/** The backend answers the proof route at all (no token needed): it is a terminal backend of this generation. */
export async function answersProof(port: number): Promise<boolean> {
  const reply = await getLoopback(proofUrl(port, newNonce()))
  if (reply === null || reply.status !== 200) return false
  const body = parseJson(reply.body)
  return typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).proof === 'string'
}

/** `GET /api/session/code` with the token: a launch code that works once and lives 60 s. Null when refused. */
export async function mintCode(port: number, token: string): Promise<string | null> {
  const reply = await getLoopback(`http://${LOOPBACK}:${port}/api/session/code`, { authorization: `NQT ${token}` })
  if (reply === null || reply.status !== 200) return null
  const code = (parseJson(reply.body) as { code?: unknown } | null)?.code
  return typeof code === 'string' && CODE_PATTERN.test(code) ? code : null
}

/** The page that redeems a code: the code travels in the fragment, which no server request line ever carries. */
export function sessionUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/${SESSION_PAGE}#${code}`
}

/** The code in a session URL's fragment, or null when the URL has none or it is malformed. */
export function codeFromUrl(url: string): string | null {
  try {
    const fragment = new URL(url).hash.replace(/^#/, '')
    return CODE_PATTERN.test(fragment) ? fragment : null
  } catch {
    return null
  }
}
