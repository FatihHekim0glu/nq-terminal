// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { handleRovingKey, syncRoving } from '../../chrome/WorkspaceFocus'
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import { mountScreen } from '../runs/testing'
import { JOB_FIXTURES, detail, job } from './jobs.fixtures'
import JobsScreen from './JobsScreen'
import type { JobDetail, JobView } from './types'

const PROPS = { params: {} as never, context: null }
const POST = /^post$/i
const DELETE = /^delete$/i

interface Call { readonly url: string; readonly method: string; readonly headers: Headers; readonly body: unknown }
interface World {
  jobs: readonly JobView[]
  cap: number
  details: Record<string, JobDetail>
  runs: readonly string[]
  listStatus: number
  enabled: boolean
  queueAnswer: { status: number; body: unknown }
  stopAnswer: { status: number; body: unknown }
  /** When set, the queue request waits for it (a request in flight). */
  hold: Promise<Response> | null
}

let calls: Call[] = []
let world: World

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function install(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = String(init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, headers: new Headers(init?.headers), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    if (url === '/api/jobs' && method === 'GET') {
      return world.listStatus === 200 ? reply({ jobs: world.jobs, queue_cap: world.cap, queued: world.jobs.filter((j) => j.state === 'queued').length, running: world.jobs.filter((j) => j.state === 'running').length, enabled: world.enabled }) : reply({ detail: 'job runner off' }, world.listStatus)
    }
    if (url === '/api/jobs' && POST.test(method)) return world.hold ?? reply(world.queueAnswer.body, world.queueAnswer.status)
    const one = /^\/api\/jobs\/([^/?]+)$/.exec(url)
    if (one && method === 'GET') {
      const d = world.details[one[1] ?? '']
      return d ? reply(d) : reply({ detail: 'no such job' }, 404)
    }
    if (one && DELETE.test(method)) return reply(world.stopAnswer.body, world.stopAnswer.status)
    if (url === '/api/runs') return reply(world.runs.map((run_id) => ({ run_id })))
    return reply({ detail: `no route ${url}` }, 404)
  })
}

const writes = () => calls.filter((c) => c.method !== 'GET')
const rowOf = (runId: string) => screen.getByRole('row', { name: new RegExp(`\\b${runId}\\b`) })

