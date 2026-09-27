import { describe, expect, it } from 'vitest'
import { OVERNIGHT } from '../des/desTestData'
import { csvRows, sealTarget, sealedExport, sealedFiles, type Confirmation, type HypothesisCard, type SealedView } from './sealModel'

const CONF = { name: 'rebal_v1_confirm', parent: 'rebal_v0' } as unknown as Confirmation
const CARD = { ...OVERNIGHT.card, name: 'rebal_v0', sealed: ['rebal_v1_confirm', 'rebal_v1_confirm_trades'] } as unknown as HypothesisCard

const CSV: SealedView = {
  name: 'volmanaged_oos_daily', kind: 'csv', label: 'spent window, opened 2026-09-26, descriptive only',
  columns: ['date', 'c', 'r_m_0'], n_rows: 3, markdown: null, data: null,
  values: { date: ['2022-01-03', '2022-01-04', '2022-01-05'], c: [0.61, 0.62, null], r_m_0: [0.001, -0.002, 0.0005] },
}

describe('SEAL model', () => {
  it('shows a confirmation\'s parent files and a hypothesis\'s own', () => {
    expect(sealTarget('rebal_v1_confirm', [CONF])).toEqual({ hypothesis: 'rebal_v0', confirmation: 'rebal_v1_confirm' })
    expect(sealTarget('rebal_v0', [CONF])).toEqual({ hypothesis: 'rebal_v0', confirmation: null })
    expect(sealTarget('x', undefined)).toEqual({ hypothesis: 'x', confirmation: null })
  })

  it('numbers the card\'s files and marks the ones the API does not serve', () => {
    const rows = sealedFiles(CARD, [{ name: 'rebal_v1_confirm', kind: 'json', label: 'spent' }])
    expect(rows).toEqual([
      { n: 1, name: 'rebal_v1_confirm', kind: 'json', label: 'spent', served: true },
      { n: 2, name: 'rebal_v1_confirm_trades', kind: null, label: null, served: false },
    ])
  })

  it('reads CSV rows in column order, up to a limit, keeping nulls', () => {
    expect(csvRows(CSV)).toEqual([['2022-01-03', 0.61, 0.001], ['2022-01-04', 0.62, -0.002], ['2022-01-05', null, 0.0005]])
    expect(csvRows(CSV, 1)).toHaveLength(1)
  })

  it('exports a CSV view as CSV and a JSON view as JSON', () => {
    expect(sealedExport(CSV)).toEqual({ text: 'date,c,r_m_0\r\n2022-01-03,0.61,0.001\r\n2022-01-04,0.62,-0.002\r\n2022-01-05,,0.0005', type: 'csv', rows: 3 })
    const json = sealedExport({ ...CSV, kind: 'json', columns: null, values: null, n_rows: null, data: { verdict: 'FAIL' } })
    expect(json).toEqual({ text: '{\n  "verdict": "FAIL"\n}', type: 'json', rows: 1 })
  })
})
