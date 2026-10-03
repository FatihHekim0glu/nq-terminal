// Node side of winctl.py: monitors, the windows of a pid, a polite close, and the two guarded shows. Every call is a
// hidden Python child (the nq-lab venv interpreter) that prints one JSON document.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PY, launchEnv } from './paths.mjs'
import { guardFrame, frameOf } from './screen2.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'winctl.py')

function run(args) {
  const out = execFileSync(PY, ['-E', '-s', '-X', 'utf8', SCRIPT, ...args.map(String)], { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: launchEnv() })
  return JSON.parse(out)
}

export const monitors = () => run(['monitors'])
export const windowsOf = (pid) => run(['windows', '--pid', pid])
export const foreground = () => run(['foreground'])
export const closeWindows = (pid) => run(['close', '--pid', pid])
export const sizeMessage = (pid, hwnd, state) => run(['size', '--pid', pid, '--hwnd', hwnd, '--state', state])

/** The shell's real top-level window (not the Tao event target), or null. */
export const mainWindow = (pid) => windowsOf(pid).find((w) => w.cls !== 'Tao Thread Event Target' && w.title !== '') ?? null

/**
 * A guarded show command on a window of `pid`: SW_SHOWMINNOACTIVE ('minimise') and SW_SHOWNOACTIVATE ('restore') only, and
 * only on a window the screen-2 guard accepts. A minimise needs the window's current frame inside the screen-2 work area; a
 * restore needs the window to be minimised and `lastFrame` (the frame recorded before the minimise) inside it, because a
 * minimised window has no frame to read and the restore puts it back there.
 */
export function guardedShow(pid, hwnd, cmd, { table = monitors(), lastFrame = null } = {}) {
  if (cmd !== 'minimise' && cmd !== 'restore') throw new Error(`refused show command ${cmd}`)
  const w = windowsOf(pid).find((x) => x.hwnd === hwnd)
  if (!w) throw new Error(`window ${hwnd} is not a window of process ${pid}`)
  const frame = cmd === 'minimise' ? frameOf(w) : lastFrame
  const g = guardFrame(frame, table)
  if (!g.ok) throw new Error(`screen-2 guard refused ${cmd}: ${g.reason}`)
  if (cmd === 'restore' && !w.iconic) throw new Error('restore of a window that is not minimised')
  return run(['show', '--pid', pid, '--hwnd', hwnd, '--cmd', cmd])
}
