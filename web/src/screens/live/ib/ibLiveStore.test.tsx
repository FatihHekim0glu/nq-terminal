// @vitest-environment jsdom
// The shell's view of the snapshot: one boolean, false unless the LIVE panel has just proved the snapshot fresh.
// The status line reads it, so the TWS segment says "read-only snapshot" only while that is true.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { IB_STATUS_BAR } from '../../../copy/ibStatus'
import { STATUS_BAR } from '../../../copy/chrome'
import { setIbSnapshotLive, twsSegmentValue, useIbSnapshotLive } from './ibLiveStore'

afterEach(() => {
  cleanup()
  act(() => setIbSnapshotLive(false))
})

function Probe() {
  return <p data-testid="tws">{twsSegmentValue(useIbSnapshotLive())}</p>
}

describe('ibLiveStore', () => {
  it('starts as not monitored', () => {
    render(<Probe />)
    expect(screen.getByTestId('tws').textContent).toBe(STATUS_BAR.twsValue)
  })

  it('says read-only snapshot only while the snapshot is live', () => {
    render(<Probe />)
    act(() => setIbSnapshotLive(true))
    expect(screen.getByTestId('tws').textContent).toBe(IB_STATUS_BAR.twsLive)
    act(() => setIbSnapshotLive(false))
    expect(screen.getByTestId('tws').textContent).toBe(STATUS_BAR.twsValue)
  })

  it('twsSegmentValue maps the two states', () => {
    expect(twsSegmentValue(false)).toBe('not monitored')
    expect(twsSegmentValue(true)).toBe('read-only snapshot')
  })
})
