// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../api/client'
import { fillCopy } from '../copy/workspace'
import { LINK_COPY, PORTABLE_LINK_COPY } from '../copy/linkCopy'
import { copyLinkEntries, copyPanelLink, hashFor, linkFor, markdownLink } from './copyLink'
import { linesFromHash } from './deepLink'
import { resetMessage, useMessage } from './MessageLine.store'

// Copy link asks /api/health whether the port is fixed (03 4.6). Most of this file is about the browser door on the fixed
// port, so the health read answers port_fixed true unless a test says otherwise.
vi.mock('../api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/client')>()), apiGet: vi.fn() }))
const health = vi.mocked(apiGet)
const answerHealth = (port_fixed: unknown) => health.mockResolvedValue({ port_fixed } as never)

const WHERE = { origin: 'http://127.0.0.1:5184', pathname: '/' }
const URL_OF_GP = 'http://127.0.0.1:5184/#go=NQ%20GP%201d'

beforeEach(() => {
  resetMessage()
  health.mockReset()
  answerHealth(true)
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  resetMessage()
})

const message = () => useMessage.getState()
const line = (text: string, newPanel = false) => ({ line: text, newPanel })

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

describe('building links', () => {
  it('hashFor encodes each line and joins them with &go=', () => {
    expect(hashFor(['NQ GP 1d'])).toBe('#go=NQ%20GP%201d')
    expect(hashFor(['REG', 'LEDG'])).toBe('#go=REG&go=LEDG')
  })

  it('round-trips: what hashFor writes, linesFromHash reads', () => {
    const lines = ['volmanaged_v0 RET', 'NQ GP 1d', 'REG HELP']
    expect(linesFromHash(hashFor(lines))?.map((l) => l.line)).toEqual(lines)
  })

  it('linkFor is origin + pathname + the hash, and never carries the search or the old hash', () => {
    const where = { origin: 'http://127.0.0.1:5184', pathname: '/', search: '?debug=1', hash: '#go=OLD' }
    expect(linkFor(where, 'volmanaged_v0 EQ')).toBe('http://127.0.0.1:5184/#go=volmanaged_v0%20EQ')
    const nested = { origin: 'https://example.test', pathname: '/terminal/', search: '?a=1', hash: '#top' }
    expect(linkFor(nested, 'NQ GP 1d')).toBe('https://example.test/terminal/#go=NQ%20GP%201d')
  })

  it('a link built by linkFor reads back as the same line', () => {
    const url = linkFor({ origin: 'http://h', pathname: '/' }, 'NQ GP 1d')
    expect(linesFromHash(url.slice(url.indexOf('#')))).toEqual([line('NQ GP 1d')])
  })

  it('markdownLink wraps the line and the url as a Markdown link', () => {
    expect(markdownLink('NQ GP 1d', 'http://h/#go=NQ%20GP%201d')).toBe('[NQ GP 1d](http://h/#go=NQ%20GP%201d)')
  })
})

describe('copyPanelLink', () => {
  it('copies the link and says which line it is for', async () => {
    const writeText = vi.fn(async () => {})
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL_OF_GP)
    expect(message().text).toBe('Link to NQ GP 1d copied.')
    expect(message().tone).toBe('info')
  })

  it('copies a Markdown link on request', async () => {
    const writeText = vi.fn(async () => {})
    await copyPanelLink('NQ GP 1d', 'markdown', WHERE, { writeText })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`[NQ GP 1d](${URL_OF_GP})`)
    expect(message().text).toBe('Link to NQ GP 1d copied.')
  })

  it('never carries the search or the old hash of the page it is copied from', async () => {
    const writeText = vi.fn(async () => {})
    const where = { origin: 'https://example.test', pathname: '/terminal/', search: '?debug=1', hash: '#go=OLD' }
    await copyPanelLink('REG', 'url', where, { writeText })
    expect(writeText).toHaveBeenCalledWith('https://example.test/terminal/#go=REG')
  })

  it('shows the link when the browser refuses the clipboard, and says it is an error', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(message().text).toBe(`The browser refused the clipboard. The link is ${URL_OF_GP}`)
    expect(message().tone).toBe('error')
  })

  it('shows the plain link, not the Markdown, when a Markdown copy is refused', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    await copyPanelLink('NQ GP 1d', 'markdown', WHERE, { writeText })
    expect(message().text).toBe(`The browser refused the clipboard. The link is ${URL_OF_GP}`)
  })

  it('shows the link when writeText throws at once instead of rejecting', async () => {
    const writeText = vi.fn(() => {
      throw new TypeError('not a function')
    })
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(message().text).toBe(`The browser refused the clipboard. The link is ${URL_OF_GP}`)
    expect(message().tone).toBe('error')
  })

  it('shows the link when the browser has no clipboard (an insecure page)', async () => {
    await copyPanelLink('NQ GP 1d', 'url', WHERE, undefined)
    expect(message().text).toBe(`The browser refused the clipboard. The link is ${URL_OF_GP}`)
    expect(message().tone).toBe('error')
  })

  it('posts nothing until the write has settled', async () => {
    let finish: () => void = () => {}
    const writeText = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const done = copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(message().text).toBe('')
    // The health read comes first (03 4.6), so the write starts a moment later.
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(message().text).toBe('')
    finish()
    await done
    expect(message().text).toBe('Link to NQ GP 1d copied.')
  })

  it('reads the page address and the navigator clipboard by default', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    await copyPanelLink('REG', 'url')
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}#go=REG`)
  })
})

