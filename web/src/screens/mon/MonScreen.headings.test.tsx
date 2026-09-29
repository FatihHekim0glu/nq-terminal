// @vitest-environment jsdom
// U26: MON's numbered section headings ('1) Equity' to '7) Livestock') are Number <GO> targets too. They
// used to clear the line silently; MonitorGrid now posts what the heading holds. This pins the behaviour
// at the screen, where the dogfood round saw it (keyboard-power/20-mon-numbers.json).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, numberedItems, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import { stubLayout } from '../../grids/testing'
import MonScreen, { MON_DEFAULTS_KEY } from './MonScreen'
import { makeUniverse } from './testUniverse'

const PANEL_ID = 'p-mon-headings'
const PARAMS: PanelParams = { code: 'MON', context: { kind: 'universe', value: '27F' }, args: {}, group: 'A' }
const actions: PanelActions = { panelId: PANEL_ID, related: vi.fn(() => true), back: vi.fn(() => true), forward: vi.fn(() => true), open: vi.fn(() => true) }

function Panel({ children }: { readonly children: ReactNode }) {
  return (
    <ApiProvider client={createApiQueryClient()}>
      <PanelActionsContext value={actions}>
        <NumberingContext value={registerNumbered}>{children}</NumberingContext>
      </PanelActionsContext>
    </ApiProvider>
  )
}

beforeAll(() => stubLayout(600))
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.startsWith('/api/market/two-day') ? { detail: 'not needed' } : makeUniverse()
    return new Response(JSON.stringify(body), { status: url.startsWith('/api/market/two-day') ? 404 : 200, headers: { 'content-type': 'application/json' } })
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = () => {}
  resetNumbered()
  resetMessage()
  window.localStorage.removeItem(MON_DEFAULTS_KEY)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MON: a numbered heading is not a silent number (U26)', () => {
  it('1 <GO> on the first heading says it is a heading and which rows it holds', async () => {
    render(<MonScreen params={PARAMS} context={PARAMS.context} />, { wrapper: Panel })
    await screen.findByRole('grid', { name: /Futures monitor/ })
    await waitFor(() => expect(numberedItems(PANEL_ID).some((i) => i.n === 1)).toBe(true))
    expect(useMessage.getState().text).toBe('')
    act(() => {
      expect(activateNumbered(PANEL_ID, 1)).toBe(true)
    })
    expect(useMessage.getState().text).toMatch(/^1\) [A-Za-z ]+ is a heading: rows 10 to \d+\.$/)
  })

  it('every heading number answers, none clears the line silently', async () => {
    render(<MonScreen params={PARAMS} context={PARAMS.context} />, { wrapper: Panel })
    await screen.findByRole('grid', { name: /Futures monitor/ })
    await waitFor(() => expect(numberedItems(PANEL_ID).length).toBeGreaterThan(20))
    const headings = numberedItems(PANEL_ID).filter((i) => i.n < 10)
    expect(headings.length).toBeGreaterThanOrEqual(2)
    for (const h of headings) {
      resetMessage()
      act(() => {
        activateNumbered(PANEL_ID, h.n)
      })
      expect(useMessage.getState().text, `heading ${h.n}`).toMatch(new RegExp(`^${h.n}\\) .+ is a heading: rows \\d+ to \\d+\\.$`))
    }
  })
})
