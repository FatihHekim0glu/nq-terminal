// @vitest-environment jsdom
// ConnectionStrip (roadmap #7): the API DOWN banner. Renders nothing unless the connection store is
// down; one alert with the down sentence, a 1 s countdown to the next health check and Check now; an
// effect keyed on the store's recoveredAt posts the recovery message. Not mounted until W4.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection, useHealthInterval, type ConnectionState } from '../api/connection'
import { useApiQuery } from '../api/queries'
import { CONNECTION } from '../copy/connection'
import { fillCopy } from '../copy/workspace'
import { etClock } from './StatusBar.format'
import { resetMessage, useMessage } from './MessageLine.store'
import ConnectionStrip, { secondsToNextCheck } from './ConnectionStrip'

function down(overrides: Partial<ConnectionState> = {}): void {
  connectionStore.setState(
    { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now(), ...overrides },
    true,
  )
}

/** Mounted beside ConnectionStrip so a genuine /api/health query exists to refetch, as it would in the
 *  real chrome (StatusBar reads the same query). */
function Health() {
  useApiQuery('/api/health', {}, { refetchInterval: useHealthInterval(), staleTime: 0, retry: false, networkMode: 'always' })
  return null
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ kill_switch_on: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  resetConnection()
  resetMessage()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ConnectionStrip', () => {
  it('born failing: renders nothing while the connection is not down', () => {
    render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows one alert naming the down sentence and the countdown to the next check', () => {
    vi.useFakeTimers()
    const now = Date.now()
    down({ downSince: now, lastCheckAt: now })
    render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBe(1)
    const strip = alerts[0]!
    expect(strip.getAttribute('data-chrome')).toBe('connection')
    expect(strip.textContent).toContain(CONNECTION.lead)
    expect(strip.textContent).toContain(fillCopy(CONNECTION.next, { seconds: 4 }))
  })

  it('marks the countdown span aria-hidden, so a screen reader is not made to re-read the banner every second', () => {
    const now = Date.now()
    down({ downSince: now, lastCheckAt: now })
    render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    const next = document.querySelector('.conn-next')
    expect(next?.getAttribute('aria-hidden')).toBe('true')
  })

  it('counts down once a second', () => {
    vi.useFakeTimers()
    const now = Date.now()
    down({ lastCheckAt: now })
    render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    expect(document.querySelector('.conn-next')?.textContent).toBe(fillCopy(CONNECTION.next, { seconds: 4 }))
    act(() => vi.advanceTimersByTime(1000))
    expect(document.querySelector('.conn-next')?.textContent).toBe(fillCopy(CONNECTION.next, { seconds: 3 }))
  })

  it('checkNowLabel starts with the visible checkNow label (WCAG 2.5.3)', () => {
    expect(CONNECTION.checkNowLabel.startsWith(CONNECTION.checkNow)).toBe(true)
  })

  it('refetches the health query when Check now is clicked', async () => {
    down()
    const client = createApiQueryClient()
    render(
      <ApiProvider client={client}>
        <Health />
        <ConnectionStrip />
      </ApiProvider>,
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    fetchSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: CONNECTION.checkNowLabel }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/api/health'))).toBe(true)
  })

  it('posts the recovery message when the store leaves down, and stops showing the alert', () => {
    down()
    render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    const recoveredAt = Date.now()
    act(() => {
      connectionStore.setState({ status: 'ok', downSince: null, recoveredAt, retried: 2 })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useMessage.getState().text).toBe(fillCopy(CONNECTION.back, { time: etClock(new Date(recoveredAt)), n: 2 }))
  })

  it('does not repost the recovery message on a render where recoveredAt has not changed', () => {
    const recoveredAt = Date.now() - 60_000
    down({ recoveredAt })
    const { rerender } = render(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    rerender(
      <ApiProvider client={createApiQueryClient()}>
        <ConnectionStrip />
      </ApiProvider>,
    )
    expect(useMessage.getState().text).toBe('')
  })
})

describe('secondsToNextCheck: pinned, so a stale mount-time clock never shows a huge countdown', () => {
  it('clamps to the interval when now is far in the past (a stale clock)', () => {
    const t = Date.now()
    expect(secondsToNextCheck(t, 4000, t - 30 * 60_000)).toBe(4)
  })

  it('reads the full interval right at the check', () => {
    const t = Date.now()
    expect(secondsToNextCheck(t, 4000, t)).toBe(4)
  })

  it('rounds up the remaining time', () => {
    const t = Date.now()
    expect(secondsToNextCheck(t, 4000, t + 1500)).toBe(3)
  })

  it('never goes negative once the interval has passed', () => {
    const t = Date.now()
    expect(secondsToNextCheck(t, 4000, t + 9000)).toBe(0)
  })
})
