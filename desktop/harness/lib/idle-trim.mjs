// The idle sample waits on evidence of the backend's quiet trim (backend/nq_terminal/memtrim.py), not on a fixed offset from HOME ready.
// The trim fires 60 to 65 s after the LAST foreground request, and foreground requests still arrive after first paint (the lazily mounted
// record watch reads /api/ledger and /api/audit/openings up to 12 s + 4 s after it mounts, lazy chunks, slow real-data panels), so a
// fixed wait can read an untrimmed or half-trimmed set. The backend's working set is read from the first moment and every poll after the
// floor; the wait ends when it has dropped and settled, or at the cap, and the figure records which.

/** The longest wait from HOME ready: floor 66 s + record watch 12 s mount wait + 4 s idle timeout + one 5 s poll, with margin. */
export const IDLE_CAP_MS = 120_000
export const IDLE_POLL_MS = 5000
/** A trim is a fall of the backend working set from its peak of at least this much and this fraction. */
export const TRIM_MIN_DROP_MB = 30
export const TRIM_DROP_FRACTION = 0.10
/** The last two readings are settled when they differ by no more than this much or this fraction. */
export const SETTLE_MB = 10
export const SETTLE_FRACTION = 0.05

const round1 = (v) => Math.round(v * 10) / 10

/** Pure. series: [{ tMs, backendMB }] in time order. seen: the latest level sits a trim below the peak; settled: the last two readings agree. */
export function trimEvidence(series) {
  const mbs = series.map((s) => s.backendMB).filter((v) => Number.isFinite(v))
  if (mbs.length < 2) return { seen: false, settled: false, peakMB: mbs.length ? Math.max(...mbs) : null, settledMB: null }
  const peak = Math.max(...mbs)
  const [prev, last] = mbs.slice(-2)
  const settled = Math.abs(prev - last) <= Math.max(SETTLE_MB, SETTLE_FRACTION * Math.max(prev, last))
  const level = Math.max(prev, last)
  const seen = peak - level >= Math.max(TRIM_MIN_DROP_MB, TRIM_DROP_FRACTION * peak)
  return { seen, settled, peakMB: round1(peak), settledMB: settled ? round1(last) : null }
}

/**
 * Waits for the quiet trim. `read()` returns the backend working set in MB; `now`/`sleep` are the clock (injected in tests). A first
 * reading is taken at once (the untrimmed baseline), the next at the floor, then every pollMs until a seen, settled trim or the cap.
 * floorMs 0 switches it off. A reading that fails falls back to the floor and says so.
 */
export async function waitForIdleTrim({ read, now, sleep, floorMs, capMs, pollMs }) {
  const start = now()
  const series = []
  const done = (extra) => ({ waitedMs: now() - start, series, ...extra })
  if (!(floorMs > 0)) return done({ checked: false, seen: null, capped: false })
  const take = async () => { series.push({ tMs: now() - start, backendMB: round1(await read()) }) }
  try { await take() } catch (e) {
    await sleep(floorMs)
    return done({ checked: false, seen: null, capped: false, error: String((e && e.message) ?? e).slice(0, 200) })
  }
  await sleep(Math.max(0, floorMs - (now() - start)))
  for (;;) {
    try { await take() } catch (e) { return done({ checked: false, seen: null, capped: false, error: String((e && e.message) ?? e).slice(0, 200) }) }
    const ev = trimEvidence(series)
    if (ev.seen && ev.settled) return done({ checked: true, seen: true, capped: false, peakMB: ev.peakMB, settledMB: ev.settledMB })
    if (now() - start >= capMs) return done({ checked: true, seen: ev.seen, capped: true, peakMB: ev.peakMB, settledMB: ev.settledMB })
    await sleep(pollMs)
  }
}

/**
 * Whether the backend's own trim ran. The working-set series cannot say: with NQT_MEMTRIM=0 the backend's set still falls after
 * start-up (the HOME prewarm releases what it imported) and that fall clears the drop threshold. So the memtrim state decides:
 * 'off' means no trim ran; 'on' means it ran when its drop was seen (null while the series was not read); no state (an older
 * caller) keeps the drop as the answer.
 */
export function trimRan(memtrim, dropSeen) {
  if (memtrim === 'off') return false
  return dropSeen === undefined ? null : dropSeen
}
