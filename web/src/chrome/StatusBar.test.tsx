// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HealthData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'
import { StatusBar, type HealthState } from './StatusBar'
import { dataWindow, dayBefore } from './StatusBar.format'

afterEach(cleanup)

const HEALTH: HealthData = {
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  kill_switch_on: false,
  gate_reads_this_process: 7,
  fixture_mode: false,
}

const CONTEXTS = {
  A: { kind: 'instrument', value: 'NQ' },
  B: { kind: 'hypothesis', value: 'volmanaged_v0' },
  C: null,
} as const

/** The segment whose whole text is `text`: values sit in their own <b>, so getByText cannot see it. */
function seg(bar: HTMLElement, text: string | RegExp): HTMLElement | undefined {
  return Array.from(bar.querySelectorAll<HTMLElement>('.seg')).find((el) =>
    typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''),
  )
}

function renderBar(health: HealthState, screenCode: 'HOME' | 'REG' = 'HOME') {
  render(<StatusBar screen={screenCode} contexts={CONTEXTS} health={health} />)
  return screen.getByRole('contentinfo', { name: STATUS_BAR.label })
}

describe('StatusBar (UI_SPEC sections 2 and 8)', () => {
  it('always reads READ ONLY, NO ORDER PATH and TWS: not monitored, whatever the health state', () => {
    for (const health of [{ status: 'ok', data: HEALTH }, { status: 'loading' }, { status: 'error' }] as const) {
      const bar = renderBar(health)
      expect(within(bar).getByText('READ ONLY')).toBeTruthy()
      expect(within(bar).getByText('NO ORDER PATH')).toBeTruthy()
      expect(within(bar).getByText('TWS: not monitored')).toBeTruthy()
      cleanup()
    }
  })

  it('shows the kill switch from /api/health: off, ON, reading and unknown', () => {
    expect(within(renderBar({ status: 'ok', data: HEALTH })).getByText('KILL: off')).toBeTruthy()
    cleanup()
    const on = renderBar({ status: 'ok', data: { ...HEALTH, kill_switch_on: true } })
    const kill = within(on).getByText('KILL: ON')
    expect(kill.getAttribute('title')).toBe(STATUS_BAR.killOnNote)
    expect(kill.className).toMatch(/\balert\b/)
    cleanup()
    expect(within(renderBar({ status: 'loading' })).getByText('KILL: reading')).toBeTruthy()
    cleanup()
    const down = renderBar({ status: 'error' })
    expect(within(down).getByText('KILL: unknown')).toBeTruthy()
    expect(within(down).getByText('HEALTH: unavailable')).toBeTruthy()
  })

  it('no longer carries the stage A placeholder (born failing against the scaffold)', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH })
    expect(within(bar).queryByText('KILL: not read')).toBeNull()
  })

  it('shows the screen number, one segment per link group, gate reads and the ET clock', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH }, 'REG')
    expect(seg(bar, 'SCR 04 REG')).toBeTruthy()
    expect(seg(bar, 'A NQ')).toBeTruthy()
    expect(seg(bar, 'B volmanaged_v0')).toBeTruthy()
    expect(seg(bar, 'C -')).toBeTruthy()
    expect(seg(bar, 'gate reads 7')).toBeTruthy()
    expect(seg(bar, /^\d{2}:\d{2}:\d{2} ET$/)).toBeTruthy()
    expect(within(bar).getByText('Esc cmd')).toBeTruthy()
  })

  it('shows every number in the data colour (<b>) with its label muted (UI_SPEC section 3)', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH }, 'REG')
    const values = Array.from(bar.querySelectorAll('.seg b')).map((b) => b.textContent)
    expect(values).toEqual(['04', '2010-01-01..2021-12-31', '7', expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/)])
  })

  it('born failing: tells assistive tech about the kill switch and health, without the clock', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH })
    const live = within(bar).getByRole('status')
    expect(live.textContent).toBe('KILL: off')
    cleanup()
    const down = renderBar({ status: 'error' })
    expect(within(down).getByRole('status').textContent).toBe('KILL: unknown. HEALTH: unavailable')
    cleanup()
    const on = renderBar({ status: 'ok', data: { ...HEALTH, kill_switch_on: true } })
    const urgent = within(on).getByRole('status')
    expect(urgent.textContent).toBe('KILL: ON')
    expect(urgent.getAttribute('aria-live')).toBe('assertive')
  })

  it('derives the data window from the fence (end exclusive) and falls back before health answers', () => {
    expect(seg(renderBar({ status: 'ok', data: HEALTH }), 'DATA 2010-01-01..2021-12-31')).toBeTruthy()
    cleanup()
    expect(seg(renderBar({ status: 'loading' }), STATUS_BAR.dataFallback)).toBeTruthy()
  })

  it('marks fixture mode so fixture numbers are never mistaken for research files', () => {
    expect(within(renderBar({ status: 'ok', data: HEALTH })).queryByText('FIXTURE DATA')).toBeNull()
    cleanup()
    expect(within(renderBar({ status: 'ok', data: { ...HEALTH, fixture_mode: true } })).getByText('FIXTURE DATA')).toBeTruthy()
  })

  it('fetches nothing itself', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderBar({ status: 'ok', data: HEALTH })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('StatusBar formatting', () => {
  it('dayBefore steps back across month and year ends, including leap days', () => {
    expect(dayBefore('2022-01-01')).toBe('2021-12-31')
    expect(dayBefore('2020-03-01')).toBe('2020-02-29')
    expect(dayBefore('2021-03-01')).toBe('2021-02-28')
  })

  it('dataWindow shows an unreadable fence as given rather than inventing a date', () => {
    expect(dataWindow({ is_start: '2010-01-01', is_end: 'soon' })).toBe('DATA 2010-01-01..soon')
  })
})
