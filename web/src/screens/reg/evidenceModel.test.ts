// evidenceModel (roadmap #5, W1-R5a): the evidence matrix's rows, pinned on the real research fixtures
// (regFixtures.ts, deflatedFixtures.ts, des/desTestData.ts). No score, rank or total column exists.
import { describe, expect, it } from 'vitest'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA_C3 } from '../des/desTestData'
import { DEFLATED_REAL } from './deflatedFixtures'
import { powerView } from './powerModel'
import { buildRegRows } from './regModel'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import {
  blocksCount, buildEvidenceRows, detailStatus, evidenceCsv, type BuildEvidenceInput, type EvidenceRow,
} from './evidenceModel'
import type { HypothesisDetails } from './useHypothesisDetails'

const REG_ROWS = buildRegRows(REGISTRY, HYPOTHESES)

const DETAILS: HypothesisDetails = {
  byName: new Map([
    ['overnight_v0', OVERNIGHT],
    ['volmanaged_v0', VOLMANAGED],
    ['rebal_v0', REBAL],
    ['za_v0_C3_gao_momentum', ZA_C3],
  ]),
  failed: new Map([['tom_v0', 'not found']]),
  pending: 0,
}

const FAMILY = { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k }

function build(details: HypothesisDetails = DETAILS, family: BuildEvidenceInput['family'] = FAMILY): EvidenceRow[] {
  const input: BuildEvidenceInput = { rows: REG_ROWS, cards: HYPOTHESES, confirmations: CONFIRMATIONS, deflated: DEFLATED_REAL, details, family }
  return buildEvidenceRows(input)
}

function rowOf(rows: readonly EvidenceRow[], name: string): EvidenceRow {
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}

describe('buildEvidenceRows', () => {
  it('keeps the served registry order, the same order 91) Board shows', () => {
    const rows = build()
    expect(rows.map((r) => r.name)).toEqual(REGISTRY.rows.map((r) => r.name))
  })

  it('pins volmanaged_v0: FAIL, its own t and holm, 2 of 3 blocks positive, its break-even, no sealed test', () => {
    const row = rowOf(build(), 'volmanaged_v0')
    expect(row.badge).toBe('FAIL')
    expect(row.t).toBe(1.1762095550806055)
    expect(row.tLabel).toBe('alpha t (gating: smaller of Newey-West lags 5 and 21)')
    expect(row.holm).toBe(1.0)
    expect(row.blocksPositive).toBe(2)
    expect(row.blocksTotal).toBe(3)
    expect(row.blocksUnit).toBe('alpha, % per year, 1 tick per side')
    expect(row.breakEven).toBe(66.10675789415836)
    expect(row.sealed).toBeNull()
    expect(row.sharpe).toBe(0.9914875364356387)
    expect(row.years).toBeCloseTo(2686 / 252, 12)
    expect(row.dsr).toBe(0.9031888626419274)
    expect(row.detail).toBe('ok')
  })

  it('pins overnight_v0: PASS, all 3 blocks positive, no recorded break-even', () => {
    const row = rowOf(build(), 'overnight_v0')
    expect(row.badge).toBe('PASS')
    expect(row.t).toBe(2.7836183248935744)
    expect(row.holm).toBe(0.05140837226779872)
    expect(row.blocksPositive).toBe(3)
    expect(row.blocksTotal).toBe(3)
    expect(row.breakEven).toBeNull()
    expect(row.sealed).toBeNull()
    expect(row.sharpe).toBe(0.8297644634898602)
    expect(row.dsr).toBe(0.7845748411145064)
    expect(row.detail).toBe('ok')
  })

  it('pins rebal_v0: [FAIL] SPENT from its own confirmation, all 3 blocks positive', () => {
    const row = rowOf(build(), 'rebal_v0')
    expect(row.badge).toBe('FAIL')
    expect(row.blocksPositive).toBe(3)
    expect(row.blocksTotal).toBe(3)
    expect(row.breakEven).toBeNull()
    expect(row.sealed).toEqual({ name: 'rebal_v1_confirm', badge: 'FAIL' })
    expect(row.sharpe).toBe(0.3368422942082003)
    expect(row.dsr).toBe(0.19675234199418007)
    expect(row.detail).toBe('ok')
  })

  it('pins za_v0_C3_gao_momentum: CHECK, unregistered, no blocks count (no blocks_unit), not an SV3 trial', () => {
    const row = rowOf(build(), 'za_v0_C3_gao_momentum')
    expect(row.registered).toBe(false)
    expect(row.badge).toBe('CHECK')
    expect(row.t).toBe(-1.863779337234944)
    expect(row.holm).toBeNull()
    expect(row.blocksPositive).toBeNull()
    expect(row.blocksTotal).toBeNull()
    expect(row.sharpe).toBeNull()
    expect(row.years).toBeNull()
    expect(row.dsr).toBeNull()
    expect(row.detail).toBe('ok')
  })

  it('pins tom_v0 with a failed detail: no Blocks or Break-even, but the deflated view still gives Sharpe, Years and DSR', () => {
    const row = rowOf(build(), 'tom_v0')
    expect(row.detail).toBe('failed')
    expect(row.detailError).toBe('not found')
    expect(row.blocksPositive).toBeNull()
    expect(row.blocksTotal).toBeNull()
    expect(row.breakEven).toBeNull()
    expect(row.holm).toBe(0.9344508212040903)
    expect(row.sharpe).toBe(0.4680803107226186)
    expect(row.years).toBeCloseTo(2836 / 252, 12)
    expect(row.dsr).toBe(0.34608056115117425)
  })

  it('pins vt_har_v0 rows: an overlay with no t statistic, still on the deflated view under its own tag', () => {
    const row = rowOf(build(), 'vt_har_v0')
    expect(row.tag).toBe('overlay')
    expect(row.badge).toBe('PASS')
    expect(row.t).toBeNull()
    expect(row.tLabel).toBe("no t statistic: the gate's p is a joint block bootstrap p")
    expect(row.holm).toBe(0.004200000000000001)
    expect(row.sharpe).toBe(0.06008249303396882)
    expect(row.years).toBeCloseTo(2517 / 252, 12)
    expect(row.dsr).toBe(0.048590140631467695)
    expect(row.detail).toBe('pending')
  })

  it('born failing: no evidence row carries a score, rank or total key (no aggregate, ever)', () => {
    for (const row of build()) {
      const keys = Object.keys(row)
      expect(keys).not.toContain('score')
      expect(keys).not.toContain('rank')
      expect(keys).not.toContain('total')
    }
  })
})

