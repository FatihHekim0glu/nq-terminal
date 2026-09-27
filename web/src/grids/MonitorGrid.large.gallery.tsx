// Gallery entry /__gallery/MonitorGrid.large (TASKS 5.4 acceptance: "10,000-row grid scrolls
// smoothly; Enter drills down"): 10,000 fixture runs in one MonitorGrid. The E2E run scrolls it frame
// by frame and measures the frame times, and opens the last row from the keyboard.
import { useMemo, useState } from 'react'
import { formatPercent, formatSignedChange, formatThousands } from '../chrome/QuoteHeader.format'
import { GRID_GALLERY as G } from '../copy/grids'
import { BALANCE } from '../copy/tiles'
import { fillCopy } from '../copy/workspace'
import { runRows, type RunRow } from './gallery.fixtures'
import MonitorGrid, { signTone, type MonitorColumn } from './MonitorGrid'
import './grids.gallery.css'

const COLUMNS: MonitorColumn<RunRow>[] = [
  { id: 'id', header: G.colRun, width: 260, kind: 'name', value: (r) => r.id },
  { id: 'strategy', header: G.colStrategy, width: 140, kind: 'text', value: (r) => r.strategy },
  { id: 'trades', header: G.colTrades, width: 80, kind: 'num', value: (r) => r.trades, format: (r) => formatThousands(r.trades) },
  { id: 'pnl', header: G.colPnl, width: 120, kind: 'num', value: (r) => r.pnl, format: (r) => formatSignedChange(r.pnl, 2), tone: (r) => signTone(r.pnl) },
  { id: 'sharpe', header: G.colSharpe, width: 80, kind: 'num', value: (r) => r.sharpe, format: (r) => formatSignedChange(r.sharpe, 2), tone: (r) => signTone(r.sharpe) },
  { id: 'maxdd', header: G.colMaxDd, width: 80, kind: 'num', value: (r) => r.maxDd, format: (r) => formatPercent(r.maxDd, 1) },
  {
    id: 'balance', header: G.colBalance, width: 90, kind: 'text', value: (r) => (r.balanceOk ? BALANCE.ok : BALANCE.fail),
    tone: (r) => (r.balanceOk ? 'up' : 'down'),
  },
]

const runId = (r: RunRow) => r.id

export default function MonitorGridLargeGallery() {
  const rows = useMemo(() => runRows(), [])
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <section className="grid-gallery" aria-labelledby="mgl-title">
      <h2 id="mgl-title">{G.largeTitle}</h2>
      <div className="grid-gallery-body">
        <MonitorGrid label={G.largeLabel} rows={rows} columns={COLUMNS} rowId={runId} onOpen={(r) => setOpened(r.id)} />
      </div>
      <p className="grid-gallery-readout" role="status" data-testid="opened">
        {opened === null ? G.openedNone : fillCopy(G.opened, { name: opened })}
      </p>
    </section>
  )
}
