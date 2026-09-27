// DES for an instrument (look spec 7.3 "Instrument DES", futures DES model): the generic ticker, root,
// continuous symbol and sector from /api/commands, the in-sample window and the terminal's gate reads from
// /api/health, and the processed price series the catalog lists from parquet footers (no rows
// read), plus the quote header and a one-year daily chart from the same bars read as GP.
// Contract specifications, trading hours and roll dates are not served by the API; the page
// says so rather than inventing them.
import { useRef } from 'react'
import { useCatalog, useCommands, useHealth } from '../../api/queries'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import { displayInstrument } from '../../commands/sectors'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import InstrumentPreview from '../gp/InstrumentPreview'
import { DesBar, DesCard, LoadError, Pairs, Status } from './DesParts'
import { MISSING } from './desModel'

export interface InstrumentDesProps {
  readonly root: string
  /** The panel's link group, shared with the price chart's crosshair. */
  readonly link?: PanelLink
}

type CatalogSeries = NonNullable<ReturnType<typeof useCatalog>['data']>['series'][number]

function Coverage({ name, series }: { readonly name: string; readonly series: readonly CatalogSeries[] }) {
  const c = DES.instrument.columns
  if (series.length === 0) return <p className="des-note">{fillCopy(DES.instrument.coverageNone, { name })}</p>
  return (
    <table className="nqt-grid des-table">
      <caption className="des-caption">{fillCopy(DES.instrument.coverageCaption, { name })}</caption>
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
            <td>{s.extends_past_fence === null ? MISSING : s.extends_past_fence ? DES.instrument.yes : DES.instrument.no}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function InstrumentDes({ root, link = '-' }: InstrumentDesProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const actions = usePanelActions()
  const commands = useCommands()
  const catalog = useCatalog()
  const health = useHealth()
  const index = commands.data ?? null
  const instrument = index?.instruments.find((i) => i.root === root)
  const name = displayInstrument(root, index)
  const k = DES.instrument
  const fence = health.data?.fence
  const series = (catalog.data?.series ?? []).filter((s) => s.root === root)
  return (
    <div className="des" ref={ref} role="group" aria-label={fillCopy(DES.bodyLabel, { name })}>
      <DesBar title={DES.instrumentTitle} page={page} />
      {commands.isPending ? <Status>{fillCopy(DES.loading, { name: root })}</Status> : null}
      {commands.isError ? <LoadError name={root} error={commands.error} /> : null}
      {index && !instrument ? <p className="des-status">{fillCopy(k.unknown, { name: root })}</p> : null}
      {instrument ? (
        <>
          <div className="des-head-block">
            <div className="des-head" data-testid="des-head">
              <h3 className="des-name">{name}</h3>
            </div>
          </div>
          <div className="des-page">
            <div className="des-cols des-cols-2">
              <DesCard title={k.identity}>
                <Pairs
                  rows={[
                    [k.root, instrument.root],
                    [k.symbol, instrument.symbol],
                    [k.sector, instrument.sector],
                    [k.fence, fence ? fillCopy(k.fenceValue, { start: fence.is_start, end: fence.is_end }) : MISSING],
                    [k.gateReads, health.data ? String(health.data.gate_reads_this_process) : MISSING],
                  ]}
                />
                <p className="des-note">{k.specsGap}</p>
              </DesCard>
              <DesCard title={k.chart} jump={{ label: fillCopy(DES.go, { code: 'GP' }), name: DES.jumpNames.GP, onRun: () => actions.open('GP') }}>
                <InstrumentPreview root={instrument.root} link={link} />
                <p className="des-note">{fillCopy(k.chartNote, { name })}</p>
              </DesCard>
            </div>
            <DesCard title={k.coverage}>
              {catalog.isError ? <LoadError name={root} error={catalog.error} /> : <Coverage name={name} series={series} />}
            </DesCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
