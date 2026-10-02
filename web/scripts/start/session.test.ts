// The launchers' view of the backend's session door: the lock file, the identity proof and the launch code.
// The proof vectors come from the backend's own handshake.mac (backend/nq_terminal/desktop/handshake.py), so a drift
// between the two implementations fails here. Servers are fake, on ephemeral loopback ports; nothing fixed is used.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  codeFromUrl,
  describeLock,
  getLoopback,
  mac,
  mintCode,
  parseLock,
  readLock,
  sessionUrl,
  verifyBackend,
  verifyProof,
  answersProof,
} from './session.ts'

const TOKEN = '11'.repeat(32)
const OTHER = '22'.repeat(32)
const NONCE = 'ab'.repeat(32)
const CODE = 'cd'.repeat(32)
const LOCK = { v: 1, pid: 4242, port: 8798, token: TOKEN, root: 'C:\\lab', started: '2026-10-02T10:00:00Z' }

const scratch: string[] = []
const servers: Server[] = []
afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections()
    server.close()
  }
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nqt-session-'))
  scratch.push(dir)
  return dir
}

function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

describe('mac', () => {
  it('matches the backend: the same bytes, the same kinds, nothing shared between them', () => {
    // Vectors from nq_terminal.desktop.handshake.mac(token, kind, nonce, 8798, 4242).
    expect(mac(TOKEN, 'proof', NONCE, 8798, 4242)).toBe('2dc9c42507058a7d6cf7c30a6cffb5db1443b50e3c81edf72150bab862529f52')
    expect(mac(TOKEN, 'ready', NONCE, 8798, 4242)).toBe('34b2e8bb7c48c23cf199735def5fd4c1f9f1e159911103d06ad77103540daacc')
  })
})

describe('verifyProof', () => {
  const good = { proof: mac(TOKEN, 'proof', NONCE, 8798, 4242), pid: 4242 }
  it('accepts the answer of the token holder for this nonce, port and pid', () => {
    expect(verifyProof(good, TOKEN, NONCE, 8798)).toBe(true)
  })
  it('refuses a wrong token, nonce, port or pid, and a READY answer replayed as a proof', () => {
    expect(verifyProof(good, OTHER, NONCE, 8798)).toBe(false)
    expect(verifyProof(good, TOKEN, 'ef'.repeat(32), 8798)).toBe(false)
    expect(verifyProof(good, TOKEN, NONCE, 8799)).toBe(false)
    expect(verifyProof({ ...good, pid: 4243 }, TOKEN, NONCE, 8798)).toBe(false)
    expect(verifyProof({ proof: mac(TOKEN, 'ready', NONCE, 8798, 4242), pid: 4242 }, TOKEN, NONCE, 8798)).toBe(false)
  })
  it('refuses anything that is not a proof body', () => {
    for (const body of [null, 'x', 7, {}, { proof: 'zz', pid: 1 }, { proof: good.proof }, { proof: good.proof, pid: '4242' }]) {
      expect(verifyProof(body, TOKEN, NONCE, 8798)).toBe(false)
    }
  })
})

describe('the lock file', () => {
  it('parses the backend lock format', () => {
    expect(parseLock(JSON.stringify(LOCK))).toEqual({ pid: 4242, port: 8798, token: TOKEN, root: 'C:\\lab', started: LOCK.started })
  })
  it('refuses another version, a short token, a bad port and non-JSON', () => {
    expect(parseLock(JSON.stringify({ ...LOCK, v: 2 }))).toBeNull()
    expect(parseLock(JSON.stringify({ ...LOCK, token: 'abc' }))).toBeNull()
    expect(parseLock(JSON.stringify({ ...LOCK, port: 0 }))).toBeNull()
    expect(parseLock(JSON.stringify({ ...LOCK, port: 70_000 }))).toBeNull()
    expect(parseLock(JSON.stringify({ ...LOCK, pid: 'x' }))).toBeNull()
    expect(parseLock('not json')).toBeNull()
    expect(parseLock('[]')).toBeNull()
  })
  it('reads <state>/backend.lock, and null when there is none', () => {
    const dir = tmp()
    expect(readLock(dir)).toBeNull()
    writeFileSync(join(dir, 'backend.lock'), JSON.stringify(LOCK))
    expect(readLock(dir)?.port).toBe(8798)
    expect(readLock(join(dir, 'missing'))).toBeNull()
  })
  it('never shows the token when described', () => {
    const info = parseLock(JSON.stringify(LOCK))
    expect(info).not.toBeNull()
    expect(describeLock(info!)).not.toContain(TOKEN)
  })
})

