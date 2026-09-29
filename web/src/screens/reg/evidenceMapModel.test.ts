// evidenceMapModel (roadmap #5 slice 3, W8-R5c): 94) Effect map over the real research fixtures. The served
// annual Sharpe against n / periods years, one point per SV3a trial. A point's mark is its REGISTRY ROW NUMBER
// (1 + its index in the rows 91) Board shows), never a Sharpe rank: W1 promised no score, rank or total.
import { describe, expect, it } from 'vitest'
import { glyphScatterTable, offScaleLines, placedPoints } from '../../charts/echarts/glyphScatterModel'
import { EVIDENCE_MAP } from '../../copy/evidence'
import { DEFLATED_REAL } from './deflatedFixtures'
import { formatDsr } from './deflatedModel'
import { MAP_Y_LIMIT, buildEvidenceMap, type EvidenceMapView } from './evidenceMapModel'
import { buildRegRows } from './regModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import type { DeflatedView } from './deflatedModel'

const ROWS = buildRegRows(REGISTRY, HYPOTHESES)
const MAP = buildEvidenceMap(DEFLATED_REAL, ROWS)

/** The 1-based place of a name in the served registry, the number 91) Board and 92) Evidence print. */
const registryNumber = (name: string): number => 1 + REGISTRY.rows.findIndex((r) => r.name === name)

function pointOf(map: EvidenceMapView, name: string) {
  const point = map.input.points.find((p) => p.label === name)
  if (!point) throw new Error(`no point ${name}`)
  return point
}

function withRows(mutate: (rows: DeflatedView['rows']) => DeflatedView['rows']): DeflatedView {
  return { ...DEFLATED_REAL, rows: mutate(DEFLATED_REAL.rows) }
}

describe('buildEvidenceMap: the points', () => {
  it('draws 21 points, one per SV3a trial, at its served years (n / periods) and served annual Sharpe', () => {
    expect(MAP.input.points).toHaveLength(21)
    for (const row of DEFLATED_REAL.rows) {
      const p = pointOf(MAP, row.name)
      expect(p.x).toBe(row.n / row.periods)
      expect(p.y).toBe(row.annual_sharpe)
    }
  })

  it('plots years on a linear x axis today (11.25 / 9.99 is under 10) and says why in the note', () => {
    expect(MAP.input.x.scale).toBe('linear')
    expect(MAP.input.y.scale).toBe('linear')
    expect(MAP.note).toContain('is linear')
    expect(MAP.note).toContain('at least 10 times')
  })

  it('goes logarithmic exactly when the longest track is at least 10 times the shortest', () => {
    const at = (longest: number) => buildEvidenceMap(
      withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, n: 252, periods: 252 } : i === 1 ? { ...r, n: longest, periods: 252 } : r)).slice(0, 2)),
      ROWS,
    )
    // 1 year against 10 years is exactly 10 times: logarithmic. Just under is linear.
    expect(at(2520).input.x.scale).toBe('log')
    expect(at(2519).input.x.scale).toBe('linear')
    expect(at(2520).note).toContain('is log')
    expect(at(2519).note).toContain('is linear')
  })

  it('fits the linear years axis to the tracks, without forcing zero into a 10 year cluster', () => {
    const { min, max } = MAP.input.x
    expect(min).toBeLessThanOrEqual(2517 / 252)
    expect(max).toBeGreaterThanOrEqual(2836 / 252)
    expect(min).toBeGreaterThan(5)
    expect(max).toBeLessThan(15)
  })
})

