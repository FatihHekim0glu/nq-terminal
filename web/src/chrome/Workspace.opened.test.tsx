// @vitest-environment jsdom
// G14: a bare DES typed while the addressed panel is GP (which takes no hypothesis) parses with GP's own NQ,
// but the panel it opens shows its link group's hypothesis. After a run the Workspace tells the command line
// what the opened panel is called (CommandLine.bus reportOpened), when that is not the parsed line.
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { reportOpened, takeOpened } from './CommandLine.bus'
import { command, panelTitles, renderWorkspace, stubResizeObserver } from './WorkspaceNav.testUtil'

beforeAll(stubResizeObserver)

beforeEach(() => reportOpened(null))

afterEach(() => {
  cleanup()
  reportOpened(null)
})

const NQ = { kind: 'instrument' as const, value: 'NQ' }
const HYPOTHESIS = { kind: 'hypothesis' as const, value: 'volmanaged_v0' }
const bareDes = command('DES', { context: NQ, contextSource: 'link-group', canonical: 'NQ DES' })

async function homeWithGpFocused() {
  await waitFor(() => expect(panelTitles()).toHaveLength(4))
  act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
}

describe('what a run reports it opened (G14)', () => {
  it('names the group hypothesis a replaced panel shows, not the NQ the line parsed with', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithGpFocused()
    act(() => {
      linkGroups.getState().setContext('A', HYPOTHESIS)
    })
    act(() => ref.current?.run(bareDes, 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('volmanaged_v0 DES'))
    expect(takeOpened()).toBe('volmanaged_v0 DES')
  })

  it('names it for a new panel too, which joins the group of the addressed panel', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await homeWithGpFocused()
    act(() => {
      linkGroups.getState().setContext('A', HYPOTHESIS)
    })
    act(() => ref.current?.run(bareDes, 'new-panel'))
    await waitFor(() => expect(panelTitles()).toHaveLength(5))
    expect(panelTitles()[4]).toBe('volmanaged_v0 DES')
    expect(takeOpened()).toBe('volmanaged_v0 DES')
  })

  it('reports nothing when the panel shows exactly the line that ran', async () => {
    const { ref } = renderWorkspace()
    await homeWithGpFocused()
    act(() => ref.current?.run(bareDes, 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ DES'))
    expect(takeOpened()).toBeNull()
  })

  it('reports nothing after a layout load, and forgets an earlier report', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    reportOpened('left over from another run')
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    expect(takeOpened()).toBeNull()
  })
})