describe('blocksCount', () => {
  it('is null with no des at all', () => {
    expect(blocksCount(null)).toBeNull()
    expect(blocksCount(undefined)).toBeNull()
  })

  it('is null when blocks_unit is null, however many finite values sit in blocks', () => {
    expect(blocksCount({ blocks_unit: null, blocks: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] })).toBeNull()
  })

  it('is null when every block value is null (nothing finite to count)', () => {
    expect(blocksCount({ blocks_unit: 'pts', blocks: [{ label: 'a', value: null }, { label: 'b', value: null }] })).toBeNull()
  })

  it('counts only finite values, zero not positive', () => {
    const des = { blocks_unit: 'pts', blocks: [{ label: 'a', value: 1 }, { label: 'b', value: null }, { label: 'c', value: -2 }, { label: 'd', value: 0 }] }
    expect(blocksCount(des)).toEqual({ positive: 1, total: 3 })
  })

  it('counts every block positive when every finite value is', () => {
    const des = { blocks_unit: 'pts', blocks: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }] }
    expect(blocksCount(des)).toEqual({ positive: 3, total: 3 })
  })
})

describe('detailStatus', () => {
  it('is null when every row is read (nothing pending, nothing failed)', () => {
    const rows = build().filter((r) => r.detail !== 'pending' && r.detail !== 'failed')
    expect(detailStatus(rows)).toBeNull()
  })

  it('reads while anything is still pending, even if something else has already failed', () => {
    const rows = build()
    const status = detailStatus(rows)
    expect(status).toEqual({ kind: 'reading', n: rows.filter((r) => r.detail === 'pending').length })
  })

  it('reports the first failure by served order once nothing is pending', () => {
    const rows = build().filter((r) => r.detail !== 'pending')
    const status = detailStatus(rows)
    expect(status).toEqual({ kind: 'failed', n: 1, name: 'tom_v0', detail: 'not found' })
  })
})

