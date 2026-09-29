// @vitest-environment jsdom
// 92) Evidence drops columns in two tiers as its panel narrows. The two power columns (MDE alpha/k and
// Sharpe/MDE, 120 px) go first, so a panel between 714 and 833 px, such as a half width REG panel at
// 1920 x 1080, keeps Years and Sealed test as it did before those columns existed. Below 714 px the
// compact set is used (Years and Sealed test go as well). A wide panel, or none measured, shows every
// column and no note.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EVIDENCE } from '../../copy/evidence'
import { stubLayout } from '../../grids/testing'
import { gridWidth } from '../../grids/useElementWidth'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import { DEFLATED_REAL } from './deflatedFixtures'
import { EVIDENCE_COLUMNS, EVIDENCE_COMPACT_COLUMNS, EVIDENCE_NO_POWER_COLUMNS } from './evidenceColumns'
import { buildEvidenceRows } from './evidenceModel'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import { buildRegRows } from './regModel'
import RegEvidence from './RegEvidence'
import type { HypothesisDetails } from './useHypothesisDetails'

beforeAll(() => stubLayout(1200))
afterEach(cleanup)

const DETAILS: HypothesisDetails = {
  byName: new Map([
    ['overnight_v0', OVERNIGHT],
    ['volmanaged_v0', VOLMANAGED],
    ['rebal_v0', REBAL],
    ['za_v0', ZA],
    ['za_v0_C3_gao_momentum', ZA_C3],
  ]),
  failed: new Map(),
  pending: 0,
}

const ROWS = buildEvidenceRows({
  rows: buildRegRows(REGISTRY, HYPOTHESES),
  cards: HYPOTHESES,
  confirmations: CONFIRMATIONS,
  deflated: DEFLATED_REAL,
  details: DETAILS,
  family: { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k },
})

function headers(): string[] {
  const grid = screen.getByRole('grid', { name: EVIDENCE.gridLabel })
  return within(grid).getAllByRole('columnheader').map((h) => h.textContent ?? '')
}

const has = (label: string): boolean => headers().some((h) => h.includes(label))
const note = (text: string): HTMLElement | null => screen.queryByText(text)

describe('RegEvidence: two tier column drop', () => {
  it('keeps the width arithmetic the tiers rely on', () => {
    expect(gridWidth(EVIDENCE_COLUMNS)).toBe(834)
    expect(gridWidth(EVIDENCE_NO_POWER_COLUMNS)).toBe(714)
    expect(EVIDENCE_NO_POWER_COLUMNS.map((c) => c.id)).not.toContain('mde')
    expect(EVIDENCE_NO_POWER_COLUMNS.map((c) => c.id)).not.toContain('ratio')
    expect(EVIDENCE_NO_POWER_COLUMNS.map((c) => c.id)).toEqual(expect.arrayContaining(['years', 'sealed']))
    expect(EVIDENCE_COMPACT_COLUMNS.map((c) => c.id)).not.toContain('years')
  })

  it('at 800 px drops only the two power columns and says so', () => {
    expect(EVIDENCE.powerNote).toBe('Columns hidden here (maximise the panel to see them): MDE alpha/k, Sharpe/MDE. 98) Export saves every column.')
    render(<RegEvidence rows={ROWS} width={800} />)
    expect(has(EVIDENCE.cols.years)).toBe(true)
    expect(has(EVIDENCE.cols.sealed)).toBe(true)
    expect(has(EVIDENCE.cols.mde)).toBe(false)
    expect(has(EVIDENCE.cols.ratio)).toBe(false)
    expect(note(EVIDENCE.powerNote)).not.toBeNull()
    expect(note(EVIDENCE.compactNote)).toBeNull()
  })

  it('at the full grid width shows every column and no note', () => {
    render(<RegEvidence rows={ROWS} width={gridWidth(EVIDENCE_COLUMNS)} />)
    for (const c of Object.values(EVIDENCE.cols)) expect(has(c), c).toBe(true)
    expect(note(EVIDENCE.powerNote)).toBeNull()
    expect(note(EVIDENCE.compactNote)).toBeNull()
  })

  it('with no measured width shows every column and no note', () => {
    render(<RegEvidence rows={ROWS} width={null} />)
    expect(has(EVIDENCE.cols.mde)).toBe(true)
    expect(has(EVIDENCE.cols.ratio)).toBe(true)
    expect(note(EVIDENCE.powerNote)).toBeNull()
    expect(note(EVIDENCE.compactNote)).toBeNull()
  })

  it('one pixel under the full width drops the power columns, and exactly at the middle width keeps years and sealed', () => {
    render(<RegEvidence rows={ROWS} width={gridWidth(EVIDENCE_COLUMNS) - 1} />)
    expect(has(EVIDENCE.cols.mde)).toBe(false)
    expect(has(EVIDENCE.cols.years)).toBe(true)
    expect(note(EVIDENCE.powerNote)).not.toBeNull()
    cleanup()
    render(<RegEvidence rows={ROWS} width={gridWidth(EVIDENCE_NO_POWER_COLUMNS)} />)
    expect(has(EVIDENCE.cols.years)).toBe(true)
    expect(has(EVIDENCE.cols.sealed)).toBe(true)
    expect(note(EVIDENCE.powerNote)).not.toBeNull()
  })

  it('one pixel under the middle width uses the compact set and its note', () => {
    render(<RegEvidence rows={ROWS} width={gridWidth(EVIDENCE_NO_POWER_COLUMNS) - 1} />)
    expect(has(EVIDENCE.cols.years)).toBe(false)
    expect(has(EVIDENCE.cols.sealed)).toBe(false)
    expect(has(EVIDENCE.cols.mde)).toBe(false)
    expect(has(EVIDENCE.cols.ratio)).toBe(false)
    expect(note(EVIDENCE.compactNote)).not.toBeNull()
    expect(note(EVIDENCE.powerNote)).toBeNull()
  })
})
