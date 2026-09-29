// @vitest-environment jsdom
// LEDG (TASKS 6.3, UI_SPEC section 7 "LEDG", look spec 7.9): the ledger rows from GET /api/ledger with
// a weekday prefix on the date, the balance column in colour and text, the anchor pair status joined
// from `anchor_pairs`, run links (Enter opens RUN), and an empty state that names the expected file.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { activateNumbered, numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { RecordWatchReader, resetRecordWatchBoot, resetRecordWatchView, useRecordWatch, type RecordWatchView } from '../../chrome/RecordWatch.live'
import { stubLayout } from '../../grids/testing'
import { gridWidth } from '../../grids/useElementWidth'
import { useRecordWatchStore } from '../../state/recordWatch.store'
import { LEDGER } from '../runs/runs.fixtures'
import { TEST_PANEL, mountScreen, stubApi } from '../runs/testing'
import LedgScreen from './LedgScreen'
import { ledgerColumns } from './ledgerColumns'

const PARAMS = { code: 'LEDG', context: null, args: {}, group: '-' } as const
const BASE = LEDGER.rows[0] as Schemas['LedgerRow']
const ANCHOR_ROW: Schemas['LedgerRow'] = {
  ...BASE, run_id: 'nt_overnight_v0_fixture_open_a1', exp_id: 'overnight_v0_fixture_anchor', ts_utc: '2026-09-24T10:00:00+00:00',
  balance_check: 'FAIL', matches_result: false,
}
const PAIR: Schemas['AnchorComparison'] = {
  anchor: ANCHOR_ROW.run_id, base: BASE.run_id, base_source: 'name', base_found: true,
  n_trades_equal: true, pnl_total_equal: true, fees_total_equal: true,
  sharpe_anchor: 0.4644167852049855, sharpe_base: 0.4644167852049855, sharpe_equal: true,
  verdict: 'IDENTICAL', regress_check_identical: null,
}
const WITH_PAIR: Schemas['LedgerView'] = { ledger_found: true, rows: [BASE, ANCHOR_ROW], anchor_pairs: [PAIR] }

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
})

async function mountLedg(view: Schemas['LedgerView'] = LEDGER) {
  const seen = stubApi({ '/api/ledger': view })
  mountScreen(<LedgScreen params={PARAMS} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Run ledger/ })
  await waitFor(() => expect(within(grid).getByText(BASE.run_id)).toBeTruthy())
  return { seen, grid }
}

function rowOf(grid: HTMLElement, runId: string): HTMLElement {
  const row = within(grid).getByText(runId).closest('tr')
  if (!row) throw new Error(`no row for ${runId}`)
  return row
}

describe('LEDG: the run ledger', () => {
  it('shows each ledger row with a weekday date, the numbers and the balance as text', async () => {
    const { grid, seen } = await mountLedg()
    const row = rowOf(grid, BASE.run_id)
    // The weekday sits in its own muted span, so match the whole cell text.
    expect(within(row).getByText((_, el) => el?.tagName === 'TD' && el.textContent === 'Sa 2026-09-26')).toBeTruthy()
    expect(within(row).getByText('overnight_v0_fixture')).toBeTruthy()
    expect(within(row).getByText('+617.08')).toBeTruthy()
    expect(within(row).getByText('17.92')).toBeTruthy()
    expect(within(row).getByText('75.0%')).toBeTruthy()
    expect(within(row).getByText('[OK]')).toBeTruthy()
    expect(seen.every((r) => r.method === 'GET' && r.url === '/api/ledger')).toBe(true)
  })

  it('joins the anchor pair and shows IDENTICAL on both runs of the pair', async () => {
    const { grid } = await mountLedg(WITH_PAIR)
    expect(within(rowOf(grid, BASE.run_id)).getByText('IDENTICAL')).toBeTruthy()
    const anchorRow = rowOf(grid, ANCHOR_ROW.run_id)
    expect(within(anchorRow).getByText('IDENTICAL')).toBeTruthy()
    expect(within(anchorRow).getByText('[FAIL]')).toBeTruthy()
    const pairs = screen.getByRole('table', { name: /Anchor pairs/ })
    expect(within(pairs).getByText('IDENTICAL')).toBeTruthy()
    expect(within(pairs).getByText(ANCHOR_ROW.run_id)).toBeTruthy()
  })

  it('counts the rows and the balanced rows', async () => {
    await mountLedg(WITH_PAIR)
    expect(screen.getByTestId('ledger-counts').textContent).toBe('Rows 2  Balanced 1  Match result.json 1')
  })

  it('filters on run id, exp id and strategy', async () => {
    const { grid } = await mountLedg(WITH_PAIR)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter ledger' }), { target: { value: 'anchor' } })
    await waitFor(() => expect(within(grid).queryByText(BASE.run_id)).toBeNull())
    expect(within(grid).getByText(ANCHOR_ROW.run_id)).toBeTruthy()
  })

  it('opens RUN for a row (Number <GO> 1)', async () => {
    await mountLedg()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    act(() => {
      expect(activateNumbered(TEST_PANEL, 1)).toBe(true)
    })
    off()
    expect(lines).toEqual([{ line: `${BASE.run_id} RUN`, newPanel: false }])
  })

  it('names the expected file when there is no ledger', async () => {
    stubApi({ '/api/ledger': { ledger_found: false, rows: [], anchor_pairs: [] } })
    mountScreen(<LedgScreen params={PARAMS} context={null} />)
    expect(await screen.findByText('No ledger yet: results/ledger.csv')).toBeTruthy()
  })
})

