import { describe, expect, it } from 'vitest'
import { HYP_ANALYTICS, RUN_ANALYTICS, SMOKE_ANALYTICS } from './tear.fixtures'
import { formatKpi } from '../../tiles/KpiTile'
import { kpiTiles, tearTags } from './tearKpis'

const byKey = (tiles: ReturnType<typeof kpiTiles>, key: string) => {
  const tile = tiles.find((t) => t.kpi.key === key)
  if (!tile) throw new Error(`no tile ${key}`)
  return tile
}
const face = (tile: ReturnType<typeof kpiTiles>[number]) =>
  formatKpi(tile.kpi.value, tile.kpi.unit, tile.decimals, tile.signed)

describe('KPI row (UI_SPEC section 7, tear sheet order)', () => {
  it('keeps all 13 tiles in the API order', () => {
    const tiles = kpiTiles(RUN_ANALYTICS)
    expect(tiles.map((t) => t.kpi.key)).toEqual(RUN_ANALYTICS.kpis.map((k) => k.key))
    expect(tiles).toHaveLength(13)
  })

  it('shows each value equal to the API value at the displayed precision', () => {
    const tiles = kpiTiles(RUN_ANALYTICS)
    const api = (key: string) => RUN_ANALYTICS.kpis.find((k) => k.key === key)!.value!
    expect(face(byKey(tiles, 'total_return'))).toBe(`${(api('total_return') * 100).toFixed(2)}%`)
    expect(face(byKey(tiles, 'total_return'))).toBe('-0.36%')
    expect(face(byKey(tiles, 'sharpe'))).toBe(api('sharpe').toFixed(2))
    expect(face(byKey(tiles, 'volatility'))).toBe('1.55%')
    expect(face(byKey(tiles, 'max_drawdown'))).toBe('-0.36%')
    expect(face(byKey(tiles, 'psr_0'))).toBe(api('psr_0').toFixed(3))
  })

  it('carries the basis, the full API unit and the tag of every tile', () => {
    for (const tile of kpiTiles(HYP_ANALYTICS)) {
      const source = HYP_ANALYTICS.kpis.find((k) => k.key === tile.kpi.key)!
      expect(tile.kpi.basis).toBe(source.basis)
      expect(tile.kpi.tag).toBe(source.tag)
      expect(tile.description).toContain(source.unit)
      expect(tile.description).toContain(source.tag)
    }
  })

  it('G08: keeps the full API unit for the popover, separate from the short face unit', () => {
    const tiles = kpiTiles(HYP_ANALYTICS)
    const alpha = byKey(tiles, 'alpha_annual')
    expect(alpha.unit).toBe('% per year')
    expect(alpha.kpi.unit).toBe('%')
    const alphaT = byKey(tiles, 'alpha_t')
    expect(alphaT.unit).toBe('t statistic (gating, as the screen records it)')
    expect(alphaT.kpi.unit).toBe('')
  })

  it('says when a value is shown as a percentage of the API fraction', () => {
    const tile = byKey(kpiTiles(RUN_ANALYTICS), 'cagr')
    expect(tile.kpi.unit).toBe('%')
    expect(tile.description).toMatch(/times 100/)
  })

  it('puts the Sharpe interval on the Sharpe tile only', () => {
    const tiles = kpiTiles(RUN_ANALYTICS)
    expect(byKey(tiles, 'sharpe').ci).toEqual([RUN_ANALYTICS.ci.lo, RUN_ANALYTICS.ci.hi])
    expect(tiles.filter((t) => t.ci).map((t) => t.kpi.key)).toEqual(['sharpe'])
  })

  it('shows the stored [PRE-REG] alpha as the API tags it', () => {
    const alpha = byKey(kpiTiles(HYP_ANALYTICS), 'alpha_annual')
    const source = HYP_ANALYTICS.kpis.find((k) => k.key === 'alpha_annual')!
    expect(alpha.kpi.tag).toBe(source.tag)
    expect(face(alpha)).toBe(`${source.value! >= 0 ? '+' : ''}${source.value!.toFixed(2)}%`)
  })

  it('keeps a missing value missing, with its note', () => {
    const minTrl = byKey(kpiTiles(RUN_ANALYTICS), 'min_trl')
    expect(minTrl.kpi.value).toBeNull()
    expect(face(minTrl)).toBe('--')
  })
})

describe('panel tags (UI_SPEC section 6)', () => {
  it('names the series tag, and [PRE-REG] when a stored alpha is shown', () => {
    expect(tearTags(RUN_ANALYTICS)).toEqual(['POST HOC'])
    expect(tearTags(SMOKE_ANALYTICS)).toEqual(['POST HOC'])
    expect(tearTags(HYP_ANALYTICS)).toEqual(['POST HOC', 'PRE-REG'])
  })
})
