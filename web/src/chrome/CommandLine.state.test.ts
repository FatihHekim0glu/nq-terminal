// @vitest-environment jsdom
// D07: running a command recalled with Up must stay the newest history entry in memory, matching what
// was written to storage. A new file (CommandLine.state.ts is mine; CommandLine.test.tsx belongs to the
// CommandLine.tsx owner, so this drives the hooks directly through runText, as the dispatcher does).
import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import type { HistoryStorage } from '../commands/history'
import type { CommandIndexData } from '../commands/types'
import { runText } from './CommandLine.dispatch'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'

const INDEX: CommandIndexData = {
  grammar: '',
  mnemonics: [],
  instruments: [],
  universe: [],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

function memoryStorage(): HistoryStorage {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function setup(storage: HistoryStorage) {
  const inputRef = createRef<HTMLInputElement>()
  const options: CommandLineOptions = {
    index: INDEX,
    indexError: false,
    fallbackContext: null,
    onRun: () => {},
    historyStorage: storage,
  }
  return renderHook(() => useCommandLineParts(options, inputRef))
}

describe('CommandLine.state: history after re-running a line recalled with Up (D07)', () => {
  it('born failing: re-running the recalled REG keeps memory and storage in sync, so the next Up gives REG', () => {
    const storage = memoryStorage()
    const { result } = setup(storage)

    act(() => runText(result.current, 'REG', false))
    act(() => runText(result.current, 'HELP', false))
    act(() => result.current.s.walk(true))
    act(() => result.current.s.walk(true))
    expect(result.current.s.line).toBe('REG')

    // Enter re-runs the recalled line.
    act(() => runText(result.current, result.current.s.line, false))
    expect(result.current.s.line).toBe('')

    // The bug: the in-memory history reverts to [REG, HELP] here, so the next Up shows HELP, not REG.
    act(() => result.current.s.walk(true))
    expect(result.current.s.line).toBe('REG')

    expect(JSON.parse(storage.getItem('nqt.cmd.history') ?? '[]')).toEqual(['REG', 'HELP', 'REG'])
  })
})
