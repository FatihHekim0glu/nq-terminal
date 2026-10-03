// The event tape switch (spec 4.9, decision D4): off by default, toggled by NO <GO> or Options, kept per
// viewer in localStorage. Every read and write is guarded, so blocked or broken storage leaves the
// tape off and never throws.
import { useSyncExternalStore } from 'react'
import { asItemStorage } from '../state/safeStorage'

export interface TapeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const TAPE_KEY = 'nqt.tape'
// Module state on purpose: this is the external store useSyncExternalStore reads, shared with the
// command line (NO <GO>) outside React. Only setTapeOn, resetTapeCache and useTapeOn's subscribe
// touch `listeners` and `current`; add no other writer.
const listeners = new Set<() => void>()

export function loadTapeOn(storage: TapeStorage | null = asItemStorage()): boolean {
  try {
    return storage?.getItem(TAPE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveTapeOn(on: boolean, storage: TapeStorage | null = asItemStorage()): void {
  try {
    storage?.setItem(TAPE_KEY, on ? 'true' : 'false')
  } catch {
    // Blocked storage: the switch still works for this page view.
  }
}

let current: boolean | null = null

function read(): boolean {
  current ??= loadTapeOn()
  return current
}

/** Sets the tape on or off, saves it and tells every subscriber. Returns the new state. */
export function setTapeOn(on: boolean): boolean {
  current = on
  saveTapeOn(on)
  for (const l of listeners) l()
  return on
}

export function toggleTape(): boolean {
  return setTapeOn(!read())
}

/** Forget the cached state so the next read goes back to storage (tests). */
export function resetTapeCache(): void {
  current = null
}

/** The workspace store changed the stored switch under this page: read it again. Subscribers are told, and
 * re-render only if the value moved. Called by state/remoteStore.ts, which loads on its own, so the listener is not part of the first-paint shell. */
export function refreshTape(): void {
  current = null
  for (const l of listeners) l()
}

export function useTapeOn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => false,
  )
}
