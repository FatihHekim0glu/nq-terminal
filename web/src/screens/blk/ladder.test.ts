import { describe, expect, it } from 'vitest'
import { barLadderTable } from '../../charts/echarts/barLadderModel'
import { OVERNIGHT } from '../des/desTestData'
import { blocksInput, costInput } from '../des/desModel'
import { blockRows, costRows, ladderCsv } from './ladder'

describe('BLK and COST rows (TASKS 9.4): the DES ladders as numbered rows, the same text', () => {
  it('numbers the blocks and prints each value exactly as the DES ladder table does', () => {
    const rows = blockRows(OVERNIGHT.des)
    const des = barLadderTable(blocksInput(OVERNIGHT.des, 'overnight_v0')!)
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3])
    expect(rows.map((r) => r.label)).toEqual(['2010-13', '2014-17', '2018-21'])
    expect(rows.map((r) => r.value)).toEqual(des.rows.map((r) => r['value']))
    expect(rows[0]?.value).toBe('+0.58')
    expect(rows.map((r) => r.raw)).toEqual(OVERNIGHT.des.blocks.map((b) => b.value))
  })

  it('labels each cost rung in ticks per side and prints it as DES does', () => {
    const rows = costRows(OVERNIGHT.des)
    const des = barLadderTable(costInput(OVERNIGHT.des, 'overnight_v0')!)
    expect(rows.map((r) => r.label)).toEqual(des.rows.map((r) => r['label']))
    expect(rows.map((r) => r.value)).toEqual(des.rows.map((r) => r['value']))
  })

  it('shows a missing value as --, and an empty ladder as no rows', () => {
    const des = { ...OVERNIGHT.des, blocks: [{ label: '2010-13', value: null as unknown as number }], cost_ladder: [] }
    expect(blockRows(des)[0]?.value).toBe('--')
    expect(costRows(des)).toEqual([])
  })

  it('exports the full-precision values, not the printed ones', () => {
    const csv = ladderCsv(['Block', 'Value'], blockRows(OVERNIGHT.des))
    expect(csv.split('\r\n')).toEqual(['Block,Value', '2010-13,0.5842317073170729', '2014-17,1.478655310621243', '2018-21,6.1017199602780545'])
  })
})
