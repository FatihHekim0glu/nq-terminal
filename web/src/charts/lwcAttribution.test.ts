// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LWC_ATTRIBUTION_SELECTOR, quietAttributionLogo } from './lwcAttribution'

afterEach(() => {
  document.body.innerHTML = ''
})

function logo(): HTMLAnchorElement {
  const a = document.createElement('a')
  a.id = 'tv-attr-logo'
  a.href = 'https://www.tradingview.com/'
  return a
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('quietAttributionLogo', () => {
  it('matches the element lightweight-charts 5.2.1 creates', () => {
    expect(LWC_ATTRIBUTION_SELECTOR).toBe('a#tv-attr-logo')
  })

  it('makes an existing logo inert and hidden from the accessibility tree, but leaves it on screen', () => {
    const host = document.createElement('div')
    const a = logo()
    host.append(a)
    document.body.append(host)
    const stop = quietAttributionLogo(host)
    expect(a.hasAttribute('inert')).toBe(true)
    expect(a.getAttribute('aria-hidden')).toBe('true')
    expect(a.getAttribute('tabindex')).toBe('-1')
    expect(a.isConnected).toBe(true)
    stop()
  })

  it('catches a logo the library adds later, until stopped', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const stop = quietAttributionLogo(host)
    const late = logo()
    host.append(document.createElement('div'))
    host.lastElementChild?.append(late)
    await flush()
    expect(late.hasAttribute('inert')).toBe(true)
    stop()
    const after = logo()
    host.append(after)
    await flush()
    expect(after.hasAttribute('inert')).toBe(false)
  })
})
