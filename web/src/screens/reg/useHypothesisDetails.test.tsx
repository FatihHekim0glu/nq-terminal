// @vitest-environment jsdom
// useHypothesisDetails (roadmap #5, W1-R5a): one GET per name while enabled, on useHypothesis's own
// query key (shared cache), never a request while disabled.
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useHypothesis } from '../../api/queries'
import { mountScreen, stubApi } from './testHarness'
import { useHypothesisDetails, type HypothesisDetails } from './useHypothesisDetails'

afterEach(() => cleanup())

function Probe({ names, enabled }: { readonly names: readonly string[]; readonly enabled: boolean }) {
  const result: HypothesisDetails = useHypothesisDetails(names, enabled)
  return (
    <div>
      <span data-testid="ok">{[...result.byName.keys()].sort().join(',')}</span>
      <span data-testid="failed">{[...result.failed.entries()].map(([n, d]) => `${n}:${d}`).join('|')}</span>
      <span data-testid="pending">{String(result.pending)}</span>
    </div>
  )
}

function ClientProbe({ onClient }: { readonly onClient: (client: QueryClient) => void }) {
  onClient(useQueryClient())
  return null
}

function CardProbe({ name }: { readonly name: string }) {
  const q = useHypothesis(name)
  return <span data-testid="card">{q.data ? q.data.card.name : ''}</span>
}

describe('useHypothesisDetails', () => {
  it('answers what it can, records a failure for a 404, and finishes with nothing pending', async () => {
    stubApi()
    mountScreen(<Probe names={['overnight_v0', 'volmanaged_v0', 'missing_v0']} enabled />)
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('0'))
    expect(screen.getByTestId('ok').textContent).toBe('overnight_v0,volmanaged_v0')
    expect(screen.getByTestId('failed').textContent).toBe('missing_v0:not found')
  })

  it('makes no request at all while disabled, whatever names it is given', async () => {
    const seen = stubApi()
    mountScreen(<Probe names={['overnight_v0', 'volmanaged_v0']} enabled={false} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toEqual([])
    expect(screen.getByTestId('ok').textContent).toBe('')
  })

  it('builds no query at all while disabled, so nothing is counted as pending or retried', async () => {
    stubApi()
    let client: QueryClient | null = null
    mountScreen(
      <>
        <ClientProbe onClient={(c) => (client = c)} />
        <Probe names={['volmanaged_v0', 'overnight_v0']} enabled={false} />
      </>,
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(client).not.toBeNull()
    expect(client!.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.getByTestId('pending').textContent).toBe('0')
  })

  it('shares its cache entry with useHypothesis: one name asked for by both fetches only once', async () => {
    const seen = stubApi()
    mountScreen(
      <>
        <Probe names={['overnight_v0']} enabled />
        <CardProbe name="overnight_v0" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('card').textContent).toBe('overnight_v0'))
    expect(screen.getByTestId('ok').textContent).toBe('overnight_v0')
    expect(seen.filter((s) => s.url === '/api/hypotheses/overnight_v0')).toHaveLength(1)
  })
})
