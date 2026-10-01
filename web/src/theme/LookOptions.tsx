// The theme group for the frame strip's Options list (TASKS Phase 12): two toggle buttons, standard and
// amber-classic, with the current one pressed. Same markup as the colour scheme group beside it, so the
// list's own styles (FrameStrip.css .frame-options-list button) apply unchanged.
import { THEME_OPTIONS } from '../copy/amberClassic'
import { LOOKS, type Look } from './look'

export interface LookOptionsProps {
  readonly look: Look
  readonly onLook: (look: Look) => void
}

export function LookOptions({ look, onLook }: LookOptionsProps) {
  return (
    <div role="group" aria-label={THEME_OPTIONS.label}>
      {LOOKS.map((l) => (
        <button key={l} type="button" aria-pressed={look === l} onClick={() => onLook(l)}>
          {THEME_OPTIONS.themes[l]}
        </button>
      ))}
    </div>
  )
}
