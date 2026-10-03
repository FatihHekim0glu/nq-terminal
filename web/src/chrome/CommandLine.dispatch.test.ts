// @vitest-environment jsdom
// D10: Shift+Enter (open in a new panel) was dropped for Number <GO>, so a numbered menu row always
// replaced the focused panel instead. Exercised through the dispatch chain runText -> perform ->
// numberGo -> chooseItem -> runText, the same path the digits themselves take (CommandLine.lineKeys.ts
// covers the arrowed-menu-row path, the other half of the same defect).
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './CommandLine.menus.load'
import type { CommandIndexData } from '../commands/types'
import { displayLine } from '../commands/line'
import { runText } from './CommandLine.dispatch'
import { LINKS } from '../copy/links'
import { LINKS_PASTED } from '../copy/linksPasted'
import { fillCopy } from '../copy/workspace'
import { onLineRequest, type LineRequest } from './CommandLine.bus'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'
import { markWorkspaceReady, MAX_LINK_LINES, resetWorkspaceReady } from './deepLink'
import { resetMessage, useMessage } from './MessageLine.store'

// The menus and sheets load as chunks of their own; the app has them by its first idle moment, so the tests wait for them.
beforeAll(async () => {
  await loadCommandLineParts()
})

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: [],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

function setup(onRun = vi.fn()) {
  const options: CommandLineOptions = { index: INDEX, indexError: false, fallbackContext: null, onRun }
  const inputRef = { current: null }
  const hook = renderHook(() => useCommandLineParts(options, inputRef))
  return { hook, onRun }
}

describe('Number <GO> (numberGo) threads Shift+Enter into the menu item it chooses (D10)', () => {
  it('opens the numbered item in a new panel when the number was itself run with Shift+Enter', () => {
    const { hook, onRun } = setup()
    // NQ<GO>: a bare instrument opens its function menu (item 1 is a P0 function that runs directly).
    act(() => runText(hook.result.current, 'NQ', false))
    expect(hook.result.current.menus.menu?.items.length).toBeGreaterThan(0)
    // 1<Shift+GO>: the digits path (perform's 'number' case) used to drop the new-panel flag here.
    act(() => runText(hook.result.current, '1', true))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun.mock.calls[0]?.[1]).toBe('new-panel')
  })

  it('still replaces the focused panel on a plain Number <GO>', () => {
    const { hook, onRun } = setup()
    act(() => runText(hook.result.current, 'NQ', false))
    act(() => runText(hook.result.current, '1', false))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun.mock.calls[0]?.[1]).toBe('replace')
  })
})

describe('a pasted #go= link (04 1.7, 03 4.6)', () => {
  let requests: LineRequest[] = []
  let stop = () => {}
  beforeEach(() => {
    requests = []
    stop = onLineRequest((request) => requests.push(request))
    resetMessage()
    markWorkspaceReady()
  })
  afterEach(() => {
    stop()
    resetWorkspaceReady()
    resetMessage()
  })

  // The link reader loads on demand, so a paste settles a moment after runText returns.
  const paste = (text: string, newPanel = false) => {
    const { hook } = setup()
    act(() => runText(hook.result.current, text, newPanel))
    return hook
  }
  const quiet = () => new Promise<void>((resolve) => setTimeout(resolve, 60))
  const refusedWith = (text: string) => vi.waitFor(() => expect(useMessage.getState()).toMatchObject({ text, tone: 'error' }))

  it('runs the lines of a pasted string like the address bar: the first replaces, later ones open new panels', async () => {
    const hook = paste('#go=NQ%20GP%201d&go=REG')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toEqual([
      { line: 'NQ GP 1d', newPanel: false },
      { line: 'REG', newPanel: true },
    ])
    expect(hook.result.current.s.line).toBe('')
  })

  it('reads the pasted string as the box shows it, in upper case', async () => {
    paste(displayLine('#go=NQ%20GP%201d&go=REG'))
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toEqual([
      { line: 'NQ GP 1D', newPanel: false },
      { line: 'REG', newPanel: true },
    ])
  })

  it('opens the first line in a new panel too when the paste was entered with Shift+Enter', async () => {
    paste('#go=REG', true)
    await vi.waitFor(() => expect(requests).toEqual([{ line: 'REG', newPanel: true }]))
  })

  it('reads the full address and a Markdown link too', async () => {
    paste('http://127.0.0.1:8765/#go=REG')
    paste('[REG](#go=REG)')
    await vi.waitFor(() => expect(requests.map((r) => r.line)).toEqual(['REG', 'REG']))
  })

  it('waits for the workspace before it runs', async () => {
    resetWorkspaceReady()
    paste('#go=REG')
    await quiet()
    expect(requests).toEqual([])
    markWorkspaceReady()
    await vi.waitFor(() => expect(requests).toEqual([{ line: 'REG', newPanel: false }]))
  })

  it.each([
    ['a character outside the alphabet', '#go=REG%3BRESET'],
    ['script text', '#go=%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
    ['more than eight lines', `#${Array.from({ length: MAX_LINK_LINES + 1 }, () => 'go=REG').join('&')}`],
    ['a fragment with no go part', '#top'],
  ])('refuses a pasted string with %s: nothing runs, the text stays and the message line says why', async (_name, text) => {
    const hook = paste(text)
    await refusedWith(LINKS_PASTED.refused)
    expect(requests).toEqual([])
    expect(hook.result.current.s.line).toBe(displayLine(text))
  })

  it.each([['RESET'], ['UNDO'], ['GRAB'], ['SAVE MYSPACE'], ['LOAD MYSPACE'], ['FORGET MYSPACE'], ['WATCH'], ['98']])(
    'refuses a pasted string whose line is %j (not a run, context or help action), even after a good line',
    async (forbidden) => {
      const text = `#go=REG&go=${encodeURIComponent(forbidden)}`
      const hook = paste(text)
      await refusedWith(fillCopy(LINKS.refusedLine, { line: forbidden }))
      expect(requests).toEqual([])
      expect(hook.result.current.s.line).toBe(displayLine(text))
    },
  )

  it('refuses a pasted line the command line cannot parse, in its own words, and runs nothing', async () => {
    paste('#go=REG&go=ZZZ')
    await vi.waitFor(() => expect(useMessage.getState().tone).toBe('error'))
    expect(requests).toEqual([])
    expect(useMessage.getState().text).not.toBe(LINKS_PASTED.refused)
  })

  it('reads a link-shaped text that is no link as an ordinary line: the parser explains it', async () => {
    const hook = paste('[NOTE]')
    await vi.waitFor(() => expect(useMessage.getState().tone).toBe('error'))
    expect(requests).toEqual([])
    expect(hook.result.current.s.line).toBe('[NOTE]')
  })

  it('leaves an ordinary line alone: a line that is not link shaped goes through the parser at once', () => {
    const { hook, onRun } = setup()
    act(() => runText(hook.result.current, 'NQ GP 1d', false))
    expect(requests).toEqual([])
    expect(onRun).toHaveBeenCalledTimes(1)
  })
})
