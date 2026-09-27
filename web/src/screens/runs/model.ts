// Pure helpers for RUNS and RUN (TASKS 6.3; UI_SPEC sections 6 and 7; look spec 3.4 and 7.4): the
// honesty tags, the sub-tab and text filters, the compare-request chunks and the number formats.
// Nothing here computes a statistic: every number shown is an API value, formatted.
import type { Schemas } from '../../api/types'
import { BADGE, RUN_TAGS } from '../../copy/runs'

export type RunSummary = Schemas['RunSummary']
export type CompareStats = Schemas['CompareStats']
export type Tone = 'up' | 'down' | 'muted'

export const RUNS_TABS = ['all', 'ledgered', 'anchors', 'probes', 'unusable'] as const
export type RunsTab = (typeof RUNS_TABS)[number]

/** `/api/runs/stats?ids=` takes at most this many characters (contract maxLength). */
export const COMPARE_IDS_MAX = 2000
const MISSING = BADGE.none
const MAX_DECIMALS = 8

/** Tags that must travel with the run wherever it is shown (UI_SPEC section 6). */
export function runTags(run: RunSummary): string[] {
  const tags: string[] = []
  if (!run.readable) tags.push(RUN_TAGS.unreadable)
  if (run.is_probe) tags.push(RUN_TAGS.probe)
  if (run.is_anchor) tags.push(RUN_TAGS.anchor)
  if (run.ledger) tags.push(RUN_TAGS.ledgered)
  if (run.balance_ok === false) tags.push(RUN_TAGS.unusableBalance)
  else if (!run.usable && run.readable) tags.push(RUN_TAGS.unusable)
  return tags
}

export interface Badge {
  readonly text: string
  readonly tone: Tone
}

/** A balance flag as text and colour; a missing flag is never a pass. */
export function balanceBadge(ok: boolean | null | undefined): Badge {
  if (ok === true) return { text: BADGE.ok, tone: 'up' }
  if (ok === false) return { text: BADGE.fail, tone: 'down' }
  return { text: BADGE.missing, tone: 'muted' }
}

export function checkText(ok: boolean | null | undefined): string {
  if (ok === true) return BADGE.checkOk
  if (ok === false) return BADGE.checkFail
  return MISSING
}

export function checkTone(ok: boolean | null | undefined): Tone | undefined {
  if (ok === true) return 'up'
  if (ok === false) return 'down'
  return 'muted'
}

export function inRunsTab(run: RunSummary, tab: RunsTab): boolean {
  switch (tab) {
    case 'all':
      return true
    case 'ledgered':
      return run.ledger !== null
    case 'anchors':
      return run.is_anchor
    case 'probes':
      return run.is_probe
    case 'unusable':
      return !run.usable
  }
}

/** Case-insensitive substring match on run id, strategy and variant. */
export function matchesRunFilter(run: RunSummary, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  return [run.run_id, run.strategy, run.variant].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
}

export function strategiesOf(runs: readonly RunSummary[]): string[] {
  const names = new Set(runs.map((r) => r.strategy).filter((s): s is string => typeof s === 'string' && s !== ''))
  return [...names].sort((a, b) => a.localeCompare(b, 'en'))
}

/** Splits run ids into groups whose comma-joined length stays within `max`. */
export function compareChunks(ids: readonly string[], max = COMPARE_IDS_MAX): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0
  for (const id of ids) {
    const added = current.length === 0 ? id.length : length + 1 + id.length
    if (current.length > 0 && added > max) {
      chunks.push(current)
      current = [id]
      length = id.length
    } else {
      current = [...current, id]
      length = added
    }
  }
  return current.length > 0 ? [...chunks, current] : chunks
}

/** `/api/runs/compare` takes 2 to 8 distinct runs (a backend older than `/api/runs/stats` has only it). */
const COMPARE_MIN = 2
const COMPARE_MAX = 8

