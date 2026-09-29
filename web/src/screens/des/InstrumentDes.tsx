// DES for an instrument (look spec 7.3 "Instrument DES", futures DES model), from GET
// /api/instruments/{root} (no price is read for it) and the command index for the display name:
//   1) Profile        contract specifications, trading hours (what nq-lab records), related dates
//                     (the last-trading and first-notice rules, the paper book's MNQ roll), and the
//                     price chart card (one year of daily bars through the gate, as GP draws them)
//   2) Coverage       the processed series from parquet footers, the in-sample window, gate reads
//   3) Notes          data caveats: the fence, the collapsed 1m days, repair provenance
//   4) Contracts (CT) the month-code strip Jan:F ... Dec:Z, listed months in white where recorded
// `98) Report` saves the description as Markdown. Nothing is filled in from outside knowledge: a field
// nq-lab does not record stays empty and the page says so.
import { useId, useRef, useState, type ReactNode } from 'react'
import { useCommands } from '../../api/queries'
import { useInstrument } from '../../api/queries.screens'
import type { Schemas } from '../../api/types'
import { saveText } from '../../chrome/download'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import TabStrip from '../../chrome/TabStrip'
import { displayInstrument } from '../../commands/sectors'
import { DES, DES_REPORT } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { decimalsFor } from '../runs/model'
import InstrumentPreview from '../gp/InstrumentPreview'
import { DesBar, DesCard, LoadError, Pairs, Status } from './DesParts'
import { MISSING } from './desModel'
import { instrumentReport } from './desReport'

export interface InstrumentDesProps {
  readonly root: string
  /** The panel's link group, shared with the price chart's crosshair. */
  readonly link?: PanelLink
}

type Detail = Schemas['InstrumentDes']
type Tab = 'profile' | 'coverage' | 'notes' | 'contracts'
const TABS: readonly Tab[] = ['profile', 'coverage', 'notes', 'contracts']
const K = DES.instrument

const text = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? MISSING : v)
const MIN_USD_DECIMALS = 2
// At least cents, but never fewer decimals than the value needs (D24): ZN's tick value (15.625) and
// cost per side (18.125) would otherwise round to 15.63 and 18.13, contradicting the Tick row (0.015625).
const usd = (v: number) => fillCopy(K.usd, { value: v.toFixed(Math.max(MIN_USD_DECIMALS, decimalsFor([v]))) })

export function ContractCard({ d, name }: { readonly d: Detail; readonly name: string }) {
  const c = d.contract
  return (
    <DesCard title={K.contract}>
      {c ? (
        <>
          <Pairs
            rows={[
              [K.symbol, c.symbol], [K.venue, c.venue], [K.sector, c.sector], [K.units, c.units], [K.tick, String(c.tick)],
              [K.tickUsd, usd(c.tick_usd)], [K.pointValue, usd(c.point_value_usd)], [K.costPerSide, usd(c.cost_per_side_1tick_usd)],
            ]}
          />
          <p className="des-note">{fillCopy(K.sourceLine, { source: c.source })}</p>
        </>
      ) : <p className="des-note">{fillCopy(K.contractNone, { name })}</p>}
    </DesCard>
  )
}

function HoursCard({ d }: { readonly d: Detail }) {
  return (
    <DesCard title={K.hours}>
      <Pairs rows={d.hours.map((h) => [h.label, h.value] as const)} />
      <p className="des-note">{d.hours_note}</p>
    </DesCard>
  )
}

function RelatedCard({ d }: { readonly d: Detail }) {
  const r = d.related
  return (
    <DesCard title={K.related}>
      <Pairs
        rows={[
          [K.lastTrading, text(r.last_trading_rule)], [K.firstNotice, text(r.first_notice_rule)], [K.rollRule, text(r.roll_rule)],
          [K.nextContract, text(r.next_contract)], [K.nextRoll, text(r.next_roll)], [K.asOf, text(r.as_of_et)],
        ]}
      />
      <p className="des-note">{fillCopy(K.sourceLine, { source: r.source })}</p>
    </DesCard>
  )
}

function Profile({ d, name, link }: { readonly d: Detail; readonly name: string; readonly link: PanelLink }) {
  const actions = usePanelActions()
  return (
    <div className="des-page">
      <div className="des-cols">
        <div className="des-col"><ContractCard d={d} name={name} /></div>
        <div className="des-col"><HoursCard d={d} /></div>
        <div className="des-col"><RelatedCard d={d} /></div>
      </div>
      <DesCard title={K.chart} jump={{ label: fillCopy(DES.go, { code: 'GP' }), name: DES.jumpNames.GP, onRun: () => actions.open('GP') }}>
        <InstrumentPreview root={d.root} link={link} />
        <p className="des-note">{fillCopy(K.chartNote, { name })}</p>
      </DesCard>
    </div>
  )
}

