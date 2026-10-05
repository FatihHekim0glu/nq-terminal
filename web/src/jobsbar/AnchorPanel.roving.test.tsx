// @vitest-environment jsdom
// The anchor region inside a real panel (RUN and LEDG draw it in a PanelChrome that runs the roving Tab stop): its three
// buttons (Re-run, Open in RUN, Close) must be roving items, or the panel parks them at tabindex -1 and the keyboard
// cannot reach them (WCAG 2.1.1). The other anchor tests mount it bare, which hides this.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import PanelChrome from '../chrome/PanelChrome'
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import { useAnchorPanel } from './AnchorPanel'
import { resetAnchorReruns } from './anchorRerun.store'
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'

const BASE = 'nt_za_v0_fixture'
const NEW_RUN = `t_${BASE}_regress_r1`
const JOB = (state: string) => ({
  id: 'j_000000000001', run_id: NEW_RUN, state, exit_code: state === 'ok' ? 0 : null, created: '2026-10-05T00:00:00+00:00', started: null, finished: null,
  message: '', log_tail: [], spec: { strategy: 'za_orb', params: {}, variant: 'repaired', start: '2010-09-28', end: '2022-01-01', run_id: NEW_RUN },
})
const RERUN = fillCopy(JOBS_BAR.rerun.buttonLabel, { base: BASE })
const OPEN_RUN = fillCopy(JOBS_BAR.rerun.openRun, { run: NEW_RUN })
let jobState: string

function Host() {
  const anchor = useAnchorPanel()
  return (
    <PanelChrome panelId="p1" number={1} code="RUN" title="RUN" group="-">
      <button type="button" data-roving="" onClick={() => anchor.open(BASE)}>Open anchor panel</button>
      {anchor.panel}
    </PanelChrome>
  )
}

beforeEach(() => {
  jobState = 'queued'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/jobs/actions') return json({ kind: 'anchor', job: JOB(jobState), action: { kind: 'anchor', base_run_id: BASE }, preset_id: null, base_run_id: BASE, changed_params: [] }, 201)
    if (url === '/api/jobs') return json({ jobs: [JOB(jobState)], queue_cap: 10, queued: 1, running: 0, enabled: true })
    return json({ detail: `no route ${url}` }, 404)
  })
})
afterEach(() => {
  cleanup()
  resetAnchorReruns()
  vi.restoreAllMocks()
})

function open() {
  render(
    <ApiProvider client={createApiQueryClient()}>
      <Host />
    </ApiProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open anchor panel' }))
}

describe('the anchor region inside a panel', () => {
  it('makes the Re-run and Close buttons roving items that the arrow keys reach', async () => {
    open()
    const rerun = screen.getByRole('button', { name: RERUN })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(rerun.hasAttribute(ROVING_ATTR)).toBe(true)
    expect(close.hasAttribute(ROVING_ATTR)).toBe(true)
    await act(async () => { await Promise.resolve() })
    rerun.focus()
    fireEvent.keyDown(rerun, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(close))
  })

  it('keeps the Re-run button reachable while the job runs, and ignores a second press', async () => {
    open()
    const rerun = screen.getByRole('button', { name: RERUN })
    fireEvent.click(rerun)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    expect(rerun.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(rerun)
    const posts = vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(1)
  })

  it('makes the Open in RUN button a roving item once the run has finished', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: RERUN }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    jobState = 'ok'
    const openRun = await screen.findByRole('button', { name: OPEN_RUN }, { timeout: 8000 })
    expect(openRun.hasAttribute(ROVING_ATTR)).toBe(true)
  }, 15000)
})
