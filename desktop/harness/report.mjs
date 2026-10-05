// The report of a folder of raw records: median of accepted runs per row and build, the ceiling verdict, the agreement of
// the two builds, the minimise checks and the reproduction verdict. Everything is recomputed from the raw files; `--check`
// reads every reported figure back from its raw record and fails on anything missing or inconsistent.
//
//   node report.mjs DIR [--min-runs 3] [--json] [--check] [--strict]
//   exit 0: ok;  1: the evidence is incomplete or a figure does not match its raw file (--check);  4: complete, but a ceiling is
//   exceeded or two builds disagree (--check --strict).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRecords, COUNTED } from './lib/record.mjs'
import { ROWS, CHECKS, verdictOf, privateBytesLeakVerdict } from './lib/rows.mjs'
import { median, range, agreeWithinNoise, round } from './lib/stats.mjs'
import { SETTLED_FROM_S } from './lib/mem.mjs'

export const AGREE_ROWS = ['backend_ready', 'cold_home', 'idle_mem_home']

/** Every figure of the counted records, with the record it came from. */
export function collectFigures(records) {
  const out = []
  for (const r of records) {
    if (!COUNTED.includes(r.status)) continue
    for (const f of r.figures ?? []) out.push({ ...f, status: r.status, label: r.label ?? null, file: r.file, record: r })
  }
  return out
}

function rowReport(row, figs, minRuns) {
  const builds = {}
  for (const build of row.builds) {
    const mine = figs.filter((f) => f.row === row.id && f.build === build)
    const accepted = mine.filter((f) => f.status === 'accepted')
    const provisional = mine.filter((f) => f.status === 'provisional')
    const basis = accepted.length ? accepted : provisional
    const stats = range(basis.map((f) => f.value))
    const needed = row.soak || build === 'release' ? 1 : minRuns // the soak and the installer are single readings
    builds[build] = { accepted: accepted.length, provisional: provisional.length, needed, ...stats, label: accepted.length ? (accepted.length >= needed ? 'ACCEPTED' : 'TOO FEW RUNS') : provisional.length ? 'PROVISIONAL' : 'MISSING',
      verdict: verdictOf(row, stats.median), methods: [...new Set(basis.map((f) => f.method))] }
  }
  const verdicts = Object.values(builds).map((b) => b.verdict)
  const verdict = verdicts.includes('missing') ? 'missing' : verdicts.includes('over-ceiling') ? 'over-ceiling' : verdicts.every((v) => v === 'within-target') ? 'within-target' : 'within-ceiling'
  return { id: row.id, label: row.label, unit: row.unit, target: row.target, ceiling: row.ceiling, builds, verdict }
}

function checkReport(records, figs) {
  const out = {}
  for (const [id, c] of Object.entries(CHECKS)) {
    const all = figs.filter((f) => f.row === id)
    // A page-level driver only changes what the page reports, so its reading proves nothing about a hidden view: not tested.
    const mine = all.filter((f) => f.engineLevel !== false)
    const worst = mine.length ? Math.max(...mine.map((f) => f.value)) : null
    const verdict = worst === null ? (all.length ? 'not-tested' : 'missing') : worst > c.ceiling ? 'over-ceiling' : 'within-ceiling'
    out[id] = { label: c.label, ceiling: c.ceiling, readings: mine.length, worstMs: worst, verdict }
  }
  return out
}

/** The reproduction verdict of a folder: the newest real (not dry) one, else the newest dry one, else null. A folder holds the
 *  verdicts of every earlier attempt, and the first one found must not stand in for the run that counts. */
export function newestReproduction(records) {
  const verdicts = records.filter((r) => r.mode === 'reproduce' && r.reproduced !== undefined)
  const newest = (list) => list.reduce((best, r) => (best === null || String(r.writtenAtIso ?? '') >= String(best.writtenAtIso ?? '') ? r : best), null)
  return newest(verdicts.filter((r) => !r.dry)) ?? newest(verdicts)
}