describe('evidenceCsv', () => {
  it('has a tagged header naming every column and its basis', () => {
    const [head] = evidenceCsv(build()).split('\r\n')
    expect(head).toBe([
      'name', 'verdict [PRE-REG]', 't [PRE-REG]', 't_label', 'holm_p [PRE-REG]', 'blocks_positive [PRE-REG]',
      'blocks_total', 'blocks_unit', 'break_even_ticks_per_side [PRE-REG]', 'sealed_confirmation [SPENT]',
      'sealed_verdict [SPENT]', 'annual_sharpe_sv3a [POST HOC]', 'years_sv3a [POST HOC]', 'dsr_v0 [POST HOC]',
      'mde_alpha_over_k [POST HOC]', 'sharpe_over_mde [POST HOC]',
    ].join(','))
  })

  it('writes the two power columns last, at full precision, empty where there is no figure', () => {
    const lines = evidenceCsv(build()).split('\r\n')
    // Other cells hold quoted commas, so the last two cells are read from the end of the line.
    const lastTwo = (name: string) => lines.find((l) => l.startsWith(`${name},`))!.split(',').slice(-2)
    const power = powerView(DEFLATED_REAL, FAMILY).rows.find((r) => r.name === 'volmanaged_v0')!
    expect(lastTwo('volmanaged_v0')).toEqual([String(power.mdeFamily), String(power.ratio)])
    // An unregistered row is not an SV3 trial: no MDE, and the cells are empty, not zero.
    expect(lastTwo('za_v0_C3_gao_momentum')).toEqual(['', ''])
  })

  it('exports at full precision, the raw sealed name and badge, never the display text', () => {
    const csv = evidenceCsv(build())
    expect(csv).toContain('66.10675789415836')
    expect(csv).toContain('rebal_v1_confirm,FAIL')
    // The display text is only ever "[FAIL] SPENT" (sealedItem); the raw CSV cell never carries it.
    expect(csv).not.toContain('[FAIL] SPENT')
  })
})

describe('the power columns (MDE alpha/k and Sharpe/MDE, [POST HOC], computed in the browser)', () => {
  it('mdeFamily equals powerView\'s value for every SV3 trial, joined by name', () => {
    const view = powerView(DEFLATED_REAL, FAMILY)
    const rows = build()
    for (const p of view.rows) {
      const row = rowOf(rows, p.name)
      expect(row.mdeFamily).toBe(p.mdeFamily)
      expect(row.mdeRatio).toBe(p.ratio)
    }
    expect(view.rows).toHaveLength(21)
  })

  it('pins volmanaged_v0: MDE 1.12 at alpha/k and Sharpe/MDE 0.88 (the catalogue anchor)', () => {
    const row = rowOf(build(), 'volmanaged_v0')
    expect(row.mdeFamily).toBeCloseTo(1.12, 2)
    expect(row.mdeRatio).toBeCloseTo(0.88, 2)
  })

  it('is the served Sharpe over the MDE, and no other combination', () => {
    for (const row of build()) {
      if (row.sharpe === null || typeof row.mdeFamily !== 'number') continue
      expect(row.mdeRatio).toBe(row.sharpe / row.mdeFamily)
    }
  })

  it('is null for a row that is not an SV3 trial (unregistered) and null everywhere without the family', () => {
    expect(rowOf(build(), 'za_v0_C3_gao_momentum').mdeFamily).toBeNull()
    expect(rowOf(build(), 'za_v0_C3_gao_momentum').mdeRatio).toBeNull()
    for (const row of build(DETAILS, null)) {
      expect(row.mdeFamily).toBeNull()
      expect(row.mdeRatio).toBeNull()
    }
  })

  it('is null for every row when the family has no usable k, but the served columns stay', () => {
    const rows = build(DETAILS, { alpha: 0.05, k: 0 })
    for (const row of rows) expect(row.mdeFamily).toBeNull()
    expect(rowOf(rows, 'volmanaged_v0').sharpe).toBe(0.9914875364356387)
  })

  it('is null for every row without the deflated view', () => {
    const input: BuildEvidenceInput = { rows: REG_ROWS, cards: HYPOTHESES, confirmations: CONFIRMATIONS, deflated: undefined, details: DETAILS, family: FAMILY }
    for (const row of buildEvidenceRows(input)) expect(row.mdeFamily).toBeNull()
  })

  it('leaves the row order, and every other cell, exactly as before', () => {
    const without = build(DETAILS, null)
    const withFamily = build()
    expect(withFamily.map((r) => r.name)).toEqual(without.map((r) => r.name))
    for (let i = 0; i < without.length; i += 1) {
      const { mdeFamily: _a, mdeRatio: _b, ...rest } = without[i]!
      const { mdeFamily: _c, mdeRatio: _d, ...restWith } = withFamily[i]!
      expect(restWith).toEqual(rest)
    }
  })

  it('has no score, rank or total key beside the new fields', () => {
    for (const row of build()) {
      const keys = Object.keys(row)
      expect(keys).toContain('mdeFamily')
      expect(keys).toContain('mdeRatio')
      expect(keys).not.toContain('score')
      expect(keys).not.toContain('rank')
      expect(keys).not.toContain('total')
    }
  })
})
