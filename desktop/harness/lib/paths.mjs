// Fixed places, the port table and the launch prelude of the measurement harness (04 D5.1; 03 section 15.4).
// The harness lives in desktop/harness, so the terminal it measures is the one two folders up: run from the main
// tree it measures the main tree, run from a worktree it measures that worktree. The research package, its venv
// and its data are the lab's, shared and read only.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const HARNESS_DIR = path.resolve(HERE, '..')
export const TERMINAL = path.resolve(HARNESS_DIR, '..', '..')
export const LAB = process.env.NQT_LAB ?? path.join(process.env.USERPROFILE ?? 'C:\\Users\\Owner', 'nq-lab')
export const PY = path.join(LAB, '.venv', 'Scripts', 'python.exe')
export const TMP_DIR = 'D:\\dev\\tmp'
export const RUNS_ROOT = 'D:\\dev\\d5\\runs'
export const TARGETS_ROOT = 'D:\\dev\\targets'
export const RELEASE_ROOT = 'D:\\dev\\release'
export const BUILD_FOLDERS = ['D:\\dev\\mingw', 'D:\\dev\\cargo']

/** The port table of the plan (never 8765; remote debugging port 0 with DevToolsActivePort for every smoke build). */
export const PORTS = Object.freeze({
  owner: 8765,
  fixtureBackend: 8800, // T2: the fixture backend of the reproduction and the spike shell
  tauriSpikeCdp: 9352, // T2: the spike shell's debugging port
  realBackend: 8797, // the standalone backend-ready reading
  t8Demo: 4373, // the offline gallery preview of the offline Playwright project (its repository default)
})

/** The second monitor of this PC (owner decision 10): where a visible harness window may go, behind the guard. */
export const SCREEN2_HINT = Object.freeze({ x: -1080, y: 228, width: 1080, height: 1872 })

export function assertPortAllowed(port) {
  if (port === PORTS.owner) throw new Error(`refusing port ${PORTS.owner}: it is the owner's terminal`)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`not a port: ${port}`)
  return port
}

const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** True when a PATH entry sits in (or is) a build-tool folder, whatever its slashes or case. */
export function isBuildToolEntry(entry, folders = BUILD_FOLDERS) {
  const e = norm(entry)
  return folders.some((f) => { const n = norm(f); return e === n || e.startsWith(`${n}\\`) })
}

/** The launch prelude's PATH: no build tools, so a hidden MinGW runtime dependency fails in the build night. */
export function cleanPath(pathVar, folders = BUILD_FOLDERS) {
  return String(pathVar ?? '').split(';').filter((p) => p !== '' && !isBuildToolEntry(p, folders)).join(';')
}

const hasKey = (env, name) => Object.keys(env).find((k) => k.toUpperCase() === name)

/**
 * The environment of every launch: a PATH without D:\dev\mingw and D:\dev\cargo, TEMP on D:, and no WEBVIEW2_*
 * variable (the shell scrubs them and the smoke build refuses them). `extra` is applied last.
 */
export function launchEnv(base = process.env, extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(base)) if (!k.toUpperCase().startsWith('WEBVIEW2_')) env[k] = v
  const pathKey = hasKey(env, 'PATH') ?? 'PATH'
  env[pathKey] = cleanPath(env[pathKey])
  Object.assign(env, { TEMP: TMP_DIR, TMP: TMP_DIR }, extra)
  return env
}

/** A fresh folder under D:\dev\d5\runs for one invocation; refuses anything that is not on D:. */
export function newRunFolder(name, root = RUNS_ROOT) {
  if (!/^[dD]:/.test(root)) throw new Error(`run output belongs on D:, not ${root}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(root, `${stamp}-${name}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const isMainTree = () => norm(TERMINAL) === norm(path.join(LAB, 'terminal'))
