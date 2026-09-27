// The tear sheet's KPI row (UI_SPEC section 7; ANALYTICS_CATALOG PF2 to PF6, DD1, SV1, SV2, BR1,
// BR2): the API's 13 tiles in its order. Each tile keeps the API's key, label, basis and tag; its
// value is the API value in display units (a fraction times 100) and its face shows a short unit,
// while the popover repeats the API's full unit, so every figure names its basis and unit.
import type { Schemas } from '../../api/types'
import { TEAR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { Kpi } from '../../tiles/KpiTile'
import { isPercentUnit, shortUnit, toDisplay } from './tearFormat'

export type Analytics = Schemas['Analytics']

export interface TileSpec {
  readonly kpi: Kpi
  readonly decimals: number
  readonly signed: boolean
  readonly description: string
  readonly ci: readonly [number, number] | null
}

/** Decimals by KPI key; everything else gets 2. */
const DECIMALS: Readonly<Record<string, number>> = { psr_0: 3, min_trl: 0 }
/** Returns and alpha carry an explicit + (look spec 3.4). */
const SIGNED: ReadonlySet<string> = new Set(['total_return', 'cagr', 'alpha_annual'])

function describe(kpi: Kpi): string {
  const base = fillCopy(TEAR.kpiDescription, { label: kpi.label, unit: kpi.unit, tag: kpi.tag })
  return isPercentUnit(kpi.unit) ? `${base} ${TEAR.kpiPercent}` : base
}

function sharpeInterval(data: Analytics): readonly [number, number] | null {
  const { lo, hi } = data.ci
  return lo !== null && hi !== null && Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

export function kpiTiles(data: Analytics): TileSpec[] {
  return data.kpis.map((kpi) => ({
    kpi: { ...kpi, value: toDisplay(kpi.value, kpi.unit), unit: shortUnit(kpi.unit) },
    decimals: DECIMALS[kpi.key] ?? 2,
    signed: SIGNED.has(kpi.key),
    description: describe(kpi),
    ci: kpi.key === 'sharpe' ? sharpeInterval(data) : null,
  }))
}

const bare = (tag: string) => tag.replace(/^\[|\]$/g, '')

/** The series tag, then [PRE-REG] when a tile shows a value read from a registered result. */
export function tearTags(data: Analytics): string[] {
  const tags = [bare(data.tag)]
  for (const kpi of data.kpis) {
    const tag = bare(kpi.tag)
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}
