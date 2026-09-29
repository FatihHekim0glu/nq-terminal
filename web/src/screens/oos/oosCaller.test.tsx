// @vitest-environment jsdom
// U07: the DES link 'Gate reads (OOS) for this hypothesis' hands a caller to OOS. The hand-over is one small
// module: DES asks for a caller on ITS OWN panel (requestOosCaller(caller, panelId)), and the OOS screen that
// opens in that panel, or is already open in it, takes the caller once (useOosCallerRequest(panelId, apply))
// and starts on that caller's reads. An OOS open in another panel never takes it, and a request nobody takes
// within 10 s is dropped. '' is the panel id outside a workspace. It is read only; nothing is fetched here.
import { StrictMode, useState } from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OOS_CALLER_TTL_MS, requestOosCaller, resetOosCaller, useOosCallerRequest } from './oosCaller'

beforeEach(() => resetOosCaller())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the OOS caller hand-over', () => {
  it('gives an OOS screen that opens after the request the caller, once', () => {
    requestOosCaller('volmanaged_v0', '')
    const apply = vi.fn()
    const first = renderHook(() => useOosCallerRequest('', apply))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('volmanaged_v0')
    first.unmount()
    // Taken: the next OOS to open starts unfiltered.
    const later = vi.fn()
    renderHook(() => useOosCallerRequest('', later))
    expect(later).not.toHaveBeenCalled()
  })

  it('gives an OOS screen that is already open the caller the moment it is asked for', () => {
    const apply = vi.fn()
    renderHook(() => useOosCallerRequest('', apply))
    expect(apply).not.toHaveBeenCalled()
    act(() => requestOosCaller('za_v0', ''))
    expect(apply).toHaveBeenCalledWith('za_v0')
    act(() => requestOosCaller('tom_v0', ''))
    expect(apply).toHaveBeenLastCalledWith('tom_v0')
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('ignores an empty or blank caller and trims the rest', () => {
    const apply = vi.fn()
    renderHook(() => useOosCallerRequest('', apply))
    act(() => requestOosCaller('', ''))
    act(() => requestOosCaller('   ', ''))
    expect(apply).not.toHaveBeenCalled()
    act(() => requestOosCaller('  za_v0 ', ''))
    expect(apply).toHaveBeenCalledWith('za_v0')
  })

  it('stops listening once the screen is gone, so a closed panel never takes the caller', () => {
    const apply = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', apply)).unmount()
    act(() => requestOosCaller('za_v0', 'p-des'))
    expect(apply).not.toHaveBeenCalled()
    // and it waits for the next screen in that panel
    const next = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', next))
    expect(next).toHaveBeenCalledWith('za_v0')
  })

  it('survives React strict mode: the caller reaches the screen once, not lost and not doubled', () => {
    requestOosCaller('volmanaged_v0', '')
    function Screen() {
      const [caller, setCaller] = useState('')
      useOosCallerRequest('', setCaller)
      return <p data-testid="caller">{caller}</p>
    }
    render(<StrictMode><Screen /></StrictMode>)
    expect(screen.getByTestId('caller').textContent).toBe('volmanaged_v0')
  })

  it('lets only one of two open OOS screens in the same panel take a request', () => {
    const a = vi.fn()
    const b = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', a))
    renderHook(() => useOosCallerRequest('p-des', b))
    act(() => requestOosCaller('za_v0', 'p-des'))
    expect(a.mock.calls.length + b.mock.calls.length).toBe(1)
  })
})

describe('the OOS caller hand-over is scoped to the panel that asked', () => {
  it('an OOS open in another panel does not take a request meant for the DES panel', () => {
    const a = vi.fn()
    renderHook(() => useOosCallerRequest('p-other', a))
    act(() => requestOosCaller('za_v0', 'p-des'))
    expect(a).not.toHaveBeenCalled()
    // The panel the request was meant for opens OOS next and gets it, once.
    const b = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', b))
    expect(b).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith('za_v0')
    // The other panel is still untouched, even if it mounts again.
    renderHook(() => useOosCallerRequest('p-other', a))
    expect(a).not.toHaveBeenCalled()
  })

  it('an OOS already open in the panel that asked takes the request at once', () => {
    const other = vi.fn()
    const own = vi.fn()
    renderHook(() => useOosCallerRequest('p-other', other))
    renderHook(() => useOosCallerRequest('p-des', own))
    act(() => requestOosCaller('za_v0', 'p-des'))
    expect(own).toHaveBeenCalledTimes(1)
    expect(own).toHaveBeenCalledWith('za_v0')
    expect(other).not.toHaveBeenCalled()
  })

  it('a panel outside a workspace (\'\') does not take a request for a workspace panel, nor the reverse', () => {
    const outside = vi.fn()
    renderHook(() => useOosCallerRequest('', outside))
    act(() => requestOosCaller('za_v0', 'p-des'))
    expect(outside).not.toHaveBeenCalled()
    resetOosCaller()
    const inside = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', inside))
    act(() => requestOosCaller('za_v0', ''))
    expect(inside).not.toHaveBeenCalled()
  })

  it('a newer request replaces an older one that nobody took', () => {
    requestOosCaller('za_v0', 'p-a')
    requestOosCaller('tom_v0', 'p-b')
    const a = vi.fn()
    const b = vi.fn()
    renderHook(() => useOosCallerRequest('p-a', a))
    renderHook(() => useOosCallerRequest('p-b', b))
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('tom_v0')
  })
})

describe('a request nobody takes does not wait for ever', () => {
  it('a request not taken within 10 s is dropped', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    expect(OOS_CALLER_TTL_MS).toBe(10_000)
    requestOosCaller('za_v0', 'p-des')
    vi.advanceTimersByTime(10_001)
    const late = vi.fn()
    const first = renderHook(() => useOosCallerRequest('p-des', late))
    expect(late).not.toHaveBeenCalled()
    first.unmount()
    // Dropped for good, not merely skipped once: a later plain mount is not called either.
    const plain = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', plain))
    expect(plain).not.toHaveBeenCalled()
  })

  it('a request taken at exactly 10 s still arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    requestOosCaller('za_v0', 'p-des')
    vi.advanceTimersByTime(OOS_CALLER_TTL_MS)
    const apply = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', apply))
    expect(apply).toHaveBeenCalledWith('za_v0')
  })

  it('a request that was taken stays taken: a screen that mounts a minute later gets nothing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    const apply = vi.fn()
    renderHook(() => useOosCallerRequest('p-des', apply))
    requestOosCaller('za_v0', 'p-des')
    expect(apply).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    // Nothing is pending any more, expired or not; a mount in the same panel gets nothing.
    renderHook(() => useOosCallerRequest('p-des', apply))
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
