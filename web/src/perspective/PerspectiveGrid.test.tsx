// @vitest-environment jsdom
// D36: the pivot grid host must give ArrowLeft and ArrowRight back once the table cannot scroll that
// way any further, or the Show as [Table | Pivot grid] toggle (the accessible alternative) is
// unreachable by keyboard once the host holds the panel's one Tab stop.
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePanelRoving } from '../chrome/WorkspaceFocus'
import type { PivotPreset } from './datasets'
import type { PspColumnar, PspSchema } from './schema'

// The engine never starts: these tests only exercise the host's own key handling, which does not
// depend on the viewer being ready.
vi.mock('./engine', () => ({ loadPerspective: () => new Promise(() => undefined) }))

const { default: PerspectiveGrid } = await import('./PerspectiveGrid')

/** A panel using the real roving-focus hook, so D36 can be tested end to end. */
function Panel({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = usePanelRoving(ref)
  return (
    <div ref={ref} onKeyDown={onKeyDown}>
      <button data-roving="">Table</button>
      {children}
    </div>
  )
}

const SCHEMA: PspSchema = { price: 'float' }
const DATA: PspColumnar = { price: [1, 2] }
const PRESET: PivotPreset = { columns: ['price'] }

afterEach(cleanup)

function stubTable(el: HTMLElement, o: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }) {
  Object.defineProperty(el, 'scrollLeft', { value: o.scrollLeft, configurable: true, writable: true })
  Object.defineProperty(el, 'clientWidth', { value: o.clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollWidth', { value: o.scrollWidth, configurable: true })
  // jsdom has no layout: applyScroll's scrollBy is not implemented there.
  Object.defineProperty(el, 'scrollBy', { value: vi.fn(), configurable: true })
}

/** Plants a `regular-table` stand-in inside the host, the way the viewer's shadow tree would
 *  (deepQuery finds it by tag name), and focuses the host. */
function plantTable(scroll: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }) {
  const host = document.querySelector<HTMLElement>('.nqt-psp-host')!
  const table = document.createElement('regular-table')
  stubTable(table, scroll)
  host.append(table)
  host.focus()
  return host
}

/** Bare: no roving panel around it, so the raw `fireEvent.keyDown` return shows whether the host
 *  itself prevented the key's default. */
function renderBare(scroll: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }) {
  render(<PerspectiveGrid name="Fills of r" schema={SCHEMA} data={DATA} rows={2} preset={PRESET} />)
  return plantTable(scroll)
}

/** In a real roving panel, so a release can be followed all the way to a focus move. */
function renderInPanel(scroll: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }) {
  render(
    <Panel>
      <PerspectiveGrid name="Fills of r" schema={SCHEMA} data={DATA} rows={2} preset={PRESET} />
    </Panel>,
  )
  return plantTable(scroll)
}

describe('PerspectiveGrid keyboard (D36)', () => {
  it('does not consume Left when the table is already scrolled to the start', () => {
    const host = renderBare({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowLeft' })).toBe(true)
  })

  it('consumes Left once the table has scrolled right', () => {
    const host = renderBare({ scrollLeft: 50, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowLeft' })).toBe(false)
  })

  it('does not consume Right at the end of the horizontal scroll', () => {
    const host = renderBare({ scrollLeft: 600, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowRight' })).toBe(true)
  })

  it('consumes Right while more of the table is scrollable', () => {
    const host = renderBare({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowRight' })).toBe(false)
  })

  it('still scrolls (and consumes) vertical keys regardless of horizontal position', () => {
    const host = renderBare({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowDown' })).toBe(false)
  })

  it('gives Left back to a real roving panel at scrollLeft 0, so focus reaches the Show as toggle', () => {
    const host = renderInPanel({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })
    fireEvent.keyDown(host, { key: 'ArrowLeft' })
    expect(document.activeElement?.textContent).toBe('Table')
  })

  // Holding the key at the edge (auto-repeat) must not keep giving it back to the panel on every
  // repeat, or focus walks on through the panel's other controls while the key is still held. Only a
  // fresh press releases the key.
  it('gives Left back to the panel only on a fresh press, not on every auto-repeat at scrollLeft 0', () => {
    const host = renderInPanel({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })
    expect(fireEvent.keyDown(host, { key: 'ArrowLeft', repeat: true })).toBe(false)
    expect(document.activeElement).toBe(host)
    fireEvent.keyDown(host, { key: 'ArrowLeft' })
    expect(document.activeElement?.textContent).toBe('Table')
  })
})
