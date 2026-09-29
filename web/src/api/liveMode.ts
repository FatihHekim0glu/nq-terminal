// The live stream's mode as the polling decisions see it (TASKS 9.2). The stream client (liveStream.ts,
// useLiveStream.ts) loads with LIVE and JRNL, not with the first-paint shell; the live hooks in queries.ts,
// which the shell holds, only need to know whether to poll. This is the one place they read that: 'off'
// until the hub (useLiveStream.ts) opens a stream and writes each change of mode here. Import nothing from
// the stream client at run time (a type import is erased), or the shell would load it again.
import { useSyncExternalStore } from 'react'
import { LIVE_POLL_MS } from './queryKey'
import type { StreamMode } from './liveStream'

let mode: StreamMode = 'off'
const listeners = new Set<() => void>()

/** Whether the live queries poll: only while no stream is open or on its way. */
export function pollIntervalFor(streamMode: StreamMode, pollMs: number): number | false {
  return streamMode === 'polling' || streamMode === 'off' ? pollMs : false
}

/** The hub writes the mode after every change of the stream's state; the same mode twice tells nobody. */
export function setStreamMode(next: StreamMode): void {
  if (next === mode) return
  mode = next
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getMode = (): StreamMode => mode

/** The live queries' polling interval: none while the stream is open or on its way, P0's otherwise.
 *  Subscribes to the mode only, not the whole StreamSnapshot (useLiveStreamState): the stream patches its
 *  snapshot (lastEventAt, rows) on every event, and every live hook calls this through useLive, so a
 *  full-snapshot subscription would re-render every LIVE and JRNL screen tree once per streamed row or
 *  heartbeat even though the returned interval almost never changes (D30). */
export function useLivePollInterval(): number | false {
  return pollIntervalFor(useSyncExternalStore(subscribe, getMode, getMode), LIVE_POLL_MS)
}
