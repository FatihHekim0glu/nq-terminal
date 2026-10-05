// Start-path parity (perf-5): the fixture backend started the way the shell starts it, and the plain way, must hold the same
// private working set (within 5 MB) and run the same number of threads. Fixture data only, no window. The shell's side mirrors
// desktop/src-tauri/src/supervise_check.rs (SPAWN_ARGS, BASE_ENV, PASSED_NQT, backend_env) name for name; a test reads that file
// and fails if the two lists drift. Pure functions here; the live runner is modes/parity.mjs.
import { assertPortAllowed } from './paths.mjs'
import { median } from './stats.mjs'

/** The two spare ports (the owner's terminal sits on 8765 and is never touched). */
export const PARITY = Object.freeze({ plainPort: 8791, shellPort: 8792, maxWsDeltaMB: 5 })

export const SHELL_ARGS = Object.freeze(['-E', '-s', '-X', 'utf8', '-X', 'faulthandler', '-m'])
export const FIXTURE_MODULE = 'nq_terminal.desktop.fixture_main'
export const SHELL_BASE_ENV = Object.freeze(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SYSTEMDRIVE', 'PATHEXT', 'PROGRAMDATA', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'USERNAME', 'COMPUTERNAME', 'OS', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'PATH'])
export const SHELL_PASSED_NQT = Object.freeze(['NQT_CACHE_BYTES', 'NQT_MEMTRIM'])

const upperEntries = (env) => Object.entries(env).map(([k, v]) => [k.toUpperCase(), String(v)])

/** The names a plain start never inherits: the interpreter's own settings, this shell's backend settings, a venv and WebView2. */
const PLAIN_DROPPED = /^(PYTHON|NQT_|VIRTUAL_ENV|WEBVIEW2_)/

/** The test names the shell adds for a smoke fixture backend (03 section 8): state folder, jobs off, the fixture folder. */
const testEnv = ({ stateDir, fixtureDir }) => ({ NQT_STATE_DIR: stateDir, NQT_JOBS: 'off', NQT_FIXTURE_DIR: fixtureDir })

const pythonOf = (lab) => `${lab}\\.venv\\Scripts\\python.exe`

/**
 * The shell's start of the fixture backend: the interpreter switches and an environment built from nothing (backend_env): the
 * base names, PATH with the venv's Scripts folder first, the two Python settings, NQT_CACHE_BYTES and NQT_MEMTRIM when set, NQT_DESKTOP=1, the port
 * (the shell asks for 0; the parity run needs a known one) and the test names; upper-case names, sorted.
 */
export function shellStart(parent, { lab, port, stateDir, fixtureDir }) {
  assertPortAllowed(port)
  const up = new Map(upperEntries(parent))
  const env = {}
  for (const name of [...SHELL_BASE_ENV, ...SHELL_PASSED_NQT]) if (name !== 'PATH' && up.has(name)) env[name] = up.get(name)
  env.PATH = `${lab}\\.venv\\Scripts${up.has('PATH') ? `;${up.get('PATH')}` : ''}`
  Object.assign(env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NQT_DESKTOP: '1', NQT_PORT: String(port) }, testEnv({ stateDir, fixtureDir }))
  const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return { python: pythonOf(lab), args: [...SHELL_ARGS, FIXTURE_MODULE], env: sorted }
}

/** The plain start: `python -m <module>` with no interpreter switches, the whole parent environment (minus the dropped names), the launcher's stdin control. */
export function plainStart(parent, { lab, port, stateDir, fixtureDir }) {
  assertPortAllowed(port)
  const env = Object.fromEntries(Object.entries(parent).filter(([k]) => !PLAIN_DROPPED.test(k.toUpperCase())))
  // NQT_MEMTRIM=1 starts the memory trim's quiet thread that desktop mode starts on the shell side (memtrim.py), so both sides hold it.
  Object.assign(env, { NQT_PORT: String(port), NQT_STDIN_CONTROL: '1', NQT_MEMTRIM: '1' }, testEnv({ stateDir, fixtureDir }))
  return { python: pythonOf(lab), args: ['-m', FIXTURE_MODULE], env }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Compares the two starts: { pass, problems, wsDeltaMB (shell minus plain), threadsShell, threadsPlain }. A row is
 * { wsPrivateMB, threads }. Fails when the private working sets differ by more than maxWsDeltaMB, when the thread counts differ,
 * and when either reading is missing: a comparison that cannot be made never passes.
 */
export function compareParity(shell, plain, { maxWsDeltaMB = PARITY.maxWsDeltaMB } = {}) {
  const problems = []
  const ok = (r) => r && finite(r.wsPrivateMB) && finite(r.threads)
  if (!ok(shell)) problems.push('the shell-style start has no complete reading (private working set and thread count)')
  if (!ok(plain)) problems.push('the plain start has no complete reading (private working set and thread count)')
  if (problems.length) return { pass: false, problems, wsDeltaMB: null, threadsShell: shell?.threads ?? null, threadsPlain: plain?.threads ?? null }
  const wsDeltaMB = Math.round((shell.wsPrivateMB - plain.wsPrivateMB) * 10) / 10
  if (Math.abs(wsDeltaMB) > maxWsDeltaMB) problems.push(`private working set differs by ${Math.abs(wsDeltaMB)} MB (shell ${shell.wsPrivateMB}, plain ${plain.wsPrivateMB}; limit ${maxWsDeltaMB} MB)`)
  if (shell.threads !== plain.threads) problems.push(`thread counts differ (shell ${shell.threads}, plain ${plain.threads})`)
  return { pass: problems.length === 0, problems, wsDeltaMB, threadsShell: shell.threads, threadsPlain: plain.threads }
}

/**
 * The backend interpreter among the processes of a start's tree ({ pid, exe, wsPrivate, privateBytes }): the python process with the
 * largest private working set (the venv launcher in front of it is a few MB). null when there is none.
 */
export function pickInterpreter(procs) {
  const pythons = (procs ?? []).filter((p) => /^python[\w.-]*$/i.test(String(p.exe ?? p.name ?? '').replace(/\.exe$/i, '')))
  return pythons.length ? pythons.reduce((a, b) => (b.wsPrivate > a.wsPrivate ? b : a)) : null
}

/** Several runs of one start as one row: the median of the private working set and private bytes, the median thread count and whether every run had the same one. */
export function summariseRuns(rows) {
  const threads = rows.map((r) => r.threads).filter(finite)
  return { runs: rows.length, wsPrivateMB: median(rows.map((r) => r.wsPrivateMB)), privateBytesMB: median(rows.map((r) => r.privateBytesMB)),
    threads: median(threads), threadsStable: new Set(threads).size <= 1 }
}
