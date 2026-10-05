// @vitest-environment jsdom
// LEDG with the Start from action: the Actions menu opens the form from the marked row (Space marks one) or, with none
// marked, from the newest row; the form reads the queue and the presets only once it is open; Launch goes through the
// transport; a row that does not record its window is refused in words.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { JOBS_BAR } from '../../copy/jobsBar'
import { LAUNCH } from '../../copy/launch'
import { fillCopy } from '../../copy/workspace'
import { stubLayout } from '../../grids/testing'
import { LEDGER } from '../runs/runs.fixtures'
import { mountScreen, stubApi } from '../runs/testing'
import LedgScreen from '../ledg/LedgScreen'
import { job } from '../jobs/jobs.fixtures'
import { LaunchTransportContext, type LaunchTransport } from './launchClient'
import { PRESETS } from './launch.fixtures'
import type { Preset } from './types'

const PARAMS = { code: 'LEDG', context: null, args: {}, group: '-' } as const
const NEWEST = LEDGER.rows[0] as Schemas['LedgerRow']
const OLDER: Schemas['LedgerRow'] = { ...NEWEST, run_id: 'nt_overnight_v0_fixture_old', exp_id: 'older_exp', ts_utc: '2026-09-20T00:00:00+00:00', params: { exit_at: 'close' }, params_json: null }
const TWO: Schemas['LedgerView'] = { ledger_found: true, rows: [NEWEST, OLDER], anchor_pairs: [] }
const presetOf = (row: Schemas['LedgerRow']): Preset => ({
  source_run_id: row.run_id, exp_id: row.exp_id, strategy: row.strategy as string, variant: row.variant as string, start: row.start as string,
  end: row.end as string, params: row.params as Record<string, unknown>, runtime_s: null, launchable: true, reasons: [],
})
const JOBS_ON = { jobs: [], queue_cap: 10, queued: 0, running: 0, enabled: true }

let launch: ReturnType<typeof vi.fn<LaunchTransport['launch']>>
let lines: LineRequest[]
let unsubscribe: () => void

async function mountLedg(view: Schemas['LedgerView'] = TWO, jobs: unknown = JOBS_ON) {
  const seen = stubApi({ '/api/ledger': view, '/api/jobs': jobs, '/api/runs': [] })
  const presets = view.rows.map(presetOf)
  const transport: LaunchTransport = { presets: () => Promise.resolve({ ...PRESETS, presets }), launch }
  mountScreen(
    <LaunchTransportContext value={transport}>
      <LedgScreen params={PARAMS} context={null} />
    </LaunchTransportContext>,
  )
  const grid = await screen.findByRole('grid', { name: /Run ledger/ })
  await waitFor(() => expect(within(grid).getByText(NEWEST.run_id)).toBeTruthy())
  return { seen, grid }
}

const actionsButton = (): HTMLElement => screen.getByRole('button', { name: /Actions/ })
function chooseStart(label: string) {
  fireEvent.click(actionsButton())
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }))
}

beforeAll(() => stubLayout(600))
beforeEach(() => {
  launch = vi.fn<LaunchTransport['launch']>().mockResolvedValue(job({ id: 'j9', run_id: 't_overnight_v0_fixture_1' }))
  lines = []
  unsubscribe = onLineRequest((request) => lines.push(request))
  resetMessage()
})
afterEach(() => {
  unsubscribe()
  cleanup()
  resetNumbered()
  vi.restoreAllMocks()
})

