// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRAME_STRIP } from '../copy/chrome'
import { FrameStrip, type FrameStripProps } from './FrameStrip'

afterEach(cleanup)

function setup(props: Partial<FrameStripProps> = {}) {
  const onOpen = vi.fn()
  const onNew = vi.fn()
  const onTape = vi.fn()
  const onScheme = vi.fn()
  render(<FrameStrip screen="HOME" tapeOn={false} scheme="standard" onOpen={onOpen} onNew={onNew} onTape={onTape} onScheme={onScheme} {...props} />)
  return { onOpen, onNew, onTape, onScheme, nav: screen.getByRole('navigation', { name: FRAME_STRIP.label }) }
}

describe('FrameStrip: the 37px frame and layout tab strip (spec 4.2)', () => {
  it('shows one tab per layout, HOME RESEARCH LIVE, then +', () => {
    const { nav } = setup({ screen: 'REG' })
    const tabs = within(nav).getAllByRole('button')
    expect(tabs.map((t) => t.getAttribute('data-tab'))).toEqual(['HOME', 'RESEARCH', 'LIVE', 'new'])
  })

  it('the active tab carries a bold mnemonic then its title, and aria-current', () => {
    const { nav } = setup()
    const home = within(nav).getAllByRole('button')[0]!
    expect(home.getAttribute('aria-current')).toBe('page')
    expect(home.querySelector('b')?.textContent).toBe('HOME')
    expect(home.textContent).toBe('HOME Home view')
    expect(within(nav).getAllByRole('button')[1]?.textContent).toBe('RESEARCH')
  })

  it('adds an active tab for a screen that is not one of the layouts', () => {
    const { nav } = setup({ screen: 'GP' })
    const active = within(nav).getAllByRole('button').filter((t) => t.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(1)
    expect(active[0]?.querySelector('b')?.textContent).toBe('GP')
  })

  it('opens a layout on click and focuses the command line on +', () => {
    const { nav, onOpen, onNew } = setup()
    fireEvent.click(within(nav).getByRole('button', { name: /RESEARCH/ }))
    expect(onOpen).toHaveBeenCalledWith('REG')
    fireEvent.click(within(nav).getByRole('button', { name: FRAME_STRIP.newTab }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('always shows READ ONLY and NO ORDER PATH in the Safety group', () => {
    setup()
    const safety = screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })
    expect(within(safety).getByText('READ ONLY')).toBeTruthy()
    expect(within(safety).getByText('NO ORDER PATH')).toBeTruthy()
  })

  it('shows DEMO DATA in the Safety group only when the demo marked the page (src/demo/boot.tsx)', () => {
    setup()
    const safety = screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })
    expect(within(safety).queryByText(FRAME_STRIP.demoData)).toBeNull()
    expect(within(safety).getAllByText(/./).map((f) => f.textContent)).toEqual(['READ ONLY', 'NO ORDER PATH'])
    cleanup()
    document.documentElement.dataset.demo = 'on'
    try {
      setup()
      const demo = screen.getByRole('group', { name: FRAME_STRIP.safetyLabel })
      expect(within(demo).getAllByText(/./).map((f) => f.textContent)).toEqual(['READ ONLY', 'NO ORDER PATH', 'DEMO DATA'])
    } finally {
      delete document.documentElement.dataset.demo
    }
  })

  it('Options opens the tape switch and the colour schemes', () => {
    const { onTape, onScheme } = setup()
    const options = screen.getByRole('button', { name: FRAME_STRIP.options })
    expect(options.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(options)
    expect(options.getAttribute('aria-expanded')).toBe('true')
    const tape = screen.getByRole('button', { name: FRAME_STRIP.tape })
    expect(tape.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(tape)
    expect(onTape).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: FRAME_STRIP.schemes.deut }))
    expect(onScheme).toHaveBeenCalledWith('deut')
    expect(screen.getByRole('button', { name: FRAME_STRIP.schemes.standard }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Esc closes the options and returns focus to the button', () => {
    setup()
    const options = screen.getByRole('button', { name: FRAME_STRIP.options })
    fireEvent.click(options)
    const tape = screen.getByRole('button', { name: FRAME_STRIP.tape })
    tape.focus()
    fireEvent.keyDown(tape, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: FRAME_STRIP.tape })).toBeNull()
    expect(document.activeElement).toBe(options)
  })
})