/** The private-bytes verdict of every counted soak record, recomputed from its raw samples (a record without the summary still gets one). */
export function soakLeaks(records) {
  return records.filter((r) => COUNTED.includes(r.status) && (r.soak || r.mode === 'soak') && Array.isArray(r.samples))
    .map((r) => ({ file: r.file, ...privateBytesLeakVerdict(r.samples) }))
}

export function buildReport(records, { minRuns = 3 } = {}) {
  const figs = collectFigures(records)
  const rows = ROWS.map((row) => rowReport(row, figs, minRuns))
  const agreement = Object.fromEntries(AGREE_ROWS.map((id) => {
    const r = rows.find((x) => x.id === id)
    const a = r.builds.smoke
    const b = r.builds.measure
    return [id, a && b && a.median !== null && b.median !== null ? { smoke: a.median, measure: b.median, agree: agreeWithinNoise(a, b) } : { smoke: a?.median ?? null, measure: b?.median ?? null, agree: null }]
  }))
  const counts = {}
  for (const r of records) { const k = `${r.build ?? '-'}:${r.mode ?? '-'}`; (counts[k] ??= {})[r.status] = ((counts[k][r.status]) ?? 0) + 1 }
  const rejected = records.filter((r) => r.status === 'rejected').map((r) => ({ file: r.file, avgPct: r.gate?.avgPct ?? null, build: r.build }))
  const repro = newestReproduction(records)
  return { rows, agreement, checks: checkReport(records, figs), soakLeaks: soakLeaks(records).map(({ rule, ...l }) => l), counts, rejectedKept: rejected, reproduction: repro ? { reproduced: repro.reproduced, dry: repro.dry, verdict: repro.verdict } : null,
    unreproducedRuns: records.filter((r) => COUNTED.includes(r.status) && r.unreproduced === true).length,
    provenanceHeads: [...new Set(records.map((r) => r.provenance?.head).filter(Boolean))], stampsAgree: new Set(records.filter((r) => r.provenance?.diffSha256).map((r) => `${r.provenance.diffSha256}/${r.provenance.untrackedSha256}`)).size <= 1 }
}

/** The read-back check: [] when sound, else the list of problems. Each reported figure must equal its raw record's row value. */
export function checkEvidence(records, report, { minRuns = 3, builds = ['smoke', 'measure'] } = {}) {
  const problems = []
  for (const row of report.rows) {
    for (const build of row.builds ? Object.keys(row.builds) : []) {
      if (!builds.includes(build) && build !== 'release') continue
      const b = row.builds[build]
      if (b.label === 'MISSING') problems.push(`row ${row.id} has no reading on the ${build} build`)
      else if (b.label === 'TOO FEW RUNS') problems.push(`row ${row.id} on the ${build} build has ${b.accepted} accepted run(s), ${b.needed} needed`)
      if (b.label !== 'MISSING' && b.verdict === 'missing') problems.push(`row ${row.id} on the ${build} build has no ceiling verdict`)
    }
  }
  for (const f of collectFigures(records)) {
    const raw = f.record.rows?.[f.row]
    if (raw !== f.value) problems.push(`figure ${f.row}/${f.build} in ${path.basename(f.file)} is ${f.value} but the record's own row says ${raw}`)
    if (!f.method || !f.unit || f.cpuLoadPct === undefined || !f.stamp?.head) problems.push(`figure ${f.row}/${f.build} in ${path.basename(f.file)} lacks its method, unit, CPU load or provenance stamp`)
  }
  for (const [id, c] of Object.entries(report.checks)) if (c.verdict === 'missing') problems.push(`check ${id} has no reading`)
  const unread = idleBreakdownUnread(records)
  if (unread.unread > 0) problems.push(`T4 canvas clause not evaluated: the idle breakdown was not read in ${unread.unread} of ${unread.taken} counted run(s): ${unread.reason}`)
  for (const [id, c] of Object.entries(report.checks)) if (c.verdict === 'not-tested') problems.push(`check ${id} is not tested: only a page-level driver hid the view (no engine-level proof)`)
  return problems
}