describe('LEDG in a panel narrower than the full ledger (1366x768)', () => {
  it('drops exp id, variant, window and fees rather than scroll sideways, and says so; Export keeps them', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains('ledg-screen') ? 1360 : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    const saved = captureDownloads()
    try {
      const { grid } = await mountLedg(WITH_PAIR)
      const heads = within(grid).getAllByRole('columnheader').map((h) => h.textContent)
      expect(heads).not.toContain('Exp id')
      expect(heads).not.toContain('Fees (USD)')
      expect(heads).toContain('Anchor pair')
      expect(screen.getByText(/Columns hidden here/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      expect((await saved.text('ledger.csv')).split('\r\n')[0]).toContain('Exp id')
    } finally {
      saved.restore()
      rect.mockRestore()
    }
  })
})

describe('LEDG: 98) Export', () => {
  it('saves the shown ledger rows, newest first, as CSV with no request', async () => {
    const { seen } = await mountLedg(WITH_PAIR)
    const before = seen.length
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('ledger.csv')).split('\r\n')
      expect(lines[0]?.startsWith('Date (UTC),Run id,')).toBe(true)
      expect(lines[0]).toContain('Anchor pair')
      expect(lines.slice(1).map((l) => l.split(',')[1])).toEqual([BASE.run_id, ANCHOR_ROW.run_id])
      expect(lines[2]).toContain('IDENTICAL')
      expect(seen.length).toBe(before)
    } finally {
      saved.restore()
    }
  })
})

