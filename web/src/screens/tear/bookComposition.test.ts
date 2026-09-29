import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { SECTOR_SEQUENCE } from '../mon/model'
import { ROOTS } from '../mon/testUniverse'
import {
  MAX_COMPOSITION_COLUMNS,
  compositionInput,
  compositionView,
  isoWeekKey,
  rootOfInstrument,
  sampleIndexes,
  sectorOfRoot,
  type CompositionInstrumentRow,
} from './bookComposition'
import { RUN_EXPOSURE } from './tear.fixtures'

type ExposureView = Schemas['ExposureView']

const INDEX = { instruments: ROOTS.map(([root, sector]) => ({ root, symbol: `${root}.V.0`, sector })) }

/** n weekday dates from `start`, ascending, as the API serves session dates. */
function sessions(start: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** A 27-instrument exposure with nulls and zeros, from a fixed seed; keys in reverse index order. */
function seeded(n: number): ExposureView {
  let s = 12345
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const dates = sessions('2010-01-04', n)
  const entries = ROOTS.map(([root]) => [
    `${root}.XCME`,
    dates.map((_, i) => (i % 97 === 0 ? null : rnd() < 0.2 ? 0 : Math.round(rnd() * 300) / 1000)),
  ] as const).reverse()
  return {
    basis: 'B',
    by_instrument: Object.fromEntries(entries),
    date: dates,
    gross: dates.map(() => Math.round(rnd() * 900) / 1000),
    label: 'Notional at the close over equity',
    mean_gross: 0.4,
    mean_net: 0.1,
    net: dates.map(() => Math.round((rnd() - 0.5) * 900) / 1000),
    positions_reconcile: true,
    price_basis: 'raw contract close',
    run_id: 'seeded_run',
    t: dates.map((_, i) => 1262563200 + i * 86400),
    unit: 'notional over equity',
  }
}

const same = (a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

describe('isoWeekKey', () => {
  it.each([
    ['2011-06-03', '2011-W22'],
    ['2020-12-28', '2020-W53'],
    ['2021-01-01', '2020-W53'],
    ['2021-01-03', '2020-W53'],
    ['2021-01-04', '2021-W01'],
    ['2018-12-31', '2019-W01'],
    ['2019-12-30', '2020-W01'],
    ['2016-01-01', '2015-W53'],
    ['2012-01-01', '2011-W52'],
    ['2024-12-30', '2025-W01'],
  ])('puts %s in %s across the year boundary', (date, key) => {
    expect(isoWeekKey(date)).toBe(key)
  })

  it('gives the same key from Monday to Sunday of one week', () => {
    const keys = new Set(['2021-03-01', '2021-03-02', '2021-03-03', '2021-03-04', '2021-03-05', '2021-03-06', '2021-03-07'].map(isoWeekKey))
    expect(keys.size).toBe(1)
  })

  it('returns a text it cannot read unchanged instead of throwing', () => {
    expect(isoWeekKey('not a date')).toBe('not a date')
    expect(isoWeekKey('2021-02-30')).toBe('2021-02-30')
    expect(isoWeekKey('')).toBe('')
  })
})

describe('sampleIndexes', () => {
  it('shows every session when they fit', () => {
    const dates = sessions('2011-06-03', 10)
    expect(sampleIndexes(dates, MAX_COMPOSITION_COLUMNS)).toEqual({ idx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], sampling: 'every' })
    const cap = sessions('2010-01-04', MAX_COMPOSITION_COLUMNS)
    expect(sampleIndexes(cap, MAX_COMPOSITION_COLUMNS).sampling).toBe('every')
    expect(sampleIndexes(cap, MAX_COMPOSITION_COLUMNS).idx).toHaveLength(MAX_COMPOSITION_COLUMNS)
  })

  it('takes the last session of each ISO week when the weeks fit, and always the last index', () => {
    const dates = sessions('2010-01-04', 800)
    const { idx, sampling } = sampleIndexes(dates, MAX_COMPOSITION_COLUMNS)
    expect(sampling).toBe('week')
    expect(idx.length).toBeLessThanOrEqual(MAX_COMPOSITION_COLUMNS)
    expect(idx.at(-1)).toBe(dates.length - 1)
    // selection only: ascending, each pick is the last session of its week
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1]!)).toBe(true)
    for (const i of idx) {
      const next = dates[i + 1]
      if (next !== undefined) expect(isoWeekKey(next)).not.toBe(isoWeekKey(dates[i]!))
    }
    expect(new Set(idx.map((i) => isoWeekKey(dates[i]!))).size).toBe(idx.length)
  })

  it('falls back to the last session of each month when the weeks do not fit', () => {
    const dates = sessions('2010-01-04', 2000)
    const { idx, sampling } = sampleIndexes(dates, MAX_COMPOSITION_COLUMNS)
    expect(sampling).toBe('month')
    expect(idx.length).toBeLessThanOrEqual(MAX_COMPOSITION_COLUMNS)
    expect(idx.at(-1)).toBe(dates.length - 1)
    expect(new Set(idx.map((i) => dates[i]!.slice(0, 7))).size).toBe(idx.length)
    for (const i of idx) {
      const next = dates[i + 1]
      if (next !== undefined) expect(next.slice(0, 7)).not.toBe(dates[i]!.slice(0, 7))
    }
  })

  it('keeps the last index when the last week or month is a single session', () => {
    const dates = [...sessions('2010-01-04', 400), '2017-08-16'].sort()
    const { idx } = sampleIndexes(dates, 100)
    expect(idx.at(-1)).toBe(dates.length - 1)
  })

  it('returns no index for no dates and treats a cap below one as one', () => {
    expect(sampleIndexes([], 260)).toEqual({ idx: [], sampling: 'every' })
    const { idx } = sampleIndexes(sessions('2010-01-04', 30), 0)
    expect(idx.at(-1)).toBe(29)
  })
})

