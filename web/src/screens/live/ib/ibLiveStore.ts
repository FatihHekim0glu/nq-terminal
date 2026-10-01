// The one fact the first-paint shell needs about the IB snapshot: is it live right now. The status line reads this
// small store (no react-query, no model, no panel code), so the shell stays as small as the budget asks; the LIVE
// panel, which is lazy, writes it. The value is true only while the panel has just seen an ok snapshot that is fresh,
// and the panel resets it to false when it unmounts or the snapshot goes stale, so "TWS: read-only snapshot" never
// outlives the evidence for it.
import { useSyncExternalStore } from 'react'
import { STATUS_BAR } from '../../../copy/chrome'
import { IB_STATUS_BAR } from '../../../copy/ibStatus'

let live = false
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setIbSnapshotLive(next: boolean): void {
  if (next === live) return
  live = next
  for (const listener of [...listeners]) listener()
}

export const useIbSnapshotLive = (): boolean => useSyncExternalStore(subscribe, () => live, () => false)

/** The value of the status line's TWS segment: "read-only snapshot" when live, otherwise "not monitored". */
export const twsSegmentValue = (snapshotLive: boolean): string => (snapshotLive ? IB_STATUS_BAR.twsLive : STATUS_BAR.twsValue)
