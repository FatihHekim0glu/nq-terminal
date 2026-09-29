// @vitest-environment jsdom
// DES's provenance for GRAB's caption (roadmap 15): the registration tag ([PRE-REG] or [POST HOC], plus
// [OVERLAY] for a risk overlay), the headline basis and unit, the sessions behind the headline value, the
// request the card came from and the spec sha, all read from the card the screen already holds.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { panelSource, resetPanelSources } from '../../chrome/panelSources'
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import { desEquityProvenance, desProvenance, desRobustnessProvenance, desTabProvenance } from './desGrab'
import type { HypothesisDetail } from './desModel'
import { RUNS } from '../runs/runs.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_ANALYTICS } from '../tear/tearP1.fixtures'
import { OVERNIGHT, PANEL, VOLMANAGED } from './desTestData'
import HypothesisDes from './HypothesisDes'

vi.mock('../../charts/LineStack', async () => {
  const { createElement: h } = await import('react')
  return { default: () => h('div', { 'data-testid': 'des-linestack' }) }
})
vi.mock('../../charts/echarts/BarLadder', async () => {
  const { createElement: h } = await import('react')
  return { BarLadder: (props: { chartId?: string }) => h('div', { 'data-testid': `ladder-${props.chartId}` }) }
})

function withCard(detail: HypothesisDetail, card: Partial<HypothesisDetail['card']>): HypothesisDetail {
  return { ...detail, card: { ...detail.card, ...card } }
}