describe('LEDG: Start from', () => {
  it('reads nothing but the ledger until the form is opened, and shows no form', async () => {
    const { seen } = await mountLedg()
    expect(seen.map((r) => r.url)).toEqual(['/api/ledger'])
    expect(screen.queryByRole('region', { name: /Start a run/ })).toBeNull()
  })

  it('opens the form from the newest row when none is marked, then reads the queue and the presets with GETs only', async () => {
    const { seen } = await mountLedg()
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from overnight_v0_fixture, overnight, repaired, 2010-09-28 to 2022-01-01/ })
    expect((within(region).getByLabelText('Run id') as HTMLInputElement).value).toBe('t_overnight_v0_fixture_1')
    expect((within(region).getByLabelText('exit_at') as HTMLInputElement).value).toBe('open_tick')
    await waitFor(() => expect(seen.some((r) => r.url === '/api/jobs')).toBe(true))
    expect(seen.every((r) => r.method === 'GET')).toBe(true)
  })

  it('marks one row with Space and starts from that one, saying so in the menu', async () => {
    const { grid } = await mountLedg()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: ' ' })
    fireEvent.click(actionsButton())
    const item = screen.getByRole('menuitem', { name: new RegExp(LAUNCH.menu.marked) })
    fireEvent.click(item)
    const region = await screen.findByRole('region', { name: /older_exp, overnight, repaired/ })
    expect((within(region).getByLabelText('exit_at') as HTMLInputElement).value).toBe('close')
    expect((within(region).getByLabelText('Run id') as HTMLInputElement).value).toBe('t_older_exp_1')
  })

  it('launches through the transport and says the run is queued', async () => {
    await mountLedg()
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    await waitFor(() => expect(within(region).getByRole('button', { name: LAUNCH.launch }).getAttribute('aria-disabled') === 'true').toBe(false))
    fireEvent.click(within(region).getByRole('button', { name: LAUNCH.launch }))
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_overnight_v0_fixture_1' }))
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]?.[0]).toEqual({ kind: 'backtest', preset_id: NEWEST.run_id, params: {}, start: null, end: null, run_id: 't_overnight_v0_fixture_1' })
    expect(useMessage.getState().text).toBe(fillCopy(LAUNCH.messageQueued, { runId: 't_overnight_v0_fixture_1' }))
  })

  it('offers the anchor re-run for the newest row, or the marked one, and opens its region', async () => {
    const { grid } = await mountLedg()
    chooseStart(JOBS_BAR.panel.menuNewest)
    expect(await screen.findByRole('region', { name: `Regression anchor re-run of ${NEWEST.run_id}` })).toBeTruthy()
    cleanup()
    resetNumbered()
    const marked = await mountLedg()
    fireEvent.keyDown(marked.grid, { key: 'ArrowDown' })
    fireEvent.keyDown(marked.grid, { key: ' ' })
    chooseStart(JOBS_BAR.panel.menuMarked)
    expect(await screen.findByRole('region', { name: `Regression anchor re-run of ${OLDER.run_id}` })).toBeTruthy()
    expect(grid).toBeTruthy()
  })

  it('closes on Escape and hands the focus back to where it was', async () => {
    await mountLedg()
    actionsButton().focus()
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    fireEvent.keyDown(within(region).getByLabelText('exit_at'), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: /Start a run from/ })).toBeNull()
    expect(document.activeElement).toBe(actionsButton())
  })

  it('keeps the picker focused after choosing another preset, says the form was reset, and warned of it beforehand (3.2.2)', async () => {
    await mountLedg()
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from overnight_v0_fixture/ })
    const picker = await within(region).findByRole('combobox', { name: LAUNCH.presetLabel })
    expect(within(region).getByText(LAUNCH.presetHint)).toBeTruthy()
    fireEvent.change(within(region).getByLabelText('Run id'), { target: { value: 't_edited_1' } })
    fireEvent.click(picker)
    fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[1]!)
    const next = await screen.findByRole('region', { name: /Start a run from older_exp, overnight, repaired/ })
    expect((within(next).getByLabelText('Run id') as HTMLInputElement).value).toBe('t_older_exp_1')
    const again = await within(next).findByRole('combobox', { name: LAUNCH.presetLabel })
    await waitFor(() => expect(document.activeElement).toBe(again))
    const status = screen.getAllByRole('status').find((el) => /Form reset to older_exp/.test(el.textContent ?? ''))
    expect(status?.textContent).toContain('edits were discarded')
  })

  it('does not launch while the runner is off, and says so', async () => {
    await mountLedg(TWO, { ...JOBS_ON, enabled: false })
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    await waitFor(() => expect(within(region).getByText(LAUNCH.runnerOff)).toBeTruthy())
    expect(within(region).getByRole('button', { name: LAUNCH.launch }).getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('does not launch while the queue is full, and says so', async () => {
    const waiting = Array.from({ length: 10 }, (_, i) => job({ id: `j${i + 1}`, run_id: `t_wait_${i}`, state: 'queued' }))
    await mountLedg(TWO, { ...JOBS_ON, jobs: waiting, queued: 10 })
    chooseStart(LAUNCH.menu.newest)
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    await waitFor(() => expect(within(region).getByText(fillCopy(LAUNCH.queueFull, { cap: 10 }))).toBeTruthy())
  })

  it('refuses a row that does not record its window, in words, and opens no form', async () => {
    await mountLedg({ ledger_found: true, rows: [{ ...NEWEST, end: null }], anchor_pairs: [] })
    chooseStart(LAUNCH.menu.newest)
    expect(useMessage.getState().text).toBe(LAUNCH.noSeed)
    expect(useMessage.getState().tone).toBe('error')
    expect(screen.queryByRole('region', { name: /Start a run from/ })).toBeNull()
  })
})
