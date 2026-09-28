// @vitest-environment jsdom
// KpiTile (TASKS 5.4, UI_SPEC sections 6 and 8, look spec 7.1): a --raised card with a muted label and
// a white value; a disclosure popover that always states the basis (A screen, B account) and the unit.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Schemas } from '../api/types'
import KpiTile, { KpiRow, formatKpi } from './KpiTile'

type Kpi = Schemas['Kpi']

const SHARPE: Kpi = { key: 'sharpe', label: 'Sharpe', value: 0.9912, unit: 'ratio', basis: 'B', tag: '[POST HOC]', note: null }
const MAXDD: Kpi = { key: 'max_dd', label: 'Max DD', value: -22.61, unit: '%', basis: 'B', tag: '[POST HOC]', note: null }
const ALPHA: Kpi = { key: 'alpha', label: 'Alpha', value: 3.52, unit: '%/yr', basis: 'A', tag: '[PRE-REG]', note: 'read from the screen JSON' }
const PSR: Kpi = { key: 'psr', label: 'PSR(0)', value: null, unit: 'probability', basis: 'B', tag: '[POST HOC]', note: 'fewer than 30 sessions' }
// G08: a Basis A tile the terminal computed, not one read from the screen JSON.
const SHARPE_A_COMPUTED: Kpi = { key: 'sharpe_a', label: 'Sharpe', value: -3.72, unit: 'ratio', basis: 'A', tag: '[POST HOC]', note: null }
const ALPHA_T: Kpi = { key: 'alpha_t', label: 'Alpha t', value: 1.18, unit: '', basis: 'A', tag: '[PRE-REG]', note: null }

afterEach(() => cleanup())

describe('formatKpi', () => {
  it('prints fixed decimals, attaches %, adds + only when asked, and -- for missing', () => {
    expect(formatKpi(0.9912, 'ratio', 2, false)).toBe('0.99')
    expect(formatKpi(-22.61, '%', 1, false)).toBe('-22.6%')
    expect(formatKpi(3.52, '%/yr', 1, true)).toBe('+3.5')
    expect(formatKpi(null, 'ratio', 2, false)).toBe('--')
    expect(formatKpi(-0.001, 'ratio', 2, true)).toBe('0.00')
    // Counts and money group thousands, as every grid and text line does (2,686 sessions).
    expect(formatKpi(2686, 'sessions', 0, false)).toBe('2,686')
    expect(formatKpi(-1600685.861, 'USD', 2, true)).toBe('-1,600,685.86')
    expect(formatKpi(723.38, 'sessions', 0, false)).toBe('723')
  })
})

