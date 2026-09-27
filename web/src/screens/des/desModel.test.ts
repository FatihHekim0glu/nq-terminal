import { describe, expect, it } from 'vitest'
import { DES } from '../../copy/des'
import {
  blocksInput,
  checkReading,
  checkRows,
  costInput,
  decimalsFor,
  defaultCost,
  findConfirmation,
  flattenValue,
  formatNumber,
  passBarText,
  registrationKpis,
  shortSha,
  spentStrip,
} from './desModel'
import { CONFIRMATION, OVERNIGHT, REBAL, VOLMANAGED, ZA_C3 } from './desTestData'

describe('formatNumber and decimalsFor', () => {
  it('prints fixed decimals with an explicit plus when signed, and -- for missing values', () => {
    expect(formatNumber(2.8669734513274343, 2)).toBe('2.87')
    expect(formatNumber(2.8669734513274343, 2, true)).toBe('+2.87')
    expect(formatNumber(-1.4288535977287111, 2, true)).toBe('-1.43')
    expect(formatNumber(null, 2)).toBe('--')
    expect(formatNumber(Number.NaN, 2)).toBe('--')
  })

  it('never prints a negative zero', () => {
    expect(formatNumber(-0.0001, 2)).toBe('0.00')
    expect(formatNumber(-0.0001, 2, true)).toBe('0.00')
  })

  it('keeps two significant figures for small magnitudes and two decimals from 1 up', () => {
    expect(decimalsFor([2.87, 16.45])).toBe(2)
    expect(decimalsFor([0.016, -0.05])).toBe(3)
    expect(decimalsFor([-0.00076, -0.00014])).toBe(5)
    expect(decimalsFor([null, Number.NaN])).toBe(2)
  })
})

describe('pass bar and spec text', () => {
  it('returns a string pass bar exactly as the spec holds it', () => {
    const spec = REBAL.spec as Record<string, unknown>
    expect(passBarText(spec)).toBe(spec['pass_bar'])
  })

  it('prints an object pass bar as indented JSON, so every key and value shows verbatim', () => {
    const bar = { mean_net_r_gt: 0.0, t_stat_ge: 2.5 }
    expect(passBarText({ pass_bar: bar })).toBe(JSON.stringify(bar, null, 2))
  })

  it('returns null without a spec or a pass bar', () => {
    expect(passBarText(null)).toBeNull()
    expect(passBarText({ name: 'x' })).toBeNull()
  })

  it('shortens a sha256 to its first and last four characters', () => {
    expect(shortSha('64bf34d5b9f0b88287830b1af373d26248e11ce224a94ce0a97d28019dce0f33')).toBe('64bf...0f33')
    expect(shortSha(null)).toBe('--')
  })
})

describe('pass check readings', () => {
  it('reads comparators and decimal thresholds from the check name', () => {
    expect(checkReading('t_ge_2_5')).toBe('t >= 2.5')
    expect(checkReading('n_le_475')).toBe('n <= 475')
    expect(checkReading('all_blocks_gt_0')).toBe('all blocks > 0')
    expect(checkReading('valid_ge_85')).toBe('valid >= 85')
  })

  it('labels the dsr field as the Sharpe difference, never as a deflated Sharpe ratio', () => {
    const reading = checkReading('dsr_2tick_gt_0')
    expect(reading).toBe(`${DES.dsrLabel} 2tick > 0`)
    expect(reading).not.toMatch(/\bdsr\b/i)
  })

  it('numbers the rows and keeps booleans and values apart', () => {
    const rows = checkRows(REBAL.card.pass_checks, 1)
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => i + 1))
    expect(rows[0]).toMatchObject({ key: 'c1_mean_t', result: 'fail' })
    expect(rows[1]).toMatchObject({ key: 'c2_blocks', result: 'pass' })
    const nValid = rows.find((r) => r.key === 'n_valid')
    expect(nValid).toMatchObject({ result: 'value', value: [['', '129']] })
  })

  it('flattens an object value into dotted paths, labelling dsr keys', () => {
    expect(flattenValue({ a: 1.23456, b: { dsr: -0.0032 } })).toEqual([
      ['a', '1.2346'],
      [`b.${DES.dsrLabel}`, '-0.0032'],
    ])
    expect(flattenValue(true)).toEqual([['', 'true']])
    expect(flattenValue(null)).toEqual([])
  })
})

