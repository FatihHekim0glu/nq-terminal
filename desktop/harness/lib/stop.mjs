// Backend teardown: kills only processes proved to be this run's own (same pid, creation time and an owned image name).
// Never `taskkill /T` and never a bare pid: a root that already exited may have had its pid reused by an unrelated process.
import { sleep } from './cdp.mjs'
import { killPid } from './proc.mjs'
import { liveIdentity, treeIdentity } from './mem.mjs'
import { killableSurvivors, mergeRecorded } from './survivors.mjs'

// The venv launcher and its child interpreter are both python.exe.
export const BACKEND_NAMES = new Set(['python.exe'])

const isAlive = (child) => child.exitCode === null && child.signalCode === null

const safeLive = (live, rows) => { try { return live(rows.map((p) => p.pid)) } catch { return [] } }

/**
 * child: the spawned ChildProcess; recorded: identity rows ({ pid, created, exe }) taken earlier, if any.
 * The tree is read only while the root is still running (Node holds its handle, so its pid cannot belong to anyone else yet).
 * Returns { recorded, killed: pids, survivors: recorded identities still alive after the kill pass }.
 */
export async function stopOwned(child, recorded = [], { names = BACKEND_NAMES, kill = killPid, live = liveIdentity, identity = treeIdentity, wait = sleep } = {}) {
  let rows = recorded
  if (isAlive(child)) {
    try { rows = mergeRecorded(rows, identity(child.pid)) } catch { /* the earlier records stand */ }
  }
  const killed = []
  for (const p of killableSurvivors(rows, safeLive(live, rows), names)) {
    if (p.pid === child.pid && !isAlive(child)) continue // an exited root: never act on its pid
    kill(p.pid)
    killed.push(p.pid)
  }
  await wait(500)
  const nowLive = safeLive(live, rows)
  const survivors = rows.filter((r) => nowLive.some((l) => Number(l.pid) === Number(r.pid) && l.created === r.created))
  return { recorded: rows, killed, survivors }
}
