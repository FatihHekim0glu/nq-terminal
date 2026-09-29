// SEAS, seasonality (TASKS Phase 11; UI_SPEC 5 and 6; look spec 4.4, 6 and 7; ANALYTICS MV7 and C7). For an
// instrument (a universe root) or a registered hypothesis: the mean by calendar month, weekday, week
// of month and (instruments with assessed 1m sessions) 30-minute bucket of the NYSE session, each bar
// with a band of one standard error and a numbered grid (n, mean, standard error, hit rate; Number
// <GO> or Enter on a row reads it out), plus the monthly values as a years by months heatmap. All
// from one GET; every panel carries the API's [POST HOC] label and no p-value is shown anywhere. The
// red bar holds the amber context field (Enter runs `<text> SEAS`), 96) Actions, 98) Export (the
// shown tab as CSV) and 99) Help.
import { useId, useMemo, useRef, useState } from 'react'
import { useHypothesis } from '../../api/queries.screens'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { Heatmap } from '../../charts/echarts/Heatmap'
import { requestLine } from '../../chrome/CommandLine.bus'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { usePanelPage, type PanelPage } from '../../chrome/PanelChrome.page'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import MonitorGrid, { signTone, type MonitorColumn } from '../../grids/MonitorGrid'
import { MARKET } from '../../copy/market'
import { SEAS } from '../../copy/seas'
import { fillCopy } from '../../copy/workspace'
import { BookBar, EmptyGuide } from '../cost/BookFrame'
import { gateText } from '../mon/model'
import QueryStatus from '../mon/QueryStatus'
import '../mon/market.css'
import {
  FIRST_YEAR,
  LAST_YEAR,
  TABS,
  costOptions,
  defaultCost,
  excludedText,
  formatHit,
  formatPlain,
  formatSigned,
  gridRows,
  heatCsv,
  heatInput,
  ladderInput,
  panelCsv,
  panelName,
  panelOf,
  pickText,
  scaleOf,
  yearOptions,
  type GridRow,
  type Scale,
  type SeasTab,
} from './model'
import type { SeasQuery, SeasVariant, Seasonality } from './types'
import { useSeasonality } from './useSeasonality'
import './seas.css'

interface Settings {
  readonly startYear: number
  readonly endYear: number
  readonly variant: SeasVariant | null
  readonly cost: number
  readonly tab: SeasTab
}

const INITIAL: Settings = { startYear: FIRST_YEAR, endYear: LAST_YEAR, variant: null, cost: 1, tab: 'month' }
const YEARS = yearOptions()
const VARIANTS = [
  { value: 'auto', label: SEAS.variantOptions.auto },
  { value: 'vendor', label: SEAS.variantOptions.vendor },
  { value: 'repaired', label: SEAS.variantOptions.repaired },
]
/** Tabs are 81) to 85): the grid rows hold 1) to 13) for Number <GO> (the latest registration would win a clash). */
const TAB_START = 81

function columnsFor(s: Scale): MonitorColumn<GridRow>[] {
  const c = SEAS.cols
  const num = (id: keyof GridRow, header: string, signedValue: boolean): MonitorColumn<GridRow> => ({
    id,
    header,
    width: 96,
    kind: 'num',
    value: (r) => r[id] as number | null,
    format: (r) => (signedValue ? formatSigned(r[id] as number | null, s.decimals) : formatPlain(r[id] as number | null, s.decimals)),
    tone: signedValue ? (r) => signTone(r[id] as number | null) : undefined,
    sortable: false,
  })
  return [
    { id: 'label', header: c.group, width: 80, kind: 'name', value: (r) => r.label, sortable: false },
    { id: 'n', header: c.n, width: 64, kind: 'num', value: (r) => r.n, sortable: false },
    num('mean', `${c.mean} (${s.unit.trim()})`, true),
    num('se', c.se, false),
    num('lo', c.lo, true),
    num('hi', c.hi, true),
    { id: 'hit', header: c.hit, width: 80, kind: 'num', value: (r) => r.hit, format: (r) => formatHit(r.hit), sortable: false },
  ]
}

