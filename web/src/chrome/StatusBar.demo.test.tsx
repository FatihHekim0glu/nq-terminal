// @vitest-environment jsdom
// U01: the status line's FIXTURE DATA segment was a plain span, a second name for what the frame strip calls
// DEMO DATA. In the demo the segment now uses the same term and the same tooltip as the flag; on a real backend
// that runs on a fixture folder it stays FIXTURE DATA, with a tooltip of its own.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HealthData } from '../commands/types'
import { DEMO_DATA, FRAME_STRIP, STATUS_BAR } from '../copy/chrome'
import { StatusBar, type HealthState } from './StatusBar'

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.demo
})

const HEALTH: HealthData = {
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  kill_switch_on: false,
  gate_reads_this_process: 0,
  fixture_mode: true,
}

const CONTEXTS = { A: null, B: null, C: null } as const

function renderBar(health: HealthState) {
  render(<StatusBar screen="HOME" contexts={CONTEXTS} health={health} />)
  return screen.getByRole('contentinfo', { name: STATUS_BAR.label })
}

describe('StatusBar: the data source segment in the demo', () => {
  it('reads the one demo term, with the same tooltip as the frame strip flag, and no second name', () => {
    document.documentElement.dataset.demo = 'on'
    const bar = renderBar({ status: 'ok', data: HEALTH })
    const segment = screen.getByText(DEMO_DATA.term)
    expect(segment.closest('footer')).toBe(bar)
    expect(segment.getAttribute('title')).toBe(DEMO_DATA.note)
    expect(FRAME_STRIP.demoData).toBe(DEMO_DATA.term)
    expect(bar.textContent).not.toContain(STATUS_BAR.fixture)
  })

  it('is a plain segment, not a second key: the flag is the one control', () => {
    document.documentElement.dataset.demo = 'on'
    const bar = renderBar({ status: 'ok', data: HEALTH })
    expect(bar.querySelectorAll('button')).toHaveLength(0)
  })

  it('stays out until the health poll has answered, as before', () => {
    document.documentElement.dataset.demo = 'on'
    const bar = renderBar({ status: 'loading' })
    expect(bar.textContent).not.toContain(DEMO_DATA.term)
    expect(bar.textContent).not.toContain(STATUS_BAR.fixture)
  })
})

describe('StatusBar: the data source segment outside the demo', () => {
  it('reads FIXTURE DATA with a tooltip of its own when the backend runs on fixtures', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH })
    const segment = screen.getByText(STATUS_BAR.fixture)
    expect(segment.getAttribute('title')).toBe(STATUS_BAR.fixtureNote)
    expect(STATUS_BAR.fixtureNote).toMatch(/fixture folder/)
    expect(bar.textContent).not.toContain(DEMO_DATA.term)
  })

  it('shows nothing when the backend reads the research files', () => {
    const bar = renderBar({ status: 'ok', data: { ...HEALTH, fixture_mode: false } })
    expect(bar.textContent).not.toContain(STATUS_BAR.fixture)
    expect(bar.textContent).not.toContain(DEMO_DATA.term)
  })
})