/** Groups of 2 to 8 ids for the older compare route; a lone last id joins the group before it. */
export function compareGroups(ids: readonly string[]): string[][] {
  if (ids.length < COMPARE_MIN) return []
  const groups: string[][] = []
  for (let i = 0; i < ids.length; i += COMPARE_MAX) groups.push(ids.slice(i, i + COMPARE_MAX))
  const last = groups[groups.length - 1]
  const before = groups[groups.length - 2]
  if (last && before && last.length < COMPARE_MIN) {
    groups[groups.length - 2] = before.slice(0, -1)
    groups[groups.length - 1] = [...before.slice(-1), ...last]
  }
  return groups
}

export function statsById(pages: ReadonlyArray<readonly CompareStats[]>): ReadonlyMap<string, CompareStats> {
  return new Map(pages.flat().map((s) => [s.run_id, s]))
}

const usable = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Fixed decimals with an ASCII minus and never `-0.00`. */
function fixed(v: number, decimals: number): string {
  const text = v.toFixed(decimals)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

const usdFormat = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })

/** USD with thousands separators and two decimals; `+` on a positive value when `signed`. */
export function formatUsd(v: number | null | undefined, signed = false): string {
  if (!usable(v)) return MISSING
  const text = usdFormat.format(v).replace('−', '-')
  if (/^-0\.00$/.test(text)) return '0.00'
  return signed && v > 0 && text !== '0.00' ? `+${text}` : text
}

export function formatRatio(v: number | null | undefined, decimals = 2): string {
  return usable(v) ? fixed(v, decimals) : MISSING
}

/** A fraction (0.75) as a percentage (75.0%). */
export function formatFraction(v: number | null | undefined, decimals = 2): string {
  return usable(v) ? `${fixed(v * 100, decimals)}%` : MISSING
}

export function formatCount(v: number | null | undefined): string {
  return usable(v) ? String(v) : MISSING
}

function decimalsOf(v: number): number {
  if (Number.isInteger(v)) return 0
  const text = String(v)
  if (text.includes('e')) return MAX_DECIMALS
  return Math.min(MAX_DECIMALS, text.split('.')[1]?.length ?? 0)
}

/** The decimals a column needs to show every value exactly (at most 8). */
export function decimalsFor(values: ReadonlyArray<number | null | undefined>): number {
  return values.reduce<number>((d, v) => (usable(v) ? Math.max(d, decimalsOf(v)) : d), 0)
}

export function formatExact(v: number | null | undefined, decimals: number): string {
  return usable(v) ? fixed(v, decimals) : MISSING
}

/** The keys of free-form log rows, in first-seen order. */
export function logColumns(items: ReadonlyArray<Readonly<Record<string, unknown>>>): string[] {
  const seen = new Set<string>()
  for (const item of items) for (const key of Object.keys(item)) seen.add(key)
  return [...seen]
}

/** A log value as text: numbers exactly, objects as JSON, missing as --. */
export function logText(v: unknown): string {
  if (v === null || v === undefined || v === '') return MISSING
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : MISSING
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v)
}

export function signTone(v: number | null | undefined): Tone | undefined {
  if (!usable(v) || v === 0) return undefined
  return v > 0 ? 'up' : 'down'
}

/**
 * The share of a shared value axis the strategy's own range must fill to stay readable (RUN chart).
 * Below it the benchmark moves to a pane of its own; its values are unchanged.
 */
export const SHARED_AXIS_MIN_SHARE = 0.2

function extent(values: ReadonlyArray<number | null | undefined>): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return lo <= hi ? [lo, hi] : null
}

/** True when the benchmark on the strategy's axis would squash the strategy's line flat. */
export function benchOwnPane(equity: ReadonlyArray<number | null | undefined>, bench: ReadonlyArray<number | null | undefined> | null | undefined): boolean {
  const s = extent(equity)
  const b = bench ? extent(bench) : null
  if (!s || !b) return false
  const union = Math.max(s[1], b[1]) - Math.min(s[0], b[0])
  return union > 0 && (s[1] - s[0]) / union < SHARED_AXIS_MIN_SHARE
}
