import { describe, expect, it } from 'vitest'
import { TEAR_SV7 } from '../../copy/tear'
import { RUN_ANALYTICS } from './tear.fixtures'
import { HYP_ANALYTICS } from './tearP1.fixtures'
import { readSv7, sv7Empty, sv7Ladder, sv7Notes, sv7Table, sv7Title, type Sv7Tests } from './tearSv7Model'

const TESTS = HYP_ANALYTICS.validity.sharpe_difference_tests
const ONE = TESTS['1tick'] as Record<string, unknown>
const TWO = TESTS['2tick'] as Record<string, unknown>

describe('SV7: the Sharpe difference tests as the screen file records them', () => {
  it('pins the 1 tick values of the fixture hypothesis exactly (never recomputed)', () => {
    const sv7 = readSv7(TESTS)
    expect(sv7.dropped).toBe(0)
    const one = sv7.rows[0]!
    expect(one).toMatchObject({ cost: '1tick', ticks: 1, label: 'Sharpe difference (m - BH)', sharpe_difference: -0.0032006831497359833 })
    expect(one.ledoit_wolf).toEqual({
      d_annual: -0.0032012791246315434,
      se_annual: 0.1861285188223514,
      p_one_sided: 0.4884,
      ci90_annual: [-0.2912810743114972, 0.3409167158996742],
      block: 10,
      reps: 4999,
      seed: 20260926,
      n: 2686,
    })
    expect(one.memmel).toEqual({ z: -0.01525763159738737, p_one_sided: 0.5060866781837026, rho: 0.7662841684392472 })
  })

  it('keeps the headline and the Ledoit-Wolf point apart, as the file does', () => {
    const one = readSv7(TESTS).rows[0]!
    expect(one.sharpe_difference).not.toBe(one.ledoit_wolf!.d_annual)
  })

  it('sorts the rows by tick count, not by the text of the key', () => {
    const sv7 = readSv7({ '10tick': ONE, '2tick': TWO, '1tick': ONE })
    expect(sv7.rows.map((r) => [r.cost, r.ticks])).toEqual([['1tick', 1], ['2tick', 2], ['10tick', 10]])
  })

  it('leaves out a malformed entry and counts it', () => {
    const lw = ONE.ledoit_wolf as Record<string, unknown>
    const tests: Sv7Tests = {
      ...TESTS,
      gross: ONE,
      '3tick': 'not an entry',
      '4tick': { ...ONE, ledoit_wolf: { ...lw, d_annual: '-0.0032' } },
      '5tick': { ...ONE, ledoit_wolf: { ...lw, ci90_annual: [-0.29] } },
      '6tick': { ...ONE, label: 7 },
      '7tick': { ...ONE, memmel: [1, 2, 3] },
      '8tick': null,
    }
    const sv7 = readSv7(tests)
    expect(sv7.rows.map((r) => r.cost)).toEqual(['1tick', '2tick'])
    expect(sv7.dropped).toBe(7)
  })

  it('keeps an entry whose test is absent (the API sends null) and shows it as missing', () => {
    const sv7 = readSv7({ '3tick': { label: 'Sharpe difference (m - BH)', sharpe_difference: null, ledoit_wolf: null, memmel: null } })
    expect(sv7.dropped).toBe(0)
    expect(sv7.rows[0]).toMatchObject({ ticks: 3, sharpe_difference: null, ledoit_wolf: null, memmel: null })
    expect(sv7Ladder(sv7, 'x').bars[0]).toMatchObject({ value: null, lo: null, hi: null })
  })

  it('reads a missing field as null, never as a number', () => {
    const sv7 = readSv7({ '1tick': { label: 'Sharpe difference (m - BH)', ledoit_wolf: { d_annual: 0.1 }, memmel: { z: 1.2 } } })
    expect(sv7.rows[0]!.ledoit_wolf).toEqual({ d_annual: 0.1, se_annual: null, p_one_sided: null, ci90_annual: null, block: null, reps: null, seed: null, n: null })
    expect(sv7.rows[0]!.memmel).toEqual({ z: 1.2, p_one_sided: null, rho: null })
    expect(sv7.rows[0]!.sharpe_difference).toBeNull()
  })

  it('gives no rows for a series without the tests (a run: the API sends {})', () => {
    const sv7 = readSv7(RUN_ANALYTICS.validity.sharpe_difference_tests)
    expect(sv7).toEqual({ rows: [], dropped: 0, label: null })
    expect(sv7Empty(sv7)).toBe(TEAR_SV7.notRecorded)
  })

  it('never changes the API object', () => {
    const before = JSON.stringify(TESTS)
    readSv7(TESTS)
    expect(JSON.stringify(TESTS)).toBe(before)
  })
})

