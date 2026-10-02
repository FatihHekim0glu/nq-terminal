// terminal/start.ps1 (TASKS 7.4, ARCHITECTURE section 11): one command starts the terminal on
// 127.0.0.1:8765 from PowerShell with the spaced home path; -Dev runs uvicorn --reload and Vite on 5173.
// Static checks on the script text, then its -DryRun plan (which starts nothing and opens nothing).
import { describe, expect, it } from 'vitest'
import scriptText from '../../../../start.ps1?raw'

// Node built-ins load at run time (the app's type set has no Node types); the tests only run in Node.
interface SpawnResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}
type SpawnSync = (cmd: string, args: readonly string[], opts: Record<string, unknown>) => SpawnResult
const nodeModule = (name: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ name)
const runtime = (globalThis as { process?: { platform?: string } }).process
const onWindows = runtime?.platform === 'win32'

const text: string = scriptText
const NEWLINE = /\r?\n/
const COMMENT_LINE = /^\s*#/
const code = text
  .split(NEWLINE)
  .filter((l: string) => !COMMENT_LINE.test(l))
  .join(String.fromCharCode(10))

async function paths(): Promise<{ script: string; python: string }> {
  const url = (await nodeModule('node:url')) as { fileURLToPath: (u: URL) => string }
  return {
    script: url.fileURLToPath(new URL('../../../../start.ps1', import.meta.url)),
    python: url.fileURLToPath(new URL('../../../../../.venv/Scripts/python.exe', import.meta.url)),
  }
}

async function dryRun(...args: string[]): Promise<{ status: number | null; out: string; python: string }> {
  const { script, python } = await paths()
  const cp = (await nodeModule('node:child_process')) as { spawnSync: SpawnSync }
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DryRun', ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    windowsHide: true,
  })
  return { status: r.status, out: [r.stdout, r.stderr].join(' '), python }
}

describe('start.ps1: the script text', () => {
  it('exists beside the web and backend folders', () => {
    expect(text.length).toBeGreaterThan(0)
  })

  it('is pure ASCII, so Windows PowerShell 5.1 reads it the same with or without a BOM', () => {
    expect([...text].filter((c) => c.charCodeAt(0) > 127)).toEqual([])
  })

  it('runs Python only by the venv path, never a bare python on PATH', () => {
    expect(code).toMatch(/\.venv\\Scripts\\python\.exe/)
    expect(code).not.toMatch(/(^|[\s&'"(])python(3)?(\.exe)?\s+-/m)
    expect(code).not.toMatch(/\bpy\s+-/)
  })

  it('binds the loopback address and defaults to port 8765', () => {
    expect(code).toContain('127.0.0.1')
    expect(code).toMatch(/\$Port\s*=\s*8765/)
    expect(code).not.toMatch(/0\.0\.0\.0/)
  })

  it('reads only: no git, no writes under results, data, live or backtests, no order words', () => {
    expect(code).not.toMatch(/\bgit\b/i)
    expect(code).not.toMatch(/-Method\s+(Post|Put|Delete|Patch)/i)
    expect(code).not.toMatch(/(results|backtests|live|data)\\/i)
    expect(code).not.toMatch(/\b(order|submit|cancel|modify)\b/i)
  })

  it('stops what it started on exit (finally), and kills the whole process tree', () => {
    expect(code).toMatch(/finally/)
    expect(code).toMatch(/taskkill(\.exe)?\s+\/PID/i)
  })
})

describe.runIf(onWindows)('start.ps1 -DryRun: the plan, with nothing started', () => {
  it('normal mode: the venv Python runs nq_terminal on the given port, then the browser opens the page', async () => {
    const r = await dryRun('-Port', '8799', '-NoBrowser')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain(r.python)
    expect(r.out).toContain('-m nq_terminal')
    expect(r.out).toContain('NQT_PORT=8799')
    expect(r.out).toContain('NQT_PREWARM=1') // the plain launcher asks the backend to warm HOME once its port is bound
    expect(r.out).toContain('http://127.0.0.1:8799/')
    expect(r.out).toMatch(/build: (needed|up to date)/)
    expect(r.out).toContain('browser: not opened')
  })

  it('-Dev: uvicorn with --reload on 127.0.0.1:8765 and Vite on 5173 with /api proxied', async () => {
    const r = await dryRun('-Dev', '-NoBrowser')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('-m uvicorn nq_terminal.app:create_app --factory --reload --host 127.0.0.1 --port 8765')
    expect(r.out).toContain('http://127.0.0.1:5173/')
    expect(r.out).not.toContain('NQT_PREWARM') // uvicorn --reload restarts the process on each edit: no prewarm
  })

  it('-Dev refuses another backend port, because the Vite proxy points at 8765', async () => {
    const r = await dryRun('-Dev', '-Port', '8799')
    expect(r.status).not.toBe(0)
    expect(r.out).toContain('8765')
  })

  it('refuses a port outside 1024 to 65535', async () => {
    const r = await dryRun('-Port', '80')
    expect(r.status).not.toBe(0)
  })
})