function Params({ s, set, data, isHypothesis, costs }: {
  readonly s: Settings
  readonly set: (next: Settings) => void
  readonly data: Seasonality | undefined
  readonly isHypothesis: boolean
  readonly costs: readonly number[]
}) {
  const cost = costs.includes(s.cost) ? s.cost : defaultCost(costs)
  const pickYear = (which: 'startYear' | 'endYear', v: string) => {
    const year = Number(v)
    const next = { ...s, [which]: year }
    set(next.startYear > next.endYear ? { ...next, startYear: year, endYear: year } : next)
  }
  return (
    <div className="mkt-params">
      <ParamRow label={SEAS.paramLabel}>
        <DropdownField label={SEAS.from} value={String(s.startYear)} options={YEARS} onChange={(v) => pickYear('startYear', v)} />
        <DropdownField label={SEAS.to} value={String(s.endYear)} options={YEARS} onChange={(v) => pickYear('endYear', v)} />
        {!isHypothesis ? (
          <DropdownField label={SEAS.variant} value={s.variant ?? 'auto'} options={VARIANTS} onChange={(v) => set({ ...s, variant: v === 'auto' ? null : (v as SeasVariant) })} />
        ) : costs.length > 0 && cost !== null ? (
          <DropdownField label={SEAS.cost} value={String(cost)} options={costOptions(costs)} onChange={(v) => set({ ...s, cost: Number(v) })} />
        ) : null}
        {data ? <ReadOnlyValue label={SEAS.sessions}>{data.first && data.last ? `${data.sessions} (${fillCopy(SEAS.span, { first: data.first, last: data.last })})` : SEAS.noSpan}</ReadOnlyValue> : null}
      </ParamRow>
    </div>
  )
}

function PanelView({ data, tab }: { readonly data: Seasonality; readonly tab: Exclude<SeasTab, 'heatmap'> }) {
  const panel = panelOf(data, tab)
  const s = useMemo(() => scaleOf(data, tab), [data, tab])
  const rows = useMemo(() => (panel ? gridRows(data, panel) : []), [data, panel])
  const ladder = useMemo(() => (panel ? ladderInput(data, panel) : null), [data, panel])
  const columns = useMemo(() => columnsFor(s), [s])
  const [picked, setPicked] = useState<GridRow | null>(null)
  const headingId = useId()
  if (!panel || !panel.available || !ladder) {
    return <p className="seas-line mkt-warn-text">{fillCopy(SEAS.unavailable, { note: panel?.note ?? '' })}</p>
  }
  const name = panelName(data, tab)
  const excluded = excludedText(panel)
  return (
    <section className="seas-page" aria-labelledby={headingId}>
      <h2 id={headingId} className="seas-heading">{name}</h2>
      <div className="seas-chart"><BarLadder data={ladder} chartId={`seas-${tab}`} /></div>
      <MonitorGrid label={fillCopy(SEAS.gridLabel, { name })} rows={rows} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.label} onOpen={setPicked} scroll="panel" />
      <p className="seas-line" aria-live="polite">{picked ? pickText(picked, s) : ''}</p>
      <p className="seas-line">{fillCopy(SEAS.observation, { observation: panel.observation })}</p>
      {excluded ? <p className="seas-line">{excluded}</p> : null}
      {tab === 'intraday' && data.fraction ? <p className="seas-line">{SEAS.intradayScale}</p> : null}
    </section>
  )
}

function HeatView({ data }: { readonly data: Seasonality }) {
  const heat = useMemo(() => heatInput(data), [data])
  return (
    <section className="seas-page" aria-label={heat.name}>
      <div className="seas-heat"><Heatmap data={heat} chartId="seas-heatmap" /></div>
      <p className="seas-line">{SEAS.heatNote}</p>
    </section>
  )
}

function Notes({ data }: { readonly data: Seasonality }) {
  const s = scaleOf(data)
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{data.label}</span>
      </p>
      <p>{SEAS.noPValue}</p>
      <p>{fillCopy(MARKET.basis, { basis: data.basis })}</p>
      <p>{`${fillCopy(SEAS.units, { unit: data.unit })} ${s.note} ${SEAS.aggregation[data.aggregation]}`}</p>
      <p>{fillCopy(SEAS.errorBar, { text: data.error_bar })}</p>
      {data.gate ? <p className="mkt-gate">{gateText(data.gate)}</p> : null}
    </div>
  )
}

function exportTab(data: Seasonality, tab: SeasTab): void {
  const range = `${data.start_year}-${data.end_year}`
  if (tab === 'heatmap') {
    exportCsv(csvFileName(data.subject, SEAS.exportName, tab, range), heatCsv(data), data.heatmap.years.length)
    return
  }
  const panel = panelOf(data, tab)
  if (!panel || !panel.available) {
    exportCsv(csvFileName(data.subject, SEAS.exportName, tab, range), '', 0)
    return
  }
  exportCsv(csvFileName(data.subject, SEAS.exportName, tab, range), panelCsv(data, panel), panel.buckets.length)
}

