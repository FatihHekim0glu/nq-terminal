// The feature probes of the self-test page (D7.2; G1 item 2): each asks the page's own engine for something the app depends
// on and answers pass or fail with what it saw. They go through the app's own modules (the Perspective engine, the live stream
// client, the bridge), so what they prove is what the app does, in the shell the page runs in. The dockview probe, which needs
// an element to draw into, is in probes.dockview.tsx.
import { getBridge } from '../bridge'
import { COPY_PROBE_TEXT, EXPORT_PROBE_NAME, EXPORT_PROBE_TEXT } from './report.ts'
import type { Probe, ProbeOutcome } from './run.ts'

const pass = (detail: string): ProbeOutcome => ({ status: 'pass', detail })
const fail = (detail: string): ProbeOutcome => ({ status: 'fail', detail })

// ---------------------------------------------------------------- Perspective (wasm32)

interface PspView {
  to_json(): Promise<Array<Record<string, unknown>>>
  delete(): Promise<unknown>
}
interface PspTable {
  update(rows: unknown): Promise<unknown>
  size(): Promise<number>
  view(config: Record<string, unknown>): Promise<PspView>
  delete(): Promise<unknown>
}

const PSP_ROWS = [
  { group: 'a', value: 1 },
  { group: 'a', value: 2 },
  { group: 'b', value: 3 },
  { group: 'b', value: 4 },
] as const

/** Loads the engine as the pivot grid does (the 32-bit server only), makes a table, sums it by group and checks the sums. */
export async function perspectiveProbe(): Promise<ProbeOutcome> {
  if (typeof WebAssembly !== 'object') return fail('this engine has no WebAssembly')
  const { loadPerspective } = await import('../perspective/engine')
  const engine = await loadPerspective()
  const table = (await engine.client.table({ group: 'string', value: 'integer' })) as unknown as PspTable
  try {
    await table.update(PSP_ROWS)
    const view = await table.view({ group_by: ['group'], columns: ['value'], aggregates: { value: 'sum' } })
    try {
      const rows = await view.to_json()
      const sums = rows.map((r) => `${JSON.stringify(r.__ROW_PATH__)}=${String(r.value)}`).join(' ')
      const right = rows.length === 3 && sums === '[]=10 ["a"]=3 ["b"]=7'
      return right ? pass(`wasm32 engine ready in ${Math.round(engine.startMs)} ms; ${await table.size()} rows pivoted: ${sums}`) : fail(`wrong pivot: ${sums}`)
    } finally {
      await view.delete()
    }
  } finally {
    await table.delete()
  }
}

// ---------------------------------------------------------------- live stream

/** How long the stream must stay open, with no fall back to polling, before it counts as stream mode. */
const STREAM_HOLD_MS = 1500
const STREAM_WAIT_MS = 15_000

/** Opens the live stream as LIVE and JRNL do, and waits for `open` (hello received) that then holds. */
export async function streamProbe(): Promise<ProbeOutcome> {
  const [{ LiveStream }, { openEventStream }] = await Promise.all([import('../api/liveStream'), import('../api/client')])
  const kinds: string[] = []
  const stream = new LiveStream({ open: openEventStream, onEvent: (event) => kinds.push(event.kind), now: () => Date.now() })
  const opened = new Promise<void>((resolve) => {
    const unsubscribe = stream.subscribe(() => {
      if (stream.getSnapshot().mode === 'open') {
        unsubscribe()
        resolve()
      }
    })
  })
  stream.start()
  try {
    const timedOut = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), STREAM_WAIT_MS))
    if ((await Promise.race([opened, timedOut])) === 'late') return fail(`no hello in ${STREAM_WAIT_MS} ms: ${describe(stream.getSnapshot())}`)
    await new Promise((resolve) => setTimeout(resolve, STREAM_HOLD_MS))
    const held = stream.getSnapshot()
    return held.mode === 'open' ? pass(`stream open, events ${[...new Set(kinds)].join(', ')}, no polling`) : fail(`stream left open mode: ${describe(held)}`)
  } finally {
    stream.stop()
  }
}

function describe(snapshot: { readonly mode: string; readonly reason: string | null }): string {
  return `mode ${snapshot.mode}${snapshot.reason === null ? '' : `, reason ${snapshot.reason}`}`
}

// ---------------------------------------------------------------- text copy and blob export (a click is needed)

/** Puts a fixed text on the clipboard through the bridge; whoever drives the page reads the clipboard to see it arrived. */
export async function copyProbe(): Promise<ProbeOutcome> {
  const bridge = getBridge()
  const taken = await bridge.copyText(COPY_PROBE_TEXT)
  return taken ? pass(`the bridge copied ${COPY_PROBE_TEXT.length} characters (shell ${bridge.platform}, bridge ${bridge.bridgeVersion})`) : fail('the clipboard did not take the text (it needs a click and a focused page)')
}

/** Saves a small csv blob through the bridge, as every export of the app does; the shell's download handler takes it. */
export async function exportProbe(): Promise<ProbeOutcome> {
  const bridge = getBridge()
  const saving = bridge.saveFile(EXPORT_PROBE_NAME, new Blob([EXPORT_PROBE_TEXT], { type: 'text/csv' }))
  if (!saving.started) return fail('the page could not start a download')
  const outcome = await saving
  return outcome === 'saved' ? pass(`the save of ${EXPORT_PROBE_NAME} ended saved (shell ${bridge.platform}, bridge ${bridge.bridgeVersion})`) : fail(`the save ended ${outcome}`)
}

/** The probes that need no host element, as run.ts takes them. */
export const PLAIN_PROBES: readonly Probe[] = [
  { name: 'perspective_wasm32', needsGesture: false, run: perspectiveProbe },
  { name: 'stream_mode', needsGesture: false, run: streamProbe },
  { name: 'text_copy', needsGesture: true, run: copyProbe },
  { name: 'blob_export', needsGesture: true, run: exportProbe },
]
