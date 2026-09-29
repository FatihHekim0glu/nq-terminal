// @vitest-environment jsdom
// The run tear sheets of the demo dataset render. The tear sheet reads the run record (GET /api/runs/{id}) before it
// asks the analytics route, so a run with analytics and no record refused every tab ("The server refused this tear
// sheet: not in the demo dataset"). Here TearSheet runs against the real demo route table, not a hand-written mock.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../../api/queries'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import { createDemoFetch } from '../../demo/fetch'
import TearSheet from './TearSheet'

// The chart components draw on canvas through lazily loaded libraries; here each is a stand-in that names what it was given.
const seen = vi.hoisted(() => ({ charts: [] as Array<{ kind: string; title: string }> }))

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => {
    seen.charts.push({ kind: 'linestack', title: props.title })
    return <div data-chart="linestack">{props.title}</div>
  },
}))
vi.mock('../../charts/echarts/Heatmap', () => ({
  Heatmap: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'heatmap', title: props.data.name })
    return <div data-chart="heatmap">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/Distribution', () => ({
  Distribution: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'distribution', title: props.data.name })
    return <div data-chart="distribution">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'barladder', title: props.data.name })
    return <div data-chart="barladder">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/XyScatter', () => ({
  XyScatter: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'xyscatter', title: props.data.name })
    return <div data-chart="xyscatter">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/Cone', () => ({
  Cone: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'cone', title: props.data.name })
    return <div data-chart="cone">{props.data.name}</div>
  },
}))

const reads: Array<{ path: string; status: number }> = []

beforeEach(() => {
  seen.charts.length = 0
  reads.length = 0
  const demo = createDemoFetch({ passThrough: vi.fn(), origin: window.location.origin })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await demo(input, init)
    reads.push({ path: new URL(String(input), window.location.origin).pathname, status: response.status })
    return response
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The demo answers after a seeded 20 to 120 ms; a failing read should fail on its assertion, not on the test clock.
vi.setConfig({ testTimeout: 10_000 })
const LATER = { timeout: 3000 }

function show(code: MnemonicCode, name: string) {
  const context: ResolvedContext = { kind: 'run', value: name }
  return render(
    <QueryClientProvider client={createApiQueryClient()}>
      <TearSheet params={{ code, context, args: {}, group: 'B' }} context={context} />
    </QueryClientProvider>,
  )
}

const tile = (label: RegExp) => screen.getByRole('button', { name: label })

describe('nt_volmanaged_v0_fixture_m1 EQ in the demo', () => {
  it('opens through its run record and draws the 13 key figures and the equity chart from the demo analytics', async () => {
    show('EQ', 'nt_volmanaged_v0_fixture_m1')
    const figures = await screen.findByRole('list', { name: 'Tear sheet key figures' }, LATER)
    expect(within(figures).getAllByRole('listitem')).toHaveLength(13)
    expect(tile(/^Total return/).textContent).toContain('-0.36%')
    expect(tile(/^Sharpe/).textContent).toContain('-5.82')
    // C7: a computed run figure carries its tag; the rules flow (e2e/flows/rules.spec.ts) asserts the same offline.
    expect(figures.textContent).toContain('[POST HOC]')
    expect(await screen.findByText('nt_volmanaged_v0_fixture_m1 equity', {}, LATER)).toBeTruthy()
    expect(screen.queryByText(/The server refused this tear sheet/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    const record = reads.find((r) => r.path === '/api/runs/nt_volmanaged_v0_fixture_m1')
    expect(record?.status).toBe(200)
    expect(reads.find((r) => r.path === '/api/analytics/run/nt_volmanaged_v0_fixture_m1')?.status).toBe(200)
  })

  // What each tab draws from the analytics body (a title alone would show even for a refused sheet).
  it.each([
    ['DD', () => screen.findByRole('table', { name: /Top drawdowns/ }, LATER)],
    ['RET', () => screen.findByText('nt_volmanaged_v0_fixture_m1 return distribution', {}, LATER)],
    ['RR', () => screen.findByRole('group', { name: 'nt_volmanaged_v0_fixture_m1 rolling statistics' }, LATER)],
    ['MRET', () => screen.findByText('nt_volmanaged_v0_fixture_m1 monthly returns', {}, LATER)],
  ] as const)('%s opens too (the same record serves every tab)', async (code, probe) => {
    show(code, 'nt_volmanaged_v0_fixture_m1')
    expect(await probe()).toBeTruthy()
    expect(screen.queryByText(/The server refused this tear sheet/)).toBeNull()
  })

  it('switching tab in place keeps the sheet: the drawdown tab draws its table from the same analytics', async () => {
    show('EQ', 'nt_volmanaged_v0_fixture_m1')
    await screen.findByText('nt_volmanaged_v0_fixture_m1 equity', {}, LATER)
    fireEvent.click(screen.getByRole('tab', { name: '2) Drawdown' }))
    expect(await screen.findByRole('table', { name: /Top drawdowns/ }, LATER)).toBeTruthy()
    expect(screen.queryByText(/The server refused this tear sheet/)).toBeNull()
  })
})

describe('smoke_2015_01 EQ in the demo', () => {
  it('opens through its run record and draws its key figures and equity chart', async () => {
    show('EQ', 'smoke_2015_01')
    const figures = await screen.findByRole('list', { name: 'Tear sheet key figures' }, LATER)
    expect(within(figures).getAllByRole('listitem')).toHaveLength(13)
    expect(await screen.findByText('smoke_2015_01 equity', {}, LATER)).toBeTruthy()
    expect(screen.queryByText(/The server refused this tear sheet/)).toBeNull()
    expect(reads.find((r) => r.path === '/api/runs/smoke_2015_01')?.status).toBe(200)
  })
})

describe('a run the dataset holds no record of', () => {
  it('still says so plainly instead of drawing anything', async () => {
    show('EQ', 'nt_za_v0_fixture_a')
    expect((await screen.findByRole('alert', {}, LATER)).textContent).toContain('The server refused this tear sheet')
    expect(seen.charts.filter((c) => c.kind === 'linestack')).toHaveLength(0)
  })
})
