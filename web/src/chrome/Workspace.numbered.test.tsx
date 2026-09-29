// @vitest-environment jsdom
// G03: Number <GO> acts on a known panel's item, so the line the item runs belongs to that panel. Right
// after a layout load nothing has real focus (the panel ids are new), and the item's requestLine used to
// plan with that null focus: 'load', which swapped REG beside MT for a lone DES panel and cleared the
// panel history. A typed line is a different thing (no panel is addressed by it) and still loads.
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { onLineRequest, requestLine } from './CommandLine.bus'
import { activateNumbered, registerNumbered, resetNumbered, runningPanel } from './NumberedActions'
import type { WorkspaceHandle } from './Workspace'
import { command, panelIds, panelTitles, renderWorkspace, stubResizeObserver } from './WorkspaceNav.testUtil'

beforeAll(stubResizeObserver)

afterEach(() => {
  cleanup()
  resetNumbered()
})

const HYPOTHESIS = { kind: 'hypothesis' as const, value: 'volmanaged_v0' }
const desCommand = command('DES', { context: HYPOTHESIS, contextSource: 'typed', canonical: 'volmanaged_v0 DES' })

/** What the command line does with a request from the page: run it through the workspace like typing. */
function lineRunsIn(ref: { current: WorkspaceHandle | null }): () => void {
  return onLineRequest((r) => {
    ref.current?.run(desCommand, r.newPanel ? 'new-panel' : 'replace')
  })
}

/** REG beside MT, loaded by a typed line, so no panel has real focus (the state right after a layout load). */
async function regLoadedWithoutFocus(ref: { current: WorkspaceHandle | null }): Promise<string> {
  await waitFor(() => expect(panelTitles()).toHaveLength(4))
  act(() => ref.current?.run(command('REG'), 'replace'))
  await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
  expect(document.activeElement === document.body || !document.querySelector('[data-nqt-panel]')?.contains(document.activeElement)).toBe(true)
  return panelIds()[0] ?? ''
}

describe('Number <GO> runs its line in the panel the item belongs to (G03)', () => {
  it('replaces REG in panel 1 and keeps MT, even though no panel has real focus after the load', async () => {
    const { ref } = renderWorkspace()
    const stop = lineRunsIn(ref)
    const reg = await regLoadedWithoutFocus(ref)
    registerNumbered(reg, [{ n: 9, label: 'volmanaged_v0', run: () => requestLine('volmanaged_v0 DES') }])
    let ran = false
    act(() => {
      ran = activateNumbered(reg, 9)
    })
    stop()
    expect(ran).toBe(true)
    await waitFor(() => expect(panelTitles()).toEqual(['volmanaged_v0 DES', 'MT']))
  })

  it('leaves the replaced panel a history step: End returns to REG', async () => {
    const { ref } = renderWorkspace()
    const stop = lineRunsIn(ref)
    const reg = await regLoadedWithoutFocus(ref)
    registerNumbered(reg, [{ n: 9, label: 'volmanaged_v0', run: () => requestLine('volmanaged_v0 DES') }])
    act(() => {
      activateNumbered(reg, 9)
    })
    stop()
    await waitFor(() => expect(panelTitles()).toEqual(['volmanaged_v0 DES', 'MT']))
    let moved = false
    act(() => {
      moved = ref.current?.goBack(reg) ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
  })

  it('opens a numbered item that asks for a new panel beside the panel it belongs to', async () => {
    const { ref } = renderWorkspace()
    const stop = lineRunsIn(ref)
    const reg = await regLoadedWithoutFocus(ref)
    registerNumbered(reg, [{ n: 3, label: 'volmanaged_v0', run: () => requestLine('volmanaged_v0 DES', true) }])
    act(() => {
      activateNumbered(reg, 3)
    })
    stop()
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT', 'volmanaged_v0 DES']))
  })

  it('scopes only the item that runs: a typed line straight afterwards still loads the layout with no focus', async () => {
    const { ref } = renderWorkspace()
    const stop = lineRunsIn(ref)
    const reg = await regLoadedWithoutFocus(ref)
    registerNumbered(reg, [{ n: 9, label: 'volmanaged_v0', run: () => requestLine('volmanaged_v0 DES') }])
    act(() => {
      activateNumbered(reg, 9)
    })
    stop()
    await waitFor(() => expect(panelTitles()).toEqual(['volmanaged_v0 DES', 'MT']))
    // Nothing has real focus, and a typed line names no panel: a single panel screen loads, it does not
    // replace panel 1 and leave MT beside it.
    act(() => ref.current?.run(command('HELP'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['HELP']))
  })

  it('does not leave the scope set when the item throws', async () => {
    const { ref } = renderWorkspace()
    const reg = await regLoadedWithoutFocus(ref)
    registerNumbered(reg, [{ n: 5, label: 'boom', run: () => { throw new Error('boom') } }])
    expect(() => activateNumbered(reg, 5)).toThrow('boom')
    act(() => ref.current?.run(command('HELP'), 'replace'))
    // HELP is a single panel screen: with no focus and no scope it loads, replacing REG and MT.
    await waitFor(() => expect(panelTitles()).toEqual(['HELP']))
    expect(runningPanel()).toBeNull()
  })
})
