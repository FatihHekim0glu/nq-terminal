// The screen-2 guard (owner decision 10). A harness window may be visible only on the second monitor, and only inside
// that monitor's work area, taken from GetMonitorInfo's rcWork and the window's DWM frame bounds. Anything that
// touches the primary monitor (the owner's main screen, possibly a full-screen game) is refused. Pure functions over
// the monitor table that winctl.py prints, so each refusal has a born-failing case with no window at all.

const rectOk = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1]
export const intersects = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
export const inside = (inner, outer) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]

/** The one non-primary monitor, or null (no second screen, or more than one candidate: the guard then refuses). */
export function screen2Of(monitors) {
  const others = (monitors ?? []).filter((m) => !m.primary)
  return others.length === 1 ? others[0] : null
}

/**
 * Judges a frame rectangle ([left, top, right, bottom]) against the monitor table.
 * Refuses: no usable second monitor, a malformed rectangle, any overlap with the primary monitor, and anything
 * outside the second monitor's work area.
 */
export function guardFrame(frame, monitors) {
  if (!rectOk(frame)) return { ok: false, reason: 'the frame is not a rectangle' }
  const primary = (monitors ?? []).find((m) => m.primary)
  if (!primary) return { ok: false, reason: 'no primary monitor in the table' }
  const second = screen2Of(monitors)
  if (!second) return { ok: false, reason: 'there is not exactly one second monitor' }
  if (intersects(frame, primary.rect)) return { ok: false, reason: 'the frame touches the primary monitor' }
  if (!inside(frame, second.work)) return { ok: false, reason: 'the frame is outside the work area of the second monitor' }
  return { ok: true, reason: null, work: second.work }
}

/** A window the watch saw (rect at detection time) is expected when it is the owned shell's own and the guard accepts its rectangle. */
export function screen2Allow(ownedPids, monitors) {
  const pids = new Set(ownedPids)
  return (event) => pids.has(event.pid) && guardFrame(event.rect, monitors).ok
}

/** Frame of a window record: the DWM extended frame bounds when present, else the window rectangle. */
export const frameOf = (w) => w.frame ?? w.rect
