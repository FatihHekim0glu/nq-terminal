// The ten localStorage keys and the seven store documents they live in (03 section 10.2): which key belongs to
// which document, how a key's text becomes a piece of a document and back, and how a stored value is cleaned
// before it is sent. Pure: no storage, no network. The page keeps writing the keys in their own formats (the
// store modules know nothing of documents); remoteStore.ts translates at the edge.
import { MAX_LINE } from '../commands/parser'
import { isScheme } from '../chrome/FrameStrip.scheme'
import { isLook } from '../theme/look'
import { isLinkContext, LINK_GROUPS } from './linkGroups'
import { isScreenCode, MAX_LAYOUT_CHARS } from './layouts'
import { isWatchSnapshot } from './recordWatch.schema'
import { isPlainObject } from './safeStorage'
import { cleanRecipe, isWorkspaceName, MAX_WORKSPACES } from './workspaces'

export const DOC_NAMES = ['workspaces', 'layouts', 'linkGroups', 'watch', 'history', 'prefs', 'meta'] as const
export type DocName = (typeof DOC_NAMES)[number]
/** The six documents the page's keys live in; `meta` is the store's own bookkeeping. */
export type DataDoc = Exclude<DocName, 'meta'>
export const DATA_DOCS: readonly DataDoc[] = ['workspaces', 'layouts', 'linkGroups', 'watch', 'history', 'prefs']

export const PREF_FIELDS = ['tape', 'cvd', 'theme', 'orientation', 'mon'] as const
export type PrefField = (typeof PREF_FIELDS)[number]

export const HISTORY_LIMIT = 100
const KEY_VERSION = 1
const MON_VIEWS: readonly unknown[] = ['returns', 'normalised']
const MON_MAX_FIELDS = 6
/** The suffixes of the copies a merge keeps (03 section 10.2): never a name the page can type. */
export const COPY_SUFFIXES = [' (conflict)', ' (imported)'] as const

export interface KeySpec {
  readonly key: string
  readonly doc: DataDoc
  readonly field?: PrefField
}

export const KEY_SPECS: readonly KeySpec[] = [
  { key: 'nqt.workspaces', doc: 'workspaces' },
  { key: 'nqt.layouts', doc: 'layouts' },
  { key: 'nqt.linkGroups', doc: 'linkGroups' },
  { key: 'nqt.watch', doc: 'watch' },
  { key: 'nqt.cmd.history', doc: 'history' },
  { key: 'nqt.tape', doc: 'prefs', field: 'tape' },
  { key: 'nqt.cvd', doc: 'prefs', field: 'cvd' },
  { key: 'nqt.theme', doc: 'prefs', field: 'theme' },
  { key: 'nqt.orientation', doc: 'prefs', field: 'orientation' },
  { key: 'nqt.mon.defaults', doc: 'prefs', field: 'mon' },
]

export const KEY_NAMES: readonly string[] = KEY_SPECS.map((spec) => spec.key)

export function specFor(key: string): KeySpec | undefined {
  return KEY_SPECS.find((spec) => spec.key === key)
}

export function keysOf(doc: DataDoc): readonly KeySpec[] {
  return KEY_SPECS.filter((spec) => spec.doc === doc)
}

/** What a document never written holds (the backend's default, models/workspaces.py). */
export function defaultData(doc: DataDoc): unknown {
  const defaults: Record<DataDoc, unknown> = {
    workspaces: { list: {}, last: null },
    layouts: {},
    linkGroups: { contexts: { A: null, B: null, C: null } },
    watch: {},
    history: [],
    prefs: {},
  }
  return defaults[doc]
}

/** A name with the suffix of one of its copies removed. */
export function baseName(name: string): string {
  const suffix = COPY_SUFFIXES.find((s) => name.endsWith(s))
  return suffix === undefined ? name : name.slice(0, -suffix.length)
}

export function hasCopySuffix(name: string): boolean {
  return baseName(name) !== name
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isMonSettings(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    MON_VIEWS.includes(value['view']) &&
    typeof value['heat'] === 'boolean' &&
    typeof value['window'] === 'number' &&
    Object.keys(value).length <= MON_MAX_FIELDS
  )
}

const PREF_CHECKS: Record<PrefField, (value: unknown) => boolean> = {
  tape: (v) => typeof v === 'boolean',
  cvd: isScheme,
  theme: isLook,
  orientation: (v) => v === '1',
  mon: isMonSettings,
}

/** The piece of a document a key's text stands for; undefined when the text is not a value the page would accept. */
export function dataFromText(spec: KeySpec, text: string): unknown {
  if (spec.field !== undefined) return prefFromText(spec.field, text)
  const value = parseJson(text)
  switch (spec.doc) {
    case 'workspaces':
      return isPlainObject(value) && value['version'] === KEY_VERSION && isPlainObject(value['list'])
        ? { list: value['list'], last: typeof value['last'] === 'string' ? value['last'] : null }
        : undefined
    case 'layouts':
      return isPlainObject(value) && value['version'] === KEY_VERSION && isPlainObject(value['layouts']) ? value['layouts'] : undefined
    case 'linkGroups':
      return isPlainObject(value) && value['version'] === KEY_VERSION && isPlainObject(value['contexts']) ? { contexts: value['contexts'] } : undefined
    case 'history':
      return Array.isArray(value) ? value : undefined
    default:
      return isPlainObject(value) ? value : undefined
  }
}

