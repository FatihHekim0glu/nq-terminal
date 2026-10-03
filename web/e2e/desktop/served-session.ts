// The app's own session, for qa/crosscheck/served.py (04 D5.2; 03 section 15.3): `node served-session.ts`.
//
// Starts the global window watch, launches the hidden smoke build with --fixture (the same launch as the Playwright project's
// set-up), reads the session cookie the shell put into the page over the debugging protocol (no browser is launched and no
// Playwright is involved) and prints one JSON line, `{"origin": "...", "cookie": "NAME=VALUE"}`. Then it waits: when its
// standard input closes it ends the app's process tree, stops the watch and prints `{"watch": [<failures>]}`; the exit code is 1
// when the watch saw a window or a foreground change of the app's tree, or a backend outlived the shell (other programs' windows
// and foreground changes are notes in the run's record.json). It prints nothing else on standard
// output. The cookie belongs to a throwaway fixture backend in a run folder under D:/dev/d5/app.
import fs from 'node:fs'
import path from 'node:path'
import { findSmokeExe, launchApp, listTargets, newRunDir, resolveLab } from './launch.ts'
import { assess, startWatch } from './watch.ts'

const SESSION_COOKIE_PREFIX = 'nqt_s_'
const CDP_TIMEOUT_MS = 30_000

/** One call of the Chrome debugging protocol on a page target's own socket. */
function cdpCall(socketUrl: string, method: string, params: object): Promise<{ result?: unknown; error?: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${method} did not answer in ${CDP_TIMEOUT_MS / 1000} s`)) }, CDP_TIMEOUT_MS)
    socket.onerror = () => { clearTimeout(timer); reject(new Error(`cannot open ${socketUrl}`)) }
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }))
    socket.onmessage = (event) => {
      clearTimeout(timer)
      socket.close()
      resolve(JSON.parse(String(event.data)) as { result?: unknown; error?: unknown })
    }
  })
}

async function sessionCookie(cdpPort: number, origin: string): Promise<string> {
  const page = (await listTargets(cdpPort)).find((t) => t.type === 'page' && t.url.startsWith(origin))
  if (page?.webSocketDebuggerUrl === undefined) throw new Error('the app has no page target on its backend origin')
  // The session cookie is scoped to /api, so a lookup by the origin's root address would not find it: ask for them all.
  const reply = await cdpCall(page.webSocketDebuggerUrl, 'Network.getAllCookies', {})
  const cookies = ((reply.result as { cookies?: Array<{ name: string; value: string }> } | undefined)?.cookies ?? [])
  const cookie = cookies.find((c) => c.name === `${SESSION_COOKIE_PREFIX}${new URL(origin).port}`)
  if (cookie === undefined) throw new Error(`the page holds no ${SESSION_COOKIE_PREFIX}* cookie (${cookies.map((c) => c.name).join(', ') || 'none'})`)
  return `${cookie.name}=${cookie.value}`
}

async function untilStdinCloses(): Promise<void> {
  process.stdin.resume()
  await new Promise<void>((resolve) => { process.stdin.on('end', resolve); process.stdin.on('close', resolve) })
}

const runDir = newRunDir('served')
const watch = await startWatch(path.join(runDir, 'watch.jsonl'))
let failures: string[] = []
try {
  const app = await launchApp({ exe: findSmokeExe(), fixture: true, lab: resolveLab(), runDir, size: '1920x1080' })
  try {
    const cookie = await sessionCookie(app.devtoolsPort, app.origin)
    process.stdout.write(`${JSON.stringify({ origin: app.origin, cookie })}\n`)
    await untilStdinCloses()
  } finally {
    const stopped = await app.stop()
    const report = await watch.finish()
    const verdict = assess(report.events, app.pid)
    failures = verdict.failures
    if (!stopped.backendGone) failures.push(`the backend (pid ${stopped.backendPid}) outlived the shell's tree`)
    fs.writeFileSync(path.join(runDir, 'record.json'), JSON.stringify({ origin: app.origin, stopped, watch: { samples: report.samples, failures, notes: verdict.notes } }, null, 2))
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  await watch.finish().catch(() => undefined)
  process.exit(2)
}
process.stdout.write(`${JSON.stringify({ watch: failures })}\n`)
process.exit(failures.length > 0 ? 1 : 0)
