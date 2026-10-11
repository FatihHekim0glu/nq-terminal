// @vitest-environment jsdom
// The read-only IB snapshot switch in Options (O10; desktop app only): a native button with role=switch, checked as
// this session's value, described by its note, asking the app for the other value on a click (the app confirms in its
// own dialog and applies it at the next start), with a polite status line; absent outside the desktop app. While the
// switch is off the note also follows the backend's own state: one read of GET /api/ib/snapshot when Options opens.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { installBridge } from '../bridge'
import { fakeBridge } from '../bridge/bridge.testUtil'
import { FRAME_STRIP } from '../copy/chrome'
import { IB_SWITCH } from '../copy/ibSwitch'
import { setIbSnapshotLive } from '../screens/live/ib/ibLiveStore'
import {
  DISABLED_SNAPSHOT,
  LIVE_SNAPSHOT,
  REFUSED_SNAPSHOT,
  UNAVAILABLE_SNAPSHOT,
} from '../screens/live/ib/ibSnapshot.fixtures'
import { FrameStrip } from './FrameStrip'

// The switch asks the shell by navigating, which jsdom cannot do, so the request is spied on (the addresses are
// tested in bridge/ibSwitch.test.ts).
const requestIbSwitch = vi.hoisted(() => vi.fn())
vi.mock('../bridge/ibSwitch', () => ({ requestIbSwitch }))

// The backend's answer to GET /api/ib/snapshot: the server's own "IB not set" body unless a test says otherwise.
const fetchSpy = vi.fn()
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fresh = () => ({ ...LIVE_SNAPSHOT, fetched_at_utc: new Date().toISOString() })
const ibRequests = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/ib/snapshot'))
const noteOf = (sw: HTMLElement) => document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async () => json(DISABLED_SNAPSHOT))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => setIbSnapshotLive(false))
  requestIbSwitch.mockClear()
  cleanup()
  installBridge(null)
})

// The switch is a chunk of its own, loaded when Options opens (it keeps the bridge out of the shell), so the test
// loads it first and then lets the lazy boundary settle.
async function open(ibSnapshot: boolean | null) {
  await import('./IbSwitch')
  installBridge(fakeBridge({ ibSnapshot }))
  const noop = () => undefined
  render(
    <ApiProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FrameStrip
        screen="HOME"
        tapeOn={false}
        scheme="standard"
        onOpen={noop}
        onNew={noop}
        onTape={noop}
        onScheme={noop}
        onDemo={noop}
      />
    </ApiProvider>,
  )
  const options = screen.getByRole('button', { name: FRAME_STRIP.options })
  fireEvent.click(options)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { options }
}

// The status line is cleared and set again on the next tick (so a polite live region announces every click).
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80))
  })
}