beforeEach(() => {
  calls = []
  world = {
    jobs: JOB_FIXTURES,
    cap: 10,
    details: {
      j7: detail({ id: 'j7', run_id: 't_run', state: 'running' }, ['line one', 'line two <b>bold</b>']),
      j5: detail({ id: 'j5', run_id: 't_broken', state: 'error', exit_code: 2 }, ['Traceback', 'ValueError: boom']),
    },
    runs: ['nt_old_run'],
    listStatus: 200,
    enabled: true,
    queueAnswer: { status: 202, body: job({ id: 'j10', run_id: 't_new' }) },
    stopAnswer: { status: 200, body: job({ id: 'j8', run_id: 't_wait_a', state: 'stopped' }) },
    hold: null,
  }
  install()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function loaded() {
  mountScreen(<JobsScreen {...PROPS} />)
  await screen.findByRole('table', { name: JOBS.table.caption })
}

/** A label that starts with these words (the control's name), with the regular expression characters escaped. */
function labelled(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(labelled(label)), { target: { value } })
}

describe('the queue table', () => {
  it('shows every job with its words for the status, and the queue counts', async () => {
    await loaded()
    const table = screen.getByRole('table', { name: JOBS.table.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + JOB_FIXTURES.length)
    expect(within(rowOf('t_run')).getByText('RUNNING')).toBeTruthy()
    expect(within(rowOf('t_wait_a')).getByText('QUEUED')).toBeTruthy()
    expect(within(rowOf('t_done')).getByText('OK')).toBeTruthy()
    expect(within(rowOf('t_checks')).getByText('FAILED CHECKS')).toBeTruthy()
    expect(within(rowOf('t_broken')).getByText('ERROR')).toBeTruthy()
    expect(within(rowOf('t_stopped')).getByText('STOPPED')).toBeTruthy()
    expect(screen.getByText(fillCopy(JOBS.counts, { running: 1, queued: 2, cap: 10 }))).toBeTruthy()
  })

  it('says so when there are no jobs, and reads only (a GET) on load', async () => {
    world.jobs = []
    mountScreen(<JobsScreen {...PROPS} />)
    expect(await screen.findByText(JOBS.table.empty)).toBeTruthy()
    expect(writes()).toEqual([])
  })

  it('says it is loading as a busy status, so a screen reader and the browser tests wait for the queue', async () => {
    mountScreen(<JobsScreen {...PROPS} />)
    const busy = screen.getByText(JOBS.loading)
    expect(busy.getAttribute('role')).toBe('status')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await screen.findByRole('table', { name: JOBS.table.caption })
    expect(screen.queryByText(JOBS.loading)).toBeNull()
  })

  it('states an unavailable runner in words, as an alert', async () => {
    world.listStatus = 503
    mountScreen(<JobsScreen {...PROPS} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(JOBS.unavailable, { detail: 'job runner off' }))
  })

  it('says in words that the runner is off when the list says it is not enabled, and offers no form', async () => {
    world.enabled = false
    mountScreen(<JobsScreen {...PROPS} />)
    expect((await screen.findByText(JOBS.runnerOff)).getAttribute('role')).toBe('status')
    expect(screen.queryByRole('button', { name: JOBS.form.queue })).toBeNull()
    expect(writes()).toEqual([])
  })

  it('states any other load failure with the server detail', async () => {
    world.listStatus = 500
    mountScreen(<JobsScreen {...PROPS} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(JOBS.loadError, { detail: 'job runner off' }))
  })
})

describe('a poll that fails after the queue was read', () => {
  it('keeps the form draft, the chosen log and the open stop question, and names the failure above them', async () => {
    await loaded()
    fill(JOBS.form.runId, 't_draft')
    fill(JOBS.form.params, '{"ticks": 2}')
    fireEvent.click(within(rowOf('t_run')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_run' }) }))
    await screen.findByRole('region', { name: fillCopy(JOBS.log.label, { runId: 't_run' }) })
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) }))
    world.listStatus = 500
    const alert = await screen.findByText(fillCopy(JOBS.loadError, { detail: 'job runner off' }), {}, { timeout: 6000 })
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    expect((screen.getByLabelText(labelled(JOBS.form.runId)) as HTMLInputElement).value).toBe('t_draft')
    expect((screen.getByLabelText(labelled(JOBS.form.params)) as HTMLTextAreaElement).value).toBe('{"ticks": 2}')
    expect(screen.getByRole('table', { name: JOBS.table.caption })).toBeTruthy()
    expect(screen.getByRole('region', { name: fillCopy(JOBS.log.label, { runId: 't_run' }) })).toBeTruthy()
    expect(within(rowOf('t_wait_a')).getByText(fillCopy(JOBS.row.confirm, { runId: 't_wait_a' }))).toBeTruthy()
  }, 12000)
})

