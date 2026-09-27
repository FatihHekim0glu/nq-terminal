// @vitest-environment jsdom
// switchKeepingFocus: focus lost with an unmounted control lands on the kept control; focus elsewhere stays.
import { act, cleanup, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { switchKeepingFocus } from './keepFocus'

let flip: (() => void) | null = null

function Views() {
  const root = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'a' | 'b'>('a')
  flip = () => switchKeepingFocus(root.current, '[aria-pressed="true"]', () => setView('b'))
  return (
    <div ref={root}>
      <button type="button" aria-pressed={view === 'b'}>b view</button>
      {view === 'a' ? <button type="button" onClick={() => flip?.()}>open b</button> : <p>b</p>}
    </div>
  )
}

afterEach(cleanup)

describe('switchKeepingFocus', () => {
  it('moves focus to the kept control when the focused one unmounts', () => {
    const { getByText } = render(<Views />)
    const open = getByText('open b')
    open.focus()
    act(() => open.click())
    expect(document.activeElement?.textContent).toBe('b view')
  })

  it('finds the kept control in the panel when it renders into a panel slot outside the root', () => {
    function Slotted() {
      const root = useRef<HTMLDivElement>(null)
      const [view, setView] = useState<'a' | 'b'>('a')
      flip = () => switchKeepingFocus(root.current, '[role="tab"][aria-selected="true"]', () => setView('b'))
      return (
        <section data-nqt-panel="p1">
          <div role="tablist" aria-label="Views">
            <button type="button" role="tab" aria-selected={view === 'a'}>a view</button>
            <button type="button" role="tab" aria-selected={view === 'b'}>b view</button>
          </div>
          <div ref={root}>
            {view === 'a' ? <button type="button" onClick={() => flip?.()}>open b</button> : <p>b</p>}
          </div>
        </section>
      )
    }
    const { getByText } = render(<Slotted />)
    const open = getByText('open b')
    open.focus()
    act(() => open.click())
    expect(document.activeElement?.textContent).toBe('b view')
  })

  it('leaves focus outside the root where it was (Number <GO> from the command line)', () => {
    const { getByText } = render(<><input aria-label="command" /><Views /></>)
    const line = document.querySelector('input')!
    line.focus()
    act(() => flip?.())
    expect(getByText('b')).toBeTruthy()
    expect(document.activeElement).toBe(line)
  })
})
