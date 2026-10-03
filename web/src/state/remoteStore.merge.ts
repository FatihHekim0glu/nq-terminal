// The merge rules of the workspace store (03 sections 10.2 and 10.4), as pure functions over documents' `data`.
//
// `mergeOnClash` settles a 412: this page's copy (`local`) against the store's current one (`server`), with the
// copy the page last saw as `base` (null when it is not known, as after a reload with unsent changes). This page's
// writes are the newest, so a thing it changed wins and a thing it did not change follows the store. `mergeImport`
// is the one-time per-origin import: the store's values stay and only what it lacks is added.
// Nothing here touches storage or the network, and nothing is mutated: every result is a new object.
import { COPY_SUFFIXES, HISTORY_LIMIT, hasCopySuffix, type DocName } from './remoteStore.keys'

type Json = Record<string, unknown>
const MAX_WORKSPACES = 12
const MAX_IMPORTS = 16
const CONFLICT = COPY_SUFFIXES[0]
const IMPORTED = COPY_SUFFIXES[1]

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Json).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonical(v)]))
  }
  return value
}

/** Equal by value, whatever the key order; undefined equals only undefined. */
export function same(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

const obj = (value: unknown): Json => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})
const lines = (value: unknown): string[] => (Array.isArray(value) ? value.filter((l): l is string => typeof l === 'string') : [])
const lastOf = (value: unknown): string | null => {
  const last = obj(value)['last']
  return typeof last === 'string' ? last : null
}

/** Names of a document in a stable order: the first object's, then the second's that the first lacks. */
function namesOf(first: Json, second: Json): string[] {
  return [...Object.keys(first), ...Object.keys(second).filter((name) => !Object.hasOwn(first, name))]
}

interface Merged {
  readonly list: Json
  readonly copies: Json
}

/** One workspace name settled between the sides; `kept` is its value in the list, `copy` the loser to keep beside it. */
function settle(l: unknown, s: unknown, b: unknown, baseKnown: boolean): { kept?: unknown; copy?: unknown } {
  if (!baseKnown) return l === undefined ? { kept: s } : same(l, s) || s === undefined ? { kept: l } : { kept: l, copy: s }
  if (same(l, b)) return { kept: s }
  if (same(s, b) || same(l, s)) return { kept: l }
  if (l === undefined) return { kept: s }
  return s === undefined ? { kept: l } : { kept: l, copy: s }
}

function settleWorkspaces(base: unknown, local: unknown, server: unknown): Merged {
  const baseList = obj(obj(base)['list'])
  const l = obj(obj(local)['list'])
  const s = obj(obj(server)['list'])
  const baseKnown = base !== null
  return namesOf(s, l).reduce<Merged>(
    (acc, name) => {
      const { kept, copy } = settle(l[name], s[name], baseList[name], baseKnown)
      return {
        list: kept === undefined ? acc.list : { ...acc.list, [name]: kept },
        copies: copy === undefined || hasCopySuffix(name) ? acc.copies : { ...acc.copies, [`${name}${CONFLICT}`]: copy },
      }
    },
    { list: {}, copies: {} },
  )
}

/** The list with the copies after it (a copy never replaces a name that exists), cut to the 12 the store takes. */
function withCopies(list: Json, copies: Json, existing: Json = list): Json {
  const added = Object.entries(copies).filter(([name]) => !Object.hasOwn(existing, name))
  return Object.fromEntries([...Object.entries(list), ...added].slice(0, MAX_WORKSPACES))
}

function mergeWorkspaces(base: unknown, local: unknown, server: unknown): unknown {
  const { list, copies } = settleWorkspaces(base, local, server)
  const merged = withCopies(list, copies)
  const baseLast = base === null ? undefined : lastOf(base)
  const wanted = lastOf(local) !== baseLast || base === null ? lastOf(local) : lastOf(server)
  const pick = [wanted, lastOf(server), lastOf(local)].find((name) => name !== null && Object.hasOwn(merged, name)) ?? null
  return { list: merged, last: pick }
}

function mergeLayouts(base: unknown, local: unknown, server: unknown): unknown {
  const b = obj(base)
  const l = obj(local)
  const s = obj(server)
  if (base === null) return { ...s, ...l }
  return Object.fromEntries(
    namesOf(s, l).flatMap((code) => {
      const value = same(l[code], b[code]) ? s[code] : l[code]
      return value === undefined ? [] : [[code, value] as const]
    }),
  )
}

function mergeHistory(base: unknown, local: unknown, server: unknown): unknown {
  const seen = new Set(lines(base))
  const fresh = lines(local).filter((line) => !seen.has(line))
  const stored = lines(server)
  const have = new Set(stored)
  return [...stored, ...fresh.filter((line) => !have.has(line))].slice(-HISTORY_LIMIT)
}

function mergePrefs(base: unknown, local: unknown, server: unknown): unknown {
  const b = obj(base)
  const l = obj(local)
  const s = obj(server)
  return Object.fromEntries(
    namesOf(s, l).flatMap((field) => {
      const value = base !== null && same(l[field], b[field]) ? s[field] : l[field]
      return value === undefined ? [] : [[field, value] as const]
    }),
  )
}

