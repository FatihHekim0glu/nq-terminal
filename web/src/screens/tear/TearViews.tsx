// The five tab views (look spec 7.5). Each names its basis and unit on a line above its chart, from
// the API section it draws. EQ: equity against the benchmark. DD: equity over the underwater curve,
// then the top drawdowns. RET: the return histogram with its normal fit and VaR lines, beside the one
// statistics scroll box, which also holds the SV7 Sharpe difference card. RR: rolling Sharpe over rolling volatility.
// MRET: the year by month heat map, then the yearly totals (a house addition, labelled so). EQ and DD also
// carry a Market context toggle: the RK5 stress windows as bands and the RG1 regime as a strip, from /extended.
// DD's top drawdowns are also drawn as episode lanes under the underwater curve, cross-highlighted with the
// table (hover on either side; Number <GO> 11 to 20 pins an episode).
import { Fragment, useCallback, useId, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { ApiError } from '../../api/client'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { Distribution } from '../../charts/echarts/Distribution'
import { Heatmap } from '../../charts/echarts/Heatmap'
import LineStack from '../../charts/LineStack'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { ROVING_ATTR, ROVING_SCROLL_ATTR } from '../../chrome/WorkspaceFocus'
import { TEAR_CONTEXT, TEAR_DD, TEAR_EQ, TEAR_MRET, TEAR_RET, TEAR_RR, TEAR_SV7 } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { Card } from './TearCard'
import type { TearCode } from './TearSheet'
import {
  basisLine, contextLines, ddStack, distributionInput, drawdownLanes, drawdownRows, eqStack, laneNotes, laneNumber, mretHeatmap, rrBandNote, rrEmpty, rrExtremes, rrStack, stackContext,
  statsNotes, statsSections, tailsNote, yearlyLadder,
  type DrawdownRowView, type RrEmpty, type StackSpec,
} from './tearCharts'
import { displayUnit, formatNumber, formatValue } from './tearFormat'
import type { Analytics } from './tearKpis'
import type { Extended } from './tearQueries'
import { readSv7, sv7Empty, sv7Ladder, sv7Notes, sv7Table, sv7Title, type Sv7 } from './tearSv7Model'
import '../../grids/grid.css'

interface ViewProps {
  readonly data: Analytics
  readonly name: string
  readonly link: PanelLink
  /** EQ and DD only: the /extended body their market context is drawn from (null or absent until it arrives). */
  readonly extended?: Extended | null
  /** EQ and DD only: why /extended failed, when it did. */
  readonly extendedError?: ApiError | null
}

const scrollBox = { [ROVING_ATTR]: '', [ROVING_SCROLL_ATTR]: '' }

/**
 * A table box that scrolls on its own in a short panel (the RET statistics, the top drawdowns): a
 * named region that holds the panel's Tab stop, so the keyboard reaches and scrolls it (WCAG 2.1.1;
 * axe scrollable-region-focusable).
 */
function ScrollRegion({ className, label, children }: { readonly className: string; readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={`${className} nqt-grid-scroll`} role="region" aria-label={label} tabIndex={0} {...scrollBox}>
      {children}
    </div>
  )
}

function useChartId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

function Basis({ data, unit, extra }: { readonly data: Analytics; readonly unit: string; readonly extra?: string }) {
  return (
    <p className="tear-basis">
      {basisLine(data, displayUnit(unit))}
      {extra ? ` ${extra}` : null}
    </p>
  )
}

/** The lanes of a DD stack: the episode to outline, and where the chart reports the lane under the pointer. */
interface LaneLink {
  readonly highlight: number | null
  readonly onHover: (rank: number | null) => void
}

/**
 * `context`: the market context layers to draw (EQ and DD, while Shown); left out, the stack is drawn as it is.
 * `lanes`: DD's episode highlight; left out, the chart neither outlines a lane nor reports one.
 * `laneRows`: how many lanes the stack draws; above 0 the chart asks for 16px a lane above its floor (tear.css),
 * so a short panel never squeezes the lanes into rows too thin to read or hover.
 */
function Stack({ spec, link, context, lanes, laneRows }: {
  readonly spec: StackSpec
  readonly link: PanelLink
  readonly context?: Pick<StackSpec, 'spans' | 'ribbon'>
  readonly lanes?: LaneLink
  readonly laneRows?: number
}) {
  const withLanes = laneRows !== undefined && laneRows > 0
  return (
    <div
      className={withLanes ? 'tear-chart tear-chart-lanes' : 'tear-chart'}
      style={withLanes ? ({ ['--tear-lane-rows' as string]: laneRows } as CSSProperties) : undefined}
    >
      <LineStack
        title={spec.title}
        t={spec.t}
        panes={spec.panes}
        link={link}
        spans={context?.spans}
        ribbon={context?.ribbon}
        highlightLane={lanes?.highlight}
        onLaneHover={lanes?.onHover}
      />
    </div>
  )
}

const CONTEXT_OPTIONS = [{ value: 'shown', label: TEAR_CONTEXT.shown }, { value: 'hidden', label: TEAR_CONTEXT.hidden }] as const

/** The context layers in words; or the note that they are still loading, or why they are not there. */
function ContextNotes({ lines, error }: { readonly lines: readonly string[]; readonly error: ApiError | null }) {
  if (lines.length > 0) return <>{lines.map((line) => <p key={line} className="tear-note">{line}</p>)}</>
  if (error) return <p className="tear-note" role="status">{fillCopy(TEAR_CONTEXT.failed, { detail: error.detail })}</p>
  return <p className="tear-note" role="status" aria-busy="true">{TEAR_CONTEXT.loading}</p>
}

/**
 * The Market context of EQ and DD (roadmap 12, part B): a Shown / Hidden toggle and, while Shown, the context
 * lines and the layers for the chart. The chart never waits for /extended: until it answers the layers are
 * simply absent and a note says so. The stack's panes are built without the layers, so switching them never
 * rebuilds the panes; only the spans and the ribbon change.
 */
function useMarketContext(t: readonly number[], extended: Extended | null | undefined, error: ApiError | null | undefined) {
  const [mode, setMode] = useState<'shown' | 'hidden'>('shown')
  const ext = extended ?? null
  const layers = useMemo(() => stackContext(ext, t), [ext, t])
  const lines = useMemo(() => contextLines(ext, t), [ext, t])
  const shown = mode === 'shown'
  const controls = (
    <>
      <div className="param-row">
        <span className="param-label">{TEAR_CONTEXT.toggle}</span>
        <ToggleGroup label={TEAR_CONTEXT.toggle} options={CONTEXT_OPTIONS} value={mode} onChange={(v) => setMode(v === 'hidden' ? 'hidden' : 'shown')} />
      </div>
      {shown ? <ContextNotes lines={lines} error={error ?? null} /> : null}
    </>
  )
  return { controls, layers: shown && ext !== null ? layers : undefined }
}

function EqView({ data, name, link, extended, extendedError }: ViewProps) {
  const spec = useMemo(() => eqStack(data, name), [data, name])
  const market = useMarketContext(spec.t, extended, extendedError)
  const { bench, perf_diff: diff, perf_diff_unit: diffUnit } = data.equity
  const note = !bench ? TEAR_EQ.benchmarkNone : diff && diffUnit ? fillCopy(TEAR_EQ.diffUnit, { unit: diffUnit }) : TEAR_EQ.diffMissing
  return (
    <>
      <Basis data={data} unit={data.equity.unit} extra={note} />
      {market.controls}
      <Stack spec={spec} link={link} context={market.layers} />
    </>
  )
}

/**
 * Which episode is marked: the one under the pointer (a lane or a table row), else the pinned one. The pin
 * belongs to the table it was made in, so a new table (another cost or frequency) starts with none. `pinned`
 * is the pin alone (never the hover), for what is announced and for aria-current.
 */
function useEpisodeMark(data: Analytics) {
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<{ readonly data: Analytics; readonly rank: number } | null>(null)
  const pinned = pin !== null && pin.data === data ? pin.rank : null
  const onHover = useCallback((rank: number | null) => setHover((current) => (current === rank ? current : rank)), [])
  const togglePin = useCallback(
    (rank: number) => setPin((current) => (current !== null && current.data === data && current.rank === rank ? null : { data, rank })),
    [data],
  )
  return { highlight: hover ?? pinned, pinned, onHover, togglePin }
}

interface DrawdownTableProps {
  readonly rows: readonly DrawdownRowView[]
  readonly unit: string
  /** The rank of the row to mark (the lane outlined in the chart), or null. */
  readonly highlight: number | null
  /** The rank pinned with Number <GO> 11 to 20, or null: the row says so with aria-current (hover never does). */
  readonly pinned: number | null
  readonly onHover: (rank: number | null) => void
}

function DrawdownTable({ rows, unit, highlight, pinned, onHover }: DrawdownTableProps) {
  const C = TEAR_DD.cols
  const heads = [C.no, C.rank, C.peak, C.trough, C.recovery, C.depth, C.toTrough, C.toRecovery, C.length]
  const numeric = new Set<string>([C.no, C.rank, C.depth, C.toTrough, C.toRecovery, C.length])
  const caption = `${TEAR_DD.tableCaption}. ${fillCopy(TEAR_DD.lengthUnit, { unit })}`
  return (
    <ScrollRegion className="tear-table" label={caption}>
      <table className="nqt-grid">
        <caption className="tear-caption">{caption}</caption>
        <thead>
          <tr>{heads.map((h) => <th key={h} scope="col" className={numeric.has(h) ? 'num' : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={heads.length} className="muted">{TEAR_DD.tableEmpty}</td></tr> : null}
          {rows.map((r) => (
            <tr
              key={r.rank}
              data-highlight={highlight === r.rank ? 'true' : undefined}
              aria-current={pinned === r.rank ? 'true' : undefined}
              onMouseEnter={() => onHover(r.rank)}
              onMouseLeave={() => onHover(null)}
            >
              <td className="num tear-no">{`${laneNumber(r.rank)})`}</td>
              <th scope="row" className="num muted tear-rank">{r.rank}</th>
              <td className="name">{r.peak}</td>
              <td className="name">{r.trough}</td>
              <td className="name">{r.recovery}</td>
              <td className="num down">{r.depth}</td>
              <td className="num">{r.toTrough}</td>
              <td className="num">{r.toRecovery}</td>
              <td className="num">{r.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

function DdView({ data, name, link, extended, extendedError }: ViewProps) {
  const spec = useMemo(() => ddStack(data, name), [data, name])
  const market = useMarketContext(spec.t, extended, extendedError)
  const rows = useMemo(() => drawdownRows(data), [data])
  const notes = useMemo(() => laneNotes(data), [data])
  const laneRows = useMemo(() => drawdownLanes(data)?.episodes.length ?? 0, [data])
  const { highlight, pinned, onHover, togglePin } = useEpisodeMark(data)
  const panelId = usePanelActions().panelId || 'tear'
  // The pin is drawn (an outline and a fill), which a screen reader cannot see: the message line says what the
  // number did, decided from the pin as it is now.
  const numbered = useMemo(
    () => rows.map((r) => ({
      n: laneNumber(r.rank),
      label: fillCopy(TEAR_DD.laneItem, { rank: r.rank }),
      run: () => {
        togglePin(r.rank)
        postMessage(fillCopy(pinned === r.rank ? TEAR_DD.laneUnpinned : TEAR_DD.lanePinned, { rank: r.rank }))
      },
    })),
    [rows, togglePin, pinned],
  )
  useNumbered(panelId, 'dd-lanes', numbered)
  const dd = data.drawdown
  const max = fillCopy(TEAR_DD.maxLine, {
    value: formatValue(dd.max_drawdown, dd.unit, 2),
    bench: formatValue(dd.bench_max_drawdown, dd.unit, 2),
  })
  return (
    <>
      <Basis data={data} unit={dd.unit} extra={max} />
      {market.controls}
      <Stack spec={spec} link={link} context={market.layers} lanes={{ highlight, onHover }} laneRows={laneRows} />
      <DrawdownTable rows={rows} unit={data.rolling.window_unit} highlight={highlight} pinned={pinned} onHover={onHover} />
      {notes.map((line) => <p key={line} className="tear-note">{line}</p>)}
    </>
  )
}

/**
 * `note`: SV7's line when the series has no Sharpe difference card, under the validity notes. `children`:
 * the SV7 card (Sv7Card), placed beside the statistics inside the same scroll box, so RET keeps exactly one
 * scrolling region and one keyboard Tab stop (WCAG 2.1.1; axe scrollable-region-focusable). With no children
 * this renders exactly as it did before the card existed.
 */
function StatsTable({ data, note, children }: { readonly data: Analytics; readonly note: string | null; readonly children?: ReactNode }) {
  const sections = useMemo(() => statsSections(data), [data])
  const table = (
    <table className="nqt-grid">
      <caption className="sr-only">{TEAR_RET.statsLabel}</caption>
      <colgroup>
        <col />
        <col className="tear-col-value" />
      </colgroup>
      {sections.map((s) => (
        <tbody key={s.id}>
          <tr className="band-row"><th scope="colgroup" colSpan={2} className="tear-band">{s.title}</th></tr>
          {s.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="name tear-rowhead">{r.label}</th>
              <td className="num tear-value">{r.value}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
  const tails = tailsNote(data)
  const notes = (
    <>
      {statsNotes(data).map((n) => <p key={n} className="tear-note">{n}</p>)}
      {tails ? <p className="tear-note">{tails}</p> : null}
      {data.validity.psr.at_benchmark_note ? (
        <p className="tear-note">{fillCopy(TEAR_RET.psrBenchNote, { note: data.validity.psr.at_benchmark_note })}</p>
      ) : null}
      {note ? <p className="tear-note">{note}</p> : null}
    </>
  )
  if (!children) {
    return (
      <ScrollRegion className="tear-stats" label={TEAR_RET.statsLabel}>
        {table}
        {notes}
      </ScrollRegion>
    )
  }
  return (
    <ScrollRegion className="tear-stats tear-stats-sv7" label={TEAR_RET.statsLabel}>
      <div className="tear-stats-cols">
        <div className="tear-stats-main">
          {table}
          {notes}
        </div>
        {children}
      </div>
    </ScrollRegion>
  )
}

/**
 * SV7 (ANALYTICS_CATALOG SV7 and C4): the screen file's Sharpe difference tests per cost. It sits in the
 * statistics' own scroll box (StatsTable), under the statistics in a narrow sheet and beside them where
 * the sheet is at least 1180px wide (tear.css @container tear (min-width: 1180px)), so RET stays one
 * scrolling region with one keyboard Tab stop. It is a group, not a region: the statistics' ScrollRegion
 * is the panel's only landmark and its only roving scroll stop. The Ledoit-Wolf points are bars with their
 * 90% intervals as whiskers; the table under them has every measure per cost. The tag is fixed [PRE-REG]
 * from copy (TEAR_SV7.tag), never the series tag (G07): these numbers are read from the screen file, a
 * registered result, whatever the series itself is tagged. The validity rows below (PSR, MinTRL) keep the
 * series tag, since the terminal computes those.
 */
function Sv7Card({ sv7, name }: { readonly sv7: Sv7; readonly name: string }) {
  const ladder = useMemo(() => sv7Ladder(sv7, name), [sv7, name])
  const table = useMemo(() => sv7Table(sv7), [sv7])
  const chartId = useChartId('tear-sv7')
  const title = sv7Title(sv7)
  const span = table.columns.length + 1
  return (
    <div className="tear-sv7" role="group" aria-label={TEAR_SV7.regionLabel}>
      <Card title={title} tag={TEAR_SV7.tag}>
        <p className="tear-basis">{TEAR_SV7.basis}</p>
        <div className="tear-chart tear-chart-short"><BarLadder data={ladder} chartId={chartId} /></div>
        <table className="nqt-grid">
          <caption className="sr-only">{fillCopy(TEAR_SV7.caption, { label: title })}</caption>
          <colgroup>
            <col />
            {table.columns.map((c) => <col key={c.id} className="tear-col-value" />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{TEAR_SV7.measure}</th>
              {table.columns.map((c) => <th key={c.id} scope="col" className="num">{c.label}</th>)}
            </tr>
          </thead>
          {table.sections.map((s) => (
            <tbody key={s.id}>
              {s.title ? <tr className="band-row"><th scope="colgroup" colSpan={span} className="tear-band">{s.title}</th></tr> : null}
              {s.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="name tear-rowhead">{r.label}</th>
                  {r.values.map((v, i) => <td key={table.columns[i]?.id ?? i} className="num tear-value">{v}</td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <p className="tear-note">{TEAR_SV7.pNote}</p>
        {sv7Notes(sv7).map((note) => <p key={note} className="tear-note">{note}</p>)}
      </Card>
    </div>
  )
}

function RetView({ data, name }: ViewProps) {
  const input = useMemo(() => distributionInput(data, name), [data, name])
  const sv7 = useMemo(() => readSv7(data.validity.sharpe_difference_tests), [data])
  const chartId = useChartId('tear-dist')
  const h = data.distribution.histogram
  return (
    <>
      <Basis data={data} unit={h.unit} extra={fillCopy(TEAR_RET.binRule, { rule: h.bin_rule })} />
      {data.distribution.series.t.length > 0 ? <p className="tear-basis">{fillCopy(TEAR_RET.seriesNote, { unit: displayUnit(data.distribution.series.unit) })}</p> : null}
      <div className="tear-split">
        <div className="tear-chart">{input ? <Distribution data={input} chartId={chartId} /> : null}</div>
        <StatsTable data={data} note={sv7Empty(sv7)}>
          {sv7.rows.length > 0 ? <Sv7Card sv7={sv7} name={name} /> : null}
        </StatsTable>
      </div>
    </>
  )
}

/** RR panes with nothing to draw: the note in place of a scale the data does not have. */
function EmptyPanes({ title, empty }: { readonly title: string; readonly empty: RrEmpty }) {
  return (
    <div className="tear-chart tear-empty-stack" role="group" aria-label={title}>
      {empty.panes.map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 ? <div className="chart-splitter" aria-hidden="true" /> : null}
          <section className="tear-empty-pane" aria-label={p.title}>
            <h3 className="tear-empty-title">{p.title}</h3>
            <p className="tear-empty-text">{p.text}</p>
          </section>
        </Fragment>
      ))}
    </div>
  )
}

function RrView({ data, name, link }: ViewProps) {
  const spec = useMemo(() => rrStack(data, name), [data, name])
  const bandNote = useMemo(() => rrBandNote(data), [data])
  const empty = useMemo(() => rrEmpty(data), [data])
  const r = data.rolling
  const full = fillCopy(TEAR_RR.full, { sharpe: formatNumber(r.full_sharpe, 2), vol: formatValue(r.full_vol, r.vol_unit, 2) })
  return (
    <>
      <Basis data={data} unit={`${r.sharpe_unit}; ${displayUnit(r.vol_unit)}`} extra={empty.longNote ? `${full} ${empty.longNote}` : full} />
      {empty.panes.length > 0 ? <EmptyPanes title={spec.title} empty={empty} /> : <Stack spec={spec} link={link} />}
      <ul className="tear-extremes" aria-label={TEAR_RR.extremesLabel}>
        {rrExtremes(data).map((line) => <li key={line}>{line}</li>)}
      </ul>
      {bandNote && empty.panes.length === 0 ? <p className="tear-note">{bandNote}</p> : null}
    </>
  )
}

function MretView({ data, name }: ViewProps) {
  const heat = useMemo(() => mretHeatmap(data, name), [data, name])
  const yearly = useMemo(() => yearlyLadder(data, name), [data, name])
  const heatId = useChartId('tear-mret')
  const yearlyId = useChartId('tear-yearly')
  const m = data.monthly
  return (
    <>
      <Basis data={data} unit={displayUnit(m.unit)} extra={`${fillCopy(TEAR_MRET.aggregation, { text: m.aggregation })} ${TEAR_MRET.average}`} />
      <div className="tear-chart tear-chart-heat"><Heatmap data={heat} chartId={heatId} /></div>
      <p className="tear-basis">{TEAR_MRET.yearlyNote}</p>
      <div className="tear-chart tear-chart-short"><BarLadder data={yearly} chartId={yearlyId} /></div>
    </>
  )
}

const VIEWS: Readonly<Record<TearCode, (props: ViewProps) => JSX.Element>> = {
  EQ: EqView,
  DD: DdView,
  RET: RetView,
  RR: RrView,
  MRET: MretView,
}

export function TearView({ tab, ...props }: ViewProps & { readonly tab: TearCode }) {
  const View = VIEWS[tab]
  return <View {...props} />
}
