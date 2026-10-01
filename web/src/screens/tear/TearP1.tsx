// The P1 views under the tear sheet's tab view (TASKS Phase 10 on screen), in the body's scroll like the run
// books, DES-style cards, each [POST HOC] and descriptive (UI_SPEC section 6; ANALYTICS_CATALOG C7):
//   EQ   SV5 bootstrap intervals (Sharpe, CAGR, max drawdown) and the SV6 resampled cone;
//   RET  PF7 to PF9 tiles, RK3 normal and Cornish-Fisher VaR (greyed outside the monotone domain), PF11 ulcer index
//        and recovery factor with RK4 modified expected shortfall (P2), RD4 Jarque-Bera on the whole series with
//        the RD3 QQ plot, then RK5 stress windows as a panel of their own;
//   RR   RL3 and RL4 rolling beta and correlation, BR3 capture, BR5 Treynor (P2), BR4 scatter, RG1 volatility
//        regimes (Welch t, no p-value) and RG2 trend regime (P2). RR's rolling Sharpe carries the RL1 ranges
//        (TearViews).
// DD and MRET have no P1 view. Each chart keeps its summary and table view.
import { useId, useMemo, type JSX } from 'react'
import { Cone } from '../../charts/echarts/Cone'
import { XyScatter } from '../../charts/echarts/XyScatter'
import LineStack from '../../charts/LineStack'
import { TEAR_P1 as P } from '../../copy/tearP1'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { TrendRegimeHost } from '../p2rct/hosts'
import RiskExtrasLive from '../riskextras/RiskExtrasLive'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import { Card, Pending, Rows, ScrollRegion, chartId } from './TearCard'
import type { TearCode } from './TearSheet'
import type { Analytics } from './tearKpis'
import {
  bootstrapLine, captureRows, cfMoments, cfRows, coneInput, intervalRows, jarqueBeraRows, qqInput, ratioTiles, regimeRows, relativeEmpty, relativeFull,
  relativeStack, scatterInput, stressMonthlyNote, stressRows, unlabelledLine, welchLine,
} from './tearP1Model'
import {
  BOOTSTRAP_MIN_N, bootstrapPossible, useTearBootstrap, useTearExtended, useTearTrend, type Bootstrap, type Extended, type Freq, type TearTarget,
} from './tearQueries'

export interface TearP1Props {
  readonly target: TearTarget
  readonly tab: TearCode
  readonly data: Analytics
  readonly freq: Freq
  readonly cost: number | null
  readonly link: PanelLink
}

const I = P.bootstrap.cols

function IntervalsCard({ boot }: { readonly boot: Bootstrap }) {
  const rows = useMemo(() => intervalRows(boot), [boot])
  return (
    <Card title={P.bootstrap.title} tag={boot.tag}>
      <p className="tear-basis">{bootstrapLine(boot)}</p>
      <table className="nqt-grid tear-kv">
        <caption className="sr-only">{P.bootstrap.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{I.statistic}</th>
            {[I.point, I.interval, I.median, I.sd].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="name tear-rowhead">{r.label}</th>
              <td className="num tear-value">{r.point}</td>
              <td className="num tear-value">{r.interval}</td>
              <td className="num">{r.median}</td>
              <td className="num">{r.sd}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.filter((r) => r.note).map((r) => <p key={r.id} className="tear-note">{`${r.label}: ${r.note}`}</p>)}
      {rows.filter((r) => r.undefinedNote).map((r) => <p key={`${r.id}-undefined`} className="tear-note">{r.undefinedNote}</p>)}
      <p className="tear-note">{P.bootstrap.mertens}</p>
    </Card>
  )
}

function ConeCard({ boot, name }: { readonly boot: Bootstrap; readonly name: string }) {
  const input = useMemo(() => coneInput(boot, name), [boot, name])
  const uid = useId()
  const c = boot.cone
  return (
    <Card title={P.cone.title} tag={boot.tag}>
      <p className="tear-basis">{fillCopy(P.cone.basis, { unit: c.unit, how: c.how === 'summed' ? P.cone.summed : P.cone.compounded, horizon: c.horizon })}</p>
      <div className="tear-chart tear-chart-p1"><Cone data={input} chartId={chartId('tear-cone', uid)} /></div>
    </Card>
  )
}

function RatiosCard({ ext }: { readonly ext: Extended }) {
  const tiles = useMemo(() => ratioTiles(ext), [ext])
  return (
    <Card title={P.ratios.title} tag={ext.tag}>
      <KpiRow label={P.ratios.label}>
        {tiles.map((t) => <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} description={t.description} unit={t.unit} />)}
      </KpiRow>
    </Card>
  )
}

const CF = P.cf.cols

