import { describe, expect, it } from 'vitest'
import { WATCH_DETAIL } from '../copy/watchDetail'
import { fillCopy } from '../copy/workspace'
import type { WatchDiff, WatchItem, WatchSource } from '../state/recordWatch.schema'
import { MAX_MENU_ITEMS, bootText, itemText, watchMenu } from './RecordWatch.menu'

const T0 = Date.UTC(2026, 8, 20, 14, 0)
const SINCE = '20 Sept, 10:00'

const appended = (source: WatchSource, key: string, line = `${key} RUN`): WatchItem => ({ source, key, kind: 'appended', field: '', before: null, after: null, line })
const updated = (key: string, field: string, before: WatchItem['before'], after: WatchItem['after']): WatchItem => ({
  source: 'registry', key, kind: 'updated', field, before, after, line: `${key} DES`,
})
const changed = (key: string, field: string, before: WatchItem['before'], after: WatchItem['after']): WatchItem => ({
  source: 'registry', key, kind: 'changed', field, before, after, line: `${key} DES`,
})
const removed = (key: string): WatchItem => ({ source: 'ledger', key: `${key}@t`, kind: 'removed', field: '', before: null, after: null, line: `${key} RUN` })
const shortened: WatchItem = { source: 'oos', key: '', kind: 'shortened', field: 'total', before: 100, after: 90, line: 'OOS' }

const diff = (over: Partial<WatchDiff> = {}): WatchDiff => ({ since: T0, appended: [], updated: [], changed: [], ...over })

describe('itemText: one sentence per item, from the copy', () => {
  it('says an appended record was added, with the source name', () => {
    expect(itemText(appended('runs', 'r3'))).toBe('run r3 added')
    expect(itemText(appended('registry', 'za_v0'))).toBe('registry za_v0 added')
    expect(itemText(appended('oos', '2501', 'OOS'))).toBe('gate log 2501 added')
  })

  it('says what an updated field moved from and to', () => {
    expect(itemText(updated('a_v0', 'amendments', 0, 1))).toBe('registry a_v0: amendments 0 to 1')
  })

  it('says what a frozen field was and is now', () => {
    expect(itemText(changed('volmanaged_v0', 'p', 0.12, 0.2))).toBe('registry volmanaged_v0: p was 0.12, now 0.2')
  })

  it('says a record is gone, and that the gate log shortened', () => {
    expect(itemText(removed('r2'))).toBe('ledger r2@t is gone')
    expect(itemText(shortened)).toBe('gate log shortened from 100 to 90 lines')
  })

  it('writes null as none and shortens long numbers only while the two sides stay apart', () => {
    expect(itemText(changed('x', 'control_p', null, 0.3))).toBe('registry x: control_p was none, now 0.3')
    expect(itemText(changed('x', 'p', 0.123456789, 0.2))).toBe('registry x: p was 0.123457, now 0.2')
    // Equal to 6 digits: the full values are shown, so the sentence never reads "0.123457 to 0.123457".
    expect(itemText(changed('x', 'p', 0.1234567891, 0.1234567892))).toBe('registry x: p was 0.1234567891, now 0.1234567892')
  })

  it('clips a long text such as a spec hash but keeps two different ones apart', () => {
    const a = 'a'.repeat(64)
    const b = 'a'.repeat(63) + 'b'
    const text = itemText(changed('x', 'spec_sha256', a, b))
    expect(text).toContain(a)
    expect(text).toContain(b)
    const long = itemText(changed('x', 'spec_sha256', 'abcdef0123456789'.repeat(4), 'fedcba9876543210'.repeat(4)))
    expect(long.length).toBeLessThan(110)
    expect(long).toContain('...')
  })

  it('writes booleans as words', () => {
    expect(itemText(updated('c', 'opening_closed', false, true))).toBe('registry c: opening_closed false to true')
  })
})

