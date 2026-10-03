// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDownloads } from './download.testUtil'
import { EXPORT } from '../copy/panelParts'
import type { SaveOutcome, SaveResult } from '../bridge'
import { resetMessage, useMessage } from './MessageLine.store'
import { saveBlob, saveText, sayWhenSaved } from './download'

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
    expect(saveText('a.csv', 'x,y').started).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })

  it('reports failure where the browser has no object URLs', () => {
    Object.assign(URL, { createObjectURL: undefined })
    expect(saveText('a.csv', 'x,y').started).toBe(false)
  })

  it('born failing: reports failure, never throws, when making the object URL fails', () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') }, revokeObjectURL: vi.fn() })
    expect(saveText('a.csv', 'x,y').started).toBe(false)
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
    expect(saveBlob('EQ_20260928-180211Z.png', PNG).started).toBe(true)
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
      expect(saveBlob('a.png', PNG).started).toBe(true)
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
    expect(saveBlob('a.png', PNG).started).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it('reports failure, never throws, when making the object URL fails', () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') }, revokeObjectURL: vi.fn() })
    expect(saveBlob('a.png', PNG).started).toBe(false)
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
      expect(saveText('a.csv', 'x,y').started).toBe(true)
      expect(await capture.text('a.csv')).toBe('x,y')
      expect(capture.files[0]?.blob.type).toBe('text/csv;charset=utf-8')
    } finally {
      capture.restore()
    }
  })
})

describe('sayWhenSaved: the message follows how the save ended', () => {
  const ended = (outcome: SaveOutcome): SaveResult => Object.assign(Promise.resolve(outcome), { started: true })
  const TEXT = { saved: 'Saved a.csv.', unavailable: 'No save here.' }

  afterEach(() => resetMessage())

  it('born failing: a cancelled save posts the cancelled line and never the saved one', async () => {
    expect(await sayWhenSaved(ended('cancelled'), TEXT)).toBe(false)
    expect(useMessage.getState().text).toBe(EXPORT.cancelled)
    expect(useMessage.getState().tone).toBe('info')
  })

  it('born failing: a failed save posts the failure as an error', async () => {
    expect(await sayWhenSaved(ended('failed'), TEXT)).toBe(false)
    expect(useMessage.getState().text).toBe(EXPORT.failed)
    expect(useMessage.getState().tone).toBe('error')
  })

  it('born failing: a rejecting save is a failure, never an unhandled rejection', async () => {
    const rejecting = Object.assign(Promise.reject(new Error('shell gone')), { started: true }) as SaveResult
    expect(await sayWhenSaved(rejecting, TEXT)).toBe(false)
    expect(useMessage.getState().text).toBe(EXPORT.failed)
  })

  it('says saved only when the save ended saved', async () => {
    expect(await sayWhenSaved(ended('saved'), TEXT)).toBe(true)
    expect(useMessage.getState().text).toBe(TEXT.saved)
  })

  it('says unavailable at once, before any await, when the save did not start', () => {
    const none = Object.assign(Promise.resolve('failed' as const), { started: false }) as SaveResult
    void sayWhenSaved(none, TEXT)
    expect(useMessage.getState().text).toBe(TEXT.unavailable)
    expect(useMessage.getState().tone).toBe('error')
  })
})