describe('SV7 display', () => {
  const sv7 = readSv7(TESTS)

  it('takes the title from the file when every row shares its label', () => {
    expect(sv7.label).toBe('Sharpe difference (m - BH)')
    expect(sv7Title(sv7)).toBe('Sharpe difference (m - BH)')
    const mixed = readSv7({ '1tick': ONE, '2tick': { ...TWO, label: 'Another label' } })
    expect(mixed.label).toBeNull()
    expect(sv7Title(mixed)).toBe(TEAR_SV7.title)
  })

  it('draws the Ledoit-Wolf points as bars with their 90% intervals as whiskers, one per cost', () => {
    const ladder = sv7Ladder(sv7, 'volmanaged_v0')
    expect(ladder.name).toBe('volmanaged_v0 Sharpe difference (m - BH) by cost, Ledoit-Wolf, annualised')
    expect(ladder.ci).toBe(TEAR_SV7.ci)
    expect(ladder.decimals).toBe(4)
    expect(ladder.bars).toEqual([
      { label: '1 tick', value: -0.0032012791246315434, lo: -0.2912810743114972, hi: 0.3409167158996742, n: 2686 },
      { label: '2 ticks', value: -0.006124067750212914, lo: -0.294154172277687, hi: 0.3379919390048933, n: 2686 },
    ])
  })

  it('prints each measure per cost at display precision, with the sign on signed values', () => {
    const table = sv7Table(sv7)
    expect(table.columns).toEqual([{ id: '1tick', label: '1 tick' }, { id: '2tick', label: '2 ticks' }])
    const byId = Object.fromEntries(table.sections.flatMap((s) => s.rows).map((r) => [r.id, r.values]))
    expect(byId).toEqual({
      headline: ['-0.0032', '-0.0061'],
      point: ['-0.0032', '-0.0061'],
      se: ['0.1861', '0.1861'],
      lo: ['-0.29', '-0.29'],
      hi: ['+0.34', '+0.34'],
      lwP: ['0.4884', '0.4950'],
      z: ['-0.02', '-0.03'],
      rho: ['0.77', '0.77'],
      memmelP: ['0.5061', '0.5116'],
      block: ['10', '10'],
      reps: ['4,999', '4,999'],
      seed: ['20260926', '20260926'],
      n: ['2,686', '2,686'],
    })
    expect(table.sections.map((s) => s.title)).toEqual([null, TEAR_SV7.bands.lw, TEAR_SV7.bands.memmel, TEAR_SV7.bands.provenance])
  })

  it('prints a missing value as -- and a tiny p as <0.0001', () => {
    const lw = ONE.ledoit_wolf as Record<string, unknown>
    const table = sv7Table(readSv7({ '1tick': { ...ONE, ledoit_wolf: { ...lw, p_one_sided: 0.00001, ci90_annual: null }, memmel: null } }))
    const byId = Object.fromEntries(table.sections.flatMap((s) => s.rows).map((r) => [r.id, r.values[0]]))
    expect(byId).toMatchObject({ lwP: '<0.0001', lo: '--', hi: '--', z: '--', rho: '--', memmelP: '--' })
  })

  it('says how many entries were left out, only when some were', () => {
    expect(sv7Notes(sv7)).toEqual([])
    expect(sv7Notes(readSv7({ ...TESTS, gross: ONE }))).toEqual([TEAR_SV7.droppedOne])
    expect(sv7Notes(readSv7({ ...TESTS, gross: ONE, net: 1 }))).toEqual(['2 entries in another shape were left out.'])
  })

  it('born failing: an object whose every entry is malformed is not called unrecorded', () => {
    const all = readSv7({ gross: ONE })
    expect(all.rows).toEqual([])
    expect(sv7Empty(all)).toBe('Sharpe difference (m - BH): 1 entry in another shape was left out, so nothing is drawn.')
  })
})
