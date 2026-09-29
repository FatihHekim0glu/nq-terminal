// The HL search index (spec 5.1 item 9): functions and chrome words, the metrics a built screen shows,
// the 27 instruments by name and the help text, each with the act choosing it performs. Pure. It is
// reached only through searchIndexLoader's dynamic import(), so this file, copy/searchMetrics.ts and
// the help prose load in a chunk of their own, after the first paint, and stay out of the shell
// (searchIndex.split.test.ts holds that).
//
// searchEntries() ranks a query against the entries:
//   0 the exact code or word      3 a whole word of the label or an alias
//   1 the catalogue id            4 a substring of the entry's texts
//   2 a prefix of the label       5 a substring of the help prose (the hit carries a phrase)
//                                 6 a fuzzy match on the label (four characters or more)
// Hits sort by rank, then group (function, word, metric, instrument, help), then label, and each group
// keeps its first six.
import type { MenuAct } from '../chrome/CommandLine.menus'
import { CHROME_WORDS, MNEMONIC_SCREENS } from '../copy/commands'
import { HELP_TOPICS } from '../copy/helpTopics'
import { CONTRACT_NAMES } from '../copy/market'
import { SEARCH } from '../copy/search'
import { METRIC_ENTRIES } from '../copy/searchMetrics'
import { fillCopy } from '../copy/workspace'
import { MNEMONICS } from './registry'
import { genericFor } from './sectors'
import { fuzzy } from './suggest'

export type SearchGroup = 'function' | 'word' | 'metric' | 'instrument' | 'help'
export type SearchRank = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Groups in the order ties sort and results list. */
const GROUP_SEQUENCE: readonly SearchGroup[] = ['function', 'word', 'metric', 'instrument', 'help']
/** Hits kept per group. */
const GROUP_LIMIT = 6
/** The width of a help phrase, before its ... marks. */
const PHRASE_WIDTH = 60
/** A fuzzy match on three characters or fewer matches labels at random ('oil' in 'annualised volatility'), so it starts at four. */
const FUZZY_MIN = 4

export interface SearchEntry {
  readonly group: SearchGroup
  /** What the menu shows: a code or word, a root for an instrument (the menu turns it into a ticker),
   *  `<code> HELP` for a help page (the line choosing it runs). */
  readonly label: string
  /** The function, root or help page the entry stands for; a metric's is the function that shows it. */
  readonly code: string
  readonly detail: string
  readonly act: MenuAct
  /** Lower-case forms of the code or word that rank 0. */
  readonly exact: readonly string[]
  /** The lower-case catalogue id (rank 1), or null. */
  readonly id: string | null
  /** The lower-case name: ranks 2 (prefix), 3 (whole word) and 6 (fuzzy). Empty when the entry has none. */
  readonly title: string
  /** Other lower-case names a reader might type: rank 3. */
  readonly aliases: readonly string[]
  /** Lower-case texts a substring of which ranks 4. */
  readonly texts: readonly string[]
  /** Help prose, one string per line of the page, as written: a substring of it ranks 5. */
  readonly prose: readonly string[]
}

export interface SearchHit {
  readonly entry: SearchEntry
  readonly rank: SearchRank
  /** The help sentence around the match, cut to about 60 characters; null unless the rank is 5. */
  readonly phrase: string | null
}

export interface SearchIndex {
  readonly entries: readonly SearchEntry[]
  readonly search: (query: string) => readonly SearchHit[]
}

type EntryBase = Pick<SearchEntry, 'group' | 'label' | 'code' | 'detail' | 'act'> & Partial<Omit<SearchEntry, 'group' | 'label' | 'code' | 'detail' | 'act'>>

function entry(base: EntryBase): SearchEntry {
  return { exact: [], id: null, title: '', aliases: [], texts: [], prose: [], ...base }
}

const lower = (texts: readonly string[]): string[] => texts.map((t) => t.toLowerCase())

function functionEntries(): SearchEntry[] {
  return MNEMONICS.map((m) =>
    entry({
      group: 'function',
      label: m.code,
      code: m.code,
      detail: m.screen,
      // As HL has always done: a function that takes a context fills the line, one that takes none runs.
      act: m.accepts.length === 0 && m.argument !== 'date' ? { kind: 'run', line: m.code } : { kind: 'fill', line: `${m.code} ` },
      exact: [m.code.toLowerCase()],
      title: m.code.toLowerCase(),
      texts: lower([m.code, m.screen]),
    }),
  )
}

function wordEntries(): SearchEntry[] {
  return Object.entries(CHROME_WORDS).map(([word, description]) =>
    entry({
      group: 'word',
      label: word,
      code: word,
      detail: fillCopy(SEARCH.wordDetail, { group: SEARCH.groups.word, detail: description }),
      act: { kind: 'fill', line: `${word} ` },
      exact: [word.toLowerCase()],
      title: word.toLowerCase(),
      texts: lower([word, description]),
    }),
  )
}

function metricEntries(): SearchEntry[] {
  return METRIC_ENTRIES.map((m) => {
    const aliases = lower(m.aliases ?? [])
    return entry({
      group: 'metric',
      label: m.code,
      code: m.code,
      detail: fillCopy(SEARCH.metricDetail, { group: SEARCH.groups.metric, label: m.label, id: m.id, screen: MNEMONIC_SCREENS[m.code] }),
      act: { kind: 'run', line: m.code },
      id: m.id.toLowerCase(),
      title: m.label.toLowerCase(),
      aliases,
      texts: [m.label.toLowerCase(), m.id.toLowerCase(), ...aliases],
    })
  })
}

