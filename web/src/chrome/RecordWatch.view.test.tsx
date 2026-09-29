// @vitest-environment jsdom
// The shell side of the record watch (shell diet 3, roadmap wave 9): the view store, the status line segment and the idle
// gate. The six reads, the diff and WATCH SEEN are the reader's (RecordWatch.live.tsx, loaded on demand); this file
// holds what the shell keeps and the rule that keeps the reader out of it.
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import statusBarSource from './StatusBar.tsx?raw'
import viewSource from './RecordWatch.view.tsx?raw'
import { emptyDiff } from '../state/recordWatch.schema'
import { useWatchMarksStore } from './RecordWatch.marks'
import { WatchSegment, resetRecordWatchView, useIdleReady, useRecordWatch, useWatchStore, type RecordWatchView } from './RecordWatch.view'

function view(state: RecordWatchView['state'], over: Partial<RecordWatchView> = {}): RecordWatchView {
  return { state, diff: emptyDiff(0), since: '15 Jan, 10:05', title: null, menu: () => null, accept: () => null, ...over }
}

beforeEach(() => resetRecordWatchView())
afterEach(() => cleanup())

describe('the view store', () => {
  it('starts waiting: the list and WATCH SEEN have nothing to offer before the first read', () => {
    const { result } = renderHook(() => useRecordWatch())
    expect(result.current.state).toBe('waiting')
    expect(result.current.since).toBeNull()
    expect(result.current.menu()).toBeNull()
    expect(result.current.accept()).toBeNull()
  })

  it('shows what the reader sets and goes back to waiting on reset, marks included', () => {
    const { result } = renderHook(() => useRecordWatch())
    act(() => useWatchStore.setState({ view: view('news') }))
    expect(result.current.state).toBe('news')
    act(() => useWatchMarksStore.setState({ marks: { ...useWatchMarksStore.getState().marks, runs: new Map([['r1', 'new']]) } }))
    act(() => resetRecordWatchView())
    expect(result.current.state).toBe('waiting')
    expect(useWatchMarksStore.getState().marks.runs.size).toBe(0)
    expect(useWatchStore.getState()).toMatchObject({ snapshot: null, lazy: null })
  })

  it('lists nothing while waiting even if the reader has been loaded', () => {
    const lazy = { watchMenu: () => ({ title: 'x', items: [] }) } as never
    useWatchStore.setState({ lazy })
    expect(useWatchStore.getState().view.menu()).toBeNull()
  })

  it('lists through the reader\'s module once a read has been shown', () => {
    const shown = { title: 'Since', items: [] }
    useWatchStore.setState({ view: view('changed', { menu: useWatchStore.getState().view.menu }), lazy: { watchMenu: () => shown } as never })
    expect(useWatchStore.getState().view.menu()).toBe(shown)
  })
})

describe('WatchSegment', () => {
  it('renders nothing while waiting', () => {
    const { container } = render(<WatchSegment view={view('waiting')} />)
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['baseline', 'from now'],
    ['clean', 'no change'],
  ] as const)('says %s in words', (state, words) => {
    const { container } = render(<WatchSegment view={view(state)} />)
    expect(container.textContent).toBe(`WATCH ${words}`)
    expect(container.querySelector('.warn')).toBeNull()
  })

  it('counts new records and marks rewritten ones in amber, read out in words', () => {
    const news = emptyDiff(0)
    const two = { ...news, appended: [{ source: 'runs', key: 'a' }, { source: 'runs', key: 'b' }] } as unknown as RecordWatchView['diff']
    const a = render(<WatchSegment view={view('news', { diff: two })} />)
    expect(a.container.textContent).toBe('WATCH 2 new')
    a.unmount()
    const one = { ...news, changed: [{ source: 'ledger', key: 'x', kind: 'changed' }] } as unknown as RecordWatchView['diff']
    const b = render(<WatchSegment view={view('changed', { diff: one, title: 'Ledger row rewritten' })} />)
    const seg = b.container.querySelector('.seg')
    expect(seg?.classList.contains('warn')).toBe(true)
    expect(seg?.getAttribute('title')).toBe('Ledger row rewritten')
    expect(b.container.textContent).toContain('WATCH 1 changed')
    expect(b.container.querySelector('.sr-only')?.textContent).toContain('A record that should not change was rewritten')
  })
})

describe('useIdleReady', () => {
  it('is false at first and true once the browser has had its idle moment', async () => {
    const { result } = renderHook(() => useIdleReady(5))
    expect(result.current).toBe(false)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(result.current).toBe(true)
  })
})

/** The module names a file imports or re-exports with a static statement, comments skipped. */
function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

describe('the shell rule: the reader stays out of the first-paint shell', () => {
  const READER = ['./RecordWatch.live', './RecordWatch.lazy', '../state/recordWatch', '../copy/watchReader', '../copy/watchDetail', '../api/queries']

  it('the view module imports none of the reader, the diff, their copy or the query hooks', () => {
    const specifiers = staticSpecifiers(viewSource).flatMap((spec) => [spec, spec.replace(/\.tsx?$/, '')])
    for (const name of READER) expect(specifiers, `RecordWatch.view.tsx imports ${name}`).not.toContain(name)
  })

  it('the status bar reads the segment from the view module, not the reader', () => {
    const specifiers = staticSpecifiers(statusBarSource)
    expect(specifiers).toContain('./RecordWatch.view')
    expect(specifiers).not.toContain('./RecordWatch.live')
  })

  it('App mounts the reader through a dynamic import only', () => {
    expect(staticSpecifiers(appSource)).not.toContain('./chrome/RecordWatch.live')
    expect(appSource).toContain("import('./chrome/RecordWatch.live')")
    expect(staticSpecifiers(appSource)).toContain('./chrome/RecordWatch.view')
  })
})
