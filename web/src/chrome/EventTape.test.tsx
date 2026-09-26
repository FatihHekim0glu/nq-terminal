// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TAPE } from '../copy/chrome'
import { EventTape, tapeLine, type TapeEntry } from './EventTape'
import { loadTapeOn, saveTapeOn } from './EventTape.store'

afterEach(cleanup)

const ENTRY: TapeEntry = {
  line_no: 412,
  ts_utc: '2021-06-01T18:02:30+00:00',
  caller: 'volmanaged_v0',
  timeframe: '1d',
  symbol: 'NQ.V.0',
  is_sealed: false,
}

describe('EventTape (spec 4.9)', () => {
  it('formats a gate read as NNNN SRC HH:MM text, the time in ET', () => {
    expect(tapeLine(ENTRY)).toEqual({ no: '0412', src: 'OOS', time: '14:02', text: 'gate read volmanaged_v0 1d NQ.V.0 [IS]' })
    expect(tapeLine({ ...ENTRY, is_sealed: true, timeframe: null, symbol: null }).text).toBe('gate read volmanaged_v0 [SEALED]')
  })

  it('shows three lines, newest on top, in a labelled region', () => {
    const entries = [1, 2, 3, 4].map((n) => ({ ...ENTRY, line_no: n }))
    render(<EventTape entries={entries} state="ok" />)
    const tape = screen.getByRole('complementary', { name: TAPE.label })
    const lines = Array.from(tape.querySelectorAll('li')).map((li) => li.textContent)
    expect(lines).toEqual(['0004 OOS 14:02 gate read volmanaged_v0 1d NQ.V.0 [IS]', '0003 OOS 14:02 gate read volmanaged_v0 1d NQ.V.0 [IS]', '0002 OOS 14:02 gate read volmanaged_v0 1d NQ.V.0 [IS]'])
    expect(tape.querySelector('.tape-src')?.textContent).toBe('OOS')
  })

  it('says so when the log is empty or unreadable', () => {
    render(<EventTape entries={[]} state="ok" />)
    expect(screen.getByText(TAPE.empty)).toBeTruthy()
    cleanup()
    render(<EventTape entries={[]} state="error" />)
    expect(screen.getByText(TAPE.error)).toBeTruthy()
  })

  it('is off by default and remembers the switch per viewer, surviving blocked storage', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    expect(loadTapeOn(storage)).toBe(false)
    saveTapeOn(true, storage)
    expect(loadTapeOn(storage)).toBe(true)
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadTapeOn(blocked)).toBe(false)
    expect(() => saveTapeOn(true, blocked)).not.toThrow()
  })
})
