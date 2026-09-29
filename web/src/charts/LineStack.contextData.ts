// Seeded fixture for the context gallery /__gallery/LineStack.context (gallery builds only: nothing but
// *.gallery.tsx and tests imports this). It gives LineStack its three context layers on one curve:
// the five frozen RK5 stress windows, a volatility-tercile strip and the six deepest drawdown episodes
// of the curve as lanes, two of them open. Seeded, so the screenshots are stable; every date is in
// sample; not market data.
import { LINE_STACK, LINE_STACK_GALLERY as G } from '../copy/lineStack'
import { equityFixture, mulberry32 } from '../gallery/fixtures'
import { underwaterPercent } from './LineStack.galleryData'
import type { LaneEpisode, LineStackPane, RibbonSpec, RibbonState, StackSpan } from './LineStack.types'

const SESSIONS = 2500
const START = '2011-01-03'
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

/**
 * The five frozen RK5 windows, peak to trough, in the order the list serves them (deepest first).
 * Copied from HYP_EXTENDED.stress.rows in src/screens/tear/tearP1.fixtures.ts (the peak and trough
 * dates of each row), because a chart module does not import a screen. LineStack.contextData.test.ts
 * checks the copy against that fixture, so a change to the frozen list shows up there.
 */
const RK5_WINDOWS: ReadonlyArray<readonly [peak: string, trough: string]> = [
  ['2020-02-19', '2020-03-20'],
  ['2018-08-31', '2018-12-24'],
  ['2011-07-22', '2011-08-08'],
  ['2015-12-04', '2016-02-08'],
  ['2015-07-20', '2015-08-25'],
]

/** The served regimes need at least 252 earlier sessions to place a session in a tercile. */
export const REGIME_WARMUP = 252
/** A stretch with no state, to show that a gap draws nothing and breaks a run. */
const REGIME_GAP = [1400, 1410] as const
/** Each session moves to another state with this chance, so a run lasts about 45 sessions. */
const REGIME_SWITCH = 1 / 45

function seededRegimes(count: number, seed: number): (RibbonState | null)[] {
  const rand = mulberry32(seed)
  const states: readonly RibbonState[] = ['low', 'mid', 'high']
  let state = 1
  return Array.from({ length: count }, (_, i) => {
    if (rand() < REGIME_SWITCH) state = (state + 1 + Math.floor(rand() * 2)) % states.length
    if (i < REGIME_WARMUP || (i >= REGIME_GAP[0] && i < REGIME_GAP[1])) return null
    return states[state]!
  })
}

const LANES = 6
/** How many of the lanes are open: see seededEpisodes. */
const OPEN_LANES = 2

interface Fall {
  readonly peak: number
  readonly trough: number
  /** The first session back at the peak's level, or null while the curve has not got there. */
  readonly recovery: number | null
  readonly depth: number
}

/** Every fall from a running peak to its trough and on to the session that regained the peak, in time order. */
function falls(v: readonly number[]): Fall[] {
  const out: Fall[] = []
  let peak = 0
  let trough = 0
  const close = (recovery: number | null) => {
    if (trough > peak) out.push({ peak, trough, recovery, depth: v[trough]! / v[peak]! - 1 })
  }
  for (let i = 1; i < v.length; i += 1) {
    if (v[i]! >= v[peak]!) {
      close(i)
      peak = i
      trough = i
    } else if (trough === peak || v[i]! < v[trough]!) {
      trough = i
    }
  }
  close(null)
  return out
}

/**
 * The six deepest falls of the curve, the deepest first, ranked 1 to 6, so lane 1 is the underwater
 * pane's own low. A curve regains its peaks one after another, so at most the last fall is open; the
 * gallery shows both states, so the two that ended last are drawn open, ending at the last session
 * (the second is seeded: a served list has at most one).
 */
function seededEpisodes(t: readonly number[], v: readonly number[]): LaneEpisode[] {
  const deepest = falls(v).sort((a, b) => a.depth - b.depth).slice(0, LANES)
  const lastToEnd = [...deepest].sort((a, b) => (b.recovery ?? Infinity) - (a.recovery ?? Infinity))
  const open = new Set(lastToEnd.slice(0, OPEN_LANES))
  return deepest.map((f, i) => ({
    rank: i + 1,
    peak: t[f.peak]!,
    trough: t[f.trough]!,
    end: t[open.has(f) ? t.length - 1 : f.recovery!]!,
    open: open.has(f),
    depth: `${(f.depth * 100).toFixed(1)}%`,
  }))
}

export interface ContextStack {
  readonly t: number[]
  /** The equity, underwater and lanes panes, in that order. */
  readonly panes: LineStackPane[]
  readonly spans: StackSpan[]
  readonly ribbon: RibbonSpec
}

/** Equity, underwater and lanes panes with the windows and the strip, 2011-01-03 for 2,500 weekday sessions. */
export function contextStack(): ContextStack {
  const { t, v } = equityFixture({ count: SESSIONS, seed: 41, start: START, drift: 0.00035, vol: 0.011 })
  const equity = v as number[]
  const underwater = underwaterPercent(equity)
  const low = underwater.reduce<number>((m, x) => (x === null ? m : Math.min(m, x)), 0)
  return {
    t,
    panes: [
      {
        id: 'eq', weight: 3, logAllowed: true, decimals: 2,
        summaryDrawdown: { value: `${low.toFixed(1)}%`, basis: G.basis },
        series: [{ name: G.strategy, style: 'primary', values: equity }],
      },
      { id: 'dd', weight: 1.3, unit: '%', decimals: 1, zero: 'white', series: [{ name: G.underwater, style: 'underwater', values: underwater }] },
      { id: 'lanes', weight: 1.7, series: [], lanes: { name: G.lanesName, episodes: seededEpisodes(t, equity) } },
    ],
    spans: RK5_WINDOWS.map(([peak, trough], i) => ({ from: utc(peak), to: utc(trough), label: G.windowLabels[i]! })),
    ribbon: {
      name: G.regimeName,
      values: seededRegimes(t.length, 23),
      states: {
        low: { label: G.states.low, glyph: G.glyphs.low },
        mid: { label: G.states.mid, glyph: G.glyphs.mid },
        high: { label: G.states.high, glyph: G.glyphs.high },
      },
      missing: LINE_STACK.missing,
    },
  }
}
