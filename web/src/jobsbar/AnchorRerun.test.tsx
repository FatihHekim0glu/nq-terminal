// @vitest-environment jsdom
// The anchor re-run control and its badge: the button, the progress through the shared job list, and the MATCH or
// MISMATCH result with the first differing field. The control draws nothing until the page provides a launcher.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import type { Schemas } from '../api/types'
import { onLineRequest, type LineRequest } from '../chrome/CommandLine.bus'
import { job } from '../screens/jobs/jobs.fixtures'
import type { JobView } from '../screens/jobs/types'
import AnchorBadge from './AnchorBadge'
import AnchorRerun from './AnchorRerun'
import { AnchorLauncherContext, resetAnchorReruns, type AnchorLauncher } from './anchorRerun.store'

type Pair = Schemas['AnchorComparison']
const SAME: Pair = {
  anchor: 't_base_regress_r1', base: 't_base', base_source: 'regress_check', base_found: true,
  n_trades_equal: true, pnl_total_equal: true, fees_total_equal: true,
  sharpe_anchor: 0.4644, sharpe_base: 0.4644, sharpe_equal: true, verdict: 'IDENTICAL', regress_check_identical: null,
}
type Check = Schemas['AnchorCheck']
const MATCHED: Check = {
  anchor: 't_base_regress_r1', base: 't_base', base_found: true, checks: [], first_difference: null,
  job_state: 'ok', note: 'exact', verdict: 'MATCH',
}
const NEW_RUN = 't_base_regress_r1'

function jobOf(state: JobView['state'], exit: number | null = null): JobView {
  return job({ id: 'j1', run_id: NEW_RUN, state, exit_code: exit, started: '2026-10-01T08:00:05Z', finished: state === 'running' || state === 'queued' ? null : '2026-10-01T08:00:20Z' })
}

interface World {
  job: JobView | null
  check: { status: number; body: unknown }
  checkReads: number
}
let world: World
let lines: LineRequest[]
let off: () => void

function mount(launch: AnchorLauncher | null, base = 't_base') {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  const utils = render(
    <ApiProvider client={client}>
      <AnchorLauncherContext value={launch}>
        <AnchorRerun baseRunId={base} />
      </AnchorLauncherContext>
    </ApiProvider>,
  )
  return { ...utils, client }
}

beforeEach(() => {
  world = { job: null, check: { status: 200, body: MATCHED }, checkReads: 0 }
  lines = []
  off = onLineRequest((r) => lines.push(r))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/jobs') return json({ jobs: world.job === null ? [] : [world.job], queue_cap: 10, queued: 0, running: 0, enabled: true })
    if (url === `/api/jobs/actions/anchors/${NEW_RUN}`) {
      world.checkReads += 1
      return json(world.check.body, world.check.status)
    }
    return json({ detail: `no route ${url}` }, 404)
  })
})
afterEach(() => {
  off()
  cleanup()
  resetAnchorReruns()
  vi.restoreAllMocks()
})

const launcher = (): AnchorLauncher => vi.fn(async () => {
  world.job = jobOf('queued')
  return { id: 'j1', run_id: NEW_RUN }
})

