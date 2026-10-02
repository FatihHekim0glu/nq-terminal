// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadCommandLineParts } from './CommandLine.menus.load'
import type { ParsedCommand } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import { LAYOUT_SEPARATOR } from '../copy/layout'
import { PreviewAnnouncer, usePreviewText } from './CommandLine.preview'
import { useCommandLineParts, type CommandLineOptions } from './CommandLine.state'

// The menus and sheets load as chunks of their own; the app has them by its first idle moment, so the tests wait for them.
beforeAll(async () => {
  await loadCommandLineParts()
})

afterEach(() => cleanup())

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

function preview(command: ParsedCommand, newPanel: boolean): string | null {
  return `${newPanel ? 'Shift' : 'Enter'}: ${command.canonical}`
}

function setup(options: Partial<CommandLineOptions> = {}) {
  const inputRef = createRef<HTMLInputElement>()
  const full: CommandLineOptions = { index: INDEX, indexError: false, fallbackContext: null, onRun: () => {}, ...options }
  return renderHook(() => {
    const p = useCommandLineParts(full, inputRef)
    return { p, preview: usePreviewText(p) }
  })
}

describe('usePreviewText: the <GO> preview row', () => {
  it('shows the Enter text plus, after the separator, the Shift+Enter text', () => {
    const { result } = setup({ previewRun: preview })
    act(() => result.current.p.s.edit('NQ GP'))
    expect(result.current.preview).toBe(`Enter: NQ GP${LAYOUT_SEPARATOR}Shift: NQ GP`)
  })

  it('NXTW: only the Shift+Enter (new panel) text, no separator', () => {
    const { result } = setup({ previewRun: preview })
    act(() => result.current.p.s.edit('NXTW NQ GP'))
    expect(result.current.preview).toBe('Shift: NQ GP')
  })

  it('null for a line that does not parse, an empty line, or a non-run action', () => {
    const { result } = setup({ previewRun: preview })
    act(() => result.current.p.s.edit('NQ FOO'))
    expect(result.current.preview).toBeNull()
    act(() => result.current.p.s.edit(''))
    expect(result.current.preview).toBeNull()
    act(() => result.current.p.s.edit('NQ1 INDEX'))
    expect(result.current.preview).toBeNull()
  })

  it('null when the caller has nothing to say about the Enter text, even with a shift text', () => {
    const { result } = setup({ previewRun: (_command, newPanel) => (newPanel ? 'Shift text' : null) })
    act(() => result.current.p.s.edit('NQ GP'))
    expect(result.current.preview).toBeNull()
  })

  it('falls back to the Enter text alone when the caller has nothing for the shift form', () => {
    const { result } = setup({ previewRun: (_command, newPanel) => (newPanel ? null : 'Enter text') })
    act(() => result.current.p.s.edit('NQ GP'))
    expect(result.current.preview).toBe('Enter text')
  })

  it('null with no previewRun at all', () => {
    const { result } = setup()
    act(() => result.current.p.s.edit('NQ GP'))
    expect(result.current.preview).toBeNull()
  })
})

describe('PreviewAnnouncer: a debounced sr-only status region', () => {
  afterEach(() => vi.useRealTimers())

  it('is always mounted as a role=status span, sr-only', () => {
    const { container } = render(<PreviewAnnouncer text={null} />)
    const span = container.querySelector('span[role="status"]')
    expect(span).toBeTruthy()
    expect(span?.className).toContain('sr-only')
  })

  it('copies the text 600 ms after it stops changing, not before', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<PreviewAnnouncer text={null} />)
    rerender(<PreviewAnnouncer text="Opens NQ GP" />)
    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('span')?.textContent).toBe('')
    rerender(<PreviewAnnouncer text="Opens NQ GIP" />)
    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('span')?.textContent).toBe('')
    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('span')?.textContent).toBe('Opens NQ GIP')
  })
})
