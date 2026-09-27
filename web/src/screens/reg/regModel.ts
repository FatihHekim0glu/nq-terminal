// The pure parts of REG (UI_SPEC 7 "REG and MT", look spec 7.2), kept apart from the component so each
// is tested on its own:
// - registry rows (GET /api/registry, the authoritative file) joined to their hypothesis cards
//   (GET /api/hypotheses) for the verdict badge, round, verdict note and spec re-hash;
// - the round rail, the screening criteria counts and the row filter;
// - cell formats: p-values to four decimals, counts with separators, `--` for a missing value;
// - each row's tag (edge, overlay, check) and amendments, and the accepted-amendments block;
// - the CSV export at full precision.
// The terminal never produces a verdict: badges come from the card, or else from the registry's text.
import type { Schemas } from '../../api/types'
import { formatP } from '../../charts/echarts/format'
import { REG } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'

export type Badge = Schemas['HypothesisCard']['verdict_badge']
export type Tone = 'up' | 'down' | 'muted'
export type RowTag = Schemas['RegistryRow']['tag']

export interface RegRow {
  readonly name: string
  readonly registered: boolean
  readonly badge: Badge
  readonly note: string | null
  readonly round: number | null
  readonly n: number | null
  readonly p: number | null
  readonly controlP: number | null
  readonly bonferroni: number | null
  readonly holm: number | null
  readonly bhQ: number | null
  readonly sha: string
  readonly shaOk: boolean
  /** The terminal's own re-hash of the spec; null when the row has no card. */
  readonly rehashOk: boolean | null
  /** edge, overlay (in the family, but a PASS is not an edge) or check, as the registry tags it. */
  readonly tag: RowTag
  /** Accepted amendment files of the spec, and whether each binds to its spec and result. */
  readonly amendments: number
  readonly amendmentFiles: readonly string[]
  readonly amendmentsOk: boolean | null
}

const MISSING = '--'

/** `PASS [note]` to its badge and note; a registry text that is neither PASS nor FAIL is a check. */
function parseVerdict(verdict: string, registered: boolean): { badge: Badge; note: string | null } {
  const m = /^(PASS|FAIL)\b\s*(?:\[(.*)\])?/.exec(verdict.trim())
  if (m && registered) return { badge: m[1] as Badge, note: m[2] ?? null }
  return { badge: 'CHECK', note: verdict.trim() || null }
}

export function buildRegRows(registry: Schemas['RegistryView'], cards: readonly Schemas['HypothesisCard'][]): RegRow[] {
  const byName = new Map(cards.map((c) => [c.name, c]))
  return registry.rows.map((r) => {
    const card = byName.get(r.name)
    const parsed = parseVerdict(r.verdict, r.registered)
    return {
      name: r.name,
      registered: r.registered,
      badge: card ? card.verdict_badge : parsed.badge,
      note: card ? card.verdict_note : parsed.note,
      round: card ? card.round : null,
      n: r.n,
      p: r.p,
      controlP: r.control_p,
      bonferroni: r.bonferroni_p,
      holm: r.holm_p,
      bhQ: r.bh_q,
      sha: r.spec_sha256,
      shaOk: r.spec_sha_ok,
      rehashOk: card ? card.spec_rehash_ok : null,
      tag: r.tag,
      amendments: r.amendments,
      amendmentFiles: r.amendment_files,
      amendmentsOk: r.amendments_ok,
    }
  })
}

export type RoundKey = 'all' | 'none' | `${number}`

export interface RoundGroup {
  readonly key: RoundKey
  readonly label: string
  readonly count: number
}

const roundKey = (row: RegRow): RoundKey => (row.round === null ? 'none' : `${row.round}`)