// The Seen column (roadmap 16, slice 3): the record watch marks a ledger row NEW when its key, the run id
// and the time joined by @, is not in this browser's checkpoint, and CHG when a field of a known row moved.
// The marks come through the real watch (RecordWatchReader over a seeded checkpoint), so the key the column
// reads is the key the watch writes.
describe('LEDG: the Seen column from the record watch', () => {
  let watch: RecordWatchView | undefined

  function WatchProbe() {
    watch = useRecordWatch()
    return null
  }

  beforeEach(() => {
    localStorage.clear()
    useRecordWatchStore.setState({ checkpoint: null })
    resetRecordWatchView()
    resetRecordWatchBoot()
    watch = undefined
  })
  afterEach(() => {
    resetRecordWatchView()
    resetRecordWatchBoot()
    useRecordWatchStore.setState({ checkpoint: null })
  })

  type Loose = { sources: { ledger: { records: Record<string, Record<string, unknown>> } } }
  const keyOf = (r: Schemas['LedgerRow']) => `${r.run_id}@${r.ts_utc ?? ''}`

  /** A checkpoint of `view`, edited by `change`, so the watch finds the difference. */
  async function seed(view: Schemas['LedgerView'], change: (s: Loose) => void = () => undefined): Promise<void> {
    const lazy = await import('../../chrome/RecordWatch.lazy')
    const snapshot = JSON.parse(JSON.stringify(lazy.snapshotOf({ ledger: view }, Date.UTC(2026, 8, 20, 14, 0)))) as Loose
    change(snapshot)
    expect(useRecordWatchStore.getState().setCheckpoint(snapshot as unknown as Parameters<typeof lazy.diffWatch>[0])).toBe(true)
  }

  async function mountWatched(view: Schemas['LedgerView'] = WITH_PAIR) {
    const seen = stubApi({ '/api/ledger': view })
    mountScreen(
      <>
        <RecordWatchReader />
        <WatchProbe />
        <LedgScreen params={PARAMS} context={null} />
      </>,
    )
    const grid = await screen.findByRole('grid', { name: /Run ledger/ })
    await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(view.rows.length))
    return { seen, grid }
  }

  const heads = (grid: HTMLElement) => within(grid).getAllByRole('columnheader').map((h) => h.textContent)
  const bodyRows = (grid: HTMLElement) => within(grid).getAllByRole('row').filter((r) => r.closest('tbody'))
  /** The Seen cell of every body row, in the order the grid shows them. */
  const seenColumn = (grid: HTMLElement) => {
    const index = heads(grid).indexOf('Seen')
    return bodyRows(grid).map((r) => within(r).getAllByRole('gridcell')[index]?.textContent)
  }

  it('adds no column when the watch has nothing to mark', async () => {
    const { grid } = await mountLedg(WITH_PAIR)
    expect(heads(grid)).not.toContain('Seen')
    expect(heads(grid)[1]).toBe('Date (UTC)')
  })

  it('adds no column when the checkpoint holds every row', async () => {
    await seed(WITH_PAIR)
    const { grid } = await mountWatched()
    await waitFor(() => expect(watch?.state).toBe('clean'))
    expect(heads(grid)).not.toContain('Seen')
  })

  it('shows NEW on the row keyed run id @ time that the checkpoint lacks, first after the number', async () => {
    await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(ANCHOR_ROW)])
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    expect(heads(grid).slice(1, 3)).toEqual(['Seen', 'Date (UTC)'])
    // Newest first: the anchor row (24 Sep) sits under the base row (26 Sep).
    expect(bodyRows(grid).map((r) => within(r).queryByText(ANCHOR_ROW.run_id) !== null)).toEqual([false, true])
    expect(seenColumn(grid)).toEqual(['', 'NEW'])
    expect(within(grid).getAllByText('NEW')).toHaveLength(1)
  })

  it('tones NEW muted and keeps the word in the cell, so the cue is not colour alone', async () => {
    await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(BASE)])
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    const cell = within(bodyRows(grid)[0]!).getByText('NEW')
    expect(cell.closest('td')?.classList.contains('muted')).toBe(true)
  })

  it('shows CHG on a row whose figures were rewritten', async () => {
    await seed(WITH_PAIR, (s) => void (s.sources.ledger.records[keyOf(BASE)]!['pnl_total'] = 1))
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    expect(seenColumn(grid)).toEqual(['CHG', ''])
  })

  it('tells two ledger rows of one run apart by their time', async () => {
    const later: Schemas['LedgerRow'] = { ...BASE, ts_utc: '2026-09-27T00:00:00+00:00', exp_id: 'overnight_v0_fixture_again' }
    const view: Schemas['LedgerView'] = { ledger_found: true, rows: [BASE, later], anchor_pairs: [] }
    await seed(view, (s) => void delete s.sources.ledger.records[keyOf(later)])
    const { grid } = await mountWatched(view)
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    // Newest first: the later row is on top and is the only one marked.
    expect(seenColumn(grid)).toEqual(['NEW', ''])
  })

  it('marks a row without a time by its key run id @ nothing', async () => {
    const undated: Schemas['LedgerRow'] = { ...BASE, run_id: 'nt_undated_fixture', ts_utc: null }
    const view: Schemas['LedgerView'] = { ledger_found: true, rows: [BASE, undated], anchor_pairs: [] }
    await seed(view, (s) => void delete s.sources.ledger.records['nt_undated_fixture@'])
    const { grid } = await mountWatched(view)
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    const marked = bodyRows(grid).filter((r) => within(r).queryByText('NEW') !== null)
    expect(marked).toHaveLength(1)
    expect(within(marked[0]!).getByText('nt_undated_fixture')).toBeTruthy()
  })

  it('keeps the run id as the Number <GO> label and opens RUN for the row that was picked', async () => {
    await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(ANCHOR_ROW)])
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    // Rows are numbered 1 and 2; the function bar's 96, 98 and 99 are numbered actions too.
    expect(numberedItems(TEST_PANEL).filter((i) => i.n <= 2).map((i) => i.label)).toEqual([BASE.run_id, ANCHOR_ROW.run_id])
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    act(() => {
      expect(activateNumbered(TEST_PANEL, 2)).toBe(true)
    })
    off()
    expect(lines).toEqual([{ line: `${ANCHOR_ROW.run_id} RUN`, newPanel: false }])
  })

  it('leaves 98) Export to the ledger data: no Seen column in the CSV', async () => {
    await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(ANCHOR_ROW)])
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('ledger.csv')).split('\r\n')
      expect(lines[0]?.startsWith('Date (UTC),Run id,')).toBe(true)
      expect(lines[0]).not.toContain('Seen')
    } finally {
      saved.restore()
    }
  })

  it('drops the column again once WATCH SEEN has marked everything as seen', async () => {
    await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(ANCHOR_ROW)])
    const { grid } = await mountWatched()
    await waitFor(() => expect(heads(grid)).toContain('Seen'))
    act(() => void watch?.accept())
    await waitFor(() => expect(heads(grid)).not.toContain('Seen'))
    expect(within(grid).queryByText('NEW')).toBeNull()
  })

  it('moves the narrow-panel threshold by the 44 px column only while the watch has marks', async () => {
    const between = gridWidth(ledgerColumns(new Map())) + 10
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains('ledg-screen') ? between : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    try {
      const clean = await mountLedg(WITH_PAIR)
      // Clean: every column fits, exactly as before the Seen column existed.
      expect(heads(clean.grid)).toContain('Exp id')
      expect(screen.queryByText(/Columns hidden here/)).toBeNull()
      cleanup()
      resetRecordWatchView()
      await seed(WITH_PAIR, (s) => void delete s.sources.ledger.records[keyOf(ANCHOR_ROW)])
      const { grid } = await mountWatched()
      // Marked: all columns plus Seen no longer fit, so the narrow set shows, with Seen first, and says so.
      await waitFor(() => expect(heads(grid)).toContain('Seen'))
      expect(heads(grid)).not.toContain('Exp id')
      expect(heads(grid).slice(1, 3)).toEqual(['Seen', 'Date (UTC)'])
      expect(screen.getByText(/Columns hidden here/)).toBeTruthy()
    } finally {
      rect.mockRestore()
    }
  })
})
