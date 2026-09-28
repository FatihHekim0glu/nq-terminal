// @vitest-environment jsdom
// D24 regression: the Profile card's contract specs (tick value, point value, cost per side) must
// print at the precision the value needs (max 2, decimalsFor), not toFixed(2), so ZN's tick value
// (15.625 USD) and cost per side (18.125 USD) do not round to 15.63 and 18.13, contradicting the Tick
// row (0.015625) shown right above them.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { ContractCard } from './InstrumentDes'

function detail(contract: Schemas['InstrumentDes']['contract']): Schemas['InstrumentDes'] {
  return {
    root: contract!.root, symbol: contract!.symbol, in_universe: true, label: 'instrument description; no price is read',
    contract,
    month_codes: [], cycle_source: null, hours: [], hours_note: '',
    related: { last_trading_rule: null, first_notice_rule: null, roll_rule: null, next_contract: null, next_roll: null, as_of_et: null, source: 'nq_lab' },
    coverage: { fence: { is_start: '2010-01-01', is_end: '2022-01-01' }, in_sample_from: null, in_sample_to: '', series: [], gate_reads_logged: 0, gate_reads_this_process: 0 },
    notes: [],
  }
}

afterEach(cleanup)

describe('InstrumentDes ContractCard USD precision (D24)', () => {
  it('prints ZN tick value and cost per side exactly, not rounded to cents', () => {
    const zn: Schemas['InstrumentDes']['contract'] = {
      root: 'ZN', symbol: 'ZN.V.0', sector: 'rates', venue: 'CME', units: 'points of par, decimal',
      tick: 0.015625, tick_usd: 15.625, point_value_usd: 1000, cost_per_side_1tick_usd: 18.125, source: 'nq_lab.dtsmom_universe.TABLE',
    }
    render(<ContractCard d={detail(zn)} name="TY1 Comdty" />)
    expect(screen.getByText('0.015625')).toBeTruthy()
    expect(screen.getByText('15.625 USD')).toBeTruthy()
    expect(screen.getByText('18.125 USD')).toBeTruthy()
    expect(screen.queryByText('15.63 USD')).toBeNull()
    expect(screen.queryByText('18.13 USD')).toBeNull()
  })

  it('still prints a whole-number USD spec to at least 2 decimals', () => {
    const nq: Schemas['InstrumentDes']['contract'] = {
      root: 'NQ', symbol: 'NQ.V.0', sector: 'equity', venue: 'CME', units: 'index points',
      tick: 0.25, tick_usd: 5, point_value_usd: 20, cost_per_side_1tick_usd: 7.5, source: 'nq_lab.dtsmom_universe.TABLE',
    }
    render(<ContractCard d={detail(nq)} name="NQ1 Index" />)
    expect(screen.getByText('5.00 USD')).toBeTruthy()
    expect(screen.getByText('20.00 USD')).toBeTruthy()
    expect(screen.getByText('7.50 USD')).toBeTruthy()
  })
})
