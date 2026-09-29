// G20: openDes goes through the command line, in place unless the grid asked for a new panel (Shift+Enter).
import { afterEach, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { openDes } from './open'

const lines: LineRequest[] = []
let stop = onLineRequest((r) => lines.push(r))

afterEach(() => {
  lines.length = 0
})

describe('openDes', () => {
  it('requests "<name> DES" in place by default', () => {
    openDes('overnight_v0')
    expect(lines).toEqual([{ line: 'overnight_v0 DES', newPanel: false }])
  })

  it('requests a new panel when the grid says so', () => {
    openDes('overnight_v0', { newPanel: true })
    expect(lines).toEqual([{ line: 'overnight_v0 DES', newPanel: true }])
  })

  it('treats { newPanel: false } as in place', () => {
    openDes('za_v0', { newPanel: false })
    expect(lines).toEqual([{ line: 'za_v0 DES', newPanel: false }])
  })

  it('stops listening when unsubscribed (the harness itself is clean)', () => {
    stop()
    openDes('za_v0')
    expect(lines).toEqual([])
    stop = onLineRequest((r) => lines.push(r))
  })
})
