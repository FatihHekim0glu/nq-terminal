// @vitest-environment jsdom
// JournalTable (TASKS 5.4): journal rows in a MonitorGrid, newest first, plumbing rows hatched with
// the exact banner (acceptance: "plumbing row shows the exact banner text").
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import JournalTable from './JournalTable'
import type { JournalRow } from './JournalTable.model'
import { stubLayout } from './testing'

const BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

const ROWS: JournalRow[] = [
  { file: 'volmanaged_paper_journal.jsonl', line_no: 1, plumbing: false, banner: null, data: { type: 'warmup', date: '2021-11-10', requests: 30, planned: 30, valid_last: 22, window: 22 } },
  { file: 'volmanaged_paper_journal.PLUMBING_DELAYED.jsonl', line_no: 2, plumbing: true, banner: BANNER, data: { type: 'close', date: '2021-11-10', target: 6, actual: { 'MNQZ1.CME': 6 }, sent: true, exposure: 0.3, decided_at_ns_epoch_s: 1636577705 } },
  { file: 'volmanaged_paper_journal.jsonl', line_no: 3, plumbing: false, banner: null, data: { type: 'close', date: '2021-11-11', target: 6, actual: { 'MNQZ1.CME': 6 }, sent: true, exposure: 0.29, decided_at_ns_epoch_s: 1636664105 } },
]

beforeAll(() => stubLayout(400))
afterEach(() => cleanup())

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('grid')).getAllByRole('row').filter((r) => r.closest('tbody'))
}

describe('JournalTable', () => {
  it('is a grid named after the journal, newest row first, numbered', () => {
    render(<JournalTable rows={ROWS} file="volmanaged_paper_journal.jsonl" />)
    expect(screen.getByRole('grid', { name: 'Journal rows: volmanaged_paper_journal.jsonl' })).toBeTruthy()
    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getAllByRole('gridcell').map((c) => c.textContent).slice(0, 4)).toEqual(['1)', '2021-11-11', '15:55:05', 'close'])
  })

  it('hatches the plumbing row and shows the exact banner text in it', () => {
    render(<JournalTable rows={ROWS} file="both" />)
    const plumbing = bodyRows()[1]!
    expect(plumbing.classList.contains('plumbing-row')).toBe(true)
    const banner = plumbing.querySelector('.plumbing-banner')
    expect(banner?.textContent).toBe(BANNER)
    expect(plumbing.textContent).toContain(`${BANNER} Target 6, actual 6, sent yes, exposure 0.30`)
    expect(within(plumbing).getByText('PLMB').classList.contains('src')).toBe(true)
  })

  it('never hatches a performance row or gives it a banner', () => {
    render(<JournalTable rows={ROWS} file="both" />)
    for (const row of [bodyRows()[0]!, bodyRows()[2]!]) {
      expect(row.classList.contains('plumbing-row')).toBe(false)
      expect(row.querySelector('.plumbing-banner')).toBeNull()
      expect(within(row).getByText('LIVE')).toBeTruthy()
    }
  })

  it('keeps file order when asked for oldest first', () => {
    render(<JournalTable rows={ROWS} file="both" order="oldest" />)
    expect(within(bodyRows()[0]!).getAllByRole('gridcell')[3]?.textContent).toBe('warmup')
  })

  it('opens the API row on Enter', () => {
    const onOpen = vi.fn()
    render(<JournalTable rows={ROWS} file="both" onOpen={onOpen} />)
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(ROWS[1])
  })

  it('names the expected file when there are no rows yet', () => {
    render(<JournalTable rows={[]} file="volmanaged_paper_journal.jsonl" emptyText="No journal yet: live/logs/volmanaged_paper_journal.jsonl" />)
    expect(screen.getByText('No journal yet: live/logs/volmanaged_paper_journal.jsonl')).toBeTruthy()
  })
})