describe('the log tail', () => {
  it('reads a job log on request and shows it as text, never as markup', async () => {
    await loaded()
    expect(screen.getByText(JOBS.log.none)).toBeTruthy()
    fireEvent.click(within(rowOf('t_run')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_run' }) }))
    const log = await screen.findByRole('region', { name: fillCopy(JOBS.log.label, { runId: 't_run' }) })
    await waitFor(() => expect(log.textContent).toContain('line two <b>bold</b>'))
    expect(log.querySelector('b')).toBeNull()
    expect(log.getAttribute('tabindex')).toBe('0')
    expect(calls.some((c) => c.url === '/api/jobs/j7' && c.method === 'GET')).toBe(true)
  })

  it('marks the chosen row as pressed and shows the empty note for a log with no lines', async () => {
    world.details.j3 = detail({ id: 'j3', run_id: 't_done', state: 'ok', exit_code: 0 }, [])
    await loaded()
    const button = within(rowOf('t_done')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_done' }) })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(await screen.findByText(JOBS.log.empty)).toBeTruthy()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('names a log that could not be read', async () => {
    await loaded()
    fireEvent.click(within(rowOf('t_stopped')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_stopped' }) }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(JOBS.log.loadError, { detail: 'no such job' }))
  })
})

describe('the link to the produced run', () => {
  it('opens RUN through the command line for an ok job and for a failed-checks job only', async () => {
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    try {
      await loaded()
      for (const id of ['t_run', 't_wait_a', 't_broken', 't_stopped']) {
        expect(within(rowOf(id)).queryByRole('button', { name: fillCopy(JOBS.row.openLabel, { runId: id }) })).toBeNull()
      }
      fireEvent.click(within(rowOf('t_done')).getByRole('button', { name: fillCopy(JOBS.row.openLabel, { runId: 't_done' }) }))
      fireEvent.click(within(rowOf('t_checks')).getByRole('button', { name: fillCopy(JOBS.row.openLabel, { runId: 't_checks' }) }))
      expect(lines.map((l) => l.line)).toEqual(['t_done RUN', 't_checks RUN'])
      expect(writes()).toEqual([])
    } finally {
      stop()
    }
  })
})

describe('the queue form', () => {
  it('has a label on every control, and names its hints', async () => {
    await loaded()
    for (const label of [JOBS.form.strategy, JOBS.form.variant, JOBS.form.start, JOBS.form.end, JOBS.form.runId, JOBS.form.params]) {
      expect(screen.getByLabelText(labelled(label))).toBeTruthy()
    }
    expect(screen.getByRole('group', { name: JOBS.form.legend })).toBeTruthy()
    expect(screen.getByRole('button', { name: JOBS.form.queue })).toBeTruthy()
  })

  it('refuses an invalid draft on the client: no request, every problem named and tied to its control', async () => {
    await loaded()
    fill(JOBS.form.runId, 'bad id')
    fill(JOBS.form.start, '2009-01-01')
    fill(JOBS.form.params, '[')
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    expect(writes()).toEqual([])
    const runId = screen.getByLabelText(labelled(JOBS.form.runId))
    expect(runId.getAttribute('aria-invalid')).toBe('true')
    const describedBy = (runId.getAttribute('aria-describedby') ?? '').split(' ')
    expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).toContain(JOBS.errors.runIdFormat)
    expect(screen.getByText(JOBS.errors.startBefore)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(fillCopy(JOBS.form.problemsMany, { n: 3 }))
  })

  it('refuses an id that a job or a known run already uses', async () => {
    await loaded()
    fill(JOBS.form.runId, 't_done')
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    expect(screen.getByText(JOBS.errors.runIdTaken)).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.url === '/api/runs')).toBe(true))
    fill(JOBS.form.runId, 'nt_old_run')
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    expect(writes()).toEqual([])
  })

  it('queues a valid draft with one POST: the six keys, X-NQT 1, then says so and clears the id', async () => {
    await loaded()
    fireEvent.click(screen.getByLabelText(labelled(JOBS.form.strategy)))
    fireEvent.click(screen.getByRole('option', { name: 'dtsmom' }))
    fill(JOBS.form.runId, 't_new')
    fill(JOBS.form.params, '{"ticks": 2, "book": "tsmom"}')
    world.jobs = [...JOB_FIXTURES, job({ id: 'j10', run_id: 't_new' })]
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    expect(await screen.findByText(fillCopy(JOBS.form.queued, { runId: 't_new' }))).toBeTruthy()
    const [sent, ...rest] = writes()
    expect(rest).toEqual([])
    expect(sent?.url).toBe('/api/jobs')
    expect(sent?.headers.get('X-NQT')).toBe('1')
    expect(sent?.headers.get('Content-Type')).toBe('application/json')
    expect(sent?.body).toEqual({
      strategy: 'dtsmom',
      params: { ticks: 2, book: 'tsmom' },
      variant: 'vendor',
      start: '2010-06-01',
      end: '2022-01-01',
      run_id: 't_new',
    })
    expect((screen.getByLabelText(labelled(JOBS.form.runId)) as HTMLInputElement).value).toBe('t_')
    await waitFor(() => expect(within(rowOf('t_new')).getByText('QUEUED')).toBeTruthy())
  })

  it('shows the server refusal in words and keeps the draft', async () => {
    world.queueAnswer = { status: 422, body: { detail: [{ msg: 'unknown parameters for tsmom: [x]' }] } }
    await loaded()
    fill(JOBS.form.runId, 't_new')
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    const alert = await screen.findByText(fillCopy(JOBS.form.notQueued, { detail: 'unknown parameters for tsmom: [x]' }))
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    expect((screen.getByLabelText(labelled(JOBS.form.runId)) as HTMLInputElement).value).toBe('t_new')
  })

  it('does not send twice while a request is in flight', async () => {
    let release: (r: Response) => void = () => undefined
    const gate = new Promise<Response>((resolve) => { release = resolve })
    world.hold = gate
    await loaded()
    fill(JOBS.form.runId, 't_new')
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: JOBS.form.queue }))
    expect(writes()).toHaveLength(1)
    await act(async () => { release(reply(job({ id: 'j10', run_id: 't_new' }), 202)) })
  })

  it('offers no way to queue when the queue is full, and says why', async () => {
    world.jobs = Array.from({ length: 11 }, (_, i) => job({ id: `q${i}`, run_id: `t_q${i}`, state: i === 0 ? 'running' : 'queued', spec: { ...JOB_FIXTURES[0]!.spec, run_id: `t_q${i}` } }))
    await loaded()
    const button = screen.getByRole('button', { name: JOBS.form.queue }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText(fillCopy(JOBS.full, { cap: 10 })).length).toBeGreaterThan(0)
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
  })
})

