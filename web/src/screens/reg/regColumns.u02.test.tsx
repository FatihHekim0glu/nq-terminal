// @vitest-environment jsdom
// U02 (polish 3) on REG: which family the adjusted p columns are adjusted over, and that PASS/FAIL is each
// hypothesis's own pre-registered bar. The column headers stay short ('Bonf', 'Holm', 'BH q': RegScreen.test.tsx
// finds the full and the narrow board by them); the family is in the narrow board's note, the verdict cells carry
// the rule as their title, and REG.familyNote / REG.verdictNote are the two lines the full board's RuleNote shows (RegScreen.u02.test.tsx).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import { REG } from '../../copy/reg'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import { buildRegRows } from './regModel'
import { REG_COLUMNS, REG_COMPACT_COLUMNS } from './regColumns'

afterEach(() => cleanup())

describe('the verdict rule and the family line (U02)', () => {
  it('says what the brief says', () => {
    expect(REG.verdictNote).toBe("PASS/FAIL is each hypothesis's own pre-registered bar; family-adjusted p is context and does not change it.")
    expect(REG.familyNote).toBe('Bonf, Holm and BH q are adjusted over the registry family (its size k is on MT).')
  })

  it('names the three adjusted columns as the headers of the board draw them', () => {
    const headers = REG_COLUMNS.map((c) => c.header)
    for (const word of ['Bonf', 'Holm', 'BH q']) expect(headers).toContain(word)
    expect(REG.familyNote).toContain('Bonf, Holm and BH q')
  })

  it('is on the narrow board too: the compact note carries both lines, since its headers cannot', () => {
    expect(REG.compactNote).toContain(REG.familyNote)
    expect(REG.compactNote).toContain(REG.verdictNote)
    expect(REG.compactNote.startsWith('Columns hidden here')).toBe(true)
  })

  it('follows the copy rules', () => {
    expect(findCopyViolations({ familyNote: REG.familyNote, verdictNote: REG.verdictNote, compactNote: REG.compactNote })).toEqual([])
  })
})

describe('REG verdict cells (U02)', () => {
  const verdict = REG_COLUMNS.find((c) => c.id === 'verdict')

  it('carry the rule as their title, and still read the badge', () => {
    const rows = buildRegRows(REGISTRY, HYPOTHESES)
    const row = rows.find((r) => r.badge === 'PASS')
    if (!row || !verdict?.render) throw new Error('no PASS row or no render')
    render(<div>{verdict.render(row)}</div>)
    expect(screen.getByText('[PASS]').getAttribute('title')).toBe(REG.verdictNote)
    expect(verdict.format?.(row)).toBe('[PASS]')
    expect(verdict.value(row)).toBe('PASS')
  })

  it('every kind of badge keeps its text and its tone', () => {
    const rows = buildRegRows(REGISTRY, HYPOTHESES)
    for (const badge of ['PASS', 'FAIL', 'CHECK']) {
      const row = rows.find((r) => r.badge === badge)
      if (!row || !verdict?.render) throw new Error(`no ${badge} row`)
      cleanup()
      render(<div>{verdict.render(row)}</div>)
      expect(screen.getByText(`[${badge}]`)).toBeTruthy()
      expect(verdict.tone?.(row)).toBe(badge === 'PASS' ? 'up' : badge === 'FAIL' ? 'down' : 'muted')
    }
  })

  it('keeps the compact set as it was: the same columns, the same widths', () => {
    expect(REG_COMPACT_COLUMNS.map((c) => c.id)).toEqual(['name', 'tag', 'verdict', 'n', 'p', 'holm', 'bhQ', 'hash', 'amend'])
    expect(REG_COMPACT_COLUMNS.find((c) => c.id === 'holm')?.width).toBe(58)
  })
})
