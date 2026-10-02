// @vitest-environment jsdom
// D10: Shift+Enter (open in a new panel) was dropped for Number <GO>, so a numbered menu row always
// replaced the focused panel instead. Exercised through the dispatch chain runText -> perform ->
// numberGo -> chooseItem -> runText, the same path the digits themselves take (CommandLine.lineKeys.ts
// covers the arrowed-menu-row path, the other half of the same defect).
import { act, renderHook } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './CommandLine.menus.load'
import type { CommandIndexData } from '../commands/types'
import { runText } from './CommandLine.dispatch'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'

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
