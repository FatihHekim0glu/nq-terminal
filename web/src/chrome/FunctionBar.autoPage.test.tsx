// @vitest-environment jsdom
// U27: `Page n/m` on every scrolling panel, not only the screens that compute and pass it themselves.
// FunctionBar reads the panel's own page when no `page` prop is given, so a screen that never called
// usePanelPage still gets the indicator; a screen that already computed one (even a real, multi-page
// one) keeps showing exactly that.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FunctionBar from './FunctionBar'
import PanelChrome from './PanelChrome'

afterEach(cleanup)

function setMetrics(el: HTMLElement, { scrollTop = 0, clientHeight = 0, scrollHeight = 0 } = {}): void {
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
}

describe('FunctionBar: shows Page n/m for a panel that never computed one itself (U27)', () => {
  it('reads the panel body directly when no page prop is passed', () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[]} />
        <p>rows</p>
      </PanelChrome>,
    )
    const body = screen.getByRole('group', { name: 'REG content' })
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 1000 })
      body.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByText('Page 1/3')).toBeTruthy()
  })

  it('shows nothing when the body fits on one page', () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[]} />
        <p>rows</p>
      </PanelChrome>,
    )
    const body = screen.getByRole('group', { name: 'REG content' })
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 400 })
      body.dispatchEvent(new Event('scroll'))
    })
    expect(screen.queryByText(/Page/)).toBeNull()
  })

  it('shows Page n/m when the body grows after mount, with no scroll event (REG: loading, then rows)', async () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[]} />
        <p>rows</p>
      </PanelChrome>,
    )
    const body = screen.getByRole('group', { name: 'REG content' })
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 400 })
    })
    expect(screen.queryByText(/Page/)).toBeNull()
    // Content arrives after mount (rows load in): a DOM mutation, not a scroll or a resize.
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
      body.appendChild(document.createElement('div'))
    })
    await waitFor(() => expect(screen.getByText('Page 1/3')).toBeTruthy())
  })

  it('hides Page n/m again when the body shrinks back (a filter) and the child is removed', async () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[]} />
        <p>rows</p>
      </PanelChrome>,
    )
    const body = screen.getByRole('group', { name: 'REG content' })
    const child = document.createElement('div')
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
      body.appendChild(child)
    })
    await waitFor(() => expect(screen.getByText('Page 1/3')).toBeTruthy())
    act(() => {
      setMetrics(body, { scrollTop: 0, clientHeight: 400, scrollHeight: 400 })
      body.removeChild(child)
    })
    await waitFor(() => expect(screen.queryByText(/Page/)).toBeNull())
  })

  it('keeps showing exactly the page a screen already computed and passed in', () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[]} page={{ n: 2, m: 5 }} />
        <p>rows</p>
      </PanelChrome>,
    )
    expect(screen.getByText('Page 2/5')).toBeTruthy()
  })
})
