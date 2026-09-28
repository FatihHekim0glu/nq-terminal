// 92) Evidence (look spec 7.2, roadmap #5): every registry row against its recorded evidence, read
// only. A legend says what each column group is (pre-registered, the one-shot sealed test, the
// post-hoc SV3a basis), then one status line for what is still being read or could not be, then the
// grid itself. No column is a score, and there is no total: the terminal adds no pass or fail.
import { CONFIRM, REG } from '../../copy/reg'
import { SPEC } from '../../copy/tiles'
import { EVIDENCE } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid from '../../grids/MonitorGrid'
import { gridWidth } from '../../grids/useElementWidth'
import { EVIDENCE_COLUMNS, EVIDENCE_COMPACT_COLUMNS, evidenceRowId } from './evidenceColumns'
import { detailStatus, type EvidenceRow } from './evidenceModel'
import { openDes } from './open'
import './regViews.css'

export interface RegEvidenceProps {
  readonly rows: readonly EvidenceRow[]
  readonly width: number | null
}

/** Always mounts the same role=status node (never removed and re-added), empty until something is
 *  still being read or could not be: a node that mounts already holding text is often not announced,
 *  and screen readers track a live region by node identity, not by when it first appears. */
function StatusLine({ rows }: { readonly rows: readonly EvidenceRow[] }) {
  const status = detailStatus(rows)
  const text = status === null
    ? ''
    : status.kind === 'reading'
      ? fillCopy(EVIDENCE.reading, { n: status.n })
      : fillCopy(EVIDENCE.failed, { n: status.n, name: status.name, detail: status.detail })
  return <p className="reg-msg" role="status">{text}</p>
}

export default function RegEvidence({ rows, width }: RegEvidenceProps) {
  const compact = width !== null && width < gridWidth(EVIDENCE_COLUMNS)
  return (
    <>
      <p className="reg-msg">
        <span className="reg-tag">{SPEC.preReg}</span> {EVIDENCE.legendPreReg}{' '}
        <span className="reg-warn">{`[${CONFIRM.spent}]`}</span> {EVIDENCE.legendSpent}{' '}
        <span className="reg-tag">{SPEC.postHoc}</span> {EVIDENCE.legendPostHoc}
      </p>
      <p className="reg-msg reg-muted">{EVIDENCE.noScore}</p>
      <p className="reg-msg reg-muted">{EVIDENCE.tNote}</p>
      <StatusLine rows={rows} />
      <div className="reg-evidence-grid">
        <MonitorGrid
          label={EVIDENCE.gridLabel}
          rows={rows}
          columns={compact ? EVIDENCE_COMPACT_COLUMNS : EVIDENCE_COLUMNS}
          rowId={evidenceRowId}
          onOpen={(row) => openDes(row.name)}
          emptyText={REG.empty}
          scroll="panel"
        />
      </div>
      {compact ? <p className="reg-msg reg-muted">{EVIDENCE.compactNote}</p> : null}
    </>
  )
}
