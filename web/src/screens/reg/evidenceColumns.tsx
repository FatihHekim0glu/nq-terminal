// Grid columns for REG's evidence matrix (92) Evidence, look spec 7.2): every cell equals the served
// field it names, no aggregate anywhere. Module scope, so MonitorGrid gets a stable array.
import type { MonitorColumn } from '../../grids/MonitorGrid'
import { EVIDENCE } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import { formatDsr } from './deflatedModel'
import { badgeText, formatPValue, verdictTone } from './regModel'
import type { EvidenceRow } from './evidenceModel'

const MISSING = '--'
const C = EVIDENCE.cols

function blocksText(r: EvidenceRow): string {
  return r.blocksPositive === null || r.blocksTotal === null
    ? MISSING
    : fillCopy(EVIDENCE.blocks, { positive: r.blocksPositive, total: r.blocksTotal })
}

function sealedText(r: EvidenceRow): string {
  return r.sealed ? fillCopy(EVIDENCE.sealedItem, { badge: r.sealed.badge }) : EVIDENCE.sealedNone
}

export const EVIDENCE_COLUMNS: readonly MonitorColumn<EvidenceRow>[] = [
  { id: 'name', header: C.name, width: 138, kind: 'name', value: (r) => r.name },
  {
    id: 'verdict', header: C.verdict, width: 60, kind: 'text', value: (r) => r.badge,
    format: (r) => badgeText(r.badge), tone: (r) => verdictTone(r.badge),
  },
  { id: 't', header: C.t, width: 56, kind: 'num', value: (r) => r.t, format: (r) => formatNumber(r.t, 2, { signed: true }) },
  { id: 'holm', header: C.holm, width: 58, kind: 'num', value: (r) => r.holm, format: (r) => formatPValue(r.holm) },
  { id: 'blocks', header: C.blocks, width: 56, kind: 'num', value: (r) => r.blocksPositive, format: blocksText },
  { id: 'breakEven', header: C.breakEven, width: 64, kind: 'num', value: (r) => r.breakEven, format: (r) => formatNumber(r.breakEven, 2) },
  { id: 'sealed', header: C.sealed, width: 76, kind: 'text', value: (r) => r.sealed?.name ?? null, format: sealedText },
  { id: 'sharpe', header: C.sharpe, width: 60, kind: 'num', value: (r) => r.sharpe, format: (r) => formatNumber(r.sharpe, 2, { signed: true }) },
  { id: 'years', header: C.years, width: 48, kind: 'num', value: (r) => r.years, format: (r) => formatNumber(r.years, 2) },
  { id: 'dsr', header: C.dsr, width: 56, kind: 'num', value: (r) => r.dsr, format: (r) => formatDsr(r.dsr) },
]

const COMPACT_DROP: ReadonlySet<string> = new Set(['years', 'sealed'])
export const EVIDENCE_COMPACT_COLUMNS: readonly MonitorColumn<EvidenceRow>[] = EVIDENCE_COLUMNS.filter((c) => !COMPACT_DROP.has(c.id))

export const evidenceRowId = (r: EvidenceRow): string => r.name
