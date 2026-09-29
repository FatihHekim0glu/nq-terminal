// @vitest-environment jsdom
// N04 on DES page 3: the cost ladder and the block bars carry the t the screen file records beside each bar, under a
// [PRE-REG] note that says what it is and that no interval is drawn. Where the file records no t the page is as it was.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LADDER_T } from '../../copy/ladderT'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import DesCosts from './DesCosts'
import type { HypothesisDetail } from './desModel'
import { VOLMANAGED } from './desTestData'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { chartId?: string; data: BarLadderInput }) => <div data-testid={`ladder-${props.chartId}`} data-labels={JSON.stringify(props.data.bars.map((b) => b.label))} data-whiskers={String(props.data.bars.some((b) => b.lo !== undefined || b.hi !== undefined))} />,
}))

afterEach(() => cleanup())

const WITH_T: HypothesisDetail = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN as HypothesisDetail['screen'] }
const labels = (id: string) => JSON.parse(screen.getByTestId(`ladder-${id}`).getAttribute('data-labels') ?? '[]') as string[]

describe('N04: DES costs and blocks show the recorded t', () => {
  it('prints t under each cost rung and each block from the screen file', () => {
    render(<DesCosts detail={WITH_T} />)
    expect(labels('des-cost')).toEqual(['0 ticks, t 1.19', '1 tick, t 1.18', '2 ticks, t 1.16'])
    expect(labels('des-blocks')).toEqual(['2010-13, t 1.24', '2014-17, t -0.41', '2018-21, t 0.79'])
  })

  it('draws no whisker: the file records no interval for these bars and none is computed (C8)', () => {
    render(<DesCosts detail={WITH_T} />)
    expect(screen.getByTestId('ladder-des-cost').getAttribute('data-whiskers')).toBe('false')
    expect(screen.getByTestId('ladder-des-blocks').getAttribute('data-whiskers')).toBe('false')
  })

  it('says under each ladder what the t is, tagged [PRE-REG], with the gating statistic', () => {
    render(<DesCosts detail={WITH_T} />)
    const notes = screen.getAllByTestId('ladder-t-note')
    expect(notes).toHaveLength(2)
    for (const note of notes) {
      expect(within(note).getByText('[PRE-REG]')).toBeTruthy()
      expect(note.textContent).toContain(LADDER_T.note)
      expect(note.textContent).toContain('Gating: alpha t (gating: smaller of Newey-West lags 5 and 21) 1.18.')
    }
  })

  it('tags a post hoc hypothesis [POST HOC], not [PRE-REG]', () => {
    render(<DesCosts detail={{ ...WITH_T, card: { ...WITH_T.card, registered: false } }} />)
    const note = screen.getAllByTestId('ladder-t-note')[0]!
    expect(within(note).getByText('[POST HOC]')).toBeTruthy()
    expect(within(note).queryByText('[PRE-REG]')).toBeNull()
  })

  it('leaves the page as it was when the file records no t beside the bars', () => {
    render(<DesCosts detail={VOLMANAGED} />)
    expect(labels('des-cost')).toEqual(['0 ticks', '1 tick', '2 ticks'])
    expect(labels('des-blocks')).toEqual(['2010-13', '2014-17', '2018-21'])
    expect(screen.queryByTestId('ladder-t-note')).toBeNull()
  })

  it('omits the gating sentence when the card records no t', () => {
    render(<DesCosts detail={{ ...WITH_T, card: { ...WITH_T.card, t_stat: null } }} />)
    const note = screen.getAllByTestId('ladder-t-note')[0]!
    expect(note.textContent).toContain(LADDER_T.note)
    expect(note.textContent).not.toContain('Gating')
  })
})
