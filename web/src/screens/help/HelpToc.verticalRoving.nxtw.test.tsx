// @vitest-environment jsdom
// U12 (fixer wave gap): the vertical-list opt-in was applied to chrome/HelpScreen.tsx, imported only by
// its own tests; the live HELP screen is screens/help/HelpScreen.tsx (WorkspaceScreens.tsx: HELP is
// lazy(() => import('../screens/help/HelpScreen'))), whose rail is screens/help/HelpToc.tsx. That rail
// never opted in, so Up/Down there still fell to the browser's own scroll (3 to 5 presses could carry
// the focused row under the header). A new file, not HelpToc's own suite (none exists yet) or
// HelpScreen.test.tsx, so the wave-2 merge stays clean.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROVING_VERTICAL_ATTR, handleRovingKey } from '../../chrome/WorkspaceFocus'
import { MNEMONICS } from '../../commands/registry'
import { HELP } from '../../copy/help'
import HelpToc, { type TocEntry } from './HelpToc'

afterEach(cleanup)

function key(target: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('HelpToc (the live HELP screen rail): the rail roves on Up and Down (U12)', () => {
  const mnemonics = MNEMONICS.slice(0, 2)
  const entries: readonly TocEntry[] = [{ id: 'mnemonics', label: HELP.mnemonicsHeading, count: mnemonics.length }]

  function renderToc() {
    return render(
      <HelpToc entries={entries} mnemonics={mnemonics} selected={{ kind: 'section', id: 'mnemonics' }} onSection={vi.fn()} onItem={vi.fn()} />,
    )
  }

  it('marks the rail as a vertical roving list', () => {
    renderToc()
    const rail = screen.getByRole('navigation', { name: HELP.tocLabel })
    expect(rail.hasAttribute(ROVING_VERTICAL_ATTR)).toBe(true)
  })

  it('moves down from the Mnemonics heading into its nested items, and stays clamped at the top', () => {
    const { container } = renderToc()
    const rail = screen.getByRole('navigation', { name: HELP.tocLabel })
    const heading = screen.getByRole('button', { name: new RegExp(`^${HELP.mnemonicsHeading}`) })
    const items = Array.from(rail.querySelectorAll<HTMLElement>('.toc-item'))
    expect(items).toHaveLength(2)
    expect(handleRovingKey(container, key(heading, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(items[0])
    expect(handleRovingKey(container, key(items[0]!, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(items[1])
    // Clamped: Up on the first (and only) heading, with nothing above it, does nothing.
    expect(handleRovingKey(container, key(heading, 'ArrowUp'))).toBe(false)
  })
})