describe('buildEvidenceMap: pinned at the y limit', () => {
  it('states the limit as 3 annual Sharpe on both sides and keeps the axis inside it', () => {
    expect(MAP_Y_LIMIT).toBe(3)
    const { min, max } = MAP.input.y
    expect(min).toBe(-3)
    expect(max).toBeLessThanOrEqual(3)
    expect(max).toBeGreaterThanOrEqual(1.0525561685947904)
  })

  it('pins mim_v0 (-11.49) at the bottom edge with its true value, and pins nothing else', () => {
    const { drawn } = placedPoints(MAP.input)
    const off = drawn.filter((p) => p.off)
    expect(off.map((p) => p.label)).toEqual(['mim_v0'])
    const mim = off[0]!
    expect(mim.y).toBe(-11.490576467936904)
    expect(mim.py).toBe(-3)
    expect(mim.px).toBe(mim.x)
  })

  it('gives mim_v0 its registry row number as its mark (17), not its Sharpe rank (21 of 21)', () => {
    expect(registryNumber('mim_v0')).toBe(17)
    expect(pointOf(MAP, 'mim_v0').tag).toBe('17')
  })
})

describe('buildEvidenceMap: marks are registry row numbers', () => {
  it('born failing for a Sharpe-rank tagging: every mark is 1 + the trial\'s index in the served registry', () => {
    for (const p of MAP.input.points) expect(p.tag).toBe(String(registryNumber(p.label)))
  })

  it('does not number by Sharpe: the highest Sharpe (tsmom_v0) is row 10, not 1, and the lowest is not 21', () => {
    const best = [...DEFLATED_REAL.rows].sort((a, b) => (b.annual_sharpe ?? 0) - (a.annual_sharpe ?? 0))[0]!
    expect(best.name).toBe('tsmom_v0')
    expect(pointOf(MAP, 'tsmom_v0').tag).toBe('10')
    expect(pointOf(MAP, 'za_v0').tag).toBe('1')
    expect(pointOf(MAP, 'overnight_v0').tag).toBe('6')
    expect(pointOf(MAP, 'vt_har_v0').tag).toBe('21')
  })

  it('follows the rows it is given: the same trial gets the number the board would print for it', () => {
    const shown = ROWS.filter((r) => r.name !== 'za_v0')
    const map = buildEvidenceMap(DEFLATED_REAL, shown)
    expect(pointOf(map, 'tom_v0').tag).toBe('2')
    expect(pointOf(map, 'mim_v0').tag).toBe('16')
  })

  it('lists the numbered points for Number <GO>, each n with the name it opens, in row order', () => {
    expect(MAP.points).toHaveLength(21)
    expect(MAP.points[0]).toEqual({ n: 1, name: 'za_v0' })
    expect(MAP.points.find((p) => p.name === 'mim_v0')).toEqual({ n: 17, name: 'mim_v0' })
    expect(MAP.points.map((p) => p.n)).toEqual([...MAP.points.map((p) => p.n)].sort((a, b) => a - b))
    expect(new Set(MAP.points.map((p) => p.n)).size).toBe(21)
  })

  it('leaves out of the numbering the registry row with no SV3a trial (row 2, za_v0_C3_gao_momentum): no gap is filled', () => {
    expect(MAP.points.some((p) => p.n === 2)).toBe(false)
    expect(MAP.input.points.some((p) => p.tag === '2')).toBe(false)
    expect(pointOf(MAP, 'tom_v0').tag).toBe('3')
  })

  it('gives a deflated row with no registry row the mark "-", no number, and names it in the note', () => {
    const rows = ROWS.filter((r) => r.name !== 'mim_v0')
    const map = buildEvidenceMap(DEFLATED_REAL, rows)
    expect(map.input.points).toHaveLength(21)
    expect(pointOf(map, 'mim_v0').tag).toBe('-')
    expect(map.points.some((p) => p.name === 'mim_v0')).toBe(false)
    expect(map.points).toHaveLength(20)
    expect(map.note).toContain('mim_v0')
    expect(map.note).toContain(EVIDENCE_MAP.unnumbered.split('{names}')[0]!.trim())
  })

  it('draws that row as a ring with the kind "no registry row", never a verdict of its own', () => {
    const map = buildEvidenceMap(DEFLATED_REAL, ROWS.filter((r) => r.name !== 'overnight_v0'))
    const p = pointOf(map, 'overnight_v0')
    expect(p.glyph).toBe('ring')
    expect(p.kind).toBe(EVIDENCE_MAP.kindNone)
    expect(p.hollow).toBeFalsy()
  })

  it('says nothing about unnumbered rows when every trial has a registry row', () => {
    expect(MAP.note).not.toContain(EVIDENCE_MAP.unnumbered.split('{names}')[0]!.trim())
  })

  it('carries no score, rank or total anywhere on the view or its points', () => {
    for (const bag of [MAP, MAP.input, ...MAP.input.points, ...MAP.points]) {
      const keys = Object.keys(bag)
      expect(keys).not.toContain('score')
      expect(keys).not.toContain('rank')
      expect(keys).not.toContain('total')
    }
    expect(EVIDENCE_MAP.marks).toBe('Marks are the registry row numbers of 91) Board in its served order.')
  })
})

