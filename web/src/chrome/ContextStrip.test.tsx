// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTEXT_STRIP } from '../copy/chrome'
import { ContextStrip } from './ContextStrip'

afterEach(cleanup)

const CONTEXTS = { A: { kind: 'instrument', value: 'NQ' }, B: { kind: 'hypothesis', value: 'rebal_v0' }, C: null } as const

describe('ContextStrip: the command zone right side (spec 4.2 and 4.11)', () => {
  it('reads "1 [A] NQ1 Index [B] rebal_v0 [C] -": the focused panel number, then one chip per group', () => {
    render(<ContextStrip contexts={CONTEXTS} panelNumber={1} />)
    const strip = screen.getByRole('group', { name: CONTEXT_STRIP.label })
    expect(within(strip).getByText('1').className).toMatch(/\bctx-panel\b/)
    const chips = within(strip).getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual(['ANQ1 Index', 'Brebal_v0', 'C-'])
  })

  it('draws each group as a 14px square chip with a black letter, the letter always present', () => {
    render(<ContextStrip contexts={CONTEXTS} />)
    const letters = Array.from(document.querySelectorAll('.ctx-chip'))
    expect(letters.map((l) => [l.textContent, l.getAttribute('data-link')])).toEqual([['A', 'A'], ['B', 'B'], ['C', 'C']])
  })

  it('names the focused panel number for screen readers, and shows no digit when no panel has focus', () => {
    render(<ContextStrip contexts={CONTEXTS} panelNumber={3} />)
    expect(screen.getByText(CONTEXT_STRIP.panelNumber.replace('{value}', '3'))).toBeTruthy()
    cleanup()
    render(<ContextStrip contexts={CONTEXTS} panelNumber={null} />)
    expect(document.querySelector('.ctx-panel')).toBeNull()
  })

  it('marks the focused panel group for sight and for screen readers', () => {
    render(<ContextStrip contexts={CONTEXTS} focusedGroup="B" />)
    const chips = screen.getAllByRole('listitem')
    expect(chips[1]?.getAttribute('aria-current')).toBe('true')
    expect(chips[1]?.className).toMatch(/\bfocused\b/)
    expect(chips[0]?.getAttribute('aria-current')).toBeNull()
    expect(within(chips[1]!).getByText(CONTEXT_STRIP.focused).className).toBe('sr-only')
  })

  it('shows a long context in full for assistive technology even when clipped on screen', () => {
    const long = 'nt_volmanaged_v0_regress_2026_09_26_anchor'
    render(<ContextStrip contexts={{ A: { kind: 'run', value: long }, B: null, C: null }} />)
    expect(screen.getByText(long).getAttribute('title')).toBe(long)
  })
})
