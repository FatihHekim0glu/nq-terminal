import { describe, expect, it } from 'vitest'
import { DEFLATED as VIEW } from '../tear/tearP1.fixtures'
import { deflatedFacts, deflatedLadder, deflatedNullFacts, deflatedRows, dsrFor, formatDsr, withDeflated } from './deflatedModel'
import { buildRegRows } from './regModel'
import { DEFLATED_REAL } from './deflatedFixtures'
import { HYPOTHESES, REGISTRY } from './regFixtures'

describe('SV3 on screen', () => {
  it('states N, V and SR0 per session and annualised, the cost and the basis', () => {
    expect(deflatedFacts(VIEW)).toBe(
      'N 2 registered trials; V 0.038027 (variance of the per-session Sharpe ratios); SR0 0.1014 per session, 1.61 annualised; 1 tick per side; Basis A.',
    )
  })

  it('lists every trial with its Sharpe, moments, SR0 in its own period and its DSR', () => {
    const rows = deflatedRows(VIEW)
    expect(rows.map((r) => r.name)).toEqual(['overnight_v0', 'volmanaged_v0'])
    expect(rows[1]).toEqual({
      name: 'volmanaged_v0', kind: 'daily', periods: '252', n: '39', annual: '-3.72', srSession: '-0.2342', skew: '-0.39', kurt: '2.59',
      sr0: '0.1014', dsr: '0.016', sr0Null: '0.0600', dsrNull: '0.030',
    })
  })

  it('prints a DSR below 1e-6 as "< 0.000001", never as an exponent or a rounded 0.000', () => {
    expect(formatDsr(1.7564390357662887e-60)).toBe('< 0.000001')
    expect(formatDsr(0.0000123)).toBe('0.000012')
    expect(formatDsr(0.9034)).toBe('0.903')
    expect(formatDsr(null)).toBe('--')
    expect(deflatedRows(DEFLATED_REAL).find((r) => r.name === 'za_v0')?.dsr).toBe('< 0.000001')
  })

  it('states V0, its SR0, the trial that drives V left out and what N assumes (the real registry)', () => {
    expect(deflatedNullFacts(DEFLATED_REAL)).toEqual([
      'Under the null variance V0 0.000368 (the sampling variance of a Sharpe estimate when no trial has skill, 1/(n - 1) for each trial averaged in sessions: the variance the expected maximum assumes): SR0 0.0369 per session, 0.59 annualised.',
      'Without mim_v0, V is 0.000793 and SR0 0.86 annualised (N kept at 21).',
      DEFLATED_REAL.n_note + '.',
    ])
    expect(deflatedNullFacts(VIEW)).toHaveLength(2)
  })

  it('draws the DSR under V0 by trial, highest first (under V every real trial is below 1e-30)', () => {
    const ladder = deflatedLadder(VIEW)
    const byNull = [...VIEW.rows].sort((a, b) => b.dsr_null! - a.dsr_null!)
    expect(ladder.bars.map((b) => b.label)).toEqual(byNull.map((r) => r.name))
    expect(ladder.bars.map((b) => b.value)).toEqual(byNull.map((r) => r.dsr_null))
    expect(ladder.name).toMatch(/V0/)
    expect(ladder.decimals).toBe(3)
  })

  it('finds one trial by name for DES, and nothing for a name that is not a trial', () => {
    expect(dsrFor(VIEW, 'volmanaged_v0')?.dsr).toBe('0.016')
    expect(dsrFor(VIEW, 'volmanaged_v0')?.dsrNull).toBe('0.030')
    expect(dsrFor(VIEW, 'rebal_v1_confirm')).toBeNull()
  })

  it('names the trial that dominates V as the API words it (the real registry: mim_v0)', () => {
    expect(DEFLATED_REAL.n_trials).toBe(21)
    expect(DEFLATED_REAL.dominant).toMatch(/^mim_v0: /)
    expect(deflatedFacts(DEFLATED_REAL).endsWith(`Basis A. ${DEFLATED_REAL.dominant}.`)).toBe(true)
  })
})

describe('REG join', () => {
  const rows = buildRegRows(REGISTRY, HYPOTHESES)

  it('born failing: a registry row that is not an SV3 trial gets no DSR (never another row\'s)', () => {
    const joined = withDeflated(rows, DEFLATED_REAL)
    expect(joined.filter((r) => r.dsr !== null)).toHaveLength(21)
    expect(joined.find((r) => r.name === 'za_v0_C3_gao_momentum')?.dsr).toBeNull()
    for (const row of joined) {
      const trial = DEFLATED_REAL.rows.find((t) => t.name === row.name)
      expect(row.dsr).toBe(trial ? trial.dsr_null : null)
    }
    expect(joined.some((r) => r.dsr === null)).toBe(true)
  })

  it('leaves the rows alone (a new array, the same fields) until the view arrives', () => {
    expect(withDeflated(rows, undefined)).toBe(rows)
    expect(rows.every((r) => r.dsr === null)).toBe(true)
  })
})