describe('blocks and cost ladder (read from the JSON, never recomputed)', () => {
  it('passes every block value through unchanged, with its unit', () => {
    const input = blocksInput(OVERNIGHT.des, 'overnight_v0')
    expect(input?.bars.map((b) => [b.label, b.value])).toEqual(OVERNIGHT.des.blocks.map((b) => [b.label, b.value]))
    expect(input?.unit).toBe(OVERNIGHT.des.blocks_unit)
  })

  it('gives no block chart when the screen records no block unit', () => {
    expect(blocksInput(ZA_C3.des, 'za_v0_C3_gao_momentum')).toBeNull()
  })

  it('labels each rung by ticks per side and passes the values through', () => {
    const input = costInput(OVERNIGHT.des, 'overnight_v0')
    expect(input?.bars.map((b) => b.label)).toEqual(['0 ticks', '1 tick', '2 ticks'])
    expect(input?.bars.map((b) => b.value)).toEqual(OVERNIGHT.des.cost_ladder.map((r) => r.value))
    expect(input?.marker).toBeUndefined()
  })

  it('draws the break-even marker only when it lies on the ladder', () => {
    const on = costInput({ ...OVERNIGHT.des, break_even_ticks_per_side: 1.5 }, 'x')
    expect(on?.marker?.at).toBeCloseTo(1.5, 12)
    const off = costInput(VOLMANAGED.des, 'volmanaged_v0')
    expect(off?.marker).toBeUndefined()
  })

  it('places the marker by rung position when the ladder starts above zero', () => {
    const des = { ...OVERNIGHT.des, cost_ladder: [{ ticks_per_side: 1, value: 1 }, { ticks_per_side: 2, value: -1 }], break_even_ticks_per_side: 1.5 }
    expect(costInput(des, 'x')?.marker?.at).toBeCloseTo(0.5, 12)
  })

  it('gives no ladder when none is recorded', () => {
    expect(costInput(ZA_C3.des, 'x')).toBeNull()
  })
})

describe('registration figures', () => {
  it('builds the KPI row from the card, each tile tagged and on basis A', () => {
    const kpis = registrationKpis(OVERNIGHT.card)
    expect(kpis.map((k) => k.kpi.label)).toEqual([
      OVERNIGHT.card.headline_display, 'n', OVERNIGHT.card.t_label, 'p', 'Control p', 'Bonferroni', 'Holm', 'BH q',
    ])
    expect(kpis.every((k) => k.kpi.basis === 'A' && k.kpi.tag === '[PRE-REG]')).toBe(true)
    expect(kpis[0]?.kpi.value).toBe(OVERNIGHT.card.headline_value)
    expect(kpis[0]?.kpi.unit).toBe(OVERNIGHT.card.headline_unit)
    const control = kpis.find((k) => k.kpi.key === 'control_p')
    expect(control?.kpi.value).toBeNull()
    expect(control?.kpi.note).toBe(DES.notRecorded)
  })

  it('tags a check that is not registered as post hoc', () => {
    expect(registrationKpis(ZA_C3.card).every((k) => k.kpi.tag === '[POST HOC]')).toBe(true)
  })

  it('chooses 1 tick when recorded, else the first cost, else none', () => {
    expect(defaultCost(OVERNIGHT.card)).toBe(1)
    expect(defaultCost({ ...OVERNIGHT.card, series_costs: [0, 2] })).toBe(0)
    expect(defaultCost(ZA_C3.card)).toBeNull()
  })
})

describe('sealed window strip', () => {
  it('pairs the in-sample test with its sealed confirmation and files', () => {
    const strip = spentStrip(REBAL.card, [CONFIRMATION], [{ name: 'rebal_v1_confirm', kind: 'json', label: CONFIRMATION.label }])
    expect(strip?.confirmations).toEqual([CONFIRMATION])
    expect(strip?.label).toBe(CONFIRMATION.label)
    expect(strip?.sealed.map((s) => s.name)).toEqual(['rebal_v1_confirm', 'rebal_v1_confirm_trades'])
    expect(strip?.sealed[0]?.label).toBe(CONFIRMATION.label)
  })

  it('shows sealed files even without a confirmation, and nothing when neither exists', () => {
    expect(spentStrip(VOLMANAGED.card, [], [])?.sealed.map((s) => s.name)).toEqual(['volmanaged_oos', 'volmanaged_oos_daily'])
    expect(spentStrip(OVERNIGHT.card, [CONFIRMATION], [])).toBeNull()
  })

  it('finds a confirmation by exact name only', () => {
    expect(findConfirmation('rebal_v1_confirm', [CONFIRMATION])).toBe(CONFIRMATION)
    expect(findConfirmation('rebal_v0', [CONFIRMATION])).toBeUndefined()
    expect(findConfirmation('x', undefined)).toBeUndefined()
  })
})