describe('buildEvidenceMap: reference lines', () => {
  it('draws SR0 under V0 and zero, and leaves SR0 under V (5.09) off the axes', () => {
    const labels = (MAP.input.lines ?? []).map((l) => l.label)
    expect(labels).toHaveLength(3)
    const off = offScaleLines(MAP.input)
    expect(off).toHaveLength(1)
    expect(off[0]!.label).toBe('SR0 under V 5.09')
    expect(off[0]!.value).toBe(DEFLATED_REAL.sr0_annual)
  })

  it('names the off-axis SR0 V line in the note, with its value', () => {
    expect(MAP.note).toContain('SR0 under V 5.09')
    expect(MAP.note).toContain('Off the axes')
  })

  it('labels the V0 line with SR0 0.59 and N 21, in the data tone, at the served value', () => {
    const line = (MAP.input.lines ?? []).find((l) => l.label.includes('V0'))!
    expect(line.label).toBe('SR0 under V0 0.59 (N 21)')
    expect(line.axis).toBe('y')
    expect(line.value).toBe(DEFLATED_REAL.sr0_null_annual)
    expect(line.tone).toBe('data')
  })

  it('draws the V line in the accent tone and zero in muted', () => {
    const lines = MAP.input.lines ?? []
    expect(lines.find((l) => l.label === 'SR0 under V 5.09')).toMatchObject({ axis: 'y', tone: 'accent', value: DEFLATED_REAL.sr0_annual })
    expect(lines.find((l) => l.label === EVIDENCE_MAP.zeroLine)).toMatchObject({ axis: 'y', tone: 'muted', value: 0 })
  })

  it('keeps the V line on the chart when V is inside the limit, and says nothing is off the axes', () => {
    const map = buildEvidenceMap({ ...DEFLATED_REAL, sr0_annual: 1.5 }, ROWS)
    expect(offScaleLines(map.input)).toHaveLength(0)
    expect(map.note).not.toContain('Off the axes')
  })
})

describe('buildEvidenceMap: verdict glyphs and hollow points', () => {
  it('draws PASS as a triangle up, FAIL as a triangle down, from the badge the files give', () => {
    expect(pointOf(MAP, 'overnight_v0').glyph).toBe('up')
    expect(pointOf(MAP, 'eomtsy_v0').glyph).toBe('up')
    expect(pointOf(MAP, 'volmanaged_v0').glyph).toBe('down')
    expect(pointOf(MAP, 'mim_v0').glyph).toBe('down')
    expect(MAP.input.points.filter((p) => p.glyph === 'up')).toHaveLength(3)
    expect(MAP.input.points.filter((p) => p.glyph === 'down')).toHaveLength(18)
    expect(MAP.input.points.filter((p) => p.glyph === 'ring')).toHaveLength(0)
  })

  it('draws a CHECK row as a ring', () => {
    const rows = ROWS.map((r) => (r.name === 'tom_v0' ? { ...r, badge: 'CHECK' as const } : r))
    expect(pointOf(buildEvidenceMap(DEFLATED_REAL, rows), 'tom_v0').glyph).toBe('ring')
  })

  it('makes only the overlay hollow: vt_har_v0 is a triangle up and hollow', () => {
    const vt = pointOf(MAP, 'vt_har_v0')
    expect(vt.glyph).toBe('up')
    expect(vt.hollow).toBe(true)
    expect(MAP.input.points.filter((p) => p.hollow)).toHaveLength(1)
  })

  it('names the kind from the badge itself', () => {
    expect(pointOf(MAP, 'overnight_v0').kind).toBe('PASS')
    expect(pointOf(MAP, 'volmanaged_v0').kind).toBe('FAIL')
  })
})

