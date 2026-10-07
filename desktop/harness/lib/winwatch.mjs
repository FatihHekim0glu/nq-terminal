// Starts the global window and foreground watch (winwatch.py) for the length of one run and reports what it saw.
// The watch sees every process; a new visible top-level window or a change of the foreground window fails the run only
// when its process is the run's app or under it (owner decision, 3 October 2026: other programs' windows must not fail our
// checks). Other programs' events are kept as notes. An event whose owner was not traced fails, and so does every event
// when the run names no app (fail closed). Foreign programs known to put windows up during a run are named in
// KNOWN_FOREIGN (and NQT_KNOWN_FOREIGN, image names separated by semicolons, for this PC); the summary's foreignSeen lists every foreign owner seen, flagged known or not, so a new neighbour shows
// in the report without failing the run. The watch is a Python helper (the nq-lab venv interpreter) that writes JSON
// lines, each with its owner's ancestry, to stdout; this module keeps them in the raw file.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep } from './cdp.mjs'
import { PY, launchEnv } from './paths.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Foreign programs known to put windows up during a run, by image name (compared without case). */
export const KNOWN_FOREIGN = ['logioptionsplus_agent.exe']
/** More image names for this PC (semicolon separated), for programs that should not be named in this repository. */
export const KNOWN_FOREIGN_ENV = 'NQT_KNOWN_FOREIGN'
const knownNames = () => [...KNOWN_FOREIGN, ...(process.env[KNOWN_FOREIGN_ENV] ?? '').split(';').map((n) => n.trim()).filter(Boolean)].map((n) => n.toLowerCase())
const isKnownForeign = (exe) => typeof exe === 'string' && knownNames().includes(exe.toLowerCase())

export function parseWatchLines(text) {
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

export async function startWatch(outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, '')
  const child = spawn(PY, ['-E', '-s', '-X', 'utf8', path.join(HERE, 'winwatch.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: launchEnv() })
  let text = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => { text += d; fs.appendFileSync(outFile, d) })
  const w = { child, outFile, text: () => text }
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (parseWatchLines(text).some((e) => e.type === 'ready')) return w
    if (child.exitCode !== null) throw new Error('window watch exited early')
    await sleep(50)
  }
  child.kill()
  throw new Error('window watch never became ready')
}

/**
 * System host images (compared without case) and window classes that draw windows on behalf of other processes: WerFault
 * (started by the WER service for a crashing process), Windows Terminal, OpenConsole and conhost (the console of a child
 * spawned without CREATE_NO_WINDOW), csrss (loader and hard-error boxes) and dllhost. Such a window can be this run's own
 * doing from outside its tree, so it always counts. Only the owner's image is judged, never the rest of its ancestry. The
 * Rust watches (src-tauri/tests/hidden_support/scope.rs) and web/e2e/desktop/watch.ts carry the same lists.
 */
export const SYSTEM_HOST_IMAGES = ['werfault.exe', 'windowsterminal.exe', 'openconsole.exe', 'conhost.exe', 'csrss.exe', 'dllhost.exe']
export const SYSTEM_HOST_CLASSES = ['consolewindowclass', 'cascadia_hosting_window_class']
const drawnByHost = (e) => SYSTEM_HOST_IMAGES.includes(String(e.chain?.[0]?.exe ?? '').toLowerCase()) || SYSTEM_HOST_CLASSES.includes(String(e.cls ?? '').toLowerCase())

/** True when the event's ancestry (winwatch.py's `chain`, nearest first) holds `rootPid`, the app this run started. */
export const ownedBy = (e, rootPid) => (e.chain ?? []).some((link) => link.pid === rootPid)

/** Another program's event: the run's app is known, the event's owner was traced, and its ancestry does not hold that app. */
const foreign = (e, rootPid) => rootPid != null && Array.isArray(e.chain) && e.chain.length > 0 && !ownedBy(e, rootPid) && !drawnByHost(e)

/** Every foreign owner in `notes`, nearest process image, with whether it is on the named list and how many events it had. */
function foreignOwners(notes) {
  const seen = new Map()
  for (const e of notes) {
    const exe = e.chain[0]?.exe ?? e.exe ?? '?'
    const row = seen.get(exe) ?? { exe, known: isKnownForeign(exe), count: 0 }
    row.count += 1
    seen.set(exe, row)
  }
  return [...seen.values()]
}

/**
 * Splits the events into what fails a run and what does not. `allow(event)` names a new window that is expected
 * (the screen-2 mode's own frame): it moves to `allowed`. `rootPid` is the app this run started: a new window or a
 * foreground change traced to another process moves to `notes`; the rest (this run's tree, an owner not traced, or
 * any event when `rootPid` is not given) stays a failure in `newWindows` or `foregroundChanges`.
 */
export function summariseWatch(events, { allow = () => false, rootPid = null } = {}) {
  const ready = events.find((e) => e.type === 'ready') ?? null
  const summary = events.find((e) => e.type === 'summary') ?? null
  const counted = events.filter((e) => e.type === 'new_window' && !allow(e))
  const allowed = events.filter((e) => e.type === 'new_window' && allow(e))
  const changes = events.filter((e) => e.type === 'foreground')
  const notes = [...counted, ...changes].filter((e) => foreign(e, rootPid))
  const newWindows = counted.filter((e) => !foreign(e, rootPid))
  const foregroundChanges = changes.filter((e) => !foreign(e, rootPid))
  const inertWindows = events.filter((e) => e.type === 'inert_window')
  return { ready, summary, rootPid, newWindows, allowed, inertWindows, foregroundChanges, notes, foreignSeen: foreignOwners(notes), clean: newWindows.length === 0 && foregroundChanges.length === 0 && summary !== null }
}

export async function stopWatch(w, opts = {}) {
  const done = new Promise((res) => w.child.once('exit', res))
  try { w.child.stdin.end() } catch { /* already closed */ }
  await Promise.race([done, sleep(5000)])
  if (w.child.exitCode === null) w.child.kill()
  await sleep(50)
  return summariseWatch(parseWatchLines(w.text()), opts)
}
