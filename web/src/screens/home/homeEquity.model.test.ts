import { describe, expect, it } from 'vitest'
import { HOME_EQ } from '../../copy/home'
import { formatKpi } from '../../tiles/KpiTile'
import { PANEL_A, PANEL_B, PANEL_USD } from './homeEquity.fixtures'
import { drawdownUnit, homeNotes, homeStack, homeTarget, homeTiles } from './homeEquity.model'

const face = (t: ReturnType<typeof homeTiles>[number]) => formatKpi(t.kpi.value, t.kpi.unit, t.decimals, t.signed)

describe('homeTarget: which panel endpoint a link-group context reads', () => {
  it('reads the hypothesis panel for a hypothesis and the run panel for a run', () => {
    expect(homeTarget({ kind: 'hypothesis', value: 'volmanaged_v0' })).toEqual({ kind: 'hypothesis', name: 'volmanaged_v0' })
    expect(homeTarget({ kind: 'run', value: 'nt_x' })).toEqual({ kind: 'run', name: 'nt_x' })
  })

  it('reads nothing for no context, an instrument or the universe', () => {
    expect(homeTarget(null)).toBeNull()
    expect(homeTarget({ kind: 'instrument', value: 'NQ' })).toBeNull()
    expect(homeTarget({ kind: 'universe', value: '27F' })).toBeNull()
    expect(homeTarget({ kind: 'hypothesis', value: '  ' })).toBeNull()
  })
})

describe('homeTiles: every figure equals the API value to its displayed precision, with basis and unit', () => {
  it('Basis A on capital: Sharpe and benchmark Sharpe as ratios, max drawdowns as percent of K', () => {
    const tiles = homeTiles(PANEL_A)
    expect(tiles.map((t) => t.kpi.label)).toEqual([
      HOME_EQ.tiles.sharpe, HOME_EQ.tiles.benchSharpe, HOME_EQ.tiles.maxDd, HOME_EQ.tiles.benchMaxDd, 'Alpha', 'Alpha t',
      HOME_EQ.tiles.sessions,
    ])
    expect(tiles.map(face)).toEqual(['-3.72', '-3.67', '-9.5%', '-9.4%', '+3.47%', '1.18', '4'])
    expect(tiles[0]!.kpi.value).toBe(PANEL_A.sharpe)
    expect(tiles[2]!.kpi.value).toBeCloseTo(PANEL_A.max_drawdown! * 100, 12)
    for (const t of tiles) {
      expect(t.kpi.basis).toBe('A')
      expect(t.kpi.tag).toBe(t.kpi.key.startsWith('alpha') ? '[PRE-REG]' : '[POST HOC]')
      expect(t.description.length).toBeGreaterThan(0)
    }
    expect(tiles[2]!.description).toContain('fraction of K below the running peak')
    expect(tiles[0]!.description).toContain('252')
  })

  it('one-contract series: drawdown in the series currency, never a percent', () => {
    const tiles = homeTiles(PANEL_USD)
    expect(tiles.map(face)).toEqual(['0.66', '0.54', '-134.48', '-50,240.00', '--', '--', '4'])
    expect(tiles[2]!.kpi.unit).toBe('USD, one NQ contract')
    expect(tiles[2]!.kpi.unit).not.toBe('%')
    expect(tiles[2]!.description).toContain('cumulative sum, USD per session, one NQ contract')
  })

  it('a run without a benchmark keeps the benchmark tiles, empty, with the reason in the note', () => {
    const tiles = homeTiles(PANEL_B)
    expect(tiles.map(face)).toEqual(['1.23', '--', '-0.4%', '--', '--', '--', '4'])
    expect(tiles[1]!.kpi.note).toBe(HOME_EQ.describe.benchSharpeNone)
    expect(tiles[3]!.kpi.note).toBe(HOME_EQ.describe.benchSharpeNone)
    for (const t of tiles) expect(t.kpi.basis).toBe('B')
  })
})

