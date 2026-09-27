// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OFF_SNAPSHOT, type StreamSnapshot } from '../../api/liveStream'
import { STREAM } from '../../copy/liveStream'
import { StreamStateView, streamItems } from './StreamState'

const at = Date.UTC(2026, 8, 28, 18, 2, 11)
const open: StreamSnapshot = { ...OFF_SNAPSHOT, mode: 'open', lastEventAt: at, heartbeatS: 10, resumed: true, rows: 12 }

afterEach(cleanup)

describe('streamItems', () => {
  it('names the open stream, the last event in ET and the rows it carried', () => {
    const items = streamItems(open, 2000)
    expect(items.map((i) => [i.key, i.value])).toEqual([
      ['mode', STREAM.modes.open],
      ['lastEvent', '14:02:11 ET'],
      ['rows', '12'],
      ['resumed', STREAM.resumedYes],
    ])
    expect(items[0]!.tone).toBe('up')
  })

  it('says it polls, how often and why, in words and a warning tone', () => {
    const items = streamItems({ ...OFF_SNAPSHOT, mode: 'polling', reason: 'refused', attempt: 1 }, 2000)
    expect(items[0]).toMatchObject({ key: 'mode', value: 'polling every 2 s', tone: 'warn' })
    expect(items.find((i) => i.key === 'reason')?.value).toBe(STREAM.reasons.refused)
    expect(items.find((i) => i.key === 'lastEvent')?.value).toBe('--')
  })

  it('says why it reconnects', () => {
    const items = streamItems({ ...open, mode: 'reconnecting', reason: 'bye' }, 2000)
    expect(items[0]).toMatchObject({ value: STREAM.modes.reconnecting, tone: 'warn' })
    expect(items.find((i) => i.key === 'reason')?.value).toBe(STREAM.reasons.bye)
  })

  it('carries the server note when it did not resume', () => {
    const items = streamItems({ ...open, resumed: false, resumeNote: 'Last-Event-ID not recognised (bad digest)' }, 2000)
    expect(items.find((i) => i.key === 'resumed')?.value).toBe(`${STREAM.resumedNo}: Last-Event-ID not recognised (bad digest)`)
  })
})

describe('StreamStateView', () => {
  it('announces the mode politely and keeps the ticking time out of the live region', () => {
    render(<StreamStateView state={open} pollMs={2000} />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe(STREAM.modes.open)
    expect(screen.getByRole('group', { name: STREAM.label }).textContent).toContain('14:02:11 ET')
  })

  it('shows nothing while the stream is off', () => {
    const { container } = render(<StreamStateView state={OFF_SNAPSHOT} pollMs={2000} />)
    expect(container.textContent).toBe('')
  })
})
