// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { JRNL } from '../../copy/live'
import { stubLayout } from '../../grids/testing'
import { ALL_ROWS, BANNER, BOOK, BOOK_CLOSE_ROWS, PREFLIGHT, emptyStatus, page, status } from './liveFixtures'
import JrnlScreen from './JrnlScreen'

function json(body: unknown, code = 200): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } })
}

function routes(statusBody: unknown = status()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/live/status') return json(statusBody)
    if (url.pathname === '/api/live/journal') {
      const file = url.searchParams.get('file')
      const type = url.searchParams.get('type')
      const rows = ALL_ROWS.filter((r) => (file === null || r.file === file) && (type === null || r.data.type === type))
      return json(page(rows))
    }
    return json({ detail: 'unexpected' }, 404)
  })
}

function mount() {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <JrnlScreen params={{ code: 'JRNL', context: null, args: {}, group: '-' }} context={null} />
    </ApiProvider>,
  )
}

async function gridRows(): Promise<HTMLElement[]> {
  const grid = await screen.findByRole('grid', { name: /Journal rows/ })
  await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1))
  return within(grid).getAllByRole('row').slice(1)
}

beforeEach(() => stubLayout(600))
afterEach(() => cleanup())

describe('JRNL screen', () => {
  it('lists every journal row newest first, plumbing rows hatched with the exact banner', async () => {
    routes()
    mount()
    await waitFor(async () => expect((await gridRows()).length).toBe(ALL_ROWS.length))
    const rows = await gridRows()
    const plumbing = rows.filter((r) => r.classList.contains('plumbing-row'))
    expect(plumbing).toHaveLength(ALL_ROWS.filter((r) => r.plumbing).length)
    for (const r of plumbing) expect(r.textContent).toContain(BANNER)
    const performance = rows.filter((r) => !r.classList.contains('plumbing-row'))
    for (const r of performance) expect(r.textContent).not.toContain(BANNER)
    expect(rows[0]!.textContent).toContain('2026-10-02')
  })

  it('filters by file and by type through the API', async () => {
    const spy = routes()
    mount()
    await gridRows()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: BOOK }))
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes(`file=${encodeURIComponent(BOOK)}`))).toBe(true))
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.typeField }))
    fireEvent.click(await screen.findByRole('option', { name: 'close' }))
    await waitFor(async () => expect((await gridRows()).length).toBe(BOOK_CLOSE_ROWS.length))
    for (const [, init] of spy.mock.calls) expect(init?.method).toBe('GET')
  })

  it('marks a plumbing journal with its tag', async () => {
    routes()
    mount()
    await gridRows()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: `${PREFLIGHT} [PLUMBING]` }))
    expect(await screen.findByText('[PLUMBING]', { selector: '.jrnl-tag' })).toBeTruthy()
  })

  it('names the expected files when no journal is written yet, and asks for none of them', async () => {
    const spy = routes(emptyStatus())
    mount()
    expect(await screen.findByText(
      'no journal yet: live/logs/volmanaged_paper_journal.jsonl; no journal yet: live/logs/volmanaged_paper_journal.PLUMBING_DELAYED.jsonl',
    )).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: `${BOOK} (not yet written)` }))
    expect(await screen.findByText(`no journal yet: live/logs/${BOOK}`)).toBeTruthy()
    expect(spy.mock.calls.some(([u]) => String(u).includes(`file=${encodeURIComponent(BOOK)}`))).toBe(false)
  })

  it('shows the journal error detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).startsWith('/api/live/status') ? json(status()) : json({ detail: 'no journal named x in live/logs' }, 404))
    mount()
    expect(await screen.findByText('The journal could not be read: no journal named x in live/logs')).toBeTruthy()
  })
})
