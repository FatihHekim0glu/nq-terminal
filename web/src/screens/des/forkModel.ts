// Fork model (roadmap #4 DES robustness, slice 2 of 3; ANALYTICS_CATALOG C7): pure builders for the
// "Forks of this hypothesis" view. A fork is either the same screen series at another recorded cost
// (Basis A) or a linked Nautilus run's own account series at daily or monthly frequency (Basis B); the
// two bases are never mixed on one ladder. Every point copies its Sharpe interval from the analytics
// API unchanged (forkPoint computes nothing); nothing here recomputes a Sharpe.
import type { ApiError } from '../../api/client'
import type { Schemas } from '../../api/types'
import type { BarLadderInput, LadderBar } from '../../charts/echarts/barLadderModel'
import { RUN_TAGS } from '../../copy/runs'
import type { Analytics } from '../tear/tearKpis'
import { defaultCost } from '../tear/tearQueries'
import { decimalsFor, ticksLabel, type HypothesisCard } from './desModel'

export type RunSummary = Schemas['RunSummary']

/** DES confirmations use Number <GO> 40 to 69; forks start where they end. */
export const FORK_NUMBER_START = 70
/** At most this many linked runs are forked (each as a daily and a monthly fork). */
export const MAX_FORK_RUNS = 6

export type ForkEngine = 'screen' | 'run'
export type ForkBasis = 'A' | 'B'
export type ForkFreq = 'D' | 'M'

export interface ForkSpec {
  readonly id: string
  readonly engine: ForkEngine
  /** The hypothesis name (a screen fork) or the run id (a run fork). */
  readonly name: string
  readonly cost: number | null
  readonly freq: ForkFreq | null
  readonly basis: ForkBasis
  /** The screen fork at the card's own default cost; never true for a run fork. */
  readonly registered: boolean
  readonly flags: readonly string[]
}

export type ForkSkipReason = 'unusable' | 'unlisted' | 'capped'

export interface ForkSkip {
  readonly run: string
  readonly reason: ForkSkipReason
}

export interface ForkSpecsResult {
  readonly specs: readonly ForkSpec[]
  readonly skipped: readonly ForkSkip[]
}

function runFlags(run: RunSummary): string[] {
  const flags: string[] = []
  if (run.is_probe) flags.push(RUN_TAGS.probe)
  if (run.is_anchor) flags.push(RUN_TAGS.anchor)
  return flags
}

/**
 * Fork specs for a hypothesis card: one screen fork per recorded cost (Basis A; the card's own default
 * cost is the registered fork), then a daily and a monthly run fork (Basis B) for each of the first
 * MAX_FORK_RUNS of card.nautilus_runs that has a RunSummary and balances. `runs` is `undefined` while
 * /api/runs is still loading: nothing is skipped yet, since an unlisted run could simply not be read
 * back. The cap counts only listed runs (those with a RunSummary, usable or not); an unlisted run does
 * not take a slot, so it never bumps a later, genuinely listed run into 'capped'.
 */
export function forkSpecs(card: HypothesisCard, runs: readonly RunSummary[] | undefined): ForkSpecsResult {
  const registeredCost = defaultCost(card.series_costs)
  const specs: ForkSpec[] = card.series_costs.map((cost) => ({
    id: `screen:${cost}`,
    engine: 'screen',
    name: card.name,
    cost,
    freq: null,
    basis: 'A',
    registered: cost === registeredCost,
    flags: [],
  }))
  const skipped: ForkSkip[] = []
  if (runs !== undefined) {
    let listed = 0
    for (const runId of card.nautilus_runs) {
      const summary = runs.find((r) => r.run_id === runId)
      if (!summary) {
        skipped.push({ run: runId, reason: 'unlisted' })
        continue
      }
      if (listed >= MAX_FORK_RUNS) {
        skipped.push({ run: runId, reason: 'capped' })
        listed += 1
        continue
      }
      listed += 1
      if (summary.balance_ok === false) {
        skipped.push({ run: runId, reason: 'unusable' })
        continue
      }
      const flags = runFlags(summary)
      for (const freq of ['D', 'M'] as const) {
        specs.push({ id: `run:${runId}:${freq}`, engine: 'run', name: runId, cost: null, freq, basis: 'B', registered: false, flags })
      }
    }
  }
  return { specs, skipped }
}

