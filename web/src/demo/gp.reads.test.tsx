// @vitest-environment jsdom
// Every read GP makes on a daily chart is answered by the demo. GP's data hook (screens/gp/useGpData.ts) asks the bars,
// the catalog, the RV22 line, the run list and, for the RV22 header, GET /api/market/universe?window=22. HOME opens GP,
// so a refusal there was a refused read (a red console line) on every page of the demo.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../api/queries'
import { rangeWindow } from '../screens/gp/model'
import { RV_WINDOW, useGpData, type GpRequest } from '../screens/gp/useGpData'
import { createDemoFetch } from './fetch'

// The demo answers after a seeded 20 to 120 ms; a failing read should fail on its assertion, not on the test clock.
vi.setConfig({ testTimeout: 10_000 })

interface Read {
  readonly path: string
  readonly status: number
}

// Each test gets its own array: a read still in flight from an earlier test lands in that test's log, not in this one's.
let reads: Read[] = []

beforeEach(() => {
  const log: Read[] = []
  reads = log
  const demo = createDemoFetch({ passThrough: vi.fn(), origin: window.location.origin })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await demo(input, init)
    log.push({ path: new URL(String(input), window.location.origin).pathname, status: response.status })
    return response
  })
})
// vite.config.ts sets no test globals, so Testing Library registers no automatic cleanup: unmount the hooks here.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NQ_1Y: GpRequest = { root: 'NQ', symbol: 'NQ.V.0', tf: '1d', variant: 'vendor', window: rangeWindow('1Y'), runId: null }

function open(req: GpRequest) {
  const client = createApiQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useGpData(req), { wrapper })
}

describe('GP against the demo dataset', () => {
  it('asks the universe at the RV window and gets the RV22 header rows for it', async () => {
    const { result } = open(NQ_1Y)
    await waitFor(() => expect(result.current.universeRows).toBeDefined(), { timeout: 3000 })
    const rows = result.current.universeRows ?? []
    expect(rows).toHaveLength(27)
    expect(rows.find((r) => r.symbol === 'NQ.V.0')?.realised_vol).toBeGreaterThan(0)
    expect(reads.some((r) => r.path === '/api/market/universe' && r.status === 200)).toBe(true)
    expect(RV_WINDOW).toBe(22)
  })

  it('reads the RV22 header and the RV22 line from one number', async () => {
    const { result } = open(NQ_1Y)
    await waitFor(() => expect(result.current.universeRows && result.current.rv).toBeTruthy(), { timeout: 3000 })
    const header = result.current.universeRows?.find((r) => r.symbol === 'NQ.V.0')?.realised_vol
    expect(header).toBe(result.current.rv?.last)
  })

  it('has no refused read once bars, catalog, RV22, universe and runs have all answered', async () => {
    const { result } = open(NQ_1Y)
    await waitFor(() => {
      expect(result.current.bars).toBeDefined()
      expect(result.current.universeRows).toBeDefined()
      expect(result.current.rv).toBeDefined()
      expect(result.current.runs.length).toBeGreaterThan(0)
    }, { timeout: 3000 })
    const paths = new Set(reads.map((r) => r.path))
    for (const path of ['/api/bars', '/api/data/catalog', '/api/market/universe', '/api/market/rv', '/api/runs']) expect(paths, path).toContain(path)
    expect(reads.filter((r) => r.status !== 200)).toEqual([])
  })
})
