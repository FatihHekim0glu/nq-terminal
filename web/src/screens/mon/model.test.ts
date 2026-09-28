// MON model (TASKS 7.2, look spec 7.7, ANALYTICS MV4): the 27 rows by sector, every shown value the
// API value to the displayed precision with its unit, and the heat step rule.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW,
  SECTOR_SEQUENCE,
  WINDOW_OPTIONS,
  buildMonRows,
  formatCorr,
  formatHorizon,
  formatLast,
  formatVol,
  gateText,
  heatStep,
  priceDecimals,
  sectorTitle,
  tickerOf,
} from './model'
import { TICKS, makeUniverse } from './testUniverse'

describe('buildMonRows', () => {
  const universe = makeUniverse()

  it('keeps all 27 futures, grouped in the sector order', () => {
    const rows = buildMonRows(universe, 'returns')
    expect(rows).toHaveLength(27)
    const sectors = rows.map((r) => r.sector)
    const firstIndex = SECTOR_SEQUENCE.map((s) => sectors.indexOf(s))
    expect(firstIndex).toEqual([...firstIndex].sort((a, b) => a - b))
    expect(rows.slice(0, 3).map((r) => r.root)).toEqual(['ES', 'NQ', 'YM'])
    expect(rows.at(-1)?.root).toBe('HE')
  })

  it('shows returns in % to 2 decimals, equal to the API fraction', () => {
    const nq = buildMonRows(universe, 'returns').find((r) => r.root === 'NQ')!
    expect(nq.cells['1D']).toBe('+0.52%')
    expect(nq.cells['1W']).toBe('+6.50%')
    expect(nq.cells.YTD).toBe('+23.65%')
    expect(nq.values['1D']).toBeCloseTo(0.5196359399112005, 12)
    const es = buildMonRows(universe, 'returns').find((r) => r.root === 'ES')!
    expect(es.cells['1D']).toBe('-0.64%')
    expect(es.cells['3M']).toBe('-0.19%')
  })

  it('shows vol-normalised returns in sd to 2 decimals', () => {
    const nq = buildMonRows(universe, 'normalised').find((r) => r.root === 'NQ')!
    expect(nq.cells['1D']).toBe('+0.30')
    expect(nq.cells['1W']).toBe('+1.69')
    expect(nq.values['1W']).toBe(1.6890567380664319)
  })

  it('carries the last close, realised vol, correlation to NQ and units', () => {
    const rows = buildMonRows(universe, 'returns')
    const nq = rows.find((r) => r.root === 'NQ')!
    expect(nq.last).toBe('15959.00')
    expect(nq.rv).toBe('27.3%')
    expect(nq.corr).toBe('+1.00')
    expect(nq.units).toBe('index points')
    expect(nq.ticker).toBe('NQ1 Index')
    expect(nq.name).toBe('E-mini Nasdaq-100')
    const zt = rows.find((r) => r.root === 'ZT')!
    // ZT's tick is 1/256 (0.00390625): 109.23046875 is 109 + 7.375/32, an odd eighth of a 32nd, so the
    // 1/128 grid ('109-07+', 109.234375) is 1/256 point (about $7.81 a contract) away (D21).
    expect(zt.last).toBe('109-073')
    expect(zt.ticker).toBe('TU1 Comdty')
    expect(rows.find((r) => r.root === 'LE')!.corr).toBe('--')
  })

  it('flags every row served to the fence, and a stale last close apart', () => {
    const rows = buildMonRows(universe, 'returns')
    expect(rows.find((r) => r.root === 'NQ')!.flag).toBe('served')
    expect(rows.find((r) => r.root === 'HE')!.flag).toBe('stale')
  })

  it('shows -- for a missing horizon and never invents one', () => {
    const base = makeUniverse()
    const first = base.rows[0]!
    const u = { ...base, rows: [{ ...first, returns: { ...first.returns, '1D': null } }, ...base.rows.slice(1)] }
    const es = buildMonRows(u, 'returns').find((r) => r.root === 'ES')!
    expect(es.cells['1D']).toBe('--')
    expect(es.values['1D']).toBeNull()
    expect(es.heat['1D']).toBeNull()
  })

  it('orders an unknown sector after the known ones', () => {
    const base = makeUniverse()
    const odd = { ...base.rows[0]!, symbol: 'XX.V.0', root: 'XX', sector: 'softs' }
    const rows = buildMonRows({ ...base, rows: [odd, ...base.rows] }, 'returns')
    expect(rows.at(-1)?.root).toBe('XX')
    expect(sectorTitle('softs')).toBe('softs')
  })
})

