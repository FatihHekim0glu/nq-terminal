// Test data for the LIVE and JRNL tests (imported by *.test.* files only): API bodies shaped like the
// fixture backend's live folder (backend/tests/fixtures/live/logs), including the plumbing close row
// on 2026-10-02 inside the book journal, which must never reach a performance view.
import type { Schemas } from '../../api/types'

export const BOOK = 'volmanaged_paper_journal.jsonl'
export const BOOK_PLUMBING = 'volmanaged_paper_journal.PLUMBING_DELAYED.jsonl'
export const PREFLIGHT = 'preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl'
export const BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

const CLOSE_OK = {
  type: 'close', date: '2026-09-28', contract: 'MNQZ6.CME', target: 6, n_star: 6, wstar: 0.6124, sigma2: 5.1e-5, p: 24850.25,
  refused: null, blocked: null, sent: true, sent_target: 6, expected: { 'MNQZ6.CME': 6 }, actual: { 'MNQZ6.CME': 6 },
  reconciled: { ok: true, diffs: {} }, close_px: 24851.0, slippage_ticks: 1.0, exposure: 0.298212, halted: false,
}

function row(line_no: number, data: Record<string, unknown>, plumbing = false, file = BOOK): Schemas['JournalRowOut'] {
  return { file, line_no, plumbing, banner: plumbing ? BANNER : null, data }
}

/** The book journal's close rows (type=close), oldest first, as /api/live/journal returns them. */
export const BOOK_CLOSE_ROWS: Schemas['JournalRowOut'][] = [
  row(2, CLOSE_OK),
  row(4, { ...CLOSE_OK, date: '2026-09-30', wstar: null, sigma2: null, p: null, refused: 'no sizing price', sent: false, sent_target: null, close_px: null, slippage_ticks: null, exposure: null }),
  row(5, { type: 'close', date: '2026-10-01', contract: 'MNQZ6.CME', error: 'reconciliation failed: MNQZ6.CME holds 5, expected 6', halted: true }),
  row(6, { ...CLOSE_OK, date: '2026-10-02', exposure: 0.31, mode: 'plumbing test, delayed data', strategy_performance: false }, true),
]

/** Every journal row, oldest first, across the three fixture journals (the JRNL "All journals" view). */
export const ALL_ROWS: Schemas['JournalRowOut'][] = [
  row(1, { type: 'warmup', date: '2026-09-28', requests: 30, planned: 30, valid_last: 22, window: 22, halted: null }, true, PREFLIGHT),
  row(1, { type: 'warmup', date: '2026-09-28', requests: 30, planned: 30, valid_last: 22, window: 22, halted: null }, true, BOOK_PLUMBING),
  row(1, { type: 'warmup', date: '2026-09-28', requests: 30, planned: 30, valid_last: 22, window: 22, halted: null }),
  ...BOOK_CLOSE_ROWS,
]

export function page(items: Schemas['JournalRowOut'][], total = items.length): Schemas['Page_JournalRowOut_'] {
  return { items, total, offset: 0, limit: 5000 }
}

/** /api/live/performance for the book: performance close rows only (the 2026-10-02 plumbing row dropped). */
export function performance(over: Partial<Schemas['Performance']> = {}): Schemas['Performance'] {
  return {
    journal: BOOK, present: true, empty_state: null, basis: 'performance rows only (plumbing rows dropped)', banner: BANNER,
    plumbing_rows_skipped: 1,
    t: [1790553600, 1790726400, 1790812800],
    line_no: [2, 4, 5],
    date: ['2026-09-28', '2026-09-30', '2026-10-01'],
    contract: ['MNQZ6.CME', 'MNQZ6.CME', 'MNQZ6.CME'],
    target: [6, 6, null],
    expected: [6, 6, null],
    actual: [6, 6, null],
    reconciled_ok: [true, true, null],
    exposure: [0.298212, null, null],
    slippage_ticks: [1.0, null, null],
    sent: [true, false, null],
    refused: [null, 'no sizing price', null],
    error: [null, null, 'reconciliation failed: MNQZ6.CME holds 5, expected 6'],
    halted: [false, false, true],
    ...over,
  }
}

