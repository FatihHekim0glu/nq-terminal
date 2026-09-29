// @vitest-environment jsdom
// U12: HELP's contents rail (group headings plus the nested mnemonic items under Mnemonics) is a
// vertical list, read top to bottom; Up/Down should rove through it like Left/Right already rove a
// panel's other items, instead of being left to the browser's own scroll (3 to 5 presses used to carry
// the focused row under the header). A new file, not HelpScreen.test.tsx, so the wave-2 merge stays
// clean.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MNEMONICS } from '../commands/registry'
import { HELP } from '../copy/help'
import HelpScreen from './HelpScreen'
import { ROVING_VERTICAL_ATTR, handleRovingKey } from './WorkspaceFocus'

afterEach(cleanup)

function key(target: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('HelpScreen: the contents rail roves on Up and Down (U12)', () => {
  it('marks the rail as a vertical roving list', () => {
    render(<HelpScreen built={new Set(['HELP'])} mnemonics={MNEMONICS.slice(0, 2)} />)
    const rail = screen.getByRole('navigation', { name: HELP.tocLabel })
    expect(rail.closest(`[${ROVING_VERTICAL_ATTR}]`)).not.toBeNull()
  })

  it('moves down from a group heading into its nested mnemonic items and on to the next heading', () => {
    const { container } = render(<HelpScreen built={new Set(['HELP'])} mnemonics={MNEMONICS.slice(0, 2)} />)
    const rail = screen.getByRole('navigation', { name: HELP.tocLabel })
    const mnemonicsHeading = within(rail).getByRole('button', { name: new RegExp(`^${HELP.mnemonicsHeading}`) })
    const [first, second] = Array.from(rail.querySelectorAll<HTMLElement>('.toc-item'))
    const keysHeading = within(rail).getByRole('button', { name: new RegExp(`^${HELP.keysHeading}`) })

    expect(handleRovingKey(container, key(mnemonicsHeading, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(handleRovingKey(container, key(first as HTMLElement, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(second)
    expect(handleRovingKey(container, key(second as HTMLElement, 'ArrowDown'))).toBe(true)
    expect(document.activeElement).toBe(keysHeading)
  })

  it('moves up from a group heading back into the previous mnemonic item', () => {
    const { container } = render(<HelpScreen built={new Set(['HELP'])} mnemonics={MNEMONICS.slice(0, 2)} />)
    const rail = screen.getByRole('navigation', { name: HELP.tocLabel })
    const keysHeading = within(rail).getByRole('button', { name: new RegExp(`^${HELP.keysHeading}`) })
    const items = Array.from(rail.querySelectorAll<HTMLElement>('.toc-item'))
    const last = items.at(-1) as HTMLElement
    expect(handleRovingKey(container, key(keysHeading, 'ArrowUp'))).toBe(true)
    expect(document.activeElement).toBe(last)
  })
})
