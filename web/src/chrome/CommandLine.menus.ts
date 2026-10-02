// Numbered menus the command line shows in its sheet (spec 5.1 items 3, 4, 6, 8, 9 and 4.7): a
// context's functions, the sector menus, the last commands, related functions, one function's help and
// HL search results. Pure builders (searchMenu only asks the loader to start); CommandLine.state.ts
// decides what choosing an item does. This file is in the shell: it reads SEARCH and the loader, never the
// lazy search index or its metric list (commands/searchIndex.split.test.ts).
import { isBuilt } from '../commands/built'
import { withValue } from '../commands/messages'
import { MNEMONICS, findMnemonic, type MnemonicCode, type MnemonicDef } from '../commands/registry'
import { loadSearchIndex, loadedSearchIndex, type SearchHit } from '../commands/searchIndexLoader'
import { FUTURES_SECTORS, displayContext, displayInstrument, sectorForRoot, type SectorCode } from '../commands/sectors'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import { ARGUMENT_NAMES, CHROME_WORDS, SUGGESTION_DETAILS } from '../copy/commands'
import { COMMAND_MENUS, SECTOR_MENU } from '../copy/menus'
import { SEARCH } from '../copy/search'
import { fillCopy } from '../copy/workspace'

export type MenuAct =
  | { readonly kind: 'run'; readonly line: string }
  | { readonly kind: 'fill'; readonly line: string }
  | { readonly kind: 'context'; readonly context: ResolvedContext }
  | { readonly kind: 'open'; readonly menu: MenuModel }

export interface MenuItem {
  readonly n: number
  readonly label: string
  readonly detail: string
  readonly category: boolean
  readonly act: MenuAct
}

export interface MenuModel {
  readonly key: string
  readonly title: string
  readonly breadcrumb: readonly string[]
  readonly intro: readonly string[]
  readonly items: readonly MenuItem[]
}

export const LAST_COUNT = 8
/** Rows HL lists: with the index loaded, its hits (six a group) then the hypotheses and runs. */
const SEARCH_LIMIT = 30
/** Rows without the index: today's functions, words, hypotheses and runs. */
const TODAY_LIMIT = 20
const CATEGORY_SEQUENCE = ['rates', 'energy', 'metals', 'grains', 'livestock'] as const

type Draft = Omit<MenuItem, 'n' | 'category'> & { readonly category?: boolean }

function numbered(drafts: readonly Draft[]): MenuItem[] {
  return drafts.map((d, i) => ({ ...d, n: i + 1, category: d.category ?? false }))
}

function menu(key: string, title: string, drafts: readonly Draft[], breadcrumb: readonly string[] = [], intro: readonly string[] = []): MenuModel {
  return { key, title, breadcrumb: [...breadcrumb, title], intro, items: numbered(drafts) }
}

/** What choosing function `m` for `value` does: run it, or fill the line when it needs a date. */
function functionAct(m: MnemonicDef, value: string | null): MenuAct {
  const line = value ? `${value} ${m.code}` : m.code
  return m.argument === 'date' ? { kind: 'fill', line: `${line} ` } : { kind: 'run', line }
}

/** The functions a context can open, numbered in registry order (spec 5.1 item 3). */
export function functionMenu(context: ResolvedContext, index: CommandIndexData | null): MenuModel {
  const title = displayContext(context, index)
  const drafts = MNEMONICS.filter((m) => m.accepts.includes(context.kind)).map((m) => ({ label: m.code, detail: m.screen, act: functionAct(m, context.value) }))
  return menu(`ctx:${context.kind}:${context.value}`, title, drafts)
}

function instrumentDraft(root: string, symbol: string, index: CommandIndexData | null): Draft {
  return { label: displayInstrument(root, index), detail: withValue(SUGGESTION_DETAILS.instrument, symbol), act: { kind: 'context', context: { kind: 'instrument', value: root } } }
}

function instrumentsIn(sector: SectorCode, index: CommandIndexData | null) {
  return (index?.instruments ?? []).filter((i) => sectorForRoot(i.root, index) === sector)
}

/** INDEX and CURNCY list their futures; COMDTY lists categories that open theirs (spec 5.1 item 4). */
export function sectorMenu(sector: SectorCode, index: CommandIndexData | null): MenuModel {
  const title = SECTOR_MENU[sector]
  const futures = instrumentsIn(sector, index)
  if (!(FUTURES_SECTORS as readonly string[]).includes(sector) || futures.length === 0) return menu(`sector:${sector}`, title, [], [], [SECTOR_MENU.none])
  if (sector !== 'COMDTY') return menu(`sector:${sector}`, title, futures.map((i) => instrumentDraft(i.root, i.symbol, index)))
  const categories = CATEGORY_SEQUENCE.map((c) => ({ c, list: futures.filter((i) => i.sector === c) })).filter((x) => x.list.length > 0)
  const drafts = categories.map(({ c, list }) => {
    const name = SECTOR_MENU.categories[c]
    const sub = menu(`sector:COMDTY:${c}`, name, list.map((i) => instrumentDraft(i.root, i.symbol, index)), [title])
    return { label: `${name}${COMMAND_MENUS.categoryMark}`, detail: '', category: true, act: { kind: 'open', menu: sub } as const }
  })
  return menu('sector:COMDTY', title, drafts)
}

/** The last commands, newest first (spec 5.1 item 8). */
export function lastMenu(entries: readonly string[]): MenuModel {
  const recent = [...entries].reverse().slice(0, LAST_COUNT)
  const intro = recent.length === 0 ? [COMMAND_MENUS.lastEmpty] : []
  return menu('last', COMMAND_MENUS.lastTitle, recent.map((line) => ({ label: line, detail: '', act: { kind: 'run', line } })), [], intro)
}