const LAST_CLOSE: Schemas['LastClose'] = {
  actual: null, blocked: null, close_px: null, contract: 'MNQZ6.CME', date: '2026-10-01', error: 'reconciliation failed: MNQZ6.CME holds 5, expected 6',
  expected: null, exposure: null, halted: true, reconciled_ok: null, refused: null, sent: null, slippage_ticks: null, target: null,
  data: { type: 'close', date: '2026-10-01', contract: 'MNQZ6.CME', error: 'reconciliation failed: MNQZ6.CME holds 5, expected 6', halted: true },
}

export const LAST_CLOSE_OK: Schemas['LastClose'] = {
  actual: 6, blocked: null, close_px: 24851.0, contract: 'MNQZ6.CME', date: '2026-09-28', error: null, expected: 6, exposure: 0.298212,
  halted: false, reconciled_ok: true, refused: null, sent: true, slippage_ticks: 1.0, target: 6, data: CLOSE_OK,
}

function journal(name: string, rows: number, plumbingRows: number, lastType: string, lastDate: string): Schemas['JournalInfo'] {
  return {
    name, path: `live/logs/${name}`, rows, plumbing_rows: plumbingRows, performance_rows: rows - plumbingRows,
    plumbing: rows > 0 && plumbingRows === rows, bad_lines: 0, partial_line_pending: false, last_type: lastType, last_date: lastDate,
    last_row_utc: '2026-10-02T20:00:00Z', last_halted: false,
  }
}

export function status(over: Partial<Schemas['LiveStatus']> = {}): Schemas['LiveStatus'] {
  return {
    banner: BANNER,
    env: { account_masked: 'DU*******', base_usd_rate_set: true, delayed_flag_set: false, ib_host: '127.0.0.1', ib_port: 7497, volman_c_set: false },
    expected: [
      { name: BOOK, path: `live/logs/${BOOK}`, present: true, empty_state: null },
      { name: BOOK_PLUMBING, path: `live/logs/${BOOK_PLUMBING}`, present: true, empty_state: null },
    ],
    exposure_summary: { journal: BOOK, mean_exposure: 0.298212, plumbing_rows_skipped: 1, sessions: 1 },
    halted: true,
    journals: [
      journal(PREFLIGHT, 1, 1, 'warmup', '2026-09-28'),
      journal(BOOK_PLUMBING, 3, 3, 'close', '2026-09-28'),
      journal(BOOK, 6, 1, 'close', '2026-10-02'),
    ],
    kill_switch_on: false,
    kill_switch_path: 'live/KILL*',
    last_close: LAST_CLOSE,
    logs: [{ name: 'preflight2_2026-09-26_PLUMBING_DELAYED.log', path: 'live/logs/preflight2_2026-09-26_PLUMBING_DELAYED.log', plumbing: true, size_bytes: 2048, modified_utc: '2026-09-26T21:00:00Z' }],
    next: { contract: 'MNQZ6', decision_et: '15:55:05', order_et: '15:59:30', roll_date: '2026-12-08', today_et: '2026-10-02' },
    order_path: 'none',
    read_only: true,
    tws: 'not monitored',
    ...over,
  }
}

/** The same status with no journal on disk yet: every expected file names its empty state. */
export function emptyStatus(): Schemas['LiveStatus'] {
  return status({
    journals: [],
    exposure_summary: null,
    last_close: null,
    halted: null,
    expected: [
      { name: BOOK, path: `live/logs/${BOOK}`, present: false, empty_state: `no journal yet: live/logs/${BOOK}` },
      { name: BOOK_PLUMBING, path: `live/logs/${BOOK_PLUMBING}`, present: false, empty_state: `no journal yet: live/logs/${BOOK_PLUMBING}` },
    ],
  })
}
