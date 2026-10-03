// Starts the global window and foreground watch (winwatch.py) for the length of one run and reports what it saw.
// Any new visible top-level window anywhere, or any change of the foreground window, fails the run. The watch is a
// Python helper (the nq-lab venv interpreter) that writes JSON lines to stdout; this module keeps them in the raw file.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep } from './cdp.mjs'
import { PY, launchEnv } from './paths.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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
 * Splits the events into what fails a run and what does not. `allow(event)` names a new window that is expected
 * (the screen-2 mode's own frame): it moves to `allowed`, everything else stays a failure. A foreground change
 * always fails.
 */
export function summariseWatch(events, { allow = () => false } = {}) {
  const ready = events.find((e) => e.type === 'ready') ?? null
  const summary = events.find((e) => e.type === 'summary') ?? null
  const all = events.filter((e) => e.type === 'new_window')
  const allowed = all.filter((e) => allow(e))
  const newWindows = all.filter((e) => !allow(e))
  const inertWindows = events.filter((e) => e.type === 'inert_window')
  const foregroundChanges = events.filter((e) => e.type === 'foreground')
  return { ready, summary, newWindows, allowed, inertWindows, foregroundChanges, clean: newWindows.length === 0 && foregroundChanges.length === 0 && summary !== null }
}

export async function stopWatch(w, opts = {}) {
  const done = new Promise((res) => w.child.once('exit', res))
  try { w.child.stdin.end() } catch { /* already closed */ }
  await Promise.race([done, sleep(5000)])
  if (w.child.exitCode === null) w.child.kill()
  await sleep(50)
  return summariseWatch(parseWatchLines(w.text()), opts)
}
