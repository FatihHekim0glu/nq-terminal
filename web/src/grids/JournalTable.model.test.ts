// JournalTable's row model (TASKS 5.4, UI_SPEC section 6, look spec 7.11): one display line per
// journal row, with the exact plumbing banner the API sends, the source code, and a short summary.
import { describe, expect, it } from 'vitest'
import { PLUMBING_BANNER } from '../copy/grids'
import { journalLine, summarise, type JournalRow } from './JournalTable.model'
import { readText } from './testing'

const close = {
  type: 'close', date: '2021-11-10', contract: 'MNQZ1.CME', target: 6, n_star: 6, refused: null, blocked: null,
  sent: true, expected: { 'MNQZ1.CME': 6 }, actual: { 'MNQZ1.CME': 6 }, exposure: 0.298212, halted: false,
  decided_at_ns: '2021-11-10T20:55:05.000000000Z', decided_at_ns_epoch_s: 1636577705,
}

function row(data: Record<string, unknown>, plumbing = false, line_no = 1): JournalRow {
  return { file: plumbing ? 'volmanaged_paper_journal.PLUMBING_DELAYED.jsonl' : 'volmanaged_paper_journal.jsonl', line_no, plumbing, banner: plumbing ? PLUMBING_BANNER : null, data }
}

describe('summarise', () => {
  it('summarises a close row: target, actual, whether sent, exposure', () => {
    expect(summarise(close)).toBe('Target 6, actual 6, sent yes, exposure 0.30')
  })

  it('adds a refusal, a block and a halt, and prints missing numbers as --', () => {
    expect(summarise({ ...close, sent: false, exposure: null, refused: 'no sizing price', halted: true }))
      .toBe('Target 6, actual 6, sent no, exposure --; refused: no sizing price; halted')
    expect(summarise({ ...close, blocked: 'kill switch on' })).toBe('Target 6, actual 6, sent yes, exposure 0.30; blocked: kill switch on')
  })

  it('summarises warm-up, delayed fetch and skipped rows', () => {
    expect(summarise({ type: 'warmup', requests: 30, planned: 30, valid_last: 22, window: 22 })).toBe('Warm-up: 30 of 30 requests, 22 of 22 sessions valid')
    expect(summarise({ type: 'delayed_fetch', bars: 370, lag_secs: 905.0, sizing_price: 'stale sizing price, plumbing only' }))
      .toBe('Delayed fetch: 370 bars, lag 905 s; stale sizing price, plumbing only')
    expect(summarise({ type: 'skipped', reason: 'decision time had passed' })).toBe('decision time had passed')
  })

  it('falls back to the first scalar fields for an unknown row type', () => {
    expect(summarise({ type: 'note', a: 1, b: 'x', c: { nested: true }, d: null })).toBe('a 1, b x, d --')
  })
})

describe('journalLine', () => {
  it('reads date, ET time, type and a LIVE source from a performance row', () => {
    const line = journalLine(row(close))
    expect(line).toMatchObject({ date: '2021-11-10', time: '15:55:05', type: 'close', source: 'LIVE', plumbing: false, banner: null })
    expect(line.key).toBe('volmanaged_paper_journal.jsonl:1')
  })

  it('carries the exact banner the API sends on a plumbing row, and the PLMB source', () => {
    const line = journalLine(row(close, true))
    expect(line.banner).toBe('PLUMBING TEST, DELAYED DATA: not strategy performance')
    expect(line.source).toBe('PLMB')
  })

  it('falls back to the banner copy if a plumbing row ever arrives without one', () => {
    const line = journalLine({ ...row(close, true), banner: null })
    expect(line.banner).toBe(PLUMBING_BANNER)
  })

  it('prints -- for a row without a decision time', () => {
    expect(journalLine(row({ type: 'warmup', date: '2021-11-10' })).time).toBe('--')
  })
})

describe('the banner copy matches the Python constant (paper_plumbing.BANNER)', () => {
  it('reads src/nq_lab/paper_plumbing.py and finds the same text', () => {
    const py = readText(new URL('../../../../src/nq_lab/paper_plumbing.py', import.meta.url))
    const m = /^BANNER = "([^"]+)"/m.exec(py)
    expect(m?.[1]).toBe(PLUMBING_BANNER)
  })
})
