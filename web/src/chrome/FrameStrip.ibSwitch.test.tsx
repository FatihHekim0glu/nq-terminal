// @vitest-environment jsdom
// The read-only IB snapshot switch in Options (O10; desktop app only): a native button with role=switch, checked as
// this session's value, described by its note, asking the app for the other value on a click (the app confirms in its
// own dialog and applies it at the next start), with a polite status line; absent outside the desktop app.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from '../bridge'
import { fakeBridge } from '../bridge/bridge.testUtil'
import { FRAME_STRIP } from '../copy/chrome'
import { IB_SWITCH } from '../copy/ibSwitch'
import { setIbSnapshotLive } from '../screens/live/ib/ibLiveStore'
import { FrameStrip } from './FrameStrip'

// The switch asks the shell by navigating, which jsdom cannot do, so the request is spied on (the addresses are
// tested in bridge/ibSwitch.test.ts).
const requestIbSwitch = vi.hoisted(() => vi.fn())
vi.mock('../bridge/ibSwitch', () => ({ requestIbSwitch }))

afterEach(() => {
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
    <FrameStrip
      screen="HOME"
      tapeOn={false}
      scheme="standard"
      onOpen={noop}
      onNew={noop}
      onTape={noop}
      onScheme={noop}
      onDemo={noop}
    />,
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
    expect(document.getElementById(on.getAttribute('aria-describedby') ?? '')?.textContent).toBe(IB_SWITCH.noteOn)
  })

  it('says an attached backend reading TWS follows its own setting when the app has it off, and only then', async () => {
    await open(false)
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    const noteOf = () => document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent
    expect(noteOf()).toBe(IB_SWITCH.noteOff)
    act(() => setIbSnapshotLive(true))
    expect(noteOf()).toBe(IB_SWITCH.noteOffAttached)
    expect(noteOf()).toMatch(/attached, not started by this app/)
    expect(noteOf()).not.toMatch(/Off in this session/)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => setIbSnapshotLive(false))
    expect(noteOf()).toBe(IB_SWITCH.noteOff)
  })

  it('keeps the on note when the app has it on, whatever the snapshot does', async () => {
    await open(true)
    act(() => setIbSnapshotLive(true))
    const sw = screen.getByRole('switch', { name: IB_SWITCH.label })
    expect(document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent).toBe(IB_SWITCH.noteOn)
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

  it('is not there outside the desktop app', async () => {
    await open(null)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(IB_SWITCH.label)).toBeNull()
  })
})
