// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { LAUNCH } from '../../copy/launch'
import { LAUNCH_SPEC } from '../../copy/launchSpec'
import { fillCopy } from '../../copy/workspace'
import { job } from '../jobs/jobs.fixtures'
import LaunchForm, { type LaunchFormProps } from './LaunchForm'
import { LaunchTransportContext, type LaunchTransport } from './launchClient'
import { ORB_PRESET, ORB_PRESET_NO_SPEC, ORB_SEED, ORB_SPEC, ORB_SPEC_SHA, PRESETS } from './launch.fixtures'
import type { LaunchRequest } from './types'

const NONE: ReadonlySet<string> = new Set()
let launch: ReturnType<typeof vi.fn<LaunchTransport['launch']>>
let lines: LineRequest[]
let unsubscribe: () => void

function mount(over: Partial<LaunchFormProps> = {}) {
  const onClose = vi.fn()
  const onPick = vi.fn()
  const transport: LaunchTransport = { presets: () => Promise.resolve(PRESETS), launch }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const props: LaunchFormProps = {
    seed: ORB_SEED,
    strategies: [ORB_SPEC],
    presets: PRESETS.presets,
    presetsNote: null,
    taken: NONE,
    blocked: null,
    onPick,
    onClose,
    ...over,
  }
  const tree = (p: LaunchFormProps) => (
    <QueryClientProvider client={client}>
      <LaunchTransportContext value={transport}>
        <LaunchForm {...p} />
      </LaunchTransportContext>
    </QueryClientProvider>
  )
  const view = render(tree(props))
  return { onClose, onPick, rerender: (patch: Partial<LaunchFormProps>) => view.rerender(tree({ ...props, ...patch })) }
}

const field = (name: string): HTMLInputElement => screen.getByLabelText(name, { exact: true }) as HTMLInputElement
const launchButton = (): HTMLButtonElement => screen.getByRole('button', { name: LAUNCH.launch }) as HTMLButtonElement
const blocked = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true'
const statusRegion = (): HTMLElement => document.querySelector('[data-launch-status]') as HTMLElement
const edit = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
const described = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' | ')

beforeEach(() => {
  launch = vi.fn<LaunchTransport['launch']>().mockResolvedValue(job({ id: 'j9', run_id: 't_EXP12_1' }))
  lines = []
  unsubscribe = onLineRequest((request) => lines.push(request))
})
afterEach(() => {
  unsubscribe()
  cleanup()
})

describe('the fields', () => {
  it('names the run and shows the strategy, the window and one typed field per parameter, filled from the preset', () => {
    mount()
    expect(screen.getByRole('region', { name: fillCopy(LAUNCH.heading, { label: 'EXP12, za_orb, repaired, 2010-06-01 to 2022-01-01' }) })).toBeTruthy()
    expect(field(LAUNCH.start).value).toBe('2010-06-01')
    expect(field(LAUNCH.end).value).toBe('2022-01-01')
    expect(field(LAUNCH.runId).value).toBe('t_EXP12_1')
    expect(field('or_minutes').value).toBe('45')
    expect(field('stop_r').value).toBe('2')
    expect((screen.getByLabelText('long_only') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('combobox', { name: 'session' }).textContent).toContain('rth')
  })

  it('shows the type, the allowed range and the default of each parameter, tied to its control', () => {
    mount()
    expect(described(field('or_minutes'))).toContain('Whole number, 5 to 120. Default 30.')
    expect(described(field('stop_r'))).toContain('Number, 0.25 to 5. Default 1.5.')
    expect(described(screen.getByLabelText('long_only'))).toContain('Yes or no. Default no.')
  })

  it('moves focus to the first parameter on opening', () => {
    mount()
    expect(document.activeElement).toBe(field('or_minutes'))
  })

  it('keeps the focus in the form when the strategy description arrives and swaps a box for a picker', () => {
    const seed = { ...ORB_SEED, params: { session: 'rth', or_minutes: 45 } }
    const { rerender } = mount({ seed, strategies: [] })
    expect(document.activeElement).toBe(field('session'))
    rerender({ strategies: [ORB_SPEC] })
    expect(screen.getByRole('combobox', { name: 'session' })).toBeTruthy()
    expect(document.activeElement).toBe(field('or_minutes'))
  })

  it('does not take the focus from a control the owner chose meanwhile', () => {
    const seed = { ...ORB_SEED, params: { session: 'rth', or_minutes: 45 } }
    const { rerender } = mount({ seed, strategies: [] })
    field('or_minutes').focus()
    rerender({ strategies: [ORB_SPEC] })
    expect(document.activeElement).toBe(field('or_minutes'))
  })

  it('names the preset the run starts from, and shows the data variant as fixed by it', () => {
    mount()
    expect(screen.getByText(fillCopy(LAUNCH.specUnknown, { name: 'EXP12' }))).toBeTruthy()
    expect(screen.getByText('repaired')).toBeTruthy()
    expect(screen.getByText(LAUNCH.variantFixed)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: LAUNCH.variant })).toBeNull()
  })

  it('states a summary of the run that the Launch button is described by', () => {
    mount()
    const summary = fillCopy(LAUNCH.summary, { strategy: 'za_orb', variant: 'repaired', start: '2010-06-01', end: '2022-01-01', runId: 't_EXP12_1', changes: LAUNCH.changesNone })
    expect(screen.getByText(summary)).toBeTruthy()
    expect(described(launchButton())).toContain(summary)
  })

  it('suggests a run id that is not taken', () => {
    mount({ taken: new Set(['t_EXP12_1']) })
    expect(field(LAUNCH.runId).value).toBe('t_EXP12_2')
  })
})

