// ./start.sh doctor: one line per check, 'ok    ...' or 'FAIL  ...' with the fix, and a last line that names the mode
// and the next command. The exact lines for a demo-only machine and for a full one are pinned here.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctorLines } from './doctor.ts'
import { resolveMode, type Facts, type StartOptions } from './plan.ts'

const AUTO: StartOptions = { command: 'doctor', mode: 'auto', dev: false, port: null, browser: true, build: true, dryRun: false }
const READY = { path: '/lab/.venv/bin/python', exists: true, fastapi: true, nqLab: true }
const NO_PYTHON = { path: '/lab/.venv/bin/python', exists: false, fastapi: false, nqLab: false }

function facts(over: Partial<Facts> = {}): Facts {
  return {
    platform: 'darwin',
    requiredNode: 24,
    node: { version: 'v24.21.0', path: '/n/bin/node' },
    terminalDir: '/lab/terminal',
    labRoot: '/lab',
    python: NO_PYTHON,
    webDeps: true,
    corepack: true,
    browser: { bundled: false, chrome: true },
    ports: { '8765': 'free', '5173': 'free', '5174': 'free' },
    contract: 'in sync',
    fixtureDir: null,
    buildNeeded: false,
    stateDir: '/lab/terminal/state',
    lock: { state: 'none', port: null },
    ...over,
  }
}

function lines(f: Facts): string[] {
  const resolved = resolveMode(AUTO, f)
  if (!resolved.ok) throw new Error(resolved.error)
  return doctorLines(f, resolved)
}

