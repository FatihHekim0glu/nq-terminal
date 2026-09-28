// @vitest-environment jsdom
// U14 regression: RUN's own Window fact (the facts row above the checks strip) used runModel.ts's
// 'start to end' text, which for a sealed run's window (2010-09-28 to 2022-01-01) reads as though the
// run reaches into the sealed year. RunFacts now overrides that one fact with model.ts's formatWindow,
// the same half-open '[start, end)' convention the RUNS table uses (runsColumns.test.ts), without
// touching runModel.ts (not owned by this wave item).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RUN } from '../../copy/runs'
import { RunFacts } from './RunHeader'
import { DETAIL_DTSMOM, DETAIL_OVERNIGHT } from './runs.fixtures'

afterEach(() => cleanup())

describe('RunFacts: the Window fact (U14)', () => {
  it('marks the bound half-open for a sealed-year window', () => {
    render(<RunFacts detail={DETAIL_OVERNIGHT} />)
    const label = screen.getByText(RUN.header.window)
    const value = label.nextElementSibling
    expect(value?.textContent).toBe('[2010-09-28, 2022-01-01)')
  })

  it('renders a real session-to-session window the same way', () => {
    render(<RunFacts detail={DETAIL_DTSMOM} />)
    const label = screen.getByText(RUN.header.window)
    const value = label.nextElementSibling
    expect(value?.textContent).toBe('[2012-01-03, 2012-01-25)')
  })

  it('leaves every other fact as runModel.ts computed it', () => {
    render(<RunFacts detail={DETAIL_DTSMOM} />)
    expect(screen.getByText(DETAIL_DTSMOM.summary.nautilus_trader!)).toBeTruthy()
  })
})
