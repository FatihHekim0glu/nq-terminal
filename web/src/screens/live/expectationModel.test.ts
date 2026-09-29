// pathOnCone is pinned by qa/crosscheck/p12_expectation.py: every case of qa/golden/p12_expectation.json (numpy,
// searchsorted side='right') must come out of the TypeScript port within 1e-12 relative, and the bands, the
// first index and the beyond count exactly.
import { describe, expect, it } from 'vitest'
import golden from '../../../../qa/golden/p12_expectation.json?raw'
import type { Schemas } from '../../api/types'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import {
  CONE_BANDS,
  PAPER_BOOKS,
  capitalRun,
  coneBand,
  expectationGate,
  expectationView,
  paperBookHypothesis,
  pathOnCone,
  type ConeBandName,
  type ExpectationInput,
  type PathOnConeInput,
} from './expectationModel'
import { TRACKING_POPULATED } from './trackingFixtures'

interface GoldenCase {
  readonly name: string
  readonly input: { usd: Array<number | null>; capital: number; quantiles: PathOnConeInput['quantiles']; horizon: number }
  readonly expected: { first_index: number | null; fraction: Array<number | null>; bands: Array<ConeBandName | null>; beyond: number }
}

const GOLDEN = JSON.parse(golden) as { source: string; cases: GoldenCase[] }
const CASES = GOLDEN.cases
const caseNamed = (name: string) => CASES.find((c) => c.name === name)!

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b))

const KEYS = ['5', '25', '50', '75', '95'] as const
const level = (value: number, steps: number): number[] => Array<number>(steps).fill(value)
const flat = (steps: number): PathOnConeInput['quantiles'] => ({
  '5': level(-0.1, steps), '25': level(-0.02, steps), '50': level(0, steps), '75': level(0.03, steps), '95': level(0.05, steps),
})
const place = (usd: Array<number | null>, steps: number, capital = 1000, quantiles = flat(steps)) =>
  pathOnCone({ usd, capital, quantiles, horizon: steps })

describe('pathOnCone against the numpy reference (LV6, [POST HOC])', () => {
  it('reads the golden cases the reference wrote', () => {
    expect(GOLDEN.source).toContain('searchsorted')
    expect(CASES.length).toBeGreaterThanOrEqual(7)
    for (const wanted of ['fixture paper', 'fixture model', 'tie on p25 and p95', 'gap', 'long path', 'missing quantile', 'below p5']) {
      expect(CASES.some((c) => c.name.includes(wanted)), wanted).toBe(true)
    }
  })

  it.each(CASES.map((c) => [c.name, c] as const))('matches the reference on %s', (_name, c) => {
    const got = pathOnCone({ usd: c.input.usd, capital: c.input.capital, quantiles: c.input.quantiles, horizon: c.input.horizon })
    expect(got.firstIndex).toBe(c.expected.first_index)
    expect(got.bands).toEqual(c.expected.bands)
    expect(got.beyond).toBe(c.expected.beyond)
    expect(got.fraction).toHaveLength(c.expected.fraction.length)
    got.fraction.forEach((v, i) => {
      const want = c.expected.fraction[i]!
      if (want === null) expect(v, `fraction[${i}]`).toBeNull()
      else expect(close(v!, want), `fraction[${i}] ${v} vs ${want}`).toBe(true)
    })
  })

  it('copies the web fixtures into the fixture cases, so a changed fixture cannot drift from the reference', () => {
    const paper = caseNamed('fixture paper').input
    const model = caseNamed('fixture model').input
    expect(paper.usd).toEqual(TRACKING_POPULATED.paper_cumulative)
    expect(model.usd).toEqual(TRACKING_POPULATED.model_cumulative)
    expect(paper.capital).toBe(RUN_ANALYTICS.capital)
    for (const key of KEYS) {
      expect(paper.quantiles[key]).toEqual(HYP_BOOTSTRAP.cone.quantiles[key]!.slice(0, paper.horizon))
    }
  })

  it('places the fixture paper and model paths at their first two steps in the p50 to p75 band', () => {
    const paper = caseNamed('fixture paper').input
    const got = pathOnCone({ usd: paper.usd, capital: paper.capital, quantiles: paper.quantiles, horizon: paper.horizon })
    expect(got.firstIndex).toBe(3)
    expect(got.fraction).toEqual([12 / 1_000_000, 6 / 1_000_000, null, null, null])
    expect(got.bands).toEqual(['p50to75', 'p50to75', null, null, null])
  })
})

