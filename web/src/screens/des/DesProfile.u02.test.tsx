// @vitest-environment jsdom
// U02 (polish 3) on DES page 1: the Bonferroni, Holm and BH q tiles say which family they are adjusted over,
// and one line under the tiles states that PASS/FAIL is the spec's own pre-registered bar. Also U15 on the
// same page: the pass-checks box shows the gating statistic beside each boolean check.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import DesProfile from './DesProfile'
import { OVERNIGHT, VOLMANAGED } from './desTestData'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'

vi.mock('./DesEquity', () => ({ default: () => <div data-testid="des-equity" /> }))

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderProfile(detail: typeof OVERNIGHT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ApiProvider client={client}>
      <DesProfile detail={detail} link="-" onTab={() => {}} />
    </ApiProvider>,
  )
}

function tile(label: string): HTMLElement {
  const found = screen.getAllByRole('button').find((b) => b.querySelector('.kpi-label')?.textContent === label)
  if (!found) throw new Error(`no tile ${label}`)
  return found
}

describe('DES Profile names the family of every adjusted p (U02)', () => {
  it.each(['Bonferroni', 'Holm', 'BH q'])('the %s tile shows the registry family beside its value', (label) => {
    renderProfile(OVERNIGHT)
    const t = tile(label)
    expect(t.querySelector('.kpi-unit')?.textContent).toBe(DES.family.unit)
    expect(t.querySelector('.kpi-value')?.textContent).toBe('0.0054')
  })

  it('does not label p or control p as adjusted', () => {
    renderProfile(OVERNIGHT)
    expect(tile('p').querySelector('.kpi-unit')).toBeNull()
    expect(tile('Control p').querySelector('.kpi-unit')).toBeNull()
  })

  it('states under the tiles that PASS/FAIL is the spec own bar and the adjusted p is context', () => {
    renderProfile(OVERNIGHT)
    const row = screen.getByRole('list', { name: DES.kpiRow })
    expect(row.nextElementSibling?.textContent).toBe(DES.family.note)
  })
})

describe('DES Profile pass checks show the gating statistic beside each boolean (U15)', () => {
  it('volmanaged_v0: alpha t, the lowest block and the 2 tick Sharpe difference sit beside their [FAIL]', () => {
    renderProfile({ ...VOLMANAGED, screen: VOLMANAGED_SCREEN })
    const box = screen.getByRole('region', { name: DES.cards.checks })
    const pairs = Array.from(box.querySelectorAll('.nqt-card-pair')).map((p) => p.textContent)
    expect(pairs).toEqual([
      'alpha t >= 2+1.18 [FAIL]',
      'blocks a > 02014-17 -1.43 [FAIL]',
      `${DES.dsrLabel} 2tick > 0-0.0061 [FAIL]`,
    ])
    expect(within(box).getAllByText(DES.checkFail)).toHaveLength(3)
  })

  it('tags the figures of the box as registered values (C7), and only when it shows one', () => {
    renderProfile({ ...VOLMANAGED, screen: VOLMANAGED_SCREEN })
    const box = screen.getByRole('region', { name: DES.cards.checks })
    expect(box.textContent).toContain(fillCopy(DES.passChecks.boxNote, { tag: '[PRE-REG]' }))
    cleanup()
    renderProfile({ ...VOLMANAGED, card: { ...VOLMANAGED.card, pass_checks: [{ name: 'passes', passed: false, value: null }] } })
    expect(screen.getByRole('region', { name: DES.cards.checks }).textContent).not.toContain('recorded figures')
  })

  it('a check with no recorded statistic keeps only its result (nothing is invented)', () => {
    renderProfile(VOLMANAGED)
    const box = screen.getByRole('region', { name: DES.cards.checks })
    const pairs = Array.from(box.querySelectorAll('.nqt-card-pair')).map((p) => p.textContent)
    expect(pairs[2]).toBe(`${DES.dsrLabel} 2tick > 0[FAIL]`)
  })
})
