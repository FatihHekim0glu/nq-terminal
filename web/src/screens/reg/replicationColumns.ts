// Grid columns for MT 86) Replication (look spec 7.2 and 4.8): names amber, p-values right-aligned to four
// decimals, verdicts as bracket text in up and down tones (never a fill alone), `--` for a missing value.
// Module scope, so MonitorGrid gets a stable array.
import type { MonitorColumn } from '../../grids/MonitorGrid'
import { REPLICATION } from '../../copy/replication'
import { badgeText, formatPValue, verdictTone } from './regModel'
import type { ReplicationPoint } from './replicationModel'

const C = REPLICATION.cols
const MISSING = '--'
const P_WIDTH = 58

export const REPLICATION_COLUMNS: readonly MonitorColumn<ReplicationPoint>[] = [
  { id: 'parent', header: C.parent, width: 138, kind: 'name', value: (r) => r.parent },
  { id: 'confirmation', header: C.confirmation, width: 150, kind: 'name', value: (r) => r.confirmation },
  { id: 'inSampleP', header: C.inSampleP, width: P_WIDTH, kind: 'num', value: (r) => r.inSampleP, format: (r) => formatPValue(r.inSampleP) },
  {
    id: 'inSampleVerdict', header: C.inSampleVerdict, width: 60, kind: 'text', value: (r) => r.inSampleBadge,
    format: (r) => (r.inSampleBadge === null ? MISSING : badgeText(r.inSampleBadge)),
    tone: (r) => (r.inSampleBadge === null ? undefined : verdictTone(r.inSampleBadge)),
  },
  { id: 'sealedP', header: C.sealedP, width: P_WIDTH, kind: 'num', value: (r) => r.sealedP, format: (r) => formatPValue(r.sealedP) },
  { id: 'ownAlpha', header: C.ownAlpha, width: 60, kind: 'num', value: (r) => r.ownAlpha, format: (r) => (r.ownAlpha === null ? MISSING : String(r.ownAlpha)) },
  {
    id: 'sealedVerdict', header: C.sealedVerdict, width: 60, kind: 'text', value: (r) => r.sealedBadge,
    format: (r) => badgeText(r.sealedBadge), tone: (r) => verdictTone(r.sealedBadge),
  },
  { id: 'window', header: C.window, width: 220, kind: 'text', value: (r) => r.window, tone: () => 'muted' },
]

export const replicationRowId = (p: ReplicationPoint): string => p.confirmation
