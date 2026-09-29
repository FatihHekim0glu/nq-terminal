// The WATCH <GO> list and the start-up line of the research-record watch (roadmap 16). A lazy module:
// only chrome/RecordWatch.lazy.ts imports it, so neither this file nor copy/watchDetail.ts is in the
// shell. All words come from the copy; here are only the sequence, the cap and the numbers.
import { WATCH_DETAIL } from '../copy/watchDetail'
import { fillCopy } from '../copy/workspace'
import { WATCH_SOURCES, type FieldValue, type WatchDiff, type WatchItem, type WatchMenuView } from '../state/recordWatch.schema'
import type { MenuItem, MenuModel } from './CommandLine.menus'

/** The list never shows more numbered items than this, WATCH SEEN included. */
export const MAX_MENU_ITEMS = 40
const SEEN_LINE = 'WATCH SEEN'
const SHORT_DIGITS = 6
const SHORT_TEXT = 32
const CLIP_TO = 29

function shortValue(value: FieldValue): string {
  if (value === null) return WATCH_DETAIL.noValue
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(SHORT_DIGITS)))
  const text = String(value)
  return text.length > SHORT_TEXT ? `${text.slice(0, CLIP_TO)}...` : text
}

/** Both sides of a change, shortened only while the shortening keeps them apart. */
function beforeAfter(before: FieldValue, after: FieldValue): { readonly before: string; readonly after: string } {
  const short = { before: shortValue(before), after: shortValue(after) }
  return short.before === short.after ? { before: String(before ?? WATCH_DETAIL.noValue), after: String(after ?? WATCH_DETAIL.noValue) } : short
}

/** One sentence for an item of the diff. */
export function itemText(item: WatchItem): string {
  const values = { source: WATCH_DETAIL.sources[item.source], key: item.key, field: item.field, ...beforeAfter(item.before, item.after) }
  switch (item.kind) {
    case 'appended':
      return fillCopy(WATCH_DETAIL.itemAppended, values)
    case 'updated':
      return fillCopy(WATCH_DETAIL.itemUpdated, values)
    case 'changed':
      return fillCopy(WATCH_DETAIL.itemChanged, values)
    case 'removed':
      return fillCopy(WATCH_DETAIL.itemRemoved, values)
    case 'shortened':
      return fillCopy(WATCH_DETAIL.itemShortened, values)
  }
}

/**
 * How many records a set's items name: the distinct keys, so a confirmation with four moved fields counts
 * once. A shortened gate log names no line, so alone it counts the lines it lost; zero when there is none.
 */
function recordCount(items: readonly WatchItem[]): number {
  const keys = new Set(items.filter((item) => item.kind !== 'shortened').map((item) => item.key))
  if (keys.size > 0) return keys.size
  const short = items.find((item) => item.kind === 'shortened')
  return short ? Math.max(1, Number(short.before) - Number(short.after)) : 0
}

/** The line posted once when the page opens: how many records differ in each set; null when none. */
export function bootText(diff: WatchDiff, since: string): string | null {
  const items = [...diff.changed, ...diff.appended, ...diff.updated]
  const parts = WATCH_SOURCES.flatMap((source) => {
    const n = recordCount(items.filter((item) => item.source === source))
    if (n === 0) return []
    return [fillCopy(WATCH_DETAIL.part, { n, what: (n === 1 ? WATCH_DETAIL.whatOne : WATCH_DETAIL.what)[source] })]
  })
  return parts.length === 0 ? null : fillCopy(WATCH_DETAIL.boot, { since, parts: parts.join(WATCH_DETAIL.joiner) })
}

function introFor(view: WatchMenuView, empty: boolean): string[] {
  const since = view.since ?? ''
  if (view.state === 'baseline') return [fillCopy(WATCH_DETAIL.introBaseline, { since })]
  const intro = fillCopy(WATCH_DETAIL.intro, { since })
  return empty ? [intro, fillCopy(WATCH_DETAIL.none, { since })] : [intro]
}

/**
 * WATCH <GO>: changed items first (a rewritten record matters most), then new ones, then tracked fields
 * that moved. Choosing an item opens the screen of its record; the last item marks everything as seen.
 */
export function watchMenu(view: WatchMenuView, diff: WatchDiff): MenuModel {
  const entries = [...diff.changed, ...diff.appended, ...diff.updated]
  const acceptable = entries.length > 0
  const shown = entries.slice(0, MAX_MENU_ITEMS - (acceptable ? 1 : 0))
  const drafts: Omit<MenuItem, 'n' | 'category'>[] = shown.map((entry) => ({
    label: entry.line,
    detail: itemText(entry),
    act: { kind: 'run', line: entry.line },
  }))
  if (acceptable) drafts.push({ label: SEEN_LINE, detail: WATCH_DETAIL.seenDetail, act: { kind: 'run', line: SEEN_LINE } })
  const intro = introFor(view, !acceptable)
  if (shown.length < entries.length) intro.push(WATCH_DETAIL.more)
  return {
    key: 'watch',
    title: WATCH_DETAIL.menuTitle,
    breadcrumb: [WATCH_DETAIL.menuTitle],
    intro,
    items: drafts.map((draft, i) => ({ ...draft, n: i + 1, category: false })),
  }
}