describe('pathOnCone on its own edge cases (the same rules as the reference)', () => {
  it('puts step k at index first + k - 1 and leaves the steps the path has not reached empty', () => {
    const got = place([null, null, 250, -500, 125], 4)
    expect(got.firstIndex).toBe(2)
    expect(got.fraction).toEqual([0.25, -0.5, 0.125, null])
    expect(got.beyond).toBe(0)
  })

  it('puts a value exactly on a percentile in the band above it', () => {
    expect(place([-20, 50], 2).bands).toEqual(['p25to50', 'above95'])
    expect(place([-100, -20, 0, 30, 50], 5).bands).toEqual(['p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('names the tails', () => {
    expect(place([-101, 51, -99], 3).bands).toEqual(['below5', 'above95', 'p5to25'])
  })

  it('gives a gap no fraction and no band, and counts only rows with a value past the horizon', () => {
    const gap = place([null, 10, null, 30, 40], 4)
    expect(gap.fraction).toEqual([0.01, null, 0.03, 0.04])
    expect(gap.bands).toEqual(['p50to75', null, 'p75to95', 'p75to95'])
    expect(place([null, 5, 10, 15, 20, null, 30], 3).beyond).toBe(2)
  })

  it('treats a non-finite value as a gap', () => {
    expect(place([10, Number.NaN, Number.POSITIVE_INFINITY], 3).fraction).toEqual([0.01, null, null])
  })

  it('leaves a step unplaced when a percentile is missing there, short, or the percentiles cross', () => {
    const q = flat(3)
    const missing = { ...q, '50': [0, null, 0], '95': [0.05, 0.05] }
    const got = pathOnCone({ usd: [10, 10, 10], capital: 1000, quantiles: missing, horizon: 3 })
    expect(got.fraction).toEqual([0.01, 0.01, 0.01])
    expect(got.bands).toEqual(['p50to75', null, null])
    const crossing = { ...flat(2), '25': [-0.02, 0.06] }
    expect(pathOnCone({ usd: [10, 10], capital: 1000, quantiles: crossing, horizon: 2 }).bands).toEqual(['p50to75', null])
  })

  it('tolerates a percentile line that is absent altogether', () => {
    const { '75': _dropped, ...rest } = flat(2)
    const got = pathOnCone({ usd: [10, 10], capital: 1000, quantiles: rest as PathOnConeInput['quantiles'], horizon: 2 })
    expect(got.bands).toEqual([null, null])
  })

  it('has no first index and nothing placed for a path with no value, and copes with a zero horizon', () => {
    expect(place([null, null], 3)).toEqual({ firstIndex: null, fraction: [null, null, null], bands: [null, null, null], beyond: 0 })
    expect(place([], 0)).toEqual({ firstIndex: null, fraction: [], bands: [], beyond: 0 })
    expect(place([5], 0)).toEqual({ firstIndex: 0, fraction: [], bands: [], beyond: 1 })
  })

  it.each([0, -1, -1_000_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('throws on a capital of %s', (capital) => {
    expect(() => place([1], 1, capital)).toThrow(/capital/)
  })

  it.each([-1, 1.5, Number.NaN])('throws on a horizon of %s', (horizon) => {
    expect(() => pathOnCone({ usd: [1], capital: 1000, quantiles: flat(1), horizon })).toThrow(/horizon/)
  })

  it('does not change what it is given', () => {
    const usd = [null, 10]
    const quantiles = flat(1)
    const before = JSON.stringify({ usd, quantiles })
    pathOnCone({ usd, capital: 1000, quantiles, horizon: 1 })
    expect(JSON.stringify({ usd, quantiles })).toBe(before)
  })
})

describe('coneBand', () => {
  const q = [-0.1, -0.02, 0, 0.03, 0.05] as const

  it('lists the bands in placement order', () => {
    expect(CONE_BANDS).toEqual(['below5', 'p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('is the count of percentiles at or below the value, named', () => {
    expect(coneBand(-0.2, q)).toBe('below5')
    expect(coneBand(-0.05, q)).toBe('p5to25')
    expect(coneBand(-0.01, q)).toBe('p25to50')
    expect(coneBand(0.01, q)).toBe('p50to75')
    expect(coneBand(0.04, q)).toBe('p75to95')
    expect(coneBand(0.06, q)).toBe('above95')
  })

  it('puts a tie on any percentile in the band above it', () => {
    expect(q.map((p) => coneBand(p, q))).toEqual(['p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'])
  })

  it('handles percentiles that coincide', () => {
    expect(coneBand(0, [-1, 0, 0, 0, 1])).toBe('p75to95')
    expect(coneBand(-1, [-1, -1, -1, -1, -1])).toBe('above95')
  })

  it('gives null for a value or a percentile that is not a finite number, or percentiles that are not ascending', () => {
    expect(coneBand(Number.NaN, q)).toBeNull()
    expect(coneBand(Number.POSITIVE_INFINITY, q)).toBeNull()
    expect(coneBand(0, [-0.1, Number.NaN, 0, 0.03, 0.05])).toBeNull()
    expect(coneBand(0, [-0.1, 0.02, 0, 0.03, 0.05])).toBeNull()
  })
})

describe('the paper book to hypothesis mapping', () => {
  it('names volmanaged_v0 for the volmanaged paper journal, with or without its extension', () => {
    expect(PAPER_BOOKS).toHaveLength(1)
    expect(paperBookHypothesis('volmanaged_paper_journal.jsonl')).toBe('volmanaged_v0')
    expect(paperBookHypothesis('volmanaged_paper_journal')).toBe('volmanaged_v0')
    expect(paperBookHypothesis(TRACKING_POPULATED.journal)).toBe('volmanaged_v0')
  })

  it('matches the journal name only from its start and up to a word boundary', () => {
    expect(paperBookHypothesis('volmanaged_paper_journal_v2.jsonl')).toBeNull()
    expect(paperBookHypothesis('old_volmanaged_paper_journal.jsonl')).toBeNull()
    expect(paperBookHypothesis('other_paper_journal.jsonl')).toBeNull()
  })

  it('gives null for an absent or empty journal name', () => {
    expect(paperBookHypothesis(null)).toBeNull()
    expect(paperBookHypothesis(undefined)).toBeNull()
    expect(paperBookHypothesis('')).toBeNull()
  })
})

describe('capitalRun (the run whose served capital is K)', () => {
  type Card = Pick<Schemas['HypothesisCard'], 'nautilus_runs'>
  type Run = Pick<Schemas['RunSummary'], 'run_id' | 'balance_ok' | 'is_probe'> & { readable?: boolean }
  const card = (...ids: string[]): Card => ({ nautilus_runs: ids })
  const run = (run_id: string, extra: Partial<Run> = {}): Run => ({ run_id, balance_ok: true, is_probe: false, ...extra })

  it('takes the first listed run while the runs are still loading', () => {
    expect(capitalRun(card('a', 'b'), undefined)).toBe('a')
  })

  it('takes the first listed run that is not a probe and does not fail its balance check', () => {
    const runs = [run('a', { is_probe: true }), run('b', { balance_ok: false }), run('c'), run('d')]
    expect(capitalRun(card('a', 'b', 'c', 'd'), runs)).toBe('c')
  })

  it('follows the order of the card, not the order of the run list', () => {
    expect(capitalRun(card('b', 'a'), [run('a'), run('b')])).toBe('b')
  })

  it('accepts a run whose balance check has no answer', () => {
    expect(capitalRun(card('a'), [run('a', { balance_ok: null })])).toBe('a')
  })

  it('skips a run that cannot be read and a run the list does not know', () => {
    expect(capitalRun(card('a', 'ghost', 'c'), [run('a', { readable: false }), run('c')])).toBe('c')
  })

  it('gives null when no listed run is usable, when the card lists none, or when the list is empty', () => {
    expect(capitalRun(card('a'), [run('a', { is_probe: true })])).toBeNull()
    expect(capitalRun(card(), [run('a')])).toBeNull()
    expect(capitalRun(card(), undefined)).toBeNull()
    expect(capitalRun(card('a'), [])).toBeNull()
  })
})

// ---------------------------------------------------------------- the LIVE card (LV6, [POST HOC])

const RUN = 'nt_volmanaged_v0_fixture_m1'
const K = 1_000_000

const INPUT: ExpectationInput = {
  tracking: TRACKING_POPULATED,
  boot: HYP_BOOTSTRAP,
  capital: K,
  runId: RUN,
  hypothesis: 'volmanaged_v0',
  cost: 1,
}

type Tracking = Schemas['PaperTracking']
type Boot = Schemas['BootstrapView']

/** The fixture tracking with its two cumulative paths (and the dates) replaced. */
function tracked(paper: Array<number | null>, model: Array<number | null>, extra: Partial<Tracking> = {}): Tracking {
  const dates = paper.map((_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)
  return { ...TRACKING_POPULATED, paper_cumulative: paper, model_cumulative: model, date: dates, t: paper.map((_, i) => 1_790_000_000 + i * 86_400), ...extra }
}

const okOf = (input: ExpectationInput) => {
  const view = expectationView(input)
  if (view.kind !== 'ok') throw new Error(`expected an ok view, got: ${view.text}`)
  return view
}
const refusedOf = (input: ExpectationInput): string => {
  const view = expectationView(input)
  if (view.kind !== 'refused') throw new Error('expected a refusal')
  return view.text
}
const overlay = (input: ExpectationInput, id: string) => okOf(input).cone.overlays!.find((o) => o.id === id)!

describe('expectationView: the ok view on the fixtures (TRACKING_POPULATED, HYP_BOOTSTRAP, K 1,000,000)', () => {
  it('is the SV6 cone of the hypothesis with the realised line blanked, tagged [POST HOC]', () => {
    const view = okOf(INPUT)
    expect(view.tag).toBe('[POST HOC]')
    const c = HYP_BOOTSTRAP.cone
    expect(view.cone.name).toBe(fillCopy(EXPECTATION.coneName, { hypothesis: 'volmanaged_v0' }))
    expect(view.cone.label).toBe(c.label)
    expect(view.cone.unit).toBe('%')
    expect(view.cone.steps).toEqual(c.steps)
    expect(view.cone.bands.map((b) => b.p)).toEqual([5, 25, 50, 75, 95])
    expect(view.cone.bands[0]!.values[0]).toBeCloseTo(c.quantiles['5']![0]! * 100, 12)
    expect(view.cone.realised).toHaveLength(c.steps.length)
    expect(view.cone.realised.every((v) => v === null)).toBe(true)
    expect(view.cone.realisedDates).toEqual([])
  })

  it('lays Paper and Model over the cone as percent of K, finite at steps 1 and 2 only', () => {
    const view = okOf(INPUT)
    const [paper, model] = view.cone.overlays!
    expect(view.cone.overlays!.map((o) => o.id)).toEqual(['paper', 'model'])
    expect([paper!.label, model!.label]).toEqual([EXPECTATION.paper, EXPECTATION.model])
    expect([paper!.tone, model!.tone]).toEqual(['accent2', 'cyanChart'])
    const steps = HYP_BOOTSTRAP.cone.steps.length
    expect(paper!.values).toHaveLength(steps)
    expect(model!.values).toHaveLength(steps)
    expect(paper!.values.slice(0, 2)).toEqual([(12 / K) * 100, (6 / K) * 100])
    expect(model!.values.slice(0, 2)).toEqual([(12 / K) * 100, (7 / K) * 100])
    expect(paper!.values.slice(2).every((v) => v === null)).toBe(true)
    expect(model!.values.slice(2).every((v) => v === null)).toBe(true)
  })

  it('agrees with pathOnCone on the raw fraction, scaled by 100 like the cone', () => {
    const c = HYP_BOOTSTRAP.cone
    const placed = pathOnCone({
      usd: TRACKING_POPULATED.paper_cumulative,
      capital: K,
      quantiles: { '5': c.quantiles['5']!, '25': c.quantiles['25']!, '50': c.quantiles['50']!, '75': c.quantiles['75']!, '95': c.quantiles['95']! },
      horizon: c.steps.length,
    })
    expect(overlay(INPUT, 'paper').values).toEqual(placed.fraction.map((v) => (v === null ? null : v * 100)))
  })

  it('names K and its source run, the anchor, the before-costs note, the latest placement and SV6 verbatim', () => {
    const lines = okOf(INPUT).lines
    expect(lines).toEqual([
      "K = 1,000,000 USD: the starting capital of nt_volmanaged_v0_fixture_m1, the linked Nautilus reproduction of volmanaged_v0 (the spec's K).",
      'Paper and model cumulative P&L as a fraction of K, counted from the first paper session (2026-12-08), on the SV6 cone of volmanaged_v0 at 1 tick per side.',
      "Paper P&L is contracts held times the change of each contract's close, before costs; the cone is the backtest net of 1 tick per side.",
      'Session 2 (2026-12-09): paper +0.0006% (between the 50th and 75th); model +0.0007% (between the 50th and 75th). Pointwise placement by the terminal, [POST HOC].',
      HYP_BOOTSTRAP.cone.label,
    ])
  })

  it('takes K from the argument, not from a constant', () => {
    const lines = okOf({ ...INPUT, capital: 500_000 }).lines
    expect(lines[0]).toContain('K = 500,000 USD')
    expect(overlay({ ...INPUT, capital: 500_000 }, 'paper').values[0]).toBe((12 / 500_000) * 100)
  })

  it('words a cost other than one tick in the plural, and keeps a fractional cost as given', () => {
    expect(okOf({ ...INPUT, cost: 2 }).lines[1]).toContain('at 2 ticks per side')
    expect(okOf({ ...INPUT, cost: 0.5 }).lines[2]).toContain('net of 0.5 ticks per side')
  })

  it('does not change what it is given', () => {
    const before = JSON.stringify(INPUT)
    okOf(INPUT)
    expect(JSON.stringify(INPUT)).toBe(before)
  })
})

describe('expectationView: the latest placement, the tails and what lies beyond the horizon', () => {
  const horizon = HYP_BOOTSTRAP.cone.steps.length

  it('uses the last step that has a value and the date of that session', () => {
    const paper = [null, 10, 20, null, 30, null]
    const view = okOf({ ...INPUT, tracking: tracked(paper, paper) })
    expect(view.lines[1]).toContain('(2026-11-02)')
    expect(view.lines[3]).toMatch(/^Session 4 \(2026-11-05\): paper \+0\.0030% /)
    expect(overlay({ ...INPUT, tracking: tracked(paper, paper) }, 'paper').values.slice(0, 5)).toEqual([(10 / K) * 100, (20 / K) * 100, null, (30 / K) * 100, null])
  })

  it('names a value below the 5th percentile and above the 95th in words', () => {
    const low = okOf({ ...INPUT, tracking: tracked([-400_000], [400_000]) })
    expect(low.lines[3]).toContain(`paper -40.0000% (${EXPECTATION.bands.below5}); model +40.0000% (${EXPECTATION.bands.above95})`)
  })

  it('says a path past the horizon is not drawn, in the singular and the plural', () => {
    const long = Array.from({ length: horizon + 6 }, (_, i) => (i + 1) * 10)
    const six = okOf({ ...INPUT, tracking: tracked(long, long) })
    expect(six.lines).toHaveLength(6)
    expect(six.lines[4]).toBe(fillCopy(EXPECTATION.beyond, { n: 6, horizon }))
    expect(six.lines[5]).toBe(HYP_BOOTSTRAP.cone.label)
    const one = okOf({ ...INPUT, tracking: tracked(long.slice(0, horizon + 1), long.slice(0, horizon + 1)) })
    expect(one.lines[4]).toBe(fillCopy(EXPECTATION.beyondOne, { horizon }))
    expect(overlay({ ...INPUT, tracking: tracked(long, long) }, 'paper').values).toHaveLength(horizon)
  })

  it('has no beyond line when the path is inside the horizon', () => {
    expect(okOf(INPUT).lines.some((l) => l.includes('past the cone'))).toBe(false)
  })

  it('places the model alone when the paper path has no value, counted from the model own first session', () => {
    const view = okOf({ ...INPUT, tracking: tracked([null, null, null], [null, 5, 8]) })
    expect(view.lines[1]).toContain('(2026-11-02)')
    expect(view.lines[3]).toContain(`paper -- (${EXPECTATION.unplaced})`)
    expect(view.lines[3]).toContain('model +0.0008%')
  })

  it('leaves a step without a band when the cone has no percentiles there', () => {
    const cut: Boot = { ...HYP_BOOTSTRAP, cone: { ...HYP_BOOTSTRAP.cone, quantiles: { ...HYP_BOOTSTRAP.cone.quantiles, '50': HYP_BOOTSTRAP.cone.quantiles['50']!.map(() => null) } } }
    const view = okOf({ ...INPUT, boot: cut })
    expect(view.lines[3]).toContain(`paper +0.0006% (${EXPECTATION.unplaced})`)
    const { '50': _median, ...without } = HYP_BOOTSTRAP.cone.quantiles
    const absent = okOf({ ...INPUT, boot: { ...HYP_BOOTSTRAP, cone: { ...HYP_BOOTSTRAP.cone, quantiles: without } } })
    expect(absent.lines[3]).toContain(`paper +0.0006% (${EXPECTATION.unplaced})`)
  })
})

describe('expectationView: the refusals, each with its own words', () => {
  it('refuses a tracking that is absent, not present or holds no value', () => {
    expect(refusedOf({ ...INPUT, tracking: undefined })).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...INPUT, tracking: null })).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...INPUT, tracking: { ...TRACKING_POPULATED, present: false } })).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...INPUT, tracking: tracked([null, null], [null, null]) })).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...INPUT, tracking: tracked([], []) })).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...INPUT, tracking: tracked([Number.NaN], [Number.POSITIVE_INFINITY]) })).toBe(EXPECTATION.empty)
  })

  it('refuses without needing the cone when there is no value', () => {
    expect(refusedOf({ ...INPUT, tracking: undefined, boot: undefined })).toBe(EXPECTATION.empty)
  })

  it('refuses a journal no registered hypothesis owns, naming the journal', () => {
    expect(refusedOf({ ...INPUT, hypothesis: null })).toBe(fillCopy(EXPECTATION.noBook, { journal: TRACKING_POPULATED.journal }))
  })

  it('refuses a hypothesis that records no cost', () => {
    expect(refusedOf({ ...INPUT, cost: null })).toBe(fillCopy(EXPECTATION.noCost, { hypothesis: 'volmanaged_v0' }))
  })

  it('refuses when the hypothesis lists no usable run, with the noRun reason', () => {
    expect(refusedOf({ ...INPUT, runId: null, capital: null })).toBe(fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }))
    expect(refusedOf({ ...INPUT, runId: null })).toBe(fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }))
  })

  it.each([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a run that serves a capital of %s, naming the run', (capital) => {
    expect(refusedOf({ ...INPUT, capital })).toBe(fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: RUN }) }))
  })

  it('refuses a cone that is not a fraction of K', () => {
    const cone = { ...HYP_BOOTSTRAP.cone, unit: 'USD' }
    expect(refusedOf({ ...INPUT, boot: { ...HYP_BOOTSTRAP, cone } })).toBe(fillCopy(EXPECTATION.unitRefused, { unit: 'USD', how: 'summed' }))
  })

  it('refuses a cone whose paths are compounded, naming how they were made', () => {
    const cone = { ...HYP_BOOTSTRAP.cone, how: 'compounded' as const }
    expect(refusedOf({ ...INPUT, boot: { ...HYP_BOOTSTRAP, cone } })).toBe(fillCopy(EXPECTATION.unitRefused, { unit: 'fraction of K', how: 'compounded' }))
  })

  it('says the cone is still to come when every other check passes and there is no cone yet', () => {
    expect(refusedOf({ ...INPUT, boot: null })).toBe(EXPECTATION.loading)
  })

  it('checks the value before the book, the book before the cost, the cost before K, and K before the cone', () => {
    const none = { ...INPUT, tracking: undefined, hypothesis: null, cost: null, runId: null, capital: null, boot: { ...HYP_BOOTSTRAP, cone: { ...HYP_BOOTSTRAP.cone, unit: 'USD' } } }
    expect(refusedOf(none)).toBe(EXPECTATION.empty)
    expect(refusedOf({ ...none, tracking: TRACKING_POPULATED })).toBe(fillCopy(EXPECTATION.noBook, { journal: TRACKING_POPULATED.journal }))
    expect(refusedOf({ ...none, tracking: TRACKING_POPULATED, hypothesis: 'volmanaged_v0' })).toBe(fillCopy(EXPECTATION.noCost, { hypothesis: 'volmanaged_v0' }))
    expect(refusedOf({ ...none, tracking: TRACKING_POPULATED, hypothesis: 'volmanaged_v0', cost: 1 })).toBe(fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }))
    expect(refusedOf({ ...none, tracking: TRACKING_POPULATED, hypothesis: 'volmanaged_v0', cost: 1, runId: RUN, capital: K })).toContain('The cone is in USD')
  })
})

