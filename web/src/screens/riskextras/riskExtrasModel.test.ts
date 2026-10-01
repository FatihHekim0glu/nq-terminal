// The risk extras as display rows and tiles (TASKS Phase 12; RK4, PF11, BR5): the API's values, a fraction shown
// times 100, nothing new computed; the modified ES greyed wherever it is not defined, with the reason.
import { describe, expect, it } from 'vitest'
import { RISK_EXTRAS as R } from '../../copy/riskExtras'
import { HYP_RISK_EXTRAS, IN_DOMAIN, INVERSE, RUN_RISK_EXTRAS } from './riskExtras.fixtures'
import { drawdownTiles, esMoments, esRows, treynorLine, treynorTile } from './riskExtrasModel'

describe('PF11 tiles', () => {
  it('shows the ulcer index of a fraction as a percentage and the recovery factor as a ratio', () => {
    const [ulcer, recovery] = drawdownTiles(HYP_RISK_EXTRAS)
    expect(ulcer?.kpi.value).toBeCloseTo(4.393028150937359, 12)
    expect(ulcer?.kpi.unit).toBe('%')
    expect(recovery?.kpi.value).toBe(-0.8431248946879083)
    expect(recovery?.kpi.unit).toBe('ratio')
    expect(ulcer?.description).toContain('all 39 sessions')
    expect(ulcer?.description).toContain('n - 1')
    expect(recovery?.description).toContain('deepest drawdown')
    expect(ulcer?.kpi.tag).toBe('[POST HOC]')
  })

  it('keeps the API unit for the popover while the face shows the short one (G08)', () => {
    const [ulcer, recovery] = drawdownTiles(HYP_RISK_EXTRAS)
    expect(ulcer?.unit).toBe(HYP_RISK_EXTRAS.drawdown_tiles[0]?.unit)
    expect(ulcer?.unit).not.toBe(ulcer?.kpi.unit)
    expect(recovery?.unit).toBe(HYP_RISK_EXTRAS.drawdown_tiles[1]?.unit)
    expect(treynorTile(HYP_RISK_EXTRAS).unit).toBe(HYP_RISK_EXTRAS.treynor.tile.unit)
  })

  it('born failing: a tile left in API units would read 100 times too small', () => {
    const [ulcer] = drawdownTiles(HYP_RISK_EXTRAS)
    expect(ulcer?.kpi.value).not.toBe(HYP_RISK_EXTRAS.drawdown_tiles[0]?.value)
  })
})

describe('RK4 table', () => {
  it('outside the domain shows the historical CVaR, greyed, and says modified is not defined', () => {
    const rows = esRows(HYP_RISK_EXTRAS)
    expect(rows.map((r) => r.level)).toEqual(['95%', '99%'])
    const first = rows[0]
    expect(first?.modified).toBe(R.es.notDefined)
    expect(first?.greyed).toBe(true)
    expect(first?.used).toBe(R.es.usedHistorical)
    expect(first?.value).toBe(first?.historical)
    expect(first?.value).toBe('2.02%')
  })

  it('inside the domain shows the modified ES and names the floor where it was taken', () => {
    const [inside, floored] = esRows(IN_DOMAIN)
    expect(inside?.modified).toBe('2.13%')
    expect(inside?.value).toBe('2.13%')
    expect(inside?.greyed).toBe(false)
    expect(inside?.used).toBe(R.es.usedModified)
    expect(floored?.used).toBe(R.es.usedFloored)
  })

  it('an ES below zero is inverse risk: not defined, greyed, the historical CVaR shown', () => {
    const [row] = esRows(INVERSE)
    expect(row?.modified).toBe(R.es.notDefined)
    expect(row?.greyed).toBe(true)
    expect(row?.used).toBe(R.es.usedInverse)
    expect(row?.raw).toBe('-0.40%')
  })

  it('states the population moments', () => {
    expect(esMoments(HYP_RISK_EXTRAS)).toBe('Population moments: mean -0.2052%, sigma 0.8645%, skew -0.39, excess kurtosis -0.41.')
  })
})

describe('BR5 tile', () => {
  it('shows the ratio with its CAGR, beta and benchmark in the description', () => {
    const tile = treynorTile(HYP_RISK_EXTRAS)
    expect(tile.kpi.value).toBe(-0.41474465927320225)
    expect(tile.kpi.unit).toBe('ratio')
    expect(tile.description).toContain('-41.66%')
    expect(tile.description).toContain('1.00')
    expect(tile.description).toContain('same-exposure buy and hold (r_bh_1)')
    expect(tile.description).toContain('39 paired sessions')
    expect(treynorLine(HYP_RISK_EXTRAS)).toContain('Nautilus compounds instead')
  })

  it('without a benchmark the tile is empty and the line says why', () => {
    const tile = treynorTile(RUN_RISK_EXTRAS)
    expect(tile.kpi.value).toBeNull()
    expect(treynorLine(RUN_RISK_EXTRAS)).toBe('No Treynor ratio: no benchmark for this series')
  })
})
