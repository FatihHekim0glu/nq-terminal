// U15 (polish 3): the Pass checks page shows the gating statistic next to each boolean check, and formats a raw
// value with the headline unit. Nothing is computed: every figure is read from the card, the screen extract
// (blocks, cost ladder) or the screen JSON, and a check with no statistic recorded says so.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import { DES } from '../../copy/des'
import { IMPLAUSIBLE_ALPHA_PCT, passCheckRows, type PassCheckRow } from './desModel'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from './desTestData'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'

const VOLMANAGED_WITH_SCREEN = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN }
const row = (rows: readonly PassCheckRow[], key: string): PassCheckRow => {
  const found = rows.find((r) => r.key === key)
  if (!found) throw new Error(`no check ${key}`)
  return found
}
const cell = (r: PassCheckRow, path: string) => r.cells.find((c) => c.path === path)

describe('volmanaged_v0: the three checks that read "not recorded" now show their statistic', () => {
  const rows = passCheckRows(VOLMANAGED_WITH_SCREEN)

  it('alpha_t_ge_2 shows the gating alpha t of the card, with the bar', () => {
    const r = row(rows, 'alpha_t_ge_2')
    expect(r.source).toMatchObject({ label: VOLMANAGED.card.t_label, text: '+1.18', short: '+1.18', unit: 'ratio', threshold: '>= 2' })
    expect(r.result).toBe('fail')
  })

  it('blocks_a_gt_0 shows every recorded block with its unit, and the block that decides', () => {
    const r = row(rows, 'blocks_a_gt_0')
    expect(r.source?.text).toBe('2010-13 +5.96, 2014-17 -1.43, 2018-21 +3.73')
    expect(r.source?.short).toBe('2014-17 -1.43')
    expect(r.source?.unit).toBe(VOLMANAGED.des.blocks_unit)
    expect(r.source?.threshold).toBe('> 0')
  })

  it('dsr_2tick_gt_0 shows the Sharpe difference at 2 ticks from the screen JSON', () => {
    const r = row(rows, 'dsr_2tick_gt_0')
    expect(r.source?.label).toBe(`${DES.dsrLabel} at 2 ticks`)
    expect(r.source?.text).toBe('-0.0061')
    expect(r.source?.threshold).toBe('> 0')
    expect(r.source?.from).toBe('headline.2tick.dsr')
  })

  it('has no statistic for the dsr check when the screen JSON is not on the card (never another number)', () => {
    const bare = passCheckRows(VOLMANAGED)
    expect(row(bare, 'dsr_2tick_gt_0').source).toBeNull()
    expect(row(bare, 'alpha_t_ge_2').source?.text).toBe('+1.18')
  })

  it('does not take the cost ladder (an alpha) for the Sharpe difference', () => {
    const r = row(passCheckRows(VOLMANAGED), 'dsr_2tick_gt_0')
    expect(r.source).toBeNull()
  })
})

describe('overnight_v0 and za_v0: the statistic of each check', () => {
  const rows = passCheckRows(OVERNIGHT)

  it('t_ge_2_5 is the registered t, all_blocks_gt_0 the blocks, stress_2tick_ge_0 the 2 tick rung of the cost ladder', () => {
    expect(row(rows, 't_ge_2_5').source).toMatchObject({ text: '+2.78', threshold: '>= 2.5' })
    expect(row(rows, 'all_blocks_gt_0').source).toMatchObject({ short: '2010-13 +0.58', threshold: '> 0' })
    expect(row(rows, 'stress_2tick_ge_0').source).toMatchObject({ text: '+2.37', unit: OVERNIGHT.des.cost_ladder_unit, threshold: '>= 0' })
  })

  it('the combined "passes" flag has no statistic of its own', () => {
    expect(row(rows, 'passes').source).toBeNull()
  })

  it('za_v0: the mean net R is the registered headline, the blocks and the 2 tick rung come from the extract', () => {
    const za = passCheckRows(ZA)
    expect(row(za, 'mean_net_r_gt_0').source).toMatchObject({ text: '+0.016', unit: ZA.card.headline_unit, threshold: '> 0' })
    expect(row(za, 'same_sign_all_blocks').source?.text).toBe('2010-2013 -0.13, 2014-2017 -0.01, 2018-2021 +0.16')
    expect(row(za, 'stress_2tick_ge_0').source).toMatchObject({ text: '-0.053', unit: ZA.des.cost_ladder_unit })
  })

  it('a hypothesis with no checks has no rows, and unreadable blocks give no statistic', () => {
    expect(passCheckRows(ZA_C3)).toEqual([])
  })
})

