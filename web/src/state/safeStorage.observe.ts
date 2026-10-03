// The write observer of the shared storage, kept out of the first-paint shell (state/safeStorage.ts is part of it).
// The workspace store (state/remoteStore.ts, its own chunk) installs it when it starts; until then, and wherever there
// is no backend, the shared storage behaves exactly as plain localStorage.
import { safeLocalStorage } from './safeStorage'

/** Told of every write to, and removal from, the shared storage (value null for a removal), whether or not the
 * browser took it: the workspace store sends the ten keys on to the backend. */
export type WriteObserver = (key: string, value: string | null) => void

let writeObserver: WriteObserver | null = null
let wrapped = false

function tell(key: string, value: string | null): void {
  try {
    writeObserver?.(key, value)
  } catch {
    // An observer that fails must never break a write the page has already made.
  }
}

/**
 * Installs (or, with null, removes) the observer of the shared storage's writes; one at a time. The first call makes
 * the shared instance's `write` and `remove` tell the current observer after they run; the instance is the page's
 * one door to those keys, so the wrapping is done once and kept.
 */
export function setWriteObserver(observer: WriteObserver | null): void {
  writeObserver = observer
  if (wrapped) return
  wrapped = true
  const { write, remove } = safeLocalStorage
  safeLocalStorage.write = (key, value) => {
    const stored = write(key, value)
    tell(key, value)
    return stored
  }
  safeLocalStorage.remove = (key) => {
    const removed = remove(key)
    tell(key, null)
    return removed
  }
}
