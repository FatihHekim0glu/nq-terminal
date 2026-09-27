// Grid columns for REG and MT (look spec 7.2 and 4.8): names amber, numbers right-aligned tabular
// figures, verdicts as bracket text in up and down colours (never a fill alone), `--` for missing.
// Module scope, so MonitorGrid gets a stable array.
import type { RowData } from '@tanstack/react-table'
import type { MonitorColumn } from '../../grids/MonitorGrid'
import { MT, REG } from '../../copy/reg'
import { amendmentText, badgeText, formatCount, formatPValue, hashStatus, shortSha, tagText, verdictTone, type RegRow } from './regModel'
import { passesText, type MtRow } from './mtModel'

const P_WIDTH = 58

function pColumn<Row extends RowData>(id: string, header: string, get: (row: Row) => number | null): MonitorColumn<Row> {
  return { id, header, width: P_WIDTH, kind: 'num', value: get, format: (r) => formatPValue(get(r)) }
}

const C = REG.cols

export const REG_COLUMNS: readonly MonitorColumn<RegRow>[] = [
  { id: 'name', header: C.name, width: 138, kind: 'name', value: (r) => r.name },
  { id: 'round', header: C.round, width: 50, kind: 'num', value: (r) => r.round, format: (r) => formatCount(r.round) },
  { id: 'tag', header: C.tag, width: 76, kind: 'text', value: (r) => r.tag, format: (r) => tagText(r.tag), tone: (r) => (r.tag === 'check' ? 'muted' : undefined) },
  {
    id: 'verdict', header: C.verdict, width: 60, kind: 'text', value: (r) => r.badge,
    format: (r) => badgeText(r.badge), tone: (r) => verdictTone(r.badge),
  },
  { id: 'n', header: C.n, width: 52, kind: 'num', value: (r) => r.n, format: (r) => formatCount(r.n) },
  pColumn<RegRow>('p', C.p, (r) => r.p),
  pColumn<RegRow>('controlP', C.controlP, (r) => r.controlP),
  pColumn<RegRow>('bonferroni', C.bonferroni, (r) => r.bonferroni),
  pColumn<RegRow>('holm', C.holm, (r) => r.holm),
  pColumn<RegRow>('bhQ', C.bhQ, (r) => r.bhQ),
  { id: 'sha', header: C.sha, width: 84, kind: 'text', value: (r) => r.sha, format: (r) => shortSha(r.sha) },
  {
    id: 'hash', header: C.hash, width: 76, kind: 'text', value: (r) => hashStatus(r).text,
    tone: (r) => (hashStatus(r).ok ? undefined : 'down'),
  },
  {
    id: 'amend', header: C.amendments, width: 56, kind: 'num', value: (r) => r.amendments, format: amendmentText,
    tone: (r) => (r.amendmentsOk === false ? 'down' : undefined),
  },
]

const M = MT.cols

export const MT_COLUMNS: readonly MonitorColumn<MtRow>[] = [
  { id: 'rank', header: M.rank, width: 44, kind: 'num', value: (r) => r.rank },
  { id: 'name', header: M.name, width: 150, kind: 'name', value: (r) => r.name },
  { id: 'tag', header: M.tag, width: 76, kind: 'text', value: (r) => r.tag, format: (r) => tagText(r.tag), tone: (r) => (r.tag === 'check' ? 'muted' : undefined) },
  pColumn<MtRow>('p', M.p, (r) => r.p),
  pColumn<MtRow>('bonferroniLine', M.bonferroniLine, (r) => r.bonferroniLine),
  pColumn<MtRow>('holmLine', M.holmLine, (r) => r.holmLine),
  pColumn<MtRow>('bhLine', M.bhLine, (r) => r.bhLine),
  pColumn<MtRow>('bonferroni', M.bonferroni, (r) => r.bonferroni),
  pColumn<MtRow>('holm', M.holm, (r) => r.holm),
  pColumn<MtRow>('bhQ', M.bhQ, (r) => r.bhQ),
  { id: 'passes', header: M.passes, width: 136, kind: 'text', value: (r) => passesText(r.passes) },
]

/** The columns a narrow panel keeps (a 682px HOME cell at 1366x768): no sideways scroll there. */
const COMPACT_IDS: ReadonlySet<string> = new Set(['name', 'tag', 'verdict', 'n', 'p', 'holm', 'bhQ', 'hash', 'amend'])
export const REG_COMPACT_COLUMNS: readonly MonitorColumn<RegRow>[] = REG_COLUMNS.filter((c) => COMPACT_IDS.has(c.id))

export const regRowId = (r: RegRow): string => r.name
export const mtRowId = (r: MtRow): string => r.name
