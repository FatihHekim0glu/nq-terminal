// CPU gate: total CPU over a window before each run. A run whose average is above the limit is rejected; the record
// is kept. Uses the OS tick counters (no child process, so the gate itself adds almost no load).
import os from 'node:os'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function totals(cpus = os.cpus()) {
  let idle = 0
  let total = 0
  for (const c of cpus) { idle += c.times.idle; total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }
  return { idle, total }
}

export const pctBusy = (a, b) => { const dt = b.total - a.total; return dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10 : 0 }

/** Reads the CPU for `seconds` (one sample a second). `read` is injectable for the self-test. */
export async function readCpu(seconds, { limitPct = 10, enforce = true, read = totals, wait = sleep } = {}) {
  const startedAtIso = new Date().toISOString()
  const samples = []
  const first = read()
  let prev = first
  for (let i = 0; i < seconds; i++) {
    await wait(1000)
    const now = read()
    samples.push(pctBusy(prev, now))
    prev = now
  }
  const avgPct = pctBusy(first, prev)
  const maxPct = samples.length ? Math.max(...samples) : 0
  return { startedAtIso, seconds, avgPct, maxPct, limitPct, enforced: enforce, pass: avgPct <= limitPct, samples }
}

/**
 * Waits for a quiet machine: gate readings until one passes or `maxWaitSeconds` have gone, then gives up (manager decision 2:
 * never wait for ever; a run taken after the wait is labelled PROVISIONAL by its caller).
 */
export async function waitQuiet({ gateSeconds = 60, limitPct = 10, maxWaitSeconds = 600, gate = readCpu } = {}) {
  const readings = []
  let waited = 0
  for (;;) {
    const g = await gate(gateSeconds, { limitPct, enforce: true })
    readings.push(g)
    waited += gateSeconds
    if (g.pass || waited >= maxWaitSeconds) return { quiet: g.pass, readings, waitedSeconds: waited }
  }
}