describe('doctorLines', () => {
  it('reports a demo-only machine line by line, and ends with the mode and the next command', () => {
    expect(lines(facts())).toEqual([
      'ok    node 24.21.0 at /n/bin/node (needs 24 or later)',
      `ok    web dependencies installed (${join('/lab/terminal', 'web', 'node_modules')})`,
      'ok    corepack on PATH',
      'ok    browser for Playwright: Google Chrome',
      'FAIL  no venv python at /lab/.venv/bin/python. Fix: run uv sync in /lab',
      'FAIL  fastapi and uvicorn cannot be imported (no venv python). Fix: run uv sync in /lab',
      'FAIL  nq_lab not found. Fix: put this folder inside the nq-lab checkout, or set NQT_LAB_ROOT to the nq-lab folder that holds .venv',
      'ok    port 8765 is free (terminal backend)',
      'ok    port 5173 is free (Vite dev server)',
      'ok    port 5174 is free (demo)',
      'ok    API types are in sync with the contract',
      'ok    web/dist is up to date',
      'mode: DEMO ONLY (nq_lab not found). Next: ./start.sh',
    ])
  })

  it('reports a full machine line by line', () => {
    const f = facts({
      python: READY,
      browser: { bundled: true, chrome: true },
      ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' },
      buildNeeded: true,
      lock: { state: 'live', port: 8765 },
    })
    expect(lines(f)).toEqual([
      'ok    node 24.21.0 at /n/bin/node (needs 24 or later)',
      `ok    web dependencies installed (${join('/lab/terminal', 'web', 'node_modules')})`,
      'ok    corepack on PATH',
      'ok    browser for Playwright: bundled Chromium',
      'ok    venv python at /lab/.venv/bin/python',
      'ok    fastapi and uvicorn import in the venv',
      'ok    nq_lab imports in the venv',
      'ok    port 8765 answers as the terminal (./start.sh attaches to it with a one-time link and starts nothing)',
      'ok    port 5173 is free (Vite dev server)',
      'ok    port 5174 is free (demo)',
      'ok    lock in /lab/terminal/state names a live backend on port 8765 that proved who it is (./start.sh attaches to it)',
      'ok    API types are in sync with the contract',
      'ok    web/dist is older than the sources (a full start rebuilds it)',
      'mode: FULL (venv python with fastapi, uvicorn and nq_lab). Next: ./start.sh',
    ])
  })

  it('adds the fixture folder and ends on FIXTURE when NQT_FIXTURE_DIR is set', () => {
    const out = lines(facts({ python: READY, fixtureDir: '/fx' }))
    expect(out).toContain('ok    fixture folder /fx (NQT_FIXTURE_DIR): the backend serves its files')
    expect(out[out.length - 1]).toBe('mode: FIXTURE (NQT_FIXTURE_DIR is set; venv python with fastapi, uvicorn and nq_lab). Next: ./start.sh')
  })

  it('fails Node when it is too old, with the way out', () => {
    const out = lines(facts({ node: { version: 'v20.20.2', path: '/o/node' } }))
    expect(out[0]).toBe(
      'FAIL  node 20.20.2 at /o/node is too old (needs 24 or later). Fix: nvm install 24, or set NQT_NODE to a Node 24 binary',
    )
  })

  it('names the fix for each missing tool', () => {
    const out = lines(facts({ webDeps: false, corepack: false, browser: { bundled: false, chrome: false } }))
    expect(out).toContain(
      `FAIL  web dependencies are missing (no node_modules/vite in ${join('/lab/terminal', 'web')}). Fix: ./start.sh installs them, or run corepack pnpm install --frozen-lockfile in web`,
    )
    expect(out).toContain('FAIL  corepack not found on PATH. Fix: install Node 24 (it ships corepack), then run corepack enable')
    expect(out).toContain(
      'FAIL  no browser for Playwright. Fix: run corepack pnpm exec playwright install chromium in web, or install Google Chrome',
    )
  })

  it('tells a venv without fastapi from a missing venv', () => {
    const out = lines(facts({ python: { ...READY, fastapi: false } }))
    expect(out).toContain('ok    venv python at /lab/.venv/bin/python')
    expect(out).toContain('FAIL  fastapi and uvicorn cannot be imported by the venv python. Fix: run uv sync in /lab')
    expect(out).toContain('ok    nq_lab imports in the venv')
    expect(out[out.length - 1]).toBe('mode: DEMO ONLY (fastapi or uvicorn missing in the venv). Next: ./start.sh')
  })

  it('says nothing about the lock when there is none, and words each state when there is one', () => {
    expect(lines(facts()).some((l) => l.includes('lock'))).toBe(false)
    const state = (lock: Facts['lock']): string[] => lines(facts({ lock })).filter((l) => l.includes('lock in '))
    expect(state({ state: 'stale', port: 8765 })).toEqual(['ok    lock in /lab/terminal/state is stale (its backend is gone); the next start replaces it'])
    expect(state({ state: 'unproven', port: 53117 })).toEqual([
      'FAIL  lock in /lab/terminal/state names a backend on port 53117 that does not prove who it is. Fix: stop it, or set NQT_STATE_DIR to another folder',
    ])
    expect(state({ state: 'untrusted', port: 8765 })).toEqual([
      'FAIL  lock in /lab/terminal/state is not owner-only, so it is not used. Fix: remove the file if you did not expect it',
    ])
  })

  it('calls a terminal on 8765 without a lock an older version that has to be closed', () => {
    const out = lines(facts({ ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(out).toContain('FAIL  port 8765 answers as a terminal that has no lock or token (an older version). Fix: close it, then run ./start.sh')
  })

  it('reports a port taken by another program with the way out', () => {
    const out = lines(facts({ ports: { '8765': 'busy', '5173': 'busy', '5174': 'free' } }))
    expect(out).toContain('FAIL  port 8765 is taken by another program (terminal backend). Fix: stop that program, or choose another port with --port')
    // Only --dev uses 5173, and --dev cannot move it, so --port is no way out there.
    expect(out).toContain('FAIL  port 5173 is taken by another program (Vite dev server). Fix: stop that program (only --dev needs this port)')
    expect(out).toContain('ok    port 5174 is free (demo)')
  })

  it('reports the port asked for with --port as well', () => {
    const out = lines(facts({ ports: { '8765': 'free', '5173': 'free', '5174': 'free', '5193': 'busy' } }))
    expect(out).toContain('FAIL  port 5193 is taken by another program (asked for with --port). Fix: stop that program, or choose another port with --port')
  })

  it('reports the API contract check in all three states', () => {
    expect(lines(facts({ contract: 'stale' }))).toContain(
      'FAIL  API types are out of date with the contract. Fix: run corepack pnpm gen:api in web',
    )
    expect(lines(facts({ contract: 'unknown' }))).toContain(
      'FAIL  could not check the API types against the contract. Fix: install the web dependencies, then run corepack pnpm check:api in web',
    )
  })

  it('always ends on the mode line, and every other line starts with ok or FAIL', () => {
    const variants = [
      facts(),
      facts({ python: READY }),
      facts({ python: READY, fixtureDir: '/fx', buildNeeded: true }),
      facts({ webDeps: false, corepack: false, contract: 'unknown', ports: { '8765': 'busy', '5173': 'terminal', '5174': 'busy' } }),
      facts({ node: { version: 'v18.0.0', path: '/x' } }),
    ]
    for (const f of variants) {
      const out = lines(f)
      expect(out[out.length - 1]).toMatch(/^mode: (FULL|FIXTURE|DEMO ONLY) \(.+\)\. Next: \.\/start\.sh$/)
      for (const line of out.slice(0, -1)) expect(line).toMatch(/^(ok {4}|FAIL {2})\S/)
    }
  })

  it('is plain ASCII', () => {
    const f = facts({ python: READY, fixtureDir: '/fx', node: { version: 'v18.0.0', path: '/x' }, contract: 'stale' })
    for (const line of lines(f)) {
      expect([...line].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32)).toEqual([])
    }
  })
})