interface ImportEntry {
  readonly origin: string
  readonly at: string
}

const entries = (value: unknown): ImportEntry[] =>
  (Array.isArray(obj(value)['imports']) ? (obj(value)['imports'] as unknown[]) : []).flatMap((e) => {
    const { origin, at } = obj(e)
    return typeof origin === 'string' && typeof at === 'string' ? [{ origin, at }] : []
  })

function mergeMeta(local: unknown, server: unknown): unknown {
  const all = [...entries(server), ...entries(local)]
  const earliest = new Map<string, ImportEntry>()
  for (const entry of all) {
    const held = earliest.get(entry.origin)
    if (held === undefined || entry.at < held.at) earliest.set(entry.origin, { ...held, ...entry })
  }
  const schema = obj(server)['schema']
  return { schema: typeof schema === 'number' ? schema : 1, imports: [...earliest.values()].slice(0, MAX_IMPORTS) }
}

/**
 * The document that settles a 412. `local` is this page's copy and is the newest; `server` is the store's current
 * one; `base` is what this page last saw of the store (null when unknown: then this page's copy wins every clash and
 * nothing it lacks is taken to be deleted). A workspace both sides changed keeps this page's edit under its name and
 * the store's as "<name> (conflict)"; an edit of a workspace this page forgot is kept rather than lost.
 */
export function mergeOnClash(doc: DocName, base: unknown, local: unknown, server: unknown): unknown {
  switch (doc) {
    case 'workspaces':
      return mergeWorkspaces(base, local, server)
    case 'layouts':
      return mergeLayouts(base, local, server)
    case 'history':
      return mergeHistory(base, local, server)
    case 'prefs':
      return mergePrefs(base, local, server)
    case 'meta':
      return mergeMeta(local, server)
    default:
      return local
  }
}

/** What an import adds to a keyed document: entries the store lacks, and "<name> (imported)" copies of differing ones. */
function importedEntries(store: Json, imported: Json): { readonly plain: Array<readonly [string, unknown]>; readonly copies: Array<readonly [string, unknown]> } {
  const plain = Object.entries(imported).filter(([name]) => !Object.hasOwn(store, name))
  const copies = Object.entries(imported).flatMap(([name, value]) => {
    const copy = `${name}${IMPORTED}`
    const skip = !Object.hasOwn(store, name) || same(store[name], value) || hasCopySuffix(name) || Object.hasOwn(store, copy)
    return skip ? [] : [[copy, value] as const]
  })
  return { plain, copies }
}

function importWorkspaces(store: unknown, imported: unknown): unknown {
  const held = obj(obj(store)['list'])
  const { plain, copies } = importedEntries(held, obj(obj(imported)['list']))
  const list = Object.fromEntries([...Object.entries(held), ...plain, ...copies].slice(0, MAX_WORKSPACES))
  const last = [lastOf(store), lastOf(imported)].find((name) => name !== null && Object.hasOwn(list, name)) ?? null
  return { list, last }
}

function importLayouts(store: unknown, imported: unknown): unknown {
  const { plain, copies } = importedEntries(obj(store), obj(imported))
  return { ...obj(store), ...Object.fromEntries([...plain, ...copies]) }
}

function importLinkGroups(store: unknown, imported: unknown): unknown {
  const held = obj(obj(store)['contexts'])
  const given = obj(obj(imported)['contexts'])
  return { contexts: Object.fromEntries(['A', 'B', 'C'].map((group) => [group, held[group] ?? given[group] ?? null])) }
}

function importHistory(store: unknown, imported: unknown): unknown {
  const stored = lines(store)
  const have = new Set(stored)
  return [...lines(imported).filter((line) => !have.has(line)), ...stored].slice(-HISTORY_LIMIT)
}

/**
 * The store's document with what an origin's localStorage holds laid in (03 section 10.4): what the store lacks is
 * added; where both hold a value the store's stays, and a differing workspace or layout is kept beside it as
 * "<name> (imported)". Repeating it with the same input changes nothing.
 */
export function mergeImport(doc: Exclude<DocName, 'meta'>, store: unknown, imported: unknown): unknown {
  switch (doc) {
    case 'workspaces':
      return importWorkspaces(store, imported)
    case 'layouts':
      return importLayouts(store, imported)
    case 'linkGroups':
      return importLinkGroups(store, imported)
    case 'history':
      return importHistory(store, imported)
    case 'prefs':
      return { ...obj(imported), ...obj(store) }
    default:
      return Object.keys(obj(store)).length > 0 ? store : imported
  }
}

/** A document without the "(conflict)" and "(imported)" entries: for a store that refuses names of that form. */
export function stripCopies(doc: DocName, data: unknown): unknown {
  if (doc === 'workspaces') {
    const list = Object.fromEntries(Object.entries(obj(obj(data)['list'])).filter(([name]) => !hasCopySuffix(name)))
    const last = lastOf(data)
    return { list, last: last !== null && Object.hasOwn(list, last) ? last : null }
  }
  if (doc === 'layouts') return Object.fromEntries(Object.entries(obj(data)).filter(([code]) => !hasCopySuffix(code)))
  return data
}
