// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDownloads } from './download.testUtil'
import { saveBlob, saveText } from './download'

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

describe('saveBlob: a chart image saved as a local download', () => {
  const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

  it('clicks a download link named for the file, over an object URL made from that very blob, and revokes it', () => {
    const create = vi.fn(() => 'blob:png')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    let link: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      link = this
    })
    expect(saveBlob('EQ_20260928-180211Z.png', PNG)).toBe(true)
    expect(create).toHaveBeenCalledWith(PNG)
    expect(link).not.toBeNull()
    expect(link!.download).toBe('EQ_20260928-180211Z.png')
    expect(link!.href).toBe('blob:png')
    expect(link!.rel).toBe('noopener')
    expect(revoke).toHaveBeenCalledWith('blob:png')
  })

  it('hands the browser the bytes it was given, with their type', async () => {
    const capture = captureDownloads()
    try {
      expect(saveBlob('a.png', PNG)).toBe(true)
      expect(capture.files.map((f) => f.name)).toEqual(['a.png'])
      expect(capture.files[0]?.blob).toBe(PNG)
      expect(capture.files[0]?.blob.type).toBe('image/png')
    } finally {
      capture.restore()
    }
  })

  it('reports failure where the browser has no object URLs, and clicks nothing', () => {
    Object.assign(URL, { createObjectURL: undefined })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(saveBlob('a.png', PNG)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it('reports failure, never throws, when making the object URL fails', () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') }, revokeObjectURL: vi.fn() })
    expect(saveBlob('a.png', PNG)).toBe(false)
  })

  it('revokes the object URL even when the click throws', () => {
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('refused')
    })
    expect(() => saveBlob('a.png', PNG)).toThrow('refused')
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })

  it('leaves saveText as it was: the same text, type and name reach the same path', async () => {
    const capture = captureDownloads()
    try {
      expect(saveText('a.csv', 'x,y')).toBe(true)
      expect(await capture.text('a.csv')).toBe('x,y')
      expect(capture.files[0]?.blob.type).toBe('text/csv;charset=utf-8')
    } finally {
      capture.restore()
    }
  })
})