describe('copyLinkEntries', () => {
  it('offers Copy link and Copy link as Markdown, in that order', () => {
    expect(copyLinkEntries('NQ GP 1d').map((e) => e.label)).toEqual([LINK_COPY.copyLink, LINK_COPY.copyMarkdown])
  })

  it('the first row copies the URL and the second the Markdown link', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    const [url, markdown] = copyLinkEntries('volmanaged_v0 EQ')
    url?.onSelect()
    markdown?.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    const link = `${window.location.origin}${window.location.pathname}#go=volmanaged_v0%20EQ`
    expect(writeText.mock.calls).toEqual([[link], [`[volmanaged_v0 EQ](${link})`]])
  })

  it('a row never throws when the clipboard is missing: it shows the link instead', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    copyLinkEntries('REG')[0]?.onSelect()
    await vi.waitFor(() => expect(message().tone).toBe('error'))
    expect(message().text).toContain('#go=REG')
  })
})

describe('where the port is not fixed (the app, or a browser on the app random port)', () => {
  const BARE = '#go=NQ%20GP%201d'
  const notFixed = () => answerHealth(false)

  it('asks /api/health for port_fixed', async () => {
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText: vi.fn(async () => {}) })
    expect(health).toHaveBeenCalledExactlyOnceWith('/api/health')
  })

  it('copies the bare #go= string, never the address, and the message line says so', async () => {
    notFixed()
    const writeText = vi.fn(async () => {})
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(BARE)
    expect(message().text).toBe(fillCopy(PORTABLE_LINK_COPY.copied, { line: 'NQ GP 1d' }))
    expect(message().text).toContain('#go=')
    expect(message().text).not.toBe('Link to NQ GP 1d copied.')
    expect(message().tone).toBe('info')
  })

  it('the bare string carries no origin, path, search or old hash', async () => {
    notFixed()
    const writeText = vi.fn(async () => {})
    const where = { origin: 'http://127.0.0.1:51234', pathname: '/terminal/', search: '?a=1', hash: '#go=OLD' }
    await copyPanelLink('REG', 'url', where, { writeText })
    expect(writeText).toHaveBeenCalledWith('#go=REG')
  })

  it('a Markdown copy points at the bare string', async () => {
    notFixed()
    const writeText = vi.fn(async () => {})
    await copyPanelLink('NQ GP 1d', 'markdown', WHERE, { writeText })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`[NQ GP 1d](${BARE})`)
    expect(message().text).toBe(fillCopy(PORTABLE_LINK_COPY.copied, { line: 'NQ GP 1d' }))
  })

  it.each([
    ['the health read fails', () => health.mockRejectedValue(new Error('offline'))],
    ['port_fixed is missing', () => answerHealth(undefined)],
    ['port_fixed is the string true', () => answerHealth('true')],
    ['port_fixed is 1', () => answerHealth(1)],
    ['the health body is null', () => health.mockResolvedValue(null as never)],
  ])('copies the bare string when %s (a bare string works anywhere, a wrong address does not)', async (_name, arrange) => {
    arrange()
    const writeText = vi.fn(async () => {})
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(BARE)
  })

  it('shows the bare string to copy by hand when the clipboard refuses', async () => {
    notFixed()
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    await copyPanelLink('NQ GP 1d', 'url', WHERE, { writeText })
    expect(message().text).toBe(`The browser refused the clipboard. The link is ${BARE}`)
    expect(message().tone).toBe('error')
  })

  it('a string it copies is a link the reader accepts: the same line comes back', async () => {
    notFixed()
    const writeText = vi.fn(async (_text: string) => {})
    await copyPanelLink('volmanaged_v0 RET', 'url', WHERE, { writeText })
    expect(linesFromHash(writeText.mock.calls[0]?.[0] ?? '')?.map((l) => l.line)).toEqual(['volmanaged_v0 RET'])
  })

  it('the Options rows copy the bare string too', async () => {
    notFixed()
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    const [url, markdown] = copyLinkEntries('REG')
    url?.onSelect()
    markdown?.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls).toEqual([['#go=REG'], ['[REG](#go=REG)']])
  })

  it('the portable copy uses UK spelling and no em or en dashes', () => {
    for (const text of Object.values(PORTABLE_LINK_COPY)) {
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