describe('formatting', () => {
  it('formats horizons by view', () => {
    expect(formatHorizon(0.005196359399112005, 'returns')).toBe('+0.52%')
    expect(formatHorizon(-0.0000001, 'returns')).toBe('0.00%')
    expect(formatHorizon(null, 'returns')).toBe('--')
    expect(formatHorizon(-1.23456, 'normalised')).toBe('-1.23')
  })

  it('formats the last close at the served tick precision, Treasuries in 32nds', () => {
    expect(formatLast('YM', 36338, TICKS.YM![0])).toBe('36338')
    expect(formatLast('6J', 0.0086925, TICKS['6J']![0])).toBe('0.0086925')
    expect(formatLast('CL', 75.21, TICKS.CL![0])).toBe('75.21')
    expect(formatLast('ZN', 130.59375, TICKS.ZN![0])).toBe('130-19')
    expect(formatLast('GC', null, TICKS.GC![0])).toBe('--')
  })

  it('prints a ZT (1/256 tick) last close to the tick, never a quarter-32nd away (D21)', () => {
    // 109.23046875 = 109 + 7.375/32: on the 1/128 (quarter-32nd) grid this rounds to 109.234375, 1/256
    // point (about $7.81 a contract) away from the served value. The CME third digit (eighths of a
    // 32nd) carries the extra resolution: '109-073' parses back to 109 + 7/32 + 3/(8*32) = 109.23046875.
    const text = formatLast('ZT', 109.23046875, TICKS.ZT![0])
    expect(text).toBe('109-073')
    const m = /^(\d+)-(\d{2})(\d)$/.exec(text)!
    const [, whole, thirtySeconds, eighth] = m
    // The third digit is the CME table's printed digit, not a raw eighth index (D21): decode it back
    // through the same table QuoteHeader.format.ts's CME_EIGHTH_DIGIT uses.
    const eighthIndex = ['0', '1', '2', '3', '5', '6', '7', '8'].indexOf(eighth!)
    expect(Number(whole) + Number(thirtySeconds) / 32 + eighthIndex / (8 * 32)).toBeCloseTo(109.23046875, 9)
    // A ZT value on the coarser 1/128 grid still prints with the ordinary quarter marks.
    expect(formatLast('ZT', 109 + 6.5 / 32, TICKS.ZT![0])).toBe('109-06+')
  })

  it('takes the decimals from the tick the API serves, for every contract', () => {
    // The decimals each contract printed to before the API served its tick (the front-end copy it replaces).
    const before: Record<string, number> = {
      ES: 2, NQ: 2, YM: 0, ZT: 8, ZF: 7, ZN: 6, ZB: 5, '6E': 5, '6J': 7, '6B': 4, '6A': 5, '6C': 5, '6S': 4,
      CL: 2, NG: 3, HO: 4, RB: 4, GC: 1, SI: 3, HG: 4, ZC: 2, ZS: 2, ZW: 2, ZL: 2, ZM: 1, LE: 3, HE: 3,
    }
    expect(Object.keys(TICKS).sort()).toEqual(Object.keys(before).sort())
    for (const [root, [tick]] of Object.entries(TICKS)) expect([root, priceDecimals(tick)]).toEqual([root, before[root]])
  })

  it('against a backend without tick, prints the served value exactly (never rounded)', () => {
    expect(formatLast('NQ', 15959, undefined)).toBe('15959')
    expect(formatLast('6J', 0.0086925, undefined)).toBe('0.0086925')
    expect(formatLast('CL', 75.21, undefined)).toBe('75.21')
  })

  it('born failing: a tick the table never knew still prints to its own precision', () => {
    expect(priceDecimals(0.0000005)).toBe(7)
    expect(priceDecimals(0.00390625)).toBe(8)
    expect(priceDecimals(1)).toBe(0)
  })

  it('formats realised vol and correlation', () => {
    expect(formatVol(0.27304595530797793)).toBe('27.3%')
    expect(formatVol(null)).toBe('--')
    expect(formatCorr(-0.2139471006175712)).toBe('-0.21')
    expect(formatCorr(0.17036571349116403)).toBe('+0.17')
  })

  it('names instruments as generic tickers', () => {
    expect(tickerOf('6E')).toBe('EC1 Curncy')
    expect(tickerOf('CL')).toBe('CL1 Comdty')
  })

  it('describes the gate bookkeeping', () => {
    const { gate } = makeUniverse()
    expect(gateText(gate)).toBe('Gate: caller terminal, years 2010 to 2021 served, 27 reads this process, cached')
    expect(gateText({ ...gate, served_years: [], cached: false })).toBe('Gate: caller terminal, no year served')
  })

  it('offers the 252-session default window', () => {
    expect(WINDOW_OPTIONS).toContain(DEFAULT_WINDOW)
    expect(DEFAULT_WINDOW).toBe(252)
  })
})

describe('heatStep', () => {
  it('colours by the sign of the return, strong at 1 sd or more', () => {
    expect(heatStep(0.01, 1.2)).toBe('up2')
    expect(heatStep(0.01, 0.4)).toBe('up1')
    expect(heatStep(-0.01, -1)).toBe('dn2')
    expect(heatStep(-0.01, -0.99)).toBe('dn1')
    expect(heatStep(0.01, null)).toBe('up1')
  })

  it('leaves zero and missing values unfilled', () => {
    expect(heatStep(0, 2)).toBeNull()
    expect(heatStep(null, 2)).toBeNull()
  })
})
