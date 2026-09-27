// MON grid columns (look spec 7.7): ticker and name in amber, the 2Day sparkline, the last close with its
// fence flag, the six horizons (in % or sd, heat-filled on request), realised vol, correlation to NQ and
// the price units.
// Every header names its unit. Built once per (horizons, view, heat) so MonitorGrid gets a stable array.
import { signTone, type MonitorColumn } from '../../grids/MonitorGrid'
import { fillCopy } from '../../copy/workspace'
import { MON } from '../../copy/market'
import type { MonRow, MonView } from './model'
import TwoDayCell from './TwoDayCell'

const W = { ticker: 96, name: 128, spark: 60, last: 86, flag: 36, horizon: 62, rv: 54, corr: 54, units: 170 } as const

function flagCell(row: MonRow) {
  const stale = row.flag === 'stale'
  return (
    <span className={stale ? 'mon-flag mon-flag-stale' : 'mon-flag'}>
      {stale ? MON.flagStale : MON.flagServed}
      <span className="sr-only">{` ${stale ? MON.flagStaleText : MON.flagServedText}`}</span>
    </span>
  )
}

function horizonColumn(h: string, view: MonView, heat: boolean): MonitorColumn<MonRow> {
  const unit = view === 'returns' ? MON.unitPct : MON.unitSd
  const column: MonitorColumn<MonRow> = {
    id: `h-${h}`,
    header: fillCopy(MON.colHorizon, { h, unit }),
    width: W.horizon,
    kind: 'num',
    value: (r) => r.values[h] ?? null,
    format: (r) => r.cells[h] ?? '--',
    tone: (r) => signTone(r.values[h]),
  }
  if (!heat) return column
  return {
    ...column,
    render: (r) => <span className={`mon-heat mon-heat-${r.heat[h] ?? 'none'}`}>{r.cells[h] ?? '--'}</span>,
  }
}

/** `wide`: the panel has room for the price units column (see MonScreen). */
export function monColumns(horizons: readonly string[], view: MonView, heat: boolean, wide: boolean): MonitorColumn<MonRow>[] {
  const columns: MonitorColumn<MonRow>[] = [
    { id: 'ticker', header: MON.colTicker, width: W.ticker, kind: 'name', value: (r) => r.ticker },
    { id: 'name', header: MON.colName, width: W.name, kind: 'name', value: (r) => r.name },
    {
      id: 'twoDay', header: MON.colTwoDay, width: W.spark, kind: 'text', value: () => null, sortable: false,
      render: (r) => <TwoDayCell symbol={r.symbol} root={r.root} tick={r.tick} />,
    },
    { id: 'last', header: MON.colLast, width: W.last, kind: 'num', value: (r) => r.lastValue, format: (r) => r.last },
    { id: 'flag', header: MON.colFlag, width: W.flag, kind: 'text', value: (r) => r.flag, render: flagCell, sortable: false },
    ...horizons.map((h) => horizonColumn(h, view, heat)),
    { id: 'rv', header: MON.colRv, width: W.rv, kind: 'num', value: (r) => r.rvValue, format: (r) => r.rv },
    { id: 'corr', header: MON.colCorr, width: W.corr, kind: 'num', value: (r) => r.corrValue, format: (r) => r.corr },
  ]
  if (!wide) return columns
  return [...columns, { id: 'units', header: MON.colUnits, width: W.units, kind: 'text', value: (r) => r.units }]
}
