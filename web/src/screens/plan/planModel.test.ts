// PLAN's model: the typed draft -> the bounded query, and the served plan -> table cells. Born failing: every bound is
// refused one step outside its range and 365 periods a year is not an option; the bars are read for the next slot.
import { describe, expect, it } from 'vitest'
import contract from '../../../../contract/openapi.json?raw'
import { findCopyViolations } from '../../copy/copyRules'
import { PLAN } from '../../copy/plan'
import {
  BARS_COLUMNS,
  INITIAL_DRAFT,
  PLAN_BOUNDS,
  barsRows,
  answerSummary,
  bookLine,
  designColumns,
  designHeaders,
  designRows,
  formatAlpha,
  isPeriods,
  parseDraft,
  type PlanDraft,
} from './planModel'
import { PERIODS_OPTIONS } from './planTypes'
import { PLAN_EXAMPLE } from './powerTable.fixtures'

const draft = (over: Partial<PlanDraft>): PlanDraft => ({ ...INITIAL_DRAFT, ...over })

describe('parseDraft', () => {
  it('turns the initial design into a query of 252 periods, 2520 observations and alpha 0.05', () => {
    expect(parseDraft(INITIAL_DRAFT)).toEqual({ query: { periods: 252, n: 2520, alpha: 0.05 }, problems: [] })
  })

  it('asks by years when the book is given in years', () => {
    expect(parseDraft(draft({ by: 'years', size: '10.5', periods: 12 })).query).toEqual({ periods: 12, years: 10.5, alpha: 0.05 })
  })

  it('carries the optional family size, Sharpe and event standard deviation only when typed', () => {
    const full = parseDraft(draft({ k: '80', sharpe: '1', eventSd: '14.8', size: '787' }))
    expect(full.query).toEqual({ periods: 252, n: 787, k: 80, alpha: 0.05, sharpe: 1, event_sd: 14.8 })
    expect(parseDraft(draft({ k: '  ', sharpe: '', eventSd: ' ' })).query).toEqual({ periods: 252, n: 2520, alpha: 0.05 })
  })

  it('takes a typed family size of zero (the first test of a family) and a Sharpe of zero', () => {
    expect(parseDraft(draft({ k: '0', sharpe: '0' })).query).toMatchObject({ k: 0, sharpe: 0 })
  })

  const bounds: ReadonlyArray<readonly [string, Partial<PlanDraft>, string, string]> = [
    ['n', { by: 'n' }, '1', '100001'],
    ['years', { by: 'years' }, '0.4999', '100.0001'],
    ['k', {}, '-1', '1001'],
    ['alpha', {}, '0.0009', '0.2501'],
    ['sharpe', {}, '-0.01', '5.01'],
    ['eventSd', {}, '0.009', '10000.01'],
  ]
  const field = (name: string): keyof PlanDraft => (name === 'n' || name === 'years' ? 'size' : (name as keyof PlanDraft))

  it.each(bounds)('born failing: %s is refused one step outside its range and taken on it', (name, base, under, over) => {
    const key = field(name)
    const edge = (PLAN_BOUNDS[name as keyof typeof PLAN_BOUNDS])
    for (const refused of [under, over]) {
      const parsed = parseDraft(draft({ ...base, [key]: refused }))
      expect(parsed.query, `${name}=${refused}`).toBeNull()
      expect(parsed.problems, `${name}=${refused}`).toHaveLength(1)
    }
    for (const accepted of [String(edge.min), String(edge.max)]) {
      expect(parseDraft(draft({ ...base, [key]: accepted })).query, `${name}=${accepted}`).not.toBeNull()
    }
  })

  it('refuses text that is not a plain number, including nan, inf, a comma and an empty required field', () => {
    for (const bad of ['abc', 'nan', 'Infinity', 'inf', '1,5', '2 520', '0x10', '', '  ']) {
      expect(parseDraft(draft({ size: bad })).query, bad).toBeNull()
      expect(parseDraft(draft({ alpha: bad })).query, bad).toBeNull()
    }
    expect(parseDraft(draft({ k: 'x' })).query).toBeNull()
  })

  it('refuses a fraction where a whole number is needed (n and the family size)', () => {
    expect(parseDraft(draft({ size: '2520.5' })).problems[0]).toBe('Size must be a whole number.')
    expect(parseDraft(draft({ k: '80.5' })).problems[0]).toBe('Typed family size k must be a whole number.')
  })

  it('names every unusable field, in field order, and says the range', () => {
    const parsed = parseDraft(draft({ size: '1', k: '-3', alpha: '2', sharpe: 'a', eventSd: '0' }))
    expect(parsed.query).toBeNull()
    expect(parsed.problems).toEqual([
      'Size must be from 2 to 100000.',
      'Typed family size k must be from 0 to 1000.',
      'Alpha must be from 0.001 to 0.25.',
      'Typed Sharpe must be a number.',
      'Event sd must be from 0.01 to 10000.',
    ])
  })

  it('offers the four periods and never 365', () => {
    expect([...PERIODS_OPTIONS]).toEqual([252, 52, 12, 4])
    expect([252, 52, 12, 4].every(isPeriods)).toBe(true)
    for (const bad of [365, 360, 366, 0, 1, 251, 253, 5]) expect(isPeriods(bad), String(bad)).toBe(false)
    expect(Object.keys(PLAN.periodsOptions)).toEqual(['4', '12', '52', '252'])
  })
})

