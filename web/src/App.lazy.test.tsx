// @vitest-environment jsdom
// What App loads on demand (SHELL-DIET): the key map overlay and the event tape are lazy chunks, so the
// shell carries neither. They must still behave as they did when they were imported statically: the overlay
// opens from the key toolbar and from Alt+K, holds the drawn keyboard and the key table, and gives focus back
// when it closes. The tape's own flow (NO <GO>) is in App.test.tsx.
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetConnection } from './api/connection'
import { resetRecordWatchBoot, resetRecordWatchView } from './chrome/RecordWatch.live'
import { resetMessage } from './chrome/MessageLine.store'
import { KEYMAP, KEY_TOOLBAR } from './copy/chrome'
import { COMMAND_LINE } from './copy/commands'
import { HELP } from './copy/help'
import { useLayouts } from './state/layouts'
import { useLinkGroups } from './state/linkGroups'
import { useRecordWatchStore } from './state/recordWatch.store'

configure({ asyncUtilTimeout: 5000 })

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const HEALTH = {
  now_utc: '2026-09-26T12:00:00Z',
  nautilus_version: '1.231.0',
  pins: { pandas: '2.3.3', pyarrow: '25.0.1', quantpad_data: '0.8.0', nautilus: '1.231.0' },
  fence: { is_start: '2010-01-01', is_end: '2022-01-01' },
  sealed: { openings_pin_ok: true, sealed_log_pin_ok: true, openings_closed: true },
  kill_switch_on: false,
  gate_reads_this_process: 0,
  cache: { series: 0, bytes: 0 },
  fixture_mode: true,
}

const COMMANDS = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

function reply(url: string): Response {
  const body = url.startsWith('/api/health') ? HEALTH : url.startsWith('/api/commands') ? COMMANDS : null
  return new Response(JSON.stringify(body ?? { detail: 'not found' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } })
}

beforeAll(async () => {
  await import('./chrome/Workspace')
}, 30_000)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => reply(String(input))))
  Element.prototype.scrollIntoView = () => {}
  useLinkGroups.getState().clearAll()
  useLayouts.getState().resetAll()
  localStorage.clear()
  resetMessage()
  useRecordWatchStore.setState({ checkpoint: null })
  resetRecordWatchView()
  resetRecordWatchBoot()
})

afterEach(() => {
  cleanup()
  resetConnection()
})

describe('the key map overlay (Alt+K, the wrench on the key toolbar)', { timeout: 15_000 }, () => {
  it('opens from the key toolbar with the drawn keyboard and the key table, and Close shuts it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: KEY_TOOLBAR.keymap }))
    const dialog = await screen.findByRole('dialog', { name: KEYMAP.title })
    expect(within(dialog).getByRole('img', { name: HELP.keyboardLabel })).toBeTruthy()
    expect(within(dialog).getByRole('table', { name: HELP.keysCaption })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: KEYMAP.close }))
    expect(screen.queryByRole('dialog', { name: KEYMAP.title })).toBeNull()
  })

  it('opens and closes with Alt+K, and moves focus into the dialog and back to where it was', async () => {
    render(<App />)
    const input = screen.getByRole('combobox', { name: COMMAND_LINE.label })
    input.focus()
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', altKey: true })
    const dialog = await screen.findByRole('dialog', { name: KEYMAP.title })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: KEYMAP.title })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('stays out of the page until it is asked for', () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: KEYMAP.title })).toBeNull()
  })
})

describe('App does not import the on-demand chunks statically', () => {
  const sources = import.meta.glob<string>('/src/App.tsx', { query: '?raw', import: 'default', eager: true })
  const app = sources['/src/App.tsx'] ?? ''
  /** A static import of a module, not import('...') and not a comment that names it. */
  const staticImport = (name: string) => new RegExp(String.raw`^import\b[^\n]*\bfrom\s+['"][^'"]*/${name}['"]`, 'm').test(app)

  it.each(['EventTape.live', 'KeyToolbar.overlay'])('%s loads through a dynamic import', (name) => {
    expect(app.length).toBeGreaterThan(0)
    expect(staticImport(name), `${name} is imported statically`).toBe(false)
    expect(app.includes(`import('./chrome/${name}')`), `${name} has no dynamic import`).toBe(true)
  })

  /** The module specifier of every static import in App.tsx, side-effect and multi-line ones too; type-only imports leave no code. */
  const staticSpecifiers = [...app.matchAll(/^import\b(?!\s+type\b)(?:[^'"]*?\bfrom\s*|\s*)['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '')

  it('finds the static imports it looks through (so an empty list cannot pass)', () => {
    expect(staticSpecifiers.length).toBeGreaterThan(10)
    // A named import, and a side-effect import (no `from`), are both seen; a type-only import is not one.
    expect(staticSpecifiers).toContain('./chrome/KeyToolbar')
    expect(staticSpecifiers).toContain('./chrome/FrameStrip.frame.css')
    expect(staticSpecifiers).not.toContain('./chrome/Workspace')
  })

  // GRAB (roadmap 15): the panel image export is reached through the Workspace chunk (panelExport.ts) and, from
  // there, a dynamic import of export/grab/run. A static import from App would put its code and copy in the shell.
  it('has no static import of the panel image export (chrome/panelExport) or of anything under export/', () => {
    expect(app.length).toBeGreaterThan(0)
    expect(staticSpecifiers.filter((specifier) => specifier.endsWith('/panelExport')), 'panelExport is imported statically').toEqual([])
    expect(staticSpecifiers.filter((specifier) => specifier.includes('/export/')), 'export/ code is imported statically').toEqual([])
  })
})
