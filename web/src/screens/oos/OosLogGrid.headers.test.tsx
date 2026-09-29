// @vitest-environment jsdom
// U07: the OOS screen never said 'out-of-sample', and its 'A' and 'R' columns (and the '(house)' in the
// severity key) were unexplained. The screen now carries the subtitle 'OOS: out-of-sample gate access log' once,
// under its red bar and in every view (OosScreen.test.tsx), so the table alone does not repeat it. The A and R
// headers carry the house tooltip (the grid also reads a header's hint out for keyboard users), and the key
// spells out what 'house' means. Every string is in copy/oos.ts.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { OOS } from '../../copy/oos'
import { stubLayout } from '../../grids/testing'
import OosLogGrid from './OosLogGrid'

type Entry = Schemas['OosLogEntry']

const ENTRY: Entry = {
  alert: true, caller: 'za_screen', end: '2022-01-01 00:00:00+00:00', end_epoch_s: 1640995200, is_sealed: true, key_set: 'k4',
  line_no: 1, past_fence: false, reason: 'pre-registered za_v0 screen', rows: 3129157, sealed: null, severity: 4, spec_sha256: null,
  start: '2010-09-28 00:00:00+00:00', start_epoch_s: 1285632000, symbol: 'NQ.V.0', timeframe: '1m', variant: 'repaired',
  ts_epoch_s: 1790386325, ts_utc: '2026-09-25T21:32:05.600302+00:00',
}
const LEVELS: Schemas['SeverityLevel'][] = [{ level: 1, meaning: 'terminal display read' }, { level: 4, meaning: 'sealed read' }]

function mount() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  const client = createApiQueryClient()
  render(
    <ApiProvider client={client}>
      <OosLogGrid rows={[ENTRY]} emptyText="No entries." levels={LEVELS} />
    </ApiProvider>,
  )
  return screen.findByRole('grid')
}

beforeEach(() => stubLayout(600))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('U07: the OOS log says what it is and what A and R mean', () => {
  it('leaves the subtitle to the screen: the table alone does not render it', async () => {
    const grid = await mount()
    expect(OOS.subtitle).toBe('OOS: out-of-sample gate access log')
    expect(screen.queryByText(OOS.subtitle)).toBeNull()
    expect(grid.getAttribute('aria-label')).toBe(OOS.gridLabel)
  })

  it('gives the A header the alert-flag tooltip and the R header the house-severity tooltip', async () => {
    const grid = await mount()
    const headers = Array.from(grid.querySelectorAll<HTMLElement>('th[data-hint]'))
    const byText = (t: string) => headers.find((h) => (h.textContent ?? '').trim().startsWith(t))
    expect(byText('A')?.dataset['hint']).toBe(OOS.hintAlert)
    expect(byText('R')?.dataset['hint']).toBe(OOS.hintSeverity)
    expect(OOS.hintAlert.startsWith('A: alert flag')).toBe(true)
    expect(OOS.hintSeverity.startsWith('R: house severity 1 to 4')).toBe(true)
  })

  it('does not put a tooltip on the columns that need none', async () => {
    const grid = await mount()
    const hinted = Array.from(grid.querySelectorAll<HTMLElement>('th[data-hint]')).map((h) => (h.textContent ?? '').trim()[0])
    expect(hinted.sort()).toEqual(['A', 'R'])
  })
})

describe('U07: the severity key explains "house"', () => {
  it('says the scale is this project\'s own and where each level is defined', () => {
    expect(OOS.severityLegendTitle).toMatch(/house/i)
    expect(OOS.hintSeverity).toMatch(/this project's own scale/)
  })
})
