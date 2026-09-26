// The colour scheme switch in Options (spec 2.3): standard, deuteranopia or protanomaly, set as
// `data-cvd` on the root element (tokens.css holds the values). Kept per viewer in localStorage; every
// read and write is guarded, so blocked storage leaves the standard scheme and never throws.
import type { ColourScheme } from './FrameStrip'

const KEY = 'nqt.cvd'
const SCHEMES: readonly ColourScheme[] = ['standard', 'deut', 'prot']

function isScheme(value: unknown): value is ColourScheme {
  return typeof value === 'string' && (SCHEMES as readonly string[]).includes(value)
}

export function loadScheme(): ColourScheme {
  try {
    const stored = globalThis.localStorage?.getItem(KEY)
    return isScheme(stored) ? stored : 'standard'
  } catch {
    return 'standard'
  }
}

export function saveScheme(scheme: ColourScheme): void {
  try {
    globalThis.localStorage?.setItem(KEY, scheme)
  } catch {
    // Blocked storage: the scheme still applies for this page view.
  }
}

export function applyScheme(scheme: ColourScheme, root: HTMLElement = document.documentElement): void {
  if (scheme === 'standard') root.removeAttribute('data-cvd')
  else root.setAttribute('data-cvd', scheme)
}