describe('AnchorRerun', () => {
  it('draws nothing until the page provides a launcher', () => {
    const { container } = mount(null)
    expect(container.textContent).toBe('')
  })

  it('offers the button, and a click asks the launcher for the base run exactly once', async () => {
    const launch = launcher()
    mount(launch)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run anchor, t_base' }))
    expect(launch).toHaveBeenCalledWith('t_base')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Anchor re-run t_base_regress_r1 is queued.'))
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('follows the job through running to the comparison and shows MATCH with Open in RUN', async () => {
    const { client } = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor, t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('running')
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is running'))
    expect(world.checkReads).toBe(0)
    world.job = jobOf('ok', 0)
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    await waitFor(() => expect(screen.getByRole('group', { name: 'Anchor re-run result' }).textContent).toContain('MATCH'))
    fireEvent.click(screen.getByRole('button', { name: `Open in RUN, ${NEW_RUN}` }))
    expect(lines.map((l) => l.line)).toEqual([`${NEW_RUN} RUN`])
  })

  it('every button name contains its visible text, before and after a finished re-run (WCAG 2.5.3 Label in Name)', async () => {
    const { client } = mount(launcher())
    const expectLabelsInNames = (visible: readonly string[]): void => {
      const buttons = screen.getAllByRole('button')
      expect(buttons.map((b) => b.textContent)).toEqual(visible)
      for (const button of buttons) expect((button.getAttribute('aria-label') ?? '').startsWith(button.textContent ?? '')).toBe(true)
    }
    expectLabelsInNames(['Re-run anchor'])
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('ok', 0)
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    await screen.findByRole('group', { name: 'Anchor re-run result' })
    expectLabelsInNames(['Re-run again', 'Open in RUN'])
  })

  it('shows MISMATCH with the first differing field', async () => {
    world.check = { status: 200, body: { ...MATCHED, verdict: 'MISMATCH', first_difference: 'pnl_total' } }
    const { client } = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor, t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('failed', 1)
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    const badge = await screen.findByRole('group', { name: 'Anchor re-run result' })
    expect(badge.textContent).toContain('MISMATCH')
    expect(badge.textContent).toContain('total P&L')
  })

  it('shows MISMATCH naming the trade field when only a trade row differs and every total is equal', async () => {
    const checks = [
      { field: 'n_trades', equal: true, anchor: 4, base: 4 },
      { field: 'trades', equal: false, anchor: '2024-01-02T10:00:00Z', base: '2024-01-02T09:30:00Z' },
      { field: 'pnl_total', equal: true, anchor: 10, base: 10 },
    ]
    world.check = { status: 200, body: { ...MATCHED, verdict: 'MISMATCH', first_difference: 'trades[1].entry_ts', checks } }
    const { client } = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run.*t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('ok', 0)
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    const badge = await screen.findByRole('group', { name: 'Anchor re-run result' })
    expect(badge.textContent).toContain('MISMATCH')
    expect(badge.textContent).not.toContain('MATCH:')
    expect(badge.textContent).toContain('trades[1].entry_ts')
  })

  it('says the comparison is not ready while the exact check answers PENDING', async () => {
    world.check = { status: 200, body: { ...MATCHED, verdict: 'PENDING', job_state: 'running' } }
    const { client } = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run.*t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('ok', 0)
    await act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Reading the comparison'))
    expect(screen.queryByRole('group', { name: 'Anchor re-run result' })).toBeNull()
  })

  it('says so when the run ended without a result, and when the comparison cannot be read', async () => {
    const first = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor, t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('error', 2)
    await act(async () => { await first.client.invalidateQueries({ queryKey: ['jobs'] }) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ended without a result (error)'))
    first.unmount()
    resetAnchorReruns()

    world.check = { status: 503, body: { detail: 'a result file could not be read' } }
    const second = mount(launcher())
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor, t_base/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is queued'))
    world.job = jobOf('ok', 0)
    await act(async () => { await second.client.invalidateQueries({ queryKey: ['jobs'] }) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('the comparison could not be read'))
  })

  it('shows a refusal in words as an alert and lets the button be used again', async () => {
    const launch = vi.fn<AnchorLauncher>(async () => { throw Object.assign(new Error('x'), { detail: 'the base run has parameters outside the allowed names' }) })
    mount(launch)
    fireEvent.click(screen.getByRole('button', { name: /Re-run anchor, t_base/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('The anchor re-run of t_base was not started: the base run has parameters outside the allowed names')
    expect(within(screen.getByRole('group', { name: 'Anchor re-run of t_base' })).getByRole('button', { name: /Re-run anchor, t_base/ })).toBeTruthy()
  })

  it('keeps one result per base: a second base on the page is unaffected', async () => {
    const launch = launcher()
    const client = createApiQueryClient()
    render(
      <ApiProvider client={client}>
        <AnchorLauncherContext value={launch}>
          <AnchorRerun baseRunId="t_base" />
          <AnchorRerun baseRunId="t_other" />
        </AnchorLauncherContext>
      </ApiProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Re-run anchor, t_base' }))
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Re-run anchor, t_other' })).toBeTruthy()
  })
})

describe('AnchorBadge', () => {
  it('writes the word and the clause, with colour only on top', () => {
    render(<AnchorBadge pair={{ ...SAME, verdict: 'DIFFERENT', n_trades_equal: false }} />)
    const group = screen.getByRole('group', { name: 'Anchor re-run result' })
    expect(group.textContent).toContain('MISMATCH')
    expect(group.textContent).toContain('the trade count')
    expect(group.querySelector('b')?.className).toContain('down')
  })
})
