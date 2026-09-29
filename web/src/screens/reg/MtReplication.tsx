// MT 86) Replication (roadmap R8): each sealed confirmation against the registered in-sample p of the
// hypothesis it tests, on reversed log p axes with the y = x diagonal and the alpha lines, then a numbered
// grid of the pairs (Enter opens the parent's DES), the hypotheses never tested in the sealed window and the
// confirmations that could not be drawn. Stored numbers only, [SPENT]: no fit, no test, no verdict of the
// terminal's own. The only GET of its own is /api/registry, and it is asked for once this view is open.
import { useCallback, useMemo } from 'react'
import { useRegistry } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { GlyphScatter } from '../../charts/echarts/GlyphScatter'
import { offScaleLines } from '../../charts/echarts/glyphScatterModel'
import { CONFIRM } from '../../copy/reg'
import { REPLICATION } from '../../copy/replication'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid, { type OpenOptions } from '../../grids/MonitorGrid'
import { openDes } from './open'
import { REPLICATION_COLUMNS, replicationRowId } from './replicationColumns'
import { buildReplication, replicationScatter, unmatchedLine, untestedLine, type ReplicationPoint, type ReplicationView } from './replicationModel'
import './reg.css'

const CHART_ID = 'mt-replication'

export function ReplicationBody({ view, registryError }: { readonly view: ReplicationView; readonly registryError: string | null }) {
  const input = useMemo(() => replicationScatter(view), [view])
  const off = useMemo(() => offScaleLines(input), [input])
  const onOpen = useCallback((pair: ReplicationPoint, options?: OpenOptions) => openDes(pair.parent, options), [])
  const unmatched = unmatchedLine(view)
  return (
    <section className="reg-confirm mt-replication" aria-label={REPLICATION.label}>
      <p className="reg-band">
        <span className="reg-band-title">{REPLICATION.title}</span>{' '}
        <span className="reg-warn">{`[${CONFIRM.spent}]`}</span>{' '}
        <span className="reg-muted">{REPLICATION.note}</span>
      </p>
      <p className="reg-msg reg-muted">{REPLICATION.legend}</p>
      {view.points.length === 0 ? (
        <p className="reg-msg">{REPLICATION.empty}</p>
      ) : (
        <>
          <div className="mt-replication-chart">
            <GlyphScatter data={input} chartId={CHART_ID} />
          </div>
          {off.length > 0 ? <p className="reg-msg reg-muted">{fillCopy(REPLICATION.offScale, { lines: off.map((l) => l.label).join(', ') })}</p> : null}
          <div className="reg-grid">
            <MonitorGrid
              label={REPLICATION.gridLabel}
              rows={view.points}
              columns={REPLICATION_COLUMNS}
              rowId={replicationRowId}
              onOpen={onOpen}
              scroll="panel"
            />
          </div>
        </>
      )}
      <p className="reg-msg">{untestedLine(view)}</p>
      {unmatched === null ? null : <p className="reg-msg">{unmatched}</p>}
      {registryError === null ? null : <p className="reg-msg reg-muted">{fillCopy(REPLICATION.registryFailed, { detail: registryError })}</p>}
    </section>
  )
}

export default function MtReplication({ mt }: { readonly mt: Schemas['MultipleTesting'] }) {
  const registry = useRegistry()
  const view = useMemo(() => buildReplication(mt, registry.data), [mt, registry.data])
  return <ReplicationBody view={view} registryError={registry.isError ? registry.error.detail : null} />
}
