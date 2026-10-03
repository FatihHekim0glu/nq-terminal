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

describe('Tooltip keeps inside the viewport (born failing)', () => {
  const TIP_W = 90
  const TIP_H = 20
  function stubRects(button: { left: number; top: number; bottom: number }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'tooltip') {
        const left = parseFloat(this.style.left)
        const top = parseFloat(this.style.top)
        return { left, top, right: left + TIP_W, bottom: top + TIP_H, width: TIP_W, height: TIP_H, x: left, y: top, toJSON: () => ({}) }
      }
      return { left: button.left, top: button.top, right: button.left + 24, bottom: button.bottom, width: 24, height: button.bottom - button.top, x: button.left, y: button.top, toJSON: () => ({}) }
    })
  }
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 512)
    vi.stubGlobal('innerHeight', 320)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('clamps a keyboard-focus tip that would pass the right edge', () => {
    stubRects({ left: 488, top: 10, bottom: 34 })
    renderTip()
    fireEvent.focus(screen.getByRole('button'))
    const tip = screen.getByRole('tooltip')
    expect(parseFloat(tip.style.left) + TIP_W).toBeLessThanOrEqual(512 - 4)
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(4)
  })

  it('clamps a hover tip that would pass the right edge', () => {
    stubRects({ left: 488, top: 10, bottom: 34 })
    renderTip()
    fireEvent.pointerMove(screen.getByRole('button'), { clientX: 500, clientY: 20 })
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    const tip = screen.getByRole('tooltip')
    expect(parseFloat(tip.style.left) + TIP_W).toBeLessThanOrEqual(512 - 4)
  })

  it('flips above the control when the tip would pass the bottom edge', () => {
    stubRects({ left: 100, top: 290, bottom: 314 })
    renderTip()
    fireEvent.focus(screen.getByRole('button'))
    const tip = screen.getByRole('tooltip')
    expect(parseFloat(tip.style.top) + TIP_H).toBeLessThanOrEqual(290)
    expect(parseFloat(tip.style.top)).toBeGreaterThanOrEqual(0)
  })
})
