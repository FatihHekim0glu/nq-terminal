import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from '../../charts/theme'
import { describeEventPath, eventPathOption, eventPathTable } from './chartModel'
import { EVT } from '../../copy/evt'
import { makeCalendar, makeStudy } from './fixtures'
import {
  chartInput,
  endCells,
  eventOptions,
  formatPct,
  intradayAllowed,
  pathCsv,
  rootOf,
  statusText,
  symbolFor,
  unitsText,
  windowOptions,
} from './model'

describe('EVT model', () => {
  it('maps roots and symbols both ways', () => {
    expect(symbolFor('NQ')).toBe('NQ.V.0')
    expect(rootOf('ZN.V.0')).toBe('ZN')
  })

  it('formats fractions as signed percent, never -0.00, and -- for gaps', () => {
    expect(formatPct(0.01234)).toBe('+1.23%')
    expect(formatPct(-0.000001)).toBe('0.00%')
    expect(formatPct(null)).toBe('--')
    expect(formatPct(Number.NaN)).toBe('--')
  })

  it('offers each event type with its count, All last', () => {
    const options = eventOptions(makeCalendar())
    expect(options.map((o) => o.value)).toEqual(['CPI', 'PPI', 'NFP', 'FOMC', 'ALL'])
    expect(options[3]!.label).toBe('FOMC (89)')
    expect(options[4]!.label).toBe('All (475)')
  })

  it('opens intraday windows only where the API lists a repaired 1m series', () => {
    expect(intradayAllowed(makeCalendar(), 'NQ.V.0')).toBe(true)
    expect(intradayAllowed(makeCalendar(), 'ES.V.0')).toBe(false)
    expect(intradayAllowed(undefined, 'NQ.V.0')).toBe(false)
  })

  it('names window options by unit and keeps the API default among them', () => {
    expect(windowOptions('daily', 'before').map((o) => o.label)).toContain('5 sessions')
    expect(windowOptions('intraday', 'after').map((o) => o.value)).toContain('120')
  })

  it('builds the chart input in percent from the API values, gaps kept', () => {
    const study = makeStudy()
    const input = chartInput(study, null)
    expect(input.offsets).toEqual([-2, -1, 0, 1, 2])
    expect(input.mean).toEqual([-0.1, 0, 0.2, 0.3, 0.5])
    expect(input.lower[1]).toBe(0)
    expect(input.upper[4]).toBeCloseTo(0.9, 12)
    expect(input.selected).toBeNull()
    expect(input.n).toBe(2)
    const withRow = chartInput(study, study.events[0]!)
    expect(withRow.selected?.values).toEqual([-0.2, 0, 0.1, 0.2, 0.4])
    expect(withRow.selected?.label).toContain('2015-01-28')
  })

  it('states each row as used or void with its reason', () => {
    const study = makeStudy()
    expect(statusText(study.events[0]!)).toBe('Used')
    expect(statusText(study.events[2]!)).toBe('Void: stale close on 2016-06-14 (no bar dated that session)')
  })

  it('exports the mean path with its band as CSV', () => {
    const csv = pathCsv(makeStudy())
    const lines = csv.csv.split('\r\n')
    expect(lines[0]).toBe('offset,mean,se,lower,upper')
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe('2,0.005,0.002,0.001,0.009')
    expect(csv.rows).toBe(5)
  })

  it('describes the last offset without any test statistic', () => {
    const cells = endCells(makeStudy())
    expect(cells.map((c) => c.label)).toEqual(['Mean', 'Median', 'Std dev', 'Std error', 'Above 0', 'Events'])
    expect(cells[0]!.value).toBe('+0.50%')
    expect(cells[4]!.value).toBe('100%')
    expect(cells.map((c) => c.tone)).toEqual(['up', 'up', null, null, null, null])
    expect(unitsText({ ...makeStudy(), mode: 'daily' })).toBe(EVT.unitsDaily)
    expect(unitsText({ ...makeStudy(), mode: 'intraday' })).toBe(EVT.units)
    const text = JSON.stringify(cells).toLowerCase()
    expect(text).not.toMatch(/p-value|p value|t stat/)
  })
})

describe('EVT chart model', () => {
  it('summarises the mean path and its last band for the accessible name', () => {
    const input = chartInput(makeStudy(), null)
    const text = describeEventPath(input)
    expect(text).toContain('over 2 events')
    expect(text).toContain('+0.50% at offset 2')
    expect(text).toContain('band at the last offset +0.10% to +0.90%')
  })

  it('says so when no event window is complete', () => {
    const empty = { ...chartInput(makeStudy(), null), n: 0, mean: [null, null, null, null, null] }
    expect(describeEventPath(empty)).toContain('no complete event window')
  })

  it('gives a table view row per offset with the selected event column when one is shown', () => {
    const study = makeStudy()
    const plain = eventPathTable(chartInput(study, null))
    expect(plain.rows).toHaveLength(5)
    expect(plain.columns.map((c) => c.key)).toEqual(['offset', 'mean', 'lower', 'upper'])
    const picked = eventPathTable(chartInput(study, study.events[0]!))
    expect(picked.columns.map((c) => c.key)).toContain('selected')
    expect(picked.rows[4]!.selected).toBe('+0.40%')
  })

  it('draws the band stacked on its lower bound, the mean, the zero line and the event line', () => {
    const option = eventPathOption(chartInput(makeStudy(), makeStudy().events[0]!), DEFAULT_CHART_TOKENS)
    const ids = (option.series as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toEqual(['band-base', 'band', 'mean', 'selected', 'marks'])
  })
})
