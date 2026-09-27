// Fixture data for the grid gallery entries (gallery builds only; no screen imports this). The same
// seed gives the same rows on every run, so screenshot baselines are stable. Dates are in-sample
// (2010 to 2021). Nothing here is real market or account data: levels are near the 2021-12-31 closes
// so the columns look right, and every return is drawn from a seeded generator.
import type { Schemas } from '../api/types'
import { PLUMBING_BANNER } from '../copy/grids'
import { mulberry32, tradingDays } from '../gallery/fixtures'
import { etEpochMs } from '../tiles/etTime'

export interface MonitorRow {
  readonly sym: string
  readonly name: string
  readonly sector: string
  readonly last: number
  readonly decimals: number
  readonly r1d: number
  readonly r1w: number
  readonly r1m: number
  readonly r3m: number
  readonly ytd: number
  readonly r12m: number | null
  readonly rv: number
  readonly corr: number | null
}

type Contract = readonly [sym: string, name: string, sector: string, last: number, decimals: number, vol: number]

const UNIVERSE: readonly Contract[] = [
  ['NQ', 'E-mini Nasdaq-100', 'Equity', 16320.0, 2, 0.22],
  ['ES', 'E-mini S&P 500', 'Equity', 4766.25, 2, 0.17],
  ['YM', 'E-mini Dow', 'Equity', 36338.0, 0, 0.16],
  ['ZT', '2Y Note', 'Rates', 109.3516, 4, 0.01],
  ['ZF', '5Y Note', 'Rates', 120.9688, 4, 0.04],
  ['ZN', '10Y Note', 'Rates', 130.1875, 4, 0.06],
  ['ZB', '30Y Bond', 'Rates', 159.75, 4, 0.12],
  ['6E', 'Euro FX', 'FX', 1.1372, 4, 0.06],
  ['6J', 'Japanese yen', 'FX', 0.008693, 6, 0.07],
  ['6B', 'British pound', 'FX', 1.3531, 4, 0.07],
  ['6A', 'Australian dollar', 'FX', 0.7271, 4, 0.09],
  ['6C', 'Canadian dollar', 'FX', 0.7911, 4, 0.07],
  ['6S', 'Swiss franc', 'FX', 1.0968, 4, 0.06],
  ['CL', 'WTI crude oil', 'Energy', 75.21, 2, 0.38],
  ['NG', 'Natural gas', 'Energy', 3.73, 3, 0.62],
  ['HO', 'Heating oil', 'Energy', 2.3255, 4, 0.35],
  ['RB', 'RBOB gasoline', 'Energy', 2.2825, 4, 0.37],
  ['GC', 'Gold', 'Metals', 1828.6, 1, 0.15],
  ['SI', 'Silver', 'Metals', 23.35, 3, 0.29],
  ['HG', 'Copper', 'Metals', 4.4605, 4, 0.24],
  ['ZC', 'Corn', 'Grains', 593.25, 2, 0.27],
  ['ZS', 'Soybeans', 'Grains', 1339.25, 2, 0.2],
  ['ZW', 'Wheat', 'Grains', 770.75, 2, 0.31],
  ['ZM', 'Soybean meal', 'Grains', 400.3, 1, 0.26],
  ['LE', 'Live cattle', 'Livestock', 138.1, 3, 0.14],
  ['HE', 'Lean hogs', 'Livestock', 81.375, 3, 0.3],
]

/** A normal draw scaled to a horizon of `days` sessions at annual volatility `vol`, in per cent. */
function draw(rand: () => number, vol: number, days: number): number {
  const u = Math.max(rand(), Number.MIN_VALUE)
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  return Math.round(z * vol * Math.sqrt(days / 252) * 10_000) / 100
}

