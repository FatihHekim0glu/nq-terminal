// RUN helpers (look spec 7.4): the facts row read from result.json's open dicts (read defensively,
// since `config`, `venue` and the checks are free-form), the coverage count, the tab set and the log
// sections a run actually has. Every value is shown as the API sent it.
import type { Schemas } from '../../api/types'
import { BADGE, RUN } from '../../copy/runs'
import { logText } from './model'

export type RunDetail = Schemas['RunDetail']
export type LogSection = Schemas['LogSection']
type Dict = Readonly<Record<string, unknown>>

export const RUN_TABS = ['chart', 'trades', 'fills', 'decisions', 'closes', 'rolls', 'config', 'notes'] as const
export type RunTab = (typeof RUN_TABS)[number]

/** Tabs that show a strategy log section, by section name. */
export const LOG_TABS: Readonly<Partial<Record<RunTab, LogSection>>> = {
  decisions: 'decisions',
  closes: 'closes',
  rolls: 'rolls',
  notes: 'notes',
}

/** The API's page limit: the most rows one GET may return. */
export const PAGE_ROWS = 5000

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dict = (v: unknown): Dict | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null)

/** `done/total` from a coverage check (`sessions`/`processed`, or `nights`/`n_trades`), else null. */
export function coverageOf(check: Dict | null | undefined): string | null {
  if (!check) return null
  const total = num(check.sessions) ?? num(check.nights)
  const done = num(check.processed) ?? num(check.n_trades)
  return total === null || done === null ? null : `${done}/${total}`
}

export function hasLogSection(detail: RunDetail, section: LogSection): boolean {
  return Object.hasOwn(detail.log_sections, section)
}

export interface Fact {
  readonly label: string
  readonly value: string
}

function costPerSide(venue: Dict): string {
  const flat = num(venue.fee_per_contract_side_usd)
  if (flat !== null) return String(flat)
  const instruments = Array.isArray(venue.instruments) ? venue.instruments : []
  const costs = new Set(instruments.map((i) => num(dict(i)?.cost_per_side_float)).filter((c): c is number => c !== null))
  if (costs.size === 0) return BADGE.none
  return [...costs].sort((a, b) => a - b).map(String).join(', ')
}

/** The facts row: Nautilus version, elapsed, venue, fill model, cost per side, window, variant. */
export function runFacts(detail: RunDetail): Fact[] {
  const s = detail.summary
  const venue = detail.venue
  const H = RUN.header
  const elapsed = s.elapsed_s === null ? BADGE.none : H.elapsedValue.replace('{s}', String(s.elapsed_s))
  const window = s.start && s.end ? `${s.start} to ${s.end}` : BADGE.none
  return [
    { label: H.nautilus, value: s.nautilus_trader ?? BADGE.none },
    { label: H.elapsed, value: elapsed },
    { label: H.venue, value: logText(venue.venue) },
    { label: H.fillModel, value: logText(venue.fill_model) },
    { label: H.costPerSide, value: costPerSide(venue) },
    { label: H.window, value: window },
    { label: H.variant, value: s.variant ?? BADGE.none },
  ]
}

/** One level of an open dict as label and text pairs; nested values as JSON. */
export function pairsOf(value: unknown): Fact[] {
  if (Array.isArray(value)) return value.map((v, i) => ({ label: String(i + 1), value: logText(v) }))
  const d = dict(value)
  if (!d) return []
  return Object.entries(d).map(([label, v]) => ({ label, value: logText(v) }))
}

export interface ConfigSection {
  readonly id: string
  readonly title: string
  readonly pairs: Fact[]
}

export function configSections(detail: RunDetail): ConfigSection[] {
  const T = RUN.config.sections
  return [
    { id: 'config', title: T.config, pairs: pairsOf(detail.config) },
    { id: 'venue', title: T.venue, pairs: pairsOf(detail.venue) },
    { id: 'data', title: T.data, pairs: pairsOf(detail.data) },
    { id: 'summary', title: T.summary, pairs: pairsOf(detail.summary_stats) },
    { id: 'coverage', title: T.coverage, pairs: pairsOf(detail.coverage_check) },
    { id: 'logMeta', title: T.logMeta, pairs: pairsOf(detail.log_meta) },
    { id: 'skipped', title: T.skipped, pairs: pairsOf(detail.strategy_skipped) },
  ]
}

/** The page (1-based) and page count of an API page; null when one page holds everything. */
export function pageOf(offset: number, total: number, limit = PAGE_ROWS): { n: number; m: number } | null {
  if (total <= limit) return null
  return { n: Math.floor(offset / limit) + 1, m: Math.ceil(total / limit) }
}
