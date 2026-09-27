// @vitest-environment jsdom
// Countdown (TASKS 5.4, UI_SPEC section 7 LIVE): time left to the paper book's decision (15:55:05 ET)
// and order (15:59:30 ET) on the backend's `today_et`, and days to the MNQ roll. A clock, not an
// animation: role="timer" (not announced on every tick), one update per second when live.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../api/types'
import Countdown, { countdownState } from './Countdown'
import { etEpochMs } from './etTime'

const NEXT: Schemas['NextTimes'] = { contract: 'MNQZ1', decision_et: '15:55:05', order_et: '15:59:30', roll_date: '2021-12-07', today_et: '2021-11-10' }
const at = (time: string) => etEpochMs('2021-11-10', time)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('countdownState', () => {
  it('counts down to both times before the decision', () => {
    const s = countdownState(NEXT, at('14:31:55'))
    expect(s.decision).toEqual({ passed: false, left: '01:23:10' })
    expect(s.order).toEqual({ passed: false, left: '01:27:35' })
    expect(s.rollDays).toBe(27)
  })

  it('marks the decision passed and still counts to the order between the two', () => {
    const s = countdownState(NEXT, at('15:57:00'))
    expect(s.decision.passed).toBe(true)
    expect(s.order).toEqual({ passed: false, left: '00:02:30' })
  })

  it('marks both passed after the order time', () => {
    const s = countdownState(NEXT, at('16:10:00'))
    expect(s.decision.passed && s.order.passed).toBe(true)
  })
})

describe('Countdown', () => {
  it('shows the ET times, the time left and the roll, in a labelled group', () => {
    render(<Countdown next={NEXT} now={at('14:31:55')} />)
    const group = screen.getByRole('group', { name: 'Paper book times for 2021-11-10 (ET)' })
    expect(group.textContent).toBe('Decision 15:55:05 ET in 01:23:10Order 15:59:30 ET in 01:27:35Roll 2021-12-07 (MNQZ1) in 27 days')
    const timers = screen.getAllByRole('timer')
    expect(timers.map((t) => t.getAttribute('aria-label'))).toEqual(['Decision in 01:23:10', 'Order in 01:27:35'])
  })

  it('says passed once a time has gone, and today on the roll date', () => {
    render(<Countdown next={{ ...NEXT, roll_date: '2021-11-10' }} now={at('15:57:00')} />)
    expect(screen.getByTestId('cd-decision').textContent).toBe('Decision 15:55:05 ET passed')
    expect(screen.getByTestId('cd-roll').textContent).toBe('Roll 2021-11-10 (MNQZ1) today')
  })

  it('ticks once a second with the live clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('15:55:00'))
    render(<Countdown next={NEXT} />)
    expect(screen.getByTestId('cd-decision').textContent).toBe('Decision 15:55:05 ET in 00:00:05')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByTestId('cd-decision').textContent).toBe('Decision 15:55:05 ET in 00:00:04')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByTestId('cd-decision').textContent).toBe('Decision 15:55:05 ET passed')
  })

  it('does not tick when given a fixed time (gallery and screenshots)', () => {
    vi.useFakeTimers()
    render(<Countdown next={NEXT} now={at('14:31:55')} />)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByTestId('cd-decision').textContent).toBe('Decision 15:55:05 ET in 01:23:10')
  })
})
