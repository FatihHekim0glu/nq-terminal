// Fixture data for the ECharts gallery entries (gallery builds only; no component imports this file).
// Seeded, so screenshot baselines are stable. Every date is in-sample (2010 to 2021) except the two
// sealed reads in the Swimlane log, whose data windows lie past the fence by definition (they are
// read windows, not prices). Nothing here is real market data or a real result.
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { mulberry32, tradingDays } from '../../gallery/fixtures'
import type { BarLadderInput } from './barLadderModel'
import type { DistributionInput } from './distributionModel'
import { mretRows, type HeatmapInput } from './heatmapModel'
import type { PScatterInput } from './pScatterModel'
import { FENCE_SECONDS } from './shared'
import type { SwimlaneInput, SwimlaneRead } from './swimlaneModel'

type Sector = 'equity' | 'rates' | 'fx' | 'energy' | 'metals' | 'grains' | 'livestock'

/** The 27F universe (nq-lab round 8), clustered by sector. */
const UNIVERSE: readonly (readonly [string, string, Sector])[] = [
  ['NQ', 'E-mini Nasdaq-100', 'equity'], ['ES', 'E-mini S&P 500', 'equity'], ['YM', 'E-mini Dow', 'equity'],
  ['ZT', '2-year Note', 'rates'], ['ZF', '5-year Note', 'rates'], ['ZN', '10-year Note', 'rates'], ['ZB', 'Treasury Bond', 'rates'],
  ['6E', 'Euro FX', 'fx'], ['6J', 'Japanese Yen', 'fx'], ['6B', 'British Pound', 'fx'], ['6A', 'Australian Dollar', 'fx'],
  ['6C', 'Canadian Dollar', 'fx'], ['6S', 'Swiss Franc', 'fx'],
  ['CL', 'Crude Oil', 'energy'], ['NG', 'Natural Gas', 'energy'], ['HO', 'Heating Oil', 'energy'], ['RB', 'RBOB Gasoline', 'energy'],
  ['GC', 'Gold', 'metals'], ['SI', 'Silver', 'metals'], ['HG', 'Copper', 'metals'],
  ['ZC', 'Corn', 'grains'], ['ZS', 'Soybeans', 'grains'], ['ZW', 'Wheat', 'grains'], ['ZM', 'Soybean Meal', 'grains'], ['ZL', 'Soybean Oil', 'grains'],
  ['LE', 'Live Cattle', 'livestock'], ['HE', 'Lean Hogs', 'livestock'],
]

/** Loading on a common risk factor and on the sector factor (house numbers for a plausible matrix). */
const LOADING: Readonly<Record<Sector, { readonly market: number; readonly sector: number; readonly vol: number }>> = {
  equity: { market: 0.9, sector: 0.4, vol: 1 },
  rates: { market: -0.3, sector: 0.9, vol: 0.3 },
  fx: { market: 0.25, sector: 0.55, vol: 0.5 },
  energy: { market: 0.35, sector: 0.8, vol: 1.8 },
  metals: { market: 0.15, sector: 0.7, vol: 1.1 },
  grains: { market: 0.15, sector: 0.6, vol: 1.2 },
  livestock: { market: 0.1, sector: 0.5, vol: 1 },
}
/** Safe-haven currencies lean against the risk factor. */
const MARKET_OVERRIDE: Readonly<Record<string, number>> = { '6J': -0.3, '6S': -0.1, GC: 0.05 }

function normals(seed: number): () => number {
  const rand = mulberry32(seed)
  return () => Math.sqrt(-2 * Math.log(Math.max(rand(), Number.MIN_VALUE))) * Math.cos(2 * Math.PI * rand())
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const DAY = 86_400
const utc = (y: number, m = 0, d = 1) => Date.UTC(y, m, d) / 1000

export function mretFixture(): HeatmapInput {
  const z = normals(3)
  const years = Array.from({ length: 12 }, (_, i) => 2010 + i)
  const grid = years.map(() => G.months.map(() => round(0.9 + 4.2 * z())))
  const { rows, values } = mretRows({ years, grid })
  return { kind: 'mret', name: G.mretName, unit: '%', columns: [...G.months], rows, values: values.map((r) => r.map((v) => (v === null ? null : round(v)))) }
}

export function corrFixture(): HeatmapInput {
  const rand = mulberry32(7)
  const n = UNIVERSE.length
  const market = UNIVERSE.map(([sym, , sector]) => MARKET_OVERRIDE[sym] ?? LOADING[sector].market)
  const values: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [, , si] = UNIVERSE[i]!
      const [, , sj] = UNIVERSE[j]!
      const sector = si === sj ? LOADING[si].sector * LOADING[sj].sector : 0
      const r = round(Math.max(-0.99, Math.min(0.99, market[i]! * market[j]! + sector + (rand() - 0.5) * 0.08)))
      values[i]![j] = r
      values[j]![i] = r
    }
  }
  const symbols = UNIVERSE.map(([sym]) => sym)
  return { kind: 'corr', name: G.corrName, columns: symbols, rows: symbols, values }
}