export interface ForkPoint {
  readonly spec: ForkSpec
  readonly sharpe: number | null
  readonly lo: number | null
  readonly hi: number | null
  readonly n: number | null
  readonly tag: string | null
  readonly unit: string | null
  readonly error: ApiError | null
}

/** One fork's Sharpe interval, copied verbatim from its analytics answer; nothing computed here. */
export function forkPoint(spec: ForkSpec, a: Analytics | undefined, error: ApiError | null): ForkPoint {
  return {
    spec,
    sharpe: a?.ci.sharpe ?? null,
    lo: a?.ci.lo ?? null,
    hi: a?.ci.hi ?? null,
    n: a?.n ?? null,
    tag: a?.tag ?? null,
    unit: a?.ci.unit ?? null,
    error,
  }
}

export interface ForkLadders {
  readonly screen: BarLadderInput | null
  readonly runs: BarLadderInput | null
}

interface Indexed {
  readonly point: ForkPoint
  readonly no: number
}

/** Ascending by Sharpe; a point with no Sharpe (pending or errored) sorts last, stable otherwise. */
function bySharpe(a: Indexed, b: Indexed): number {
  const av = a.point.sharpe
  const bv = b.point.sharpe
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  return av - bv
}

function ladderFor(items: readonly Indexed[], name: string, label: (x: Indexed) => string): BarLadderInput | null {
  const drawable = items.filter((x) => x.point.error === null)
  if (drawable.length === 0) return null
  const sorted = [...drawable].sort(bySharpe)
  const bars: LadderBar[] = sorted.map((x) => ({
    label: label(x),
    value: x.point.sharpe,
    ...(x.point.lo !== null && x.point.hi !== null ? { lo: x.point.lo, hi: x.point.hi } : {}),
    ...(x.point.n !== null ? { n: x.point.n } : {}),
    ...(x.point.spec.registered ? { emphasis: true } : {}),
  }))
  const unit = drawable.find((x) => x.point.unit !== null)?.point.unit ?? undefined
  return { name, unit, decimals: decimalsFor(sorted.map((x) => x.point.sharpe)), bars }
}

/**
 * Screen (Basis A) and run (Basis B) fork ladders, each sorted ascending by Sharpe with its registered
 * fork emphasised; the two bases are never drawn on one ladder, and an errored fork draws no bar.
 * `names` are the already-filled ladder names (DES_ROBUSTNESS.forksA / forksB).
 */
export function forkLadders(points: readonly ForkPoint[], names: { readonly screen: string; readonly runs: string }): ForkLadders {
  const indexed: Indexed[] = points.map((point, i) => ({ point, no: FORK_NUMBER_START + i }))
  const screenPoints = indexed.filter((x) => x.point.spec.basis === 'A')
  const runPoints = indexed.filter((x) => x.point.spec.basis === 'B')
  return {
    screen: ladderFor(screenPoints, names.screen, (x) => ticksLabel(x.point.spec.cost ?? 0)),
    runs: ladderFor(runPoints, names.runs, (x) => `${x.no} ${x.point.spec.freq ?? ''}`),
  }
}

export interface ForkRow {
  readonly no: number
  readonly engine: ForkEngine
  readonly basis: ForkBasis
  readonly cost: number | null
  readonly freq: ForkFreq | null
  readonly run: string | null
  readonly flags: string
  readonly n: number | null
  readonly sharpe: number | null
  readonly lo: number | null
  readonly hi: number | null
  readonly tag: string | null
  /** The error detail of a fork that could not be read; null once it has a Sharpe or is still pending. */
  readonly state: string | null
}

/** The fork table, one row per point, numbered from FORK_NUMBER_START: its own Number <GO> command. */
export function forkRows(points: readonly ForkPoint[]): ForkRow[] {
  return points.map((p, i) => ({
    no: FORK_NUMBER_START + i,
    engine: p.spec.engine,
    basis: p.spec.basis,
    cost: p.spec.cost,
    freq: p.spec.freq,
    run: p.spec.engine === 'run' ? p.spec.name : null,
    flags: p.spec.flags.join(' '),
    n: p.n,
    sharpe: p.sharpe,
    lo: p.lo,
    hi: p.hi,
    tag: p.tag,
    state: p.error?.detail ?? null,
  }))
}
