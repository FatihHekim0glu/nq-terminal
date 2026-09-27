// The Perspective engine (TASKS 9.1; ARCHITECTURE section 1, Perspective 5.5.1), loaded once and only
// when a pivot view first mounts: every import below is dynamic, so none of it is in the shell and the
// WebAssembly binaries are fetched on demand from this origin (Vite emits them as assets).
//
// The production CSP (backend security.py) allows 'self' scripts plus 'wasm-unsafe-eval' and nothing
// else, so the library's own defaults cannot run here: its default worker is a blob: URL and its
// fallback is new Function(). Both are replaced: the engine worker is the package's own worker script,
// bundled by Vite as a same-origin file (`?worker`), and the binaries come through fetchAsset (a same-origin GET in src/api/client.ts).
import type { Client } from '@perspective-dev/client'
import { fetchAsset } from '../api/client'

export interface PspEngine {
  readonly client: Client
  /** Milliseconds from the first request to a ready client (fetch, compile and worker start). */
  readonly startMs: number
}

let pending: Promise<PspEngine> | null = null

async function start(): Promise<PspEngine> {
  const began = performance.now()
  const [clientModule, viewerModule, viewerGlue, serverWasm, viewerWasm, engineWorker] = await Promise.all([
    import('@perspective-dev/client'),
    import('@perspective-dev/viewer'),
    // The viewer's WebAssembly glue, passed in so the viewer never imports it from a blob: URL.
    import('@perspective-dev/viewer/dist/wasm/perspective-viewer.js'),
    import('@perspective-dev/server/dist/wasm/perspective-server.wasm?url'),
    import('@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm?url'),
    import('@perspective-dev/client/dist/cdn/perspective-server.worker.js?worker'),
  ])
  // The client finds its WebAssembly through the viewer element, so the viewer starts first.
  await viewerModule.default.init_client(fetchAsset(viewerWasm.default), viewerGlue)
  // The datagrid plugin registers itself with the started viewer element.
  await import('@perspective-dev/viewer-datagrid')
  const perspective = clientModule.default
  perspective.init_server({ wasm32: () => fetchAsset(serverWasm.default) })
  const client = await perspective.worker(Promise.resolve(new engineWorker.default()))
  return { client, startMs: performance.now() - began }
}

/** The shared engine. A failed start is forgotten, so the next pivot view tries again. */
export function loadPerspective(): Promise<PspEngine> {
  pending ??= start().catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}