describe('stopping a job', () => {
  it('offers Stop only on a queued or running job', async () => {
    await loaded()
    for (const id of ['t_run', 't_wait_a', 't_wait_b']) {
      expect(within(rowOf(id)).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: id }) })).toBeTruthy()
    }
    for (const id of ['t_done', 't_checks', 't_broken', 't_stopped']) {
      expect(within(rowOf(id)).queryByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: id }) })).toBeNull()
    }
  })

  it('asks first; Keep it sends nothing', async () => {
    await loaded()
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) }))
    expect(within(rowOf('t_wait_a')).getByText(fillCopy(JOBS.row.confirm, { runId: 't_wait_a' }))).toBeTruthy()
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmKeep }))
    expect(within(rowOf('t_wait_a')).queryByText(fillCopy(JOBS.row.confirm, { runId: 't_wait_a' }))).toBeNull()
    expect(writes()).toEqual([])
  })

  it('returns the focus to the row\'s Stop button after Keep it, so a keyboard user keeps their place', async () => {
    await loaded()
    const stopName = fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' })
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: stopName }))
    const keep = within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmKeep })
    await waitFor(() => expect(document.activeElement).toBe(keep))
    fireEvent.click(keep)
    const stop = within(rowOf('t_wait_a')).getByRole('button', { name: stopName })
    await waitFor(() => expect(document.activeElement).toBe(stop))
  })

  it('moves the focus to the row\'s View log button after Yes, stop it, never to the page body', async () => {
    await loaded()
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) }))
    const yes = within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmYes })
    fireEvent.click(yes)
    const view = within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_wait_a' }) })
    await waitFor(() => expect(document.activeElement).toBe(view))
    await screen.findByText(fillCopy(JOBS.row.stopped, { runId: 't_wait_a' }))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('stops on the second press: one DELETE with X-NQT 1, a message, and the list is read again', async () => {
    await loaded()
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) }))
    world.jobs = JOB_FIXTURES.map((j) => (j.id === 'j8' ? { ...j, state: 'stopped' } : j))
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmYes }))
    expect(await screen.findByText(fillCopy(JOBS.row.stopped, { runId: 't_wait_a' }))).toBeTruthy()
    const [sent, ...rest] = writes()
    expect(rest).toEqual([])
    expect(sent?.url).toBe('/api/jobs/j8')
    expect(sent?.method).toMatch(DELETE)
    expect(sent?.headers.get('X-NQT')).toBe('1')
    await waitFor(() => expect(within(rowOf('t_wait_a')).getByText('STOPPED')).toBeTruthy())
  })

  it('names a stop that failed', async () => {
    world.stopAnswer = { status: 409, body: { detail: 'already finished' } }
    await loaded()
    fireEvent.click(within(rowOf('t_run')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_run' }) }))
    fireEvent.click(within(rowOf('t_run')).getByRole('button', { name: JOBS.row.confirmYes }))
    const alert = await screen.findByText(fillCopy(JOBS.row.stopFailed, { runId: 't_run', detail: 'already finished' }))
    expect(alert.closest('[role="alert"]')).not.toBeNull()
  })
})

