// @vitest-environment jsdom
// The global job indicator: its five states (none, running, queued, finished, failed), the finish notice (a live
// region, Open in RUN, Dismiss), and the rule that a job is announced once and a reload does not replay old news.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { onLineRequest, type LineRequest } from '../chrome/CommandLine.bus'
import { job } from '../screens/jobs/jobs.fixtures'
import type { JobView } from '../screens/jobs/types'
import JobIndicator, { JobIndicatorView } from './JobIndicator'
import { useState } from 'react'
import { noticeFor, type FinishNotice } from './model'
import { useTickingNow } from './useJobIndicator'

const T0 = Date.parse('2026-10-01T08:00:20Z')

type Strategy = JobView['spec']['strategy']

function ran(id: string, strategy: Strategy, seconds: number, patch: Partial<JobView> = {}): JobView {
  const started = '2026-10-01T07:00:00Z'
  const finished = new Date(Date.parse(started) + seconds * 1000).toISOString()
  return job({ id, run_id: `t_${id}`, state: 'ok', exit_code: 0, started, finished, spec: { ...job({}).spec, strategy }, ...patch })
}
const running = (id = 'r', strategy: Strategy = 'tsmom') =>
  job({ id, run_id: `t_${id}`, state: 'running', created: '2026-10-01T08:00:00Z', started: '2026-10-01T08:00:05Z', spec: { ...job({}).spec, strategy } })
const queued = (id: string, created = '2026-10-01T08:00:10Z') => job({ id, run_id: `t_${id}`, state: 'queued', created })

function view(jobs: readonly JobView[], over: Partial<Parameters<typeof JobIndicatorView>[0]> = {}) {
  const props = { jobs, notices: [], nowMs: T0, onOpenRun: vi.fn(), onOpenJobs: vi.fn(), onDismiss: vi.fn(), ...over }
  return { ...render(<JobIndicatorView {...props} />), props }
}

afterEach(() => cleanup())

