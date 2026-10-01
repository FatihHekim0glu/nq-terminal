// The theme preference as React state: starts from the stored choice, applies data-theme before paint,
// stores each new choice and follows a change made in another window (the same storage event the saved
// layouts and workspaces follow). `onChange` lets the shell post its message-line notice; it may be a new
// function on every render without changing what `choose` is.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { safeLocalStorage, type SafeStorage } from '../state/safeStorage'
import { LOOK_KEY, applyLook, loadLook, saveLook, type Look } from './look'

export interface LookState {
  readonly look: Look
  readonly choose: (next: Look) => void
}

export function useLook(onChange?: (look: Look) => void, storage: SafeStorage = safeLocalStorage): LookState {
  const [look, setLook] = useState<Look>(() => loadLook(storage))
  const notify = useRef(onChange)
  useLayoutEffect(() => {
    notify.current = onChange
  })
  useLayoutEffect(() => applyLook(look), [look])
  useLayoutEffect(() => {
    const follow = (e: StorageEvent) => {
      if (e.key !== null && e.key !== LOOK_KEY) return
      setLook(loadLook(storage))
    }
    window.addEventListener('storage', follow)
    return () => window.removeEventListener('storage', follow)
  }, [storage])
  const choose = useCallback(
    (next: Look) => {
      setLook(next)
      saveLook(next, storage)
      notify.current?.(next)
    },
    [storage],
  )
  return { look, choose }
}
