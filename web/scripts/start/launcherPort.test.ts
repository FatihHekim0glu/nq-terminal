// Both browser launchers (start.ps1 and ./start.sh through the Node launcher) start their backend with NQT_PORT=8765
// and never port 0 (03 sections 2.1 and 10.4). The owner's ten localStorage keys live in the storage of the origin
// http://127.0.0.1:8765 and nowhere else, and copied #go= links name that port, so a browser launcher that bound a
// random port would strand the saved workspaces before the one-time import has read them. Port 0 belongs to a backend
// the app starts. This test is the guard: it reads both launchers' text and their plans, and it is born failing on a
// launcher that picks port 0, binds a random port, or lets the port option reach 0.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BACKEND_PORT, parseArgs, planStart, resolveMode, type Facts, type StartOptions } from './plan.ts'

const WEB = fileURLToPath(new URL('../..', import.meta.url))
const TERMINAL = join(WEB, '..')
const START_PS1 = join(TERMINAL, 'start.ps1')
const PS1 = readFileSync(START_PS1, 'utf8')
const PLAN_TS = readFileSync(join(WEB, 'scripts', 'start', 'plan.ts'), 'utf8')
const LAUNCHER_TS = readFileSync(join(WEB, 'scripts', 'start', 'launcher.ts'), 'utf8')
const WINDOWS = process.platform === 'win32'

/** The script's text without whole-line comments, so the prose around the code cannot satisfy or break a check. */
function code(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** What a launcher's text says about the port it gives the backend: every place it sets NQT_PORT, and any port 0. */
export function portProblems(text: string): string[] {
  const problems: string[] = []
  if (/NQT_PORT['"]?\s*[:=]\s*['"]?0['"]?(?!\d)/.test(text)) problems.push('sets NQT_PORT to 0')
  if (/--port['"]?,?\s*['"]?0['"]?(?![\d.])/.test(text)) problems.push('passes --port 0')
  if (/NQT_DESKTOP/.test(text)) problems.push('sets NQT_DESKTOP, the mode that binds port 0')
  if (/\bport\s*=\s*0\b/i.test(text)) problems.push('assigns port 0')
  return problems
}

describe('born failing: a launcher that binds port 0 is caught', () => {
  it('flags each way of asking for a random port', () => {
    expect(portProblems("env: { NQT_PORT: '0' }")).toEqual(['sets NQT_PORT to 0'])
    expect(portProblems('$env:NQT_PORT = "0"')).toEqual(['sets NQT_PORT to 0'])
    expect(portProblems("argv: ['-m', 'uvicorn', '--port', '0']")).toEqual(['passes --port 0'])
    expect(portProblems("$env:NQT_DESKTOP = '1'")).toEqual(['sets NQT_DESKTOP, the mode that binds port 0'])
    expect(portProblems('[int]$Port = 0')).toEqual(['assigns port 0'])
  })

  it('does not flag 8765, or ports that merely contain a 0', () => {
    expect(portProblems("env: { NQT_PORT: '8765' }")).toEqual([])
    expect(portProblems('$env:NQT_PORT = "$Port"')).toEqual([])
    expect(portProblems("'--port', '8790'")).toEqual([])
    expect(portProblems('[int]$Port = 8765')).toEqual([])
  })
})

describe('start.ps1', () => {
  it('defaults to port 8765 and passes it to the backend as NQT_PORT', () => {
    expect(code(PS1)).toMatch(/\[int\]\$Port\s*=\s*8765\b/)
    expect(code(PS1)).toMatch(/\$env:NQT_PORT\s*=\s*"\$Port"/)
  })

  it('cannot be given port 0: the parameter range starts at 1024', () => {
    expect(code(PS1)).toMatch(/\[ValidateRange\(1024,\s*65535\)\]\s*\[int\]\$Port/)
  })

  it('has no port 0, no random-port mode and no desktop mode', () => {
    expect(portProblems(code(PS1))).toEqual([])
  })

  it('starts the backend with the stdin channel on, never the app mode', () => {
    expect(code(PS1)).toMatch(/\$env:NQT_STDIN_CONTROL\s*=\s*'1'/)
  })

  it.runIf(WINDOWS)('plans NQT_PORT=8765 by default and refuses -Port 0', () => {
    const run = (args: string[]): { status: number | null; out: string } => {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', START_PS1, '-DryRun', '-NoBrowser', ...args], {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
      })
      return { status: r.status, out: `${r.stdout}${r.stderr}` }
    }
    const plan = run([])
    expect(plan.status, plan.out).toBe(0)
    expect(plan.out).toContain('NQT_PORT=8765')
    expect(plan.out).not.toMatch(/NQT_PORT=0\b/)
    const zero = run(['-Port', '0'])
    expect(zero.status).not.toBe(0)
  })
})

const READY = { path: '/lab/.venv/bin/python', exists: true, fastapi: true, nqLab: true }

function facts(over: Partial<Facts> = {}): Facts {
  return {
    platform: 'darwin',
    requiredNode: 24,
    node: { version: 'v24.21.0', path: '/n/bin/node' },
    terminalDir: '/lab/terminal',
    labRoot: '/lab',
    python: READY,
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

function options(argv: string[]): StartOptions {
  const parsed = parseArgs(argv)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.options
}

describe('the Node launcher (./start.sh)', () => {
  it('uses the fixed browser port 8765', () => {
    expect(BACKEND_PORT).toBe(8765)
  })

  it('gives every backend step NQT_PORT=8765 by default: plain, fixture and --dev', () => {
    const cases: Array<[string[], Partial<Facts>]> = [
      [[], {}],
      [['--no-build'], {}],
      [[], { fixtureDir: '/fx' }],
      [['--dev'], {}],
      [[], { buildNeeded: true, webDeps: false }],
    ]
    let backends = 0
    for (const [argv, over] of cases) {
      const opts = options(argv)
      const f = facts(over)
      const resolved = resolveMode(opts, f)
      if (!resolved.ok) throw new Error(resolved.error)
      const plan = planStart(opts, f, resolved)
      for (const step of plan.steps.filter((s) => s.argv.includes('nq_terminal') || s.argv.includes('nq_terminal.app:create_app'))) {
        backends += 1
        expect(step.env.NQT_PORT).toBe('8765')
        expect(step.env).not.toHaveProperty('NQT_DESKTOP')
        expect(plan.port).toBe(8765)
        const port = step.argv.indexOf('--port')
        if (port >= 0) expect(step.argv[port + 1]).toBe('8765')
      }
    }
    expect(backends).toBe(cases.length)
  })

  it('passes the port asked for, and never 0', () => {
    const opts = options(['--port', '8790'])
    const f = facts()
    const resolved = resolveMode(opts, f)
    if (!resolved.ok) throw new Error(resolved.error)
    const plan = planStart(opts, f, resolved)
    expect(plan.steps.at(-1)?.env.NQT_PORT).toBe('8790')
  })

  it('refuses --port 0 and every port below 1024', () => {
    for (const bad of ['0', '1', '1023', '00']) {
      const parsed = parseArgs(['--port', bad])
      expect(parsed.ok, `--port ${bad}`).toBe(false)
    }
  })

  it('has no port 0, no random-port mode and no desktop mode in its text', () => {
    expect(portProblems(code(PLAN_TS))).toEqual([])
    expect(portProblems(code(LAUNCHER_TS))).toEqual([])
  })
})
