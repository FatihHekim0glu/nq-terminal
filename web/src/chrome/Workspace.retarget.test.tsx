// @vitest-environment jsdom
// U21: a context-only line (or anything else outside run()) that retargets a link group changed what the
// panels of that group show, but no panel history recorded it, so End said 'Nothing to go back to in this
// panel.' The typing panel, and every panel of the group that visibly changed, now keep a step that puts the
// group's context back (and forward again). HOME: GP and MON share link group A; MON takes a universe, so it
// does not change when the group moves to another instrument, yet End in it must still undo the retarget.
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { WorkspaceHandle } from './Workspace'
import { command, panelTitles, renderWorkspace, stubResizeObserver } from './WorkspaceNav.testUtil'

beforeAll(stubResizeObserver)

afterEach(cleanup)

const ES = { kind: 'instrument' as const, value: 'ES' }
const CL = { kind: 'instrument' as const, value: 'CL' }

/** HOME loaded, with the MON panel (the typing panel of a context-only line) focused. */
async function homeWithMonFocused() {
  await waitFor(() => expect(panelTitles()).toHaveLength(4))
  act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
}

function goBack(ref: { current: WorkspaceHandle | null }, id: string): boolean {
  let moved = false
  act(() => {
    moved = ref.current?.goBack(id) ?? false
  })
  return moved
}

describe('a link group retarget from outside run() is a step in the panel histories (U21)', () => {
  it('End in the typing panel (MON, which does not change itself) puts the group and its GP back', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    expect(panelTitles()[0]).toBe('NQ GP 1d')
    act(() => {
      linkGroups.getState().setContext('A', ES)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('NQ')
    expect(panelTitles()[1]).toBe('27F MON')
  })

  it('End in the other panel of the group that changed (GP) does the same', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    act(() => {
      linkGroups.getState().setContext('A', ES)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(goBack(ref, 'home-gp')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('NQ')
  })

  it('the step is used once: after End in one panel, the other panel has nothing left to go back to', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    act(() => {
      linkGroups.getState().setContext('A', ES)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(goBack(ref, 'home-gp')).toBe(false)
    expect(goBack(ref, 'home-mon')).toBe(false)
  })

  it('forward puts the retarget back again', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    act(() => {
      linkGroups.getState().setContext('A', ES)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    let ahead = false
    act(() => {
      ahead = ref.current?.goForward('home-mon') ?? false
    })
    expect(ahead).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('ES')
  })

  it('two retargets in a row are undone one at a time, newest first', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    act(() => {
      linkGroups.getState().setContext('A', ES)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    act(() => {
      linkGroups.getState().setContext('A', CL)
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('CL GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(goBack(ref, 'home-mon')).toBe(false)
  })

  it('a typed context on a run is one step, not two: End goes back once and is then done', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => ref.current?.run(command('GP', { context: ES, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(goBack(ref, 'home-gp')).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('NQ')
    expect(goBack(ref, 'home-gp')).toBe(false)
    // MON followed the group in neither direction and kept no step of its own from this run.
    expect(goBack(ref, 'home-mon')).toBe(false)
  })

  it('a layout load seeds the link groups without leaving a step behind', async () => {
    const { ref } = renderWorkspace()
    await homeWithMonFocused()
    expect(goBack(ref, 'home-gp')).toBe(false)
    expect(goBack(ref, 'home-mon')).toBe(false)
  })

  it('a retarget that changes nothing a panel shows leaves that panel with no step, unless it is the typing panel', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithMonFocused()
    // Link group B belongs to EQ alone: moving it changes EQ, and MON (the typing panel) is not in it.
    act(() => {
      linkGroups.getState().setContext('B', { kind: 'hypothesis', value: 'overnight_v0' })
    })
    await waitFor(() => expect(panelTitles()[2]).toBe('overnight_v0 EQ'))
    expect(goBack(ref, 'home-eq')).toBe(true)
    await waitFor(() => expect(panelTitles()[2]).toBe('volmanaged_v0 EQ'))
    expect(goBack(ref, 'home-mon')).toBe(false)
    expect(goBack(ref, 'home-gp')).toBe(false)
  })
})
