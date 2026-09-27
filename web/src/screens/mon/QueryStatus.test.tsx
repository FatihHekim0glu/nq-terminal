// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { MARKET } from '../../copy/market'
import QueryStatus from './QueryStatus'

afterEach(cleanup)

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
})