describe('buildEvidenceMap: the table view', () => {
  it('has one row per point with the mark, the served values and DSR V0 as the extra column', () => {
    const table = glyphScatterTable(MAP.input)
    expect(table.rows).toHaveLength(21)
    expect(table.columns.map((c) => c.label)).toContain(EVIDENCE_MAP.dsrCol)
    const dsr = MAP.input.extraColumns![0]!
    expect(dsr.label).toBe('DSR V0')
    const overnight = table.rows.find((r) => r.point === 'overnight_v0')!
    expect(overnight.tag).toBe('6')
    expect(overnight[dsr.key]).toBe(formatDsr(0.7845748411145064))
  })

  it('still lists the pinned point at its true value in the table', () => {
    const mim = glyphScatterTable(MAP.input).rows.find((r) => r.point === 'mim_v0')!
    expect(String(mim.y)).toContain('-11.49')
    expect(mim.tag).toBe('17')
  })
})

describe('buildEvidenceMap: edges', () => {
  it('has no points, no note and no numbered items for an empty view', () => {
    const map = buildEvidenceMap(withRows(() => []), ROWS)
    expect(map.input.points).toHaveLength(0)
    expect(map.points).toEqual([])
    expect(map.note).toBeNull()
  })

  it('keeps every point when the registry rows are empty: all are "-" and all are listed', () => {
    const map = buildEvidenceMap(DEFLATED_REAL, [])
    expect(map.input.points).toHaveLength(21)
    expect(map.input.points.every((p) => p.tag === '-')).toBe(true)
    expect(map.points).toEqual([])
  })

  it('drops a non-finite Sharpe from the chart but keeps it in the table', () => {
    const map = buildEvidenceMap(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, annual_sharpe: Number.NaN } : r))), ROWS)
    expect(placedPoints(map.input).dropped).toBe(1)
    expect(glyphScatterTable(map.input).rows).toHaveLength(21)
  })

  it('treats a missing served Sharpe or SR0 as not drawn and off the axes, never as a crash or a zero', () => {
    const view = { ...DEFLATED_REAL, sr0_annual: null, rows: DEFLATED_REAL.rows.map((r, i) => (i === 0 ? { ...r, annual_sharpe: null } : r)) }
    const map = buildEvidenceMap(view, ROWS)
    expect(placedPoints(map.input).dropped).toBe(1)
    expect(glyphScatterTable(map.input).rows.find((r) => r.point === 'za_v0')!.y).toBe('--')
    expect(map.note).toContain('Off the axes: SR0 under V --.')
  })

  it('does not change the rows it is given', () => {
    const before = JSON.stringify([DEFLATED_REAL, ROWS])
    buildEvidenceMap(DEFLATED_REAL, ROWS)
    expect(JSON.stringify([DEFLATED_REAL, ROWS])).toBe(before)
  })

  it('names the chart, both axes and the basis from the copy', () => {
    expect(MAP.input.name).toBe(EVIDENCE_MAP.name)
    expect(MAP.input.x.label).toBe(EVIDENCE_MAP.xAxis)
    expect(MAP.input.y.label).toBe(EVIDENCE_MAP.yAxis)
  })
})
