// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode, createRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import CommandZone from '../AppCommandBar'
import { parseLine } from '../commands/line'
import { describeError } from '../commands/messages'
import type { ParseError } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import { LINKS } from '../copy/links'
import { fillCopy } from '../copy/workspace'
import { onLineRequest, type LineRequest } from './CommandLine.bus'
import { markWorkspaceReady, resetWorkspaceReady } from './deepLink'
import { resetMessage, useMessage } from './MessageLine.store'
import { useDeepLinks, type DeepLinkEnv } from './useDeepLinks'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'CL', symbol: 'CL.V.0', sector: 'energy' },
  ],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: ['nt_volmanaged_v0'],
  registry_error: null,
}

// The index the hook waits for: GET /api/commands, as useCommands() reports it.
const commands = vi.hoisted(() => ({ current: { status: 'pending', data: undefined } as { status: string; data: unknown } }))
vi.mock('../api/queries', () => ({ useCommands: () => commands.current }))

const settle = (index: CommandIndexData | null = INDEX) => {
  commands.current = index ? { status: 'success', data: index } : { status: 'error', data: undefined }
}

let requests: LineRequest[] = []
let stopListening = () => {}

beforeEach(() => {
  requests = []
  stopListening = onLineRequest((r) => requests.push(r))
  settle()
})

afterEach(() => {
  cleanup()
  stopListening()
  resetWorkspaceReady()
  resetMessage()
  commands.current = { status: 'pending', data: undefined }
})

function makeEnv(hash: string) {
  const location = { hash, pathname: '/app/', search: '?q=1' }
  const target = new EventTarget()
  // A real replaceState to a URL with no fragment leaves no hash, and fires no hashchange.
  const replaceState = vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
    if (!String(url).includes('#')) location.hash = ''
  })
  const env: DeepLinkEnv = { location, history: { replaceState }, target }
  const change = (next: string) => {
    location.hash = next
    target.dispatchEvent(new Event('hashchange'))
  }
  return { env, location, replaceState, change }
}

function Probe({ env }: { readonly env?: DeepLinkEnv }) {
  useDeepLinks(env)
  return null
}

const lines = () => requests.map((r) => [r.line, r.newPanel])
const message = () => useMessage.getState()
const ready = () => act(async () => markWorkspaceReady())

describe('useDeepLinks: waiting', () => {
  it('runs nothing until the commands index has settled and the workspace is ready', async () => {
    commands.current = { status: 'pending', data: undefined }
    const { env } = makeEnv('#go=REG')
    const view = render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([])
    settle()
    view.rerender(<Probe env={env} />)
    await act(async () => {})
    expect(lines()).toEqual([['REG', false]])
  })

  it('waits for the workspace when the index is already there', async () => {
    const { env } = makeEnv('#go=REG')
    render(<Probe env={env} />)
    await act(async () => {})
    expect(lines()).toEqual([])
    await ready()
    expect(lines()).toEqual([['REG', false]])
  })

  it('carries on when the index failed to load: a line that needs no context still runs', async () => {
    settle(null)
    const { env } = makeEnv('#go=REG')
    render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([['REG', false]])
  })

  it('runs nothing after the component has gone', async () => {
    const { env } = makeEnv('#go=REG')
    const view = render(<Probe env={env} />)
    view.unmount()
    await ready()
    expect(lines()).toEqual([])
  })
})

