// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Tooltip, { TOOLTIP_DELAY_MS } from './Tooltip'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderTip() {
  return render(
    <Tooltip text="Maximise panel">
      <button type="button">□</button>
    </Tooltip>,
  )
}

describe('Tooltip (look spec 4.5, WCAG 1.4.13)', () => {
  it('waits 500ms after the pointer rests, then shows beside the pointer', () => {
    renderTip()
    const trigger = screen.getByRole('button')
    fireEvent.pointerMove(trigger, { clientX: 100, clientY: 50 })
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe('Maximise panel')
    expect(tip.style.left).toBe('112px')
    expect(tip.style.top).toBe('70px')
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id)
  })

  it('restarts the wait while the pointer moves', () => {
    renderTip()
    const trigger = screen.getByRole('button')
    fireEvent.pointerMove(trigger, { clientX: 1, clientY: 1 })
    act(() => vi.advanceTimersByTime(400))
    fireEvent.pointerMove(trigger, { clientX: 2, clientY: 2 })
    act(() => vi.advanceTimersByTime(400))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('hides at once when the pointer leaves, but stays while the pointer is over the tip (hoverable)', () => {
    renderTip()
    const trigger = screen.getByRole('button')
    fireEvent.pointerMove(trigger, { clientX: 1, clientY: 1 })
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    const tip = screen.getByRole('tooltip')
    fireEvent.pointerLeave(trigger, { relatedTarget: tip })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.pointerLeave(tip, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows at once on keyboard focus and hides on blur', () => {
    renderTip()
    const trigger = screen.getByRole('button')
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is dismissed with Escape without moving focus (1.4.13)', () => {
    renderTip()
    const trigger = screen.getByRole('button')
    trigger.focus()
    fireEvent.focus(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('born failing (D15): Escape dismisses a hover-shown tip even when focus is elsewhere (WCAG 1.4.13)', () => {
    render(
      <div>
        <button type="button">other</button>
        <Tooltip text="Maximise panel">
          <button type="button">□</button>
        </Tooltip>
      </div>,
    )
    const other = screen.getByRole('button', { name: 'other' })
    const trigger = screen.getByRole('button', { name: '□' })
    other.focus()
    fireEvent.pointerMove(trigger, { clientX: 1, clientY: 1 })
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(document.activeElement).toBe(other)
  })

  it('keeps the trigger’s own handlers', () => {
    const onClick = vi.fn()
    render(
      <Tooltip text="Back">
        <button type="button" onClick={onClick}>{'<'}</button>
      </Tooltip>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })
})
