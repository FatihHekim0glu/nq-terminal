// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { deepQuery, scrollStep } from './scroll'

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
})
