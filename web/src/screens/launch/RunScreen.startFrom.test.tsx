// @vitest-environment jsdom
// RUN with the Start from action: the Actions menu offers it once the run has loaded and opens the form from that run's
// own configuration (strategy, variant, window, parameters); a run that does not record them is refused in words.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { JOBS_BAR } from '../../copy/jobsBar'
import { LAUNCH } from '../../copy/launch'
import { stubLayout } from '../../grids/testing'
import { job } from '../jobs/jobs.fixtures'
import RunScreen from '../runs/RunScreen'
import { DETAIL_DTSMOM, FILLS_DTSMOM, PANEL_DTSMOM, TRADES_DTSMOM } from '../runs/runs.fixtures'
import { mountScreen, stubApi, type Routes } from '../runs/testing'
import { LaunchTransportContext, type LaunchTransport } from './launchClient'
import { ORB_PRESET, PRESETS, TICKS_SPEC } from './launch.fixtures'

vi.mock('../../charts/LineStack', () => ({ default: () => <div data-testid="linestack" /> }))

const DTS = 'nt_dtsmom_v0_fixture_ts1'
const ROUTES = (detail: Schemas['RunDetail']): Routes => ({
  [`/api/runs/${DTS}`]: detail,
  [`/api/analytics/run/${DTS}/panel`]: PANEL_DTSMOM,
  [`/api/runs/${DTS}/trades`]: TRADES_DTSMOM,
  [`/api/runs/${DTS}/fills`]: FILLS_DTSMOM,
  '/api/jobs': { jobs: [], queue_cap: 10, queued: 0, running: 0, enabled: true },
  '/api/runs': [],
})
const DTSMOM_SPEC = { name: 'dtsmom', params: [{ ...TICKS_SPEC.params[0]!, default: null }, { name: 'book', kind: 'text' as const, default: null, min: null, max: null, choices: ['tsmom', 'lo'], required: false, note: null }] }

const DTS_PRESET = { ...ORB_PRESET, source_run_id: DTS, exp_id: null, strategy: 'dtsmom', variant: 'vendor', start: '2012-01-03', end: '2012-01-25', params: { ticks: 1, book: 'tsmom' } }

let launch: ReturnType<typeof vi.fn<LaunchTransport['launch']>>

function mountRun(detail: Schemas['RunDetail'] = DETAIL_DTSMOM) {
  stubApi(ROUTES(detail))
  const transport: LaunchTransport = { presets: () => Promise.resolve({ presets: [DTS_PRESET, ...PRESETS.presets], strategies: [DTSMOM_SPEC] }), launch }
  const context = { kind: 'run', value: DTS } as const
  mountScreen(
    <LaunchTransportContext value={transport}>
      <RunScreen params={{ code: 'RUN', context, args: {}, group: 'B' }} context={context} />
    </LaunchTransportContext>,
  )
}

const actionsButton = (): HTMLElement => screen.getByRole('button', { name: /Actions/ })

beforeAll(() => stubLayout(600))
beforeEach(() => {
  launch = vi.fn<LaunchTransport['launch']>().mockResolvedValue(job({ id: 'j9', run_id: 't_nt_dtsmom_v0_fixture_ts1_1' }))
  resetMessage()
})
afterEach(() => {
  cleanup()
  resetNumbered()
  vi.restoreAllMocks()
})

describe('RUN: Start from', () => {
  it('offers the action once the run has loaded and opens the form from the run configuration', async () => {
    mountRun()
    await screen.findByTestId('linestack')
    fireEvent.click(actionsButton())
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LAUNCH.menu.run) }))
    const region = await screen.findByRole('region', { name: /Start a run from nt_dtsmom_v0_fixture_ts1, dtsmom, vendor, 2012-01-03 to 2012-01-25/ })
    expect((within(region).getByLabelText('Start') as HTMLInputElement).value).toBe('2012-01-03')
    expect((within(region).getByLabelText('ticks') as HTMLInputElement).value).toBe('1')
    expect((await within(region).findByRole('combobox', { name: 'book' })).textContent).toContain('tsmom')
    expect((within(region).getByLabelText('Run id') as HTMLInputElement).value).toBe('t_nt_dtsmom_v0_fixture_ts1_1')
  })

  it('offers the anchor re-run once the run has loaded and opens its region for this run', async () => {
    mountRun()
    await screen.findByTestId('linestack')
    fireEvent.click(actionsButton())
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(JOBS_BAR.panel.menuRun) }))
    expect(await screen.findByRole('region', { name: `Regression anchor re-run of ${DTS}` })).toBeTruthy()
  })

  it('launches the run with the typed parameters', async () => {
    mountRun()
    await screen.findByTestId('linestack')
    fireEvent.click(actionsButton())
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LAUNCH.menu.run) }))
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    fireEvent.change(within(region).getByLabelText('ticks'), { target: { value: '2' } })
    const button = within(region).getByRole('button', { name: LAUNCH.launch })
    await waitFor(() => expect(button.getAttribute('aria-disabled') === 'true').toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    expect(launch.mock.calls[0]?.[0]).toEqual({ kind: 'backtest', preset_id: DTS, params: { ticks: 2 }, start: null, end: null, run_id: 't_nt_dtsmom_v0_fixture_ts1_1' })
  })

  it('shows the range of ticks and refuses a value outside it, next to the field', async () => {
    mountRun()
    await screen.findByTestId('linestack')
    fireEvent.click(actionsButton())
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LAUNCH.menu.run) }))
    const region = await screen.findByRole('region', { name: /Start a run from/ })
    await waitFor(() => expect(within(region).getByText(/Whole number, 0 to 2/)).toBeTruthy())
    fireEvent.change(within(region).getByLabelText('ticks'), { target: { value: '3' } })
    expect(within(region).getByText(/ticks must be between 0 and 2/)).toBeTruthy()
    expect(within(region).getByRole('button', { name: LAUNCH.launch }).getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('refuses a run that does not record its variant, in words, and opens no form', async () => {
    mountRun({ ...DETAIL_DTSMOM, summary: { ...DETAIL_DTSMOM.summary, variant: null } })
    await screen.findByTestId('linestack')
    fireEvent.click(actionsButton())
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(LAUNCH.menu.run) }))
    expect(useMessage.getState().text).toBe(LAUNCH.noSeed)
    expect(screen.queryByRole('region', { name: /Start a run from/ })).toBeNull()
  })

  it('does not offer the action before the run has loaded', async () => {
    stubApi({})
    const context = { kind: 'run', value: 'nt_missing' } as const
    mountScreen(<RunScreen params={{ code: 'RUN', context, args: {}, group: 'B' }} context={context} />)
    await screen.findByRole('alert')
    fireEvent.click(actionsButton())
    expect(screen.queryByRole('menuitem', { name: new RegExp(LAUNCH.menu.run) })).toBeNull()
  })
})
