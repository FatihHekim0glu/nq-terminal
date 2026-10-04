// GPU reading beside every gated slot: utilisation and memory used, from the driver's own tool. The owner's GPU job runs on
// purpose, so each record says how busy the card was. A reading that cannot be taken is recorded as unavailable, never guessed,
// and never stops a measurement.
import { execFile } from 'node:child_process'

const QUERY = ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits']

/** Parses the tool's CSV rows (one per card); the busiest card is the one reported. */
export function parseGpu(text) {
  const cards = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(',').map((x) => Number(x.trim())))
    .filter((c) => c.length === 2 && c.every((n) => Number.isFinite(n)))
  if (cards.length === 0) return { available: false, reason: 'no readable nvidia-smi output' }
  const [utilPct, memUsedMiB] = cards.reduce((best, c) => (c[0] > best[0] ? c : best))
  return { available: true, utilPct, memUsedMiB }
}

const runNvidiaSmi = () => new Promise((resolve, reject) => {
  execFile('nvidia-smi', QUERY, { windowsHide: true, timeout: 8000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
})

/** One reading. `run` is injectable for the self-test. Never throws. */
export async function readGpu({ run = runNvidiaSmi } = {}) {
  const atIso = new Date().toISOString()
  try { return { ...parseGpu(await run()), atIso } } catch (e) { return { available: false, reason: String(e?.message ?? e).slice(0, 160), atIso } }
}