describe('homeStack: equity, underwater and rolling Sharpe panes on one time axis', () => {
  it('passes the API arrays through unchanged where no unit change is needed', () => {
    const stack = homeStack(PANEL_A)
    expect(stack.t).toBe(PANEL_A.t)
    const [eq, uw, roll] = stack.panes
    expect(eq!.series.map((s) => [s.style, s.values])).toEqual([['primary', PANEL_A.equity], ['benchmark', PANEL_A.bench_equity]])
    expect(eq!.series[0]!.values).toBe(PANEL_A.equity)
    expect(roll!.series[0]!.values).toBe(PANEL_A.rolling_sharpe)
    expect(roll!.series[0]!.style).toBe('rollLong')
    expect(roll!.zero).toBe('grey')
    expect(uw!.series[0]!.style).toBe('underwater')
    expect(eq!.zero).not.toBe('grey')
  })

  it('shows a fraction of K as percent: underwater values times 100 with a % unit', () => {
    const uw = homeStack(PANEL_A).panes[1]!
    expect(uw.unit).toBe('%')
    expect(uw.series[0]!.values.at(-1)).toBeCloseTo(-1.95, 12)
    expect(uw.series[1]!.values.at(-1)).toBeCloseTo(-1.899999, 12)
  })

  it('keeps USD drawdowns in USD, with no percent unit', () => {
    const uw = homeStack(PANEL_USD).panes[1]!
    expect(uw.unit).toBe('')
    expect(uw.series[0]!.values).toBe(PANEL_USD.underwater)
    expect(uw.decimals).toBe(2)
  })

  it("names the API's max drawdown and basis in the equity pane's accessible name, in the drawdown unit", () => {
    expect(homeStack(PANEL_A).panes[0]!.summaryDrawdown).toEqual({ value: '-9.49%', basis: 'Basis A' })
    expect(homeStack(PANEL_USD).panes[0]!.summaryDrawdown).toEqual({ value: '-134.48 USD', basis: `Basis ${PANEL_USD.basis}` })
    expect(homeStack(PANEL_B).panes[0]!.summaryDrawdown).toEqual({ value: '-0.40%', basis: 'Basis B' })
    expect(homeStack(PANEL_A).panes[1]!.summaryDrawdown).toBeUndefined()
    expect(homeStack(PANEL_A).panes[2]!.summaryDrawdown).toBeUndefined()
  })

  it('draws no benchmark series when the context has none', () => {
    const stack = homeStack(PANEL_B)
    expect(stack.panes[0]!.series.map((s) => s.style)).toEqual(['primary'])
    expect(stack.panes[1]!.series.map((s) => s.style)).toEqual(['underwater'])
  })

  it('offers the log scale only on a positive equity (a multiple of K or an account in USD)', () => {
    expect(homeStack(PANEL_A).panes[0]!.logAllowed).toBe(true)
    expect(homeStack(PANEL_B).panes[0]!.logAllowed).toBe(true)
    expect(homeStack(PANEL_USD).panes[0]!.logAllowed).toBe(false)
  })

  it('names each series and titles the stack after the context', () => {
    const stack = homeStack(PANEL_A)
    expect(stack.title).toContain('volmanaged_v0')
    expect(stack.panes[2]!.series[0]!.name).toBe('Rolling 252-session Sharpe')
  })
})

