// @vitest-environment jsdom
// The demo boot (src/demo/boot.tsx): it swaps in the demo's fetch and EventSource by assignment, marks the
// page as a demo for the frame strip's DEMO DATA flag, and only then renders the terminal. Booting twice
// (a reload of the module, a second call) must not stack a second demo layer on the first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openEventStream } from '../api/client'
import { DEMO_MARKER, bootDemo } from './boot'
import { DemoEventSource } from './stream'

vi.mock('./routes', () => ({ answerDemo: vi.fn(() => ({ status: 200, body: { demo: true } })) }))

const INSTALLED = Symbol.for(DEMO_MARKER)
const pageFetch = globalThis.fetch
const pageEventSource = globalThis.EventSource

function forget(): void {
  globalThis.fetch = pageFetch
  ;(globalThis as { EventSource?: unknown }).EventSource = pageEventSource
  delete (globalThis as Record<symbol, unknown>)[INSTALLED]
  delete document.documentElement.dataset.demo
}

beforeEach(forget)
afterEach(forget)

describe('bootDemo', () => {
  it('installs the demo fetch and EventSource and marks the page before it renders', () => {
    const seen: Array<{ fetch: typeof globalThis.fetch; source: unknown; demo: string | undefined }> = []
    bootDemo(() => {
      seen.push({ fetch: globalThis.fetch, source: globalThis.EventSource, demo: document.documentElement.dataset.demo })
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.fetch).not.toBe(pageFetch)
    expect(seen[0]?.source).toBe(DemoEventSource)
    expect(seen[0]?.demo).toBe('on')
  })

  it('carries the demo marker the bundle check looks for', () => {
    expect(DEMO_MARKER).toBe('nqt-demo')
  })

  it('answers /api from the demo route table through the installed fetch', async () => {
    bootDemo(() => undefined)
    const response = await globalThis.fetch('/api/health')
    expect(await response.json()).toEqual({ demo: true })
  })

  it('hands same-origin static GETs to the page fetch it saved', async () => {
    const saved = vi.fn(async () => new Response('font'))
    globalThis.fetch = saved
    bootDemo(() => undefined)
    const response = await globalThis.fetch('/assets/latin-400.woff2')
    expect(await response.text()).toBe('font')
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('booting twice keeps one demo layer: the same fetch, the page fetch saved once', async () => {
    const saved = vi.fn(async () => new Response('font'))
    globalThis.fetch = saved
    const render = vi.fn()
    bootDemo(render)
    const installed = globalThis.fetch
    bootDemo(render)
    expect(globalThis.fetch).toBe(installed)
    expect(render).toHaveBeenCalledTimes(2)
    await globalThis.fetch('/favicon.svg')
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('the API client then opens the demo stream, the only EventSource it opens', () => {
    bootDemo(() => undefined)
    const source = openEventStream('/api/live/stream')
    expect(source).toBeInstanceOf(DemoEventSource)
    source?.close()
  })
})
