// The five tab views (look spec 7.5). Each names its basis and unit on a line above its chart, from
// the API section it draws. EQ: equity against the benchmark. DD: equity over the underwater curve,
// then the top drawdowns. RET: the return histogram with its normal fit and VaR lines, beside the
// statistics panel. RR: rolling Sharpe over rolling volatility. MRET: the year by month heat map,
// then the yearly totals (a house addition, labelled so).
import { Fragment, useId, useMemo, type JSX } from 'react'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { Distribution } from '../../charts/echarts/Distribution'
import { Heatmap } from '../../charts/echarts/Heatmap'
import LineStack from '../../charts/LineStack'
import { TEAR_DD, TEAR_EQ, TEAR_MRET, TEAR_RET, TEAR_RR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import type { TearCode } from './TearSheet'
import {
  basisLine, ddStack, distributionInput, drawdownRows, eqStack, mretHeatmap, rrEmpty, rrStack, statsNotes, statsSections, yearlyLadder,
  type RrEmpty, type StackSpec,
} from './tearCharts'
import { displayUnit, formatNumber, formatValue } from './tearFormat'
import type { Analytics } from './tearKpis'
import '../../grids/grid.css'

interface ViewProps {
  readonly data: Analytics
  readonly name: string
  readonly link: PanelLink
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

function Stack({ spec, link }: { readonly spec: StackSpec; readonly link: PanelLink }) {
  return (
    <div className="tear-chart">
      <LineStack title={spec.title} t={spec.t} panes={spec.panes} link={link} />
    </div>
  )
}

function EqView({ data, name, link }: ViewProps) {
  const spec = useMemo(() => eqStack(data, name), [data, name])
  const note = data.equity.bench ? TEAR_EQ.diffMissing : TEAR_EQ.benchmarkNone
  return (
    <>
      <Basis data={data} unit={data.equity.unit} extra={note} />
      <Stack spec={spec} link={link} />
    </>
  )
}

function DrawdownTable({ data }: { readonly data: Analytics }) {
  const rows = useMemo(() => drawdownRows(data), [data])
  const C = TEAR_DD.cols
  const heads = [C.rank, C.peak, C.trough, C.recovery, C.depth, C.toTrough, C.toRecovery, C.length]
  const unit = data.rolling.window_unit
  return (
    <div className="tear-table nqt-grid-scroll">
      <table className="nqt-grid">
        <caption className="tear-caption">{`${TEAR_DD.tableCaption}. ${fillCopy(TEAR_DD.lengthUnit, { unit })}`}</caption>
        <thead>
          <tr>{heads.map((h, i) => <th key={h} scope="col" className={i === 0 || i >= 4 ? 'num' : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={heads.length} className="muted">{TEAR_DD.tableEmpty}</td></tr> : null}
          {rows.map((r) => (
            <tr key={r.rank}>
              <td className="num muted">{r.rank}</td>
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
    </div>
  )
}

function DdView({ data, name, link }: ViewProps) {
  const spec = useMemo(() => ddStack(data, name), [data, name])
  const dd = data.drawdown
  const max = fillCopy(TEAR_DD.maxLine, {
    value: formatValue(dd.max_drawdown, dd.unit, 2),
    bench: formatValue(dd.bench_max_drawdown, dd.unit, 2),
  })
  return (
    <>
      <Basis data={data} unit={dd.unit} extra={max} />
      <Stack spec={spec} link={link} />
      <DrawdownTable data={data} />
    </>
  )
}

function StatsTable({ data }: { readonly data: Analytics }) {
  const sections = useMemo(() => statsSections(data), [data])
  return (
    <div className="tear-stats nqt-grid-scroll">
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
      {statsNotes(data).map((note) => <p key={note} className="tear-note">{note}</p>)}
      {data.validity.psr.at_benchmark_note ? (
        <p className="tear-note">{fillCopy(TEAR_RET.psrBenchNote, { note: data.validity.psr.at_benchmark_note })}</p>
      ) : null}
    </div>
  )
}

function RetView({ data, name }: ViewProps) {
  const input = useMemo(() => distributionInput(data, name), [data, name])
  const chartId = useChartId('tear-dist')
  const h = data.distribution.histogram
  return (
    <>
      <Basis data={data} unit={h.unit} extra={fillCopy(TEAR_RET.binRule, { rule: h.bin_rule })} />
      <div className="tear-split">
        <div className="tear-chart">{input ? <Distribution data={input} chartId={chartId} /> : null}</div>
        <StatsTable data={data} />
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
  const empty = useMemo(() => rrEmpty(data), [data])
  const r = data.rolling
  const full = fillCopy(TEAR_RR.full, { sharpe: formatNumber(r.full_sharpe, 2), vol: formatValue(r.full_vol, r.vol_unit, 2) })
  return (
    <>
      <Basis data={data} unit={`${r.sharpe_unit}; ${displayUnit(r.vol_unit)}`} extra={empty.longNote ? `${full} ${empty.longNote}` : full} />
      {empty.panes.length > 0 ? <EmptyPanes title={spec.title} empty={empty} /> : <Stack spec={spec} link={link} />}
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