describe('JobIndicatorView states', () => {
  it('none: draws no row, leaves the live region empty and says so in data-state', () => {
    const { container } = view([ran('a', 'tsmom', 20)])
    expect(container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')).toBe('none')
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('running: names the run, the elapsed time, the typical time of past runs of that strategy and the others waiting', () => {
    const past = [ran('p1', 'tsmom', 10), ran('p2', 'tsmom', 20), ran('p3', 'overnight', 900)]
    const { container } = view([running(), queued('q1'), ...past])
    const row = screen.getByRole('group', { name: 'Backtest jobs' })
    expect(container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')).toBe('running')
    expect(row.textContent).toContain('RUNNING')
    expect(row.textContent).toContain('t_r (tsmom)')
    expect(row.textContent).toContain('elapsed 15 s')
    expect(row.textContent).toContain('typical 15 s')
    expect(row.textContent).toContain('1 more in the queue')
  })

  it('running with no past run of the strategy says there is no typical time yet', () => {
    view([running('r', 'eomtsy')])
    expect(screen.getByRole('group', { name: 'Backtest jobs' }).textContent).toContain('no typical time yet')
  })

  it('queued: counts the wait from the time the job was queued and leads with the earliest', () => {
    const { container } = view([queued('q2', '2026-10-01T08:00:12Z'), queued('q1', '2026-10-01T08:00:10Z')])
    const row = screen.getByRole('group', { name: 'Backtest jobs' })
    expect(container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')).toBe('queued')
    expect(row.textContent).toContain('QUEUED')
    expect(row.textContent).toContain('t_q1 (tsmom)')
    expect(row.textContent).toContain('waiting 10 s')
    expect(row.textContent).toContain('1 more in the queue')
  })

  it('finished: a notice in words with Open in RUN, announced in the live region', () => {
    const notice = noticeFor(ran('a', 'tsmom', 12))!
    const { container, props } = view([], { notices: [notice] })
    expect(container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')).toBe('finished')
    const group = screen.getByRole('group', { name: 'Finished backtest jobs' })
    expect(group.textContent).toContain('Finished: t_a (tsmom), OK in 12 s.')
    expect(screen.getByRole('status').textContent).toBe('Finished: t_a (tsmom), OK in 12 s.')
    fireEvent.click(within(group).getByRole('button', { name: 'Open in RUN, t_a' }))
    expect(props.onOpenRun).toHaveBeenCalledWith('t_a')
  })

  it('failed checks: still opens the run, the words say the result is written', () => {
    const notice = noticeFor(ran('b', 'tsmom', 70, { state: 'failed', exit_code: 1 }))!
    const { container } = view([], { notices: [notice] })
    expect(container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')).toBe('failed')
    expect(screen.getByRole('group', { name: 'Finished backtest jobs' }).textContent).toContain('failed checks')
    expect(screen.getByRole('button', { name: 'Open in RUN, t_b' })).toBeTruthy()
  })

  it('an error end has no Open in RUN (no result was written) and still offers Dismiss', () => {
    const notice = noticeFor(ran('c', 'tsmom', 5, { state: 'error', exit_code: 2 }))!
    const { props } = view([], { notices: [notice] })
    expect(screen.queryByRole('button', { name: /Open in RUN, t_c/ })).toBeNull()
    expect(screen.getByRole('group', { name: 'Finished backtest jobs' }).textContent).toContain('exit 2')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the finish notice' }))
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows the latest notice and counts the earlier ones', () => {
    const notices = [noticeFor(ran('a', 'tsmom', 5))!, noticeFor(ran('b', 'tsmom', 6))!]
    view([], { notices })
    const group = screen.getByRole('group', { name: 'Finished backtest jobs' })
    expect(group.textContent).toContain('t_b')
    expect(group.textContent).toContain('and 1 earlier')
  })

  it('has an Open JOBS button for the whole queue', () => {
    const { props } = view([running()])
    fireEvent.click(screen.getByRole('button', { name: 'Open JOBS, the whole queue' }))
    expect(props.onOpenJobs).toHaveBeenCalledTimes(1)
  })

  it('every button name contains its visible text (WCAG 2.5.3 Label in Name)', () => {
    view([running()], { notices: [noticeFor(ran('a', 'tsmom', 12))!] })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Open JOBS', 'Open in RUN', 'Dismiss'])
    for (const button of buttons) {
      expect(button.getAttribute('aria-label') ?? '').toContain(button.textContent ?? '')
      expect((button.getAttribute('aria-label') ?? '').startsWith(button.textContent ?? '')).toBe(true)
    }
  })
})

describe('JobIndicatorView focus after the notice goes (WCAG 2.4.3)', () => {
  const finishedNotice = () => noticeFor(ran('a', 'tsmom', 12))!

  // A parent that drops the notices on Dismiss, as the real hook does; `jobs` stays whatever the test passes.
  function Harness({ jobs }: { readonly jobs: readonly JobView[] }) {
    const [notices, setNotices] = useState<readonly FinishNotice[]>([finishedNotice()])
    return (
      <>
        <input id="cmd" aria-label="Command line" />
        <JobIndicatorView jobs={jobs} notices={notices} nowMs={T0} onOpenRun={() => setNotices([])} onOpenJobs={() => undefined} onDismiss={() => setNotices([])} />
      </>
    )
  }

  it('Dismiss with a job still active moves focus to Open JOBS, not the document body', () => {
    render(<Harness jobs={[running()]} />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss the finish notice' })
    dismiss.focus()
    expect(document.activeElement).toBe(dismiss)
    fireEvent.click(dismiss)
    expect(screen.queryByRole('group', { name: 'Finished backtest jobs' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Open JOBS/ }))
  })

  it('Dismiss with nothing active moves focus to the command line', () => {
    render(<Harness jobs={[]} />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss the finish notice' })
    dismiss.focus()
    fireEvent.click(dismiss)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Command line' }))
  })

  it('Open in RUN that leaves focus on the body falls back to the command line', () => {
    render(<Harness jobs={[]} />)
    const open = screen.getByRole('button', { name: /RUN.*t_a|t_a.*RUN/ })
    open.focus()
    fireEvent.click(open)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Command line' }))
  })

  it('does not take focus from a control the owner chose elsewhere', () => {
    render(<Harness jobs={[running()]} />)
    const input = screen.getByRole('textbox', { name: 'Command line' })
    input.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the finish notice' }))
    expect(document.activeElement).toBe(input)
  })
})

describe('useTickingNow', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }))
  afterEach(() => vi.useRealTimers())

  it('ticks every second while active and stops when not', () => {
    vi.setSystemTime(T0)
    const { result, rerender } = renderHook(({ active }) => useTickingNow(active), { initialProps: { active: true } })
    expect(result.current).toBe(T0)
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current).toBe(T0 + 3000)
    rerender({ active: false })
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(T0 + 3000)
  })
})

describe('JobIndicator (reads the job list)', () => {
  let world: { jobs: JobView[]; enabled: boolean; status: number }
  let lines: LineRequest[]
  let off: () => void
  let client: QueryClient

  function mount() {
    client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    return render(
      <ApiProvider client={client}>
        <JobIndicator />
      </ApiProvider>,
    )
  }
  const reread = () => act(async () => { await client.invalidateQueries({ queryKey: ['jobs'] }) })

  beforeEach(() => {
    world = { jobs: [], enabled: true, status: 200 }
    lines = []
    off = onLineRequest((r) => lines.push(r))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/jobs') {
        const body = world.status === 200 ? { jobs: world.jobs, queue_cap: 10, queued: 0, running: 0, enabled: world.enabled } : { detail: 'off' }
        return new Response(JSON.stringify(body), { status: world.status, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ detail: `no route ${url}` }), { status: 404, headers: { 'content-type': 'application/json' } })
    })
  })
  afterEach(() => {
    off()
    vi.restoreAllMocks()
  })

  const state = (container: HTMLElement) => container.querySelector('[data-chrome="jobs"]')?.getAttribute('data-state')

  it('shows a running job from the list', async () => {
    world.jobs = [running()]
    const { container } = mount()
    await waitFor(() => expect(state(container)).toBe('running'))
    expect(screen.getByRole('group', { name: 'Backtest jobs' }).textContent).toContain('t_r (tsmom)')
  })

  it('announces a job that ends, once, and Open in RUN sends the run line and clears the notice', async () => {
    world.jobs = [running()]
    const { container } = mount()
    await waitFor(() => expect(state(container)).toBe('running'))
    world.jobs = [ran('r', 'tsmom', 15)]
    await reread()
    await waitFor(() => expect(state(container)).toBe('finished'))
    expect(screen.getByRole('status').textContent).toMatch(/^Finished: t_r \(tsmom\), OK in 15 s\.$/)
    await reread()
    expect(screen.getAllByRole('button', { name: 'Open in RUN, t_r' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open in RUN, t_r' }))
    expect(lines.map((l) => l.line)).toEqual(['t_r RUN'])
    await waitFor(() => expect(state(container)).toBe('none'))
    await reread()
    expect(state(container)).toBe('none')
  })

  it('does not replay a job that had already ended when the page first read the list', async () => {
    world.jobs = [ran('old', 'tsmom', 15)]
    const { container } = mount()
    await waitFor(() => expect(client.getQueryData(['jobs', 'list'])).toBeTruthy())
    await reread()
    expect(state(container)).toBe('none')
  })

  it('a job queued behind another is announced when it ends too', async () => {
    world.jobs = [running('a'), queued('b')]
    const { container } = mount()
    await waitFor(() => expect(state(container)).toBe('running'))
    world.jobs = [ran('a', 'tsmom', 10), ran('b', 'tsmom', 12, { state: 'failed', exit_code: 1 })]
    await reread()
    await waitFor(() => expect(state(container)).toBe('failed'))
    expect(screen.getByRole('group', { name: 'Finished backtest jobs' }).textContent).toContain('and 1 earlier')
  })

  it('stays silent while the runner is off and when the server does not answer', async () => {
    world.enabled = false
    const first = mount()
    await waitFor(() => expect(client.getQueryData(['jobs', 'list'])).toBeTruthy())
    expect(state(first.container)).toBe('none')
    first.unmount()
    world.status = 503
    const second = mount()
    await waitFor(() => expect(client.getQueryState(['jobs', 'list'])?.status).toBe('error'))
    expect(state(second.container)).toBe('none')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
