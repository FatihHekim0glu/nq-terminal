// @vitest-environment jsdom
// The live reads of the P2 risk extras (TASKS Phase 12; RK4, PF11, BR5): which route a tear sheet target asks for,
// that the request is a plain GET at the sheet's own cost or freq, and what a refusal looks like. The cards
// themselves are RiskExtras.test.tsx.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../../api/queries'
import { RISK_EXTRAS as R } from '../../copy/riskExtras'
import { HYP_RISK_EXTRAS, RUN_RISK_EXTRAS } from './riskExtras.fixtures'
import RiskExtrasLive from './RiskExtrasLive'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let calls: string[] = []
let reply: () => Response = () => json(HYP_RISK_EXTRAS)

beforeEach(() => {
  calls = []
  reply = () => json(HYP_RISK_EXTRAS)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET')
    calls.push(String(input))
    return reply()
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mount(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createApiQueryClient()}>{ui}</QueryClientProvider>)
}

describe('RiskExtrasLive', () => {
  it('a hypothesis asks for its route at the sheet cost and fills the RET cards', async () => {
    mount(<RiskExtrasLive tab="RET" target={{ kind: 'hypothesis', name: 'volmanaged_v0' }} freq="D" cost={1} />)
    expect(screen.getByRole('status').textContent).toBe(R.loading)
    await waitFor(() => expect(screen.getByRole('heading', { name: /Modified expected shortfall \(RK4\)/ })).toBeTruthy())
    expect(calls).toEqual(['/api/analytics/hypothesis/volmanaged_v0/risk-extras?cost=1'])
  })

  it('a run asks for its route at the sheet freq and fills the RR card', async () => {
    reply = () => json(RUN_RISK_EXTRAS)
    mount(<RiskExtrasLive tab="RR" target={{ kind: 'run', name: 'nt_za_v0_fixture_a' }} freq="M" cost={null} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: /Treynor ratio \(BR5\)/ })).toBeTruthy())
    expect(calls).toEqual(['/api/analytics/run/nt_za_v0_fixture_a/risk-extras?freq=M'])
  })

  it('asks for nothing while the cost of a hypothesis is not known', async () => {
    mount(<RiskExtrasLive tab="RET" target={{ kind: 'hypothesis', name: 'volmanaged_v0' }} freq="D" cost={null} />)
    expect(screen.getByRole('status').textContent).toBe(R.loading)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([])
  })

  it('shows a refusal as an alert with the API detail', async () => {
    reply = () => json({ detail: 'no risk extras for this series: modified ES needs at least 4 returns, got 3' }, 422)
    mount(<RiskExtrasLive tab="RET" target={{ kind: 'run', name: 'nt_za_v0_fixture_a' }} freq="D" cost={null} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('modified ES needs at least 4 returns'))
  })
})
