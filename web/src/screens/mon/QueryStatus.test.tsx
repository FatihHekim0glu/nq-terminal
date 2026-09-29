// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection } from '../../api/connection'
import { CONNECTION } from '../../copy/connection'
import { fillCopy } from '../../copy/workspace'
import { MARKET } from '../../copy/market'
import QueryStatus from './QueryStatus'

afterEach(() => {
  cleanup()
  resetConnection()
})

describe('QueryStatus (MON and CORR loading and error lines)', () => {
  // A screen still waiting for its universe is busy, so a screen reader, a screenshot or a keyboard
  // flow waits for the grid rather than reading the loading line as the screen.
  it('born failing: marks the loading line busy', () => {
    render(<QueryStatus loading error={null} />)
    const line = screen.getByRole('status')
    expect(line.textContent).toBe(MARKET.loading)
    expect(line.getAttribute('aria-busy')).toBe('true')
  })

  it('shows a gate refusal as an alert, not busy', () => {
    render(<QueryStatus loading={false} error={new ApiError({ kind: 'http', path: '/api/market/universe', status: 403, detail: 'window leaves the in-sample window' })} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('window leaves the in-sample window')
    expect(alert.hasAttribute('aria-busy')).toBe(false)
  })

  it('renders nothing once loaded', () => {
    const { container } = render(<QueryStatus loading={false} error={null} />)
    expect(container.textContent).toBe('')
  })

  // Roadmap #7: while the connection store is down and the failure is an outage, the shared
  // PanelFault waits instead of blaming the request.
  it('shows the waiting sentence, not an alert, when a 502 arrives while the backend is down', () => {
    connectionStore.setState(
      { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now() },
      true,
    )
    const error = new ApiError({ kind: 'http', path: '/api/market/universe', status: 502, body: null, detail: '502' })
    render(<QueryStatus loading={false} error={error} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(fillCopy(CONNECTION.waiting, { request: 'GET /api/market/universe', answer: '502' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the waiting-to-load sentence, not busy, while loading with the backend down', () => {
    connectionStore.setState(
      { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now() },
      true,
    )
    render(<QueryStatus loading error={null} />)
    const status = screen.getByRole('status')
    expect(status.hasAttribute('aria-busy')).toBe(false)
    expect(status.textContent).toBe(CONNECTION.waitingLoad)
  })
})