describe('the session page address', () => {
  it('carries the code in the fragment only', () => {
    const url = sessionUrl('http://127.0.0.1:8798/', CODE)
    expect(url).toBe(`http://127.0.0.1:8798/session.html#${CODE}`)
    expect(new URL(url).search).toBe('')
    expect(codeFromUrl(url)).toBe(CODE)
  })
  it('reads no code from a URL without a well-formed fragment', () => {
    expect(codeFromUrl('http://127.0.0.1:8798/session.html')).toBeNull()
    expect(codeFromUrl('http://127.0.0.1:8798/session.html#short')).toBeNull()
    expect(codeFromUrl('nonsense')).toBeNull()
  })
})

describe('talking to a backend', () => {
  it('only ever talks to 127.0.0.1 over http', async () => {
    expect(await getLoopback('http://localhost:1/x')).toBeNull()
    expect(await getLoopback('https://127.0.0.1:1/x')).toBeNull()
    expect(await getLoopback('http://10.0.0.1/x')).toBeNull()
  })

  it('verifyBackend accepts a backend that answers with the token holder MAC and refuses a stranger', async () => {
    const honest = await serve((req, res) => {
      const nonce = new URL(req.url ?? '', 'http://x').searchParams.get('nonce') ?? ''
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ proof: mac(TOKEN, 'proof', nonce, 8798, 4242), pid: 4242 }))
    })
    const stranger = await serve((req, res) => {
      const nonce = new URL(req.url ?? '', 'http://x').searchParams.get('nonce') ?? ''
      res.end(JSON.stringify({ proof: mac(OTHER, 'proof', nonce, 8798, 4242), pid: 4242 }))
    })
    const replay = await serve((_req, res) => res.end(JSON.stringify({ proof: mac(TOKEN, 'proof', NONCE, 8798, 4242), pid: 4242 })))
    expect(await verifyBackend(TOKEN, honest, 8798, 4242)).toBe(true)
    expect(await verifyBackend(TOKEN, honest, 8798, 1)).toBe(false) // another pid than the lock names
    expect(await verifyBackend(TOKEN, stranger, 8798)).toBe(false)
    expect(await verifyBackend(TOKEN, replay, 8798)).toBe(false) // a recorded answer cannot answer a fresh nonce
    expect(await answersProof(honest)).toBe(true)
    expect(await answersProof(stranger)).toBe(true) // it speaks the protocol; whose token it holds is verifyBackend's job
  })

  it('mints a code with the token in a header and refuses a refusal', async () => {
    const seen: Array<string | undefined> = []
    const port = await serve((req, res) => {
      seen.push(req.headers.authorization)
      if (req.headers.authorization !== `NQT ${TOKEN}`) {
        res.statusCode = 401
        res.end('{}')
        return
      }
      res.end(JSON.stringify({ code: CODE, expires_in_s: 60 }))
    })
    expect(await mintCode(port, TOKEN)).toBe(CODE)
    expect(await mintCode(port, OTHER)).toBeNull()
    expect(seen).toEqual([`NQT ${TOKEN}`, `NQT ${OTHER}`])
  })

  it('refuses a malformed code in a 200 answer', async () => {
    const port = await serve((_req, res) => res.end(JSON.stringify({ code: 'short' })))
    expect(await mintCode(port, TOKEN)).toBeNull()
  })

  it('treats a port with no server as no answer', async () => {
    const port = await serve((_req, res) => res.end('{}'))
    servers.at(-1)?.closeAllConnections()
    servers.at(-1)?.close()
    expect(await mintCode(port, TOKEN)).toBeNull()
    expect(await verifyBackend(TOKEN, port)).toBe(false)
  })
})
