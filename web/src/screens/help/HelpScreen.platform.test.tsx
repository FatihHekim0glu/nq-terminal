// @vitest-environment jsdom
// HELP reads the key rows of the running platform (D7.4) and links the third-party notices file (D7.3).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { HELP, helpKeysFor } from '../../copy/help'
import HelpScreen from './HelpScreen'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const actions: PanelActions = { panelId: 'help-main', related: () => false, back: () => false, forward: () => false, open: () => false }

function renderHelp() {
  return render(
    <PanelActionsContext value={actions}>
      <HelpScreen built={new Set(['HELP', 'HOME'])} />
    </PanelActionsContext>,
  )
}

function keyNames(): string[] {
  const table = screen.getByRole('table', { name: HELP.keysCaption })
  return within(table).getAllByRole('rowheader').map((cell) => cell.textContent ?? '')
}

describe('HELP on each platform', () => {
  it('names the PC keys on a PC and counts the PC rows', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    renderHelp()
    const names = keyNames()
    expect(names).toContain('Ctrl+K')
    expect(names).not.toContain('Cmd+K')
    expect(names).toHaveLength(helpKeysFor('pc').length)
  })

  it('names the Mac keys on a Mac: Cmd for Ctrl, the bracket pair, Option for Alt, and counts the Mac rows', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    renderHelp()
    const names = keyNames()
    expect(names).toContain('Cmd+K')
    expect(names).toContain('Cmd+[')
    expect(names).not.toContain('Ctrl+K')
    expect(names).toHaveLength(helpKeysFor('mac').length)
    expect(screen.getByRole('img', { name: HELP.keyboardLabel }).textContent).toContain('Option+1..9')
    expect(screen.getByRole('img', { name: HELP.keyboardLabel }).textContent).not.toContain('Alt+1..9')
  })
})

describe('HELP third-party notices', () => {
  const NOTICES = 'Third-party notices: nq-lab terminal PACKAGES react 19'

  function stubFetch(impl: (input: string) => Promise<Partial<Response>>) {
    const fetchMock = vi.fn<(input: string) => Promise<Partial<Response>>>(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('is a disclosure button, not a new-window link the desktop shell would deny', () => {
    renderHelp()
    expect(screen.getByRole('heading', { name: HELP.noticesHeading })).toBeTruthy()
    const button = screen.getByRole('button', { name: HELP.noticesLink })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: (name) => name.startsWith(HELP.noticesLink) })).toBeNull()
    expect(document.querySelector('a[href="third-party-notices.txt"]')).toBeNull()
    expect(document.body.textContent).not.toContain(`${HELP.noticesLink} ${HELP.newTab}`)
  })

  it('fetches the file same-origin on activation and shows it in a labelled, focusable region', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, text: async () => NOTICES }))
    renderHelp()
    const button = screen.getByRole('button', { name: HELP.noticesLink })
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const region = await screen.findByRole('region', { name: HELP.noticesRegion })
    expect(region.textContent).toContain('PACKAGES')
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/third-party-notices\.txt$/)
    expect(button.getAttribute('aria-controls')).toBe(region.id)
  })

  it('announces the failure when the file cannot be read, and hides again on a second activation', async () => {
    stubFetch(async () => ({ ok: false, status: 404, text: async () => '' }))
    renderHelp()
    const button = screen.getByRole('button', { name: HELP.noticesLink })
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(HELP.noticesFailed)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
