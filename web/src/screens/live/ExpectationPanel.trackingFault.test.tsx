// @vitest-environment jsdom
// A failed GET /api/analytics/paper-tracking is announced once. LV5 (TrackingPanel) reads the same query and
// already renders a role=alert; LV6 reads it too, and words it as a refusal (the served expectation fails with it,
// since it is built from the same journal) and leaves the alert to LV5. The expectation read alone still alerts.
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { liveStreamHub } from '../../api/useLiveStream'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { TRACKING } from '../../copy/tracking'
import { fillCopy } from '../../copy/workspace'
import { stubLayout } from '../../grids/testing'
import ExpectationPanel from './ExpectationPanel'
import { DISABLED_SNAPSHOT } from './ib/ibSnapshot.fixtures'
import { BOOK_CLOSE_ROWS, ROUTES_BODY, page, performance, status } from './liveFixtures'
import LiveScreen from './LiveScreen'
import { TRACKING_POPULATED } from './trackingFixtures'

vi.mock('../../charts/echarts/Cone', () => ({
  Cone: ({ data, chartId }: { data: ConeInput; chartId: string }) => <div data-testid="cone" data-chart-id={chartId}>{data.name}</div>,
}))

vi.mock('../../charts/LineStack', () => ({
  default: () => <div data-testid="linestack" />,
}))

const TRACKING_URL = '/api/analytics/paper-tracking'
const EXPECTATION_URL = '/api/analytics/paper-expectation'
const DETAIL = 'live folder unreadable'

function json(body: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'content-type': 'application/json' } })
}

/** The LiveScreen.test.tsx routes, with the paper tracking answering 500 (or `trackingStatus`). */
function serveWithTrackingFault(trackingStatus = 500): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith(TRACKING_URL)) return json({ detail: DETAIL }, trackingStatus)
    if (url.startsWith('/api/live/status')) return json(status())
    if (url.startsWith('/api/live/performance')) return json(performance())
    if (url.startsWith('/api/live/journal')) return json(page(BOOK_CLOSE_ROWS))
    if (url.startsWith('/api/live/routes')) return json(ROUTES_BODY)
    if (url === '/api/ib/snapshot') return json(DISABLED_SNAPSHOT)
    if (url.startsWith(EXPECTATION_URL)) return json({ detail: DETAIL }, 503)
    return json({ detail: 'unexpected' }, 404)
  })
}

function withClient(node: ReactNode) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(<ApiProvider client={client}>{node}</ApiProvider>)
}

beforeEach(() => stubLayout(600))
afterEach(() => {
  cleanup()
  liveStreamHub.reset()
  vi.restoreAllMocks()
})

describe('LV6 when the paper tracking read fails', () => {
  it('says so in words, inside its own section, with no role=alert', async () => {
    serveWithTrackingFault()
    withClient(<ExpectationPanel />)
    const section = screen.getByRole('region', { name: EXPECTATION.label })
    await waitFor(() => expect(section.textContent).toContain(EXPECTATION.noTracking))
    expect(within(section).queryAllByRole('alert')).toEqual([])
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(screen.queryByTestId('cone')).toBeNull()
  })

  it('does not repeat the API detail that LV5 already shows', async () => {
    serveWithTrackingFault()
    withClient(<ExpectationPanel />)
    const section = screen.getByRole('region', { name: EXPECTATION.label })
    await waitFor(() => expect(section.textContent).toContain(EXPECTATION.noTracking))
    expect(section.textContent).not.toContain(DETAIL)
  })

  it('leaves the page with exactly one alert, the paper tracking panel one', async () => {
    serveWithTrackingFault()
    withClient(<LiveScreen params={{ code: 'LIVE', context: null, args: {}, group: '-' }} context={null} />)
    const tracking = await screen.findByRole('region', { name: TRACKING.label })
    await waitFor(() => expect(within(tracking).getByRole('alert').textContent).toBe(fillCopy(TRACKING.failed, { detail: DETAIL })))
    const expectation = screen.getByRole('region', { name: EXPECTATION.label })
    await waitFor(() => expect(expectation.textContent).toContain(EXPECTATION.noTracking))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(within(expectation).queryAllByRole('alert')).toEqual([])
  })
})

describe('LV6 keeps its own alert for the reads only it makes', () => {
  it('still raises one alert for a failed expectation read', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith(TRACKING_URL)) return json(TRACKING_POPULATED)
      if (url.startsWith(EXPECTATION_URL)) return json({ detail: 'view unreadable' }, 503)
      return json({ detail: 'unexpected' }, 404)
    })
    withClient(<ExpectationPanel />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'view unreadable' }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
