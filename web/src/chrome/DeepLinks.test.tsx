// @vitest-environment jsdom
// DeepLinks (shell diet 3, roadmap wave 9): the component that mounts useDeepLinks. The shell reaches it only through a
// dynamic import from AppCommandBar.tsx, so the link reader, its allowlist and its copy stay out of first paint.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandIndexData } from '../commands/types'
import { LINKS } from '../copy/links'
import { onLineRequest, type LineRequest } from './CommandLine.bus'
import DeepLinks from './DeepLinks'
import { markWorkspaceReady, resetWorkspaceReady } from './deepLink'
import { resetMessage, useMessage } from './MessageLine.store'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [],
  universe: ['27F'],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}
const commands = vi.hoisted(() => ({ current: { status: 'success', data: undefined } as { status: string; data: unknown } }))
vi.mock('../api/queries', () => ({ useCommands: () => commands.current }))

let requests: LineRequest[] = []
let stop = () => {}

beforeEach(() => {
  requests = []
  stop = onLineRequest((r) => requests.push(r))
  commands.current = { status: 'success', data: INDEX }
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  stop()
  resetWorkspaceReady()
  resetMessage()
  window.history.replaceState(null, '', '/')
})

describe('DeepLinks', () => {
  it('renders nothing', () => {
    const { container } = render(<DeepLinks />)
    expect(container.firstChild).toBeNull()
  })

  it('reads a #go link from the address bar, consumes it and runs it once the workspace is ready', async () => {
    window.history.replaceState(null, '', '/#go=REG')
    render(<DeepLinks />)
    await act(async () => {})
    expect(window.location.hash).toBe('')
    expect(requests).toEqual([])
    await act(async () => markWorkspaceReady())
    expect(requests.map((r) => [r.line, r.newPanel])).toEqual([['REG', false]])
  })

  it('refuses a link that holds no command, in words', async () => {
    window.history.replaceState(null, '', '/#go=%00')
    render(<DeepLinks />)
    await act(async () => {})
    expect(useMessage.getState().text).toBe(LINKS.refused)
    expect(requests).toEqual([])
  })
})
