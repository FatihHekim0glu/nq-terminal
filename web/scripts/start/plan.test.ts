// The launcher's pure planning layer: argument parsing, mode resolution and the exact steps each mode runs.
// Nothing here touches the machine; facts are plain objects. The steps mirror start.ps1 (same uvicorn list,
// same health check, same environment) and are always argv arrays, never shell strings.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatPlan,
  parseArgs,
  planStart,
  resolveMode,
  usageLines,
  type Facts,
  type StartOptions,
  type StartPlan,
} from './plan.ts'

const DIR = '/lab/terminal'
const WEB = join(DIR, 'web')
const VITE = join(WEB, 'node_modules', 'vite', 'bin', 'vite.js')
const NODE = '/n/bin/node'
const PYTHON = '/lab/.venv/bin/python'
const PROMPT_OFF = { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
const BACKEND_ENV = { NQT_PORT: '8765', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
// The plain launcher reads TOKEN and NONCE from the backend's input and asks for the HOME prewarm; --dev and fixtures do not.
const CONTROL_ENV = { ...BACKEND_ENV, NQT_STDIN_CONTROL: '1', NQT_PREWARM: '1' }
const PROBE = '0'.repeat(64)
/** Readiness is the proof route: every other /api path needs a session the launcher does not have yet. */
const proofWait = (port: number): { url: string; contains: string } => ({
  url: `http://127.0.0.1:${port}/api/desktop/proof?nonce=${PROBE}`,
  contains: '"proof"',
})
const LIVE_LOCK = (port: number): Facts['lock'] => ({ state: 'live', port })

const READY = { path: PYTHON, exists: true, fastapi: true, nqLab: true }
const NO_PYTHON = { path: PYTHON, exists: false, fastapi: false, nqLab: false }

function facts(over: Partial<Facts> = {}): Facts {
  return {
    platform: 'darwin',
    requiredNode: 24,
    node: { version: 'v24.21.0', path: NODE },
    terminalDir: DIR,
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

function options(over: Partial<StartOptions> = {}): StartOptions {
  return { command: 'start', mode: 'auto', dev: false, port: null, browser: true, build: true, dryRun: false, ...over }
}

function planFor(opts: StartOptions, f: Facts): StartPlan {
  const resolved = resolveMode(opts, f)
  if (!resolved.ok) throw new Error(resolved.error)
  return planStart(opts, f, resolved)
}

function parsed(argv: string[]): StartOptions {
  const result = parseArgs(argv)
  if (!result.ok) throw new Error(result.error)
  return result.options
}

function errorOf(argv: string[]): string {
  const result = parseArgs(argv)
  if (result.ok) throw new Error(`expected an error for ${argv.join(' ')}`)
  return result.error
}

describe('parseArgs', () => {
  it('starts with the defaults', () => {
    expect(parsed([])).toEqual(options())
  })

  it('reads the commands', () => {
    expect(parsed(['doctor']).command).toBe('doctor')
    for (const word of ['help', '--help', '-h']) expect(parsed([word]).command).toBe('help')
  })

  it('reads every flag, in any sequence', () => {
    expect(parsed(['--demo']).mode).toBe('demo')
    expect(parsed(['--full']).mode).toBe('full')
    expect(parsed(['--dev']).dev).toBe(true)
    expect(parsed(['--no-browser']).browser).toBe(false)
    expect(parsed(['--no-build']).build).toBe(false)
    expect(parsed(['--dry-run']).dryRun).toBe(true)
    expect(parsed(['--port', '5193', '--demo', '--no-browser'])).toEqual(
      options({ mode: 'demo', port: 5193, browser: false }),
    )
    expect(parsed(['--no-browser', '--dry-run', '--port', '5193', '--demo'])).toEqual(
      options({ mode: 'demo', port: 5193, browser: false, dryRun: true }),
    )
  })

  it('reads --port N and --port=N, at both ends of the range', () => {
    expect(parsed(['--port', '8790']).port).toBe(8790)
    expect(parsed(['--port=8790']).port).toBe(8790)
    expect(parsed(['--port', '1024']).port).toBe(1024)
    expect(parsed(['--port', '65535']).port).toBe(65535)
  })

  it('takes doctor together with flags', () => {
    expect(parsed(['doctor', '--port', '5193'])).toEqual(options({ command: 'doctor', port: 5193 }))
  })

  it('refuses an unknown flag or word and names it', () => {
    expect(errorOf(['--bogus'])).toContain('--bogus')
    expect(errorOf(['launch'])).toContain('launch')
    expect(errorOf(['doctor', 'extra'])).toContain('extra')
    expect(errorOf(['-x'])).toContain('-x')
  })

  it('refuses a bad port', () => {
    for (const bad of ['80', '1023', '65536', '70000', 'abc', '', '5e3', '8765.5', '-1', '0x1F90', ' ']) {
      expect(errorOf(['--port', bad])).toMatch(/--port/)
    }
    expect(errorOf(['--port'])).toMatch(/--port/)
    expect(errorOf(['--port=abc'])).toMatch(/--port/)
  })

  it('takes --dev with any port: the Vite proxy reads the backend port from the lock', () => {
    expect(parsed(['--dev', '--port', '8790'])).toEqual(options({ dev: true, port: 8790 }))
    expect(parsed(['--port', '8790', '--dev'])).toEqual(options({ dev: true, port: 8790 }))
    expect(parsed(['--dev', '--port', '8765'])).toEqual(options({ dev: true, port: 8765 }))
  })

  it('refuses flags that contradict each other', () => {
    expect(errorOf(['--demo', '--full'])).toMatch(/--demo.*--full|--full.*--demo/)
    expect(errorOf(['--demo', '--dev'])).toMatch(/--demo.*--dev|--dev.*--demo/)
  })

  it('words every error in plain ASCII', () => {
    const argvs = [['--bogus'], ['--port', '80'], ['--demo', '--dev'], ['--demo', '--full'], ['--port']]
    for (const argv of argvs) {
      expect([...errorOf(argv)].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32)).toEqual([])
    }
  })
})

describe('resolveMode', () => {
  const rows: Array<{ what: string; opts: Partial<StartOptions>; f: Partial<Facts>; mode: string; reason: string }> = [
    { what: 'no venv', opts: {}, f: { python: NO_PYTHON }, mode: 'DEMO ONLY', reason: 'nq_lab not found' },
    { what: 'a working venv', opts: {}, f: { python: READY }, mode: 'FULL', reason: 'venv python with fastapi, uvicorn and nq_lab' },
    {
      what: 'a working venv and a fixture folder',
      opts: {},
      f: { python: READY, fixtureDir: '/fx' },
      mode: 'FIXTURE',
      reason: 'NQT_FIXTURE_DIR is set; venv python with fastapi, uvicorn and nq_lab',
    },
    {
      what: 'a fixture folder but no venv',
      opts: {},
      f: { python: NO_PYTHON, fixtureDir: '/fx' },
      mode: 'DEMO ONLY',
      reason: 'nq_lab not found',
    },
    {
      what: 'a venv without nq_lab',
      opts: {},
      f: { python: { ...READY, nqLab: false } },
      mode: 'DEMO ONLY',
      reason: 'nq_lab not found',
    },
    {
      what: 'a venv without fastapi or uvicorn',
      opts: {},
      f: { python: { ...READY, fastapi: false } },
      mode: 'DEMO ONLY',
      reason: 'fastapi or uvicorn missing in the venv',
    },
    { what: '--demo on a working venv', opts: { mode: 'demo' }, f: { python: READY }, mode: 'DEMO ONLY', reason: '--demo' },
    { what: '--demo without a venv', opts: { mode: 'demo' }, f: { python: NO_PYTHON }, mode: 'DEMO ONLY', reason: '--demo' },
    { what: '--full on a working venv', opts: { mode: 'full' }, f: { python: READY }, mode: 'FULL', reason: 'venv python with fastapi, uvicorn and nq_lab' },
    {
      what: '--full with a fixture folder',
      opts: { mode: 'full' },
      f: { python: READY, fixtureDir: '/fx' },
      mode: 'FIXTURE',
      reason: 'NQT_FIXTURE_DIR is set; venv python with fastapi, uvicorn and nq_lab',
    },
    { what: '--dev on a working venv', opts: { dev: true }, f: { python: READY }, mode: 'FULL', reason: 'venv python with fastapi, uvicorn and nq_lab' },
  ]

  for (const row of rows) {
    it(`gives ${row.mode} for ${row.what}`, () => {
      const result = resolveMode(options(row.opts), facts(row.f))
      expect(result).toEqual({ ok: true, mode: row.mode, reason: row.reason })
    })
  }

  it('makes --full without nq_lab an error that names it and says where it looked', () => {
    const result = resolveMode(options({ mode: 'full' }), facts({ python: NO_PYTHON }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('nq_lab')
      expect(result.error).toContain(PYTHON)
      expect(result.error).toContain('NQT_LAB_ROOT')
    }
  })

  it('makes --dev without a working venv the same kind of error', () => {
    const result = resolveMode(options({ dev: true }), facts({ python: { ...READY, nqLab: false } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('nq_lab')
  })

  it('explains a missing fastapi under --full', () => {
    const result = resolveMode(options({ mode: 'full' }), facts({ python: { ...READY, fastapi: false } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/fastapi/)
  })
})

describe('planStart: the demo', () => {
  it('runs Vite in demo mode on 5174 when the dependencies are installed', () => {
    const plan = planFor(options(), facts())
    expect(plan.mode).toBe('DEMO ONLY')
    expect(plan.port).toBe(5174)
    expect(plan.url).toBe('http://127.0.0.1:5174/')
    expect(plan.alreadyRunning).toBe(false)
    expect(plan.blockers).toEqual([])
    expect(plan.steps).toEqual([
      {
        what: 'serve the demo',
        argv: [NODE, VITE, '--mode', 'demo', '--port', '5174', '--strictPort'],
        cwd: WEB,
        env: {},
        wait: { url: 'http://127.0.0.1:5174/', contains: 'id="root"' },
      },
    ])
  })

  it('takes --port for the demo', () => {
    const plan = planFor(options({ mode: 'demo', port: 5193 }), facts({ python: READY }))
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]?.argv).toEqual([NODE, VITE, '--mode', 'demo', '--port', '5193', '--strictPort'])
    expect(plan.url).toBe('http://127.0.0.1:5193/')
    expect(plan.steps[0]?.wait).toEqual({ url: 'http://127.0.0.1:5193/', contains: 'id="root"' })
  })

  it('has no install step when the dependencies are there', () => {
    const plan = planFor(options({ mode: 'demo', port: 5193 }), facts({ webDeps: true }))
    expect(plan.steps.map((s) => s.what)).toEqual(['serve the demo'])
    expect(plan.install).toBe(false)
  })

  it('installs first, frozen, when the dependencies are missing', () => {
    const plan = planFor(options(), facts({ webDeps: false }))
    expect(plan.install).toBe(true)
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0]).toEqual({
      what: 'install the web dependencies',
      argv: ['corepack', 'pnpm', 'install', '--frozen-lockfile'],
      cwd: WEB,
      env: PROMPT_OFF,
      wait: 'exit',
    })
    expect(plan.steps[1]?.what).toBe('serve the demo')
  })

  it('never builds the demo, whatever the build flags say', () => {
    const plan = planFor(options({ build: true }), facts({ buildNeeded: true }))
    expect(plan.build).toBe('not used')
    expect(plan.steps.some((s) => s.argv.includes('build'))).toBe(false)
  })

  it('reports a busy port instead of starting on it', () => {
    const plan = planFor(options(), facts({ ports: { '8765': 'free', '5173': 'free', '5174': 'busy' } }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('5174')
    expect(plan.blockers[0]).toContain('--port')
  })

  it('reports the port the user asked for, not the default', () => {
    const f = facts({ ports: { '8765': 'free', '5173': 'free', '5174': 'busy', '5193': 'free' } })
    expect(planFor(options({ port: 5193 }), f).blockers).toEqual([])
    const busy = facts({ ports: { '8765': 'free', '5173': 'free', '5174': 'free', '5193': 'busy' } })
    expect(planFor(options({ port: 5193 }), busy).blockers[0]).toContain('5193')
  })

  it('needs corepack when it has to install', () => {
    const plan = planFor(options(), facts({ webDeps: false, corepack: false }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('corepack')
  })

  it('does not need corepack when nothing is installed', () => {
    expect(planFor(options(), facts({ corepack: false })).blockers).toEqual([])
  })

  it('opens what is already running instead of starting again', () => {
    const plan = planFor(options({ mode: 'demo', port: 8765 }), facts({ ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(plan.alreadyRunning).toBe(true)
    expect(plan.steps).toEqual([])
    expect(plan.blockers).toEqual([])
  })
})

describe('planStart: the full terminal', () => {
  const ready = (over: Partial<Facts> = {}): Facts => facts({ python: READY, ...over })
  const backend = {
    what: 'start the backend',
    argv: [PYTHON, '-m', 'nq_terminal'],
    cwd: join(DIR, 'backend'),
    env: CONTROL_ENV,
    wait: proofWait(8765),
    allowList: true,
    stdin: 'control',
  }

  it('starts only the backend when web/dist is up to date', () => {
    const plan = planFor(options(), ready())
    expect(plan.mode).toBe('FULL')
    expect(plan.port).toBe(8765)
    expect(plan.url).toBe('http://127.0.0.1:8765/')
    expect(plan.build).toBe('up to date')
    expect(plan.steps).toEqual([backend])
  })

  it('installs, then builds, when web/dist is older than the sources, as start.ps1 does', () => {
    // start.ps1 runs pnpm install --frozen-lockfile before every build: pnpm-lock.yaml is a build input, so a pull
    // that changes it makes a build needed with node_modules present but stale. The install is a fast no-op otherwise.
    const plan = planFor(options(), ready({ buildNeeded: true }))
    expect(plan.build).toBe('needed')
    expect(plan.install).toBe(true)
    expect(plan.steps).toEqual([
      { what: 'install the web dependencies', argv: ['corepack', 'pnpm', 'install', '--frozen-lockfile'], cwd: WEB, env: PROMPT_OFF, wait: 'exit' },
      { what: 'build web/dist', argv: ['corepack', 'pnpm', 'build'], cwd: WEB, env: PROMPT_OFF, wait: 'exit' },
      backend,
    ])
  })

  it('installs before it builds when the dependencies are missing', () => {
    const plan = planFor(options(), ready({ buildNeeded: true, webDeps: false }))
    expect(plan.steps.map((s) => s.what)).toEqual(['install the web dependencies', 'build web/dist', 'start the backend'])
  })

  it('does not install when it does not build, even without dependencies', () => {
    const plan = planFor(options(), ready({ buildNeeded: false, webDeps: false }))
    expect(plan.steps).toEqual([backend])
    expect(plan.install).toBe(false)
  })

  it('skips the build for --no-build', () => {
    const plan = planFor(options({ build: false }), ready({ buildNeeded: true }))
    expect(plan.build).toBe('skipped')
    expect(plan.steps).toEqual([backend])
  })

  it('passes the port and the fixture folder to the backend', () => {
    const plan = planFor(options({ port: 8790 }), ready({ fixtureDir: '/fx dir' }))
    expect(plan.mode).toBe('FIXTURE')
    expect(plan.steps).toEqual([
      {
        ...backend,
        env: { ...BACKEND_ENV, NQT_PORT: '8790', NQT_STDIN_CONTROL: '1', NQT_FIXTURE_DIR: '/fx dir' },
        wait: proofWait(8790),
      },
    ])
    expect(plan.url).toBe('http://127.0.0.1:8790/')
  })

  it('needs corepack for a build', () => {
    const plan = planFor(options(), ready({ buildNeeded: true, corepack: false }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('corepack')
    expect(plan.blockers[0]).toContain('--no-build')
  })

  it('needs corepack only for what it runs', () => {
    expect(planFor(options(), ready({ corepack: false })).blockers).toEqual([])
    expect(planFor(options({ build: false }), ready({ corepack: false, buildNeeded: true })).blockers).toEqual([])
  })

  it('attaches to the backend the lock names and starts nothing: a launch code is minted for it', () => {
    const plan = planFor(options(), ready({ buildNeeded: true, lock: LIVE_LOCK(8765), ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(plan.alreadyRunning).toBe(true)
    expect(plan.attach).toEqual({ port: 8765 })
    expect(plan.session).toEqual({ origin: 'http://127.0.0.1:8765', apiPort: 8765 })
    expect(plan.steps).toEqual([])
    expect(plan.blockers).toEqual([])
    expect(plan.url).toBe('http://127.0.0.1:8765/')
  })

  it('attaches to the port the lock records, even when it is not the one asked for (the app starts on a random port)', () => {
    const plan = planFor(options(), ready({ lock: LIVE_LOCK(53117) }))
    expect(plan.attach).toEqual({ port: 53117 })
    expect(plan.session).toEqual({ origin: 'http://127.0.0.1:53117', apiPort: 53117 })
    expect(plan.url).toBe('http://127.0.0.1:53117/')
    expect(plan.steps).toEqual([])
  })

  it('starts the backend behind a session link when there is no lock', () => {
    const plan = planFor(options(), ready())
    expect(plan.attach).toBeNull()
    expect(plan.session).toEqual({ origin: 'http://127.0.0.1:8765', apiPort: 8765 })
  })

  it('starts its own backend over a stale lock, and over an unproven one (the backend decides who holds the lock)', () => {
    for (const lock of [{ state: 'stale', port: 8765 }, { state: 'unproven', port: 8765 }] as const) {
      const plan = planFor(options(), ready({ lock }))
      expect(plan.attach).toBeNull()
      expect(plan.steps.map((s) => s.what)).toEqual(['start the backend'])
      expect(plan.blockers).toEqual([])
    }
  })

  it('refuses a lock that is not owner-only, and starts nothing', () => {
    const plan = planFor(options(), ready({ lock: { state: 'untrusted', port: 8765 } }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('not owner-only')
    expect(plan.blockers[0]).toContain('/lab/terminal/state')
    expect(plan.attach).toBeNull()
  })

  it('refuses a terminal on the port that has no lock: an older version cannot be attached to', () => {
    const plan = planFor(options(), ready({ ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(plan.alreadyRunning).toBe(false)
    expect(plan.steps).toEqual([])
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('no lock file or token')
    expect(plan.blockers[0]).toContain('8765')
  })

  it('refuses a port taken by another program', () => {
    const plan = planFor(options(), ready({ ports: { '8765': 'busy', '5173': 'free', '5174': 'free' } }))
    expect(plan.alreadyRunning).toBe(false)
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('8765')
    expect(plan.blockers[0]).toContain('--port')
  })
})

describe('planStart: --dev', () => {
  const ready = (over: Partial<Facts> = {}): Facts => facts({ python: READY, ...over })

  it('runs uvicorn --reload exactly as start.ps1 does, then Vite on 5173', () => {
    const plan = planFor(options({ dev: true }), ready())
    expect(plan.mode).toBe('FULL')
    expect(plan.url).toBe('http://127.0.0.1:5173/')
    expect(plan.build).toBe('not used')
    expect(plan.steps).toEqual([
      {
        what: 'start the backend with uvicorn --reload',
        argv: [
          PYTHON, '-m', 'uvicorn', 'nq_terminal.app:create_app', '--factory', '--reload',
          '--host', '127.0.0.1', '--port', '8765', '--no-server-header', '--no-proxy-headers',
          '--timeout-graceful-shutdown', '2',
        ],
        cwd: join(DIR, 'backend'),
        env: BACKEND_ENV,
        wait: proofWait(8765),
        allowList: true,
      },
      {
        what: 'start the Vite dev server',
        argv: [NODE, VITE],
        cwd: WEB,
        env: {},
        wait: { url: 'http://127.0.0.1:5173/', contains: 'id="root"' },
      },
    ])
  })

  it('goes to the dev origin for its session, the code coming from the reloading backend it makes', () => {
    const plan = planFor(options({ dev: true }), ready())
    expect(plan.session).toEqual({ origin: 'http://127.0.0.1:5173', apiPort: 8765 })
    expect(plan.steps[0]?.stdin).toBeUndefined() // uvicorn makes its own token and records it in the lock
    expect(plan.steps[0]?.env.NQT_STDIN_CONTROL).toBeUndefined()
  })

  it('stops with a message when a backend already holds the lock: --dev needs its own reloading backend', () => {
    const plan = planFor(options({ dev: true }), ready({ lock: LIVE_LOCK(8765), ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('--dev')
    expect(plan.blockers[0]).toContain('lock')
    expect(plan.blockers[0]).toContain('/lab/terminal/state')
    const free = planFor(options({ dev: true }), ready({ lock: { state: 'stale', port: 8765 } }))
    expect(free.blockers).toEqual([])
  })

  it('refuses an untrusted lock too', () => {
    const plan = planFor(options({ dev: true }), ready({ lock: { state: 'untrusted', port: 8765 } }))
    expect(plan.blockers.join(' ')).toContain('not owner-only')
  })

  it('takes a backend port other than 8765, the proxy reading it from the lock', () => {
    const plan = planFor(options({ dev: true, port: 8790 }), ready({ ports: { '8790': 'free', '5173': 'free', '5174': 'free' } }))
    expect(plan.blockers).toEqual([])
    expect(plan.steps[0]?.argv).toContain('8790')
    expect(plan.session).toEqual({ origin: 'http://127.0.0.1:5173', apiPort: 8790 })
  })

  it('installs first when the dependencies are missing', () => {
    const plan = planFor(options({ dev: true }), ready({ webDeps: false }))
    expect(plan.steps.map((s) => s.what)).toEqual([
      'install the web dependencies',
      'start the backend with uvicorn --reload',
      'start the Vite dev server',
    ])
  })

  it('passes a fixture folder to the backend', () => {
    const plan = planFor(options({ dev: true }), ready({ fixtureDir: '/fx' }))
    expect(plan.steps[0]?.env).toEqual({ ...BACKEND_ENV, NQT_FIXTURE_DIR: '/fx' })
  })

  it('needs port 8765 free for uvicorn, even when the terminal already answers there', () => {
    const running = planFor(options({ dev: true }), ready({ ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } }))
    expect(running.alreadyRunning).toBe(false)
    expect(running.blockers.join(' ')).toContain('8765')
    const busy = planFor(options({ dev: true }), ready({ ports: { '8765': 'busy', '5173': 'free', '5174': 'free' } }))
    expect(busy.blockers.join(' ')).toContain('8765')
  })

  it('needs port 5173 free for Vite', () => {
    const plan = planFor(options({ dev: true }), ready({ ports: { '8765': 'free', '5173': 'busy', '5174': 'free' } }))
    expect(plan.blockers).toHaveLength(1)
    expect(plan.blockers[0]).toContain('5173')
  })
})

describe('planStart: safety', () => {
  const fixtureFacts = [
    facts(),
    facts({ webDeps: false }),
    facts({ python: READY }),
    facts({ python: READY, buildNeeded: true, webDeps: false }),
    facts({ python: READY, fixtureDir: '/fx dir' }),
    facts({ python: READY, terminalDir: '/with space/terminal' }),
  ]
  const optionSets = [options(), options({ mode: 'demo', port: 5193 }), options({ dev: true }), options({ port: 8790 }), options({ build: false })]

  it('emits argv arrays of plain strings, never a shell string, and never binds 0.0.0.0', () => {
    let checked = 0
    for (const f of fixtureFacts) {
      for (const o of optionSets) {
        // --dev needs a working venv; without one resolveMode refuses (tested above), so there is no plan.
        if (!resolveMode(o, f).ok) {
          expect(o.dev).toBe(true)
          continue
        }
        const plan = planFor(o, f)
        expect(JSON.stringify(plan)).not.toContain('0.0.0.0')
        for (const step of plan.steps) {
          checked += 1
          expect(Array.isArray(step.argv)).toBe(true)
          expect(step.argv.length).toBeGreaterThan(0)
          for (const part of step.argv) expect(typeof part).toBe('string')
          expect(step.argv).not.toContain('-c')
          expect(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell']).not.toContain(step.argv[0])
          for (const value of Object.values(step.env)) expect(typeof value).toBe('string')
          const host = step.argv.indexOf('--host')
          if (host >= 0) expect(step.argv[host + 1]).toBe('127.0.0.1')
          if (typeof step.wait === 'object') expect(step.wait.url.startsWith('http://127.0.0.1:')).toBe(true)
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('keeps a path with a space as one argument', () => {
    const plan = planFor(options({ mode: 'demo' }), facts({ terminalDir: '/with space/terminal' }))
    const argv = plan.steps[0]?.argv ?? []
    expect(argv).toContain(join('/with space/terminal', 'web', 'node_modules', 'vite', 'bin', 'vite.js'))
    expect(plan.steps[0]?.cwd).toBe(join('/with space/terminal', 'web'))
  })
})

describe('formatPlan', () => {
  it('lays out the demo plan like start.ps1 lays out its own', () => {
    const f = facts()
    const opts = options()
    expect(formatPlan(planFor(opts, f), opts, f)).toEqual([
      'mode: DEMO ONLY (nq_lab not found)',
      'root: /lab/terminal',
      'node: 24.21.0 at /n/bin/node',
      'port: 5174 (free)',
      'build: not used (Vite serves the demo from the sources)',
      `step 1 of 1: serve the demo: ${NODE} ${VITE} --mode demo --port 5174 --strictPort (in ${WEB})`,
      'page: http://127.0.0.1:5174/',
      'browser: opens http://127.0.0.1:5174/',
    ])
  })

  it('shows the environment, the install and the build for a full start, and no browser when told', () => {
    const f = facts({ python: READY, buildNeeded: true, webDeps: false, fixtureDir: '/fx' })
    const opts = options({ browser: false })
    expect(formatPlan(planFor(opts, f), opts, f)).toEqual([
      'mode: FIXTURE (NQT_FIXTURE_DIR is set; venv python with fastapi, uvicorn and nq_lab)',
      'root: /lab/terminal',
      'node: 24.21.0 at /n/bin/node',
      'port: 8765 (free)',
      `build: needed (${join(WEB, 'dist')})`,
      `step 1 of 3: install the web dependencies: corepack pnpm install --frozen-lockfile (in ${WEB})`,
      '  env: COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
      `step 2 of 3: build web/dist: corepack pnpm build (in ${WEB})`,
      '  env: COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
      `step 3 of 3: start the backend: ${PYTHON} -m nq_terminal (in ${join(DIR, 'backend')})`,
      '  env: NQT_PORT=8765 PYTHONUTF8=1 PYTHONIOENCODING=utf-8 NQT_STDIN_CONTROL=1 NQT_FIXTURE_DIR=/fx',
      '  env filter: the allow list of desktop/envlist.py; no other variable reaches the backend',
      '  input: TOKEN and NONCE, written once and kept open; closing it stops the backend',
      'page: http://127.0.0.1:8765/',
      'browser: not opened (the one-time link http://127.0.0.1:8765/session.html#<one-time code> is printed instead)',
    ])
  })

  it('quotes an argument with a space for display', () => {
    const f = facts({ terminalDir: '/with space/terminal' })
    const opts = options()
    const lines = formatPlan(planFor(opts, f), opts, f)
    const step = lines.find((l) => l.startsWith('step 1 of 1'))
    expect(step).toContain(`"${join('/with space/terminal', 'web', 'node_modules', 'vite', 'bin', 'vite.js')}"`)
  })

  it('opens the session page on the dev origin for --dev', () => {
    const f = facts({ python: READY })
    const opts = options({ dev: true })
    const lines = formatPlan(planFor(opts, f), opts, f)
    expect(lines).toContain('browser: opens http://127.0.0.1:5173/session.html#<one-time code>')
  })

  it('says a terminal is already running and starts nothing', () => {
    const f = facts({ python: READY, lock: LIVE_LOCK(8765), ports: { '8765': 'terminal', '5173': 'free', '5174': 'free' } })
    const opts = options()
    const lines = formatPlan(planFor(opts, f), opts, f)
    expect(lines).toContain('port: 8765 (terminal)')
    expect(lines).toContain('already running: http://127.0.0.1:8765/ (nothing would be started)')
    expect(lines.some((l) => l.startsWith('step '))).toBe(false)
  })

  it('lists what would stop a real run, and still prints the plan', () => {
    const f = facts({ ports: { '8765': 'free', '5173': 'free', '5174': 'busy' } })
    const opts = options({ dryRun: true })
    const lines = formatPlan(planFor(opts, f), opts, f)
    expect(lines).toContain('port: 5174 (busy)')
    expect(lines.some((l) => l.startsWith('would stop: ') && l.includes('5174'))).toBe(true)
    expect(lines.some((l) => l.startsWith('step 1 of 1'))).toBe(true)
  })

  it('is plain ASCII', () => {
    const f = facts({ python: READY, buildNeeded: true, webDeps: false, fixtureDir: '/fx' })
    const opts = options()
    for (const line of formatPlan(planFor(opts, f), opts, f)) {
      expect([...line].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32)).toEqual([])
    }
  })
})

describe('usageLines', () => {
  it('names every flag and every variable, in plain ASCII', () => {
    const text = usageLines().join('\n')
    for (const word of ['doctor', '--demo', '--full', '--dev', '--port', '--no-browser', '--no-build', '--dry-run', '--help', 'NQT_NODE', 'NQT_NODE_SWITCH', 'NQT_LAB_ROOT', 'NQT_FIXTURE_DIR']) {
      expect(text).toContain(word)
    }
    expect([...text].filter((c) => (c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32) && c !== '\n')).toEqual([])
  })
})
