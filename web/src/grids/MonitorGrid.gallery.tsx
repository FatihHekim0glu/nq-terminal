// Gallery entry /__gallery/MonitorGrid (TASKS 5.4): the futures monitor layout of look spec 7.7 with
// fixture data to 2021-12-31: sections numbered 1) Equity, rows 10) 11) ..., amber names, signed
// returns in up and down text, Treasury prices in 32nds. Enter or a double click drills down; the
// readout under the grid shows what was opened, so the E2E run can check it.
import { useMemo, useState } from 'react'
import { formatPercent, formatPercentChange, formatPrice } from '../chrome/QuoteHeader.format'
import { GRID_GALLERY as G } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import { monitorRows, type MonitorRow } from './gallery.fixtures'
import MonitorGrid, { signTone, type MonitorColumn } from './MonitorGrid'
import './grids.gallery.css'

function change(id: string, header: string, get: (r: MonitorRow) => number | null): MonitorColumn<MonitorRow> {
  return { id, header, width: 72, kind: 'num', value: get, format: (r) => formatPercentChange(get(r), 2), tone: (r) => signTone(get(r)) }
}

const COLUMNS: MonitorColumn<MonitorRow>[] = [
  { id: 'name', header: G.colName, width: 230, kind: 'name', value: (r) => `${r.sym} ${r.name}` },
  { id: 'last', header: G.colLast, width: 100, kind: 'num', value: (r) => r.last, format: (r) => formatPrice(r.sym, r.last, r.decimals) },
  change('r1d', G.col1d, (r) => r.r1d),
  change('r1w', G.col1w, (r) => r.r1w),
  change('r1m', G.col1m, (r) => r.r1m),
  change('r3m', G.col3m, (r) => r.r3m),
  change('ytd', G.colYtd, (r) => r.ytd),
  change('r12m', G.col12m, (r) => r.r12m),
  { id: 'rv', header: G.colRv, width: 72, kind: 'num', value: (r) => r.rv, format: (r) => formatPercent(r.rv, 1) },
  { id: 'corr', header: G.colCorr, width: 80, kind: 'num', value: (r) => r.corr, format: (r) => (r.corr === null ? '--' : r.corr.toFixed(2)) },
]

const sym = (r: MonitorRow) => r.sym
const sector = (r: MonitorRow) => r.sector

export default function MonitorGridGallery() {
  const rows = useMemo(() => monitorRows(), [])
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <section className="grid-gallery" aria-labelledby="mg-title">
      <h2 id="mg-title">{G.monitorTitle}</h2>
      <div className="grid-gallery-body">
        <MonitorGrid label={G.monitorLabel} rows={rows} columns={COLUMNS} rowId={sym} rowLabel={sym} groupOf={sector} onOpen={(r) => setOpened(r.sym)} />
      </div>
      <p className="grid-gallery-readout" role="status" data-testid="opened">
        {opened === null ? G.openedNone : fillCopy(G.opened, { name: opened })}
      </p>
    </section>
  )
}
