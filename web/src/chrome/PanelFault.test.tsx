// @vitest-environment jsdom
// PanelFault (roadmap #7): the one fault line every panel's status area shows (failed, 403 refused,
// or waiting while the connection store is down and the error is an outage), plus PanelLoading, its
// loading-side twin.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection, type ConnectionState } from '../api/connection'
import { CONNECTION } from '../copy/connection'
import { CONNECTION_PANEL } from '../copy/connectionPanel'
import { MARKET } from '../copy/market'
import { fillCopy } from '../copy/workspace'
import PanelFault, { PanelLoading, useWaitingForBackend } from './PanelFault'
import { ROVING_ATTR, syncRoving } from './WorkspaceFocus'

afterEach(() => {
  cleanup()
  resetConnection()
})

function goDown(overrides: Partial<ConnectionState> = {}): void {
  connectionStore.setState(
    { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now(), ...overrides },
    true,
  )
}

describe('PanelFault: failed', () => {
  it('shows a red alert naming the detail, with a Retry button when onRetry is given', () => {
    const onRetry = vi.fn()
    const error = new ApiError({ kind: 'http', path: '/api/hypotheses/overnight_v0', status: 500, body: { detail: 'disk read failed' }, detail: 'disk read failed' })
    render(<PanelFault error={error} failedText="Could not load {detail}" onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not load disk read failed')
    expect(alert.className).toContain('panel-fault-failed')
    const button = screen.getByRole('button', { name: CONNECTION_PANEL.retryLabel })
    expect(button.textContent).toBe(CONNECTION_PANEL.retry)
    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('calls onRetry with no arguments, not the click event', () => {
    const onRetry = vi.fn()
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 500, body: null, detail: 'failed' })
    render(<PanelFault error={error} failedText="failed: {detail}" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: CONNECTION_PANEL.retryLabel }))
    expect(onRetry.mock.calls[0]).toEqual([])
  })

  it('gives the Retry button data-roving, so the panel roving tabindex can reach it', () => {
    const onRetry = vi.fn()
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 500, body: null, detail: 'failed' })
    const { container } = render(
      <div>
        <PanelFault error={error} failedText="failed: {detail}" onRetry={onRetry} />
      </div>,
    )
    const panel = container.firstElementChild as HTMLElement
    syncRoving(panel)
    const button = screen.getByRole('button', { name: CONNECTION_PANEL.retryLabel })
    expect(button.hasAttribute(ROVING_ATTR)).toBe(true)
    expect(button.tabIndex).toBe(0)
  })

  it('shows no button when onRetry is not given', () => {
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 404, body: null, detail: 'not found' })
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    expect(screen.getByRole('alert').textContent).toBe('failed: not found')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses a plain Error message as the detail when the error is not an ApiError', () => {
    render(<PanelFault error={new Error('kaboom')} failedText="failed: {detail}" />)
    expect(screen.getByRole('alert').textContent).toBe('failed: kaboom')
  })
})

describe('PanelFault: 403 refused', () => {
  it('shows an amber alert with MARKET.refused by default', () => {
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 403, body: { detail: 'window leaves the in-sample window' }, detail: 'window leaves the in-sample window' })
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('panel-fault-refused')
    expect(alert.textContent).toBe(fillCopy(MARKET.refused, { detail: 'window leaves the in-sample window' }))
  })

  it('uses a caller-supplied refusedText template instead', () => {
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 403, body: { detail: 'gated' }, detail: 'gated' })
    render(<PanelFault error={error} failedText="failed: {detail}" refusedText="refused here: {detail}" />)
    expect(screen.getByRole('alert').textContent).toBe('refused here: gated')
  })
})

describe('PanelFault: waiting', () => {
  it('born failing: shows a status naming GET <path> and the answer while down on a 502, not an alert', () => {
    const error = new ApiError({ kind: 'http', path: '/api/bars?symbol=NQ', status: 502, body: null, detail: '502' })
    goDown()
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(fillCopy(CONNECTION_PANEL.waiting, { request: 'GET /api/bars', answer: '502' }))
    expect(status.className).toContain('panel-fault-waiting')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('also waits on a bodiless 500 (the dev proxy answering an unreachable backend) while down', () => {
    const error = new ApiError({ kind: 'http', path: '/api/health', status: 500, body: null, detail: '500' })
    goDown()
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    expect(screen.getByRole('status').textContent).toBe(fillCopy(CONNECTION_PANEL.waiting, { request: 'GET /api/health', answer: '500' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names noAnswer for a network failure with no status', () => {
    const error = new ApiError({ kind: 'network', path: '/api/bars', detail: 'the request failed' })
    goDown()
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    expect(screen.getByRole('status').textContent).toBe(fillCopy(CONNECTION_PANEL.waiting, { request: 'GET /api/bars', answer: CONNECTION.noAnswer }))
  })

  it('does not wait for a 403 even while down (never an outage)', () => {
    const error = new ApiError({ kind: 'http', path: '/api/x', status: 403, body: null, detail: 'refused' })
    goDown()
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    expect(screen.getByRole('alert').className).toContain('panel-fault-refused')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not wait once the connection is back up', () => {
    const error = new ApiError({ kind: 'http', path: '/api/bars', status: 502, body: null, detail: '502' })
    goDown()
    connectionStore.setState({ status: 'ok' })
    render(<PanelFault error={error} failedText="failed: {detail}" />)
    expect(screen.getByRole('alert').className).toContain('panel-fault-failed')
  })
})

describe('PanelLoading', () => {
  it('born failing: is busy while the connection is not down', () => {
    render(<PanelLoading text="Loading overnight_v0..." />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toBe('Loading overnight_v0...')
  })

  it('is not busy and shows the waiting-to-load sentence while the connection is down', () => {
    goDown()
    render(<PanelLoading text="Loading overnight_v0..." />)
    const status = screen.getByRole('status')
    expect(status.hasAttribute('aria-busy')).toBe(false)
    expect(status.textContent).toBe(CONNECTION_PANEL.waitingLoad)
  })
})

describe('useWaitingForBackend: subscribes only to the down status, not the whole store', () => {
  it('does not re-render on a health poll (lastCheckAt) that leaves status unchanged, but does on a status change', () => {
    let renders = 0
    let latest = false
    function Probe() {
      latest = useWaitingForBackend(null)
      renders += 1
      return null
    }
    render(<Probe />)
    const before = renders
    act(() => {
      connectionStore.setState({ lastCheckAt: Date.now() + 1 })
    })
    expect(renders).toBe(before)
    act(() => {
      connectionStore.setState({ status: 'down', failures: DOWN_AFTER })
    })
    expect(renders).toBe(before + 1)
    expect(latest).toBe(true)
  })
})
