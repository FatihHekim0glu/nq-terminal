// The live stream's state on LIVE and JRNL (TASKS 9.2): whether server events are flowing, reconnecting or
// the screen has fallen back to polling, and why, in words (the tone only repeats them). The mode and its
// reason sit in a polite live region; the last event time, which moves with every heartbeat, stays outside
// it so a screen reader is not told every ten seconds.
import { LIVE_POLL_MS } from '../../api/queryKey'
import type { StreamSnapshot } from '../../api/liveStream'
import { useLiveStream } from '../../api/useLiveStream'
import { STREAM } from '../../copy/liveStream'
import { fillCopy } from '../../copy/workspace'
import { etClock } from '../../tiles/etTime'
import type { StateItem } from './liveModel'

const MS_PER_S = 1000

function modeText(state: StreamSnapshot, pollMs: number): string {
  if (state.mode === 'polling') return fillCopy(STREAM.modes.polling, { seconds: String(pollMs / MS_PER_S) })
  return STREAM.modes[state.mode]
}

function resumedText(state: StreamSnapshot): string {
  if (state.resumed) return STREAM.resumedYes
  return state.resumeNote ? `${STREAM.resumedNo}: ${state.resumeNote}` : STREAM.resumedNo
}

/** The stream's state as labelled values: mode first (always there, so the type says the head exists), then
 * the reason for anything but open, last event, rows and resume. */
export function streamItems(state: StreamSnapshot, pollMs: number): readonly [StateItem, ...StateItem[]] {
  const tone = state.mode === 'open' ? 'up' : 'warn'
  const mode: StateItem = { key: 'mode', label: STREAM.stream, value: modeText(state, pollMs), tone }
  const items: StateItem[] = []
  if (state.reason !== null) items.push({ key: 'reason', label: '', value: STREAM.reasons[state.reason] })
  const time = state.lastEventAt === null ? '--' : fillCopy(STREAM.lastEventValue, { time: etClock(state.lastEventAt / MS_PER_S) })
  items.push({ key: 'lastEvent', label: STREAM.lastEvent, value: time })
  items.push({ key: 'rows', label: STREAM.rows, value: String(state.rows) })
  if (state.lastEventAt !== null) items.push({ key: 'resumed', label: STREAM.resumed, value: resumedText(state) })
  return [mode, ...items]
}

export function StreamStateView({ state, pollMs }: { readonly state: StreamSnapshot; readonly pollMs: number }) {
  if (state.mode === 'off') return null
  const items = streamItems(state, pollMs)
  const [mode, ...rest] = items
  const reason = rest.find((i) => i.key === 'reason')
  const others = rest.filter((i) => i.key !== 'reason')
  return (
    <div className="live-strip live-stream" role="group" aria-label={STREAM.label} data-mode={state.mode}>
      <span className="live-item" data-key="stream-mode">
        <span className="live-label">{mode.label}</span>{' '}
        <b className={`live-value live-${mode.tone}`} role="status">
          {mode.value}
          {reason ? <span className="live-stream-reason">{`: ${reason.value}`}</span> : null}
        </b>
      </span>
      {others.map((i) => (
        <span key={i.key} className="live-item" data-key={`stream-${i.key}`}>
          <span className="live-label">{i.label}</span> <b className="live-value">{i.value}</b>
        </span>
      ))}
    </div>
  )
}

/** Opens the stream while the screen is on and shows its state. */
export default function StreamState() {
  const state = useLiveStream()
  return <StreamStateView state={state} pollMs={LIVE_POLL_MS} />
}