const MON_SD = [1.2, 2.6, 5, 8.5, 14, 18] as const
const MON_STRONG = [1, 2, 4, 7, 10, 15] as const

export function monFixture(): HeatmapInput {
  const z = normals(9)
  const values = UNIVERSE.map(([, , sector]) => MON_SD.map((sd) => round(0.1 * sd + sd * LOADING[sector].vol * 0.6 * z())))
  return {
    kind: 'mon', name: G.monName, unit: '%', columns: [...G.monColumns], rows: UNIVERSE.map(([sym, name]) => `${sym} ${name}`),
    values, strongAt: [...MON_STRONG],
  }
}

/** numpy's default (linear) quantile of sorted values. */
function quantile(sorted: readonly number[], p: number): number {
  const at = p * (sorted.length - 1)
  const lo = Math.floor(at)
  const hi = Math.min(sorted.length - 1, lo + 1)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo)
}

function tail(sorted: readonly number[], p: number): { var: number; cvar: number } {
  const cut = quantile(sorted, p)
  const worst = sorted.filter((v) => v <= cut)
  return { var: round(-cut, 4), cvar: round(-worst.reduce((a, b) => a + b, 0) / worst.length, 4) }
}

/** The backend's RD1 histogram: Freedman-Diaconis edges, counts and the fitted normal as expected counts. */
function histogram(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const min = sorted[0]!
  const max = sorted[n - 1]!
  const width0 = (2 * (quantile(sorted, 0.75) - quantile(sorted, 0.25))) / Math.cbrt(n)
  const bins = Math.max(1, Math.ceil((max - min) / width0))
  const width = (max - min) / bins
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + i * width)
  const counts = new Array<number>(bins).fill(0)
  for (const v of sorted) counts[Math.min(bins - 1, Math.floor((v - min) / width))]! += 1
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1))
  const pdf = (x: number) => Math.exp(-(((x - mean) / sd) ** 2) / 2) / (sd * Math.sqrt(2 * Math.PI))
  const normal = counts.map((_, i) => round(n * width * pdf(min + (i + 0.5) * width), 3))
  return { sorted, edges, counts, normal, mean, sd }
}

export function distributionFixture(): DistributionInput {
  const z = normals(21)
  const jump = mulberry32(22)
  const t = tradingDays(3300, '2010-01-04').filter((s) => s < FENCE_SECONDS)
  // Four halted sessions in March 2020 are missing, as in the real series.
  const halted = new Set([utc(2020, 2, 9), utc(2020, 2, 12), utc(2020, 2, 16), utc(2020, 2, 18)])
  const v = t.map((s) => (halted.has(s) ? null : round(0.045 + 1.05 * z() * (jump() < 0.04 ? 2.6 : 1), 4)))
  const h = histogram(v.filter((x): x is number => x !== null))
  const t95 = tail(h.sorted, 0.05)
  const t99 = tail(h.sorted, 0.01)
  return {
    name: G.distributionName, unit: '%', edges: h.edges, counts: h.counts, normal: h.normal, mean: h.mean, sd: h.sd,
    risk: { var95: t95.var, cvar95: t95.cvar, var99: t99.var, cvar99: t99.cvar }, series: { t, v },
  }
}

