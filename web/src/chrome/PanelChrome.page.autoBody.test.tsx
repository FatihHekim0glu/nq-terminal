// @vitest-environment jsdom
// U27: usePanelPage must resolve a panel's `.nqt-panel-body` from a ref anywhere inside the panel
// section (`[data-nqt-panel]`), not only from a ref that is itself a descendant of the body -- so
// FunctionBar, which portals into the bar slot (a sibling of the body), can read the page itself.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePanelPage } from './PanelChrome.page'

afterEach(cleanup)

function setMetrics(el: HTMLElement, { scrollTop = 0, clientHeight = 0, scrollHeight = 0 } = {}): void {
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
}

describe('usePanelPage: finds the panel body from any ref inside the panel section', () => {
  it('resolves the body from a ref in a sibling slot (the bar slot, not a descendant of the body)', () => {
    const section = document.createElement('section')
    section.setAttribute('data-nqt-panel', 'p1')
    const bar = document.createElement('div')
    bar.className = 'pslot pslot-bar'
    const inBar = document.createElement('div')
    bar.append(inBar)
    const body = document.createElement('div')
    body.className = 'nqt-panel-body'
    section.append(bar, body)
    document.body.append(section)
    setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 1000 })

    const ref = { current: inBar }
    const { result } = renderHook(() => usePanelPage(ref))
    expect(result.current).toEqual({ n: 1, m: 3 })
    section.remove()
  })

  it('still resolves the body from a ref that is itself inside the body (existing screens)', () => {
    const section = document.createElement('section')
    section.setAttribute('data-nqt-panel', 'p1')
    const body = document.createElement('div')
    body.className = 'nqt-panel-body'
    const content = document.createElement('div')
    body.append(content)
    section.append(body)
    document.body.append(section)
    setMetrics(body, { scrollTop: 400, clientHeight: 400, scrollHeight: 1000 })

    const ref = { current: content }
    const { result } = renderHook(() => usePanelPage(ref))
    expect(result.current).toEqual({ n: 2, m: 3 })
    section.remove()
  })

  it('is null with no panel section to find a body in', () => {
    const orphan = document.createElement('div')
    document.body.append(orphan)
    const ref = { current: orphan }
    const { result } = renderHook(() => usePanelPage(ref))
    expect(result.current).toBeNull()
    orphan.remove()
  })

  it('updates on scroll', () => {
    const section = document.createElement('section')
    section.setAttribute('data-nqt-panel', 'p1')
    const bar = document.createElement('div')
    bar.className = 'pslot pslot-bar'
    const inBar = document.createElement('div')
    bar.append(inBar)
    const body = document.createElement('div')
    body.className = 'nqt-panel-body'
    section.append(bar, body)
    document.body.append(section)
    setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 1000 })

    const ref = { current: inBar }
    const { result } = renderHook(() => usePanelPage(ref))
    expect(result.current).toEqual({ n: 1, m: 3 })
    act(() => {
      setMetrics(body, { scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })
      body.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toEqual({ n: 3, m: 3 })
    section.remove()
  })
})
