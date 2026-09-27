// Test helpers for the RUNS, RUN and LEDG screens (imported by *.test.* files only, never by the app):
// a fetch stub that answers contract paths from the fixture-mode responses and records every request,
// and a mount that gives a screen the query client, a panel id and the Number <GO> registry.
import { render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { registerNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'

export const TEST_PANEL = 'p-runs-test'

export interface Answer {
  readonly status: number
  readonly body: unknown
}

export interface SeenRequest {
  readonly url: string
  readonly method: string
}

/** A route answers a path (query string removed) with a body, or with a status and body. */
export type Routes = Readonly<Record<string, unknown>>

function isAnswer(value: unknown): value is Answer {
  return value !== null && typeof value === 'object' && 'status' in value && 'body' in value
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Stubs fetch; unknown paths answer 404 with an ErrorDetail. Returns the requests seen. */
export function stubApi(routes: Routes): SeenRequest[] {
  const seen: SeenRequest[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET' })
    const path = decodeURIComponent(url.split('?')[0] ?? url)
    const hit = routes[path]
    if (hit === undefined) return json({ detail: `no route ${path}` }, 404)
    return isAnswer(hit) ? json(hit.body, hit.status) : json(hit, 200)
  })
  return seen
}

export function makeActions(overrides: Partial<PanelActions> = {}): PanelActions {
  return { panelId: TEST_PANEL, related: () => false, back: () => false, forward: () => false, open: () => false, ...overrides }
}

/** Renders a screen as a panel would: query client (no retries), panel actions, Number <GO>. */
export function mountScreen(node: ReactNode, actions: PanelActions = makeActions()): RenderResult {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <PanelActionsContext value={actions}>
        <NumberingContext value={registerNumbered}>{node}</NumberingContext>
      </PanelActionsContext>
    </ApiProvider>,
  )
}
