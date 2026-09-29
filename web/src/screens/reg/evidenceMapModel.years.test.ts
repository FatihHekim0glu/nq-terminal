// REG 94) Effect map: the years axis is a duration, so its values read "10.66" in the accessible summary and the
// table view, never "+10.66" (the Sharpe axis stays signed).
import { describe, expect, it } from 'vitest'
import { describeGlyphScatter, glyphScatterTable } from '../../charts/echarts/glyphScatterModel'
import { DEFLATED_REAL } from './deflatedFixtures'
import { buildEvidenceMap } from './evidenceMapModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import { buildRegRows } from './regModel'

const MAP = buildEvidenceMap(DEFLATED_REAL, buildRegRows(REGISTRY, HYPOTHESES))

describe('buildEvidenceMap: the years axis is unsigned', () => {
  it('sets signed: false on the x axis and leaves the y axis to its default', () => {
    expect(MAP.input.x.signed).toBe(false)
    expect(MAP.input.y.signed).toBeUndefined()
  })

  it("shows volmanaged_v0's years as 10.66 in the table view", () => {
    const table = glyphScatterTable(MAP.input)
    const row = table.rows.find((r) => r.point === 'volmanaged_v0')
    expect(row?.x).toBe('10.66')
  })

  it('writes every years cell in the table without a plus', () => {
    for (const row of glyphScatterTable(MAP.input).rows) expect(String(row.x), String(row.point)).not.toMatch(/^\+/)
  })

  it('writes the years range of the accessible summary without a plus, and the Sharpe range signed', () => {
    const text = describeGlyphScatter(MAP.input)
    expect(text).toMatch(/Years \(n \/ P\) from \d/)
    expect(text).not.toMatch(/Years \(n \/ P\) from \+/)
    expect(text).not.toMatch(/ to \+\d+\.\d+, Sharpe/)
  })

  it('keeps the same on a logarithmic years axis', () => {
    const longRun = { ...DEFLATED_REAL, rows: DEFLATED_REAL.rows.map((r, i) => (i === 0 ? { ...r, n: r.n * 20 } : r)) }
    const log = buildEvidenceMap(longRun, buildRegRows(REGISTRY, HYPOTHESES))
    expect(log.input.x.scale).toBe('log')
    expect(log.input.x.signed).toBe(false)
    for (const row of glyphScatterTable(log.input).rows) expect(String(row.x)).not.toMatch(/^\+/)
  })
})
