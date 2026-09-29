// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HealthData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'
import { LAYOUT } from '../copy/layout'
import { StatusBar, type HealthState } from './StatusBar'
import statusCss from './StatusBar.css?raw'
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
  B: { kind: 'hypothesis', value: 'rebal_v0' },
  C: null,
} as const

/** The segment whose whole text is `text`: keys sit in their own <b>, so getByText cannot see it. */
function seg(bar: HTMLElement, text: string | RegExp): HTMLElement | undefined {
  return Array.from(bar.querySelectorAll<HTMLElement>('.seg')).find((el) =>
    typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''),
  )
}

function renderBar(health: HealthState, screenCode: 'HOME' | 'REG' = 'HOME') {
  render(<StatusBar screen={screenCode} contexts={CONTEXTS} health={health} />)
  return screen.getByRole('contentinfo', { name: STATUS_BAR.label })
}

describe('StatusBar: the 22px status line (spec 4.10, decision D7)', () => {
  it('reads Screen, the groups, DATA, TWS, KILL, Gate reads, the ET clock and the <Esc> hint', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH }, 'REG')
    expect(seg(bar, 'Screen REG')).toBeTruthy()
    expect(seg(bar, 'A NQ1 Index')).toBeTruthy()
    expect(seg(bar, 'B rebal_v0')).toBeTruthy()
    expect(seg(bar, 'C -')).toBeTruthy()
    expect(seg(bar, 'DATA 2010-01-01..2021-12-31')).toBeTruthy()
    expect(seg(bar, 'TWS not monitored')).toBeTruthy()
    expect(seg(bar, 'KILL off')).toBeTruthy()
    expect(seg(bar, 'Gate reads 7')).toBeTruthy()
    expect(seg(bar, /^\d{2}:\d{2}:\d{2} ET$/)).toBeTruthy()
    expect(seg(bar, '<Esc> command')).toBeTruthy()
  })

  it('marks the screen edited: HOME* to the eye, HOME then the word edited to a screen reader', () => {
    render(<StatusBar screen="HOME" edited contexts={CONTEXTS} health={{ status: 'ok', data: HEALTH }} />)
    const bar = screen.getByRole('contentinfo', { name: STATUS_BAR.label })
    const screenSeg = Array.from(bar.querySelectorAll<HTMLElement>('.seg')).find((el) => el.querySelector('b')?.textContent === STATUS_BAR.screen)!
    const mark = screenSeg.querySelector('[aria-hidden="true"]')
    expect(mark?.textContent).toBe(LAYOUT.editedMark)
    const word = screenSeg.querySelector('.sr-only')
    expect(word?.textContent?.trim()).toBe(LAYOUT.editedLabel)
    // Visible text: everything but the screen reader word.
    const visible = Array.from(screenSeg.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.classList.contains('sr-only')))
      .map((n) => n.textContent)
      .join('')
      .trim()
    expect(visible).toBe(`${STATUS_BAR.screen} HOME${LAYOUT.editedMark}`)
    // The segment reads on: key, the screen, the word (the mark is aria-hidden).
    expect(screenSeg.textContent).toBe(`${STATUS_BAR.screen} HOME${LAYOUT.editedMark} ${LAYOUT.editedLabel}`)
  })

  it('shows a plain Screen segment when the layout is not edited, or when edited is not given', () => {
    const plain = renderBar({ status: 'ok', data: HEALTH }, 'REG')
    expect(seg(plain, 'Screen REG')).toBeTruthy()
    expect(plain.querySelector('.sr-only')).toBeNull()
    cleanup()
    render(<StatusBar screen="REG" edited={false} contexts={CONTEXTS} health={{ status: 'ok', data: HEALTH }} />)
    const bar = screen.getByRole('contentinfo', { name: STATUS_BAR.label })
    expect(seg(bar, 'Screen REG')).toBeTruthy()
    expect(bar.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('opens with an amber label and sets each key in bold (Suggested Functions style)', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH }, 'REG')
    expect(bar.querySelector('.status-label')?.textContent).toBe(STATUS_BAR.lead)
    const keys = Array.from(bar.querySelectorAll('.seg b')).map((b) => b.textContent)
    expect(keys).toEqual(expect.arrayContaining(['Screen', 'A', 'B', 'C', 'DATA', 'TWS', 'KILL', 'Gate reads']))
  })

  it('always keeps READ ONLY, NO ORDER PATH, TWS, KILL and gate reads, whatever the health state', () => {
    for (const health of [{ status: 'ok', data: HEALTH }, { status: 'loading' }, { status: 'error' }] as const) {
      const bar = renderBar(health)
      expect(within(bar).getByText('READ ONLY')).toBeTruthy()
      expect(within(bar).getByText('NO ORDER PATH')).toBeTruthy()
      expect(seg(bar, 'TWS not monitored')).toBeTruthy()
      expect(seg(bar, /^KILL /)).toBeTruthy()
      expect(seg(bar, /^Gate reads /)).toBeTruthy()
      for (const s of ['READ ONLY', 'NO ORDER PATH']) expect(within(bar).getByText(s).closest('.seg')?.className).toMatch(/\bkeep\b/)
      cleanup()
    }
  })

  it('shows the kill switch from /api/health: off, ON, reading and unknown', () => {
    expect(seg(renderBar({ status: 'ok', data: HEALTH }), 'KILL off')).toBeTruthy()
    cleanup()
    const on = renderBar({ status: 'ok', data: { ...HEALTH, kill_switch_on: true } })
    const kill = seg(on, 'KILL ON')
    expect(kill?.getAttribute('title')).toBe(STATUS_BAR.killOnNote)
    expect(kill?.className).toMatch(/\balert\b/)
    cleanup()
    expect(seg(renderBar({ status: 'loading' }), 'KILL reading')).toBeTruthy()
    cleanup()
    const down = renderBar({ status: 'error' })
    expect(seg(down, 'KILL unknown')).toBeTruthy()
    expect(within(down).getByText(STATUS_BAR.healthDown)).toBeTruthy()
    expect(seg(down, 'Gate reads --')).toBeTruthy()
  })

  it('born failing: tells assistive tech about the kill switch and health, without the clock', () => {
    const bar = renderBar({ status: 'ok', data: HEALTH })
    expect(within(bar).getByRole('status').textContent).toBe('KILL off')
    cleanup()
    const down = renderBar({ status: 'error' })
    expect(within(down).getByRole('status').textContent).toBe(`KILL unknown. ${STATUS_BAR.healthDown}`)
    cleanup()
    const urgent = within(renderBar({ status: 'ok', data: { ...HEALTH, kill_switch_on: true } })).getByRole('status')
    expect(urgent.textContent).toBe('KILL ON')
    expect(urgent.getAttribute('aria-live')).toBe('assertive')
  })

  it('derives the data window from the fence (end exclusive) and falls back before health answers', () => {
    expect(seg(renderBar({ status: 'ok', data: HEALTH }), 'DATA 2010-01-01..2021-12-31')).toBeTruthy()
    cleanup()
    expect(seg(renderBar({ status: 'loading' }), 'DATA 2010-01-01..2021-12-31')).toBeTruthy()
  })

  it('marks fixture mode so fixture numbers are never mistaken for research files', () => {
    expect(within(renderBar({ status: 'ok', data: HEALTH })).queryByText('FIXTURE DATA')).toBeNull()
    cleanup()
    expect(within(renderBar({ status: 'ok', data: { ...HEALTH, fixture_mode: true } })).getByText('FIXTURE DATA')).toBeTruthy()
  })

  // Visual review: the reference row is set near body size, so the status line uses the nav size
  // (13px); only the secondary bits (the clock and the <Esc> hint) keep the 11px small size (spec 3.2).
  it('sets the status line at the nav size and only the clock and the <Esc> hint small', () => {
    /** The declarations of the top-level rule whose selector is exactly `selector`. */
    const block = (selector: string) => {
      const start = statusCss.indexOf(`\n${selector} {`)
      return start < 0 ? '' : statusCss.slice(start, statusCss.indexOf('}', start))
    }
    expect(block('.nqt-status')).toMatch(/font-size:\s*var\(--fs-nav\)/)
    expect(block('.nqt-status .seg.small')).toMatch(/font-size:\s*var\(--fs-small\)/)
    render(<StatusBar screen="HOME" contexts={CONTEXTS} health={{ status: 'ok', data: HEALTH }} />)
    const small = Array.from(screen.getByRole('contentinfo').querySelectorAll('.seg.small')).map((el) => el.textContent)
    expect(small).toHaveLength(2)
    expect(small[0]).toMatch(/ET$/)
    expect(small[1]).toContain(STATUS_BAR.escHint)
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
