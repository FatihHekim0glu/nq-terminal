// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveText } from './download'

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
afterEach(() => {
  Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke })
  vi.restoreAllMocks()
})

describe('saveText: 98) Export as a local download', () => {
  it('clicks a download link for a local object URL, revokes it and reports success', () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(saveText('a.csv', 'x,y')).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })

  it('reports failure where the browser has no object URLs', () => {
    Object.assign(URL, { createObjectURL: undefined })
    expect(saveText('a.csv', 'x,y')).toBe(false)
  })

  it('born failing: reports failure, never throws, when making the object URL fails', () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') }, revokeObjectURL: vi.fn() })
    expect(saveText('a.csv', 'x,y')).toBe(false)
  })
})