describe('roots and sectors', () => {
  it('reads the root from an instrument key', () => {
    expect(rootOfInstrument('ES.XCME')).toBe('ES')
    expect(rootOfInstrument('MNQ.XCME')).toBe('MNQ')
    expect(rootOfInstrument('6E.XCME')).toBe('6E')
    expect(rootOfInstrument('NQ')).toBe('NQ')
    expect(rootOfInstrument('')).toBe('')
  })

  it('takes the sector from the index, a micro from its parent root, and anything else as other', () => {
    expect(sectorOfRoot('ES', INDEX)).toBe('equity')
    expect(sectorOfRoot('ZN', INDEX)).toBe('rates')
    expect(sectorOfRoot('MNQ', INDEX)).toBe('equity')
    expect(sectorOfRoot('MES', INDEX)).toBe('equity')
    expect(sectorOfRoot('XYZ', INDEX)).toBe('other')
    expect(sectorOfRoot('MXYZ', INDEX)).toBe('other')
    expect(sectorOfRoot('M', INDEX)).toBe('other')
    expect(sectorOfRoot('', INDEX)).toBe('other')
    expect(sectorOfRoot('ES', null)).toBe('other')
    expect(sectorOfRoot('ES', { instruments: [] })).toBe('other')
  })

  it('does not read an inherited property as a sector', () => {
    expect(sectorOfRoot('constructor', INDEX)).toBe('other')
    expect(sectorOfRoot('Mconstructor', INDEX)).toBe('other')
  })
})

