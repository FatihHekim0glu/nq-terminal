// @vitest-environment jsdom
// The anchor re-run region: closed it draws and reads nothing; opened it names the base, says the comparison is not the
// formal regress_check file, takes the focus on the re-run button, posts exactly one anchor action for that base, and
// Escape closes it with the focus back where it was.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { useAnchorPanel } from './AnchorPanel'
import { resetAnchorReruns } from './anchorRerun.store'

const BASE = 'nt_za_v0_fixture'
const NEW_RUN = `t_${BASE}_regress_r1`
const JOB = {
  id: 'j_000000000001', run_id: NEW_RUN, state: 'queued', exit_code: null, created: '2026-10-05T00:00:00+00:00', started: null, finished: null,
  message: '', log_tail: [], spec: { strategy: 'za_orb', params: {}, variant: 'repaired', start: '2010-09-28', end: '2022-01-01', run_id: NEW_RUN },
}

interface Sent { readonly url: string; readonly method: string; readonly body: unknown; readonly header: string | null }
let sent: Sent[]

function Host() {
  const anchor = useAnchorPanel()
  return (
    <div>
      <button type="button" onClick={() => anchor.open(BASE)}>Open anchor panel</button>
      {anchor.panel}
    </div>
  )
}

beforeEach(() => {
  sent = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, header: headers.get('X-NQT') })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/jobs/actions') return json({ kind: 'anchor', job: JOB, action: { kind: 'anchor', base_run_id: BASE }, preset_id: null, base_run_id: BASE, changed_params: [] }, 201)
    if (url === '/api/jobs') return json({ jobs: [JOB], queue_cap: 10, queued: 1, running: 0, enabled: true })
    return json({ detail: `no route ${url}` }, 404)
  })
})
afterEach(() => {
  cleanup()
  resetAnchorReruns()
  vi.restoreAllMocks()
})

function mount() {
  render(
    <ApiProvider client={createApiQueryClient()}>
      <Host />
    </ApiProvider>,
  )
}

describe('the anchor panel', () => {
  it('draws and reads nothing while it is closed', () => {
    mount()
    expect(screen.queryByRole('region')).toBeNull()
    expect(sent).toEqual([])
  })

  it('opens on the re-run button, names the base and says what the comparison is', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open anchor panel' }))
    const region = screen.getByRole('region', { name: `Regression anchor re-run of ${BASE}` })
    expect(region.textContent).toContain('not the formal regress_check file')
    expect(region.textContent).toContain('It writes no ledger row')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Re-run anchor, ${BASE}` }))
  })

  it('posts one anchor action for the base, with the write header, and follows the job', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open anchor panel' }))
    fireEvent.click(screen.getByRole('button', { name: `Re-run anchor, ${BASE}` }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(`Anchor re-run ${NEW_RUN} is queued.`))
    const writes = sent.filter((s) => s.method !== 'GET')
    expect(writes).toEqual([{ url: '/api/jobs/actions', method: 'POST', body: { kind: 'anchor', base_run_id: BASE }, header: '1' }])
  })

  it('closes on Escape and hands the focus back to the button that opened it', () => {
    mount()
    const opener = screen.getByRole('button', { name: 'Open anchor panel' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole('button', { name: `Re-run anchor, ${BASE}` }), { key: 'Escape' })
    expect(screen.queryByRole('region')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes with the Close button', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open anchor panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region')).toBeNull()
  })
})
