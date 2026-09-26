// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTEXT_STRIP } from '../copy/chrome'
import { ContextStrip } from './ContextStrip'

afterEach(cleanup)

describe('ContextStrip (UI_SPEC section 8: one chip per link group)', () => {
  it('shows [A] [B] [C] with each group context, and - for an empty group', () => {
    render(<ContextStrip contexts={{ A: { kind: 'instrument', value: 'NQ' }, B: { kind: 'hypothesis', value: 'volmanaged_v0' }, C: null }} />)
    const strip = screen.getByRole('group', { name: CONTEXT_STRIP.label })
    const chips = within(strip).getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual(['[A]NQ', '[B]volmanaged_v0', '[C]-'])
  })

  it('marks the focused panel group for sight and for screen readers', () => {
    render(<ContextStrip contexts={{ A: { kind: 'instrument', value: 'NQ' }, B: null, C: null }} focusedGroup="B" />)
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
