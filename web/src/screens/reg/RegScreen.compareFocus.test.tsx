// @vitest-environment jsdom
// REG 95) Compare > Back to the board: Back unmounts the focused button, so without a hand-over keyboard
// focus drops to <body> and the next Tab starts again at the top of the page (WCAG 2.4.3, and the rule in
// Workspace.focusRestore.test.tsx). Focus lands on the selected tab, or on the grid in HOME's REG cell,
// which has no tab strip.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import type { LineStackProps } from '../../charts/LineStack.types'
import { REG } from '../../copy/reg'
import { stubLayout } from '../../grids/testing'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import { mountScreen, panelParams, stubApi } from './testHarness'

// The compare view draws through LineStack (uPlot needs a canvas): a stand-in.
vi.mock('../../charts/LineStack', () => ({
  default: (_props: LineStackProps) => <div data-testid="linestack" />,
}))

const SERIES_URL = /^\/api\/hypotheses\/([^/]+)\/series\?cost=(\d)$/

/** stubApi plus a series body for volmanaged_v0 and overnight_v0. */
function stubWithSeries(): void {
  stubApi()
  const spy = vi.spyOn(globalThis, 'fetch')
  const base = spy.getMockImplementation()!
  spy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const m = SERIES_URL.exec(String(input))
    if (!m) return base(input, init)
    const body = { basis: 'A', bench_label: null, cost: Number(m[2]), equity: [1, 2, 3], kind: 'trades', name: m[1], r: [1, 1, 1], r_bench: null, source: 'fixture', t: [100, 200, 300], unit: 'points per trade (NQ)' }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
}

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  resetMessage()
})
afterEach(() => cleanup())

const board = () => screen.getByRole('grid', { name: /Registry board/ })
const bodyRows = () => within(board()).getAllByRole('row').filter((r) => r.closest('tbody'))

/** Space on each named row, walking the grid's active row down the board. */
function markWithSpace(names: readonly string[]): void {
  const g = board()
  act(() => g.focus())
  let cursor = 0
  for (const name of names) {
    const target = bodyRows().findIndex((r) => within(r).queryByText(name) !== null)
    for (; cursor < target; cursor += 1) fireEvent.keyDown(g, { key: 'ArrowDown' })
    for (; cursor > target; cursor -= 1) fireEvent.keyDown(g, { key: 'ArrowUp' })
    fireEvent.keyDown(g, { key: ' ' })
  }
}

async function compareAndBack(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
  markWithSpace(['volmanaged_v0', 'overnight_v0'])
  fireEvent.click(screen.getByRole('button', { name: /^95\) Compare/ }))
  const back = await screen.findByRole('button', { name: REG.compare.back })
  act(() => back.focus())
  expect(document.activeElement).toBe(back)
  fireEvent.click(back)
  await screen.findByRole('grid', { name: /Registry board/ })
  expect(container.contains(document.activeElement)).toBe(true)
  return document.activeElement as HTMLElement
}

describe('REG: Back from 95) Compare keeps keyboard focus in the screen', () => {
  it('moves focus to the selected sub tab, not to <body>', async () => {
    stubWithSeries()
    const { container } = mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const active = await compareAndBack(container)
    expect(active).not.toBe(document.body)
    expect(active.getAttribute('role')).toBe('tab')
    expect(active.getAttribute('aria-selected')).toBe('true')
  })

  it("moves focus to the board grid in HOME's REG cell, which has no tab strip", async () => {
    stubWithSeries()
    const { container } = mountScreen(<RegScreen params={panelParams('REG')} context={null} />, { panelId: HOME_PANEL_IDS.reg })
    expect(screen.queryByRole('tablist')).toBeNull()
    const active = await compareAndBack(container)
    expect(active).not.toBe(document.body)
    expect(active.getAttribute('role')).toBe('grid')
  })
})
