// @vitest-environment jsdom
// D10: Shift+Enter (open in a new panel) was dropped when the user arrowed to a menu row and pressed
// Enter: lineKeys.enter() called chooseItem without the shift flag. CommandLine.dispatch.test.ts covers
// the other half of the same defect (typing the row's number instead of arrowing to it).
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommandIndexData } from '../commands/types'
import { runText } from './CommandLine.dispatch'
import { handleLineKey } from './CommandLine.lineKeys'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'

// D10's suggestion-sheet half: chooseSuggestion only runs a suggestion straight away (instead of just
// filling the box) for the 'instrument' and 'search' groups. Typing a bare instrument or a search query
// alone never itself parses as a runnable line (it opens a menu), so this scopes `suggest` to return one
// controlled 'instrument' row whose value is a complete, runnable line, to exercise chooseSuggestion's
// newPanel threading the same way a real 'instrument' or 'search' suggestion's runText call does.
vi.mock('../commands/suggest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/suggest')>()
  return {
    ...actual,
    suggest: (line: string, index: CommandIndexData | null) =>
      line.trim() === 'NQ'
        ? [{ value: 'NQ GP ', label: 'NQ GP', detail: 'Candle chart', group: 'instrument' as const }]
        : actual.suggest(line, index),
  }
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

describe('handleLineKey: Shift+Enter on an arrowed menu row (D10)', () => {
  it('passes shiftKey into the row it chooses, opening it in a new panel', () => {
    const { hook, onRun } = setup()
    act(() => runText(hook.result.current, 'NQ', false)) // NQ<GO>: opens the function menu
    expect(hook.result.current.menus.menu).not.toBeNull()
    act(() => {
      handleLineKey({ key: 'ArrowDown', shiftKey: false }, hook.result.current)
    })
    expect(hook.result.current.menus.row).toBe(0)
    act(() => {
      handleLineKey({ key: 'Enter', shiftKey: true }, hook.result.current)
    })
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun.mock.calls[0]?.[1]).toBe('new-panel')
  })

  it('still replaces the focused panel on a plain Enter', () => {
    const { hook, onRun } = setup()
    act(() => runText(hook.result.current, 'NQ', false))
    act(() => {
      handleLineKey({ key: 'ArrowDown', shiftKey: false }, hook.result.current)
    })
    act(() => {
      handleLineKey({ key: 'Enter', shiftKey: false }, hook.result.current)
    })
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun.mock.calls[0]?.[1]).toBe('replace')
  })
})

describe('handleLineKey: Shift+Enter on an arrowed suggestion-sheet row (D10)', () => {
  it('runs the highlighted instrument/search suggestion in a new panel', () => {
    const { hook, onRun } = setup()
    act(() => {
      hook.result.current.s.edit('NQ')
    })
    expect(hook.result.current.sheetOpen).toBe(true)
    act(() => {
      handleLineKey({ key: 'ArrowDown', shiftKey: false }, hook.result.current)
    })
    expect(hook.result.current.s.navigated).toBe(true)
    expect(hook.result.current.highlighted?.group).toBe('instrument')
    act(() => {
      handleLineKey({ key: 'Enter', shiftKey: true }, hook.result.current)
    })
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ canonical: expect.stringContaining('NQ') }), 'new-panel')
  })
})