export function overCeiling(report) {
  const bad = []
  for (const r of report.rows) if (r.verdict === 'over-ceiling') bad.push(`row ${r.id} is over its ceiling`)
  for (const [id, a] of Object.entries(report.agreement)) if (a.agree === false) bad.push(`the builds disagree on ${id}`)
  for (const [id, c] of Object.entries(report.checks)) if (c.verdict === 'over-ceiling') bad.push(`check ${id} is over its ceiling`)
  for (const l of report.soakLeaks ?? []) if (l.verdict === 'fail') bad.push(`soak ${path.basename(l.file ?? '')}: ${l.reason}`)
  if (report.unreproducedRuns > 0) bad.push(`${report.unreproducedRuns} counted run(s) were taken without a reproduction of the W0B figures (UNREPRODUCED)`)
  return bad
}

const INFO = 'informational, not the row'
const T4_CANVAS_NOTE = 'T4: the UI tree alone is above 350 MB idle; look at canvas backing stores per panel (02_decision.md).'

/** Counted records that took an idle reading since the idle breakdown was recorded (the key is present; null means it was not read). */
function idleBreakdownUnread(records) {
  const taken = records.filter((r) => COUNTED.includes(r.status) && 'idleBreakdown' in r)
  const unread = taken.filter((r) => !r.idleBreakdown)
  const reason = unread.map((r) => r.idleBreakdownError).find(Boolean) ?? 'no reason recorded'
  return { taken: taken.length, unread: unread.length, reason }
}

/** Informational lines of the counted records: the idle breakdown per build and the soak's start-up peak and settled maximum.
 *  They sit beside the row verdicts and never change them; a record without the fields adds nothing. */
export function informationalLines(records) {
  const fmt = (v) => String(round(v, 1))
  const lines = []
  const counted = records.filter((r) => COUNTED.includes(r.status))
  for (const build of [...new Set(counted.filter((r) => r.idleBreakdown).map((r) => r.build))]) {
    const mine = counted.filter((r) => r.build === build && r.idleBreakdown)
    const med = (get) => median(mine.map(get).filter((v) => typeof v === 'number'))
    const types = [...new Set(mine.flatMap((r) => Object.keys(r.idleBreakdown.perType ?? {})))]
    const perType = types.map((t) => `${t} ${fmt(med((r) => r.idleBreakdown.perType?.[t]))}`).join(', ')
    lines.push(`${INFO}: idle breakdown, ${build} build, median of ${mine.length}: backend ${fmt(med((r) => r.idleBreakdown.backendMB))} MB, UI tree ${fmt(med((r) => r.idleBreakdown.uiTreeMB))} MB, shell ${fmt(med((r) => r.idleBreakdown.shellMB))} MB${perType ? `; UI tree by type (MB): ${perType}` : ''}`)
    if (mine.some((r) => r.uiOver350 === true)) lines.push(`${INFO}: ${T4_CANVAS_NOTE}`)
    const cmdFail = mine.find((r) => r.idleBreakdown.commandLineError)
    if (cmdFail) lines.push(`${INFO}: command lines not read in ${mine.filter((r) => r.idleBreakdown.commandLineError).length} of ${mine.length} runs (${build} build): ${cmdFail.idleBreakdown.commandLineError}; the WebView2 processes are counted as unknown`)
  }
  for (const build of [...new Set(counted.filter((r) => Array.isArray(r.memSamples)).map((r) => r.build))]) {
    const mine = counted.filter((r) => r.build === build && Array.isArray(r.memSamples) && r.memSamples.length)
    const med = (key) => median(mine.flatMap((r) => r.memSamples.map((m) => m[key])).filter((v) => typeof v === 'number'))
    if (mine.length && med('privateBytesMB') !== null) lines.push(`${INFO}: idle private bytes, ${build} build, median of ${mine.length}: ${fmt(med('privateBytesMB'))} MB beside the private working set ${fmt(med('wsPrivateMB'))} MB (a trim lowers the working set, not the private bytes)`)
  }
  const unread = idleBreakdownUnread(records)
  if (unread.unread > 0) lines.push(`${INFO}: idle breakdown not read in ${unread.unread} of ${unread.taken} runs: ${unread.reason}; T4 canvas clause not evaluated for those runs`)
  for (const r of counted.filter((x) => x.soak && typeof x.soak.startupPeakMB === 'number')) {
    const sk = r.soak
    const settled = typeof sk.settledMaxMB === 'number' ? `${fmt(sk.settledMaxMB)} MB` : 'none (no sample from 900 s)'
    if (sk.breakdownFailures > 0) lines.push(`${INFO}: soak breakdown not read in ${sk.breakdownFailures} samples: ${sk.breakdownError}`)
    lines.push(`${INFO}: soak, start-up peak ${fmt(sk.startupPeakMB)} MB (first sample at ${sk.firstSampleAtS} s), settled maximum ${settled} (samples from ${SETTLED_FROM_S} s); the row is the largest sample, ${fmt(sk.maxMB)} MB`)
  }
  for (const l of soakLeaks(records)) lines.push(`soak private bytes (leak signal, ${path.basename(l.file ?? '')}): ${l.verdict}; ${l.reason}`)
  return lines
}