/** The 27F-style monitor rows as of 2021-12-31, grouped by sector in house order. */
export function monitorRows(seed = 27): MonitorRow[] {
  const rand = mulberry32(seed)
  return UNIVERSE.map(([sym, name, sector, last, decimals, vol]) => ({
    sym, name, sector, last, decimals,
    r1d: draw(rand, vol, 1),
    r1w: draw(rand, vol, 5),
    r1m: draw(rand, vol, 21),
    r3m: draw(rand, vol, 63),
    ytd: draw(rand, vol, 252),
    r12m: sym === 'HE' ? null : draw(rand, vol, 252),
    rv: Math.round(vol * (0.8 + 0.4 * rand()) * 1000) / 10,
    corr: sym === 'NQ' ? 1 : Math.round((rand() * 1.4 - 0.5) * 100) / 100,
  }))
}

export interface RunRow {
  readonly id: string
  readonly strategy: string
  readonly trades: number
  readonly pnl: number
  readonly sharpe: number | null
  readonly maxDd: number
  readonly balanceOk: boolean
}

const STRATEGIES = ['za_v0', 'overnight_v0', 'volmanaged_v0', 'tsmom_v0', 'dtsmom_v0', 'rebal_v0', 'mac5rev_v0'] as const

/** `count` fixture runs, for the 10,000-row performance entry. */
export function runRows(count = 10_000, seed = 10): RunRow[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => {
    const strategy = STRATEGIES[i % STRATEGIES.length] ?? 'za_v0'
    const balanceOk = rand() > 0.02
    return {
      id: `nt_${strategy}_fx${String(i + 1).padStart(5, '0')}`,
      strategy,
      trades: Math.round(50 + rand() * 2800),
      pnl: Math.round((rand() - 0.45) * 2_000_000) / 100,
      sharpe: balanceOk ? Math.round((rand() * 2.4 - 0.8) * 100) / 100 : null,
      maxDd: Math.round(-(2 + rand() * 38) * 10) / 10,
      balanceOk,
    }
  })
}

type JournalRow = Schemas['JournalRowOut']

const BOOK = 'volmanaged_paper_journal.jsonl'
const PLUMBING = 'volmanaged_paper_journal.PLUMBING_DELAYED.jsonl'
const DECISION = '15:55:05'

function isoDate(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10)
}

function closeData(date: string, rand: () => number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const target = 5 + Math.round(rand() * 2)
  return {
    type: 'close', date, contract: 'MNQZ1.CME', target, sent: true, expected: { 'MNQZ1.CME': target }, actual: { 'MNQZ1.CME': target },
    exposure: Math.round((0.26 + rand() * 0.08) * 10_000) / 10_000, refused: null, blocked: null, halted: false,
    decided_at_ns_epoch_s: etEpochMs(date, DECISION) / 1000, ...extra,
  }
}

/** A month of paper-book journal rows in November 2021: the book journal and the plumbing journal. */
export function journalRows(seed = 11): JournalRow[] {
  const rand = mulberry32(seed)
  const days = tradingDays(16, '2021-11-01').map(isoDate)
  const rows: JournalRow[] = []
  const push = (plumbing: boolean, data: Record<string, unknown>) =>
    rows.push({ file: plumbing ? PLUMBING : BOOK, line_no: rows.length + 1, plumbing, banner: plumbing ? PLUMBING_BANNER : null, data })
  const first = days[0] ?? '2021-11-01'
  push(false, { type: 'warmup', date: first, requests: 30, planned: 30, valid_last: 22, window: 22, halted: null })
  push(true, { type: 'warmup', date: first, requests: 30, planned: 30, valid_last: 22, window: 22, mode: 'plumbing test, delayed data', strategy_performance: false })
  days.forEach((date, i) => {
    if (i % 4 === 1) {
      push(true, { type: 'delayed_fetch', date, bars: 370, lag_secs: 880 + Math.round(rand() * 60), sizing_price: 'stale sizing price, plumbing only', decided_at_ns_epoch_s: etEpochMs(date, DECISION) / 1000 })
      push(true, closeData(date, rand, { mode: 'plumbing test, delayed data', strategy_performance: false }))
    }
    if (i === 6) push(false, { type: 'skipped', date, reason: 'decision time had passed at 16:02:11 ET: no decision and no orders this session', halted: false })
    else if (i === 9) push(false, closeData(date, rand, { sent: false, refused: 'no sizing price', exposure: null }))
    else push(false, closeData(date, rand))
  })
  return rows
}
