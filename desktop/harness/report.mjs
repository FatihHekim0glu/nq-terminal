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
import { ROWS, CHECKS, verdictOf } from './lib/rows.mjs'
import { median, range, agreeWithinNoise, round } from './lib/stats.mjs'

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
    const mine = figs.filter((f) => f.row === id)
    const worst = mine.length ? Math.max(...mine.map((f) => f.value)) : null
    out[id] = { label: c.label, ceiling: c.ceiling, readings: mine.length, worstMs: worst, verdict: worst === null ? 'missing' : worst > c.ceiling ? 'over-ceiling' : 'within-ceiling' }
  }
  return out
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
  const repro = records.find((r) => r.mode === 'reproduce' && r.reproduced !== undefined) ?? null
  return { rows, agreement, checks: checkReport(records, figs), counts, rejectedKept: rejected, reproduction: repro ? { reproduced: repro.reproduced, dry: repro.dry, verdict: repro.verdict } : null,
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
  return problems
}

export function overCeiling(report) {
  const bad = []
  for (const r of report.rows) if (r.verdict === 'over-ceiling') bad.push(`row ${r.id} is over its ceiling`)
  for (const [id, a] of Object.entries(report.agreement)) if (a.agree === false) bad.push(`the builds disagree on ${id}`)
  for (const [id, c] of Object.entries(report.checks)) if (c.verdict === 'over-ceiling') bad.push(`check ${id} is over its ceiling`)
  if (report.unreproducedRuns > 0) bad.push(`${report.unreproducedRuns} counted run(s) were taken without a reproduction of the W0B figures (UNREPRODUCED)`)
  return bad
}

function printTable(report) {
  const fmt = (v) => (v === null || v === undefined ? '-' : String(round(v, 1)))
  console.log('row | build | n | median (min..max) | target / ceiling | verdict')
  for (const r of report.rows) {
    for (const [build, b] of Object.entries(r.builds)) console.log(`${r.id} | ${build} | ${b.accepted}${b.provisional ? `+${b.provisional}P` : ''} | ${fmt(b.median)} (${fmt(b.min)}..${fmt(b.max)}) ${r.unit} | ${r.target} / ${r.ceiling} | ${b.verdict} ${b.label}`)
  }
  for (const [id, a] of Object.entries(report.agreement)) console.log(`agreement ${id}: smoke ${fmt(a.smoke)} measure ${fmt(a.measure)} -> ${a.agree === null ? 'not both measured' : a.agree ? 'within noise' : 'DISAGREE'}`)
  for (const [id, c] of Object.entries(report.checks)) console.log(`check ${id}: ${c.verdict} (worst ${fmt(c.worstMs)} ms, ceiling ${c.ceiling})`)
  if (report.unreproducedRuns > 0) console.log(`UNREPRODUCED runs counted: ${report.unreproducedRuns}`)
  console.log(`rejected runs kept: ${report.rejectedKept.length}; reproduction: ${report.reproduction ? (report.reproduction.reproduced ? 'reproduced' : 'NOT reproduced') + (report.reproduction.dry ? ' (dry)' : '') : 'no verdict in this folder'}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  const dir = argv.find((a) => !a.startsWith('--'))
  const minRuns = Number(argv[argv.indexOf('--min-runs') + 1] ?? 3) || 3
  if (!dir || !fs.existsSync(dir)) { console.error('usage: node report.mjs DIR [--min-runs 3] [--json] [--check] [--strict]'); process.exit(2) }
  const records = loadRecords(dir)
  const report = buildReport(records, { minRuns })
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1) + '\n', 'utf8')
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 1)); else printTable(report)
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
