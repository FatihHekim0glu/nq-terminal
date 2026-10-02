// Test harness for the REG and MT screens (imported by *.test.tsx files only): a fresh query client,
// the panel's actions and Number <GO> registrar, and a fetch stub that answers the four research
// GETs, SV3's /api/analytics/deflated (with its served effective_n, SV3b), and five GET /api/hypotheses/{name} bodies (92) Evidence's
// details) from the fixture data, and records every request.
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION } from '../../api/connection'
import { createApiQueryClient } from '../../api/queries'
import { registerNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import { DEFLATED_REAL } from './deflatedFixtures'
import { EFFECTIVE_N_REAL } from './effectiveN.real.fixtures'
import { SPA_REJECTS } from './spaFixtures'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'

export const PANEL_ID = 'reg-test'

export function panelParams(code: 'REG' | 'MT'): PanelParams {
  return { code, context: null, args: {}, group: '-' }
}

export interface Seen {
  readonly url: string
  readonly method: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export const ANSWERS: Readonly<Record<string, unknown>> = {
  '/api/registry': REGISTRY,
  '/api/hypotheses': HYPOTHESES,
  '/api/multiple-testing': MULTIPLE_TESTING,
  '/api/confirmations': CONFIRMATIONS,
  '/api/analytics/deflated': { ...DEFLATED_REAL, effective_n: EFFECTIVE_N_REAL },
  '/api/analytics/spa': SPA_REJECTS,
  '/api/hypotheses/overnight_v0': OVERNIGHT,
  '/api/hypotheses/volmanaged_v0': VOLMANAGED,
  '/api/hypotheses/rebal_v0': REBAL,
  '/api/hypotheses/za_v0': ZA,
  '/api/hypotheses/za_v0_C3_gao_momentum': ZA_C3,
}

/** Stubs fetch; `override` replaces an answer with an error status. Returns the requests seen. */
export function stubApi(override: Readonly<Record<string, number>> = {}): Seen[] {
  const seen: Seen[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET' })
    const status = override[url]
    if (status !== undefined) return Promise.resolve(json({ detail: `stub ${status} for ${url}` }, status))
    const body = ANSWERS[url]
    return Promise.resolve(body === undefined ? json({ detail: 'not found' }, 404) : json(body))
  })
  return seen
}

/** Puts the connection store down, as chrome/PanelFault.test.tsx does; a test calls resetConnection() after. */
export function backendDown(): void {
  connectionStore.setState(
    { ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now() },
    true,
  )
}

export function mountScreen(node: ReactNode, actions: Partial<PanelActions> = {}) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  const value: PanelActions = {
    panelId: PANEL_ID,
    related: () => false,
    back: () => false,
    forward: () => false,
    open: () => false,
    ...actions,
  }
  return render(
    <ApiProvider client={client}>
      <NumberingContext value={registerNumbered}>
        <PanelActionsContext value={value}>{node}</PanelActionsContext>
      </NumberingContext>
    </ApiProvider>,
  )
}
