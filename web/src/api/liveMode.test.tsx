// @vitest-environment jsdom
// The live stream's mode as the shell's polling decisions see it (SHELL-DIET). The stream client
// (liveStream.ts, useLiveStream.ts) loads with LIVE and JRNL; the live hooks in queries.ts poll or not by
// this one mode, which the hub writes on every change of state.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { pollIntervalFor as pollIntervalFromStream, type StreamMode } from './liveStream'
import { pollIntervalFor, setStreamMode, useLivePollInterval } from './liveMode'
import { LIVE_POLL_MS } from './queryKey'

function Probe() {
  return <p>{String(useLivePollInterval())}</p>
}

afterEach(() => {
  cleanup()
  act(() => setStreamMode('off'))
})

describe('pollIntervalFor', () => {
  it.each<[StreamMode, number | false]>([
    ['off', 2000],
    ['polling', 2000],
    ['connecting', false],
    ['open', false],
    ['reconnecting', false],
  ])('%s gives %s', (mode, expected) => {
    expect(pollIntervalFor(mode, 2000)).toBe(expected)
  })

  it('is the same function liveStream.ts exports, so the stream tests and the shell agree', () => {
    expect(pollIntervalFromStream).toBe(pollIntervalFor)
  })
})

describe('useLivePollInterval', () => {
  it('polls at the P0 interval while no stream has been opened', () => {
    render(<Probe />)
    expect(screen.getByText(String(LIVE_POLL_MS))).toBeTruthy()
  })

  it('stops polling while the stream is open or on its way, and polls again when it falls back', () => {
    render(<Probe />)
    act(() => setStreamMode('connecting'))
    expect(screen.getByText('false')).toBeTruthy()
    act(() => setStreamMode('open'))
    expect(screen.getByText('false')).toBeTruthy()
    act(() => setStreamMode('polling'))
    expect(screen.getByText(String(LIVE_POLL_MS))).toBeTruthy()
    act(() => setStreamMode('off'))
    expect(screen.getByText(String(LIVE_POLL_MS))).toBeTruthy()
  })

  it('renders again on a change of mode only, never on the same mode written twice', () => {
    let renders = 0
    function Counter() {
      useLivePollInterval()
      renders += 1
      return null
    }
    render(<Counter />)
    const first = renders
    act(() => setStreamMode('open'))
    const afterOpen = renders
    expect(afterOpen).toBeGreaterThan(first)
    act(() => setStreamMode('open'))
    act(() => setStreamMode('open'))
    expect(renders).toBe(afterOpen)
  })
})
