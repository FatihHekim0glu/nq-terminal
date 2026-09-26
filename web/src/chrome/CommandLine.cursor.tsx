// The command box's caret triangle and block cursor (spec 4.2). The triangle sits at the left of the
// box, bright while the line has focus and dim otherwise. The block is one PT Mono cell wide, placed at
// the text caret, and blinks between two blues with a hard cut every --caret-phase, never fully off;
// a new key restarts it in the bright phase (the element is remounted). CommandLine.css hides it when
// the line loses focus and holds it steady under prefers-reduced-motion. Decorative: aria-hidden.
import type { CSSProperties } from 'react'

export function CaretTriangle() {
  return <span className="cmd-caret" aria-hidden="true" />
}

export interface BlockCursorProps {
  /** Characters before the caret. */
  readonly column: number
  /** The input's horizontal scroll, so the block follows the text when the line is longer than the box. */
  readonly scrollLeft: number
  /** Changes on every keystroke, restarting the blink. */
  readonly restart: number
}

export function BlockCursor({ column, scrollLeft, restart }: BlockCursorProps) {
  const style = { '--col': column, '--scroll': `${scrollLeft}px` } as CSSProperties
  return <span key={restart} className="cmd-cursor" aria-hidden="true" style={style} />
}
