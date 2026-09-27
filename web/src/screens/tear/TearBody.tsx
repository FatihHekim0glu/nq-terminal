// The tear sheet body for one run or hypothesis: the amber parameter row (context, benchmark, range,
// and Freq for a run or Cost for a hypothesis), then the API's state: loading, a refusal in the
// panel (an unusable run reads [UNUSABLE: BALANCE] and draws nothing, rule 4), an empty state for a
// hypothesis whose card records no series (a check row links to its parent's tear sheet), or the KPI row, the
// open tab's view and, for a run, its trades, costs and exposure panels. Under the tab view, the tab's P1
// views (TearP1: SV5 and SV6 on EQ; PF7 to PF9, RK3, RD3, RD4 and the RK5 stress panel on RET; RL3, RL4, BR3,
// BR4 and RG1 on RR), and RR's rolling Sharpe carries each window's RL1 range (the API's rolling.sharpe_bands).
import { useMemo, useState } from 'react'
import type { ApiError } from '../../api/client'
import { useExportSource } from '../../chrome/exportSource'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { TEAR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import CommandLink from '../help/CommandLink'
import RunBooks from './RunBooks'
import TearP1 from './TearP1'
import type { TearCode } from './TearSheet'
import { TearView } from './TearViews'
import { tearExport } from './tearExport'
import { formatNumber } from './tearFormat'
import { kpiTiles, tearTags, type Analytics } from './tearKpis'
import { defaultCost, useRecordedCosts, useTearAnalytics, type Freq, type TearTarget } from './tearQueries'

export interface TearBodyProps {
  readonly target: TearTarget
  readonly tab: TearCode
  readonly link: PanelLink
}

const UNUSABLE = /balance check failed|unusable run/i

function costLabel(n: number): string {
  return fillCopy(n === 1 ? TEAR.costTicks : TEAR.costTicksPlural, { n })
}

interface ParamsProps {
  readonly target: TearTarget
  readonly data: Analytics | undefined
  readonly freq: Freq
  readonly onFreq: (f: Freq) => void
  readonly costs: readonly number[]
  readonly cost: number | null
  readonly onCost: (c: number) => void
}

function Params({ target, data, freq, onFreq, costs, cost, onCost }: ParamsProps) {
  const isRun = target.kind === 'run'
  return (
    <ParamRow label={TEAR.paramsLabel}>
      <ReadOnlyValue label={isRun ? TEAR.run : TEAR.hypothesis}>{target.name}</ReadOnlyValue>
      <ReadOnlyValue label={TEAR.versus}>{data ? (data.bench_label ?? TEAR.noBenchmark) : '--'}</ReadOnlyValue>
      {data ? (
        <>
          <ReadOnlyValue label={TEAR.range}>{fillCopy(TEAR.rangeValue, { first: data.first, last: data.last })}</ReadOnlyValue>
          <ReadOnlyValue label={TEAR.sessions}>{formatNumber(data.n, 0, { thousands: true })}</ReadOnlyValue>
        </>
      ) : null}
      {isRun ? (
        <DropdownField
          label={TEAR.freq}
          value={freq}
          options={[{ value: 'D', label: TEAR.freqDaily }, { value: 'M', label: TEAR.freqMonthly }]}
          onChange={(v) => onFreq(v === 'M' ? 'M' : 'D')}
        />
      ) : costs.length > 0 && cost !== null ? (
        <DropdownField
          label={TEAR.cost}
          value={String(cost)}
          options={costs.map((c) => ({ value: String(c), label: costLabel(c) }))}
          onChange={(v) => onCost(Number(v))}
        />
      ) : null}
      {data ? tearTags(data).map((tag) => <span key={tag} className="tear-tag">{`[${tag}]`}</span>) : null}
    </ParamRow>
  )
}

function Unusable({ detail }: { readonly detail: string | null }) {
  return (
    <div className="tear-refusal" role="alert">
      <p className="tear-tag tear-tag-bad">{`[${TEAR.unusableTag}]`}</p>
      <p>{TEAR.unusable}</p>
      {detail ? <p className="tear-detail">{detail}</p> : null}
    </div>
  )
}

function Refusal({ error }: { readonly error: ApiError }) {
  if (error.status === 422 && UNUSABLE.test(error.detail)) return <Unusable detail={error.detail} />
  const template = error.kind === 'http' && error.status < 500 ? TEAR.refused : TEAR.failed
  return <p className="tear-refusal" role="alert">{fillCopy(template, { detail: error.detail })}</p>
}

/** A card with no recorded series: the analytics route is never asked, so this replaces the loading line. */
function NoSeries({ name, parent, tab }: { readonly name: string; readonly parent: string | null; readonly tab: TearCode }) {
  if (!parent) return <p className="tear-refusal" role="status">{fillCopy(TEAR.noSeries, { name })}</p>
  return (
    <div className="tear-refusal" role="status">
      <p>{fillCopy(TEAR.checkRow, { parent })}</p>
      <p>
        {fillCopy(TEAR.checkRowOpen, { parent })} <CommandLink text={fillCopy(TEAR.checkRowLink, { parent, code: tab })} />
      </p>
    </div>
  )
}

function Kpis({ data }: { readonly data: Analytics }) {
  const tiles = useMemo(() => kpiTiles(data), [data])
  return (
    <KpiRow label={TEAR.kpisLabel}>
      {tiles.map((t) => (
        <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} signed={t.signed} description={t.description} ci={t.ci} />
      ))}
    </KpiRow>
  )
}

interface LoadedProps extends TearBodyProps {
  readonly data: Analytics
}

function Loaded({ target, tab, link, data }: LoadedProps) {
  useExportSource(useMemo(() => tearExport(tab, data, target.name), [tab, data, target.name]))
  return (
    <div className="tear-view">
      <Kpis data={data} />
      {data.dropped.length > 0 ? <p className="tear-note">{fillCopy(TEAR.dropped, { n: data.dropped.length })}</p> : null}
      <TearView tab={tab} data={data} name={target.name} link={link} />
    </div>
  )
}

export default function TearBody({ target, tab, link }: TearBodyProps) {
  const [freq, setFreq] = useState<Freq>('D')
  const recorded = useRecordedCosts(target)
  const [chosenCost, setCost] = useState<number | null>(null)
  const cost = chosenCost !== null && recorded.costs.includes(chosenCost) ? chosenCost : defaultCost(recorded.costs)
  const query = useTearAnalytics(target, freq, cost)
  const error = query.error ?? (target.kind === 'hypothesis' ? recorded.error : null)
  return (
    <div className="tear-body">
      <div className="tear-screen">
        <Params target={target} data={query.data} freq={freq} onFreq={setFreq} costs={recorded.costs} cost={cost} onCost={setCost} />
        {query.unusable ? (
          <Unusable detail={null} />
        ) : error ? (
          <Refusal error={error} />
        ) : query.data ? (
          <Loaded target={target} tab={tab} link={link} data={query.data} />
        ) : recorded.noSeries && target.kind === 'hypothesis' ? (
          <NoSeries name={target.name} parent={recorded.parent} tab={tab} />
        ) : (
          <p className="tear-note" role="status" aria-busy="true">{TEAR.loading}</p>
        )}
      </div>
      {!query.unusable && !error && query.data ? <TearP1 target={target} tab={tab} data={query.data} freq={freq} cost={cost} link={link} /> : null}
      {!query.unusable && !error && query.data && target.kind === 'run' ? <RunBooks runId={target.name} link={link} /> : null}
    </div>
  )
}