describe('bootText: the line posted once when the page opens', () => {
  it('is null when nothing differs', () => {
    expect(bootText(diff(), SINCE)).toBeNull()
  })

  it('counts items by source, in the sequence of the watch', () => {
    const d = diff({
      appended: [appended('runs', 'r3'), appended('runs', 'r4'), appended('ledger', 'r3@t')],
      updated: [updated('a_v0', 'amendments', 0, 1)],
      changed: [changed('b_v0', 'p', 1, 2)],
    })
    expect(bootText(d, SINCE)).toBe('Since 20 Sept, 10:00 ET: 2 registry rows, 1 ledger row, 2 runs. WATCH <GO> lists them.')
  })

  it('counts records, not fields: one confirmation with four moved fields is one confirmation', () => {
    const fields: ReadonlyArray<readonly [string, WatchItem['before'], WatchItem['after']]> = [
      ['p', 0.3, 0.01], ['verdict', 'FAIL', 'PASS'], ['n', 54, 60], ['opening_closed', false, true],
    ]
    const items = fields.map(([field, before, after]): WatchItem => ({ source: 'confirmations', key: 'c1', kind: 'updated', field, before, after, line: 'c1 DES' }))
    expect(bootText(diff({ updated: items }), SINCE)).toBe('Since 20 Sept, 10:00 ET: 1 confirmation. WATCH <GO> lists them.')
  })

  it('counts a run that moved and two appended runs as three runs', () => {
    const moved: WatchItem = { source: 'runs', key: 'r1', kind: 'changed', field: 'n_trades', before: 5, after: 6, line: 'r1 RUN' }
    const d = diff({ changed: [moved], appended: [appended('runs', 'r2'), appended('runs', 'r3')] })
    expect(bootText(d, SINCE)).toBe('Since 20 Sept, 10:00 ET: 3 runs. WATCH <GO> lists them.')
  })

  it('counts the gate log lines that vanished, and not the item that says the log shortened', () => {
    const gone = (key: string): WatchItem => ({ source: 'oos', key, kind: 'removed', field: '', before: null, after: null, line: 'OOS' })
    const short: WatchItem = { ...shortened, before: 10, after: 8 }
    expect(bootText(diff({ changed: [gone('9'), gone('10'), short] }), SINCE)).toBe('Since 20 Sept, 10:00 ET: 2 gate log lines. WATCH <GO> lists them.')
  })

  it('counts a shortened gate log alone as the lines it lost', () => {
    const short: WatchItem = { ...shortened, before: 2500, after: 2100 }
    expect(bootText(diff({ changed: [short] }), SINCE)).toBe('Since 20 Sept, 10:00 ET: 400 gate log lines. WATCH <GO> lists them.')
  })

  it('counts a gate log that shortened by one as one gate log line', () => {
    const short: WatchItem = { ...shortened, before: 91, after: 90 }
    expect(bootText(diff({ changed: [short] }), SINCE)).toBe('Since 20 Sept, 10:00 ET: 1 gate log line. WATCH <GO> lists them.')
  })

  it('never counts fewer than one line for a shortened item', () => {
    const odd: WatchItem = { ...shortened, before: 90, after: 90 }
    expect(bootText(diff({ changed: [odd] }), SINCE)).toBe('Since 20 Sept, 10:00 ET: 1 gate log line. WATCH <GO> lists them.')
  })
})