/** The rail: all rounds, then each round in ascending order, then rows without a round. */
export function roundGroups(rows: readonly RegRow[]): RoundGroup[] {
  const rounds = [...new Set(rows.flatMap((r) => (r.round === null ? [] : [r.round])))].sort((a, b) => a - b)
  const count = (key: RoundKey) => rows.filter((r) => roundKey(r) === key).length
  const none = count('none')
  return [
    { key: 'all', label: REG.allRounds, count: rows.length },
    ...rounds.map((n) => ({ key: `${n}` as RoundKey, label: fillCopy(REG.round, { n }), count: count(`${n}`) })),
    ...(none > 0 ? [{ key: 'none' as const, label: REG.noRound, count: none }] : []),
  ]
}

export type CriterionId = 'rows' | 'registered' | 'edges' | 'overlays' | 'passed' | 'passedEdges' | 'failed' | 'checks' | 'bh'

export interface Criterion {
  readonly id: CriterionId
  readonly label: string
  /** null when it cannot be counted (BH without the family alpha). */
  readonly count: number | null
}

const survivesBh = (row: RegRow, alpha: number): boolean => row.registered && row.bhQ !== null && row.bhQ < alpha

/** The counts block: the API's counts as they are, plus the rows whose stored BH q is below alpha. */
export function criteria(counts: Schemas['RegistryCounts'], rows: readonly RegRow[], alpha: number | null): Criterion[] {
  const c = REG.criteria
  return [
    { id: 'rows', label: c.rows, count: counts.rows },
    { id: 'registered', label: c.registered, count: counts.registered },
    { id: 'edges', label: c.edges, count: counts.edges },
    { id: 'overlays', label: c.overlays, count: counts.overlays },
    { id: 'passed', label: c.passed, count: counts.passed },
    { id: 'passedEdges', label: c.passedEdges, count: counts.passed_edges },
    { id: 'failed', label: c.failed, count: counts.failed },
    { id: 'checks', label: c.checks, count: counts.checks },
    {
      id: 'bh',
      label: fillCopy(c.bh, { alpha: alpha === null ? '?' : String(alpha) }),
      count: alpha === null ? null : rows.filter((r) => survivesBh(r, alpha)).length,
    },
  ]
}

export interface RowFilter {
  readonly text: string
  readonly round: RoundKey
  readonly criterion: Exclude<CriterionId, 'rows'> | null
  readonly alpha?: number | null
}

function meets(row: RegRow, criterion: RowFilter['criterion'], alpha: number | null): boolean {
  switch (criterion) {
    case null: return true
    case 'registered': return row.registered
    case 'edges': return row.tag === 'edge'
    case 'overlays': return row.tag === 'overlay'
    case 'passed': return row.registered && row.badge === 'PASS'
    case 'passedEdges': return row.tag === 'edge' && row.registered && row.badge === 'PASS'
    case 'failed': return row.registered && row.badge === 'FAIL'
    case 'checks': return row.badge === 'CHECK'
    case 'bh': return alpha !== null && survivesBh(row, alpha)
  }
}

export function filterRows(rows: readonly RegRow[], filter: RowFilter): RegRow[] {
  const text = filter.text.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (text === '' || r.name.toLowerCase().includes(text)) &&
      (filter.round === 'all' || roundKey(r) === filter.round) &&
      meets(r, filter.criterion, filter.alpha ?? null),
  )
}

/** p-values and adjusted p-values to four decimals (`<0.0001` below that); `--` when missing. */
export function formatPValue(p: number | null | undefined): string {
  return typeof p === 'number' && Number.isFinite(p) ? formatP(p) : MISSING
}

const COUNT_FORMAT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

export function formatCount(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? COUNT_FORMAT.format(n) : MISSING
}

/** `b02f..fd89`: the first and last four characters of a sha256. */
export function shortSha(sha: string | null | undefined): string {
  return sha && sha.length > 8 ? `${sha.slice(0, 4)}..${sha.slice(-4)}` : sha || MISSING
}

