// ConnectionStrip (roadmap #7): the API DOWN banner. Always mounted (from W4) so it can catch its own
// recovery: it renders nothing until the connection store goes down, then a 22px alert row naming the
// down sentence, a 1 s countdown to the next health check and Check now (checkHealthNow). An effect
// keyed on the store's recoveredAt posts the recovery message once, whether or not the row is showing
// at that instant, which is why the effect runs before the down/not-down return.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { checkHealthNow, healthIntervalMs, useConnection } from '../api/connection'
import { CONNECTION } from '../copy/connection'
import { fillCopy } from '../copy/workspace'
import { postMessage } from './MessageLine.store'
import { etClock } from './StatusBar.format'
import './ConnectionStrip.css'

const TICK_MS = 1000

/** Seconds to the next check, clamped to the interval itself: the first render after going down can
 *  carry a stale `now` (useTickingNow's state is fixed at mount, possibly long before), which would
 *  otherwise show a huge countdown until the effect corrects it. */
export function secondsToNextCheck(lastCheckAt: number, intervalMs: number, now: number): number {
  return Math.min(Math.ceil(intervalMs / 1000), Math.max(0, Math.ceil((lastCheckAt + intervalMs - now) / 1000)))
}

/** A 1 s clock, running only while `active` (no point ticking a countdown that is not shown). */
function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export default function ConnectionStrip() {
  const state = useConnection()
  const client = useQueryClient()
  const down = state.status === 'down'
  const now = useTickingNow(down)
  const seenRecoveredAt = useRef(state.recoveredAt)

  useEffect(() => {
    if (state.recoveredAt !== null && state.recoveredAt !== seenRecoveredAt.current) {
      postMessage(fillCopy(CONNECTION.back, { time: etClock(new Date(state.recoveredAt)), n: state.retried }))
    }
    seenRecoveredAt.current = state.recoveredAt
  }, [state.recoveredAt, state.retried])

  if (!down) return null

  const since = state.downSince !== null ? etClock(new Date(state.downSince)) : ''
  const answer = state.lastError !== null && state.lastError.status !== 0 ? String(state.lastError.status) : CONNECTION.noAnswer
  const seconds = state.lastCheckAt !== null ? secondsToNextCheck(state.lastCheckAt, healthIntervalMs(state), now) : 0

  return (
    <div className="conn-strip" role="alert" data-chrome="connection">
      <b className="conn-lead">{CONNECTION.lead}</b>
      <span>{fillCopy(CONNECTION.down, { since, answer })}</span>
      <span className="conn-next" aria-hidden="true">{fillCopy(CONNECTION.next, { seconds })}</span>
      <button type="button" className="conn-check" aria-label={CONNECTION.checkNowLabel} onClick={() => checkHealthNow(client)}>
        {CONNECTION.checkNow}
      </button>
    </div>
  )
}
