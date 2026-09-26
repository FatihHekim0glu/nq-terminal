// The key map overlay (spec 5.2, Alt+K; the wrench on the key toolbar): the drawn keyboard and the key
// table from HELP in a floating dialog under the key toolbar. Alt+K again, Esc or Close shuts it and
// focus goes back where it was. Non-modal: the command line and the panels stay usable.
import { useEffect, useRef } from 'react'
import { KEYMAP } from '../copy/chrome'
import { KeyboardDrawing, KeyTable } from './HelpScreen.keymap'
import './KeyToolbar.overlay.css'

export interface KeyMapOverlayProps {
  readonly onClose: () => void
}

export function KeyMapOverlay({ onClose }: KeyMapOverlayProps) {
  const box = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    heading.current?.focus()
    return () => {
      if (back?.isConnected) back.focus()
    }
  }, [])
  return (
    <div
      ref={box}
      className="keymap-overlay"
      role="dialog"
      aria-labelledby="nqt-keymap-title"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="keymap-head">
        <h2 id="nqt-keymap-title" ref={heading} tabIndex={-1}>{KEYMAP.title}</h2>
        <button type="button" onClick={onClose} aria-label={KEYMAP.close}>{KEYMAP.closeText}</button>
      </div>
      <div className="keymap-body">
        <KeyboardDrawing />
        <KeyTable />
      </div>
    </div>
  )
}
