// The colour scheme switch in Options (spec 2.3): standard, deuteranopia or protanomaly, set as
// `data-cvd` on the root element (tokens.css holds the values). Kept per viewer in localStorage; every
// read and write is guarded, so blocked storage leaves the standard scheme and never throws.
import type { ColourScheme } from './FrameStrip'
import { safeLocalStorage } from '../state/safeStorage'

export const SCHEME_KEY = 'nqt.cvd'
const SCHEMES: readonly ColourScheme[] = ['standard', 'deut', 'prot']

export function isScheme(value: unknown): value is ColourScheme {
  return typeof value === 'string' && (SCHEMES as readonly string[]).includes(value)
}

export function loadScheme(): ColourScheme {
  const stored = safeLocalStorage.read(SCHEME_KEY)
  return isScheme(stored) ? stored : 'standard'
}

export function saveScheme(scheme: ColourScheme): void {
  // Blocked storage: the scheme still applies for this page view.
  safeLocalStorage.write(SCHEME_KEY, scheme)
}

export function applyScheme(scheme: ColourScheme, root: HTMLElement = document.documentElement): void {
  if (scheme === 'standard') root.removeAttribute('data-cvd')
  else root.setAttribute('data-cvd', scheme)
}
