// The tear sheet body for one run or hypothesis: the amber parameter row (context, benchmark, range,
// and Freq for a run or Cost for a hypothesis), then the API's state: loading, a refusal in the
// panel (an unusable run reads [UNUSABLE: BALANCE] and draws nothing, rule 4), an empty state for a
// hypothesis whose card records no series (a check row links to its parent's tear sheet), or the KPI row, the
// open tab's view and, for a run, its trades, costs and exposure panels. Under the tab view, the tab's P1
// views (TearP1: SV5 and SV6 on EQ; PF7 to PF9, RK3, RD3, RD4 and the RK5 stress panel on RET; RL3, RL4, BR3,
// BR4 and RG1 on RR), and RR's rolling Sharpe carries each window's RL1 range (the API's rolling.sharpe_bands).
// EQ and DD also read /extended for their Market context (RK5 stress bands, RG1 regime strip): the same body,
// under the same query key, that RET and RR read, so a series is asked once whichever tab asks first.
import { useMemo, useState } from 'react'
import { useRun } from '../../api/queries'
import type { ApiError } from '../../api/client'
import { useExportSource } from '../../chrome/exportSource'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { usePanelSource } from '../../chrome/panelSources'
import { RUN_TAGS } from '../../copy/runs'
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
import { tearProvenance } from './tearGrab'
import { kpiTiles, tearTags, type Analytics } from './tearKpis'
import { bootstrapPossible, defaultCost, useRecordedCosts, useTearAnalytics, useTearExtended, type Extended, type Freq, type HypothesisCard, type TearTarget } from './tearQueries'
import { tearSources } from './tearSource'

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
  /** The run's own honesty tags (UI_SPEC section 6: probe, anchor), which travel with it everywhere it
   *  is shown; independent of whether the analytics body has loaded. */
  readonly runHonestyTags: readonly string[]
}

function Params({ target, data, freq, onFreq, costs, cost, onCost, runHonestyTags }: ParamsProps) {
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
      {runHonestyTags.map((tag) => <span key={tag} className="tear-tag">{tag}</span>)}
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
        <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} signed={t.signed} description={t.description} ci={t.ci} unit={t.unit} />
      ))}
    </KpiRow>
  )
}

interface LoadedProps extends TearBodyProps {
  readonly data: Analytics
  /** A hypothesis's card, for the spec hash on GRAB's caption; null for a run or before the card arrives. */
  readonly card: HypothesisCard | null
  /** EQ and DD: the /extended body their market context is drawn from, once it has arrived. */
  readonly extended: Extended | null
  readonly extendedError: ApiError | null
  /** A run's probe and anchor tags, already bracketed; they travel with the run onto GRAB's caption. */
  readonly honestyTags: readonly string[]
}

function Loaded({ target, tab, link, data, card, extended, extendedError, honestyTags }: LoadedProps) {
  useExportSource(useMemo(() => tearExport(tab, data, target.name), [tab, data, target.name]))
  // What the sheet's numbers came from, for GRAB's caption (roadmap 15); read from the answers, nothing asked:
  // the analytics GET, the bootstrap GET behind EQ's cone, the /extended GET behind the market context and the
  // RET and RR cards, and a run's books. The memo keys are primitives: honestyTags is rebuilt every render.
  const specSha = card?.spec_sha256 ?? null
  const { kind, name } = target
  const bootstrap = tab === 'EQ' && bootstrapPossible(data.n)
  const hasExtended = tab === 'RET' || tab === 'RR' || ((tab === 'EQ' || tab === 'DD') && extended !== null)
  const honestyKey = honestyTags.join('\n')
  usePanelSource(useMemo(() => {
    const sources = tearSources({ kind, name }, tab, data.context, { bootstrap, extended: hasExtended })
    const extraTags = honestyKey === '' ? [] : honestyKey.split('\n')
    return { provenance: tearProvenance(data, { kind, name }, specSha, { extraTags, alsoSources: sources.slice(1) }) }
  }, [data, kind, name, specSha, tab, bootstrap, hasExtended, honestyKey]))
  return (
    <div className="tear-view">
      <Kpis data={data} />
      {data.dropped.length > 0 ? <p className="tear-note">{fillCopy(TEAR.dropped, { n: data.dropped.length })}</p> : null}
      <TearView tab={tab} data={data} name={target.name} link={link} extended={extended} extendedError={extendedError} />
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
  // The market context of EQ and DD (RK5, RG1). Asked for only once the analytics have answered, so a run
  // whose balance check failed (rule 4) or a card with no series is never asked, and the chart never waits
  // for it. RET and RR ask for the same body themselves (TearP1); the key is the same, so it is fetched once.
  const extended = useTearExtended(target, freq, cost, (tab === 'EQ' || tab === 'DD') && !query.unusable && !error && query.data !== undefined)
  // The probe and anchor honesty tags (UI_SPEC section 6) travel with the run wherever it is shown, so
  // they are labelled here exactly as on RUN and RUNS (D20). The other runTags() cases (balance,
  // readability, ledger) already have their own treatment on this screen (Unusable, Refusal) and are
  // left there, so they are not duplicated in the parameter row.
  const runDetail = useRun(target.kind === 'run' ? target.name : '')
  const runSummary = target.kind === 'run' ? runDetail.data?.summary : undefined
  type HonestyTag = typeof RUN_TAGS.probe | typeof RUN_TAGS.anchor | null
  const rawHonestyTags: HonestyTag[] = runSummary
    ? [runSummary.is_probe ? RUN_TAGS.probe : null, runSummary.is_anchor ? RUN_TAGS.anchor : null]
    : []
  const runHonestyTags = rawHonestyTags.filter((t): t is Exclude<HonestyTag, null> => t !== null)
  return (
    <div className="tear-body">
      <div className="tear-screen">
        <Params target={target} data={query.data} freq={freq} onFreq={setFreq} costs={recorded.costs} cost={cost} onCost={setCost} runHonestyTags={runHonestyTags} />
        {query.unusable ? (
          <Unusable detail={null} />
        ) : error ? (
          <Refusal error={error} />
        ) : query.data ? (
          <Loaded target={target} tab={tab} link={link} data={query.data} card={recorded.card} extended={extended.data ?? null} extendedError={extended.error} honestyTags={runHonestyTags} />
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
