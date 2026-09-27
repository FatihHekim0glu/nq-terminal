// Gallery entry /__gallery/PerspectiveGrid (TASKS 9.1): the pivot grid over 8,411 synthetic fills shaped
// like a dtsmom book's (27 roots, weekly rebalances from 2012), under the production CSP. The E2E run
// reads the table-to-painted time from data-psp-load-ms.
import { useMemo } from 'react'
import { fillCopy } from '../copy/workspace'
import { PIVOT } from '../copy/perspective'
import { DATASETS, type FillRow } from './datasets'
import PerspectiveGrid from './PerspectiveGrid'
import { toColumnar, toSchema } from './schema'

export const GALLERY_FILLS = 8411
const ROOTS = ['ES', 'NQ', 'YM', 'ZT', 'ZF', 'ZN', 'ZB', '6E', '6J', '6B', '6A', '6C', '6S', 'CL', 'NG', 'HO', 'RB', 'GC', 'SI', 'HG', 'ZC', 'ZS', 'ZW', 'ZL', 'ZM', 'LE', 'HE']

export function syntheticFills(total: number): FillRow[] {
  const first = Date.UTC(2012, 0, 4) / 1000
  return Array.from({ length: total }, (_, i) => {
    const root = ROOTS[i % ROOTS.length] ?? 'NQ'
    const day = first + Math.floor(i / ROOTS.length) * 86_400 * 7
    const qty = 1 + ((i * 37) % 180)
    return {
      ts: `${new Date(day * 1000).toISOString().slice(0, 19)}.000000000Z`,
      ts_epoch_s: day,
      instrument: `${root}.XCME`,
      side: i % 3 === 0 ? 'SELL' : 'BUY',
      qty,
      px: Math.round((100 + ((i * 7919) % 400_000) / 100) * 100) / 100,
      commission: (qty * 7.5).toFixed(4),
      commission_float: qty * 7.5,
      position_id: `DtsMom-${String(Math.floor(i / 54)).padStart(3, '0')}-${root}-L1`,
      order_id: `O-${i}`,
      tags: i % 5 === 0 ? 'ROLL' : 'REBAL',
    }
  })
}

export default function PerspectiveGridGallery() {
  const fills = useMemo(() => syntheticFills(GALLERY_FILLS), [])
  const schema = useMemo(() => toSchema(DATASETS.fills.columns), [])
  const data = useMemo(() => toColumnar(fills, DATASETS.fills.columns), [fills])
  return (
    <div style={{ height: 640, display: 'flex', flexDirection: 'column' }}>
      <PerspectiveGrid
        name={fillCopy(PIVOT.names.fills, { run: 'gallery_run' })}
        schema={schema}
        data={data}
        rows={fills.length}
        preset={DATASETS.fills.preset}
      />
    </div>
  )
}
