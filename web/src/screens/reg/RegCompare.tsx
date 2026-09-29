// REG 95) Compare (roadmap #9 phase B): the hypotheses marked with Space on the board, their served Basis A
// screen series (GET /api/hypotheses/{name}/series, one request each at the chosen cost) drawn together,
// one LineStack pane per unit (C1). [POST HOC] and descriptive: the values are the served running sums, and
// the view adds no test, p value, verdict or statistic of its own. A hypothesis the API cannot answer is
// listed with the API's own detail and is not drawn.
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { ApiError, apiGet } from '../../api/client'
import { apiQueryKey } from '../../api/queries'
import type { Schemas } from '../../api/types'
import LineStack from '../../charts/LineStack'
import { DropdownField, ParamRow } from '../../chrome/Field'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import { REG } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'
import { regCompareModel, type RegSeriesInput } from './regCompareModel'

type Series = Schemas['HypothesisSeries']

const roving = { [ROVING_ATTR]: '' }

const COST_KEYS = ['0', '1', '2'] as const
type CostKey = (typeof COST_KEYS)[number]
const DEFAULT_COST: CostKey = '1'
const COST_OPTIONS = COST_KEYS.map((value) => ({ value, label: REG.compare.costs[value] }))

export interface RegCompareProps {
  /** The basket, in the order the hypotheses were marked (it fixes each one's line style). */
  readonly names: readonly string[]
  /** The panel's link group; '-' keeps the crosshair to this chart. */
  readonly link: LinkGroup
  readonly onBack: () => void
}

function detailOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  return error instanceof Error ? error.message : String(error)
}

interface Fetched {
  readonly inputs: readonly RegSeriesInput[]
  readonly pending: boolean
}

/** One series GET per name at `cost`, on useHypothesisSeries's own query key, so a series read elsewhere is shared. */
function useSeriesInputs(names: readonly string[], cost: number): Fetched {
  const combine = useCallback(
    (results: ReadonlyArray<UseQueryResult<Series>>): Fetched => {
      const inputs = results.map((result, i): RegSeriesInput => ({
        name: names[i] ?? '',
        body: result.data ?? null,
        error: result.data === undefined && result.error ? detailOf(result.error) : null,
      }))
      return { inputs, pending: results.some((r) => r.isPending && r.fetchStatus !== 'idle') }
    },
    [names],
  )
  return useQueries({
    queries: names.map((name) => {
      const request = { path: { name }, query: { cost } }
      return {
        queryKey: apiQueryKey('/api/hypotheses/{name}/series', request),
        queryFn: ({ signal }: { signal: AbortSignal }) => apiGet('/api/hypotheses/{name}/series', request, { signal }),
        enabled: name.trim() !== '',
      }
    }),
    combine,
  })
}

interface UnitsProps {
  readonly units: readonly string[]
  readonly names: readonly (readonly string[])[]
}

/** Which unit each pane is in: the chart's panes carry no unit name of their own. */
function PaneUnits({ units, names }: UnitsProps) {
  if (units.length === 0) return null
  return (
    <ul className="reg-compare-units reg-muted" aria-label={REG.compare.unitsLabel}>
      {units.map((unit, i) => (
        <li key={unit}>{fillCopy(REG.compare.unitLine, { n: i + 1, unit, names: (names[i] ?? []).join(REG.compare.unitJoin) })}</li>
      ))}
    </ul>
  )
}

export default function RegCompare({ names, link, onBack }: RegCompareProps) {
  const [cost, setCost] = useState<CostKey>(DEFAULT_COST)
  const { inputs, pending } = useSeriesInputs(names, Number(cost))
  const model = useMemo(() => regCompareModel(inputs, Number(cost)), [inputs, cost])
  const drawn = model.panes.reduce((n, p) => n + p.series.length, 0)
  const title = fillCopy(drawn === 1 ? REG.compare.chartTitleOne : REG.compare.chartTitle, { n: drawn })
  return (
    <section className="reg-compare" aria-label={title} aria-busy={pending}>
      <ParamRow label={REG.compare.paramsLabel}>
        <DropdownField label={REG.compare.costLabel} value={cost} options={COST_OPTIONS} onChange={(v) => setCost(v as CostKey)} />
        <button type="button" className="reg-link reg-compare-back" onClick={onBack} {...roving}>{REG.compare.back}</button>
      </ParamRow>
      <p className="reg-msg reg-muted">{fillCopy(REG.compare.note, { cost: REG.compare.costs[cost] })}</p>
      {model.panes.length > 0 ? (
        <div className="reg-compare-chart">
          <LineStack title={title} t={model.t} panes={model.panes} link={link} />
        </div>
      ) : null}
      <PaneUnits units={model.paneUnits} names={model.paneNames} />
      <div className="reg-compare-failed" role="status">
        {model.failed.length > 0 ? (
          <ul className="reg-msg">
            {model.failed.map((f) => (
              <li key={f.name}>{fillCopy(REG.compare.failed, { name: f.name, detail: f.detail })}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