function CfCard({ ext }: { readonly ext: Extended }) {
  const cf = ext.cornish_fisher_var
  const rows = useMemo(() => cfRows(cf), [cf])
  return (
    <Card title={P.cf.title} tag={ext.tag} className="tear-card-span2">
      <table className="nqt-grid tear-kv">
        <caption className="tear-caption">{fillCopy(P.cf.caption, { horizon: cf.horizon })}</caption>
        <thead>
          <tr>
            <th scope="col">{CF.level}</th>
            {[CF.normal, CF.historical, CF.cornishFisher, CF.raw, CF.value].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
            <th scope="col">{CF.used}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.level}>
              <th scope="row" className="name tear-rowhead">{r.level}</th>
              <td className={r.greyed ? ['num', 'muted'].join(' ') : 'num'}>{r.normal}</td>
              <td className="num">{r.historical}</td>
              <td className="num">{r.cornishFisher}</td>
              <td className="num muted">{r.raw}</td>
              <td className={['num', r.greyed ? 'muted' : 'tear-value'].join(' ')}>{r.value}</td>
              <td className={r.greyed ? 'muted' : undefined} title={r.method}>{r.used}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tear-note">{cfMoments(cf)}</p>
      <p className="tear-note">{cf.domain}</p>
    </Card>
  )
}

function NormalityCard({ ext, data, name }: { readonly ext: Extended; readonly data: Analytics; readonly name: string }) {
  const qq = useMemo(() => qqInput(data, name), [data, name])
  const uid = useId()
  return (
    <Card title={P.jb.title} tag={ext.tag}>
      <Rows caption={P.jb.caption} rows={jarqueBeraRows(ext)} visibleCaption />
      <p className="tear-note">{ext.jarque_bera.note}</p>
      {qq ? (
        <>
          <p className="tear-basis">{data.distribution.qq.label}</p>
          <div className="tear-chart tear-chart-p1"><XyScatter data={qq} chartId={chartId('tear-qq', uid)} /></div>
        </>
      ) : null}
    </Card>
  )
}

const S = P.stress.cols

