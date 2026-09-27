import { describe, expect, it } from 'vitest'
import { JRNL, LIVE } from '../../copy/live'
import { BOOK, BOOK_CLOSE_ROWS, BOOK_PLUMBING, LAST_CLOSE_OK, PREFLIGHT, emptyStatus, performance, status } from './liveFixtures'
import {
  bookItems,
  dateSeconds,
  exposureKpis,
  fileOptions,
  guardItems,
  journalEmptyText,
  journalQueryEnabled,
  newestOffset,
  performanceChart,
  reconRows,
} from './liveModel'

const byKey = (items: ReadonlyArray<{ key: string; value: string; tone?: string }>) =>
  Object.fromEntries(items.map((i) => [i.key, i]))

describe('the book state strip (LV3)', () => {
  it('shows the last performance close with units, read from the API', () => {
    const items = byKey(bookItems(status({ last_close: LAST_CLOSE_OK, halted: false })))
    expect(items.contract!.value).toBe('MNQZ6')
    expect(items.lastClose!.value).toBe('2026-09-28')
    expect(items.target!.value).toBe('6 ct')
    expect(items.actual!.value).toBe('6 ct')
    expect(items.expected!.value).toBe('6 ct')
    expect(items.exposure!.value).toBe('0.2982 notional / equity')
    expect(items.slippage!.value).toBe('1.0 ticks')
    expect(items.closePx!.value).toBe('24851.00 pts')
    expect(items.sent!.value).toBe(LIVE.yes)
    expect(items.reconciled!.value).toBe(LIVE.ok)
    expect(items.halted!.value).toBe(LIVE.no)
  })

  it('marks a failed close: error and halted in the down colour, missing values as --', () => {
    const items = byKey(bookItems(status()))
    expect(items.error!.value).toBe('reconciliation failed: MNQZ6.CME holds 5, expected 6')
    expect(items.error!.tone).toBe('down')
    expect(items.halted!.value).toBe(LIVE.yes)
    expect(items.halted!.tone).toBe('down')
    expect(items.actual!.value).toBe(LIVE.none)
    expect(items.target!.value).toBe(LIVE.none)
  })

  it('says so when there is no performance close yet', () => {
    const items = byKey(bookItems(emptyStatus()))
    expect(items.lastClose!.value).toBe(LIVE.noClose)
    expect(items.halted!.value).toBe(LIVE.none)
  })
})

describe('the guard strip', () => {
  it('follows the kill switch file both ways', () => {
    expect(byKey(guardItems(status())).kill!.value).toBe(LIVE.killOff)
    const on = byKey(guardItems(status({ kill_switch_on: true }))).kill!
    expect(on.value).toBe(LIVE.killOn)
    expect(on.tone).toBe('warn')
  })

  it('reports env flags as set or not set, the host and the masked account as sent', () => {
    const items = byKey(guardItems(status()))
    expect(items.delayed!.value).toBe(LIVE.unset)
    expect(items.volmanC!.value).toBe(LIVE.unset)
    expect(items.baseRate!.value).toBe(LIVE.set)
    expect(items.ib!.value).toBe('127.0.0.1:7497')
    expect(items.account!.value).toBe('DU*******')
    expect(items.tws!.value).toBe('not monitored')
    expect(items.orderPath!.value).toBe('none')
    expect(items.journalAge!.value).toBe('2026-10-02T20:00:00Z')
    expect(items.logAge!.value).toBe('2026-09-26T21:00:00Z')
  })
})

describe('exposure KPIs', () => {
  it('are Basis B [POST HOC] tiles with their units, from exposure_summary', () => {
    const kpis = exposureKpis(status())
    expect(kpis.map((k) => [k.key, k.value, k.unit, k.basis, k.tag])).toEqual([
      ['mean_exposure', 0.298212, LIVE.unitX, 'B', '[POST HOC]'],
      ['sessions', 1, LIVE.unitCount, 'B', '[POST HOC]'],
      ['plumbing_rows_skipped', 1, LIVE.unitCount, 'B', '[POST HOC]'],
    ])
  })

  it('are empty without a book journal', () => {
    expect(exposureKpis(emptyStatus())).toEqual([])
  })
})

