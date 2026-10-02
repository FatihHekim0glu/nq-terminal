// The LIVE card from the served view (GET /api/analytics/paper-expectation; LV6 and LV6b, [POST HOC]). The fixtures
// are views the fixture backend served (expectationFixtures.ts). The served placement must equal what the browser
// drew in its client phase: expectationReference.ts (the old pathOnCone, pinned to the numpy golden file) is run on
// the same tracking, cone and K, and every fraction, band, first index and beyond count must agree exactly.
import { describe, expect, it } from 'vitest'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import { PAPER_EXPECTATION, PAPER_EXPECTATION_LIVE, TRACKING_LIVE_BOOK } from './expectationFixtures'
import { CONE_STARTS, expectationView, refusalText, type ConeStart, type PaperExpectation, type ServedCone } from './expectationModel'
import { CONE_BANDS, pathOnCone, type PathOnConeInput } from './expectationReference'
import { TRACKING_POPULATED } from './trackingFixtures'

const K = 1_000_000
const RUN = 'nt_volmanaged_v0_fixture_m1'

const okOf = (served: PaperExpectation, start: ConeStart = 'backtest') => {
  const view = expectationView(served, start)
  if (view.kind !== 'ok') throw new Error(`expected an ok view, got: ${view.text}`)
  return view
}
const refusedOf = (served: PaperExpectation, start: ConeStart = 'backtest'): string => {
  const view = expectationView(served, start)
  if (view.kind !== 'refused') throw new Error('expected a refusal')
  return view.text
}
const quantilesOf = (cone: ServedCone['cone']): PathOnConeInput['quantiles'] => {
  const q = cone!.quantiles
  return { '5': q['5']!, '25': q['25']!, '50': q['50']!, '75': q['75']!, '95': q['95']! }
}
type Tracking = typeof TRACKING_POPULATED

/** The browser's client-phase placement of both paths on a served cone, for the mirror checks. */
function reference(tracking: Tracking, cone: ServedCone['cone']) {
  const horizon = cone!.steps.length
  const quantiles = quantilesOf(cone)
  return {
    paper: pathOnCone({ usd: tracking.paper_cumulative, capital: K, quantiles, horizon }),
    model: pathOnCone({ usd: tracking.model_cumulative, capital: K, quantiles, horizon }),
  }
}

describe('the served placement equals the browser placement it replaces (C8 exception closed)', () => {
  const cases: ReadonlyArray<readonly [string, PaperExpectation, Tracking, ConeStart]> = [
    ['fixture tracking, backtest start', PAPER_EXPECTATION, TRACKING_POPULATED, 'backtest'],
    ['40-session book, backtest start', PAPER_EXPECTATION_LIVE, TRACKING_LIVE_BOOK, 'backtest'],
    ['40-session book, live start', PAPER_EXPECTATION_LIVE, TRACKING_LIVE_BOOK, 'live'],
  ]

  it.each(cases)('%s: every fraction, band, first index and beyond count', (_name, served, tracking, start) => {
    const chosen = start === 'live' ? served.live! : served.backtest!
    const placed = chosen.placement!
    const want = reference(tracking, chosen.cone)
    for (const key of ['paper', 'model'] as const) {
      expect(placed[key].fraction, key).toEqual(want[key].fraction)
      expect(placed[key].bands, key).toEqual(want[key].bands)
      expect(placed[key].first_index, key).toBe(want[key].firstIndex)
      expect(placed[key].beyond, key).toBe(want[key].beyond)
    }
    expect(placed.beyond).toBe(Math.max(want.paper.beyond, want.model.beyond))
  })

  it('serves the backtest cone that the tear sheet bootstrap serves, at the run capital', () => {
    expect(PAPER_EXPECTATION.backtest!.cone).toEqual(HYP_BOOTSTRAP.cone)
    expect(PAPER_EXPECTATION.capital).toBe(RUN_ANALYTICS.capital)
    expect([PAPER_EXPECTATION.hypothesis, PAPER_EXPECTATION.cost, PAPER_EXPECTATION.run_id]).toEqual(['volmanaged_v0', 1, RUN])
  })

  it('names only bands the copy words', () => {
    expect(Object.keys(EXPECTATION.bands)).toEqual([...CONE_BANDS])
  })
})