function prefFromText(field: PrefField, text: string): unknown {
  const value = field === 'tape' ? (text === 'true' ? true : text === 'false' ? false : undefined) : field === 'mon' ? parseJson(text) : text
  return value !== undefined && PREF_CHECKS[field](value) ? value : undefined
}

/** The text a key holds for a piece of a document; null removes the key. */
export function textFromData(spec: KeySpec, data: unknown): string | null {
  if (spec.field !== undefined) {
    if (data === undefined) return null
    return spec.field === 'mon' ? JSON.stringify(data) : String(data)
  }
  switch (spec.doc) {
    case 'workspaces': {
      const list = isPlainObject(data) && isPlainObject(data['list']) ? data['list'] : {}
      const last = isPlainObject(data) ? data['last'] : null
      return Object.keys(list).length === 0 ? null : JSON.stringify({ version: KEY_VERSION, list, last: typeof last === 'string' ? last : null })
    }
    case 'layouts':
      return isPlainObject(data) && Object.keys(data).length > 0 ? JSON.stringify({ version: KEY_VERSION, layouts: data }) : null
    case 'linkGroups':
      return JSON.stringify({ version: KEY_VERSION, contexts: isPlainObject(data) ? data['contexts'] : {} })
    case 'history':
      return Array.isArray(data) && data.length > 0 ? JSON.stringify(data) : null
    default:
      return isPlainObject(data) && Object.keys(data).length > 0 ? JSON.stringify(data) : null
  }
}

/** The text of every key of a document, from the document's data: what the cache should hold. */
export function textsFromDoc(doc: DataDoc, data: unknown): ReadonlyMap<string, string | null> {
  const specs = keysOf(doc)
  const prefs = isPlainObject(data) ? data : {}
  return new Map(specs.map((spec) => [spec.key, textFromData(spec, spec.field === undefined ? data : prefs[spec.field])]))
}

/** A document's data with the given keys' values laid over `base` (a null text removes a prefs field or empties a document). */
export function overlayKeys(doc: DataDoc, base: unknown, values: ReadonlyMap<string, string | null>): unknown {
  const specs = keysOf(doc).filter((spec) => values.has(spec.key))
  if (doc !== 'prefs') {
    const spec = specs[0]
    const text = spec === undefined ? null : (values.get(spec.key) ?? null)
    const piece = spec === undefined || text === null ? defaultData(doc) : dataFromText(spec, text)
    return piece === undefined ? base : piece
  }
  const fields = isPlainObject(base) ? { ...base } : {}
  for (const spec of specs) {
    const text = values.get(spec.key) ?? null
    const piece = text === null ? undefined : dataFromText(spec, text)
    if (text !== null && piece === undefined) continue
    if (piece === undefined) delete fields[spec.field ?? '']
    else fields[spec.field ?? ''] = piece
  }
  return fields
}

/** Cleans a recipe list: only names and recipes the page itself would accept, at most 12. */
function cleanWorkspaces(data: unknown): unknown {
  if (!isPlainObject(data) || !isPlainObject(data['list'])) return null
  const entries = Object.entries(data['list']).flatMap(([name, raw]) => {
    const recipe = isWorkspaceName(baseName(name)) ? cleanRecipe(raw) : null
    return recipe === null ? [] : [[name, recipe] as const]
  })
  const list = Object.fromEntries(entries.slice(0, MAX_WORKSPACES))
  const last = typeof data['last'] === 'string' && Object.hasOwn(list, data['last']) ? data['last'] : null
  return { list, last }
}

function cleanLayouts(data: unknown): unknown {
  if (!isPlainObject(data)) return null
  const entries = Object.entries(data).filter(([code, layout]) => isScreenCode(baseName(code)) && isPlainObject(layout) && JSON.stringify(layout).length <= MAX_LAYOUT_CHARS)
  return Object.fromEntries(entries)
}

function cleanLinkGroups(data: unknown): unknown {
  if (!isPlainObject(data) || !isPlainObject(data['contexts'])) return null
  const contexts = data['contexts']
  const pick = (group: string) => (isLinkContext(contexts[group]) ? { kind: contexts[group].kind, value: contexts[group].value } : null)
  return { contexts: Object.fromEntries(LINK_GROUPS.map((group) => [group, pick(group)])) }
}

function cleanHistory(data: unknown): unknown {
  if (!Array.isArray(data)) return null
  return data.filter((line): line is string => typeof line === 'string' && line.trim() !== '' && line.length <= MAX_LINE).slice(-HISTORY_LIMIT)
}

function cleanPrefs(data: unknown): unknown {
  if (!isPlainObject(data)) return null
  return Object.fromEntries(PREF_FIELDS.filter((field) => Object.hasOwn(data, field) && PREF_CHECKS[field](data[field])).map((field) => [field, data[field]]))
}

/**
 * A rebuilt copy of a document's data holding only what the page would accept (stored values are untrusted, and a
 * value the backend refuses would block the whole document), or null when it is not that document's shape.
 */
export function cleanData(doc: DataDoc, data: unknown): unknown {
  switch (doc) {
    case 'workspaces':
      return cleanWorkspaces(data)
    case 'layouts':
      return cleanLayouts(data)
    case 'linkGroups':
      return cleanLinkGroups(data)
    case 'history':
      return cleanHistory(data)
    case 'prefs':
      return cleanPrefs(data)
    default:
      return isPlainObject(data) && (Object.keys(data).length === 0 || isWatchSnapshot(data)) ? data : null
  }
}
