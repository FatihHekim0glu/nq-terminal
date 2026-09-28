// robustnessModel.test.ts (roadmap #4 DES robustness, slice 1 of 3): every reader against the two real
// backend screen files. Pinned values are the file's own (see arch/v2/W1.md W1-R4a); nothing here is
// recomputed, so a value changing in the fixture is the signal something upstream drifted.
import { describe, expect, it } from 'vitest'
import { DES_ROBUSTNESS } from '../../copy/des'
import { OVERNIGHT_SCREEN, VOLMANAGED_SCREEN } from './robustness.fixtures'
import {
  genericSections,
  negativeCount,
  placeboLadder,
  readPlacebo,
  readQuintiles,
  readRobustness,
  readSpecCurve,
  readStability,
  readSubsets,
  readTails,
  specCurveLadder,
  yearLadder,
  type ScreenJson,
} from './robustnessModel'

const VOL = VOLMANAGED_SCREEN as ScreenJson
const OVERNIGHT = OVERNIGHT_SCREEN as ScreenJson

describe('readSpecCurve (the headline rule plus 13 pre-registered variants, 1 tick)', () => {
  it('reads the headline row bit-equal to the file', () => {
    const curve = readSpecCurve(VOL)
    expect(curve?.headline).toEqual({
      key: 'headline',
      no: 0,
      sharpeM: 0.9914875364356394,
      sharpeBh: 0.9946882195853753,
      dsr1: -0.0032006831497359833,
      dsr2: -0.006122927646368348,
      alphaPct1: 3.47270285188713,
      tMin1: 1.1762095550806055,
      b1: 0.5771695630648541,
      turnover: null,
      tradeDays: null,
      nEval: 2686,
      t0: '2011-04-21',
    })
  })

  it('reads all 13 variants in file order, numbered 1 to 13, none dropped', () => {
    const curve = readSpecCurve(VOL)
    expect(curve?.variants).toHaveLength(13)
    expect(curve?.dropped).toBe(0)
    expect(curve?.variants.map((v) => v.key)).toEqual([
      'lookahead_c', 'monthly', 'band_0', 'gradual', 'inverse_vol', 'har', 'extra_lag',
      'nq_lot', 'cap_1.0', 'cap_1.5', 'cap_3.0', 'cap_inf', 'subsampled_rv',
    ])
    expect(curve?.variants.map((v) => v.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    const monthly = curve?.variants.find((v) => v.key === 'monthly')
    expect(monthly).toEqual({
      key: 'monthly', no: 2, sharpeM: 0.8869092359440094, sharpeBh: 0.9924303588775666,
      dsr1: -0.1055211229335572, dsr2: -0.1075535628211376, alphaPct1: 1.7855980333968302,
      tMin1: 0.5660547187529578, b1: 0.654352109455891, turnover: 2.3143935213967297,
      tradeDays: 129, nEval: 2681, t0: '2011-04-29',
    })
  })

  it('is null when the screen records no variants', () => {
    expect(readSpecCurve(OVERNIGHT)).toBeNull()
    expect(readSpecCurve(null)).toBeNull()
    expect(readSpecCurve(undefined)).toBeNull()
    expect(readSpecCurve({})).toBeNull()
  })

  it('drops and counts a variant with neither dsr_1 nor alpha_annual_pct_1 finite, never throwing', () => {
    const screen: ScreenJson = {
      variants: {
        ok: { dsr_1: 0.1 },
        malformed: 'not an object',
        nullish: null,
        empty: {},
        onlyDsr2: { dsr_2: 0.2 },
      },
    }
    const curve = readSpecCurve(screen)
    expect(curve?.variants.map((v) => v.key)).toEqual(['ok'])
    expect(curve?.dropped).toBe(4)
  })

  it('never throws on null, {} or a malformed headline', () => {
    expect(() => readSpecCurve({ variants: {}, headline: 'not an object' })).not.toThrow()
    expect(() => readSpecCurve({ variants: {}, headline: { '1tick': null } })).not.toThrow()
    expect(readSpecCurve({ variants: {}, headline: 'not an object' })?.headline).toBeNull()
  })
})

describe('negativeCount (pinned: 9 of 13 variants negative, never the headline)', () => {
  it('counts the 9 named variants, matching the file', () => {
    const curve = readSpecCurve(VOL)
    expect(negativeCount(curve, 'dsr1')).toEqual({ negative: 9, of: 13 })
    const negatives = curve?.variants.filter((v) => (v.dsr1 ?? 0) < 0).map((v) => v.key).sort()
    expect(negatives).toEqual(
      ['band_0', 'cap_1.5', 'cap_3.0', 'cap_inf', 'extra_lag', 'gradual', 'lookahead_c', 'monthly', 'subsampled_rv'].sort(),
    )
  })

  it('is zero of zero for a null curve, never throwing', () => {
    expect(negativeCount(null, 'dsr1')).toEqual({ negative: 0, of: 0 })
  })

  it('counts only the variants that record the measure in its denominator, not every variant', () => {
    const screen: ScreenJson = {
      variants: {
        a: { dsr_1: -0.1 },
        b: { dsr_1: 0.2 },
        c: { alpha_annual_pct_1: 1.5 },
      },
    }
    const curve = readSpecCurve(screen)
    expect(negativeCount(curve, 'dsr1')).toEqual({ negative: 1, of: 2 })
  })
})

describe('specCurveLadder (headline plus variants, ascending, only the headline emphasised)', () => {
  it('sorts by dsr1 ascending, labels the headline "H" and every variant its number, and names the ladder', () => {
    const curve = readSpecCurve(VOL)
    const ladder = specCurveLadder(curve, 'dsr1', 'volmanaged_v0')
    expect(ladder.name).toBe('volmanaged_v0 Sharpe difference (m - BH) by variant, 1 tick')
    expect(ladder.name).toContain(DES_ROBUSTNESS.dsrName.replace('{name} ', ''))
    expect(ladder.unit).toBe('')
    expect(ladder.bars).toHaveLength(14)
    expect(ladder.bars.map((b) => b.label)).toEqual(['2', '7', '4', '1', '12', '11', '10', '13', 'H', '3', '9', '8', '5', '6'])
    const values = ladder.bars.map((b) => b.value)
    expect(values).toEqual([...values].sort((a, b) => (a ?? 0) - (b ?? 0)))
    const headlineBar = ladder.bars.find((b) => b.label === 'H')
    expect(headlineBar).toMatchObject({ value: -0.0032006831497359833, emphasis: true })
    expect(ladder.bars.filter((b) => b.emphasis === true)).toHaveLength(1)
  })

  it('names the alpha ladder in percent', () => {
    const curve = readSpecCurve(VOL)
    const ladder = specCurveLadder(curve, 'alphaPct1', 'volmanaged_v0')
    expect(ladder.name).toBe('volmanaged_v0 alpha by variant, 1 tick')
    expect(ladder.unit).toBe('%')
  })

  it('never throws for a null curve, drawing an empty ladder', () => {
    const ladder = specCurveLadder(null, 'dsr1', 'x')
    expect(ladder.bars).toEqual([])
  })
})

describe('readPlacebo and placeboLadder (pinned: percentile 0.8775, 2000 draws, 3 quantiles)', () => {
  it('reads every field bit-equal to the file', () => {
    const p = readPlacebo(VOL)
    expect(p).toEqual({
      actual: 3.4727028518871252,
      percentile: 0.8775,
      draws: 2000,
      seed: 20260926,
      minShift: 252,
      quantiles: [
        { q: 0.05, value: -5.5938448935245235 },
        { q: 0.5, value: -0.09663710765393531 },
        { q: 0.95, value: 4.744922720297418 },
      ],
    })
  })

  it('draws the quantile rail then the emphasised actual bar with a reference line at it', () => {
    const p = readPlacebo(VOL)
    const ladder = placeboLadder(p, 'volmanaged_v0')
    expect(ladder.bars.map((b) => b.label)).toEqual(['placebo 5%', 'placebo 50%', 'placebo 95%', 'actual'])
    expect(ladder.bars.map((b) => b.value)).toEqual([-5.5938448935245235, -0.09663710765393531, 4.744922720297418, 3.4727028518871252])
    expect(ladder.bars.filter((b) => b.emphasis === true)).toEqual([{ label: 'actual', value: 3.4727028518871252, emphasis: true }])
    expect(ladder.reference).toEqual({ value: 3.4727028518871252, label: 'actual' })
    expect(ladder.name).toBe('volmanaged_v0 alpha against the placebo quantiles, 1 tick')
  })

  it('is null for a screen without a placebo section, never throwing', () => {
    expect(readPlacebo(OVERNIGHT)).toBeNull()
    expect(readPlacebo(null)).toBeNull()
    expect(readPlacebo({ placebo: 'not an object' })).toBeNull()
    const ladder = placeboLadder(null, 'x')
    expect(ladder.bars).toEqual([])
    expect(ladder.reference).toBeUndefined()
  })
})

describe('readStability and yearLadder (pinned: 11 LOYO and 11 per-year rows, 2011 to 2021)', () => {
  it('reads both sections, year keys sorted ascending', () => {
    const s = readStability(VOL)
    expect(s?.loyo).toHaveLength(11)
    expect(s?.perYear).toHaveLength(11)
    expect(s?.loyo.map((r) => r.year)).toEqual(['2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021'])
    expect(s?.perYear.map((r) => r.year)).toEqual(s?.loyo.map((r) => r.year))
  })

  it('reads LOYO rows bit-equal to the file, with a null b (the file carries none there)', () => {
    const s = readStability(VOL)
    expect(s?.loyo[0]).toEqual({ year: '2011', alphaPct: 3.5771236291044604, tMin: 1.1138898235310566, n: 175, b: null })
  })

  it('reads per-year rows bit-equal to the file, including b', () => {
    const s = readStability(VOL)
    expect(s?.perYear[0]).toEqual({ year: '2011', alphaPct: -4.832976784694848, tMin: -0.7226045016523187, n: 175, b: 0.42845979659628974 })
  })

  it('is null for a screen without stability, never throwing', () => {
    expect(readStability(OVERNIGHT)).toBeNull()
    expect(readStability(null)).toBeNull()
    expect(readStability({ stability: 'not an object' })).toBeNull()
  })

  it('builds a year ladder carrying n, with an optional reference line (LOYO against all years)', () => {
    const s = readStability(VOL)
    const curve = readSpecCurve(VOL)
    const ladder = yearLadder(s!.loyo, 'volmanaged_v0 alpha leaving one year out', {
      value: curve!.headline!.alphaPct1!,
      label: DES_ROBUSTNESS.allYears,
    })
    expect(ladder.bars[0]).toEqual({ label: '2011', value: 3.5771236291044604, n: 175 })
    expect(ladder.reference).toEqual({ value: 3.47270285188713, label: 'all years' })
    expect(ladder.unit).toBe('%')
  })
})

describe('readQuintiles (pinned: 5 rows)', () => {
  it('reads all 5 quintiles bit-equal to the file', () => {
    const q = readQuintiles(VOL)
    expect(q).toHaveLength(5)
    expect(q?.[0]).toEqual({ quintile: 1, n: 538, sigma2Median: 2.599533971082705e-05, meanPct: 0.04711827285840065, sdPct: 0.7179456396387828, meanOverVar: 9.14126372271832 })
    expect(q?.[4]).toEqual({ quintile: 5, n: 537, sigma2Median: 0.0001866464504776559, meanPct: 0.19000754600932618, sdPct: 2.0390194868839586, meanOverVar: 4.570125183424384 })
  })

  it('is null for a screen without quintiles, never throwing', () => {
    expect(readQuintiles(OVERNIGHT)).toBeNull()
    expect(readQuintiles(null)).toBeNull()
    expect(readQuintiles({ quintiles: 'not an array' })).toBeNull()
  })
})

describe('readTails (pinned: 5 tail measures, managed against buy and hold)', () => {
  it('reads all 5 measures, in tails.managed key order, bit-equal to the file', () => {
    const t = readTails(VOL)
    expect(t).toHaveLength(5)
    expect(t?.map((r) => r.measure)).toEqual(['vol_of_vol_pct', 'shortfall_1pct', 'shortfall_5pct', 'max_drawdown_pct', 'skew'])
    expect(t?.[0]).toEqual({ measure: 'vol_of_vol_pct', managed: 2.519554757358062, bh: 6.1314491299529745 })
    expect(t?.[4]).toEqual({ measure: 'skew', managed: -0.576368439498524, bh: -0.597332336172998 })
  })

  it('is null for a screen without tails, never throwing', () => {
    expect(readTails(OVERNIGHT)).toBeNull()
    expect(readTails(null)).toBeNull()
    expect(readTails({ tails: { managed: 'not an object' } })).toBeNull()
  })
})

describe('readSubsets (pinned: overnight has 9 rows, arrays skipped, p_one_sided never read)', () => {
  it('reads 9 rows, skipping long_gap_list (an array)', () => {
    const rows = readSubsets(OVERNIGHT)
    expect(rows).toHaveLength(9)
    expect(rows?.map((r) => r.key)).not.toContain('long_gap_list')
    expect(rows?.every((r) => !('p_one_sided' in r) && !('p' in r))).toBe(true)
  })

  it('reads weeknight and roll_nights bit-equal to the file', () => {
    const rows = readSubsets(OVERNIGHT)
    const weeknight = rows?.find((r) => r.key === 'weeknight')
    expect(weeknight).toEqual({ key: 'weeknight', n: 2212, mean: 3.5315379746835456, median: 3.026, sd: 51.857489065383355, t: 3.202911637672595, hitRate: 0.5682640144665461, total: 7811.762000000002 })
    const rollNights = rows?.find((r) => r.key === 'roll_nights')
    expect(rollNights).toMatchObject({ n: 44, t: -0.7775680273772807 })
  })

  it('keeps a subset whose n is recorded null (late_exit), and drops one whose n is missing entirely', () => {
    const rows = readSubsets({
      subsets: { late_exit: { n: null, mean: null }, noN: { mean: 1 }, list: [1, 2, 3] },
    })
    expect(rows?.map((r) => r.key)).toEqual(['late_exit'])
    expect(rows?.[0]).toMatchObject({ key: 'late_exit', n: null })
  })

  it('is null for a screen without subsets, never throwing on null, {} or malformed input', () => {
    expect(readSubsets(VOL)).toBeNull()
    expect(readSubsets(null)).toBeNull()
    expect(readSubsets({})).toBeNull()
    expect(readSubsets({ subsets: 'not an object' })).toBeNull()
  })
})

describe('genericSections (pinned: OVERNIGHT = legs, intraday_cost_ladder, bp_return, subwindows_descriptive)', () => {
  it('lists exactly those four sections, in file order, each with at least one numeric leaf', () => {
    const sections = genericSections(OVERNIGHT)
    expect(sections.map((s) => s.key)).toEqual(['legs', 'intraday_cost_ladder', 'bp_return', 'subwindows_descriptive'])
    for (const s of sections) {
      expect(s.rows.length).toBeGreaterThan(0)
      expect(s.more).toBe(0)
    }
  })

  it('drops every leaf whose last path part is p, p_one_sided, p_value or pvalue', () => {
    const sections = genericSections(OVERNIGHT)
    const leaves = sections.flatMap((s) => s.rows.map(([path]) => path))
    expect(leaves.some((p) => /(^|\.)p(_one_sided|_value)?$/.test(p) || /(^|\.)pvalue$/.test(p))).toBe(false)
  })

  it('excludes every handled and bookkeeping key (VOLMANAGED has none left generic)', () => {
    expect(genericSections(VOL)).toEqual([])
  })

  it('caps sections at max and rows at maxRows, reporting more', () => {
    const screen: ScreenJson = { a: { x: 1 }, b: { x: 2 }, c: { x: 3 } }
    expect(genericSections(screen, 2).map((s) => s.key)).toEqual(['a', 'b'])
    const manyRows: ScreenJson = { big: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i])) }
    const capped = genericSections(manyRows, 8, 3)
    expect(capped[0]?.rows).toHaveLength(3)
    expect(capped[0]?.more).toBe(2)
  })

  it('drops a p-value-named leaf even when it is not one of the four exact names (p_x3, p_gap_le_0)', () => {
    const screen: ScreenJson = {
      bonferroni: { p_x3: 0.01, n: 5 },
      gap: { p_gap_le_0: 0.2, label: 'x' },
    }
    const sections = genericSections(screen)
    expect(sections.map((s) => s.key)).toEqual(['bonferroni'])
    const bonferroni = sections.find((s) => s.key === 'bonferroni')
    expect(bonferroni?.rows.some(([path]) => path.endsWith('p_x3'))).toBe(false)
  })

  it('drops a section with no numeric leaf, and skips a non-object value', () => {
    const screen: ScreenJson = { strings: { a: 'x', b: 'y' }, scalar: 5, arr: [1, 2, 3] }
    expect(genericSections(screen)).toEqual([])
  })

  it('never throws on null, {} or a malformed top-level value', () => {
    expect(genericSections(null)).toEqual([])
    expect(genericSections({})).toEqual([])
    expect(genericSections({ weird: null, other: undefined, arr: [1, 2] })).toEqual([])
  })
})