interface ContractParameter {
  readonly name: string
  readonly schema: { readonly minimum?: number; readonly maximum?: number; readonly anyOf?: ReadonlyArray<{ minimum?: number; maximum?: number }> }
}
const PLAN_OPERATION = (JSON.parse(contract) as { paths: Record<string, { get?: { parameters?: ContractParameter[] } }> })
  .paths['/api/analytics/plan']?.get

describe('the bounds equal the backend contract', () => {
  // Skipped only until the merge step regenerates contract/openapi.json with GET /api/analytics/plan; from then on
  // a bound that moves on either side fails here.
  it.runIf(PLAN_OPERATION !== undefined)('declares the same minimum and maximum for every number', () => {
    const declared = new Map((PLAN_OPERATION?.parameters ?? []).map((p) => [p.name, p.schema.anyOf?.find((s) => s.minimum !== undefined) ?? p.schema]))
    const pairs: ReadonlyArray<readonly [string, { min: number; max: number }]> = [
      ['n', PLAN_BOUNDS.n], ['years', PLAN_BOUNDS.years], ['k', PLAN_BOUNDS.k], ['alpha', PLAN_BOUNDS.alpha],
      ['sharpe', PLAN_BOUNDS.sharpe], ['event_sd', PLAN_BOUNDS.eventSd],
    ]
    for (const [name, bound] of pairs) {
      expect(declared.get(name)?.minimum, `${name} minimum`).toBe(bound.min)
      expect(declared.get(name)?.maximum, `${name} maximum`).toBe(bound.max)
    }
  })
})

describe('formatAlpha', () => {
  it('writes three significant digits without an exponent', () => {
    expect(formatAlpha(0.05)).toBe('0.05')
    expect(formatAlpha(0.05 / 60)).toBe('0.000833')
    expect(formatAlpha(0.05 / 81)).toBe('0.000617')
    expect(formatAlpha(0.25)).toBe('0.25')
  })
})

