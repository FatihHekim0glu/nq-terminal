// @vitest-environment jsdom
// GpStatus's ChartMessage (roadmap #7): the message shown in place of the chart while nothing has
// loaded, while a request is pending, on a refusal or on an error. While the connection store is down
// the waiting sentence should only replace a message that is actually about a pending or failed
// request, never guidance or an empty-state sentence that names nothing being fetched.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection } from '../../api/connection'
import { CONNECTION } from '../../copy/connection'
import { fillCopy } from '../../copy/workspace'
import { ChartMessage } from './GpStatus'

afterEach(() => {
  cleanup()
  resetConnection()
})

function goDown(): void {
  connectionStore.setState({ ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now() }, true)
}

describe('ChartMessage: while the connection store is down', () => {
  it('shows guidance text unchanged, not the waiting-to-load sentence, when nothing is pending', () => {
    goDown()
    render(<ChartMessage refusal={null} error={null} text="guidance" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('guidance')
    expect(status.textContent).not.toBe(CONNECTION.waitingLoad)
  })

  it('shows the waiting-to-load sentence as a status, with no aria-busy, while busy', () => {
    goDown()
    render(<ChartMessage refusal={null} error={null} text="Loading..." busy />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(CONNECTION.waitingLoad)
    expect(status.hasAttribute('aria-busy')).toBe(false)
  })

  it('shows the waiting sentence for a 502 error', () => {
    goDown()
    const error = new ApiError({ kind: 'http', path: '/api/bars?symbol=NQ', status: 502, body: null, detail: '502' })
    render(<ChartMessage refusal={null} error={error} text={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(fillCopy(CONNECTION.waiting, { request: 'GET /api/bars', answer: '502' }))
  })
})

describe('ChartMessage: while the connection store is not down', () => {
  it('shows the text busy, as before', () => {
    render(<ChartMessage refusal={null} error={null} text="Loading..." busy />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading...')
    expect(status.getAttribute('aria-busy')).toBe('true')
  })
})
