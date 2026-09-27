// Countdown (TASKS 5.4, UI_SPEC section 7 LIVE, look spec 7.11): time left to the paper book's
// decision (15:55:05 ET) and order (15:59:30 ET) on the backend's `today_et`, and days to the MNQ roll
// date from mnq_roll. It is a clock, not an animation: the remaining times are role="timer" (live
// regions that stay quiet on every tick) and change once a second only when no fixed `now` is given.
import { useEffect, useState } from 'react'
import type { Schemas } from '../api/types'
import { COUNTDOWN } from '../copy/tiles'
import { fillCopy } from '../copy/workspace'
import { daysBetween, etEpochMs, formatDuration } from './etTime'
import './tiles.css'

export type NextTimes = Schemas['NextTimes']

export interface CountdownProps {
  readonly next: NextTimes
  /** A fixed instant (epoch ms); omitted, the component runs its own one-second clock. */
  readonly now?: number
}

export interface Remaining {
  readonly passed: boolean
  readonly left: string
}

export interface CountdownState {
  readonly decision: Remaining
  readonly order: Remaining
  readonly rollDays: number
}

const TICK_MS = 1000

function remaining(date: string, time: string, now: number): Remaining {
  const ms = etEpochMs(date, time) - now
  return ms <= 0 ? { passed: true, left: formatDuration(0) } : { passed: false, left: formatDuration(ms) }
}

export function countdownState(next: NextTimes, now: number): CountdownState {
  return {
    decision: remaining(next.today_et, next.decision_et, now),
    order: remaining(next.today_et, next.order_et, now),
    rollDays: daysBetween(next.today_et, next.roll_date),
  }
}

function useClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now())
  useEffect(() => {
    if (fixed !== undefined) return undefined
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [fixed])
  return fixed ?? now
}

function TimeSegment({ id, what, time, r }: { readonly id: string; readonly what: string; readonly time: string; readonly r: Remaining }) {
  const left = fillCopy(COUNTDOWN.remaining, { left: r.left })
  return (
    <span className="cd-seg" data-testid={id}>
      <span className="cd-label">{what}</span> <span className="cd-time">{fillCopy(COUNTDOWN.timeEt, { time })}</span>{' '}
      {r.passed ? (
        <span className="cd-passed">{COUNTDOWN.passed}</span>
      ) : (
        <span className="cd-left" role="timer" aria-label={fillCopy(COUNTDOWN.remainingLabel, { what, left: r.left })}>{left}</span>
      )}
    </span>
  )
}

function rollText(days: number): string {
  if (days < 0) return COUNTDOWN.passed
  if (days === 0) return COUNTDOWN.rollToday
  return days === 1 ? COUNTDOWN.rollOneDay : fillCopy(COUNTDOWN.rollDays, { n: days })
}

export default function Countdown({ next, now }: CountdownProps) {
  const clock = useClock(now)
  const s = countdownState(next, clock)
  return (
    <div className="countdown" role="group" aria-label={fillCopy(COUNTDOWN.label, { date: next.today_et })}>
      <TimeSegment id="cd-decision" what={COUNTDOWN.decision} time={next.decision_et} r={s.decision} />
      <TimeSegment id="cd-order" what={COUNTDOWN.order} time={next.order_et} r={s.order} />
      <span className="cd-seg" data-testid="cd-roll">
        <span className="cd-label">{COUNTDOWN.roll}</span>{' '}
        <span className="cd-time">{fillCopy(COUNTDOWN.rollDate, { date: next.roll_date, contract: next.contract })}</span>{' '}
        <span className={s.rollDays < 0 ? 'cd-passed' : 'cd-left'}>{rollText(s.rollDays)}</span>
      </span>
    </div>
  )
}
