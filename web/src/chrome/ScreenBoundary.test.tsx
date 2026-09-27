// @vitest-environment jsdom
// ScreenBoundary: a screen that throws while it renders becomes one panel's alert, never the whole terminal.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE } from '../copy/workspace'
import ScreenBoundary from './ScreenBoundary'

function Broken(): never {
  throw new Error('2011-01-08 is not a weekday session')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScreenBoundary', () => {
  it('turns a render error into an alert in its own panel and leaves siblings drawn', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <div>
        <ScreenBoundary resetKey="DQ:NQ">
          <Broken />
        </ScreenBoundary>
        <p>other panel</p>
      </div>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(WORKSPACE.screenFailed.split('{')[0]!.trim())
    expect(alert.textContent).toContain('2011-01-08 is not a weekday session')
    expect(screen.getByText('other panel')).toBeTruthy()
  })

  it('draws its children when nothing throws', () => {
    render(<ScreenBoundary resetKey="a"><p>fine</p></ScreenBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tries again when the screen or its context changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(<ScreenBoundary resetKey="a"><Broken /></ScreenBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<ScreenBoundary resetKey="b"><p>recovered</p></ScreenBoundary>)
    expect(screen.getByText('recovered')).toBeTruthy()
  })

  it('born failing: without the boundary the same render error escapes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Broken />)).toThrow(/not a weekday/)
  })
})
