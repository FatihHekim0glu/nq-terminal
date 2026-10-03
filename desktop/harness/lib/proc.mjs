// Process helpers: every spawn is hidden (windowsHide = CREATE_NO_WINDOW) with the launch prelude's environment, and a
// pid is only ever ended by its own number (one pid, no tree walk): the caller has already proved the pid's identity.
import { spawn, execFileSync } from 'node:child_process'
import { launchEnv } from './paths.mjs'

/** Ends one pid. No /T: it would follow parent pids that may have been reused by an unrelated process. */
export function killPid(pid) {
  if (!pid) return
  try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* already gone */ }
}

/** Spawns a child hidden, with the clean PATH and TEMP on D:. `env` entries are applied over the prelude. */
export function spawnHidden(exe, args, { env = {}, cwd, stdio = 'ignore' } = {}) {
  return spawn(exe, args, { windowsHide: true, cwd, stdio, env: launchEnv(process.env, env) })
}

export async function healthOk(port, pathName = '/api/health') {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${pathName}`, { signal: AbortSignal.timeout(2000) })
    await r.arrayBuffer()
    return r.status === 200
  } catch { return false }
}

/** The backend answers the desktop proof route (no session needed; the route a launcher or shell asks first). */
export async function proofOk(port) {
  try {
    const nonce = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    const r = await fetch(`http://127.0.0.1:${port}/api/desktop/proof?nonce=${nonce}`, { signal: AbortSignal.timeout(2000) })
    await r.arrayBuffer()
    return r.status === 200
  } catch { return false }
}
