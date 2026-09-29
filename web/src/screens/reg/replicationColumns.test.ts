// MT 86) Replication grid columns: names amber, p-values to four decimals, verdicts as bracket text in
// up and down tones (never colour alone), `--` for a missing value.
import { describe, expect, it } from 'vitest'
import { cellText } from '../../grids/MonitorGrid'
import { REPLICATION } from '../../copy/replication'
import { REPLICATION_COLUMNS, replicationRowId } from './replicationColumns'
import { buildReplication, type ReplicationPoint } from './replicationModel'
import { MULTIPLE_TESTING, REGISTRY } from './regFixtures'

const POINT = buildReplication(MULTIPLE_TESTING, REGISTRY).points[0]!
const col = (id: string) => REPLICATION_COLUMNS.find((c) => c.id === id)!
const cells = (row: ReplicationPoint) => REPLICATION_COLUMNS.map((c) => cellText(c, row))

describe('REPLICATION_COLUMNS', () => {
  it('has the eight columns in order, headed by the copy', () => {
    expect(REPLICATION_COLUMNS.map((c) => c.id)).toEqual([
      'parent', 'confirmation', 'inSampleP', 'inSampleVerdict', 'sealedP', 'ownAlpha', 'sealedVerdict', 'window',
    ])
    expect(REPLICATION_COLUMNS.map((c) => c.header)).toEqual(Object.values(REPLICATION.cols))
    expect(REPLICATION_COLUMNS.map((c) => c.width)).toEqual([138, 150, 58, 60, 58, 60, 60, 220])
    expect(REPLICATION_COLUMNS.map((c) => c.kind)).toEqual(['name', 'name', 'num', 'text', 'num', 'num', 'text', 'text'])
  })

  it('writes the pinned pair to four decimals with bracket verdicts', () => {
    expect(cells(POINT)).toEqual([
      'rebal_v0', 'rebal_v1_confirm', '0.1300', '[FAIL]', '0.3375', '0.05', '[FAIL]', 'spent window, opened 2026-09-26, descriptive only',
    ])
  })

  it('writes -- for an unread in-sample verdict and a missing own alpha', () => {
    const row: ReplicationPoint = { ...POINT, inSampleBadge: null, ownAlpha: null }
    expect(cellText(col('inSampleVerdict'), row)).toBe('--')
    expect(cellText(col('ownAlpha'), row)).toBe('--')
    expect(col('inSampleVerdict').tone?.(row)).toBeUndefined()
  })

  it('tones the verdicts: PASS up, FAIL down, anything else muted', () => {
    const tone = (badge: ReplicationPoint['sealedBadge']) => col('sealedVerdict').tone?.({ ...POINT, sealedBadge: badge })
    expect(tone('PASS')).toBe('up')
    expect(tone('FAIL')).toBe('down')
    expect(tone('CHECK')).toBe('muted')
    expect(col('inSampleVerdict').tone?.({ ...POINT, inSampleBadge: 'PASS' })).toBe('up')
    expect(col('window').tone?.(POINT)).toBe('muted')
  })

  it('sorts the p columns by value and the window by text', () => {
    expect(col('inSampleP').value(POINT)).toBe(0.13004898713256266)
    expect(col('sealedP').value(POINT)).toBe(0.3374637034513802)
    expect(col('window').value(POINT)).toBe(POINT.window)
  })

  it('keys a row by its confirmation', () => {
    expect(replicationRowId(POINT)).toBe('rebal_v1_confirm')
  })
})
