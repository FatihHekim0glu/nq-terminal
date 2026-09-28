// U14 regression: the RUNS table's Window column read 'start to end', which for a sealed-year run (za,
// overnight: '2010-09-28 to 2022-01-01') suggests it reaches into the sealed 2022 year, and for a
// calendar-bound run (smoke: '2015-01-01 to 2015-02-01', a holiday and a Sunday) suggests both ends were
// traded. The column now marks the bound '[start, end)', a half-open interval, using model.ts's
// formatWindow so the RUNS table and the RUN header (RunHeader.tsx) read the same convention.
import { describe, expect, it } from 'vitest'
import { cellText } from '../../grids/MonitorGrid'
import { statsById } from './model'
import { runsColumns } from './runsColumns'
import { RUNS } from './runs.fixtures'

function byId(id: string) {
  const run = RUNS.find((r) => r.run_id === id)
  if (!run) throw new Error(`no fixture run ${id}`)
  return run
}

describe('runsColumns: Window column (U14)', () => {
  const columns = runsColumns(statsById([]))
  const windowCol = columns.find((c) => c.id === 'window')!

  it('has a window column', () => {
    expect(windowCol).toBeTruthy()
  })

  it('marks the bound half-open, never implying the run reaches into the sealed year', () => {
    expect(cellText(windowCol, byId('nt_overnight_v0_fixture_open'))).toBe('[2010-09-28, 2022-01-01)')
  })

  it('renders a real session-to-session window the same way', () => {
    expect(cellText(windowCol, byId('nt_dtsmom_v0_fixture_ts1'))).toBe('[2012-01-03, 2012-01-25)')
  })

  it('shows -- when the run has no start or end', () => {
    expect(cellText(windowCol, { ...byId('nt_dtsmom_v0_fixture_ts1'), start: null, end: null })).toBe('--')
  })
})
