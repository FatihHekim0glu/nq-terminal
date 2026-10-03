// Teardown identity guard. A pid alone is not an identity on Windows: it is reused, and orphans keep a dead parent's pid.
// A process is only ever killed when its pid, creation time and image name still match what was recorded, and the image
// is one this harness launches.
// The spike shell (the reproduction of the W0B figures) and WebView2 children.
export const OWN_NAMES = new Set(['electron.exe', 'msedgewebview2.exe', 'nq-shell.exe'])
// The real shell, its engine children and the backend it spawned (the interpreter launcher and its child are both python.exe).
// A pid is only ever killed when it was recorded in this run's own tree with the same creation time and image name.
export const SHELL_NAMES = new Set(['nq-lab-terminal.exe', 'msedgewebview2.exe', 'python.exe'])

const owned = (p, names) => !!p && !!p.created && names.has(String(p.exe ?? '').toLowerCase())

/** recorded and live are [{ pid, created, exe }]; returns the live rows that are provably the recorded, owned processes. */
export function killableSurvivors(recorded, live, names = OWN_NAMES) {
  const liveByPid = new Map(live.map((p) => [Number(p.pid), p]))
  return recorded.filter((r) => {
    const now = liveByPid.get(Number(r.pid))
    return owned(r, names) && owned(now, names) && now.created === r.created && String(now.exe).toLowerCase() === String(r.exe).toLowerCase()
  }).map((r) => liveByPid.get(Number(r.pid)))
}

/** Merges identity rows by pid and creation time (a reused pid with a new creation time is a different process). */
export function mergeRecorded(...lists) {
  const seen = new Map()
  for (const l of lists) for (const p of l) seen.set(`${p.pid}@${p.created}`, { pid: p.pid, created: p.created, exe: p.exe })
  return [...seen.values()]
}