describe('expectationView: the backtest-start cone', () => {
  it('is the SV6 cone with the realised line blanked and Paper and Model over it, tagged [POST HOC]', () => {
    const view = okOf(PAPER_EXPECTATION)
    const c = HYP_BOOTSTRAP.cone
    expect(view.tag).toBe('[POST HOC]')
    expect(view.cone.name).toBe(fillCopy(EXPECTATION.coneName, { hypothesis: 'volmanaged_v0' }))
    expect(view.cone.label).toBe(c.label)
    expect(view.cone.unit).toBe('%')
    expect(view.cone.steps).toEqual(c.steps)
    expect(view.cone.bands.map((b) => b.p)).toEqual([5, 25, 50, 75, 95])
    expect(view.cone.bands[0]!.values[0]).toBeCloseTo(c.quantiles['5']![0]! * 100, 12)
    expect(view.cone.realised.every((v) => v === null)).toBe(true)
    expect(view.cone.realisedDates).toEqual([])
    const [paper, model] = view.cone.overlays!
    expect([paper!.id, paper!.label, paper!.tone]).toEqual(['paper', EXPECTATION.paper, 'accent2'])
    expect([model!.id, model!.label, model!.tone]).toEqual(['model', EXPECTATION.model, 'cyanChart'])
    expect(paper!.values.slice(0, 3)).toEqual([(12 / K) * 100, (6 / K) * 100, null])
    expect(model!.values.slice(0, 3)).toEqual([(12 / K) * 100, (7 / K) * 100, null])
  })

  it('draws the same lines the browser drew in its client phase', () => {
    expect(okOf(PAPER_EXPECTATION).lines).toEqual([
      "K = 1,000,000 USD: the starting capital of nt_volmanaged_v0_fixture_m1, the linked Nautilus reproduction of volmanaged_v0 (the spec's K).",
      'Paper and model cumulative P&L as a fraction of K, counted from the first paper session (2026-12-08), on the SV6 cone of volmanaged_v0 at 1 tick per side.',
      "Paper P&L is contracts held times the change of each contract's close, before costs; the cone is the backtest net of 1 tick per side.",
      'Session 2 (2026-12-09): paper +0.0006% (between the 50th and 75th); model +0.0007% (between the 50th and 75th). Pointwise placement by the terminal, [POST HOC].',
      HYP_BOOTSTRAP.cone.label,
    ])
  })

  it('says how many later sessions lie past the horizon, singular and plural', () => {
    const long = PAPER_EXPECTATION_LIVE
    const horizon = HYP_BOOTSTRAP.cone.steps.length
    expect(long.backtest!.placement!.beyond).toBe(40 - horizon) // 40 paper sessions on a 39-step cone: one past it
    expect(okOf(long).lines).toContain(fillCopy(EXPECTATION.beyondOne, { horizon }))
    const six = { ...long, backtest: { ...long.backtest!, placement: { ...long.backtest!.placement!, beyond: 6 } } }
    expect(okOf(six).lines).toContain(fillCopy(EXPECTATION.beyond, { n: 6, horizon }))
    expect(okOf(PAPER_EXPECTATION).lines.some((l) => l.includes('past the cone'))).toBe(false)
  })

  it('words a cost other than one tick in the plural', () => {
    expect(okOf({ ...PAPER_EXPECTATION, cost: 2 }).lines[1]).toContain('at 2 ticks per side')
  })

  it('leaves the latest line out when no step has a value, and names an unplaced value', () => {
    const placed = PAPER_EXPECTATION.backtest!.placement!
    const none = { ...PAPER_EXPECTATION, backtest: { ...PAPER_EXPECTATION.backtest!, placement: { ...placed, latest_step: 0 } } }
    expect(okOf(none).lines.some((l) => l.startsWith('Session'))).toBe(false)
    const unbanded = { ...placed, paper: { ...placed.paper, bands: placed.paper.bands.map(() => null) } }
    const view = okOf({ ...PAPER_EXPECTATION, backtest: { ...PAPER_EXPECTATION.backtest!, placement: unbanded } })
    expect(view.lines[3]).toContain(`paper +0.0006% (${EXPECTATION.unplaced})`)
  })
})