describe('useDeepLinks: replaying', () => {
  it('replays the lines in order through the command line bus: the first like Enter, later ones like Shift+Enter', async () => {
    const { env } = makeEnv('#go=volmanaged_v0%20RET&go=REG&go=LEDG')
    render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([
      ['volmanaged_v0 RET', false],
      ['REG', true],
      ['LEDG', true],
    ])
  })

  it('runs a link once, however often the component renders', async () => {
    const { env } = makeEnv('#go=REG&go=LEDG')
    const view = render(<Probe env={env} />)
    await ready()
    view.rerender(<Probe env={env} />)
    view.rerender(<Probe env={env} />)
    await act(async () => {})
    expect(requests).toHaveLength(2)
  })

  it('consumes the hash with replaceState, keeping the path and the search', async () => {
    const { env, location, replaceState } = makeEnv('#go=REG')
    render(<Probe env={env} />)
    await ready()
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/?q=1')
    expect(location.hash).toBe('')
  })

  it('writes a path that is never read as another host: a page served at // keeps a single slash', async () => {
    const { env, replaceState } = makeEnv('#go=REG')
    ;(env.location as { pathname: string }).pathname = '//evil.example/x'
    render(<Probe env={env} />)
    await ready()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/evil.example/x?q=1')
    expect(lines()).toEqual([['REG', false]])
  })

  it('runs the link even when the browser refuses to rewrite the address', async () => {
    const { env, replaceState } = makeEnv('#go=REG')
    replaceState.mockImplementation(() => {
      throw new DOMException('refused', 'SecurityError')
    })
    render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([['REG', false]])
  })

  it('consumes the hash as soon as it is read, before anything has run', async () => {
    const { env, location } = makeEnv('#go=REG')
    render(<Probe env={env} />)
    expect(location.hash).toBe('')
    expect(lines()).toEqual([])
    await ready()
  })

  it('posts no message of its own for a link it runs (the command line says what it opened)', async () => {
    const { env } = makeEnv('#go=REG')
    render(<Probe env={env} />)
    await ready()
    expect(message().text).toBe('')
  })

  it('handles hashchange: a link pasted into the address bar of the open page', async () => {
    const { env, change, replaceState } = makeEnv('')
    render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([])
    await act(async () => change('#go=REG%20HELP'))
    expect(lines()).toEqual([['REG HELP', false]])
    expect(replaceState).toHaveBeenCalledTimes(1)
    await act(async () => change('#go=LEDG&go=RUNS'))
    expect(lines()).toEqual([
      ['REG HELP', false],
      ['LEDG', false],
      ['RUNS', true],
    ])
  })

  it('leaves a hash that is not a link alone on hashchange', async () => {
    const { env, change, replaceState, location } = makeEnv('')
    render(<Probe env={env} />)
    await ready()
    await act(async () => change('#top'))
    expect(replaceState).not.toHaveBeenCalled()
    expect(location.hash).toBe('#top')
    expect(lines()).toEqual([])
    expect(message().text).toBe('')
  })

  it('stops listening for hashchange once unmounted', async () => {
    const { env, change } = makeEnv('')
    const view = render(<Probe env={env} />)
    await ready()
    view.unmount()
    await act(async () => change('#go=REG'))
    expect(lines()).toEqual([])
  })

  it('under StrictMode runs the link once and consumes the hash once', async () => {
    const { env, replaceState } = makeEnv('#go=REG&go=LEDG')
    render(
      <StrictMode>
        <Probe env={env} />
      </StrictMode>,
    )
    await ready()
    expect(lines()).toEqual([
      ['REG', false],
      ['LEDG', true],
    ])
    expect(replaceState).toHaveBeenCalledTimes(1)
  })

  it('under StrictMode with the index still loading, runs the link once when it arrives', async () => {
    commands.current = { status: 'pending', data: undefined }
    const { env } = makeEnv('#go=REG')
    const view = render(
      <StrictMode>
        <Probe env={env} />
      </StrictMode>,
    )
    await ready()
    settle()
    view.rerender(
      <StrictMode>
        <Probe env={env} />
      </StrictMode>,
    )
    await act(async () => {})
    expect(lines()).toEqual([['REG', false]])
  })

  it('reads the real address bar by default', async () => {
    window.history.replaceState(null, '', '/#go=REG')
    render(<Probe />)
    await ready()
    expect(lines()).toEqual([['REG', false]])
    expect(window.location.hash).toBe('')
  })

  it('ignores a page with no link', async () => {
    const { env, replaceState } = makeEnv('')
    render(<Probe env={env} />)
    await ready()
    expect(replaceState).not.toHaveBeenCalled()
    expect(lines()).toEqual([])
  })
})