export function hashStatus(row: Pick<RegRow, 'shaOk' | 'rehashOk'>): { text: string; ok: boolean } {
  const rehash = row.rehashOk !== false
  if (row.shaOk && rehash) return { text: REG.hash.ok, ok: true }
  if (!row.shaOk && !rehash) return { text: REG.hash.both, ok: false }
  return { text: row.shaOk ? REG.hash.rehash : REG.hash.registry, ok: false }
}

export function verdictTone(badge: Badge): Tone {
  if (badge === 'PASS') return 'up'
  if (badge === 'FAIL') return 'down'
  return 'muted'
}

export const badgeText = (badge: string): string => `[${badge}]`

/** The tag as the grid prints it (upper case in brackets for an overlay, so it stands out). */
export function tagText(tag: RowTag): string {
  return REG.tags[tag]
}

/** The amendments cell: the count, with the registry's binding check in words when there are any. */
export function amendmentText(row: Pick<RegRow, 'amendments' | 'amendmentsOk'>): string {
  if (row.amendments === 0 || row.amendmentsOk === null) return String(row.amendments)
  return `${row.amendments} ${row.amendmentsOk ? REG.amend.ok : REG.amend.bad}`
}

export interface AcceptanceRow {
  readonly file: string
  readonly spec: string
  readonly rows: string
  readonly accepted: string
  readonly now: string
  readonly unchanged: boolean
}

/** The accepted amendments (results/amendment_acceptances.md): each file's hash then and now. */
export function acceptanceRows(a: Schemas['AmendmentAcceptances']): AcceptanceRow[] {
  return a.amendments.map((m) => ({
    file: m.file,
    spec: m.spec ?? MISSING,
    rows: m.rows.length > 0 ? m.rows.join(', ') : MISSING,
    accepted: shortSha(m.sha256_accepted),
    now: shortSha(m.sha256_now),
    unchanged: m.unchanged,
  }))
}

export function acceptanceLine(a: Schemas['AmendmentAcceptances']): string {
  if (!a.found) return fillCopy(REG.accept.none, { source: a.source })
  const changed = a.amendments.filter((m) => !m.unchanged).length
  const state = changed === 0 ? REG.accept.allUnchanged : fillCopy(REG.accept.changed, { n: changed })
  return fillCopy(REG.accept.line, { utc: a.accepted_utc ?? MISSING, source: a.source, n: a.amendments.length, state })
}

export interface ConfirmRow {
  readonly name: string
  readonly parent: string | null
  readonly n: number | null
  readonly p: number | null
  readonly alpha: number | null
  readonly badge: Badge
  readonly sha: string | null
  readonly shaOk: boolean
  readonly closed: boolean
  readonly label: string
}

export function confirmationRows(list: readonly Schemas['Confirmation'][]): ConfirmRow[] {
  return list.map((c) => ({
    name: c.name,
    parent: c.parent,
    n: c.n,
    p: c.p,
    alpha: c.alpha,
    badge: parseVerdict(c.verdict, true).badge,
    sha: c.spec_sha256,
    shaOk: c.spec_sha_ok,
    closed: c.opening_closed,
    label: c.label,
  }))
}

const CSV_HEAD = [
  'name', 'registered', 'tag', 'round', 'verdict', 'n', 'p', 'control_p', 'bonferroni_p', 'holm_p', 'bh_q',
  'spec_sha256', 'spec_sha_ok', 'spec_rehash_ok', 'amendments', 'amendments_ok',
] as const

function csvField(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The rows as CSV (RFC 4180 line ends), every number at the precision the API sent. */
export function toCsv(rows: readonly RegRow[]): string {
  const lines = rows.map((r) =>
    [r.name, r.registered, r.tag, r.round, r.badge, r.n, r.p, r.controlP, r.bonferroni, r.holm, r.bhQ, r.sha, r.shaOk, r.rehashOk, r.amendments, r.amendmentsOk]
      .map(csvField)
      .join(','),
  )
  return [CSV_HEAD.join(','), ...lines].join('\r\n')
}