describe('homeNotes and drawdownUnit: the basis, the window and the benchmark in words', () => {
  it('states basis, unit, window and benchmark', () => {
    const notes = homeNotes(PANEL_A)
    expect(notes).toContain('Basis A, screen (arithmetic on a fixed K). Unit: return on capital per session.')
    expect(notes).toContain('4 sessions from 2011-04-25 to 2011-04-28.')
    expect(notes).toContain('Benchmark: same-exposure buy and hold (r_bh_1).')
  })

  it('says why the rolling pane is empty, and only when it is', () => {
    expect(homeNotes(PANEL_A).some((n) => n.includes('needs 252 sessions'))).toBe(true)
    expect(homeNotes(PANEL_USD).some((n) => n.includes('needs'))).toBe(false)
  })

  it('names dropped sessions and a missing benchmark', () => {
    const notes = homeNotes(PANEL_B)
    expect(notes).toContain(HOME_EQ.noBench)
    expect(notes).toContain('Dropped: 2011-04-27 (gate rejected).')
  })

  it('reads the drawdown unit from the API for each basis', () => {
    expect(drawdownUnit(PANEL_A)).toBe('fraction of K below the running peak')
    expect(drawdownUnit(PANEL_B)).toBe('fraction below the running peak, compounded')
    expect(drawdownUnit(PANEL_USD)).toBe('below the running peak of the cumulative sum, USD per session, one NQ contract')
  })

  it('born failing: a changed API drawdown unit is shown as served, never a front-end copy', () => {
    expect(drawdownUnit({ ...PANEL_A, drawdown_unit: 'a new unit the backend names' })).toBe('a new unit the backend names')
  })
})

describe('homeTiles: the Sharpe unit and the alpha tiles come from the API', () => {
  it('names the Sharpe tiles in the API ratio unit: short on the face, in full in the description', () => {
    const tiles = homeTiles(PANEL_A)
    expect(tiles[0]!.kpi.unit).toBe('ratio')
    expect(tiles[0]!.description).toContain(PANEL_A.rolling_unit_label)
    expect(tiles[1]!.description).toContain(PANEL_A.rolling_unit_label)
  })

  it('adds the tear sheet alpha tiles with their API tag, basis and value', () => {
    const tiles = homeTiles(PANEL_A)
    const alpha = tiles.filter((t) => t.kpi.key.startsWith('alpha'))
    expect(alpha.map((t) => t.kpi.key)).toEqual(['alpha_annual', 'alpha_t'])
    expect(alpha.map(face)).toEqual(['+3.47%', '1.18'])
    expect(alpha[0]!.kpi.value).toBe(PANEL_A.alpha[0]!.value)
    for (const [i, t] of alpha.entries()) {
      expect(t.kpi.tag).toBe(PANEL_A.alpha[i]!.tag)
      expect(t.kpi.basis).toBe(PANEL_A.alpha[i]!.basis)
      expect(t.kpi.note).toBe(PANEL_A.alpha[i]!.note)
      expect(t.description).toContain(PANEL_A.alpha[i]!.unit)
    }
  })

  it('keeps empty alpha tiles, with the API reason, for a series without a benchmark', () => {
    const alpha = homeTiles(PANEL_B).filter((t) => t.kpi.key.startsWith('alpha'))
    expect(alpha.map(face)).toEqual(['--', '--'])
    expect(alpha[0]!.kpi.note).toBe('no benchmark for this series')
  })
})

// A backend started before the Phase 6 and 7 merge serves HomePanel without the merge's fields; the
// panel still shows its own figures (the terminal keeps running across a front-end rebuild).
describe('HOME against a backend without the merge fields', () => {
  const older = (p: typeof PANEL_A) => {
    const { alpha: _a, drawdown_unit: _d, rolling_unit_label: _r, ...rest } = p
    return rest as unknown as typeof PANEL_A
  }

  it('keeps the five figures and the tear sheet drawdown wording', () => {
    const tiles = homeTiles(older(PANEL_A))
    expect(tiles.map(face)).toEqual(['-3.72', '-3.67', '-9.5%', '-9.4%', '4'])
    expect(drawdownUnit(older(PANEL_A))).toBe('fraction of K below the running peak')
    expect(drawdownUnit(older(PANEL_B))).toBe('fraction below the running peak, compounded')
    expect(drawdownUnit(older(PANEL_USD))).toBe('below the running peak of the cumulative sum, USD per session, one NQ contract')
  })
})