/** Related functions for the focused panel: its context's functions, or the built screens that take none. */
export function relatedMenu(context: ResolvedContext | null, index: CommandIndexData | null): MenuModel {
  if (context) {
    const fns = functionMenu(context, index)
    return { ...fns, key: `related:${fns.key}`, title: COMMAND_MENUS.menuTitle, breadcrumb: [COMMAND_MENUS.menuTitle, fns.title] }
  }
  const drafts = MNEMONICS.filter((m) => m.accepts.length === 0 && isBuilt(m.code)).map((m) => ({ label: m.code, detail: m.screen, act: functionAct(m, null) }))
  return menu('related', COMMAND_MENUS.menuTitle, drafts)
}

function example(m: MnemonicDef): string | null {
  const kind = m.accepts[0]
  if (!kind) return m.code
  const context = { instrument: 'NQ1 Index', hypothesis: 'rebal_v0', run: 'nt_dtsmom_v0_ts1', universe: '27F' }[kind]
  const argument = m.argument === 'date' ? ' 2019-03-14' : m.argument === 'timeframe' ? ' 1h' : ''
  return `${context} ${m.code}${argument}`
}

/** One function's help (spec 5.1 item 6): what it shows, what it takes, an example to fill in. */
export function helpMenu(code: MnemonicCode): MenuModel {
  const m = findMnemonic(code) as MnemonicDef
  const intro = [withValue(COMMAND_MENUS.helpContext, m.context), withValue(COMMAND_MENUS.helpArgument, ARGUMENT_NAMES[m.argument])]
  const line = example(m) ?? m.code
  const drafts: Draft[] = [
    { label: line, detail: m.screen, act: m.accepts.length === 0 ? { kind: 'run', line } : { kind: 'fill', line } },
    { label: 'HELP', detail: MNEMONICS.find((x) => x.code === 'HELP')?.screen ?? '', act: { kind: 'run', line: 'HELP' } },
  ]
  return menu(`help:${code}`, `${code}: ${m.screen}`, drafts, [], intro)
}

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q)
}

/** An index hit as a menu row: an instrument by its ticker, help text with the phrase it matched. */
function hitDraft(hit: SearchHit, index: CommandIndexData | null): Draft {
  const { entry, phrase } = hit
  if (entry.group === 'instrument') return { label: displayInstrument(entry.label, index), detail: entry.detail, act: entry.act }
  if (entry.group === 'help' && phrase !== null) {
    return { label: entry.label, detail: fillCopy(SEARCH.helpDetail, { group: SEARCH.groups.help, code: entry.code, phrase }), act: entry.act }
  }
  return { label: entry.label, detail: entry.detail, act: entry.act }
}

/** Today's HL rows: the functions and words that match, before the index has loaded. */
function functionAndWordDrafts(q: string): Draft[] {
  const fns = MNEMONICS.filter((m) => matches(`${m.code} ${m.screen}`, q)).map((m) => ({ label: m.code, detail: m.screen, act: m.accepts.length === 0 ? functionAct(m, null) : ({ kind: 'fill', line: `${m.code} ` } as const) }))
  const words = Object.entries(CHROME_WORDS).filter(([w, d]) => matches(`${w} ${d}`, q)).map(([w, d]) => ({ label: w, detail: d, act: { kind: 'fill', line: `${w} ` } as const }))
  return [...fns, ...words]
}

/**
 * HL results (spec 5.1 item 9). With the lazy search index loaded: functions, command words, metrics,
 * instruments and help text, ranked (at most six a group), then the hypotheses (DES) and runs (RUN).
 * Before it has loaded: today's functions, words, hypotheses and runs, an intro saying the rest is on its
 * way, and a call to start the load (so a failed import is tried again).
 *
 * `opts.lazy` says whether to use the lazy index; it defaults to whether the command index is present.
 * The command line always asks for it, so HL keeps its metrics, instruments and help text (or the
 * loading intro) while GET /api/commands is pending or has failed. HELP's own search field passes
 * `lazy: true` and no command index (U03): it lists the help text and the glossary too, so a word only they
 * hold is found, and it acts on every kind of hit (run, fill and an instrument's context).
 */
export function searchMenu(query: string, index: CommandIndexData | null, opts: { readonly lazy?: boolean } = {}): MenuModel {
  const q = query.toLowerCase()
  const lazy = opts.lazy ?? index !== null
  const search = lazy ? loadedSearchIndex() : null
  const loading = lazy && search === null
  if (loading) void loadSearchIndex()
  const hyps = [...(index?.hypotheses ?? []), ...(index?.confirmations ?? [])].filter((h) => matches(h, q)).map((h) => ({ label: h, detail: SUGGESTION_DETAILS.hypothesis, act: { kind: 'run', line: `${h} DES` } as const }))
  const runs = (index?.runs ?? []).filter((r) => matches(r, q)).map((r) => ({ label: r, detail: SUGGESTION_DETAILS.run, act: { kind: 'run', line: `${r} RUN` } as const }))
  const found = search ? search.search(query).map((hit) => hitDraft(hit, index)) : functionAndWordDrafts(q)
  const drafts = [...found, ...hyps, ...runs].slice(0, search ? SEARCH_LIMIT : TODAY_LIMIT)
  const intro = [...(drafts.length === 0 ? [withValue(COMMAND_MENUS.searchNone, query)] : []), ...(loading ? [SEARCH.loading] : [])]
  return menu(`search:${q}`, withValue(COMMAND_MENUS.searchTitle, query), drafts, [], intro)
}
