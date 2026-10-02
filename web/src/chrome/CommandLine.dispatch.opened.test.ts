// @vitest-environment jsdom
// G14: a bare DES typed where the link group holds a hypothesis opens as that hypothesis's DES (a panel shows
// its group's context), while the parsed line reads NQ DES. The message line must say what the panel shows:
// the Workspace reports it through the bus right after it runs, the command line words the message from it.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './CommandLine.menus.load'
import type { CommandIndexData } from '../commands/types'
import { reportOpened, takeOpened } from './CommandLine.bus'
import { runText } from './CommandLine.dispatch'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'
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
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: [],
  registry_error: null,
}

const NQ = { kind: 'instrument' as const, value: 'NQ' }

function setup(onRun: CommandLineOptions['onRun']) {
  const options: CommandLineOptions = { index: INDEX, indexError: false, fallbackContext: NQ, onRun }
  const inputRef = { current: null }
  return renderHook(() => useCommandLineParts(options, inputRef))
}

beforeEach(() => {
  resetMessage()
  reportOpened(null)
})

afterEach(() => {
  reportOpened(null)
})

describe('the Opened message names the panel the Workspace opened (G14)', () => {
  it('says what the panel shows when the Workspace reports it, not the line as parsed', () => {
    const hook = setup(() => {
      reportOpened('volmanaged_v0 DES')
      return true
    })
    act(() => runText(hook.result.current, 'DES', false))
    expect(useMessage.getState().text).toBe('Opened volmanaged_v0 DES.')
  })

  it('does the same for a new panel', () => {
    const hook = setup(() => {
      reportOpened('volmanaged_v0 DES')
      return true
    })
    act(() => runText(hook.result.current, 'DES', true))
    expect(useMessage.getState().text).toBe('Opened volmanaged_v0 DES in a new panel.')
  })

  it('falls back to the parsed line when nothing was reported', () => {
    const hook = setup(() => true)
    act(() => runText(hook.result.current, 'DES', false))
    expect(useMessage.getState().text).toBe('Opened NQ DES.')
  })

  it('does not use a report left over from an earlier run', () => {
    reportOpened('overnight_v0 DES')
    const hook = setup(() => true)
    act(() => runText(hook.result.current, 'DES', false))
    expect(useMessage.getState().text).toBe('Opened NQ DES.')
    expect(takeOpened()).toBeNull()
  })

  it('keeps what was typed, not the reported words, in the history', () => {
    const hook = setup(() => {
      reportOpened('volmanaged_v0 DES')
      return true
    })
    act(() => runText(hook.result.current, 'DES', false))
    expect(hook.result.current.history.history.entries).toContain('NQ DES')
    expect(hook.result.current.history.history.entries).not.toContain('volmanaged_v0 DES')
  })

  it('a run that did not happen keeps the line and says the workspace is not ready, whatever was reported', () => {
    const onRun = vi.fn(() => {
      reportOpened('volmanaged_v0 DES')
      return false
    })
    const hook = setup(onRun)
    act(() => runText(hook.result.current, 'DES', false))
    expect(useMessage.getState().text).not.toContain('Opened')
    expect(hook.result.current.s.line).toBe('NQ DES')
  })
})
