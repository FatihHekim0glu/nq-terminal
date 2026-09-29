// Which server a run talks to, for the specs and watchers that run against both. The Windows run
// (playwright.config.ts) drives the fixture-mode backend; the offline run (playwright.offline.config.ts) drives
// a Node-side demo API (src/demo/serve.ts) and sets NQT_E2E_TARGET=offline before any spec loads.
//
// Against the demo, a request the dataset has no honest body for answers 404 with the refusal header below,
// and the browser logs a "Failed to load resource" console error for it. That is the demo declining, not a
// page bug: the watchers drop those lines, and only those. Against the fixture backend nothing carries the
// header, so every filter here is a no-op there.
import type { Page } from '@playwright/test'

export const OFFLINE = process.env.NQT_E2E_TARGET === 'offline'

// Restated from src/demo/serve.ts: a spec cannot import from src. src/demo/serve.test.ts pins the equality.
export const DEMO_REFUSAL_HEADER = 'x-nqt-demo'
export const DEMO_REFUSAL_VALUE = 'not-in-dataset'

/** The part of a Playwright response the recorder reads. */
export interface RefusalResponse {
  url(): string
  headers(): Record<string, string>
}

/** The part of a Playwright page the recorder needs: a page satisfies it. */
export interface RefusalPage {
  on(event: 'response', listener: (response: RefusalResponse) => void): unknown
}

/** Adds to `refused` the URL of every response of `page` that carries the demo refusal header. Call before goto. */
export function recordDemoRefusals(page: RefusalPage | Page, refused: Set<string>): void {
  const watched: RefusalPage = page
  watched.on('response', (response) => {
    if (response.headers()[DEMO_REFUSAL_HEADER] === DEMO_REFUSAL_VALUE) refused.add(response.url())
  })
}

const LOAD_FAILURE = 'Failed to load resource'

/**
 * `errors` without the browser's "Failed to load resource" lines whose text ends with a refused URL (the
 * watchers record each console error as `<text> <url>`). Every other error, and a line for a URL that was
 * not refused, stays.
 */
export function withoutDemoRefusals(errors: readonly string[], refused: ReadonlySet<string>): string[] {
  if (refused.size === 0) return [...errors]
  return errors.filter((line) => !(line.startsWith(LOAD_FAILURE) && [...refused].some((url) => line.endsWith(` ${url}`))))
}
