// The launch-reliability figures: what one hidden launch of a smoke exe did (the shell log events plus a 1 ms tail of the backend log),
// and the summary of N such launches: refusals, and the distribution of READY to the first identity proof. Pure; the mode
// (modes/reliability.mjs) does the launching. The method is the post-0.2.0 launch probe's (a record of it is in the 0.2.1 notes):
// the shell gives the backend's first identity proof LINK_TIMEOUT (2 s in 0.2.0, supervise_run.rs) and refuses with `unverified` past it,
// so the READY-to-proof time is the margin against that refusal.
import { range, quantile, round } from './stats.mjs'

/** The first-proof allowance of the 0.2.0 shell, in ms (LINK_TIMEOUT in supervise_run.rs). `--proof-limit-ms` moves it for another shell. */
export const PROOF_LIMIT_MS = 2000
/** A proof slower than this is slow beside the 16 ms median of 0.1.2 and 0.2.0, whatever the limit. */
export const SLOW_PROOF_MS = 100
/** The shell log events that end a launch's start-up. */
export const TERMINAL_EVENTS = new Set(['supervise_checked', 'supervise_refused', 'supervise_failed', 'stale_dist'])

const diff = (a, b) => (typeof a === 'number' && typeof b === 'number' ? round(b - a, 1) : null)
const first = (events, name) => events.find((e) => e.event === name) ?? null

/**
 * One launch. events: the parsed shell log (`t` in epoch ms); tail: the backend log tail ({ seen: { ready, proof, session } }, epoch ms
 * lists), or null when it could not be read. Returns the outcome and the intervals in ms (null where an end is missing).
 */
export function launchTimes(events, tail) {
  const spawned = first(events, 'supervise_spawned')?.t ?? null
  const checked = first(events, 'supervise_checked')?.t ?? null
  const refused = first(events, 'supervise_refused')
  const failed = first(events, 'supervise_failed')
  const ended = events.find((e) => TERMINAL_EVENTS.has(e.event)) ?? null
  const ready = tail?.seen?.ready?.[0] ?? null
  const proofs = tail?.seen?.proof ?? []
  const session = tail?.seen?.session?.[0] ?? null
  const outcome = refused ? `refused:${refused.code}` : failed ? `failed:${failed.code}` : checked ? 'checked' : ended ? ended.event : 'none'
  return {
    outcome,
    refusedMessage: refused?.message ?? null,
    ms: {
      spawnToReady: diff(spawned, ready),
      readyToProof: diff(ready, proofs[0] ?? null),
      proofToSession: diff(proofs[0] ?? null, session),
      spawnToChecked: diff(spawned, checked),
      readyToChecked: diff(ready, checked),
      spawnToRefused: diff(spawned, refused?.t ?? null),
      readyToNavProof: diff(ready, proofs[1] ?? null),
    },
  }
}

const isRefusal = (outcome) => /^(refused|failed):/.test(outcome) || outcome === 'stale_dist'

function distribution(values, { slowMs, limitMs }) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  const r = range(xs)
  return { n: r.n, min: r.min, median: r.median, p95: quantile(xs, 0.95), max: r.max, overSlow: xs.filter((v) => v > slowMs).length, overLimit: xs.filter((v) => v >= limitMs).length }
}

/**
 * The summary of N launches (each { i, outcome, refusedMessage?, ms }). A run fails when it has no launch, when any launch was
 * refused, or when any launch ended without an outcome (a start that never finished is not a pass).
 */
export function summariseLaunches(launches, { slowMs = SLOW_PROOF_MS, proofLimitMs = PROOF_LIMIT_MS } = {}) {
  const outcomes = {}
  for (const l of launches) outcomes[l.outcome] = (outcomes[l.outcome] ?? 0) + 1
  const refusals = launches.filter((l) => isRefusal(l.outcome)).map((l) => ({ i: l.i, outcome: l.outcome, message: l.refusedMessage ?? null, readyToProofMs: l.ms?.readyToProof ?? null }))
  const incomplete = launches.filter((l) => l.outcome === 'none').length
  const opts = { slowMs, limitMs: proofLimitMs }
  const summary = {
    launches: launches.length,
    checked: outcomes.checked ?? 0,
    refused: refusals.length,
    incomplete,
    outcomes,
    refusedRate: launches.length ? refusals.length / launches.length : null,
    refusals,
    proofLimitMs,
    slowMs,
    readyToProof: distribution(launches.map((l) => l.ms?.readyToProof), opts),
    spawnToReady: distribution(launches.map((l) => l.ms?.spawnToReady), opts),
    proofToSession: distribution(launches.map((l) => l.ms?.proofToSession), opts),
  }
  return { ...summary, failed: reliabilityFailed(summary) }
}

export const reliabilityFailed = (s) => s.launches === 0 || s.refused > 0 || s.incomplete > 0

const f1 = (v) => (v === null || v === undefined ? '-' : String(round(v, 1)))

const distLine = (label, d) => `${label}: n ${d.n}, min ${f1(d.min)}, median ${f1(d.median)}, p95 ${f1(d.p95)}, max ${f1(d.max)} ms`

/** The summary as printed. */
export function reliabilityLines(s) {
  const lines = [
    `${s.launches} launches: ${s.checked} checked, ${s.refused} refused, ${s.incomplete} incomplete (refused rate ${s.refusedRate === null ? '-' : f1(s.refusedRate * 100) + ' %'})`,
    distLine('READY to proof', s.readyToProof) + `; ${s.readyToProof.overSlow} over ${s.slowMs} ms, ${s.readyToProof.overLimit} at or over the ${s.proofLimitMs} ms the shell allows`,
    distLine('spawn to READY', s.spawnToReady),
    distLine('proof to session', s.proofToSession),
  ]
  for (const r of s.refusals) lines.push(`refused launch ${r.i}: ${r.outcome}${r.message ? ` (${r.message})` : ''}; READY to proof ${f1(r.readyToProofMs)} ms`)
  return lines
}
