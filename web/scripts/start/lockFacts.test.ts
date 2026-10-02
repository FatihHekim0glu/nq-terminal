// What the Node launcher learns about the lab's backend (03 sections 2.1 and 2.6): is a terminal answering on a port,
// and what does the lock file of the state folder say (none, stale, live, unproven, untrusted). A backend is `live`
// only when its pid exists and it answers a fresh nonce with the token holder's MAC; the token is never sent to
// anything that has not done that. Servers are fake and on ephemeral loopback ports, state folders are scratch.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gatherFacts, lockFact, portState, stateDirOf } from './facts.ts'
import { mac, newToken } from './session.ts'

const WINDOWS = process.platform === 'win32'
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
  const dir = mkdtempSync(join(tmpdir(), 'nqt-lockfacts-'))
  scratch.push(dir)
  return dir
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

/** A backend of the test's making: answers the proof route signed with `key`, as pid `pid`, for the port it names. */
function prover(key: string, pid: number, macPort: () => number): Promise<number> {
  return listen((req, res) => {
    const url = new URL(req.url ?? '', 'http://x')
    if (url.pathname !== '/api/desktop/proof') {
      res.statusCode = 404
      res.end('{}')
      return
    }
    const nonce = url.searchParams.get('nonce') ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ proof: mac(key, 'proof', nonce, macPort(), pid), pid }))
  })
}

function plant(state: string, port: number, token: string, pid: number, mode = 0o600): void {
  mkdirSync(state, { recursive: true })
  const file = join(state, 'backend.lock')
  writeFileSync(file, JSON.stringify({ v: 1, pid, port, token, root: 'lab', started: 'now' }))
  if (!WINDOWS) chmodSync(file, mode)
}

/** A pid that existed a moment ago and does not now. */
function deadPid(): number {
  const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true })
  return Number(run.stdout)
}

describe('portState', () => {
  it('is terminal for the proof route of this generation, and for the health route of an older one', async () => {
    const token = newToken()
    const proving = await prover(token, process.pid, () => 0)
    const legacy = await listen((req, res) => res.end(req.url === '/api/health' ? '{"fence":"ok"}' : 'x'))
    expect(await portState(proving)).toBe('terminal')
    expect(await portState(legacy)).toBe('terminal')
  })

  it('is busy for anything else that answers, and free for a closed port', async () => {
    const other = await listen((_req, res) => res.end('<html>a dev server</html>'))
    const closed = await listen((_req, res) => res.end('x'))
    servers.at(-1)?.closeAllConnections()
    servers.at(-1)?.close()
    expect(await portState(other)).toBe('busy')
    expect(await portState(closed)).toBe('free')
  })
})

describe('stateDirOf', () => {
  it('is NQT_STATE_DIR when given, else terminal/state', () => {
    const dir = tmp()
    expect(stateDirOf('/lab/terminal', { NQT_STATE_DIR: dir })).toBe(dir)
    expect(stateDirOf('/lab/terminal', {})).toBe(join('/lab/terminal', 'state'))
    expect(stateDirOf('/lab/terminal', { NQT_STATE_DIR: '  ' })).toBe(join('/lab/terminal', 'state'))
  })
})

describe('lockFact', () => {
  it('is none without a lock file, and for a lock that is not one', async () => {
    const state = tmp()
    expect(await lockFact(state, process.platform)).toEqual({ state: 'none', port: null })
    writeFileSync(join(state, 'backend.lock'), 'garbage')
    expect(await lockFact(state, process.platform)).toEqual({ state: 'none', port: null })
  })

  it('is live for a running backend that proves itself with the lock token', async () => {
    const token = newToken()
    let port = 0
    port = await prover(token, process.pid, () => port)
    const state = tmp()
    plant(state, port, token, process.pid)
    expect(await lockFact(state, process.platform)).toEqual({ state: 'live', port })
  })

  it('is stale when the pid is gone, without asking anything the token', async () => {
    const asked: string[] = []
    const port = await listen((req, res) => {
      asked.push(req.headers.authorization ?? '')
      res.end('{}')
    })
    const state = tmp()
    plant(state, port, newToken(), deadPid())
    expect(await lockFact(state, process.platform)).toEqual({ state: 'stale', port })
    expect(asked).toEqual([])
  })

  it('is unproven when the pid is alive but the backend does not sign with the lock token, and never sends it the token', async () => {
    const authorisations: Array<string | undefined> = []
    let port = 0
    port = await listen((req, res) => {
      authorisations.push(req.headers.authorization)
      const nonce = new URL(req.url ?? '', 'http://x').searchParams.get('nonce') ?? ''
      res.end(JSON.stringify({ proof: mac(newToken(), 'proof', nonce, port, process.pid), pid: process.pid }))
    })
    const state = tmp()
    plant(state, port, newToken(), process.pid)
    expect(await lockFact(state, process.platform)).toEqual({ state: 'unproven', port })
    expect(authorisations.length).toBeGreaterThan(0)
    expect(authorisations.every((a) => a === undefined)).toBe(true)
  })

  it('is unproven when the backend answers as another pid than the lock names', async () => {
    const token = newToken()
    let port = 0
    port = await prover(token, process.pid + 1, () => port)
    const state = tmp()
    plant(state, port, token, process.pid)
    expect((await lockFact(state, process.platform)).state).toBe('unproven')
  })

  it.skipIf(WINDOWS)('is untrusted when other accounts can read or write the file (mode 0600 is required), and asks nothing', async () => {
    const asked: string[] = []
    const port = await listen((req, res) => {
      asked.push(req.url ?? '')
      res.end('{}')
    })
    const state = tmp()
    plant(state, port, newToken(), process.pid, 0o644)
    expect(await lockFact(state, process.platform)).toEqual({ state: 'untrusted', port })
    expect(asked).toEqual([])
  })
})

describe('gatherFacts reads the lock of its state folder', () => {
  it('reports the folder and a live backend', async () => {
    const token = newToken()
    let port = 0
    port = await prover(token, process.pid, () => port)
    const state = tmp()
    plant(state, port, token, process.pid)
    const terminal = tmp()
    mkdirSync(join(terminal, 'web'), { recursive: true })
    writeFileSync(join(terminal, 'web', 'package.json'), JSON.stringify({ engines: { node: '>=24' } }))
    const facts = await gatherFacts({ terminalDir: terminal, env: { ...process.env, NQT_STATE_DIR: state }, ports: [port] })
    expect(facts.stateDir).toBe(state)
    expect(facts.lock).toEqual({ state: 'live', port })
    expect(facts.ports[String(port)]).toBe('terminal')
  }, 60_000)
})