describe('the tables of the served plan (the round 17 design: 787 events, 14.8 bp, a registry of 59 and a typed 80)', () => {
  it('states the book in one line', () => {
    expect(bookLine(PLAN_EXAMPLE)).toBe('787 observations at 252 a year span 3.12 years, one sided, alpha 0.05.')
  })

  it('summarises each slot for the live region: the bar, the minimum detectable Sharpe and the typed power', () => {
    const text = answerSummary(PLAN_EXAMPLE)
    expect(text).toContain('Registry 59: next slot 60, Bonferroni bar 0.000833, minimum detectable Sharpe 2.26')
    expect(text).toContain('Typed 80: next slot 81, Bonferroni bar 0.000617, minimum detectable Sharpe 2.30')
    expect(text).toContain('Power at typed Sharpe 1 is 0.07')
    expect(text).toContain('Mean per event is 2.15')
    expect(answerSummary({ ...PLAN_EXAMPLE, typed_sharpe: null, event_sd: null })).not.toMatch(/typed Sharpe|per event/)
    expect(answerSummary({ ...PLAN_EXAMPLE, slots: [PLAN_EXAMPLE.slots[0]!] })).not.toContain('Typed 80')
  })

  it('puts the bars at the next slot: k 59 is slot 60 and a typed 80 is slot 81, not k itself', () => {
    const rows = barsRows(PLAN_EXAMPLE)
    expect(rows.map((r) => [r.family, r.slot, r.bonferroni, r.holmStrictest, r.holmLoosest])).toEqual([
      ['Registry 59', '60', '0.000833', '0.000833', '0.05'],
      ['Typed 80', '81', '0.000617', '0.000617', '0.05'],
    ])
    expect(rows[0]!.bonferroniZ).toBe('3.144')
    expect(rows[0]!.holmLoosestZ).toBe('1.645')
    expect(BARS_COLUMNS).toHaveLength(8)
  })

  it('reads the design against the single test alpha, then each slot', () => {
    const rows = designRows(PLAN_EXAMPLE)
    expect(rows.map((r) => r.test)).toEqual(['Single test', 'Slot 60, Registry 59', 'Slot 81, Typed 80'])
    expect(rows[0]!.alpha).toBe('0.05')
    expect(rows[0]!.mde).toBe('1.41')
    expect(rows[0]!.meanPerEvent).toBe('1.31')
    expect(rows[2]!.meanPerEvent).toBe('2.15')
    expect(rows[0]!.nReference).toBe('6,233')
  })

  it('adds the typed-Sharpe and event columns only when they were typed', () => {
    expect(designColumns(PLAN_EXAMPLE)).toEqual(['test', 'alpha', 'z', 'mde', 'powerReference', 'powerTyped', 'nReference', 'nTyped', 'meanPerEvent'])
    const bare = { ...PLAN_EXAMPLE, typed_sharpe: null, event_sd: null }
    expect(designColumns(bare)).toEqual(['test', 'alpha', 'z', 'mde', 'powerReference', 'nReference'])
  })

  it('names the power target and the reference Sharpe in the headers', () => {
    const headers = designHeaders()
    expect(headers.mde).toBe('Minimum detectable Sharpe, power 0.80')
    expect(headers.powerReference).toBe('Power at Sharpe 0.50')
    expect(headers.nReference).toBe('n for power 0.80 at 0.50')
  })

  it('says not reachable for a count that does not exist, and -- for a missing figure', () => {
    const point = { ...PLAN_EXAMPLE.nominal, observations_for_typed: null, power_at_typed: null, mean_per_event: null }
    const rows = designRows({ ...PLAN_EXAMPLE, nominal: point })
    expect([rows[0]!.nTyped, rows[0]!.powerTyped, rows[0]!.meanPerEvent]).toEqual(['not reachable', '--', '--'])
  })
})

describe('the planner copy', () => {
  it('has no em or en dash and no US spelling', () => {
    expect(findCopyViolations(PLAN)).toEqual([])
  })

  it('says best case, normal, independent and one sided, and never 365', () => {
    const served = PLAN_EXAMPLE.note.toLowerCase()
    expect(served).toContain('best case')
    expect(served).toContain('normal and independent')
    expect(served).toContain('one-sided')
    expect(JSON.stringify(PLAN)).not.toContain('365')
  })
})