describe('rebal_v0: the boolean checks read their sibling raw values', () => {
  const rows = passCheckRows(REBAL)

  it('names the gating statistic of each cN check', () => {
    expect(row(rows, 'c1_mean_t').source).toMatchObject({ text: '+1.13', unit: 'ratio', threshold: null })
    expect(row(rows, 'c2_blocks').source?.short).toBe('2010-13 +13.48')
    expect(row(rows, 'c3_two_tick').source).toMatchObject({ text: '+15.95', unit: REBAL.des.cost_ladder_unit })
    expect(row(rows, 'c4_contrast').source).toMatchObject({ label: 'contrast', text: '+1.77', from: 'contrast.welch_t' })
    expect(row(rows, 'c5_alpha').source).toMatchObject({ label: 'alpha', text: '+1.29', from: 'alpha.t_min' })
    expect(row(rows, 'c6_valid').source).toMatchObject({ label: 'n_valid', text: '129', from: 'n_valid' })
  })

  it('leaves the raw value rows without a statistic (they are the values)', () => {
    for (const key of ['n_valid', 'headline', 'blocks', 'two_tick_mean', 'contrast', 'alpha']) {
      expect(row(rows, key).source, key).toBeNull()
      expect(row(rows, key).result).toBe('value')
    }
  })
})

describe('raw values are formatted with units and flagged when implausible', () => {
  const rows = passCheckRows(REBAL)
  const UNIT = 'points per trade (NQ)'

  it('gives the per-trade measures of the headline the headline unit, counts and ratios none', () => {
    const headline = row(rows, 'headline')
    expect(cell(headline, 'n')?.text).toBe('129')
    expect(cell(headline, 'mean')?.text).toBe(`16.45 ${UNIT}`)
    expect(cell(headline, 'median')?.text).toBe(`2.03 ${UNIT}`)
    expect(cell(headline, 'sd')?.text).toBe(`165.19 ${UNIT}`)
    expect(cell(headline, 't')?.text).toBe('+1.13')
    expect(cell(headline, 'p_one_sided')?.text).toBe('0.1300')
    expect(cell(headline, 'hit_rate')?.text).toBe('51.2%')
    expect(cell(headline, 'total')?.text).toBe('2122.35')
  })

  it('formats the scalar rows and the nested blocks the same way', () => {
    expect(row(rows, 'n_valid').cells).toEqual([{ path: '', text: '129', flag: null }])
    expect(row(rows, 'two_tick_mean').cells).toEqual([{ path: '', text: `15.95 ${UNIT}`, flag: null }])
    const blocks = row(rows, 'blocks')
    expect(cell(blocks, '2010-13.n')?.text).toBe('38')
    expect(cell(blocks, '2010-13.mean')?.text).toBe(`13.48 ${UNIT}`)
    const contrast = row(rows, 'contrast')
    expect(cell(contrast, 'buy_mean')?.text).toBe(`59.53 ${UNIT}`)
    expect(cell(contrast, 'welch_p_one_sided')?.text).toBe('0.0403')
  })

  it('flags alpha_annual_pct above 1,000 %/yr as implausible, and shows its unit', () => {
    const alpha = cell(row(rows, 'alpha'), 'alpha_annual_pct')
    expect(alpha?.text).toBe('25573.58 %/yr')
    expect(alpha?.flag).toBe(DES.passChecks.implausible)
    expect(cell(row(rows, 'alpha'), 't.1')?.text).toBe('+1.29')
    expect(cell(row(rows, 'alpha'), 'a')?.flag).toBeNull()
  })

  it('flags on the magnitude, either sign, and not at or under the limit', () => {
    const make = (v: number) => passCheckRows({
      ...REBAL,
      card: { ...REBAL.card, pass_checks: [{ name: 'alpha', passed: null, value: { alpha_annual_pct: v } }] },
    })
    expect(IMPLAUSIBLE_ALPHA_PCT).toBe(1000)
    expect(cell(make(1000)[0]!, 'alpha_annual_pct')?.flag).toBeNull()
    expect(cell(make(999.5)[0]!, 'alpha_annual_pct')?.flag).toBeNull()
    expect(cell(make(1000.01)[0]!, 'alpha_annual_pct')?.flag).toBe(DES.passChecks.implausible)
    expect(cell(make(-2500)[0]!, 'alpha_annual_pct')?.flag).toBe(DES.passChecks.implausible)
  })

  it('never invents a unit: without a headline unit the measures print plain', () => {
    const bare = passCheckRows({ ...REBAL, card: { ...REBAL.card, headline_unit: null } })
    expect(cell(row(bare, 'headline'), 'mean')?.text).toBe('16.45')
  })

  it('a check with no value still says so', () => {
    expect(row(passCheckRows(VOLMANAGED), 'alpha_t_ge_2').cells).toEqual([])
  })
})

describe('the pass-check copy follows the copy rules', () => {
  it('has no dash and no US spelling', () => {
    expect(findCopyViolations({ passChecks: DES.passChecks })).toEqual([])
  })
})
