// The pure part of the automated weekly parity list (04 D6.2): the rows, the comparison of two doors' figures, the research gate log reading,
// the record and where it is written. It imports no browser and no page code, so scripts/playwrightDesktopConfig.test.ts can type-check and
// test it under the node project; parityAuto.ts (the browser part) re-exports all of it, and both specs keep importing parityAuto.ts.
import fs from 'node:fs'
import path from 'node:path'
import { BUDGETS } from '../perf/trace.ts'
import { OWNER_PORT } from './launch.ts'

// ---------------------------------------------------------------------------------------------------------- rows and results

export const GATE_FENCE = '2022-01-01'
export type ParityMode = 'fixture' | 'real'
/** How a row is checked: both doors, the app only, the fixture backend only, or by the owner. */
export type RowWay = 'doors' | 'app' | 'fixture' | 'owner'
export type RowStatus = 'green' | 'red' | 'owner' | 'skipped'

export interface RowDef {
  readonly row: number
  readonly name: string
  readonly way: RowWay
  /** What stays with the owner, for the rows of that way. */
  readonly owner?: string
}

export interface RowResult {
  readonly row: number
  readonly status: RowStatus
  readonly note: string
  readonly differences: readonly string[]
}

export interface GateReading {
  readonly lines: number
  readonly otherCallers: number
  readonly afterFence: number
  /** Every torn line in the file, old ones too. */
  readonly torn: number
  /** Torn lines that can have been written since the run began. */
  readonly tornInRun: number
  /** Lines in the window whose ts_utc or end could not be read. */
  readonly unparsed: number
}

export const PARITY_ROWS: readonly RowDef[] = [
  { row: 1, name: 'HOME with data', way: 'doors' },
  { row: 2, name: 'GP and GIP, pan and zoom', way: 'app' },
  { row: 3, name: 'REG and MT', way: 'doors' },
  { row: 4, name: 'RUN with the fills pivot', way: 'app' },
  { row: 5, name: 'EQ to MRET tabs', way: 'doors' },
  { row: 6, name: 'MON and CORR', way: 'doors' },
  { row: 7, name: 'LEDG and OOS', way: 'doors' },
  { row: 8, name: 'LIVE and JRNL in stream mode', way: 'doors' },
  { row: 9, name: 'HELP', way: 'doors' },
  { row: 10, name: 'DES save (the native dialog)', way: 'owner', owner: 'the native save dialog (the download handler is checked by 30-export)' },
  { row: 11, name: 'GRAB copy and save (an image editor)', way: 'owner', owner: 'pasting the grab into an image editor' },
  { row: 12, name: 'Print dossier (the real print dialog)', way: 'owner', owner: 'the real print dialog and the PDF (the print stylesheet is checked by 60-print)' },
  { row: 13, name: 'JOBS queue and stop', way: 'fixture' },
  { row: 14, name: 'F1 and F8 to F11', way: 'app' },
  { row: 15, name: 'SAVE and LOAD of a workspace', way: 'doors' },
  { row: 16, name: 'Amber-classic look', way: 'doors' },
]

export const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The differences between the figures two doors read (white space ignored); a door that read nothing is a difference too. */
export function compareFigures(app: Readonly<Record<string, string>>, browser: Readonly<Record<string, string>>): string[] {
  const keys = [...new Set([...Object.keys(app), ...Object.keys(browser)])]
  if (keys.length === 0) return ['no figure was read from either door']
  const seen = (figures: Readonly<Record<string, string>>, key: string): string => (key in figures ? squash(figures[key] ?? '') : 'missing')
  return keys.flatMap((key) => (seen(app, key) === seen(browser, key) ? [] : [`${key}: app ${seen(app, key)}, browser ${seen(browser, key)}`]))
}