describe('compositionView', () => {
  const exposure = RUN_EXPOSURE.exposure!

  it('shows the fixture run as one band and one row of ten columns, every value as served', () => {
    const view = compositionView(exposure, INDEX)!
    expect(view.sampling).toBe('every')
    expect(view.columns).toEqual(exposure.date)
    expect(view.columns).toHaveLength(10)
    expect(view.rows).toHaveLength(2)
    expect(view.rows[0]).toEqual({ kind: 'band', sector: 'equity', title: 'Equity' })
    const row = view.rows[1] as CompositionInstrumentRow
    expect(row).toMatchObject({ kind: 'instrument', key: 'MNQ.XCME', root: 'MNQ', sector: 'equity' })
    expect(row.values).toHaveLength(10)
    row.values.forEach((v, i) => expect(v).toBe(exposure.by_instrument['MNQ.XCME']![i]))
    view.gross.forEach((v, i) => expect(v).toBe(exposure.gross[i]))
    view.net.forEach((v, i) => expect(v).toBe(exposure.net[i]))
    expect(view.instruments).toBe(1)
    expect(view.sectors).toBe(1)
    expect(view.unit).toBe(exposure.unit)
    expect(view.label).toBe(exposure.label)
    expect(view.priceBasis).toBe(exposure.price_basis)
  })

  it('groups a seeded 27-instrument book by sector in the house sequence, each value equal to the served sample', () => {
    const e = seeded(800)
    const view = compositionView(e, INDEX)!
    const { idx } = sampleIndexes(e.date, MAX_COMPOSITION_COLUMNS)
    expect(view.sampling).toBe('week')
    expect(view.columns.length).toBeLessThanOrEqual(MAX_COMPOSITION_COLUMNS)
    expect(view.columns).toEqual(idx.map((i) => e.date[i]))
    expect(view.instruments).toBe(27)
    expect(view.sectors).toBe(7)
    const bands = view.rows.filter((r) => r.kind === 'band')
    expect(bands.map((b) => b.sector)).toEqual([...SECTOR_SEQUENCE])
    expect(view.rows).toHaveLength(27 + 7)
    // the index root sequence inside each sector, although the keys were served in reverse
    expect(view.rows.filter((r) => r.kind === 'instrument').map((r) => r.root)).toEqual(ROOTS.map(([root]) => root))
    // each row sits under its own band
    let band = ''
    for (const r of view.rows) {
      if (r.kind === 'band') band = r.sector
      else expect(r.sector).toBe(band)
    }
    for (const r of view.rows) {
      if (r.kind !== 'instrument') continue
      const served = e.by_instrument[r.key]!
      expect(r.values).toHaveLength(view.columns.length)
      expect(same(r.values, idx.map((i) => served[i] ?? null))).toBe(true)
    }
    expect(same(view.gross, idx.map((i) => e.gross[i] ?? null))).toBe(true)
    expect(same(view.net, idx.map((i) => e.net[i] ?? null))).toBe(true)
  })

  it('samples by month for a long history, still at most 260 columns and ending on the last session', () => {
    const e = seeded(2000)
    const view = compositionView(e, INDEX)!
    expect(view.sampling).toBe('month')
    expect(view.columns.length).toBeLessThanOrEqual(MAX_COMPOSITION_COLUMNS)
    expect(view.columns.at(-1)).toBe(e.date.at(-1))
  })

  it('honours a smaller column cap', () => {
    const view = compositionView(seeded(800), INDEX, 100)!
    expect(view.columns.length).toBeLessThanOrEqual(100)
    expect(view.sampling).toBe('month')
  })

  it('puts a micro next to its parent in the parent sector, unindexed roots last under other', () => {
    const e: ExposureView = {
      ...exposure,
      by_instrument: {
        'ZZZ.XCME': exposure.gross,
        'YM.XCME': exposure.gross,
        'MNQ.XCME': exposure.gross,
        'ES.XCME': exposure.gross,
        'NQ.XCME': exposure.gross,
        'AAA.XCME': exposure.gross,
      },
    }
    const view = compositionView(e, INDEX)!
    expect(view.rows.map((r) => (r.kind === 'band' ? `[${r.sector}]` : r.root))).toEqual(['[equity]', 'ES', 'NQ', 'MNQ', 'YM', '[other]', 'AAA', 'ZZZ'])
    const other = view.rows.find((r) => r.kind === 'band' && r.sector === 'other')
    expect(other).toEqual({ kind: 'band', sector: 'other', title: 'Not in the instrument index' })
  })

  it('places a sector the index names but the house sequence lacks after the known ones and before other', () => {
    const index = { instruments: [...INDEX.instruments, { root: 'BTC', symbol: 'BTC.V.0', sector: 'crypto' }] }
    const e: ExposureView = { ...exposure, by_instrument: { 'ZZZ.XCME': exposure.gross, 'BTC.XCME': exposure.gross, 'ES.XCME': exposure.gross } }
    const view = compositionView(e, index)!
    expect(view.rows.filter((r) => r.kind === 'band').map((r) => r.sector)).toEqual(['equity', 'crypto', 'other'])
    expect(view.rows.find((r) => r.kind === 'band' && r.sector === 'crypto')).toMatchObject({ title: 'crypto' })
  })

  it('never merges a micro into its parent', () => {
    const e: ExposureView = { ...exposure, by_instrument: { 'NQ.XCME': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'MNQ.XCME': [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } }
    const rows = compositionView(e, INDEX)!.rows.filter((r): r is CompositionInstrumentRow => r.kind === 'instrument')
    expect(rows.map((r) => r.values[0])).toEqual([1, 10])
  })

  it('reads a value the served array lacks as null and keeps a served zero', () => {
    const e: ExposureView = { ...exposure, by_instrument: { 'ES.XCME': [0, 0.5] } }
    const row = compositionView(e, INDEX)!.rows[1] as CompositionInstrumentRow
    expect(row.values).toEqual([0, 0.5, null, null, null, null, null, null, null, null])
    expect(Object.is(row.values[0], 0)).toBe(true)
  })

  it('has no view when the API sends no instrument or no session', () => {
    expect(compositionView({ ...exposure, by_instrument: {} }, INDEX)).toBeNull()
    expect(compositionView(null, INDEX)).toBeNull()
    expect(compositionView(undefined, INDEX)).toBeNull()
    expect(compositionView({ ...exposure, date: [], t: [], gross: [], net: [], by_instrument: { 'ES.XCME': [] } }, INDEX)).toBeNull()
  })

  it('works without an index: every row is under other', () => {
    const view = compositionView(exposure, null)!
    expect(view.rows.map((r) => r.sector)).toEqual(['other', 'other'])
  })
})

describe('compositionInput', () => {
  const view = compositionView(RUN_EXPOSURE.exposure!, INDEX)!

  it('names the heat and stack views from the run, carries the sampling sentence and the served numbers', () => {
    const heat = compositionInput(view, 'run_a', 'heat')
    const stack = compositionInput(view, 'run_a', 'stack')
    expect(heat.name).toBe('run_a gross exposure by instrument')
    expect(stack.name).toBe('run_a gross exposure by instrument, stacked and coloured by sector')
    expect(heat.note).toBe('Every session is shown.')
    expect(heat.unit).toBe('notional over equity')
    expect(heat.decimals).toBe(3)
    expect(heat.columns).toBe(view.columns)
    expect(heat.gross).toBe(view.gross)
    expect(heat.net).toBe(view.net)
    expect(heat.rows).toHaveLength(2)
    expect(heat.rows[0]).toEqual({ kind: 'band', label: 'Equity', tone: 'secEquity' })
    const row = heat.rows[1]!
    expect(row).toMatchObject({ kind: 'instrument', label: 'MNQ', sector: 'Equity', tone: 'secEquity' })
    expect(row.kind === 'instrument' && (row.values === (view.rows[1] as CompositionInstrumentRow).values)).toBe(true)
  })

  it('says which sampling was used', () => {
    expect(compositionInput(compositionView(seeded(800), INDEX)!, 'r', 'heat').note).toBe('Columns are the last session of each week: sampled, not averaged.')
    expect(compositionInput(compositionView(seeded(2000), INDEX)!, 'r', 'heat').note).toBe('Columns are the last session of each month: sampled, not averaged.')
  })

  it('uses the key as the label when two instruments share a root, and other for the unindexed tone', () => {
    const e: ExposureView = { ...RUN_EXPOSURE.exposure!, by_instrument: { 'ES.XCME': [1], 'ES.XCBT': [2], 'QQQ.XCME': [3] } }
    const input = compositionInput(compositionView(e, INDEX)!, 'r', 'heat')
    const rows = input.rows.filter((r) => r.kind === 'instrument')
    expect(rows.map((r) => r.label)).toEqual(['ES.XCBT', 'ES.XCME', 'QQQ'])
    expect(input.rows.find((r) => r.kind === 'band' && r.label === 'Not in the instrument index')).toMatchObject({ tone: 'chartVol' })
  })
})
