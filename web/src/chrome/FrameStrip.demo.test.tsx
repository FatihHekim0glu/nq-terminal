// @vitest-environment jsdom
// U01 (dogfood round): the red DEMO DATA flag was a plain span, with no title, no action and no HELP entry. In
// the demo it is now a key: it asks the frame (onDemo) to open the About this demo lines on the HELP page, and its
// tooltip says what the data is. What onDemo does is App's, like every other strip action (App.test.tsx). Outside
// the demo nothing changes: there is no flag at all.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_DATA, FRAME_STRIP } from '../copy/chrome'
import { FrameStrip } from './FrameStrip'

const onDemo = vi.fn()

function setup() {
  render(<FrameStrip screen="HOME" tapeOn={false} scheme="standard" onOpen={vi.fn()} onNew={vi.fn()} onTape={vi.fn()} onScheme={vi.fn()} onDemo={onDemo} />)
  return screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })
}

afterEach(() => {
  cleanup()
  onDemo.mockClear()
  delete document.documentElement.dataset.demo
})

describe('FrameStrip: the DEMO DATA flag outside the demo', () => {
  it('is not there, and nothing in the Safety group is a button', () => {
    const safety = setup()
    expect(safety.querySelector('[data-flag="demo"]')).toBeNull()
    expect(within(safety).queryAllByRole('button')).toEqual([])
  })
})

describe('FrameStrip: the DEMO DATA flag in the demo', () => {
  beforeEach(() => {
    document.documentElement.dataset.demo = 'on'
  })

  it('is one key in the Safety group, named by the one demo term', () => {
    const safety = setup()
    const flag = within(safety).getByRole('button', { name: DEMO_DATA.term })
    expect(flag.getAttribute('data-flag')).toBe('demo')
    expect(flag.getAttribute('type')).toBe('button')
    expect(flag.textContent).toBe(DEMO_DATA.term)
    expect(FRAME_STRIP.demoData).toBe(DEMO_DATA.term)
    expect(within(safety).getAllByRole('button')).toHaveLength(1)
  })

  it('has a tooltip that says what the data is and where the key leads', () => {
    const flag = within(setup()).getByRole('button', { name: DEMO_DATA.term })
    const title = flag.getAttribute('title') ?? ''
    expect(title).toContain(DEMO_DATA.note)
    expect(title).toContain(DEMO_DATA.flagHint)
    expect(DEMO_DATA.note).toMatch(/Nothing here is live/)
    expect(DEMO_DATA.flagHint).toMatch(/About this demo/)
  })

  it('a click calls onDemo', () => {
    const flag = within(setup()).getByRole('button', { name: DEMO_DATA.term })
    fireEvent.click(flag)
    expect(onDemo).toHaveBeenCalledTimes(1)
  })

  it('calls onDemo on every click, so the page opens again after the reader went back to the index', () => {
    const flag = within(setup()).getByRole('button', { name: DEMO_DATA.term })
    fireEvent.click(flag)
    fireEvent.click(flag)
    expect(onDemo).toHaveBeenCalledTimes(2)
  })

  it('does not call onDemo for anything else in the strip', () => {
    const safety = setup()
    fireEvent.click(within(screen.getByRole('navigation', { name: FRAME_STRIP.label })).getByRole('button', { name: /HOME/ }))
    expect(within(safety).getAllByRole('button')).toHaveLength(1)
    expect(onDemo).not.toHaveBeenCalled()
  })

  it('needs no inline style: the look of a span comes from FrameStrip.css', () => {
    const flag = within(setup()).getByRole('button', { name: DEMO_DATA.term })
    expect(flag.getAttribute('style')).toBeNull()
    expect(flag.className).toBe('frame-flag')
  })

  it('keeps READ ONLY and NO ORDER PATH as plain chips before it', () => {
    const safety = setup()
    const chips = Array.from(safety.children).map((c) => [c.tagName, c.textContent])
    expect(chips).toEqual([['SPAN', 'READ ONLY'], ['SPAN', 'NO ORDER PATH'], ['BUTTON', 'DEMO DATA']])
  })
})
