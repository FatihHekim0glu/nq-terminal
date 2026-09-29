// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRAME_STRIP } from '../copy/chrome'
import { LAYOUT } from '../copy/layout'
import { FrameStrip, type FrameStripProps } from './FrameStrip'

afterEach(cleanup)

function setup(props: Partial<FrameStripProps> = {}) {
  const onOpen = vi.fn()
  const onNew = vi.fn()
  const onTape = vi.fn()
  const onScheme = vi.fn()
  const onUndo = vi.fn()
  const onReset = vi.fn()
  const onOpenWorkspace = vi.fn()
  const onDemo = vi.fn()
  render(<FrameStrip screen="HOME" edited={false} tapeOn={false} scheme="standard" onOpen={onOpen} onNew={onNew} onTape={onTape} onScheme={onScheme} onUndo={onUndo} onReset={onReset} onOpenWorkspace={onOpenWorkspace} onDemo={onDemo} {...props} />)
  return { onOpen, onNew, onTape, onScheme, onUndo, onReset, onOpenWorkspace, onDemo, nav: screen.getByRole('navigation', { name: FRAME_STRIP.label }) }
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

describe('FrameStrip: the layout on screen and its edited mark (roadmap #6)', () => {
  it('marks the active tab edited with an aria-hidden * and a screen reader word', () => {
    const { nav } = setup({ edited: true })
    const home = within(nav).getAllByRole('button')[0]!
    const mark = home.querySelector('[aria-hidden="true"]')
    expect(mark?.textContent).toBe(LAYOUT.editedMark)
    const word = home.querySelector('.sr-only')
    expect(word?.textContent?.trim()).toBe(LAYOUT.editedLabel)
    expect(home.contains(word)).toBe(true)
    // The bold mnemonic is still the first thing on the tab, then the mark, then the title.
    expect(home.querySelector('b')?.textContent).toBe('HOME')
    expect(home.textContent).toBe(`HOME${LAYOUT.editedMark} Home view ${LAYOUT.editedLabel}`)
    // The accessible name skips the mark (aria-hidden) and speaks the word.
    expect(within(nav).getByRole('button', { name: `HOME Home view ${LAYOUT.editedLabel}` })).toBe(home)
  })

  it('shows no mark and no word on an unedited layout, and none on the tabs that are not active', () => {
    const { nav } = setup({ edited: false })
    expect(within(nav).queryByText(LAYOUT.editedMark)).toBeNull()
    expect(nav.querySelector('.sr-only')).toBeNull()
    expect(within(nav).getAllByRole('button')[0]?.textContent).toBe('HOME Home view')
    cleanup()
    const edited = setup({ edited: true })
    const marked = within(edited.nav).getAllByRole('button').filter((t) => t.textContent?.includes(LAYOUT.editedMark) && t.getAttribute('data-tab') !== 'new')
    expect(marked.map((t) => t.getAttribute('data-tab'))).toEqual(['HOME'])
  })

  it('follows the screen: RESEARCH is the active tab for REG, and carries the mark', () => {
    const { nav } = setup({ screen: 'REG', edited: true })
    const research = within(nav).getByRole('button', { name: /RESEARCH/ })
    expect(research.getAttribute('aria-current')).toBe('page')
    expect(research.querySelector('[aria-hidden="true"]')?.textContent).toBe(LAYOUT.editedMark)
    expect(within(nav).getAllByRole('button').map((t) => t.getAttribute('data-tab'))).toEqual(['HOME', 'RESEARCH', 'LIVE', 'new'])
  })

  it('keeps the extra tab for a screen that is not a layout tab, and marks it when edited', () => {
    const { nav } = setup({ screen: 'GP', edited: true })
    const tabs = within(nav).getAllByRole('button')
    expect(tabs.map((t) => t.getAttribute('data-tab'))).toEqual(['HOME', 'RESEARCH', 'LIVE', 'GP', 'new'])
    const extra = tabs[3]!
    expect(extra.getAttribute('aria-current')).toBe('page')
    expect(extra.querySelector('[aria-hidden="true"]')?.textContent).toBe(LAYOUT.editedMark)
    expect(extra.querySelector('.sr-only')?.textContent?.trim()).toBe(LAYOUT.editedLabel)
  })

  it('offers Undo layout change and Reset this layout in Options, each running its callback', () => {
    const { onUndo, onReset, onTape } = setup({ edited: true })
    fireEvent.click(screen.getByRole('button', { name: FRAME_STRIP.options }))
    fireEvent.click(screen.getByRole('button', { name: LAYOUT.undoOption }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onReset).not.toHaveBeenCalled()
    // A layout action hands focus to the command line, so the list closes behind it.
    expect(screen.queryByRole('button', { name: LAYOUT.undoOption })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: FRAME_STRIP.options }))
    fireEvent.click(screen.getByRole('button', { name: LAYOUT.resetOption }))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onTape).not.toHaveBeenCalled()
  })

  it('keeps Undo and Reset in Options on an unedited layout too (RESET says when there is nothing to reset)', () => {
    setup({ edited: false })
    fireEvent.click(screen.getByRole('button', { name: FRAME_STRIP.options }))
    expect(screen.getByRole('button', { name: LAYOUT.undoOption })).toBeTruthy()
    expect(screen.getByRole('button', { name: LAYOUT.resetOption })).toBeTruthy()
  })

  it('keeps the tape switch and the colour schemes beside the layout entries', () => {
    setup({ edited: true })
    fireEvent.click(screen.getByRole('button', { name: FRAME_STRIP.options }))
    expect(screen.getByRole('button', { name: FRAME_STRIP.tape })).toBeTruthy()
    expect(screen.getByRole('group', { name: FRAME_STRIP.schemesLabel })).toBeTruthy()
  })

  it('Esc still closes the list from a layout entry and returns focus to Options', () => {
    setup({ edited: true })
    const options = screen.getByRole('button', { name: FRAME_STRIP.options })
    fireEvent.click(options)
    const reset = screen.getByRole('button', { name: LAYOUT.resetOption })
    reset.focus()
    fireEvent.keyDown(reset, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: LAYOUT.resetOption })).toBeNull()
    expect(document.activeElement).toBe(options)
  })
})