describe('readRobustness (every section together, from one screen)', () => {
  it('reads the volmanaged screen: spec curve, placebo, stability, quintiles, tails, no subsets, no generic', () => {
    const r = readRobustness(VOL)
    expect(r.specCurve?.variants).toHaveLength(13)
    expect(r.placebo?.draws).toBe(2000)
    expect(r.stability?.loyo).toHaveLength(11)
    expect(r.quintiles).toHaveLength(5)
    expect(r.tails).toHaveLength(5)
    expect(r.subsets).toBeNull()
    expect(r.generic).toEqual([])
  })

  it('reads the overnight screen: subsets and generic sections, everything else null', () => {
    const r = readRobustness(OVERNIGHT)
    expect(r.specCurve).toBeNull()
    expect(r.placebo).toBeNull()
    expect(r.stability).toBeNull()
    expect(r.quintiles).toBeNull()
    expect(r.tails).toBeNull()
    expect(r.subsets).toHaveLength(9)
    expect(r.generic.map((s) => s.key)).toEqual(['legs', 'intraday_cost_ladder', 'bp_return', 'subwindows_descriptive'])
  })

  it('never throws for null, undefined or {}', () => {
    expect(() => readRobustness(null)).not.toThrow()
    expect(() => readRobustness(undefined)).not.toThrow()
    expect(() => readRobustness({})).not.toThrow()
    const r = readRobustness({})
    expect(r).toEqual({ specCurve: null, placebo: null, stability: null, quintiles: null, tails: null, subsets: null, generic: [] })
  })
})