describe('expectationView: the live-start cone', () => {
  it('is the cone resampled from the paper book, with both paths over it and its own anchor and basis lines', () => {
    const view = okOf(PAPER_EXPECTATION_LIVE, 'live')
    const live = PAPER_EXPECTATION_LIVE.live!
    expect(view.cone.name).toBe(EXPECTATION.liveConeName)
    expect(view.cone.steps).toEqual(live.cone!.steps)
    expect(view.cone.steps).toHaveLength(40)
    expect(view.lines[1]).toBe(fillCopy(EXPECTATION.liveAnchorLine, {
      date: TRACKING_LIVE_BOOK.date[2]!, n: 40, start: live.source_start!, end: live.source_end!,
      block: live.block!.toFixed(2), reps: '10,000', seed: 20260927,
    }))
    expect(view.lines[2]).toBe(EXPECTATION.liveCostNote)
    expect(view.lines.at(-1)).toBe(live.cone!.label)
    expect(view.switchable).toBe(true)
  })

  it('says the latest step sits near the median by construction, on the live-start cone only', () => {
    const live = okOf(PAPER_EXPECTATION_LIVE, 'live')
    const at = live.lines.findIndex((l) => l.startsWith('Session'))
    expect(at).toBeGreaterThan(-1)
    expect(live.lines[at + 1]).toBe(EXPECTATION.liveLatestNote)
    expect(okOf(PAPER_EXPECTATION_LIVE, 'backtest').lines).not.toContain(EXPECTATION.liveLatestNote)
  })

  it('leaves that note out when no step has a value', () => {
    const live = PAPER_EXPECTATION_LIVE.live!
    const none = { ...PAPER_EXPECTATION_LIVE, live: { ...live, placement: { ...live.placement!, latest_step: 0 } } }
    expect(okOf(none, 'live').lines).not.toContain(EXPECTATION.liveLatestNote)
  })

  it('refuses a short paper book in words, and still offers the toggle back to the backtest cone', () => {
    const view = expectationView(PAPER_EXPECTATION, 'live')
    expect(view).toEqual({ kind: 'refused', text: fillCopy(EXPECTATION.liveShort, { n: 2, min: 30 }), switchable: true })
  })
})

describe('the refusals, each with its own words', () => {
  const refused = (code: string, params: Record<string, string> = {}): PaperExpectation => ({
    ...PAPER_EXPECTATION, refusal: { code: code as never, params }, backtest: null, live: null,
  })

  it.each(CONE_STARTS)('a refusal of the whole view hides the toggle (%s)', (start) => {
    const view = expectationView(refused('empty'), start)
    expect(view).toEqual({ kind: 'refused', text: EXPECTATION.empty, switchable: false })
  })

  it('words each code with the values it names', () => {
    const journal = PAPER_EXPECTATION.journal
    const words = (code: string, params: Record<string, string> = {}) => refusalText({ code: code as never, params }, journal)
    expect(words('no_book')).toBe(fillCopy(EXPECTATION.noBook, { journal }))
    expect(words('no_cost', { hypothesis: 'volmanaged_v0' })).toBe(fillCopy(EXPECTATION.noCost, { hypothesis: 'volmanaged_v0' }))
    expect(words('no_run')).toBe(fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }))
    expect(words('no_capital', { run: RUN })).toBe(fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: RUN }) }))
    expect(words('unit', { unit: 'USD', how: 'summed' })).toBe(fillCopy(EXPECTATION.unitRefused, { unit: 'USD', how: 'summed' }))
    expect(words('no_bootstrap', { detail: 'too short' })).toBe(fillCopy(EXPECTATION.noBootstrap, { detail: 'too short' }))
    expect(words('live_flat', { n: '31' })).toBe(fillCopy(EXPECTATION.liveFlat, { n: 31 }))
    expect(words('no_cost')).toContain('--')
  })

  it('shows a refused backtest cone in words', () => {
    const cone = { ...PAPER_EXPECTATION.backtest!, refusal: { code: 'unit' as const, params: { unit: 'USD', how: 'summed' } }, placement: null }
    expect(refusedOf({ ...PAPER_EXPECTATION, backtest: cone })).toContain('The cone is in USD')
  })
})

describe('the words of the card', () => {
  const BANNED = /alarm|breach|verdict|\bpass|\bfail|violat|warn|outside|wrong|reject|stop/i

  it('holds no alarm, breach or verdict word in any string of the copy, and no dash', () => {
    const strings: string[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(EXPECTATION)
    expect(strings.length).toBeGreaterThan(30)
    expect(strings.filter((s) => BANNED.test(s))).toEqual([])
    expect(strings.filter((s) => /[\u2013\u2014]/.test(s))).toEqual([])
  })

  it.each(CONE_STARTS)('holds none in the lines of an ok view (%s)', (start) => {
    const view = okOf(PAPER_EXPECTATION_LIVE, start)
    const cone = (start === 'live' ? PAPER_EXPECTATION_LIVE.live : PAPER_EXPECTATION_LIVE.backtest)!.cone!
    for (const line of view.lines.filter((l) => l !== cone.label)) {
      expect(line).not.toMatch(BANNED)
      expect(line).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('does not change what it is given', () => {
    const before = JSON.stringify(PAPER_EXPECTATION_LIVE)
    okOf(PAPER_EXPECTATION_LIVE, 'live')
    okOf(PAPER_EXPECTATION_LIVE, 'backtest')
    expect(JSON.stringify(PAPER_EXPECTATION_LIVE)).toBe(before)
  })
})