describe('target against actual (LV1, LV2)', () => {
  it('draws the performance rows only, one point per dated close', () => {
    const chart = performanceChart(performance(), BOOK_CLOSE_ROWS, BOOK_CLOSE_ROWS.length)
    expect(chart.kind).toBe('ok')
    if (chart.kind !== 'ok') return
    expect(chart.t).toEqual([dateSeconds('2026-09-28'), dateSeconds('2026-09-30'), dateSeconds('2026-10-01')])
    expect(chart.target).toEqual([6, 6, null])
    expect(chart.actual).toEqual([6, 6, null])
    expect(chart.exposure).toEqual([0.298212, null, null])
    expect(chart.t).not.toContain(dateSeconds('2026-10-02'))
  })

  it('born failing: refuses to draw when a plumbing row reaches the performance rows', () => {
    const leaked = performance({
      t: [1790553600, 1790726400, 1790812800, 1790899200],
      line_no: [2, 4, 5, 6],
      date: ['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02'],
      contract: ['MNQZ6.CME', 'MNQZ6.CME', 'MNQZ6.CME', 'MNQZ6.CME'],
      target: [6, 6, null, 6], expected: [6, 6, null, 6], actual: [6, 6, null, 6], reconciled_ok: [true, true, null, true],
      exposure: [0.298212, null, null, 0.31], slippage_ticks: [1, null, null, 2], sent: [true, false, null, true],
      refused: [null, 'no sizing price', null, null], error: [null, null, 'x', null], halted: [false, false, true, false],
    })
    const chart = performanceChart(leaked, BOOK_CLOSE_ROWS, BOOK_CLOSE_ROWS.length)
    expect(chart).toEqual({ kind: 'error', message: 'Not drawn: the performance rows do not match the journal\'s non-plumbing close rows (4 against 3).' })
  })

  it('born failing: matches rows by journal line, so a plumbing line is refused even when dates and counts agree', () => {
    // Line 6 is the plumbing close; give it line 5's date so a date-only comparison would pass.
    const rows = [BOOK_CLOSE_ROWS[0]!, BOOK_CLOSE_ROWS[1]!, { ...BOOK_CLOSE_ROWS[3]!, data: { ...BOOK_CLOSE_ROWS[3]!.data, date: '2026-10-01' } }, BOOK_CLOSE_ROWS[2]!]
    const onPlumbingLine = performance({ line_no: [2, 4, 6] })
    expect(performanceChart(onPlumbingLine, rows, rows.length)).toEqual({
      kind: 'error', message: "Not drawn: the performance rows do not match the journal's non-plumbing close rows (3 against 3).",
    })
    expect(performanceChart(performance(), rows, rows.length).kind).toBe('ok')
  })

  it('draws on the API time axis (t), not on dates parsed in the browser', () => {
    const shifted = performance({ t: [1, 2, 3] })
    const chart = performanceChart(shifted, BOOK_CLOSE_ROWS, BOOK_CLOSE_ROWS.length)
    expect(chart.kind === 'ok' ? chart.t : null).toEqual([1, 2, 3])
  })

  it('against a backend without t and line_no, falls back to the date guard and UTC midnight', () => {
    const { t: _t, line_no: _l, ...rest } = performance()
    const chart = performanceChart(rest as unknown as ReturnType<typeof performance>, BOOK_CLOSE_ROWS, BOOK_CLOSE_ROWS.length)
    expect(chart.kind === 'ok' ? chart.t : null).toEqual([dateSeconds('2026-09-28'), dateSeconds('2026-09-30'), dateSeconds('2026-10-01')])
  })

  it('refuses when the journal page does not hold every close row', () => {
    const chart = performanceChart(performance(), BOOK_CLOSE_ROWS, 9000)
    expect(chart).toEqual({ kind: 'error', message: LIVE.guardUnverified })
  })

  it('refuses dates out of order, and leaves out closes without a date', () => {
    const swapped = performance({ date: ['2026-09-30', '2026-09-28', '2026-10-01'], line_no: [4, 2, 5], t: [1790726400, 1790553600, 1790812800] })
    const rows = [BOOK_CLOSE_ROWS[1]!, BOOK_CLOSE_ROWS[0]!, BOOK_CLOSE_ROWS[2]!]
    expect(performanceChart(swapped, rows, rows.length)).toEqual({ kind: 'error', message: LIVE.guardOrder })
    const undated = performance({ date: ['2026-09-28', null, '2026-10-01'], t: [1790553600, null, 1790812800] })
    const rowsUndated = [BOOK_CLOSE_ROWS[0]!, { ...BOOK_CLOSE_ROWS[1]!, data: { type: 'close' } }, BOOK_CLOSE_ROWS[2]!]
    const chart = performanceChart(undated, rowsUndated, rowsUndated.length)
    expect(chart.kind).toBe('ok')
    if (chart.kind === 'ok') {
      expect(chart.t).toHaveLength(2)
      expect(chart.skippedNoDate).toBe(1)
    }
  })

  it('is empty with no performance close rows', () => {
    const none = performance({ t: [], line_no: [], date: [], contract: [], target: [], expected: [], actual: [], reconciled_ok: [], exposure: [], slippage_ticks: [], sent: [], refused: [], error: [], halted: [] })
    expect(performanceChart(none, [BOOK_CLOSE_ROWS[3]!], 1)).toEqual({ kind: 'empty' })
  })

  it('reads ISO dates as UTC midnight epoch seconds', () => {
    expect(dateSeconds('2026-09-28')).toBe(Date.UTC(2026, 8, 28) / 1000)
    expect(dateSeconds(null)).toBeNull()
    expect(dateSeconds('28/09/2026')).toBeNull()
  })
})