describe('KpiTile', () => {
  it('shows the label, the value and the tag in one button whose state is aria-expanded', () => {
    render(<KpiTile kpi={SHARPE} />)
    const tile = screen.getByRole('button', { name: /Sharpe/ })
    expect(tile.textContent).toContain('Sharpe')
    expect(tile.querySelector('.kpi-value')?.textContent).toBe('0.99')
    expect(tile.querySelector('.kpi-tag')?.textContent).toBe('[POST HOC]')
    expect(tile.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens a popover with the basis and the unit on click, and closes it with Escape', () => {
    render(<KpiTile kpi={SHARPE} description="Annualised Sharpe ratio of daily account returns, 252 sessions a year." />)
    const tile = screen.getByRole('button', { name: /Sharpe/ })
    fireEvent.click(tile)
    expect(tile.getAttribute('aria-expanded')).toBe('true')
    const pop = document.getElementById(tile.getAttribute('aria-controls') ?? '')
    expect(pop?.textContent).toContain('Annualised Sharpe ratio')
    expect(pop?.textContent).toContain('Basis B: an account value, from the Nautilus account.')
    expect(pop?.textContent).toContain('Unit: ratio')
    fireEvent.keyDown(tile, { key: 'Escape' })
    expect(tile.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(tile.getAttribute('aria-controls') ?? 'x')).toBeNull()
  })

  it('states basis A as a screen value and shows the note', () => {
    render(<KpiTile kpi={ALPHA} signed decimals={1} />)
    const tile = screen.getByRole('button', { name: /Alpha/ })
    expect(tile.querySelector('.kpi-value')?.textContent).toBe('+3.5')
    expect(tile.querySelector('.kpi-unit')?.textContent).toBe('%/yr')
    fireEvent.click(tile)
    expect(screen.getByText('Basis A: a screen value, read from the research screen.')).toBeTruthy()
    expect(screen.getByText('Note: read from the screen JSON')).toBeTruthy()
  })

  it('attaches % to the value and hides unitless units from the face', () => {
    render(<><KpiTile kpi={MAXDD} decimals={1} /><KpiTile kpi={SHARPE} /></>)
    expect(screen.getByRole('button', { name: /Max DD/ }).querySelector('.kpi-value')?.textContent).toBe('-22.6%')
    expect(screen.getByRole('button', { name: /Max DD/ }).querySelector('.kpi-unit')).toBeNull()
    expect(screen.getByRole('button', { name: /Sharpe/ }).querySelector('.kpi-unit')).toBeNull()
  })

  it('G08: a Basis A tile tagged [POST HOC] says the terminal computed it, not that it was read from the screen', () => {
    render(<KpiTile kpi={SHARPE_A_COMPUTED} />)
    fireEvent.click(screen.getByRole('button', { name: /Sharpe/ }))
    expect(screen.queryByText(/read from the research screen/)).toBeNull()
    expect(screen.getByText("Basis A: computed by the terminal on the research screen's series.")).toBeTruthy()
  })

  it('G08: the popover unit line uses the API full unit, not the short face unit', () => {
    render(<KpiTile kpi={ALPHA} unit="% per year" />)
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(screen.getByText('Unit: % per year')).toBeTruthy()
    expect(screen.queryByText('Unit: %/yr')).toBeNull()
  })

  it('G08: a unitless face (a bare t statistic) still states its full unit in the popover', () => {
    render(<KpiTile kpi={ALPHA_T} unit="t statistic (gating, as the screen records it)" />)
    const tile = screen.getByRole('button', { name: /Alpha t/ })
    expect(tile.querySelector('.kpi-unit')).toBeNull()
    fireEvent.click(tile)
    expect(screen.getByText('Unit: t statistic (gating, as the screen records it)')).toBeTruthy()
  })

  it('G08: without a unit prop the popover falls back to the tile kpi.unit, as before', () => {
    render(<KpiTile kpi={SHARPE} description="Annualised Sharpe ratio of daily account returns, 252 sessions a year." />)
    fireEvent.click(screen.getByRole('button', { name: /Sharpe/ }))
    expect(screen.getByText('Unit: ratio')).toBeTruthy()
  })

  it('shows -- for a missing value and says why in the popover', () => {
    render(<KpiTile kpi={PSR} />)
    const tile = screen.getByRole('button', { name: /PSR/ })
    expect(tile.querySelector('.kpi-value')?.textContent).toBe('--')
    fireEvent.click(tile)
    expect(screen.getByText('Note: fewer than 30 sessions')).toBeTruthy()
  })

  it('shows a confidence interval beside the value when given', () => {
    render(<KpiTile kpi={SHARPE} ci={[0.41, 1.57]} />)
    const ci = screen.getByRole('button', { name: /Sharpe/ }).querySelector('.kpi-ci')
    expect(ci?.textContent).toBe('[0.41, 1.57]')
    expect(ci?.getAttribute('aria-label')).toBe('95% interval 0.41 to 1.57')
  })

  it('closes when the pointer goes down outside it', () => {
    render(<><KpiTile kpi={SHARPE} /><p>outside</p></>)
    const tile = screen.getByRole('button', { name: /Sharpe/ })
    fireEvent.click(tile)
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(tile.getAttribute('aria-expanded')).toBe('false')
  })

  it('takes part in the panel roving focus', () => {
    render(<KpiTile kpi={SHARPE} />)
    expect(screen.getByRole('button', { name: /Sharpe/ }).hasAttribute('data-roving')).toBe(true)
  })
})

describe('KpiRow', () => {
  it('is a labelled list of tiles', () => {
    render(<KpiRow>{[SHARPE, MAXDD].map((k) => <KpiTile key={k.key} kpi={k} />)}</KpiRow>)
    const list = screen.getByRole('list', { name: 'Key figures' })
    expect(list.querySelectorAll('li')).toHaveLength(2)
  })
})