describe('watchMenu', () => {
  const view = (state: 'baseline' | 'clean' | 'news' | 'changed', since: string | null = SINCE) => ({ state, since })

  it('is the watch menu with the fixed title and a breadcrumb of it', () => {
    const menu = watchMenu(view('news'), diff({ appended: [appended('runs', 'r3')] }))
    expect(menu.key).toBe('watch')
    expect(menu.title).toBe('Since your last visit')
    expect(menu.title).toBe(WATCH_DETAIL.menuTitle)
    expect(menu.breadcrumb).toEqual(['Since your last visit'])
  })

  it('labels the list as a local watch, not a proof', () => {
    const menu = watchMenu(view('news'), diff({ appended: [appended('runs', 'r3')] }))
    expect(menu.intro).toEqual(['Local change watch from this browser, not a proof. Compared with 20 Sept, 10:00 ET.'])
  })

  it('lists changed items first, then appended, then updated, numbered from 1', () => {
    const menu = watchMenu(
      view('changed'),
      diff({
        appended: [appended('runs', 'r3')],
        updated: [updated('a_v0', 'amendments', 0, 1)],
        changed: [changed('volmanaged_v0', 'p', 0.12, 0.2), removed('r2')],
      }),
    )
    expect(menu.items.map((i) => i.detail)).toEqual([
      'registry volmanaged_v0: p was 0.12, now 0.2',
      'ledger r2@t is gone',
      'run r3 added',
      'registry a_v0: amendments 0 to 1',
      'Mark all of this as seen',
    ])
    expect(menu.items.map((i) => i.n)).toEqual([1, 2, 3, 4, 5])
    expect(menu.items.every((i) => !i.category)).toBe(true)
  })

  it('runs the item line when an item is chosen', () => {
    const menu = watchMenu(view('changed'), diff({ changed: [changed('volmanaged_v0', 'p', 0.12, 0.2)], appended: [appended('oos', '9', 'OOS')] }))
    expect(menu.items[0]).toMatchObject({ label: 'volmanaged_v0 DES', act: { kind: 'run', line: 'volmanaged_v0 DES' } })
    expect(menu.items[1]).toMatchObject({ label: 'OOS', act: { kind: 'run', line: 'OOS' } })
  })

  it('ends with a WATCH SEEN item that marks it all as seen', () => {
    const menu = watchMenu(view('news'), diff({ appended: [appended('runs', 'r3')] }))
    expect(menu.items.at(-1)).toEqual({
      n: 2,
      label: 'WATCH SEEN',
      detail: 'Mark all of this as seen',
      category: false,
      act: { kind: 'run', line: 'WATCH SEEN' },
    })
  })

  it('has no WATCH SEEN item when there is nothing to accept, and says so', () => {
    const clean = watchMenu(view('clean'), diff())
    expect(clean.items).toEqual([])
    expect(clean.intro).toEqual([
      'Local change watch from this browser, not a proof. Compared with 20 Sept, 10:00 ET.',
      'Nothing new or changed since 20 Sept, 10:00 ET.',
    ])
  })

  it('says the watch has only just started on the first visit', () => {
    const baseline = watchMenu(view('baseline'), diff())
    expect(baseline.items).toEqual([])
    expect(baseline.intro).toEqual(['Watching from 20 Sept, 10:00 ET: nothing to compare yet.'])
  })

  it('caps the menu at 40 items, keeps WATCH SEEN last, and points to the screens for the rest', () => {
    const many = Array.from({ length: 60 }, (_, i) => appended('runs', `r${100 + i}`))
    const menu = watchMenu(view('news'), diff({ appended: many }))
    expect(MAX_MENU_ITEMS).toBe(40)
    expect(menu.items).toHaveLength(40)
    expect(menu.items.at(-1)?.label).toBe('WATCH SEEN')
    expect(menu.items[38]?.label).toBe('r138 RUN')
    expect(menu.items.map((i) => i.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    expect(menu.intro.at(-1)).toBe('More items: open the screens for the full lists.')
  })

  it('shows all 39 entries and no more line when they just fit', () => {
    const fit = Array.from({ length: 39 }, (_, i) => appended('runs', `r${i}`))
    const menu = watchMenu(view('news'), diff({ appended: fit }))
    expect(menu.items).toHaveLength(40)
    expect(menu.intro).not.toContain(WATCH_DETAIL.more)
  })

  it('puts changed items first even when the cap cuts the rest', () => {
    const many = Array.from({ length: 50 }, (_, i) => appended('runs', `r${i}`))
    const menu = watchMenu(view('changed'), diff({ appended: many, changed: [changed('volmanaged_v0', 'p', 1, 2)] }))
    expect(menu.items[0]?.label).toBe('volmanaged_v0 DES')
  })

  it('takes the times from the view, filled into the copy', () => {
    const menu = watchMenu(view('news', '1 Oct, 09:30'), diff({ appended: [appended('runs', 'r3')] }))
    expect(menu.intro[0]).toBe(fillCopy(WATCH_DETAIL.intro, { since: '1 Oct, 09:30' }))
  })
})
