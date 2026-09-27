// 98) Export of the tear sheet (look spec 7.5; TASKS Phase 8 notes): the open tab's series as the API
// sends them, at full precision, one line per period (a fraction stays a fraction; the header names the
// field). EQ: equity, benchmark and the performance difference; DD: the underwater curves; RET: the
// per-period returns; RR: both windows of rolling Sharpe and volatility; MRET: the year by month grid
// with the yearly total. Built in the page from the loaded response: nothing is requested.
import { csvFileName, toCsv, type CsvValue } from '../../chrome/exportCsv'
import type { ExportSource } from '../../chrome/exportSource'
import { TEAR_MRET } from '../../copy/tear'
import type { TearCode } from './TearSheet'
import type { Analytics } from './tearKpis'

interface Table {
  readonly header: readonly string[]
  readonly rows: ReadonlyArray<ReadonlyArray<CsvValue>>
}

const at = (values: ReadonlyArray<number | null> | null | undefined, i: number): CsvValue => values?.[i] ?? null

function eqTable(data: Analytics): Table {
  const e = data.equity
  return {
    header: ['date', 'equity', 'bench', 'perf_diff'],
    rows: e.date.map((d, i) => [d, at(e.equity, i), at(e.bench, i), at(e.perf_diff, i)]),
  }
}

function ddTable(data: Analytics): Table {
  const d = data.drawdown
  return { header: ['date', 'dd', 'bench_dd'], rows: d.date.map((date, i) => [date, at(d.dd, i), at(d.bench_dd, i)]) }
}

function retTable(data: Analytics): Table {
  const s = data.distribution.series
  return { header: ['date', 'r'], rows: s.date.map((d, i) => [d, at(s.r, i)]) }
}

function rrTable(data: Analytics): Table {
  const r = data.rolling
  const [short = 0, long = 0] = r.windows
  return {
    header: ['date', `sharpe_${short}`, `sharpe_${long}`, `vol_${short}`, `vol_${long}`],
    rows: r.date.map((d, i) => [d, at(r.sharpe_short, i), at(r.sharpe_long, i), at(r.vol_short, i), at(r.vol_long, i)]),
  }
}

function mretTable(data: Analytics): Table {
  const m = data.monthly
  const total = new Map(m.yearly.map((y) => [y.year, y.value]))
  return {
    header: ['year', ...m.months.map((month) => TEAR_MRET.months[month - 1] ?? String(month)), 'year_total'],
    rows: m.years.map((year, i) => [year, ...(m.grid[i] ?? []), total.get(year) ?? null]),
  }
}

const TABLES: Readonly<Record<TearCode, (data: Analytics) => Table>> = {
  EQ: eqTable,
  DD: ddTable,
  RET: retTable,
  RR: rrTable,
  MRET: mretTable,
}

export function tearExport(tab: TearCode, data: Analytics, name: string): ExportSource {
  const table = TABLES[tab](data)
  return { fileName: csvFileName(name, tab), csv: toCsv(table.header, table.rows), rows: table.rows.length }
}
