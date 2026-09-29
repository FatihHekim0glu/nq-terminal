// Demo builds only (`pnpm demo`, `pnpm build:demo`): main.tsx imports this module behind
// `import.meta.env.MODE === 'demo'`, which is the literal `false` in a production build, so the import, this
// chunk and the fixture data it reaches are dropped (scripts/bundleCheck.ts checks it with DEMO_MARKERS).
// The demo is the real terminal on fixture data with no backend: before the terminal renders, the page's
// fetch and EventSource are replaced by assignment with the demo's (src/demo/fetch.ts, src/demo/stream.ts),
// which answer every /api GET and the live stream in the browser. The terminal's own code runs unchanged and
// still sends every request through src/api/client.ts, GET only. The root element carries data-demo="on", the
// page's one demo mark (copy/chrome.ts isDemoPage): the frame strip's DEMO DATA key (it opens About this demo on the
// HELP page), the status line's data segment (the same term and tooltip) and REG's provenance line (copy/reg.ts)
// read it. The demo's /api/health says fixture_mode, which is what puts that segment on the status line.
import { createDemoFetch } from './fetch'
import { DemoEventSource } from './stream'

/** A demo-only string: the key of the saved page globals, and the bundle check's proof of a demo build. */
export const DEMO_MARKER = 'nqt-demo'

/** The page's own fetch and EventSource, as they were before the demo replaced them. */
interface PageGlobals {
  readonly fetch: typeof globalThis.fetch
  readonly EventSource: unknown
}

/**
 * Installs the demo layer once per page. A second call (a second boot, a module reloaded in development)
 * finds the saved page globals and leaves the installed layer alone, so the demo fetch never wraps itself.
 */
function installDemo(): void {
  const saved = globalThis as unknown as Record<symbol, PageGlobals | undefined>
  const sources = globalThis as { EventSource?: unknown }
  const key = Symbol.for(DEMO_MARKER)
  if (saved[key] === undefined) {
    // Bound: the browser's fetch refuses to run with any `this` but the window.
    const page: PageGlobals = { fetch: globalThis.fetch.bind(globalThis), EventSource: sources.EventSource }
    saved[key] = page
    globalThis.fetch = createDemoFetch({ passThrough: page.fetch, origin: globalThis.location.origin })
    sources.EventSource = DemoEventSource
  }
  document.documentElement.dataset.demo = 'on'
}

export function bootDemo(renderApp: () => void): void {
  installDemo()
  renderApp()
}