describe('useDeepLinks: what a link may run (the allowlist)', () => {
  it.each([
    ['#go=volmanaged_v0%20RET', 'volmanaged_v0 RET'],
    ['#go=CL1%20Comdty', 'CL1 Comdty'],
    ['#go=NQ', 'NQ'],
    ['#go=REG%20HELP', 'REG HELP'],
    ['#go=NXTW%20REG', 'NXTW REG'],
  ])('runs %s', async (hash, line) => {
    const { env } = makeEnv(hash)
    render(<Probe env={env} />)
    await ready()
    expect(lines()).toEqual([[line, false]])
    expect(message().tone).toBe('info')
  })

  // Born failing: before the allowlist a link ran whatever the command line could parse.
  it.each([
    ['#go=WATCH%20SEEN', 'WATCH SEEN'],
    ['#go=WATCH', 'WATCH'],
    ['#go=RESET', 'RESET'],
    ['#go=UNDO', 'UNDO'],
    ['#go=GRAB', 'GRAB'],
    ['#go=98', '98'],
    ['#go=3', '3'],
    ['#go=HL%20cost', 'HL cost'],
    ['#go=LAST', 'LAST'],
    ['#go=NO', 'NO'],
    ['#go=MENU', 'MENU'],
    ['#go=INDEX', 'INDEX'],
    ['#go=REG&go=RESET', 'RESET'],
    ['#go=RESET&go=REG', 'RESET'],
    ['#go=REG&go=LEDG&go=UNDO', 'UNDO'],
  ])('%s runs nothing and posts the refusal for %j', async (hash, offending) => {
    const { env, location } = makeEnv(hash)
    render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(requests).toEqual([])
    expect(message().text).toBe(fillCopy(LINKS.refusedLine, { line: offending }))
    expect(message().tone).toBe('error')
    expect(location.hash).toBe('')
  })

  // A line that does not parse is not "a line that cannot run from a link": the message is the command
  // line's own (describeError), so the reader learns what to fix.
  const parseError = (text: string): ParseError => {
    const r = parseLine(text, { index: INDEX, fallbackContext: null })
    if (r.ok) throw new Error(`${text} parses, so it is not a parse failure`)
    return r.error
  }

  it.each([
    ['#go=ZZZ', 'ZZZ'],
    ['#go=GP', 'GP'],
    ['#go=NQ%20ZZZ', 'NQ ZZZ'],
    ['#go=SAVE%20one', 'SAVE one'],
  ])('%s posts the parse error in the command line\'s own words, and runs nothing', async (hash, text) => {
    const { env, location } = makeEnv(hash)
    render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(message().text).toBe(describeError(parseError(text)))
    expect(message().text).not.toContain('cannot run from a link')
    expect(message().tone).toBe('error')
    expect(requests).toEqual([])
    expect(location.hash).toBe('')
  })

  it('names an unknown context as unknown, though the screen after it is a real one (never refusedLine)', async () => {
    const { env } = makeEnv('#go=nosuch_v0%20RET')
    render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(message().text).toBe('nosuch_v0 is not a known instrument, hypothesis or run.')
    expect(message().text).not.toBe(fillCopy(LINKS.refusedLine, { line: 'nosuch_v0 RET' }))
    expect(message().tone).toBe('error')
    expect(requests).toEqual([])
  })

  it('says the index has not loaded when it failed, keeps the link, and runs it once the index arrives', async () => {
    settle(null)
    const { env, location } = makeEnv('#go=volmanaged_v0%20RET')
    const view = render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(requests).toEqual([])
    expect(location.hash).toBe('')
    expect(message().text).toBe('The command index has not loaded yet, so volmanaged_v0 cannot be resolved.')
    expect(message().tone).toBe('error')
    settle(INDEX)
    view.rerender(<Probe env={env} />)
    await act(async () => {})
    expect(lines()).toEqual([['volmanaged_v0 RET', false]])
    view.rerender(<Probe env={env} />)
    await act(async () => {})
    expect(lines()).toEqual([['volmanaged_v0 RET', false]])
  })

  it('tells the reader about a waiting link once, not on every render', async () => {
    settle(null)
    const { env } = makeEnv('#go=volmanaged_v0%20RET')
    const view = render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    resetMessage()
    view.rerender(<Probe env={env} />)
    view.rerender(<Probe env={env} />)
    await act(async () => {})
    expect(message().text).toBe('')
  })

  it('refuses a link that also holds a line it can never run, at once, though the index is missing', async () => {
    settle(null)
    const { env } = makeEnv('#go=volmanaged_v0%20RET&go=RESET')
    const view = render(<Probe env={env} />)
    await act(async () => {})
    expect(message().text).toBe(fillCopy(LINKS.refusedLine, { line: 'RESET' }))
    expect(message().tone).toBe('error')
    settle(INDEX)
    view.rerender(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(requests).toEqual([])
  })

  it('judges a waiting link again when the index arrives: a line that then fails to parse refuses it', async () => {
    settle(null)
    const { env } = makeEnv('#go=volmanaged_v0%20RET&go=ZZZ')
    const view = render(<Probe env={env} />)
    await act(async () => {})
    // Without an index a mistyped word cannot be told from a context: the link waits.
    expect(message().text).toBe('The command index has not loaded yet, so volmanaged_v0 cannot be resolved.')
    settle(INDEX)
    view.rerender(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(message().text).toBe(describeError(parseError('ZZZ')))
    expect(requests).toEqual([])
  })

  it('refuses a link the moment the index settles, without waiting for the workspace', async () => {
    const { env } = makeEnv('#go=RESET')
    render(<Probe env={env} />)
    await act(async () => {})
    expect(message().text).toBe(fillCopy(LINKS.refusedLine, { line: 'RESET' }))
    await ready()
    expect(requests).toEqual([])
  })

  it('a refused link on hashchange runs nothing, is consumed, and does not stop later links', async () => {
    const { env, change, location } = makeEnv('')
    render(<Probe env={env} />)
    await ready()
    await act(async () => change('#go=UNDO'))
    expect(requests).toEqual([])
    expect(location.hash).toBe('')
    expect(message().tone).toBe('error')
    await act(async () => change('#go=REG'))
    expect(lines()).toEqual([['REG', false]])
  })
})

describe('useDeepLinks: a link that is malformed', () => {
  it.each([
    ['script text', '#go=%3Cscript%3E'],
    ['an empty line', '#go='],
    ['a line over 200 characters', `#go=${'A'.repeat(201)}`],
    ['nine lines', `#${Array.from({ length: 9 }, () => 'go=REG').join('&')}`],
    ['a bad percent-encoding', '#go=%E0%A4%A'],
    ['a foreign key beside a link', '#go=REG&x=1'],
  ])('%s runs nothing, is consumed and posts the refusal', async (_name, hash) => {
    const { env, location } = makeEnv(hash)
    render(<Probe env={env} />)
    await ready()
    await act(async () => {})
    expect(requests).toEqual([])
    expect(message().text).toBe(LINKS.refused)
    expect(message().tone).toBe('error')
    expect(location.hash).toBe('')
  })

  it('says so at once, before the index or the workspace is there', async () => {
    commands.current = { status: 'pending', data: undefined }
    const { env } = makeEnv('#go=%3Cscript%3E')
    render(<Probe env={env} />)
    await waitFor(() => expect(message().text).toBe(LINKS.refused))
  })
})

// The wiring: CommandZone (AppCommandBar.tsx) calls useDeepLinks once, and the lines reach the real
// command line, so a link is handled exactly like typing it.
describe('CommandZone: a link in the address bar goes through the real command line', () => {
  beforeAll(() => {
    class NoResize {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NoResize)
    Element.prototype.scrollIntoView = () => {}
  })
  afterEach(() => window.history.replaceState(null, '', '/'))

  function mountZone(wrap: (node: React.ReactNode) => React.ReactNode = (node) => node) {
    const onRun = vi.fn(() => true)
    const onReset = vi.fn(() => 'Layout reset.')
    const onUndo = vi.fn(() => 'Layout restored.')
    const onGrab = vi.fn(() => true)
    const onWatchSeen = vi.fn(() => 'Seen.')
    const zone = (
      <CommandZone
        commandRef={createRef()}
        focusedGroup={null}
        panelNumber={null}
        onRun={onRun}
        onReset={onReset}
        onUndo={onUndo}
        onGrab={onGrab}
        onWatchSeen={onWatchSeen}
      />
    )
    render(wrap(zone))
    return { onRun, onReset, onUndo, onGrab, onWatchSeen }
  }

  const runs = (onRun: ReturnType<typeof mountZone>['onRun']) =>
    (onRun.mock.calls as unknown as Array<[{ canonical: string }, string]>).map(([command, target]) => [command.canonical, target])

  it('opens the first line like Enter and the later ones like Shift+Enter, once', async () => {
    window.history.replaceState(null, '', '/#go=volmanaged_v0%20RET&go=REG')
    const { onRun } = mountZone()
    await ready()
    await act(async () => {})
    expect(runs(onRun)).toEqual([
      ['volmanaged_v0 RET', 'replace'],
      ['REG', 'new-panel'],
    ])
    expect(message().text).toBe('Opened REG in a new panel.')
    expect(window.location.hash).toBe('')
  })

  it('runs once under StrictMode', async () => {
    window.history.replaceState(null, '', '/#go=REG')
    const { onRun } = mountZone((node) => <StrictMode>{node}</StrictMode>)
    await ready()
    await act(async () => {})
    expect(runs(onRun)).toEqual([['REG', 'replace']])
    expect(message().text).toBe('Opened REG.')
  })

  it('a context line loads the context instead of running a screen', async () => {
    window.history.replaceState(null, '', '/#go=CL1%20Comdty')
    const { onRun } = mountZone()
    await ready()
    await act(async () => {})
    expect(onRun).not.toHaveBeenCalled()
    expect(message().text).toContain('Loaded')
  })

  it.each([['RESET'], ['UNDO'], ['GRAB'], ['WATCH%20SEEN'], ['98'], ['REG&go=RESET']])(
    'born failing: #go=%s reaches none of the layout, grab or watch callbacks',
    async (line) => {
      window.history.replaceState(null, '', `/#go=${line}`)
      const { onRun, onReset, onUndo, onGrab, onWatchSeen } = mountZone()
      await ready()
      await act(async () => {})
      for (const spy of [onRun, onReset, onUndo, onGrab, onWatchSeen]) expect(spy).not.toHaveBeenCalled()
      expect(message().tone).toBe('error')
      expect(message().text).toContain('cannot run from a link')
    },
  )
})