function instrumentEntries(): SearchEntry[] {
  return Object.entries(CONTRACT_NAMES).map(([root, name]) => {
    const [rootText, ticker] = [root.toLowerCase(), genericFor(root).toLowerCase()]
    return entry({
      group: 'instrument',
      label: root,
      code: root,
      detail: fillCopy(SEARCH.instrumentDetail, { group: SEARCH.groups.instrument, name }),
      act: { kind: 'context', context: { kind: 'instrument', value: root } },
      exact: [rootText, ticker],
      title: name.toLowerCase(),
      aliases: [rootText, ticker],
      texts: [name.toLowerCase(), rootText, ticker],
    })
  })
}

function helpEntries(): SearchEntry[] {
  return Object.entries(HELP_TOPICS).map(([code, topic]) =>
    entry({
      group: 'help',
      label: `${code} HELP`,
      code,
      detail: fillCopy(SEARCH.helpDetail, { group: SEARCH.groups.help, code, phrase: topic.summary }),
      act: { kind: 'run', line: `${code} HELP` },
      prose: [topic.summary, ...topic.shows, topic.data, ...(topic.honesty ? [topic.honesty] : [])],
    }),
  )
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Whether `q` stands in `text` as a whole word (or words): not inside a longer one. */
function hasWord(text: string, q: string): boolean {
  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + q.length])) return true
  }
  return false
}

/** The sentence of `text` that holds the match at `at`, cut to about PHRASE_WIDTH around it. */
function phraseAround(text: string, at: number, length: number): string {
  let start = 0
  let end = text.length
  for (const boundary of text.matchAll(/[.!?](?=\s)/g)) {
    if (boundary.index + 1 <= at) start = boundary.index + 1
    else {
      end = boundary.index + 1
      break
    }
  }
  while (start < end && /\s/.test(text[start] ?? '')) start += 1
  const sentence = text.slice(start, end)
  const match = Math.max(0, at - start)
  const width = Math.max(PHRASE_WIDTH, length)
  if (sentence.length <= width) return sentence.trim()
  let from = Math.max(0, match - Math.floor((width - length) / 2))
  let to = Math.min(sentence.length, from + width)
  from = Math.max(0, to - width)
  // Do not begin or end in half a word, unless the match itself is there.
  if (from > 0 && sentence[from - 1] !== ' ') {
    const space = sentence.indexOf(' ', from)
    if (space !== -1 && space < match) from = space + 1
  }
  if (to < sentence.length && sentence[to] !== ' ') {
    const space = sentence.lastIndexOf(' ', to)
    if (space >= match + length) to = space
  }
  return `${from > 0 ? '...' : ''}${sentence.slice(from, to).trim()}${to < sentence.length ? '...' : ''}`
}

/** The phrase around the first line of prose that holds `q`, or null. */
function proseMatch(prose: readonly string[], q: string): string | null {
  for (const text of prose) {
    const at = text.toLowerCase().indexOf(q)
    if (at !== -1) return phraseAround(text, at, q.length)
  }
  return null
}

function rankOf(e: SearchEntry, q: string): { readonly rank: SearchRank; readonly phrase: string | null } | null {
  if (e.exact.includes(q)) return { rank: 0, phrase: null }
  if (e.id === q) return { rank: 1, phrase: null }
  if (e.title.startsWith(q)) return { rank: 2, phrase: null }
  if (hasWord(e.title, q) || e.aliases.some((alias) => hasWord(alias, q))) return { rank: 3, phrase: null }
  if (e.texts.some((text) => text.includes(q))) return { rank: 4, phrase: null }
  const phrase = proseMatch(e.prose, q)
  if (phrase !== null) return { rank: 5, phrase }
  if (q.length >= FUZZY_MIN && fuzzy(e.title, q)) return { rank: 6, phrase: null }
  return null
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function compareHits(a: SearchHit, b: SearchHit): number {
  return (
    a.rank - b.rank ||
    GROUP_SEQUENCE.indexOf(a.entry.group) - GROUP_SEQUENCE.indexOf(b.entry.group) ||
    compareText(a.entry.label.toLowerCase(), b.entry.label.toLowerCase())
  )
}

/** The hits for `query`, best first: at most six per group. An empty query has none. */
export function searchEntries(index: Pick<SearchIndex, 'entries'>, query: string): SearchHit[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (q === '') return []
  const found: SearchHit[] = []
  for (const e of index.entries) {
    const ranked = rankOf(e, q)
    if (ranked) found.push({ entry: e, rank: ranked.rank, phrase: ranked.phrase })
  }
  found.sort(compareHits)
  const kept = new Map<SearchGroup, number>()
  return found.filter((hit) => {
    const n = (kept.get(hit.entry.group) ?? 0) + 1
    kept.set(hit.entry.group, n)
    return n <= GROUP_LIMIT
  })
}

/** Builds the index from the registry, the chrome words, the metric list, the contract names and the help pages. */
export function buildSearchIndex(): SearchIndex {
  const entries = [...functionEntries(), ...wordEntries(), ...metricEntries(), ...instrumentEntries(), ...helpEntries()]
  return { entries, search: (query) => searchEntries({ entries }, query) }
}