describe('FrameStrip: workspace tabs (roadmap #14)', () => {
  const tabIds = (nav: HTMLElement) => within(nav).getAllByRole('button').map((t) => t.getAttribute('data-tab'))
  const workspaceNames = (nav: HTMLElement) =>
    Array.from(nav.querySelectorAll<HTMLElement>('[data-tab="workspace"]')).map((t) => t.getAttribute('data-workspace'))

  it('shows a tab per saved workspace after LIVE and before +, in the order given', () => {
    const { nav } = setup({ workspaces: ['ALPHA', 'BRAVO'], workspace: null })
    expect(tabIds(nav)).toEqual(['HOME', 'RESEARCH', 'LIVE', 'workspace', 'workspace', 'new'])
    expect(workspaceNames(nav)).toEqual(['ALPHA', 'BRAVO'])
    expect(within(nav).getByRole('button', { name: 'ALPHA' }).getAttribute('aria-current')).toBeNull()
    expect(within(nav).getAllByRole('button')[0]?.getAttribute('aria-current')).toBe('page')
  })

  it('an inactive workspace tab has its full name as its title, for when the strip shortens it; its accessible name stays the text', () => {
    const long = 'A_LONG_DESK_NAME_'.slice(0, 16)
    const { nav } = setup({ workspaces: [long, 'BRAVO'], workspace: 'BRAVO' })
    const tab = within(nav).getByRole('button', { name: long })
    expect(tab.getAttribute('title')).toBe(long)
    expect(tab.textContent).toBe(long)
  })

  it('the active workspace tab and the layout tabs carry no title of their own', () => {
    const { nav } = setup({ workspaces: ['ALPHA', 'BRAVO'], workspace: 'BRAVO' })
    for (const tab of within(nav).getAllByRole('button')) {
      if (tab.getAttribute('data-tab') === 'workspace' && tab.getAttribute('aria-current') !== 'page') continue
      expect(tab.hasAttribute('title'), tab.textContent ?? '').toBe(false)
    }
  })

  it('shows nothing extra without workspaces', () => {
    const { nav } = setup({ workspaces: [] })
    expect(tabIds(nav)).toEqual(['HOME', 'RESEARCH', 'LIVE', 'new'])
  })

  it('shows at most six workspace tabs: the first six', () => {
    const names = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH']
    const { nav } = setup({ workspaces: names })
    expect(workspaceNames(nav)).toEqual(['AA', 'BB', 'CC', 'DD', 'EE', 'FF'])
    expect(within(nav).queryByRole('button', { name: 'GG' })).toBeNull()
  })

  it('the workspace on screen is always shown: past the sixth it takes the last place', () => {
    const names = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH']
    const { nav } = setup({ workspaces: names, workspace: 'HH' })
    expect(workspaceNames(nav)).toEqual(['AA', 'BB', 'CC', 'DD', 'EE', 'HH'])
    expect(within(nav).getByRole('button', { name: /^HH/ }).getAttribute('aria-current')).toBe('page')
  })

  it('the active workspace tab carries a bold name then its title; no screen tab is active beside it', () => {
    const { nav } = setup({ screen: 'EQ', workspaces: ['ALPHA', 'BRAVO'], workspace: 'BRAVO' })
    const active = within(nav).getAllByRole('button').filter((t) => t.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(1)
    expect(active[0]?.getAttribute('data-workspace')).toBe('BRAVO')
    expect(active[0]?.querySelector('b')?.textContent).toBe('BRAVO')
    expect(active[0]?.textContent).toBe(`BRAVO ${FRAME_STRIP.workspaceTitle}`)
    // EQ is not a layout tab, but the workspace owns the layout: no extra EQ tab.
    expect(tabIds(nav)).toEqual(['HOME', 'RESEARCH', 'LIVE', 'workspace', 'workspace', 'new'])
    expect(within(nav).getByRole('button', { name: 'ALPHA' }).textContent).toBe('ALPHA')
  })

  it('the edited mark and its word sit on the active workspace tab only, never on HOME', () => {
    const { nav } = setup({ screen: 'HOME', edited: true, workspaces: ['ALPHA', 'BRAVO'], workspace: 'ALPHA' })
    const marked = within(nav).getAllByRole('button').filter((t) => t.textContent?.includes(LAYOUT.editedMark) && t.getAttribute('data-tab') !== 'new')
    expect(marked.map((t) => t.getAttribute('data-workspace'))).toEqual(['ALPHA'])
    const alpha = marked[0]!
    expect(alpha.querySelector('[aria-hidden="true"]')?.textContent).toBe(LAYOUT.editedMark)
    expect(alpha.querySelector('.sr-only')?.textContent?.trim()).toBe(LAYOUT.editedLabel)
    expect(within(nav).getByRole('button', { name: `ALPHA ${FRAME_STRIP.workspaceTitle} ${LAYOUT.editedLabel}` })).toBe(alpha)
    expect(within(nav).getAllByRole('button')[0]?.getAttribute('aria-current')).toBeNull()
  })

  it('an unedited workspace tab has no mark and no word', () => {
    const { nav } = setup({ edited: false, workspaces: ['ALPHA'], workspace: 'ALPHA' })
    expect(within(nav).queryByText(LAYOUT.editedMark)).toBeNull()
    expect(nav.querySelector('.sr-only')).toBeNull()
  })

  it('a workspace that is no longer saved (forgotten while on screen) leaves the screen tab active', () => {
    const { nav } = setup({ screen: 'REG', workspaces: ['BRAVO'], workspace: 'ALPHA' })
    expect(within(nav).getByRole('button', { name: /RESEARCH/ }).getAttribute('aria-current')).toBe('page')
    expect(workspaceNames(nav)).toEqual(['BRAVO'])
    expect(within(nav).queryByRole('button', { name: /ALPHA/ })).toBeNull()
  })

  it('clicking a workspace tab asks to open it by name, and opens no layout', () => {
    const { nav, onOpen, onOpenWorkspace } = setup({ workspaces: ['ALPHA', 'BRAVO'] })
    fireEvent.click(within(nav).getByRole('button', { name: 'BRAVO' }))
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1)
    expect(onOpenWorkspace).toHaveBeenCalledWith('BRAVO')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('the + tab and the layout tabs still work beside the workspace tabs', () => {
    const { nav, onOpen, onNew } = setup({ workspaces: ['ALPHA'] })
    fireEvent.click(within(nav).getByRole('button', { name: /RESEARCH/ }))
    expect(onOpen).toHaveBeenCalledWith('REG')
    fireEvent.click(within(nav).getByRole('button', { name: FRAME_STRIP.newTab }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })
})
