import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { TRACKING } from '../../copy/tracking'
import { trackingView } from './trackingModel'

type PaperTracking = Schemas['PaperTracking']

const BASE: PaperTracking = {
  journal: 'volmanaged_paper_journal.jsonl', present: true, empty_state: null,
  banner: 'PLUMBING TEST, DELAYED DATA: not strategy performance', basis: 'performance rows only (plumbing rows dropped)',
  tag: '[POST HOC]', label: 'paper P&L against the rule', unit: 'USD per session', multiplier: 2, plumbing_rows_skipped: 1,
  t: [1790726400, null, 1790899200, 1790985600],
  date: ['2026-09-30', '', '2026-10-02', '2026-10-05'],
  paper: [null, 5, 12.5, -4],
  model: [null, 5, 10, -2],
  difference: [null, 0, 2.5, -2],
  paper_cumulative: [null, 5, 17.5, 13.5],
  model_cumulative: [null, 5, 15, 13],
  n: 3, total_difference: 0.5, tracking_sd: 2.25,
}

describe('trackingView', () => {
  it('draws cumulative paper against model and the per-session difference on the dated rows only', () => {
    const view = trackingView(BASE)
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.t).toEqual([1790726400, 1790899200, 1790985600])
    const [cumulative, difference] = view.panes
    expect(cumulative!.series.map((s) => [s.name, s.style, s.values])).toEqual([
      [TRACKING.paperSeries, 'primary', [null, 17.5, 13.5]],
      [TRACKING.modelSeries, 'benchmark', [null, 15, 13]],
    ])
    expect(difference!.series[0]!.values).toEqual([null, 2.5, -2])
    expect(difference!.signed).toBe(true)
    expect(view.undated).toBe(1)
  })

  it('born failing: a row without a time never reaches the chart (the time axis must ascend)', () => {
    const view = trackingView(BASE)
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.t.every((t, i) => i === 0 || t > view.t[i - 1]!)).toBe(true)
    expect(view.t).not.toContain(null)
  })

  it('states the totals with the API unit', () => {
    const view = trackingView(BASE)
    expect(view.summary).toBe('Sessions with a close on both days 3. Total difference +0.50 USD. Tracking sd 2.25 USD per session.')
  })

  it('names the expected file when the journal is not written yet', () => {
    const view = trackingView({ ...BASE, present: false, empty_state: 'no journal yet: live/logs/volmanaged_paper_journal.jsonl' })
    expect(view).toMatchObject({ kind: 'absent', text: 'no journal yet: live/logs/volmanaged_paper_journal.jsonl' })
  })

  it('says so when no session has a price on both days', () => {
    const none = { ...BASE, paper: [null, null, null, null], model: [null, null, null, null], difference: [null, null, null, null],
      paper_cumulative: [null, null, null, null], model_cumulative: [null, null, null, null], n: 0, total_difference: 0, tracking_sd: null }
    expect(trackingView(none)).toMatchObject({ kind: 'empty', text: TRACKING.empty })
  })
})