describe('safety and wording', () => {
  it('no button reads as an order action: none says order, submit, cancel or modify', async () => {
    await loaded()
    const flagged = screen.getAllByRole('button').filter((b) => /order|submit|cancel|modify/i.test(b.textContent ?? ''))
    expect(flagged).toEqual([])
  })

  it('states the in-sample basis and that nothing connects to a broker', async () => {
    await loaded()
    expect(screen.getByText(JOBS.basis)).toBeTruthy()
  })
})

// WCAG 2.1.1: a panel is one Tab stop and every other focusable element in it is taken out of the Tab order unless it
// carries data-roving (chrome/WorkspaceFocus.ts), so a JOBS control without it can never be reached from the keyboard.
describe('keyboard operation', () => {
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [role="combobox"]'
  const screenEl = () => document.querySelector('.jobs-screen') as HTMLElement

  function nameOf(el: HTMLElement): string {
    return el.getAttribute('aria-label') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? ''
  }

  function press(name: 'ArrowRight' | 'ArrowLeft'): void {
    const target = document.activeElement as HTMLElement
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const at = name === 'ArrowRight' ? target.value.length : 0
      target.setSelectionRange(at, at)
    }
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    handleRovingKey(screenEl(), event)
  }

  it('every control on the screen is a roving item, so the workspace does not take it out of the Tab order', async () => {
    await loaded()
    fireEvent.click(within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) }))
    fireEvent.click(within(rowOf('t_run')).getByRole('button', { name: fillCopy(JOBS.row.viewLabel, { runId: 't_run' }) }))
    await screen.findByRole('region', { name: fillCopy(JOBS.log.label, { runId: 't_run' }) })
    const stray = Array.from(screenEl().querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('data-roving'))
    expect(stray.map((el) => `${el.tagName} ${nameOf(el)}`)).toEqual([])
  })

  it('the arrow keys walk the form from the first control to Queue run, none of them a trap', async () => {
    await loaded()
    syncRoving(screenEl())
    const form = [JOBS.form.strategy, JOBS.form.variant, JOBS.form.start, JOBS.form.end, JOBS.form.runId, JOBS.form.params]
    const first = screen.getByLabelText(labelled(JOBS.form.strategy))
    first.focus()
    const seen: string[] = [nameOf(first)]
    for (let i = 1; i < form.length; i += 1) {
      press('ArrowRight')
      seen.push(nameOf(document.activeElement as HTMLElement))
    }
    expect(seen.map((s, i) => s.startsWith(form[i] ?? ''))).toEqual(form.map(() => true))
    press('ArrowRight')
    expect(nameOf(document.activeElement as HTMLElement)).toBe(JOBS.form.queue)
    press('ArrowLeft')
    expect(nameOf(document.activeElement as HTMLElement)).toMatch(labelled(JOBS.form.params))
  })

  it('reaches Stop and then Yes, stop it, from the keyboard alone', async () => {
    await loaded()
    syncRoving(screenEl())
    const stop = within(rowOf('t_wait_a')).getByRole('button', { name: fillCopy(JOBS.row.stopLabel, { runId: 't_wait_a' }) })
    stop.focus()
    fireEvent.click(stop)
    const keep = within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmKeep })
    expect(document.activeElement).toBe(keep)
    press('ArrowLeft')
    expect(document.activeElement).toBe(within(rowOf('t_wait_a')).getByRole('button', { name: JOBS.row.confirmYes }))
  })
})