export function blocksFixture(): BarLadderInput {
  return {
    name: G.blocksName, unit: 'R', ci: G.ci95,
    bars: [
      { label: '2010-13', value: -0.13, lo: -0.25, hi: -0.01, n: 801 },
      { label: '2014-17', value: -0.01, lo: -0.12, hi: 0.1, n: 1003 },
      { label: '2018-21', value: 0.16, lo: 0.05, hi: 0.27, n: 974 },
    ],
  }
}

export function weekdayFixture(): BarLadderInput {
  const values = [[12.4, 31], [-8.1, 27], [21.7, 29], [-3.2, 30], [15.9, 34]] as const
  return {
    name: G.weekdayName, unit: 'USD', decimals: 1, ci: G.ci95,
    bars: G.weekdays.map((label, i) => {
      const [v, half] = values[i]!
      return { label, value: v, lo: round(v - half, 1), hi: round(v + half, 1), n: 460 + i * 7 }
    }),
  }
}

export function costFixture(): BarLadderInput {
  const sharpe = [0.41, 0.22, 0.03, -0.16]
  // Break-even: where the Sharpe crosses zero between 2 and 3 ticks, by linear interpolation.
  const at = 2 + sharpe[2]! / (sharpe[2]! - sharpe[3]!)
  return {
    name: G.costName, bars: G.costs.map((label, i) => ({ label, value: sharpe[i]! })), marker: { at: round(at, 3), label: G.breakEven },
  }
}

export function pScatterFixture(): PScatterInput {
  const points: readonly (readonly [string, number])[] = [
    ['za_v0', 0.169], ['turnofmonth_v0', 0.342], ['preholiday_v0', 0.207], ['prefomc_v0', 0.081],
    ['overnight_v0', 0.0027], ['macroday_v0', 0.268], ['halloween_v0', 0.031], ['volmanaged_v0', 0.119],
    ['tsmom_v0', 0.698], ['rebal_v0', 0.129], ['mac5rev_v0', 0.218], ['fomccycle_v0', 0.111],
    ['eurodrift_v0', 0.123], ['fomctone_v0', 0.652], ['dtsmom_v0', 0.181], ['mim_v0', 0.9999],
  ]
  return { name: G.pScatterName, alpha: 0.05, points: points.map(([label, p]) => ({ label, p })) }
}

type WindowKind = 'full' | 'span' | 'year' | 'day' | 'from2011'

/** Callers and read counts that add up to the size of the real log (about 2,790 lines). */
const CALLERS: readonly (readonly [string, number, WindowKind])[] = [
  ['za_screen', 40, 'full'], ['c1_diagnostic', 12, 'full'], ['quantpad_refs', 6, 'full'], ['run_base', 900, 'span'],
  ['compare_nt', 300, 'span'], ['calendar_screen', 60, 'full'], ['sizing_screen', 80, 'full'], ['dtsmom_screen', 270, 'from2011'],
  ['mim_screen', 500, 'year'], ['repair_futures_v1', 400, 'day'], ['repair_futures_v1_provenance', 200, 'full'], ['terminal', 20, 'span'],
]

function window(kind: WindowKind, rand: () => number): readonly [number, number] {
  const month = (i: number) => utc(2010 + Math.floor(i / 12), i % 12)
  if (kind === 'full') return [rand() < 0.5 ? utc(2010) : utc(2010, 8, 28), FENCE_SECONDS]
  if (kind === 'from2011') return [utc(2011), FENCE_SECONDS]
  if (kind === 'year') {
    const y = 2010 + Math.floor(rand() * 12)
    return [utc(y), utc(y + 1)]
  }
  if (kind === 'day') {
    const d = utc(2010) + Math.floor(rand() * 4380) * DAY
    return [d, d + DAY]
  }
  const first = Math.floor(rand() * 143)
  return [month(first), month(Math.min(144, first + 1 + Math.floor(rand() * 24)))]
}

export function swimlaneFixture(): SwimlaneInput {
  const rand = mulberry32(31)
  const reads: SwimlaneRead[] = CALLERS.flatMap(([caller, count, kind]) =>
    Array.from({ length: count }, () => {
      const [start, end] = window(kind, rand)
      return { caller, start, end }
    }),
  )
  const sealed: SwimlaneRead[] = [0, 1].map(() => ({ caller: 'serve_sealed', start: FENCE_SECONDS, end: utc(2026, 8), sealed: true }))
  return { name: G.swimlaneName, reads: [...reads, ...sealed] }
}
