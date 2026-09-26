// The event tape switch (spec 4.9, decision D4): off by default, toggled by NO <GO> or Options, kept per
// viewer in localStorage. Every read and write is guarded, so blocked or broken storage leaves the
// tape off and never throws.
import { useSyncExternalStore } from 'react'

export interface TapeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'nqt.tape'
// Module state on purpose: this is the external store useSyncExternalStore reads, shared with the
// command line (NO <GO>) outside React. Only setTapeOn, resetTapeCache and useTapeOn's subscribe
// touch `listeners` and `current`; add no other writer.
const listeners = new Set<() => void>()

function browserStorage(): TapeStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadTapeOn(storage: TapeStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function saveTapeOn(on: boolean, storage: TapeStorage | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, on ? 'true' : 'false')
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
