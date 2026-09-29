// Loads the HL search index after the first paint (the shell holds this file; the index does not). The
// index, the metric list and the help prose are one lazy chunk, reached only through the import() below.
// Until it has loaded, HL shows today's results and says so. A failed import leaves nothing loaded and
// the next call tries again, so a dropped connection costs one HL, not the session.
import type { SearchIndex } from './searchIndex'

export type { SearchEntry, SearchGroup, SearchHit, SearchIndex, SearchRank } from './searchIndex'

interface IndexModule {
  readonly buildSearchIndex: () => SearchIndex
}

export interface SearchIndexLoader {
  /** The index once loaded, else null. */
  readonly loaded: () => SearchIndex | null
  /** Loads it (once; calls made while it loads share the one import). Resolves null when it failed. */
  readonly load: () => Promise<SearchIndex | null>
}

export function createSearchIndexLoader(importIndex: () => Promise<IndexModule>): SearchIndexLoader {
  let index: SearchIndex | null = null
  let pending: Promise<SearchIndex | null> | null = null

  async function attempt(): Promise<SearchIndex | null> {
    try {
      index = (await importIndex()).buildSearchIndex()
      return index
    } catch {
      return null
    }
  }

  return {
    loaded: () => index,
    load() {
      if (index) return Promise.resolve(index)
      if (!pending) {
        const started = attempt()
        pending = started
        // Once it has settled, forget it: a failure must not stick, so the next call retries.
        void started.then(() => {
          if (pending === started) pending = null
        })
      }
      return pending
    },
  }
}

const shared = createSearchIndexLoader(() => import('./searchIndex'))

/** The shared index, or null while it is not loaded (yet, or after a failed import). */
export const loadedSearchIndex = shared.loaded

/** Starts (or joins) the shared load; call it after the first paint. */
export const loadSearchIndex = shared.load
