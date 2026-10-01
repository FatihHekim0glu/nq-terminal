// The theme preference (TASKS Phase 12): the standard look or amber-classic, set as data-theme on the
// root element (src/theme/amberClassic.css holds the values). Independent of the colour scheme
// (data-cvd). Kept per viewer through safeStorage; a stored value is untrusted and validated, and
// blocked storage leaves the standard theme without an error.
import { safeLocalStorage, type SafeStorage } from '../state/safeStorage'

// Defined here, not in amberClassic.ts, which reads the token tables for the contrast checks: the first-paint shell
// imports this file and must not pull those in. amberClassic.ts re-exports the name.
export const AMBER_CLASSIC_THEME = 'amber-classic'

export type Look = 'standard' | typeof AMBER_CLASSIC_THEME

export const LOOKS: readonly Look[] = ['standard', AMBER_CLASSIC_THEME]
export const LOOK_KEY = 'nqt.theme'
export const THEME_ATTRIBUTE = 'data-theme'

export function isLook(value: unknown): value is Look {
  return typeof value === 'string' && (LOOKS as readonly string[]).includes(value)
}

export function loadLook(storage: SafeStorage = safeLocalStorage): Look {
  const stored = storage.read(LOOK_KEY)
  return isLook(stored) ? stored : 'standard'
}

/** True when the choice was stored; false leaves it applied for this page view only. */
export function saveLook(look: Look, storage: SafeStorage = safeLocalStorage): boolean {
  return storage.write(LOOK_KEY, look)
}

interface ThemeRoot {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

export function applyLook(look: Look, root: ThemeRoot = document.documentElement): void {
  if (look === 'standard') root.removeAttribute(THEME_ATTRIBUTE)
  else root.setAttribute(THEME_ATTRIBUTE, look)
}

/** Applies the stored theme (the standard one when nothing valid is stored) and returns it. Called before the
 * first render, so a viewer who chose amber-classic never sees the standard colours flash. */
export function applyStoredLook(storage: SafeStorage = safeLocalStorage, root: ThemeRoot = document.documentElement): Look {
  const look = loadLook(storage)
  applyLook(look, root)
  return look
}
