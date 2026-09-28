// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAV_TOOLBAR } from '../copy/chrome'
import { NavToolbar, type NavToolbarProps } from './NavToolbar'

afterEach(cleanup)

function setup(props: Partial<NavToolbarProps> = {}) {
  const onAction = vi.fn()
  render(
    <NavToolbar
      focused={{ code: 'GP', group: 'A', context: { kind: 'instrument', value: 'NQ' } }}
      kill="off"
      onAction={onAction}
      {...props}
    />,
  )
  return { onAction, bar: screen.getByRole('group', { name: NAV_TOOLBAR.label }) }
}

describe('NavToolbar: the 22px nav toolbar for the focused panel (spec 4.2)', () => {
  it('shows back and forward, the linked context, the mnemonic and Related Functions Menu', () => {
    const { bar } = setup()
    expect(within(bar).getByRole('button', { name: NAV_TOOLBAR.back })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: NAV_TOOLBAR.forward })).toBeTruthy()
    const context = within(bar).getByRole('button', { name: /NQ1 Index/ })
    expect(context.querySelector('.ctx-chip')?.textContent).toBe('A')
    expect(within(bar).getByRole('button', { name: /^GP/ })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: NAV_TOOLBAR.related })).toBeTruthy()
  })

  // openIssue (U10/U11): back already names its key ('Back, End'); forward read plain 'Forward' with
  // no key at all, though Shift+End reaches it (KeyToolbar.actions.ts, CommandLine.keys.ts).
  it('names the forward control\'s key (Shift+End), the same as back names End', () => {
    const { bar } = setup()
    const forward = within(bar).getByRole('button', { name: /Shift\+End/ })
    expect(forward.getAttribute('aria-label')).toBe(NAV_TOOLBAR.forward)
  })

  it('shows the kill switch and TWS state beside the message glyph', () => {
    const { bar } = setup({ kill: 'on' })
    expect(within(bar).getByText('KILL ON')).toBeTruthy()
    expect(within(bar).getByText('TWS not monitored')).toBeTruthy()
  })

  it('labels the envelope with a visible Message word (spec 4.2)', () => {
    const { bar } = setup()
    const word = within(bar).getByText(NAV_TOOLBAR.message)
    expect(word.className).toContain('nav-msg-label')
    expect(word.className).not.toContain('sr-only')
  })

  it('reports each control', () => {
    const { bar, onAction } = setup()
    for (const name of [NAV_TOOLBAR.back, NAV_TOOLBAR.forward, NAV_TOOLBAR.related, NAV_TOOLBAR.favourites, NAV_TOOLBAR.exportCsv, NAV_TOOLBAR.help]) {
      fireEvent.click(within(bar).getByRole('button', { name }))
    }
    fireEvent.click(within(bar).getByRole('button', { name: /NQ1 Index/ }))
    fireEvent.click(within(bar).getByRole('button', { name: /^GP/ }))
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['back', 'forward', 'related', 'favourites', 'export', 'help', 'context', 'mnemonic'])
  })

  it('with no focused panel shows no chip and a dash for the context', () => {
    const { bar } = setup({ focused: null })
    expect(bar.querySelector('.ctx-chip')).toBeNull()
    expect(within(bar).getByRole('button', { name: NAV_TOOLBAR.noContext })).toBeTruthy()
  })
})