describe('desProvenance', () => {
  it('describes a registered hypothesis: [PRE-REG], the headline basis and unit, sessions, sha and source', () => {
    const p = desProvenance(VOLMANAGED)
    expect(p.tags).toEqual(['[PRE-REG]'])
    expect(p.basis).toBe('Basis A: headline value')
    expect(p.unit).toBe('Sharpe ratio, annualised (daily)')
    expect(p.window).toBeNull()
    expect(p.n).toBe(2686)
    expect(p.specSha).toBe('da12711dd366351b5693262b51b2230e773c10ea4cdb9d55bb925ea6b2d52dc3')
    expect(p.source).toBe('/api/hypotheses/volmanaged_v0')
  })

  it('tags a hypothesis that is not registered [POST HOC]', () => {
    expect(desProvenance(withCard(VOLMANAGED, { registered: false })).tags).toEqual(['[POST HOC]'])
  })

  it('adds [OVERLAY] after the registration tag for a risk overlay', () => {
    expect(desProvenance(withCard(VOLMANAGED, { tag: 'overlay' })).tags).toEqual(['[PRE-REG]', '[OVERLAY]'])
    expect(desProvenance(withCard(VOLMANAGED, { tag: 'overlay', registered: false })).tags).toEqual(['[POST HOC]', '[OVERLAY]'])
  })

  it('adds no [OVERLAY] to an edge or a check', () => {
    expect(desProvenance(withCard(VOLMANAGED, { tag: 'edge' })).tags).toEqual(['[PRE-REG]'])
    expect(desProvenance(withCard(VOLMANAGED, { tag: 'check' })).tags).toEqual(['[PRE-REG]'])
  })

  it('words the basis with the GRAB caption template and leaves it out without a headline basis', () => {
    expect(desProvenance(OVERNIGHT).basis).toBe(fillCopy(GRAB.caption.basis, { basis: 'A', label: GRAB.caption.headline }))
    const bare = withCard(VOLMANAGED, { headline_basis: null as unknown as 'A' })
    expect(desProvenance(bare).basis).toBeNull()
  })

  it('leaves out what the card does not hold: no unit, no sessions, no sha', () => {
    const p = desProvenance(withCard(VOLMANAGED, { headline_unit: null, n: null, spec_sha256: '' }))
    expect(p.unit).toBeNull()
    expect(p.n).toBeNull()
    expect(p.specSha).toBeNull()
  })

  it('encodes the name as one path segment', () => {
    expect(desProvenance(withCard(VOLMANAGED, { name: 'a b/c' })).source).toBe('/api/hypotheses/a%20b%2Fc')
  })

  it('makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    desProvenance(VOLMANAGED)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('desEquityProvenance', () => {
  it('describes the equity chart from the panel answer: its own [POST HOC] tag, basis, unit, window, sessions and source', () => {
    const p = desEquityProvenance(VOLMANAGED.card, PANEL, 1)
    expect(p.tags).toEqual(['[POST HOC]'])
    expect(p.basis).toBe(fillCopy(GRAB.caption.basis, { basis: PANEL.basis, label: PANEL.basis_label }))
    expect(p.basis).toBe('Basis A: screen (arithmetic on a fixed K)')
    expect(p.unit).toBe('multiple of K (K = 1), arithmetic')
    expect(p.window).toBe(fillCopy(GRAB.caption.window, { first: PANEL.first, last: PANEL.last }))
    expect(p.window).toBe('2011-04-25..2011-06-17')
    expect(p.n).toBe(39)
    expect(p.source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=1')
    expect(p.specSha).toBe(VOLMANAGED.card.spec_sha256)
  })

  it('takes the tag from the answer, not from the card registration', () => {
    const p = desEquityProvenance({ ...VOLMANAGED.card, registered: true }, { ...PANEL, tag: '[POST HOC]' }, 1)
    expect(p.tags).toEqual(['[POST HOC]'])
    expect(p.tags).not.toContain('[PRE-REG]')
  })

  it('names the cost the panel was asked at, keeps a zero cost and encodes the name as one segment', () => {
    expect(desEquityProvenance(VOLMANAGED.card, PANEL, 2).source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=2')
    expect(desEquityProvenance(VOLMANAGED.card, PANEL, 0).source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=0')
    expect(desEquityProvenance({ ...VOLMANAGED.card, name: 'a b/c' }, PANEL, 1).source).toBe('/api/analytics/hypothesis/a%20b%2Fc/panel?cost=1')
  })

  it('leaves the spec sha out when the card has none, and makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(desEquityProvenance({ ...VOLMANAGED.card, spec_sha256: '' }, PANEL, 1).specSha).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('desTabProvenance', () => {
  it('is null on Profile and Robustness, whose own charts register what they draw', () => {
    expect(desTabProvenance(VOLMANAGED, 'profile')).toBeNull()
    expect(desTabProvenance(VOLMANAGED, 'robustness')).toBeNull()
  })

  it('is the card provenance on Pass checks and Linked runs', () => {
    expect(desTabProvenance(VOLMANAGED, 'checks')).toEqual(desProvenance(VOLMANAGED))
    expect(desTabProvenance(VOLMANAGED, 'links')).toEqual(desProvenance(VOLMANAGED))
  })

  it('keeps the ladder unit on Costs when the blocks share it, or when there is no blocks unit', () => {
    // OVERNIGHT: the cost ladder and the blocks both read "points per trade (NQ), net at 1 tick per side".
    expect(desTabProvenance(OVERNIGHT, 'costs')).toEqual({ ...desProvenance(OVERNIGHT), unit: OVERNIGHT.des.cost_ladder_unit })
    const noBlocksUnit = { ...OVERNIGHT, des: { ...OVERNIGHT.des, blocks_unit: null, cost_ladder_unit: 'points per trade' } }
    expect(desTabProvenance(noBlocksUnit, 'costs')?.unit).toBe('points per trade')
  })

  it('drops the unit on Costs when the ladder and the blocks are in different units', () => {
    // VOLMANAGED: "alpha, % per year" against "alpha, % per year, 1 tick per side".
    expect(desTabProvenance(VOLMANAGED, 'costs')).toEqual({ ...desProvenance(VOLMANAGED), unit: null })
    const noLadderUnit = { ...OVERNIGHT, des: { ...OVERNIGHT.des, cost_ladder_unit: null } }
    expect(desTabProvenance(noLadderUnit, 'costs')?.unit).toBeNull()
  })
})

describe('desRobustnessProvenance', () => {
  const FORK_0 = '/api/analytics/hypothesis/volmanaged_v0?cost=0'
  const FORK_1 = '/api/analytics/hypothesis/volmanaged_v0?cost=1'
  const RUN_D = '/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D'

  it('is the card alone without a forks ladder: the card tag and the card GET, no basis, unit, window or sessions', () => {
    const p = desRobustnessProvenance(VOLMANAGED.card, [])
    expect(p.tags).toEqual(['[PRE-REG]'])
    expect(p.source).toBe('/api/hypotheses/volmanaged_v0')
    expect(p.basis).toBeNull()
    expect(p.unit).toBeNull()
    expect(p.window).toBeNull()
    expect(p.n).toBeNull()
    expect(p.specSha).toBe(VOLMANAGED.card.spec_sha256)
  })

  it('adds [POST HOC] and each fork GET, joined by the caption pair, once a forks ladder is drawn', () => {
    const p = desRobustnessProvenance(VOLMANAGED.card, [FORK_0, FORK_1, RUN_D])
    expect(p.tags).toEqual(['[PRE-REG]', '[POST HOC]'])
    expect(p.source).toBe(['/api/hypotheses/volmanaged_v0', FORK_0, FORK_1, RUN_D].join(GRAB.caption.pair))
  })

  it('does not repeat [POST HOC] for a card that is not registered', () => {
    const p = desRobustnessProvenance({ ...VOLMANAGED.card, registered: false }, [FORK_1])
    expect(p.tags).toEqual(['[POST HOC]'])
  })

  it('puts [OVERLAY] after the card tag and before [POST HOC]', () => {
    const p = desRobustnessProvenance({ ...VOLMANAGED.card, tag: 'overlay' }, [FORK_1])
    expect(p.tags).toEqual(['[PRE-REG]', '[OVERLAY]', '[POST HOC]'])
  })

  it('leaves the spec sha out when the card has none', () => {
    expect(desRobustnessProvenance({ ...VOLMANAGED.card, spec_sha256: '' }, []).specSha).toBeNull()
  })
})

// ------------------------------------------------------------ HypothesisDes registers what its tab draws

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function actions(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

function show(panelId = 'p1') {
  return render(
    createElement(ApiProvider, {
      client: createApiQueryClient(),
      children: createElement(PanelActionsContext, { value: actions(panelId) }, createElement(HypothesisDes, { name: 'volmanaged_v0', link: '-' })),
    }),
  )
}

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const EQUITY_SOURCE = '/api/analytics/hypothesis/volmanaged_v0/panel?cost=1'
const tab = (n: number, label: string) => screen.getByRole('tab', { name: `${n}) ${label}` })

describe('HypothesisDes registers the provenance of the tab it shows, for GRAB', () => {
  let releasePanel: () => void = () => {}
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    const gate = new Promise<void>((resolve) => {
      releasePanel = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://127.0.0.1')
      if (url.pathname === '/api/hypotheses/volmanaged_v0') return json(VOLMANAGED)
      if (url.pathname === '/api/analytics/hypothesis/volmanaged_v0/panel') {
        await gate
        return json(PANEL)
      }
      if (url.pathname === '/api/analytics/hypothesis/volmanaged_v0') return json(HYP_ANALYTICS)
      if (url.pathname === '/api/runs') return json(RUNS)
      if (url.pathname === '/api/analytics/run/nt_volmanaged_v0_fixture_m1') return json(RUN_ANALYTICS)
      return json({ detail: 'not in this test' }, 404)
    })
  })
  afterEach(() => {
    cleanup()
    resetPanelSources()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('registers the equity chart on Profile (the default tab): [POST HOC], the /panel GET, never the PRE-REG card', async () => {
    const view = show('p3')
    await screen.findByTestId('des-head')
    // The card alone is not what Profile draws: until the panel answer is in, nothing is registered.
    expect(panelSource('p3')).toBeNull()
    releasePanel()
    await vi.waitFor(() => expect(panelSource('p3')).not.toBeNull())
    const p = panelSource('p3')?.provenance
    expect(p).toEqual(desEquityProvenance(VOLMANAGED.card, PANEL, 1))
    expect(p?.tags).toEqual(['[POST HOC]'])
    expect(p?.tags).not.toContain('[PRE-REG]')
    expect(p?.source).toBe(EQUITY_SOURCE)
    expect(p?.source).not.toContain('/api/hypotheses/')
    expect(p?.unit).toBe('multiple of K (K = 1), arithmetic')
    view.unmount()
    expect(panelSource('p3')).toBeNull()
  })

  it('registers the card provenance on Costs, and the equity chart again on returning to Profile', async () => {
    releasePanel()
    show('p4')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe(EQUITY_SOURCE))
    fireEvent.click(tab(3, 'Costs and blocks'))
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe('/api/hypotheses/volmanaged_v0'))
    expect(panelSource('p4')?.provenance).toEqual(desTabProvenance(VOLMANAGED, 'costs'))
    expect(panelSource('p4')?.provenance?.tags).toEqual(['[PRE-REG]'])
    fireEvent.click(tab(1, 'Profile'))
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe(EQUITY_SOURCE))
    expect(panelSource('p4')?.provenance?.tags).toEqual(['[POST HOC]'])
  })

  it('registers the card provenance on the tabs that draw only the card, straight after it has loaded', async () => {
    show('p5')
    await screen.findByTestId('des-head')
    fireEvent.click(tab(2, 'Pass checks'))
    await vi.waitFor(() => expect(panelSource('p5')?.provenance).toEqual(desProvenance(VOLMANAGED)))
  })

  it('registers the card and its forks on Robustness, tagged [POST HOC] once a forks ladder is drawn', async () => {
    releasePanel()
    show('p6')
    await screen.findByTestId('des-head')
    fireEvent.click(tab(5, 'Robustness'))
    await screen.findByTestId('ladder-des-forks-a')
    await vi.waitFor(() => expect(panelSource('p6')?.provenance?.tags).toContain('[POST HOC]'))
    const p = panelSource('p6')?.provenance
    expect(p?.tags).toEqual(['[PRE-REG]', '[POST HOC]'])
    // Once /api/runs has answered, the run forks join the screen forks the ladders draw.
    await vi.waitFor(() => expect(panelSource('p6')?.provenance?.source).toContain('freq=M'))
    expect(panelSource('p6')?.provenance?.source).toBe([
      '/api/hypotheses/volmanaged_v0',
      '/api/analytics/hypothesis/volmanaged_v0?cost=0',
      '/api/analytics/hypothesis/volmanaged_v0?cost=1',
      '/api/analytics/hypothesis/volmanaged_v0?cost=2',
      '/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D',
      '/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=M',
    ].join(GRAB.caption.pair))
    expect(panelSource('p6')?.provenance?.specSha).toBe(VOLMANAGED.card.spec_sha256)
    expect(panelSource('p6')?.provenance?.basis).toBeNull()
  })
})
