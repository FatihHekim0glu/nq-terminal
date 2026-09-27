// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onceLoader, useChartLibrary } from './lazy'

afterEach(cleanup)

describe('onceLoader', () => {
  it('loads once and shares the promise', async () => {
    const load = vi.fn(() => Promise.resolve('lib'))
    const get = onceLoader(load)
    expect(await Promise.all([get(), get()])).toEqual(['lib', 'lib'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so the next call retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('lib')
    const get = onceLoader(load as () => Promise<string>)
    await expect(get()).rejects.toThrow('offline')
    await expect(get()).resolves.toBe('lib')
    expect(load).toHaveBeenCalledTimes(2)
  })
})

function Probe({ load }: { readonly load: () => Promise<string> }) {
  const state = useChartLibrary(load)
  return (
    <div aria-busy={state.status === 'loading'} data-testid="chart">
      {state.status === 'ready' ? state.lib : state.status === 'error' ? state.error.message : 'loading'}
    </div>
  )
}

describe('useChartLibrary', () => {
  it('is busy while loading, then gives the library', async () => {
    let resolve: (v: string) => void = () => undefined
    const pending = new Promise<string>((r) => {
      resolve = r
    })
    const load = () => pending
    render(<Probe load={load} />)
    expect(screen.getByTestId('chart').getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      resolve('uPlot')
      await pending
    })
    expect(screen.getByTestId('chart').textContent).toBe('uPlot')
    expect(screen.getByTestId('chart').getAttribute('aria-busy')).toBe('false')
  })

  it('reports a failed load', async () => {
    const failed = Promise.reject(new Error('chunk failed'))
    failed.catch(() => undefined)
    const load = () => failed
    render(<Probe load={load} />)
    await act(async () => {
      await failed.catch(() => undefined)
    })
    expect(screen.getByTestId('chart').textContent).toBe('chunk failed')
  })
})
