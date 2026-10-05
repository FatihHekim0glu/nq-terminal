// The launch-reliability mode: N hidden launches of one smoke exe, refusals counted, the READY-to-proof time distribution reported.
// Born failing: neither lib/reliability.mjs nor modes/reliability.mjs existed (the probe lived outside the repository).
// Recorded data: tests/fixtures/reliability-launches.json (the probe's own figures; its note says which launches are synthetic).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { launchTimes, summariseLaunches, reliabilityLines, reliabilityFailed, PROOF_LIMIT_MS, SLOW_PROOF_MS } from '../lib/reliability.mjs'
import { reliabilityOptions } from '../modes/reliability.mjs'
import { makeArgs, modeOf, exitCodeOf } from '../run.mjs'

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/reliability-launches.json', import.meta.url), 'utf8')).launches

test('the default limit is the 2 s the 0.2.0 shell gives the first proof (a flag moves it for a shell that waits longer)', () => {
  assert.equal(PROOF_LIMIT_MS, 2000)
  const o = reliabilityOptions(makeArgs(['--exe', 'a.exe', '--proof-limit-ms', '5000']), { identify: () => 'smoke', isMainTree: () => true })
  assert.equal(o.proofLimitMs, 5000)
})

test('launchTimes: spawn, READY, proof and session from the shell log events and the backend log tail', () => {
  const events = [{ event: 'supervise_spawned', t: 1000 }, { event: 'supervise_checked', t: 2196 }]
  const tail = { seen: { ready: [2180], proof: [2196.1, 2240], session: [2199.3] } }
  const r = launchTimes(events, tail)
  assert.equal(r.outcome, 'checked')
  assert.deepEqual(r.ms, { spawnToReady: 1180, readyToProof: 16.1, proofToSession: 3.2, spawnToChecked: 1196, readyToChecked: 16, spawnToRefused: null, readyToNavProof: 60 })
})

test('launchTimes: a refusal names its code and message, and a launch that never ended says none', () => {
  const refused = launchTimes([{ event: 'supervise_spawned', t: 1000 }, { event: 'supervise_refused', t: 3190, code: 'unverified', message: 'no proof' }], { seen: { ready: [1188] } })
  assert.equal(refused.outcome, 'refused:unverified')
  assert.equal(refused.refusedMessage, 'no proof')
  assert.equal(refused.ms.spawnToRefused, 2190)
  assert.equal(refused.ms.readyToProof, null)
  assert.equal(launchTimes([{ event: 'supervise_spawned', t: 1000 }], null).outcome, 'none')
  assert.equal(launchTimes([{ event: 'supervise_spawned', t: 1000 }, { event: 'supervise_failed', t: 1500, code: 'spawn' }], null).outcome, 'failed:spawn')
})

test('summary of the recorded launches: counts, refusals and the READY-to-proof distribution', () => {
  const s = summariseLaunches(FIXTURE)
  assert.equal(s.launches, 22)
  assert.equal(s.checked, 20)
  assert.equal(s.refused, 1)
  assert.equal(s.incomplete, 1)
  assert.deepEqual(s.outcomes, { checked: 20, 'refused:unverified': 1, none: 1 })
  assert.equal(s.refusedRate, 1 / 22)
  assert.deepEqual(s.refusals.map((r) => r.i), [21])
  assert.equal(s.refusals[0].readyToProofMs, 2410)
  const p = s.readyToProof
  assert.equal(p.n, 21)
  assert.equal(p.min, 14.7)
  assert.equal(p.median, 16.1)
  assert.equal(p.p95, 47.4)
  assert.equal(p.max, 2410)
  assert.equal(p.overLimit, 1, 'one proof took at least the 2 s the shell allows')
  assert.equal(p.overSlow, 1, `proofs over ${SLOW_PROOF_MS} ms`)
  assert.equal(s.spawnToReady.median, 1175.6)
  assert.equal(s.failed, true)
})

test('a run with every launch checked is not failed, and an empty run is', () => {
  const clean = summariseLaunches(FIXTURE.slice(0, 20))
  assert.equal(clean.refused, 0)
  assert.equal(clean.failed, false)
  assert.equal(reliabilityFailed(clean), false)
  assert.equal(clean.readyToProof.max, 47.4)
  const none = summariseLaunches([])
  assert.equal(none.launches, 0)
  assert.equal(none.failed, true, 'no launch is no evidence')
  assert.equal(none.readyToProof.median, null)
  assert.equal(none.refusedRate, null)
})

test('a failed launch (spawn refusal, not a proof refusal) counts as refused', () => {
  const s = summariseLaunches([{ i: 1, outcome: 'failed:spawn', ms: {} }, { i: 2, outcome: 'checked', ms: { readyToProof: 20 } }])
  assert.equal(s.refused, 1)
  assert.equal(s.failed, true)
})

test('the printed lines carry the counts, the refusals and the distribution', () => {
  const text = reliabilityLines(summariseLaunches(FIXTURE)).join('\n')
  assert.match(text, /22 launches: 20 checked, 1 refused, 1 incomplete/)
  assert.match(text, /READY to proof.*median 16\.1.*p95 47\.4.*max 2410/)
  assert.match(text, /refused launch 21: refused:unverified/)
  assert.doesNotMatch(text, /[–—]/, 'no en or em dashes')
})

test('options: the smoke exe is required, the run count is a positive whole number, the exe must be a smoke build', () => {
  const smoke = () => 'smoke'
  const o = reliabilityOptions(makeArgs(['--mode', 'reliability', '--smoke-exe', 'a.exe', '--runs', '25', '--hold-ms', '1500']), { identify: smoke, isMainTree: () => true })
  assert.equal(o.runs, 25)
  assert.equal(o.holdMs, 1500)
  assert.equal(o.exe, 'a.exe')
  assert.equal(o.realData, false)
  assert.equal(reliabilityOptions(makeArgs(['--exe', 'b.exe', '--real-data']), { identify: smoke, isMainTree: () => true }).realData, true)
  assert.throws(() => reliabilityOptions(makeArgs(['--runs', '3']), { identify: smoke, resolve: () => { throw new Error('no smoke exe found') }, isMainTree: () => true }), /no smoke exe/)
  assert.throws(() => reliabilityOptions(makeArgs(['--exe', 'a.exe', '--runs', '0']), { identify: smoke, isMainTree: () => true }), /--runs/)
  assert.throws(() => reliabilityOptions(makeArgs(['--exe', 'a.exe', '--runs', '2.5']), { identify: smoke, isMainTree: () => true }), /--runs/)
  assert.throws(() => reliabilityOptions(makeArgs(['--exe', 'm.exe']), { identify: () => 'measure', isMainTree: () => true }), /smoke/)
})

test('options: a real launch runs from the main tree only; --dry runs anywhere with one launch', () => {
  const smoke = () => 'smoke'
  assert.throws(() => reliabilityOptions(makeArgs(['--exe', 'a.exe']), { identify: smoke, isMainTree: () => false }), /main tree/)
  const dry = reliabilityOptions(makeArgs(['--exe', 'a.exe', '--dry']), { identify: smoke, isMainTree: () => false })
  assert.equal(dry.dry, true)
  assert.equal(dry.runs, 1)
})

test('run.mjs routes --mode reliability, and a refusal makes the exit code 1', () => {
  assert.equal(modeOf(makeArgs(['--mode', 'reliability'])), 'reliability')
  assert.equal(exitCodeOf({ failed: true }), 1)
  assert.equal(exitCodeOf({ failed: false }), 0)
})