function StressPanel({ ext }: { readonly ext: Extended }) {
  const rows = useMemo(() => stressRows(ext), [ext])
  const st = ext.stress
  return (
    <Card title={P.stress.title} tag={st.tag} className="tear-card-wide">
      <p className="tear-basis">{fillCopy(P.stress.basis, { frozen: st.frozen, basis: st.basis, unit: st.unit })}</p>
      <ScrollRegion label={P.stress.caption}>
        <table className="nqt-grid">
          <caption className="tear-caption">{P.stress.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{S.window}</th>
              <th scope="col">{S.dates}</th>
              <th scope="col">{S.covered}</th>
              {[S.nq, S.strategy, S.bench, S.maxDd, S.n].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="name tear-rowhead">
                  {r.label}
                  {r.spent ? <span className="tear-spent">{` ${P.stress.spentTag}`}</span> : null}
                </th>
                <td className="name">{r.window}</td>
                <td className="name">{r.covered}</td>
                <td className="num">{r.nq}</td>
                <td className="num tear-value">{r.strategy}</td>
                <td className="num">{r.bench}</td>
                <td className="num">{r.maxDd}</td>
                <td className="num">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {stressMonthlyNote(ext) ? <p className="tear-note">{stressMonthlyNote(ext)}</p> : null}
      {rows.some((r) => r.spent) ? <p className="tear-note">{P.stress.spentNote}</p> : null}
      {st.spent_note ? <p className="tear-note">{st.spent_note}</p> : null}
    </Card>
  )
}

function RelativeCard({ ext, name, link }: { readonly ext: Extended; readonly name: string; readonly link: PanelLink }) {
  const spec = useMemo(() => relativeStack(ext, name), [ext, name])
  if (!spec) return <Card title={P.relative.title} tag={ext.tag}><p className="tear-note">{fillCopy(P.none, { note: ext.relative_note ?? '' })}</p></Card>
  const empty = relativeEmpty(ext)
  return (
    <Card title={P.relative.title} tag={ext.tag}>
      <p className="tear-basis">{relativeFull(ext)}</p>
      {empty ? <p className="tear-note">{empty}</p> : <div className="tear-chart tear-chart-p1"><LineStack title={spec.title} t={spec.t} panes={spec.panes} link={link} /></div>}
    </Card>
  )
}

function CaptureCard({ ext }: { readonly ext: Extended }) {
  const rows = captureRows(ext)
  return (
    <Card title={P.capture.title} tag={ext.tag}>
      {ext.capture ? (
        <>
          <p className="tear-basis">{ext.capture.label}</p>
          <Rows caption={P.capture.caption} rows={rows} />
        </>
      ) : <p className="tear-note">{fillCopy(P.none, { note: ext.relative_note ?? '' })}</p>}
    </Card>
  )
}

function ScatterCard({ ext, name }: { readonly ext: Extended; readonly name: string }) {
  const input = useMemo(() => scatterInput(ext, name), [ext, name])
  const uid = useId()
  const s = ext.scatter
  if (!input || !s) return <Card title={P.scatter.title} tag={ext.tag}><p className="tear-note">{fillCopy(P.none, { note: ext.relative_note ?? '' })}</p></Card>
  return (
    <Card title={P.scatter.title} tag={ext.tag}>
      <p className="tear-basis">{fillCopy(P.scatter.axes, { x: s.x_label, y: s.y_label, unit: s.unit })}</p>
      <div className="tear-chart tear-chart-p1"><XyScatter data={input} chartId={chartId('tear-scatter', uid)} /></div>
    </Card>
  )
}

const G = P.regimes.cols

function RegimesCard({ ext }: { readonly ext: Extended }) {
  const g = ext.regimes
  if (!g) return <Card title={P.regimes.title} tag={ext.tag}><p className="tear-note">{fillCopy(P.none, { note: ext.regimes_note ?? '' })}</p></Card>
  const rows = regimeRows(ext)
  return (
    <Card title={P.regimes.title} tag={g.tag}>
      <p className="tear-basis">{g.label}</p>
      <table className="nqt-grid tear-kv">
        <caption className="sr-only">{P.regimes.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{G.regime}</th>
            {[G.n, G.mean, G.sharpe, G.hit].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.regime}>
              <th scope="row" className="name tear-rowhead">{r.name}</th>
              <td className="num">{r.n}</td>
              <td className="num">{r.mean}</td>
              <td className="num tear-value">{r.sharpe}</td>
              <td className="num">{r.hit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tear-note">{welchLine(ext)}</p>
      <p className="tear-note">{unlabelledLine(ext)}</p>
      <p className="tear-note">{g.source}</p>
    </Card>
  )
}

/** RG2: the trend regime beside RG1. A run has no monthly view, so the card is left out for a run at Freq M. */
function TrendCard({ target, freq, cost, link }: TearP1Props) {
  const trend = useTearTrend(target, freq, cost, true)
  if (target.kind === 'run' && freq === 'M') return null
  return <TrendRegimeHost query={trend} link={link} />
}

function EqCards({ target, freq, cost, data }: TearP1Props) {
  const possible = bootstrapPossible(data.n)
  const boot = useTearBootstrap(target, freq, cost, possible)
  if (!possible) {
    return <Card title={P.bootstrap.title} tag={data.tag}><p className="tear-note">{fillCopy(P.bootstrap.tooShort, { min: BOOTSTRAP_MIN_N, n: data.n })}</p></Card>
  }
  if (!boot.data) return <Card title={P.bootstrap.title}><Pending error={boot.error} failed={P.failed} loading={P.loading} /></Card>
  return (
    <>
      <IntervalsCard boot={boot.data} />
      <ConeCard boot={boot.data} name={target.name} />
    </>
  )
}

function ExtendedCards({ props, children }: { readonly props: TearP1Props; readonly children: (ext: Extended) => JSX.Element }) {
  const ext = useTearExtended(props.target, props.freq, props.cost, true)
  if (!ext.data) return <Card title={P.heading}><Pending error={ext.error} failed={P.failed} loading={P.loading} /></Card>
  return children(ext.data)
}

function TabCards(props: TearP1Props) {
  const { tab, target, data, link } = props
  if (tab === 'EQ') return <EqCards {...props} />
  if (tab === 'RET') {
    return (
      <ExtendedCards props={props}>
        {(ext) => (
          <>
            <RatiosCard ext={ext} />
            <CfCard ext={ext} />
            <RiskExtrasLive tab="RET" target={target} freq={props.freq} cost={props.cost} />
            <NormalityCard ext={ext} data={data} name={target.name} />
            <StressPanel ext={ext} />
          </>
        )}
      </ExtendedCards>
    )
  }
  return (
    <ExtendedCards props={props}>
      {(ext) => (
        <>
          <RelativeCard ext={ext} name={target.name} link={link} />
          <CaptureCard ext={ext} />
          <RiskExtrasLive tab="RR" target={target} freq={props.freq} cost={props.cost} />
          <ScatterCard ext={ext} name={target.name} />
          <RegimesCard ext={ext} />
          <TrendCard {...props} />
        </>
      )}
    </ExtendedCards>
  )
}

/** The tabs with P1 views; DD and MRET have none. */
export function hasP1(tab: TearCode): boolean {
  return tab === 'EQ' || tab === 'RET' || tab === 'RR'
}

export default function TearP1(props: TearP1Props) {
  if (!hasP1(props.tab)) return null
  return (
    <section className="tear-books tear-p1" aria-label={fillCopy(P.headingLabel, { name: props.target.name })}>
      <h3 className="tear-books-heading">{P.heading}</h3>
      <p className="tear-note">{P.descriptive}</p>
      <div className="tear-books-grid">
        <TabCards {...props} />
      </div>
    </section>
  )
}
