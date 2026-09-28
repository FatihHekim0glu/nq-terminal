// @vitest-environment jsdom
// D39: sorting JournalTable by Time, Date or Event must put a row with a missing value last in both
// directions (MonitorGrid's contract: "null sorts last in both directions"), not first, because '--'
// collates before digits in the en-GB numeric collator. A new file, not JournalTable.test.tsx or
// JournalTable.model.test.ts (the known failing file this machine cannot read).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import JournalTable from './JournalTable'
import type { JournalRow } from './JournalTable.model'
import { stubLayout } from './testing'

const ROWS: JournalRow[] = [
  {
    file: 'volmanaged_paper_journal.jsonl', line_no: 1, plumbing: false, banner: null,
    data: { type: 'close', date: '2021-11-10', target: 6, actual: { 'MNQZ1.CME': 6 }, sent: true, exposure: 0.3, decided_at_ns_epoch_s: 1636577705 }, // 15:55:05 ET
  },
  {
    file: 'volmanaged_paper_journal.jsonl', line_no: 2, plumbing: false, banner: null,
    data: { type: 'close', date: '2021-11-11', target: 6, actual: { 'MNQZ1.CME': 6 }, sent: true, exposure: 0.29 }, // no decided_at_ns_epoch_s: time '--'
  },
  {
    file: 'volmanaged_paper_journal.jsonl', line_no: 3, plumbing: false, banner: null,
    data: { type: 'close', date: '2021-11-12', target: 6, actual: { 'MNQZ1.CME': 6 }, sent: true, exposure: 0.31, decided_at_ns_epoch_s: 1636554660 }, // 09:31:00 ET
  },
]

beforeAll(() => stubLayout(400))
afterEach(() => cleanup())

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('grid')).getAllByRole('row').filter((r) => r.closest('tbody'))
}

function timesInOrder(): string[] {
  return bodyRows().map((r) => within(r).getByText(/^\d\d:\d\d:\d\d$|^--$/).textContent!)
}

describe('JournalTable sort (D39)', () => {
  it('puts the row without a decision time last, both ascending and descending', () => {
    render(<JournalTable rows={ROWS} file="volmanaged_paper_journal.jsonl" order="oldest" />)
    const header = screen.getByRole('columnheader', { name: 'Time (ET)' })
    fireEvent.click(header) // ascending
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(timesInOrder()).toEqual(['09:31:00', '15:55:05', '--'])
    fireEvent.click(header) // descending
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(timesInOrder()).toEqual(['15:55:05', '09:31:00', '--'])
  })

  it('puts a row with a missing date last too, both directions', () => {
    const rows: JournalRow[] = [
      ROWS[0]!,
      { ...ROWS[1]!, data: { ...ROWS[1]!.data, date: undefined } },
      ROWS[2]!,
    ]
    render(<JournalTable rows={rows} file="volmanaged_paper_journal.jsonl" order="oldest" />)
    const header = screen.getByRole('columnheader', { name: 'Date' })
    const dateOf = (r: HTMLElement) => within(r).getAllByRole('gridcell')[1]!.textContent
    fireEvent.click(header) // ascending
    expect(bodyRows().map(dateOf)).toEqual(['2021-11-10', '2021-11-12', '--'])
    fireEvent.click(header) // descending
    expect(bodyRows().map(dateOf)).toEqual(['2021-11-12', '2021-11-10', '--'])
  })
})