describe('expectationGate: the refusals that need no cone', () => {
  it('is null on the fixtures, and gives the same text expectationView would for each refusal it covers', () => {
    const { boot: _boot, ...rest } = INPUT
    expect(expectationGate(rest)).toBeNull()
    expect(expectationGate({ ...rest, tracking: undefined })).toBe(EXPECTATION.empty)
    expect(expectationGate({ ...rest, runId: null })).toBe(refusedOf({ ...INPUT, runId: null }))
    expect(expectationGate({ ...rest, capital: null })).toBe(refusedOf({ ...INPUT, capital: null }))
  })
})

describe('the words of the card', () => {
  const BANNED = /alarm|breach|verdict|\bpass|\bfail|violat|warn|outside|wrong|reject|stop/i

  it('holds no alarm, breach or verdict word in any string of the copy', () => {
    const strings: string[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(EXPECTATION)
    expect(strings.length).toBeGreaterThan(20)
    expect(strings.filter((s) => BANNED.test(s))).toEqual([])
  })

  it('holds none in the lines of an ok view, and no dash', () => {
    const lines = okOf(INPUT).lines.filter((l) => l !== HYP_BOOTSTRAP.cone.label)
    for (const line of lines) {
      expect(line).not.toMatch(BANNED)
      expect(line).not.toMatch(/[–—]/)
    }
  })

  it('names every band the placement can give', () => {
    expect(Object.keys(EXPECTATION.bands)).toEqual([...CONE_BANDS])
  })
})