function Body({ query, s, set, page, subject }: {
  readonly query: SeasQuery
  readonly s: Settings
  readonly set: (next: Settings) => void
  readonly page: PanelPage | null
  readonly subject: string
}) {
  const actions = usePanelActions()
  const isHypothesis = query.kind === 'hypothesis'
  const card = useHypothesis(isHypothesis ? subject : '')
  const recordedCosts = isHypothesis ? (card.data?.card.series_costs ?? null) : null
  const noSeries = recordedCosts !== null && recordedCosts.length === 0
  const cost = recordedCosts !== null ? (recordedCosts.includes(s.cost) ? s.cost : defaultCost(recordedCosts)) : s.cost
  // A hypothesis subject is asked only once its card's recorded costs are known and non-empty: COSTS that
  // were never recorded 404 (D19), and an empty list has nothing to draw.
  const canQuery = !isHypothesis || (recordedCosts !== null && !noSeries) || card.error !== null
  const effectiveQuery: SeasQuery | null = canQuery ? (isHypothesis && cost !== null ? { ...query, cost } : query) : null
  const result = useSeasonality(effectiveQuery)
  const data = result.data
  const pageId = useId()
  const related = query.kind === 'instrument'
    ? [{ label: SEAS.actionsGp, onSelect: () => requestLine(`${subject} GP`) }]
    : [{ label: SEAS.actionsDes, onSelect: () => requestLine(`${subject} DES`) }]
  return (
    <>
      <BookBar title={SEAS.title} mnemonic="SEAS" fieldLabel={SEAS.field} placeholder={SEAS.placeholder} current={subject}
        helpLine={SEAS.helpLine} page={page} onExport={data ? () => exportTab(data, s.tab) : undefined} actions={related} />
      <TabStrip panelId={actions.panelId} label={SEAS.tabsLabel} tabs={TABS.map((id) => ({ id, label: SEAS.tabs[id] }))}
        selected={s.tab} onSelect={(id) => set({ ...s, tab: id as SeasTab })} controls={pageId} start={TAB_START} />
      <Params s={s} set={set} data={data} isHypothesis={isHypothesis} costs={recordedCosts ?? []} />
      {/* Always rendered, whatever the query state, so every tab's aria-controls resolves to a real
          tabpanel (G18): loading and error left it missing, which axe flags as aria-valid-attr-value. */}
      <div id={pageId} role="tabpanel" aria-label={SEAS.tabs[s.tab]}>
        {noSeries ? (
          <p className="seas-line mkt-warn-text" role="status">{fillCopy(SEAS.noSeries, { name: subject })}</p>
        ) : data ? (
          <>
            {s.tab === 'heatmap' ? <HeatView data={data} /> : <PanelView key={s.tab} data={data} tab={s.tab} />}
            <Notes data={data} />
          </>
        ) : (
          <QueryStatus loading={result.isPending} error={result.error} loadingText={fillCopy(SEAS.loading, { name: subject })}
            failedText={fillCopy(SEAS.failed, { name: subject })} />
        )}
      </div>
    </>
  )
}

export function queryFor(context: ScreenProps['context'], s: Settings): SeasQuery | null {
  if (!context || (context.kind !== 'instrument' && context.kind !== 'hypothesis') || !context.value) return null
  return { kind: context.kind, subject: context.value, startYear: s.startYear, endYear: s.endYear, variant: s.variant, cost: s.cost }
}

export default function SeasScreen({ context }: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const [s, set] = useState<Settings>(INITIAL)
  const query = queryFor(context, s)
  const subject = query?.subject ?? ''
  return (
    <div className="mkt books seas" ref={ref} data-screen="SEAS" role="group" aria-label={subject ? `${SEAS.title} ${subject}` : SEAS.title}>
      {query ? (
        <Body key={`${query.kind}:${subject}`} query={query} s={s} set={set} page={page} subject={subject} />
      ) : (
        <>
          <BookBar title={SEAS.title} mnemonic="SEAS" fieldLabel={SEAS.field} placeholder={SEAS.placeholder} current="" helpLine={SEAS.helpLine} page={page} />
          <EmptyGuide text={SEAS.empty} />
        </>
      )}
    </div>
  )
}
