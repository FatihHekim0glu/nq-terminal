// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { canScrollHorizontally, deepQuery, scrollStep } from './scroll'

describe('pivot grid keyboard scrolling (WCAG 2.1.1)', () => {
  it('maps arrows, pages, Home and End to scrolls; a page keeps one row of overlap', () => {
    expect(scrollStep('ArrowDown', 400, false)).toEqual({ left: 0, top: 20 })
    expect(scrollStep('ArrowUp', 400, false)).toEqual({ left: 0, top: -20 })
    expect(scrollStep('ArrowRight', 400, false)).toEqual({ left: 80, top: 0 })
    expect(scrollStep('PageDown', 400, false)).toEqual({ left: 0, top: 380 })
    expect(scrollStep('PageUp', 400, false)).toEqual({ left: 0, top: -380 })
    expect(scrollStep('Home', 400, false)?.to).toBe('start')
    expect(scrollStep('End', 400, false)?.to).toBe('end')
  })

  it('leaves Tab, letters and modified keys alone, so Tab still leaves the panel', () => {
    expect(scrollStep('Tab', 400, false)).toBeNull()
    expect(scrollStep('a', 400, false)).toBeNull()
    expect(scrollStep('ArrowDown', 400, true)).toBeNull()
  })

  it('never steps less than one row, even in a tiny viewport', () => {
    expect(scrollStep('PageDown', 5, false)).toEqual({ left: 0, top: 20 })
  })

  it('finds an element inside an open shadow root', () => {
    const host = document.createElement('div')
    const inner = document.createElement('section')
    const shadow = inner.attachShadow({ mode: 'open' })
    const table = document.createElement('regular-table')
    shadow.append(table)
    host.append(inner)
    expect(deepQuery(host, 'regular-table')).toBe(table)
    expect(deepQuery(host, 'nothing-here')).toBeNull()
  })

  // D36: the host must give ArrowLeft and ArrowRight back once the table cannot scroll that way any
  // further, so the Show as [Table | Pivot grid] toggle stays reachable by keyboard.
  it('only lets ArrowLeft and ArrowRight scroll while there is room that way (D36)', () => {
    expect(canScrollHorizontally('ArrowLeft', { scrollLeft: 0, clientWidth: 100, scrollWidth: 1000 })).toBe(false)
    expect(canScrollHorizontally('ArrowLeft', { scrollLeft: 400, clientWidth: 100, scrollWidth: 1000 })).toBe(true)
    expect(canScrollHorizontally('ArrowRight', { scrollLeft: 400, clientWidth: 100, scrollWidth: 1000 })).toBe(true)
    expect(canScrollHorizontally('ArrowRight', { scrollLeft: 900, clientWidth: 100, scrollWidth: 1000 })).toBe(false)
    // Every other key (vertical, paging, ends) is not gated by horizontal position.
    expect(canScrollHorizontally('ArrowDown', { scrollLeft: 0, clientWidth: 100, scrollWidth: 1000 })).toBe(true)
    expect(canScrollHorizontally('Home', { scrollLeft: 0, clientWidth: 100, scrollWidth: 1000 })).toBe(true)
  })

  // D36: browser zoom or Windows display scaling (125%/150% on the PRD platform) can leave scrollLeft a
  // fraction of a pixel short of the exact edge value, so a strict comparison never releases the key
  // and ArrowRight (or Left) stays trapped consuming the key at what is, visually, the scrolled end.
  it('tolerates a fractional scrollLeft near the edge, so display scaling cannot trap the key', () => {
    expect(canScrollHorizontally('ArrowRight', { scrollLeft: 899.5, clientWidth: 100, scrollWidth: 1000 })).toBe(false)
    expect(canScrollHorizontally('ArrowLeft', { scrollLeft: 0.5, clientWidth: 100, scrollWidth: 1000 })).toBe(false)
  })
})