describe('validation', () => {
  it('shows the problem next to its field, marks it invalid, counts it and disables Launch until it is fixed', () => {
    mount()
    edit('or_minutes', '1')
    const input = field('or_minutes')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(described(input)).toContain('or_minutes must be between 5 and 120.')
    expect(screen.getByText(fillCopy(LAUNCH.problems, { n: 1 }))).toBeTruthy()
    expect(blocked(launchButton())).toBe(true)
    edit('or_minutes', '60')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(blocked(launchButton())).toBe(false)
  })

  it('names a window past the research fence and a taken run id, each beside its own field', () => {
    mount({ taken: new Set(['t_EXP12_9']) })
    edit(LAUNCH.end, '2022-01-02')
    edit(LAUNCH.runId, 't_EXP12_9')
    expect(described(field(LAUNCH.end))).toContain('The end may not be after 2022-01-01.')
    expect(described(field(LAUNCH.runId))).toContain('already uses this id')
    expect(screen.getByText(fillCopy(LAUNCH.problemsMany, { n: 2 }))).toBeTruthy()
    expect(blocked(launchButton())).toBe(true)
  })

  it('refuses text for a number and a value outside a list of choices', () => {
    mount()
    edit('stop_r', 'abc')
    expect(described(field('stop_r'))).toContain('stop_r must be a number.')
  })

  it('does not launch an invalid form, not even with Enter', () => {
    mount()
    edit('or_minutes', '1')
    fireEvent.keyDown(field('or_minutes'), { key: 'Enter' })
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('changes from the preset', () => {
  it('marks a changed parameter with its preset value and says the run is off spec, in words', () => {
    mount()
    expect(screen.getByText(LAUNCH.onSpec)).toBeTruthy()
    edit('or_minutes', '60')
    expect(screen.getByText(fillCopy(LAUNCH.changed, { was: '45' }))).toBeTruthy()
    expect(screen.getByText(fillCopy(LAUNCH.offSpec, { n: 1 }))).toBeTruthy()
    expect(blocked(launchButton())).toBe(false)
    edit('or_minutes', '45')
    expect(screen.queryByText(fillCopy(LAUNCH.changed, { was: '45' }))).toBeNull()
    expect(screen.getByText(LAUNCH.onSpec)).toBeTruthy()
  })

  it('counts a changed window as off spec', () => {
    mount()
    edit(LAUNCH.end, '2021-12-31')
    expect(screen.getByText(fillCopy(LAUNCH.offSpec, { n: 1 }))).toBeTruthy()
  })
})

describe('the spec hash and the OFF SPEC badge', () => {
  const badge = (): HTMLElement => document.querySelector('.launch-badge') as HTMLElement

  it('shows the preset spec sha256 and stays on spec while nothing differs', () => {
    mount()
    expect(screen.getByText(fillCopy(LAUNCH_SPEC.hash, { exp: 'EXP12', sha: ORB_SPEC_SHA }))).toBeTruthy()
    expect(badge().textContent).toBe(LAUNCH.onSpec)
    expect(badge().classList.contains('launch-off')).toBe(false)
  })

  it('turns OFF SPEC when a parameter changes and back on when it is restored, keeping the hash in view', () => {
    mount()
    edit('or_minutes', '60')
    expect(badge().textContent).toBe(LAUNCH.offSpec)
    expect(badge().classList.contains('launch-off')).toBe(true)
    expect(screen.getByText(fillCopy(LAUNCH_SPEC.hash, { exp: 'EXP12', sha: ORB_SPEC_SHA }))).toBeTruthy()
    edit('or_minutes', '45')
    expect(badge().textContent).toBe(LAUNCH.onSpec)
  })

  it('is OFF SPEC with nothing changed when the preset carries no spec hash, says so in words, and still allows Launch', () => {
    mount({ presets: [ORB_PRESET_NO_SPEC] })
    expect(badge().textContent).toBe(LAUNCH_SPEC.offNoSpec)
    expect(badge().classList.contains('launch-off')).toBe(true)
    expect(screen.getByText(fillCopy(LAUNCH_SPEC.noFile, { exp: 'EXP12' }))).toBeTruthy()
    expect(screen.queryByText(new RegExp(ORB_SPEC_SHA))).toBeNull()
    expect(blocked(launchButton())).toBe(false)
  })

  it('puts the spec state and the spec line in the description of Launch, so it is heard before pressing it', () => {
    mount({ presets: [ORB_PRESET_NO_SPEC] })
    expect(described(launchButton())).toContain(LAUNCH_SPEC.offNoSpec)
    expect(described(launchButton())).toContain(fillCopy(LAUNCH_SPEC.noFile, { exp: 'EXP12' }))
    cleanup()
    mount()
    expect(described(launchButton())).toContain(LAUNCH.onSpec)
    expect(described(launchButton())).toContain(fillCopy(LAUNCH_SPEC.hash, { exp: 'EXP12', sha: ORB_SPEC_SHA }))
    edit(LAUNCH.end, '2021-12-31')
    expect(described(launchButton())).toContain(LAUNCH.offSpec)
    expect(described(launchButton())).not.toContain(LAUNCH.onSpec)
  })

  it('carries the state in a status region, so a change to OFF SPEC is announced', () => {
    mount()
    expect(badge().getAttribute('role')).toBe('status')
    edit('or_minutes', '60')
    expect(badge().textContent).toBe(LAUNCH.offSpec)
  })

  it('keeps the changed wording when a parameter differs on a preset without a spec hash', () => {
    mount({ presets: [ORB_PRESET_NO_SPEC] })
    edit('or_minutes', '60')
    expect(badge().textContent).toBe(LAUNCH.offSpec)
  })
})

describe('launching', () => {
  it('posts exactly the request the fields describe and then says the run is queued, with a way to JOBS', async () => {
    mount()
    edit('or_minutes', '60')
    fireEvent.click(launchButton())
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_EXP12_1' }))
    const sent: LaunchRequest = { kind: 'backtest', preset_id: ORB_PRESET.source_run_id, params: { or_minutes: 60 }, start: null, end: null, run_id: 't_EXP12_1' }
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]?.[0]).toEqual(sent)
    fireEvent.click(screen.getByRole('button', { name: LAUNCH.openJobs }))
    expect(lines.map((l) => l.line)).toEqual(['JOBS'])
  })

  it('launches on Enter in a field', async () => {
    mount()
    fireEvent.keyDown(field('stop_r'), { key: 'Enter' })
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_EXP12_1' }))
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('launches with Control and Enter from the Launch button too', async () => {
    mount()
    fireEvent.keyDown(launchButton(), { key: 'Enter', ctrlKey: true })
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_EXP12_1' }))
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('disables Launch while the request is in flight, so it cannot be sent twice', async () => {
    let release: (j: ReturnType<typeof job>) => void = () => {}
    launch.mockReturnValue(new Promise((resolve) => { release = resolve }))
    mount()
    fireEvent.click(launchButton())
    await waitFor(() => expect(blocked(launchButton())).toBe(true))
    fireEvent.keyDown(field('stop_r'), { key: 'Enter' })
    expect(launch).toHaveBeenCalledTimes(1)
    await act(async () => release(job({ run_id: 't_EXP12_1' })))
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_EXP12_1' }))
  })

  it("shows the server's refusal in words, keeps the draft and names the field it concerns", async () => {
    launch.mockRejectedValue({ detail: "Value error, parameters ['or_minutes'] do not belong to za_orb" })
    mount()
    edit('or_minutes', '60')
    fireEvent.click(launchButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(LAUNCH.notLaunched, { detail: "Value error, parameters ['or_minutes'] do not belong to za_orb" }))
    expect(field('or_minutes').value).toBe('60')
    expect(field('or_minutes').getAttribute('aria-invalid')).toBe('true')
    expect(described(field('or_minutes'))).toContain("parameters ['or_minutes'] do not belong to za_orb")
    edit('or_minutes', '61')
    expect(field('or_minutes').getAttribute('aria-invalid')).toBeNull()
  })

  it('says a failed request in words, with the error text when it has no detail', async () => {
    launch.mockRejectedValue(new Error('the request failed'))
    mount()
    fireEvent.click(launchButton())
    expect((await screen.findByRole('alert')).textContent).toBe(fillCopy(LAUNCH.notLaunched, { detail: 'the request failed' }))
  })

  it('sends a narrowed window as the dates that changed, and nothing for the others', async () => {
    mount()
    edit(LAUNCH.end, '2021-12-31')
    fireEvent.click(launchButton())
    await screen.findByText(fillCopy(LAUNCH.queued, { runId: 't_EXP12_1' }))
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ start: null, end: '2021-12-31', params: {} })
  })

  it('does not launch a run that is not a preset, and says why', () => {
    mount({ seed: { ...ORB_SEED, sourceRunId: 't_other', params: { or_minutes: 99 } } })
    expect(blocked(launchButton())).toBe(true)
    expect(described(launchButton())).toContain(LAUNCH.notPreset)
  })

  it('does not launch a preset the server would refuse, and gives its reasons', () => {
    const refused = { ...ORB_PRESET, launchable: false, reasons: ['t0 is not a launch parameter'] }
    mount({ presets: [refused] })
    expect(blocked(launchButton())).toBe(true)
    expect(described(launchButton())).toContain(fillCopy(LAUNCH.notLaunchable, { reasons: 't0 is not a launch parameter' }))
  })

  it('does not launch while the preset list could not be read, and waits quietly while it loads', () => {
    mount({ presets: [], presetsNote: 'the preset list is not available' })
    expect(blocked(launchButton())).toBe(true)
    expect(described(launchButton())).toContain(LAUNCH.needsPresets)
    cleanup()
    mount({ presets: [], presetsNote: LAUNCH.presetsLoading })
    expect(blocked(launchButton())).toBe(true)
    expect(screen.queryByText(LAUNCH.needsPresets)).toBeNull()
  })

  it('does not launch while the runner is off or the queue is full, and says why', () => {
    mount({ blocked: LAUNCH.runnerOff })
    expect(blocked(launchButton())).toBe(true)
    expect(described(launchButton())).toContain(LAUNCH.runnerOff)
    fireEvent.keyDown(field('stop_r'), { key: 'Enter' })
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('a refused launch is announced', () => {
  it('keeps Launch focusable, with aria-disabled and not the disabled attribute, so its reasons can be heard', () => {
    mount({ blocked: LAUNCH.runnerOff })
    expect(launchButton().hasAttribute('disabled')).toBe(false)
    expect(blocked(launchButton())).toBe(true)
    launchButton().focus()
    expect(document.activeElement).toBe(launchButton())
  })

  it('carries the stopped reason in a status region that is mounted before it is filled', () => {
    const { rerender } = mount()
    const region = statusRegion()
    expect(region.getAttribute('role')).toBe('status')
    expect(region.textContent).toBe('')
    rerender({ blocked: LAUNCH.runnerOff })
    expect(statusRegion()).toBe(region)
    expect(region.textContent).toContain(LAUNCH.runnerOff)
  })

  it('says the reason on open, in the same region, when the launch is stopped from the start', () => {
    mount({ blocked: LAUNCH.queueFull })
    expect(statusRegion().textContent).toContain(LAUNCH.queueFull)
    expect(described(launchButton())).toContain(LAUNCH.queueFull)
  })

  it('updates the same region with the problem count while the owner types', () => {
    mount()
    const region = statusRegion()
    edit('or_minutes', '1')
    expect(statusRegion()).toBe(region)
    expect(region.textContent).toContain(fillCopy(LAUNCH.problems, { n: 1 }))
    edit('or_minutes', '60')
    expect(region.textContent).toBe('')
  })

  it('moves focus to the first invalid field on Enter, and posts nothing', () => {
    mount()
    edit('or_minutes', '1')
    field('stop_r').focus()
    fireEvent.keyDown(field('stop_r'), { key: 'Enter' })
    expect(launch).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field('or_minutes'))
  })

  it('moves focus to the first invalid field when Launch is pressed with a problem', () => {
    mount()
    edit('stop_r', 'abc')
    launchButton().focus()
    fireEvent.click(launchButton())
    expect(launch).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field('stop_r'))
  })

  it('says the reason again when Launch is pressed while stopped', async () => {
    mount({ blocked: LAUNCH.runnerOff })
    launchButton().focus()
    fireEvent.click(launchButton())
    expect(launch).not.toHaveBeenCalled()
    expect(statusRegion().textContent).toBe('')
    await waitFor(() => expect(statusRegion().textContent).toContain(LAUNCH.runnerOff))
    expect(document.activeElement).toBe(launchButton())
  })

  it('says the reason when Enter is pressed in a field while stopped', async () => {
    mount({ blocked: LAUNCH.runnerOff })
    fireEvent.keyDown(field('stop_r'), { key: 'Enter' })
    expect(launch).not.toHaveBeenCalled()
    await waitFor(() => expect(statusRegion().textContent).toContain(LAUNCH.runnerOff))
  })
})

describe('keyboard', () => {
  it('closes on Escape', () => {
    const { onClose } = mount()
    fireEvent.keyDown(field('stop_r'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with the Close button', () => {
    const { onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: LAUNCH.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Escape for an open picker: the picker closes, the form stays', () => {
    const { onClose } = mount()
    const session = screen.getByRole('combobox', { name: 'session' })
    fireEvent.keyDown(session, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(session, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('every control is a roving item, so the arrow keys reach all of them in order', () => {
    mount()
    const items = Array.from(document.querySelectorAll('[data-roving]')).map((el) => el.getAttribute('aria-label') ?? el.id ?? el.textContent)
    expect(items.length).toBeGreaterThanOrEqual(9)
    expect(document.querySelectorAll('input:not([data-roving]), button:not([data-roving])').length).toBe(0)
  })

  it('takes a flag with a checkbox and a fixed set with the terminal picker', () => {
    mount()
    fireEvent.click(screen.getByLabelText('long_only'))
    expect(screen.getByText(fillCopy(LAUNCH.changed, { was: LAUNCH.no }))).toBeTruthy()
    const session = screen.getByRole('combobox', { name: 'session' })
    fireEvent.click(session)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'globex' }))
    expect(session.textContent).toContain('globex')
  })
})

describe('start from another preset', () => {
  it('lists the presets and hands the chosen one to the host', () => {
    const { onPick } = mount()
    const picker = screen.getByRole('combobox', { name: LAUNCH.presetLabel })
    fireEvent.click(picker)
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options).toHaveLength(2)
    fireEvent.click(options[1]!)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ sourceRunId: 't_EXP9_za_old', params: { or_minutes: 30 } })
  })

  it('offers no picker when no preset is known, and says why', () => {
    mount({ presets: [], presetsNote: 'the preset list is not available' })
    expect(screen.queryByRole('combobox', { name: LAUNCH.presetLabel })).toBeNull()
    expect(screen.getByText('the preset list is not available')).toBeTruthy()
  })
})

describe('a strategy the server does not describe', () => {
  it('still shows the parameters of the run, as plain fields without a range', () => {
    mount({ strategies: [] })
    expect(field('or_minutes').value).toBe('45')
    expect(described(field('or_minutes'))).toContain('Whole number, no range declared. No default.')
  })

  it('refuses a strategy the queue does not run, and offers no launch', () => {
    mount({ seed: { ...ORB_SEED, strategy: 'mystery' } })
    expect(screen.getByText(LAUNCH.errors.strategy)).toBeTruthy()
    expect(blocked(launchButton())).toBe(true)
  })
})
