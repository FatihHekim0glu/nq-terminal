// @vitest-environment jsdom
// U12: Up/Down on a focused control used to be left entirely to the browser's own scroll, which can
// carry the control out of view (HELP's mnemonic rail, a KPI tile row, 3 to 5 presses). An opted-in
// vertical list now roves on Up/Down like the panel already does on Left/Right; everywhere else, once
// the browser's own scroll has happened, the still-focused control is nudged back into view.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROVING_VERTICAL_ATTR, handleRovingKey } from './WorkspaceFocus'

function panel(html: string): HTMLElement {
  const el = document.createElement('section')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function key(target: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleRovingKey: an opted-in vertical list roves on Up and Down', () => {
  it('moves down and up between the list items, clamped at the ends', () => {
    const el = panel(`
      <div ${ROVING_VERTICAL_ATTR}="">
        <button data-roving id="a">a</button>
        <button data-roving id="b">b</button>
        <button data-roving id="c">c</button>
      </div>`)
    const a = el.querySelector<HTMLElement>('#a')!
    const b = el.querySelector<HTMLElement>('#b')!
    const c = el.querySelector<HTMLElement>('#c')!
    expect(handleRovingKey(el, key(a, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(b)
    expect(handleRovingKey(el, key(b, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(c)
    // Clamped: one more Down at the last item does nothing (still handled, no scroll needed either).
    expect(handleRovingKey(el, key(c, 'ArrowDown'))).toBe(false)
    expect(handleRovingKey(el, key(c, 'ArrowUp'))).toBe(true)
    expect(document.activeElement).toBe(b)
    expect(handleRovingKey(el, key(b, 'ArrowUp'))).toBe(true)
    expect(document.activeElement).toBe(a)
    expect(handleRovingKey(el, key(a, 'ArrowUp'))).toBe(false)
  })

  it('prevents the default scroll when it moves focus', () => {
    const el = panel(`
      <div ${ROVING_VERTICAL_ATTR}="">
        <button data-roving id="a">a</button>
        <button data-roving id="b">b</button>
      </div>`)
    const a = el.querySelector('#a') as HTMLElement
    const event = key(a, 'ArrowDown')
    handleRovingKey(el, event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not treat a plain roving item outside any vertical list as one', () => {
    const el = panel(`<button data-roving id="a">a</button><button data-roving id="b">b</button>`)
    const a = el.querySelector('#a') as HTMLElement
    expect(handleRovingKey(el, key(a, 'ArrowDown'))).toBe(false)
    expect(document.activeElement).not.toBe(el.querySelector('#b'))
  })

  it('two separate vertical lists in the same panel do not cross into each other', () => {
    const el = panel(`
      <div ${ROVING_VERTICAL_ATTR}="" id="list1">
        <button data-roving id="a">a</button>
        <button data-roving id="b">b</button>
      </div>
      <div ${ROVING_VERTICAL_ATTR}="" id="list2">
        <button data-roving id="c">c</button>
      </div>`)
    const b = el.querySelector('#b') as HTMLElement
    expect(handleRovingKey(el, key(b, 'ArrowDown'))).toBe(false)
    expect(document.activeElement).not.toBe(el.querySelector('#c'))
  })
})

// U12 (fixer wave): Chrome and Firefox animate arrow-key scrolling, so a single rAF after keydown checks
// visibility before the browser's own scroll has actually landed (it can miss the first overshoot, then
// snap back mid-animation). The follow now waits for the scroll to settle: the non-bubbling `scrollend`
// event (captured at document, since it does not bubble), or a 300ms fallback timeout for browsers
// without it, or presses that never scrolled at all.
describe('handleRovingKey: elsewhere, Up and Down still scroll, but the control is kept in view once the scroll settles', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves Up/Down unhandled (the item still scrolls) and does not nudge before the scroll settles', () => {
    const el = panel(`<button data-roving id="a">a</button>`)
    const a = el.querySelector('#a') as HTMLElement
    a.focus()
    const scrollIntoView = vi.fn()
    a.scrollIntoView = scrollIntoView
    expect(handleRovingKey(el, key(a, 'ArrowDown'))).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('nudges the control back into view once scrollend fires on the panel body', () => {
    const el = panel(`<button data-roving id="a">a</button>`)
    const a = el.querySelector('#a') as HTMLElement
    a.focus()
    const scrollIntoView = vi.fn()
    a.scrollIntoView = scrollIntoView
    handleRovingKey(el, key(a, 'ArrowDown'))
    el.dispatchEvent(new Event('scrollend'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    // Registered `once`: a second scrollend does nothing more.
    el.dispatchEvent(new Event('scrollend'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('falls back to a 300ms timeout when no scrollend ever fires', () => {
    vi.useFakeTimers()
    const el = panel(`<button data-roving id="a">a</button>`)
    const a = el.querySelector('#a') as HTMLElement
    a.focus()
    const scrollIntoView = vi.fn()
    a.scrollIntoView = scrollIntoView
    handleRovingKey(el, key(a, 'ArrowDown'))
    vi.advanceTimersByTime(299)
    expect(scrollIntoView).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('does nothing when focus moved elsewhere before scrollend', () => {
    const el = panel(`<button data-roving id="a">a</button><button data-roving id="b">b</button>`)
    const a = el.querySelector('#a') as HTMLElement
    const b = el.querySelector('#b') as HTMLElement
    a.focus()
    const scrollIntoView = vi.fn()
    a.scrollIntoView = scrollIntoView
    handleRovingKey(el, key(a, 'ArrowDown'))
    b.focus()
    el.dispatchEvent(new Event('scrollend'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('never fires for a key it already handled (Left/Right)', () => {
    const el = panel(`<button data-roving id="a">a</button><button data-roving id="b">b</button>`)
    const a = el.querySelector('#a') as HTMLElement
    a.focus()
    const scrollIntoView = vi.fn()
    a.scrollIntoView = scrollIntoView
    expect(handleRovingKey(el, key(a, 'ArrowRight'))).toBe(true)
    el.dispatchEvent(new Event('scrollend'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