/** The second door's origin: the app backend's own loopback origin, never the owner's port. */
export function doorOrigin(origin: string): string {
  const url = URL.canParse(origin) ? new URL(origin) : null
  if (url === null || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error(`the parity door needs an http://127.0.0.1 loopback origin; got ${origin}`)
  if (Number(url.port) === OWNER_PORT) throw new Error(`the parity door never opens the owner's port ${OWNER_PORT}`)
  return url.origin
}

// ---------------------------------------------------------------------------------------------------------- the gate log

/**
 * Reads the research gate's log text, as the owner template does: lines since a time, other callers, lines ending after the fence.
 * A check that cannot read a line never passes it: a line in the window whose `end` is missing or does not parse is `unparsed`. So is a line
 * whose ts_utc does not parse, and a torn line is `tornInRun`, unless a later line from before `sinceMs` shows it was already there (the log
 * only grows, so such a line cannot have been written during the run). `torn` counts every torn line in the file.
 */
export function readGateLog(text: string, sinceMs: number): GateReading {
  const fence = Date.parse(`${GATE_FENCE}T00:00:00Z`)
  let lines = 0
  let otherCallers = 0
  let afterFence = 0
  let torn = 0
  let unparsedEnds = 0
  let pendingTorn = 0
  let pendingBadStamps = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const entry = line.startsWith('{') ? parseEntry(line) : null
    if (entry === null) { torn += 1; pendingTorn += 1; continue }
    const stamp = Date.parse(String(entry.ts_utc))
    if (Number.isNaN(stamp)) { pendingBadStamps += 1; continue }
    if (stamp < sinceMs) { pendingTorn = 0; pendingBadStamps = 0; continue }
    lines += 1
    if (entry.caller !== 'terminal') otherCallers += 1
    const end = Date.parse(String(entry.end ?? '').replace(' ', 'T'))
    if (Number.isNaN(end)) unparsedEnds += 1
    else if (end > fence) afterFence += 1
  }
  return { lines, otherCallers, afterFence, torn, tornInRun: pendingTorn, unparsed: unparsedEnds + pendingBadStamps }
}