/** The report as printed: the table, the agreement and check lines, then the informational lines. */
export function reportLines(report, records = []) {
  const fmt = (v) => (v === null || v === undefined ? '-' : String(round(v, 1)))
  const out = ['row | build | n | median (min..max) | target / ceiling | verdict']
  for (const r of report.rows) {
    for (const [build, b] of Object.entries(r.builds)) out.push(`${r.id} | ${build} | ${b.accepted}${b.provisional ? `+${b.provisional}P` : ''} | ${fmt(b.median)} (${fmt(b.min)}..${fmt(b.max)}) ${r.unit} | ${r.target} / ${r.ceiling} | ${b.verdict} ${b.label}`)
  }
  for (const [id, a] of Object.entries(report.agreement)) out.push(`agreement ${id}: smoke ${fmt(a.smoke)} measure ${fmt(a.measure)} -> ${a.agree === null ? 'not both measured' : a.agree ? 'within noise' : 'DISAGREE'}`)
  for (const [id, c] of Object.entries(report.checks)) out.push(`check ${id}: ${c.verdict} (worst ${fmt(c.worstMs)} ms, ceiling ${c.ceiling})`)
  if (report.unreproducedRuns > 0) out.push(`UNREPRODUCED runs counted: ${report.unreproducedRuns}`)
  out.push(`rejected runs kept: ${report.rejectedKept.length}; reproduction: ${report.reproduction ? (report.reproduction.reproduced ? 'reproduced' : 'NOT reproduced') + (report.reproduction.dry ? ' (dry)' : '') : 'no verdict in this folder'}`)
  return [...out, ...informationalLines(records)]
}

function printTable(report, records) { for (const line of reportLines(report, records)) console.log(line) }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  const dir = argv.find((a) => !a.startsWith('--'))
  const minRuns = Number(argv[argv.indexOf('--min-runs') + 1] ?? 3) || 3
  if (!dir || !fs.existsSync(dir)) { console.error('usage: node report.mjs DIR [--min-runs 3] [--json] [--check] [--strict]'); process.exit(2) }
  const records = loadRecords(dir)
  const report = buildReport(records, { minRuns })
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1) + '\n', 'utf8')
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 1)); else printTable(report, records)
  if (argv.includes('--check')) {
    const problems = checkEvidence(records, report, { minRuns })
    for (const p of problems) console.error(`CHECK FAILED: ${p}`)
    if (problems.length) process.exit(1)
    const bad = overCeiling(report)
    for (const p of bad) console.error(`${argv.includes('--strict') ? 'CEILING' : 'note'}: ${p}`)
    if (bad.length && argv.includes('--strict')) process.exit(4)
    console.log('check ok: every row present with its ceiling verdict, every figure read back from its raw file')
  }
}
