// @vitest-environment jsdom
// U01, end to end inside the page: the demo boot's one mark (data-demo="on") is what turns on the DEMO DATA key in
// the frame strip, the demo term on the status line's data segment and the demo snapshot line on REG and the About this
// demo lines on the HELP page. Before the boot none of the four is there.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '../chrome/StatusBar'
import { FrameStrip } from '../chrome/FrameStrip'
import { DEMO_DATA, FRAME_STRIP, STATUS_BAR } from '../copy/chrome'
import { DEMO_TOPIC, HELP_TOPICS } from '../copy/helpTopics'
import { REG } from '../copy/reg'
import { DEMO_MARKER, bootDemo } from './boot'
import { health } from './data/system'

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
afterEach(() => {
  cleanup()
  forget()
})

function renderChrome(): void {
  render(
    <>
      <FrameStrip screen="HOME" tapeOn={false} scheme="standard" onOpen={vi.fn()} onNew={vi.fn()} onTape={vi.fn()} onScheme={vi.fn()} onDemo={vi.fn()} />
      <StatusBar screen="HOME" contexts={{ A: null, B: null, C: null }} health={{ status: 'ok', data: health(new Date()) }} />
    </>,
  )
}

describe('the demo boot and the demo term', () => {
  it('shows nothing of the demo before the boot: no key, the fixture term, the API line, no About this demo', () => {
    renderChrome()
    expect(screen.queryByRole('button', { name: FRAME_STRIP.demoData })).toBeNull()
    expect(screen.getByText(STATUS_BAR.fixture)).toBeTruthy()
    expect(REG.criteriaSource).toMatch(/through the API/)
    expect(HELP_TOPICS.HELP!.shows).not.toContain(DEMO_TOPIC.lines[0])
  })

  it('turns on the key, the status term, the REG snapshot line and the HELP lines together', () => {
    bootDemo(() => undefined)
    renderChrome()
    expect(screen.getByRole('button', { name: DEMO_DATA.term })).toBeTruthy()
    // The same term twice: the key, and the status line's segment (the only other place the words appear).
    expect(screen.getAllByText(DEMO_DATA.term)).toHaveLength(2)
    expect(screen.queryByText(STATUS_BAR.fixture)).toBeNull()
    expect(REG.criteriaSource).toMatch(/demo snapshot/)
    // The HELP page (and so the HL index, built after first paint) leads with About this demo only once the page is marked.
    expect(HELP_TOPICS.HELP!.shows[0]).toBe(DEMO_TOPIC.lines[0])
  })
})