function Coverage({ d, name }: { readonly d: Detail; readonly name: string }) {
  const c = K.columns
  const cov = d.coverage
  const series = cov.series
  return (
    <div className="des-page">
      <DesCard title={K.coverage}>
        <Pairs
          rows={[
            [K.fence, fillCopy(K.fenceValue, { start: cov.fence.is_start, end: cov.fence.is_end })],
            [K.inSample, fillCopy(K.inSampleValue, { from: text(cov.in_sample_from), to: cov.in_sample_to })],
            [K.gateLogged, String(cov.gate_reads_logged)],
            [K.gateProcess, String(cov.gate_reads_this_process)],
          ]}
        />
        {series.length === 0 ? <p className="des-note">{fillCopy(K.coverageNone, { name })}</p> : (
          <table className="nqt-grid des-table">
            <caption className="des-caption">{fillCopy(K.coverageCaption, { name })}</caption>
            <thead>
              <tr>
                <th scope="col">{c.timeframe}</th><th scope="col">{c.variant}</th><th scope="col">{c.file}</th>
                <th scope="col" className="num">{c.rows}</th><th scope="col">{c.first}</th><th scope="col">{c.fence}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.file}>
                  <td className="name">{s.timeframe}</td>
                  <td>{s.variant}</td>
                  <td>{s.file}</td>
                  <td className="num">{s.rows === null ? MISSING : s.rows.toLocaleString('en-GB')}</td>
                  <td>{s.first_ts ?? MISSING}</td>
                  <td>{s.extends_past_fence === null ? MISSING : s.extends_past_fence ? K.yes : K.no}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DesCard>
    </div>
  )
}

function Notes({ d, name }: { readonly d: Detail; readonly name: string }) {
  return (
    <div className="des-page">
      <DesCard title={K.notes}>
        {d.notes.length === 0 ? <p className="des-note">{fillCopy(K.notesNone, { name })}</p> : (
          <ul className="des-notes" aria-label={K.notes}>
            {d.notes.map((n) => (
              <li key={n.title}>
                <span className="des-notes-title">{n.title}</span> {n.text} <span className="des-notes-source">{`(${n.source})`}</span>
              </li>
            ))}
          </ul>
        )}
      </DesCard>
    </div>
  )
}

function Contracts({ d, name }: { readonly d: Detail; readonly name: string }) {
  return (
    <div className="des-page">
      <DesCard title={K.monthStrip}>
        <ul className="des-months" aria-label={K.monthStrip}>
          {d.month_codes.map((m) => (
            <li key={m.code} className={m.active ? 'des-month-on' : 'des-month'}>
              {`${m.name}:${m.code}`}
              {m.active ? <span className="sr-only">{` ${K.listed}`}</span> : null}
            </li>
          ))}
        </ul>
        <p className="des-note">{d.cycle_source ? fillCopy(K.cycleSource, { source: d.cycle_source }) : fillCopy(K.cycleNone, { name })}</p>
      </DesCard>
      <RelatedCard d={d} />
    </div>
  )
}

function Page({ tab, d, name, link }: { readonly tab: Tab; readonly d: Detail; readonly name: string; readonly link: PanelLink }): ReactNode {
  if (tab === 'coverage') return <Coverage d={d} name={name} />
  if (tab === 'notes') return <Notes d={d} name={name} />
  if (tab === 'contracts') return <Contracts d={d} name={name} />
  return <Profile d={d} name={name} link={link} />
}

function report(d: Detail, name: string): void {
  const file = fillCopy(DES_REPORT.fileName, { name: d.root })
  const saved = saveText(file, instrumentReport(d, name), 'text/markdown;charset=utf-8')
  postMessage(saved ? fillCopy(DES_REPORT.done, { file }) : DES_REPORT.unavailable, saved ? 'info' : 'error')
}

export default function InstrumentDes({ root, link = '-' }: InstrumentDesProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const actions = usePanelActions()
  const commands = useCommands()
  const query = useInstrument(root)
  const [tab, setTab] = useState<Tab>('profile')
  const pageId = useId()
  const name = displayInstrument(root, commands.data ?? null)
  const d = query.data
  return (
    <div className="des" ref={ref} role="group" aria-label={fillCopy(DES.bodyLabel, { name })}>
      <DesBar title={DES.instrumentTitle} page={page} onReport={d ? () => report(d, name) : undefined} />
      {d ? (
        <TabStrip
          panelId={actions.panelId}
          label={K.tabsLabel}
          tabs={TABS.map((id) => ({ id, label: K.tabs[id] }))}
          selected={tab}
          onSelect={(id) => setTab(id as Tab)}
          controls={pageId}
        />
      ) : null}
      {query.isPending ? <Status>{fillCopy(K.loadingInstrument, { name })}</Status> : null}
      {query.isError ? <LoadError name={root} error={query.error} /> : null}
      {d ? (
        <>
          <div className="des-head-block">
            <div className="des-head" data-testid="des-head">
              <h3 className="des-name">{name}</h3>
              <span className="des-spec">{d.label}</span>
            </div>
          </div>
          <div id={pageId} role="tabpanel" aria-label={K.tabs[tab]}>
            <Page tab={tab} d={d} name={name} link={link} />
          </div>
        </>
      ) : null}
    </div>
  )
}