describe('reconciliation rows', () => {
  it('one row per performance close, values as sent', () => {
    const rows = reconRows(performance())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ date: '2026-09-28', target: 6, expected: 6, actual: 6, reconciled: true, exposure: 0.298212, slippage: 1, sent: true })
    expect(rows[2]).toMatchObject({ date: '2026-10-01', error: 'reconciliation failed: MNQZ6.CME holds 5, expected 6', halted: true })
  })
})

describe('JRNL file options and empty states', () => {
  it('lists all journals, each journal (plumbing marked) and expected files not yet written', () => {
    const options = fileOptions(status())
    expect(options.map((o) => o.value)).toEqual(['', PREFLIGHT, BOOK_PLUMBING, BOOK])
    expect(options[0]!.label).toBe(JRNL.allFiles)
    expect(options[1]!.label).toBe(`${PREFLIGHT} [PLUMBING]`)
    expect(options[3]!.label).toBe(BOOK)
    const empty = fileOptions(emptyStatus())
    expect(empty.map((o) => o.label)).toEqual([JRNL.allFiles, `${BOOK} (not yet written)`, `${BOOK_PLUMBING} (not yet written)`])
  })

  it('names the expected file when it is not on disk, and fetches nothing for it', () => {
    const s = emptyStatus()
    expect(journalEmptyText(s, BOOK, '')).toBe('no journal yet: live/logs/volmanaged_paper_journal.jsonl')
    expect(journalQueryEnabled(s, BOOK)).toBe(false)
    expect(journalEmptyText(s, '', '')).toBe(
      'no journal yet: live/logs/volmanaged_paper_journal.jsonl; no journal yet: live/logs/volmanaged_paper_journal.PLUMBING_DELAYED.jsonl',
    )
    expect(journalQueryEnabled(s, '')).toBe(false)
    expect(journalQueryEnabled(status(), '')).toBe(true)
  })

  it('says no rows of this type for a written journal', () => {
    expect(journalEmptyText(status(), BOOK, 'skipped')).toBe(`No rows of this type in ${BOOK}.`)
    expect(journalEmptyText(status(), '', 'skipped')).toBe(`No rows of this type in ${JRNL.allFilesName}.`)
    expect(journalQueryEnabled(status(), BOOK)).toBe(true)
  })

  it('pages to the newest rows', () => {
    expect(newestOffset(120, 5000)).toBe(0)
    expect(newestOffset(7000, 5000)).toBe(2000)
  })
})
