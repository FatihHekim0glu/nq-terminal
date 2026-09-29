// The t the screen file records beside a ladder bar (N04). The cost ladder and the block bars are drawn from the
// DES extract, which holds each bar's value only; the screen JSON that came with it (HypothesisDetail.screen)
// also records, in the same mapping as most values, the t they were tested with (`t_min`, the smaller of the
// Newey-West lags; `t_nw`; or a plain `t`). A bar's t is that number, read where its value sits: never worked out
// from the value, and never turned into an interval (C8), so no whisker is drawn. If the file holds the value
// beside no t, or beside two different ts, the bar has none and is left as it was.
import type { BarLadderInput, LadderBar } from '../../charts/echarts/barLadderModel'
import { LADDER_T } from '../../copy/ladderT'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'

/** In the order they are preferred when a mapping records more than one. A `t` that is a table by lag is not a number and is skipped. */
const T_KEYS = ['t_min', 't_nw', 't'] as const
const T_LIKE = /^t(_|$)/
/** Deeper than any screen file nests a mapping of bars. */
const MAX_DEPTH = 8
const T_DECIMALS = 2

type Record_ = Readonly<Record<string, unknown>>

const isRecord = (v: unknown): v is Record_ => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function tOf(node: Record_): number | null {
  for (const key of T_KEYS) {
    const v = node[key]
    if (isNum(v)) return v
  }
  return null
}

/** Value to the set of ts recorded beside it. Integers are counts, seeds and lags, not bars, so they are left out. */
function collect(node: Record_, depth: number, seen: Set<Record_>, out: Map<number, Set<number>>): void {
  if (depth > MAX_DEPTH || seen.has(node)) return
  seen.add(node)
  const t = tOf(node)
  for (const [key, child] of Object.entries(node)) {
    if (isRecord(child)) collect(child, depth + 1, seen, out)
    else if (t !== null && isNum(child) && !Number.isInteger(child) && !T_LIKE.test(key)) {
      const ts = out.get(child) ?? new Set<number>()
      ts.add(t)
      out.set(child, ts)
    }
  }
}

const indexes = new WeakMap<object, Map<number, Set<number>>>()

function indexOf(screen: Record_): Map<number, Set<number>> {
  const cached = indexes.get(screen)
  if (cached) return cached
  const built = new Map<number, Set<number>>()
  collect(screen, 0, new Set(), built)
  indexes.set(screen, built)
  return built
}

/** The one t the screen file records beside `value`; null when it records none, or more than one. */
export function recordedT(screen: unknown, value: number | null | undefined): number | null {
  if (!isRecord(screen) || !isNum(value)) return null
  const ts = indexOf(screen).get(value)
  if (ts === undefined || ts.size !== 1) return null
  return [...ts][0] ?? null
}

export interface TLadder {
  readonly input: BarLadderInput | null
  /** How many bars got a t. */
  readonly count: number
}

/** The ladder with '{label}, t {t}' on each bar whose t the file records; the same object when none is. */
export function withRecordedT(input: BarLadderInput | null, screen: unknown): TLadder {
  if (input === null) return { input, count: 0 }
  let count = 0
  const bars = input.bars.map((bar): LadderBar => {
    const t = recordedT(screen, bar.value)
    if (t === null) return bar
    count += 1
    return { ...bar, label: fillCopy(LADDER_T.bar, { label: bar.label, t: formatNumber(t, T_DECIMALS) }) }
  })
  return count === 0 ? { input, count } : { input: { ...input, bars }, count }
}
