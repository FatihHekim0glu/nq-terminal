// A readiness gate for non-critical network work (W5C, decision D5): true once the page's own queries have gone quiet.
// It waits for at least one query to have settled, then for no fetch to be in flight for `quietMs`, then for the browser's
// next idle moment; whatever happens it is true `maxWaitMs` after mount, so a polling query cannot starve it.
// The record watch's reader (RecordWatch.live.tsx) calls it, so it loads with that chunk and never with the first-paint
// shell. It reads the query cache through one subscription and the client's own fetch count, so it adds no library
// file to the shell's vendor chunk. Once true it never goes back.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** How long no fetch may be in flight before the page counts as quiet. */
const QUIET_MS = 500
/** The latest the gate opens, counted from mount, whatever the queries are doing. */
const MAX_WAIT_MS = 12_000
/** The latest an idle callback may wait once the page is quiet. */
const IDLE_TIMEOUT_MS = 4000
/** Where the browser has no idle callback, the pause after the quiet period. */
const IDLE_FALLBACK_MS = 50

export interface QuietReadyOptions {
  /** How long no fetch may be in flight before the page counts as quiet. */
  readonly quietMs?: number
  /** The latest the gate opens, counted from mount. */
  readonly maxWaitMs?: number
}

/** Calls `run` at the browser's next idle moment (or after a short pause without one); returns the way to cancel it. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(run, IDLE_FALLBACK_MS)
  return () => window.clearTimeout(id)
}

export function useQuietReady({ quietMs = QUIET_MS, maxWaitMs = MAX_WAIT_MS }: QuietReadyOptions = {}): boolean {
  const client = useQueryClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (ready) return undefined
    const cache = client.getQueryCache()
    const open = () => setReady(true)
    let settled = false
    let fetching = -1
    let quiet = 0
    let cancelIdle = () => {}
    // The quiet period restarts whenever the fetch count or the settled flag changes, as a render on them would.
    const check = () => {
      const count = client.isFetching()
      const nowSettled = settled || cache.getAll().some((query) => query.state.status !== 'pending')
      if (count === fetching && nowSettled === settled) return
      fetching = count
      settled = nowSettled
      window.clearTimeout(quiet)
      cancelIdle()
      cancelIdle = () => {}
      if (settled && fetching === 0) {
        quiet = window.setTimeout(() => {
          cancelIdle = whenIdle(open)
        }, quietMs)
      }
    }
    const unsubscribe = cache.subscribe(check)
    // The ceiling: counted from mount, never reset by the queries.
    const ceiling = window.setTimeout(open, maxWaitMs)
    check()
    return () => {
      unsubscribe()
      window.clearTimeout(ceiling)
      window.clearTimeout(quiet)
      cancelIdle()
    }
  }, [client, quietMs, maxWaitMs, ready])

  return ready
}