describe('the IB snapshot switch in Options', () => {
  it('is a switch named by its visible text, checked as this session is', async () => {
    await open(false)
    const off = screen.getByRole('switch', { name: IB_SWITCH.label })
    expect(off.tagName).toBe('BUTTON')
    expect(off.textContent).toBe('IB snapshot (read only)')
    expect(off.getAttribute('aria-checked')).toBe('false')
    cleanup()
    installBridge(null)
    await open(true)
    expect(screen.getByRole('switch', { name: IB_SWITCH.label }).getAttribute('aria-checked')).toBe('true')
  })

  it('is described by its note, which says the state in words and when a change applies', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const note = document.getElementById(sw.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe(IB_SWITCH.noteOff)
    expect(note?.textContent).toMatch(/^Off in this session\..*next starts.*no order path/)
    cleanup()
    installBridge(null)
    await open(true)
    const on = screen.getByRole('switch', { name: IB_SWITCH.label })
    expect(noteOf(on)).toBe(IB_SWITCH.noteOn)
  })

  it('says an attached backend reading TWS follows its own setting when the app has it off, and only then', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    expect(noteOf(sw)).toBe(IB_SWITCH.noteOff)
    act(() => setIbSnapshotLive(true))
    expect(noteOf(sw)).toBe(IB_SWITCH.noteOffAttached)
    expect(noteOf(sw)).toMatch(/attached, not started by this app/)
    expect(noteOf(sw)).not.toMatch(/Off in this session/)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => setIbSnapshotLive(false))
    expect(noteOf(sw)).toBe(IB_SWITCH.noteOff)
  })

  it('keeps the on note when the app has it on, whatever the snapshot does', async () => {
    await open(true)
    act(() => setIbSnapshotLive(true))
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    expect(noteOf(sw)).toBe(IB_SWITCH.noteOn)
  })

  it('says an attached backend is reading TWS when it answers a fresh snapshot, although LIVE never mounted', async () => {
    fetchSpy.mockImplementation(async () => json(fresh()))
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    await waitFor(() => expect(noteOf(sw)).toBe(IB_SWITCH.noteOffAttached))
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(ibRequests()).toHaveLength(1)
  })

  it('asks once while Options is open and does not poll', async () => {
    fetchSpy.mockImplementation(async () => json(fresh()))
    await open(false)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(ibRequests()).toHaveLength(1)
  })

  it.each([
    ['IB not set (disabled)', DISABLED_SNAPSHOT],
    ['no TWS answered (unavailable)', UNAVAILABLE_SNAPSHOT],
    ['a guard refused the read', REFUSED_SNAPSHOT],
    ['an ok body the backend served from a cache 2 minutes old', { ...LIVE_SNAPSHOT, cached: true, age_s: 120 }],
    ['a body of the wrong shape', { hello: 'world' }],
  ])('keeps the off note when the backend answers %s', async (_name, body) => {
    fetchSpy.mockImplementation(async () => json(body))
    await open(false)
    await waitFor(() => expect(ibRequests()).toHaveLength(1))
    await settle()
    expect(noteOf(screen.getByRole('switch', { name: IB_SWITCH.label }))).toBe(IB_SWITCH.noteOff)
  })

  it('keeps the off note when the request fails with an error status or does not reach the backend', async () => {
    fetchSpy.mockImplementation(async () => json({ detail: 'broke' }, 500))
    await open(false)
    await waitFor(() => expect(ibRequests()).toHaveLength(1))
    await settle()
    expect(noteOf(screen.getByRole('switch', { name: IB_SWITCH.label }))).toBe(IB_SWITCH.noteOff)
    cleanup()
    installBridge(null)
    fetchSpy.mockClear()
    fetchSpy.mockImplementation(async () => {
      throw new TypeError('network down')
    })
    await open(false)
    await waitFor(() => expect(ibRequests()).toHaveLength(1))
    await settle()
    expect(noteOf(screen.getByRole('switch', { name: IB_SWITCH.label }))).toBe(IB_SWITCH.noteOff)
  })

  it('makes no request when the switch is on, whatever the backend would answer', async () => {
    fetchSpy.mockImplementation(async () => json(fresh()))
    await open(true)
    await settle()
    expect(ibRequests()).toHaveLength(0)
    expect(noteOf(screen.getByRole('switch', { name: IB_SWITCH.label }))).toBe(IB_SWITCH.noteOn)
  })

  it('asks the app for the other value and says where the answer is asked, without changing its own state', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const status = screen.getAllByRole('status').find((s) => s.classList.contains('frame-ib-note'))
    expect(status?.textContent).toBe('')
    fireEvent.click(sw)
    expect(requestIbSwitch).toHaveBeenCalledTimes(1)
    expect(requestIbSwitch).toHaveBeenCalledWith(true)
    await settle()
    expect(status?.textContent).toBe(IB_SWITCH.asked)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('re-announces the asking line on every click, by clearing it first', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const status = screen.getAllByRole('status').find((s) => s.classList.contains('frame-ib-note'))
    fireEvent.click(sw)
    await settle()
    expect(status?.textContent).toBe(IB_SWITCH.asked)
    fireEvent.click(sw)
    expect(status?.textContent).toBe('')
    await settle()
    expect(status?.textContent).toBe(IB_SWITCH.asked)
    expect(requestIbSwitch).toHaveBeenCalledTimes(2)
  })

  it('replaces the asking line with a neutral line once the window regains focus, and not before', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const status = screen.getAllByRole('status').find((s) => s.classList.contains('frame-ib-note'))
    fireEvent.focus(window)
    expect(status?.textContent).toBe('')
    fireEvent.click(sw)
    await settle()
    expect(status?.textContent).toBe(IB_SWITCH.asked)
    fireEvent.focus(window)
    expect(status?.textContent).toBe(IB_SWITCH.answered)
    expect(status?.textContent).not.toMatch(/Answer the app/)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('asks again and announces again after the neutral line', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const status = screen.getAllByRole('status').find((s) => s.classList.contains('frame-ib-note'))
    fireEvent.click(sw)
    await settle()
    fireEvent.focus(window)
    fireEvent.click(sw)
    expect(status?.textContent).toBe('')
    await settle()
    expect(status?.textContent).toBe(IB_SWITCH.asked)
  })

  it('asks for off when this session has it on', async () => {
    await open(true)
    fireEvent.click(screen.getByRole('switch', { name: IB_SWITCH.label }))
    expect(requestIbSwitch).toHaveBeenCalledWith(false)
  })

  it('Escape on the switch closes Options and gives the focus back to the Options button', async () => {
    const { options } = await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    sw.focus()
    fireEvent.keyDown(sw, { key: 'Escape' })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(options.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(options)
  })

  it('is not there outside the desktop app, and asks the backend nothing', async () => {
    await open(null)
    await settle()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(IB_SWITCH.label)).toBeNull()
    expect(ibRequests()).toHaveLength(0)
  })
})