function parseEntry(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The lab's log read since `sinceMs`, or null when the lab has none (a fixture lab). */
export function readGateLogFile(lab: string, sinceMs: number): GateReading | null {
  const file = path.join(lab, 'results', 'oos_access_log.jsonl')
  return fs.existsSync(file) ? readGateLog(fs.readFileSync(file, 'utf8'), sinceMs) : null
}

// ---------------------------------------------------------------------------------------------------------- the record

export interface RecordInput {
  readonly mode: ParityMode
  readonly date: string
  readonly rows: readonly RowResult[]
  readonly gate: GateReading | null
  readonly meta?: Readonly<Record<string, string>>
}

export function rowCounts(rows: readonly RowResult[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { green: 0, red: 0, owner: 0, skipped: 0 }
  for (const r of rows) counts[r.status] += 1
  return counts
}

/** Why a record is not a pass: a row missing or doubled, a red row, a row skipped where it may not be, a gate reading that is not clean. */
export function recordProblems(input: RecordInput): string[] {
  const problems: string[] = []
  for (const def of PARITY_ROWS) {
    const found = input.rows.filter((r) => r.row === def.row)
    if (found.length !== 1) { problems.push(`row ${def.row} has ${found.length} results`); continue }
    const status = found[0]?.status
    if (status === 'red') problems.push(`row ${def.row} is red`)
    if (status === 'skipped' && !(def.row === 13 && input.mode === 'real')) problems.push(`row ${def.row} was skipped`)
    if (def.way === 'owner' && status !== 'owner') problems.push(`row ${def.row} is not marked for the owner`)
  }
  if (input.gate === null && input.mode === 'real') problems.push('the gate log was not read')
  if (input.gate !== null && input.gate.otherCallers > 0) problems.push(`${input.gate.otherCallers} gate log lines have another caller`)
  if (input.gate !== null && input.gate.unparsed > 0) problems.push(`${input.gate.unparsed} gate log lines have a time that cannot be read (unreadable ts_utc or end)`)
  if (input.gate !== null && input.gate.tornInRun > 0) problems.push(`${input.gate.tornInRun} torn gate log lines appear after the run began`)
  if (input.gate !== null && input.gate.afterFence > 0) problems.push(`${input.gate.afterFence} gate log lines end after ${GATE_FENCE}`)
  return problems
}

const cell = (text: string): string => text.replace(/\|/g, '/').replace(/\n/g, ' ')

function rowLine(def: RowDef, result: RowResult | undefined): string {
  const status = result === undefined ? 'NOT RUN' : result.status.toUpperCase()
  const note = result === undefined ? '' : [result.note, ...result.differences].filter((t) => t !== '').join('; ')
  return `| ${def.row} | ${def.name} | ${def.way} | ${status} | ${cell(note)} |`
}

/** The dated record of one run, in the shape of the owner's weekly parity template. */
export function recordMarkdown(input: RecordInput): string {
  const problems = recordProblems(input)
  const counts = rowCounts(input.rows)
  const gate = input.gate === null
    ? 'not read (no gate log in a fixture lab)'
    : `${input.gate.lines} lines, ${input.gate.otherCallers} other callers, ${input.gate.afterFence} after the fence, ${input.gate.unparsed} unreadable, ${input.gate.tornInRun} torn since the run began (${input.gate.torn} torn lines in the file)`
  return [
    '# Record: the automated weekly parity list',
    '',
    `Result: ${problems.length === 0 ? 'PASS' : 'FAIL'}   Mode: ${input.mode}   Date: ${input.date}`,
    '',
    ...Object.entries(input.meta ?? {}).map(([k, v]) => `- ${k}: ${v}`),
    `- Rows: ${counts.green} green, ${counts.red} red, ${counts.owner} for the owner, ${counts.skipped} skipped`,
    `- Gate log: ${gate}`,
    '',
    '| # | Row | Way | Status | Note |',
    '| ---: | --- | --- | --- | --- |',
    ...PARITY_ROWS.map((def) => rowLine(def, input.rows.find((r) => r.row === def.row))),
    '',
    ...(problems.length === 0 ? ['No problems.'] : ['Problems:', ...problems.map((p) => `- ${p}`)]),
    '',
  ].join('\n')
}


/** The harness's own ceiling for a frame interval at the 95th percentile (desktop/harness/lib/rows.mjs gip_pan_zoom_p95). */
export const GIP_P95_CEILING_MS = BUDGETS.panZoom.maxP95Ms

// ---------------------------------------------------------------------------------------------------------- output

/** Where a run's record goes: the run folder, and NQT_PARITY_OUT too when it names a folder (never on C:). */
export function recordFolders(runDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const named = env.NQT_PARITY_OUT ?? ''
  if (named === '') return [runDir]
  if (/^c:/i.test(path.resolve(named))) throw new Error(`the parity record is written on D: or E: only; NQT_PARITY_OUT is ${named}`)
  return [runDir, path.resolve(named)]
}

export const rowsFile = (runDir: string, mode: ParityMode): string => path.join(runDir, `parity-rows-${mode}.jsonl`)

/** Keeps one row's result in the run folder (a worker that restarts after a failed test loses its memory, not the folder). */
export function keepResult(runDir: string, mode: ParityMode, r: RowResult): void {
  fs.appendFileSync(rowsFile(runDir, mode), `${JSON.stringify(r)}\n`)
}

export function keptResults(runDir: string, mode: ParityMode): RowResult[] {
  const file = rowsFile(runDir, mode)
  if (!fs.existsSync(file)) return []
  const latest = new Map<number, RowResult>()
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')) {
    const r = JSON.parse(line) as RowResult
    latest.set(r.row, r)
  }
  return [...latest.values()].sort((a, b) => a.row - b.row)
}

/** Writes the run's record (markdown and the rows as JSON) into each folder and returns the markdown. */
export function writeRecord(input: RecordInput, runDir: string): string {
  const markdown = recordMarkdown(input)
  for (const folder of recordFolders(runDir)) {
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, `${input.date}_weekly-parity-auto-${input.mode}.md`), markdown)
    fs.writeFileSync(path.join(folder, `${input.date}_weekly-parity-auto-${input.mode}.json`), JSON.stringify({ ...input, problems: recordProblems(input) }, null, 2))
  }
  return markdown
}

