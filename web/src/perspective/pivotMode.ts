// How a pivot view opens (TASKS 9.1): as the accessible table or as the Perspective pivot grid. The table is
// the default when the browser asks for reduced motion (the viewer scrolls and redraws a canvas-like grid);
// once the person picks on the Show as toggle, that choice holds for every pivot view in this page.

export type PivotMode = 'table' | 'pivot'

let chosen: PivotMode | null = null

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

/** The mode a pivot view opens in, and why: the person's choice, or the motion preference. */
export function initialPivotMode(): { readonly mode: PivotMode; readonly byMotion: boolean } {
  if (chosen) return { mode: chosen, byMotion: false }
  const reduced = prefersReducedMotion()
  return { mode: reduced ? 'table' : 'pivot', byMotion: reduced }
}

export function rememberPivotMode(mode: PivotMode): void {
  chosen = mode
}

/** Forget the choice (tests). */
export function resetPivotMode(): void {
  chosen = null
}
