// The read-only IB snapshot switch in Options (desktop app only, O10). It is a chunk of its own, loaded when Options
// opens, so the bridge it reads and its copy stay out of the first-paint shell (scripts/shellBudget.test.ts keeps the
// shell at its diet target).
import { useEffect, useId, useRef, useState } from 'react'
import { getBridge } from '../bridge'
import { requestIbSwitch } from '../bridge/ibSwitch'
import { IB_SWITCH } from '../copy/ibSwitch'
import { useIbSnapshotLive } from '../screens/live/ib/ibLiveStore'

/**
 * A native button with role=switch whose checked state is the value in force in this session. A click asks the app for
 * the other value; the app confirms in its own dialog and the change applies when the terminal next starts, so the
 * switch keeps showing this session's value. The note under it says so and is its description; a polite status line
 * says where the answer is asked for. Nothing is drawn outside the desktop app (a browser, or a shell before
 * bridgeVersion 3, where the bridge states no value).
 */
// The status line passes through three texts: nothing, the asking line (set on every click, after a clear so that the
// polite live region announces each click), and a neutral line once the window has the focus back (the page is not told
// which button the owner pressed, so the line is true whatever the answer was).
const ANNOUNCE_GAP_MS = 50
type Phase = 'idle' | 'clearing' | 'asking' | 'answered'

export default function IbSwitch() {
  const on = getBridge().ibSnapshot
  // LIVE reads TWS while this app has the switch off: only a backend attached at start (not started by this app) can.
  const attachedReading = useIbSnapshotLive()
  const noteId = useId()
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (phase !== 'asking') return undefined
    const answered = () => setPhase('answered')
    window.addEventListener('focus', answered)
    return () => window.removeEventListener('focus', answered)
  }, [phase])
  if (on === null) return null
  const ask = () => {
    requestIbSwitch(!on)
    window.clearTimeout(timer.current)
    setPhase('clearing')
    timer.current = window.setTimeout(() => setPhase('asking'), ANNOUNCE_GAP_MS)
  }
  const status = phase === 'asking' ? IB_SWITCH.asked : phase === 'answered' ? IB_SWITCH.answered : ''
  return (
    <div className="frame-ib-switch">
      <button type="button" role="switch" aria-checked={on} aria-describedby={noteId} onClick={ask}>
        {IB_SWITCH.label}
      </button>
      <p id={noteId} className="frame-ib-note">{on ? IB_SWITCH.noteOn : attachedReading ? IB_SWITCH.noteOffAttached : IB_SWITCH.noteOff}</p>
      <p role="status" className="frame-ib-note">{status}</p>
    </div>
  )
}
