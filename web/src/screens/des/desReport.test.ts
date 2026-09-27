// 98) Report on DES (look spec 7.3 `98)Report`; TASKS Phase 8 notes): the description as a Markdown
// file, built in the page from the response the screen already holds. Every value is the API's at the
// precision the screen shows; the spec's hypothesis and pass bar are verbatim; nothing is recomputed.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { DES_REPORT } from '../../copy/des'
import { desReport, instrumentReport, mdCell } from './desReport'
import { OVERNIGHT, VOLMANAGED } from './desTestData'

describe('desReport: the hypothesis description as Markdown', () => {
  it('opens with the name, the source and the honesty line', () => {
    const text = desReport(VOLMANAGED)
    const lines = text.split('\n')
    expect(lines[0]).toBe('# volmanaged_v0: hypothesis description')
    expect(text).toContain(DES_REPORT.source.replace('{name}', 'volmanaged_v0'))
  })

  it('states the registration: verdict, tag, round, spec hash with its checks, amendments', () => {
    const text = desReport(VOLMANAGED)
    expect(text).toContain('- Verdict: [FAIL]')
    expect(text).toContain(`- Tag: ${VOLMANAGED.card.tag}`)
    expect(text).toContain(`- Spec sha256: ${VOLMANAGED.card.spec_sha256} (registry ok, re-hash ok)`)
    expect(text).toContain('- Amendments: none')
  })

  it('lists the registered test values at the screen precision, in a table', () => {
    const text = desReport(VOLMANAGED)
    expect(text).toContain('| p | 0.1198 |')
    expect(text).toContain('| n | 2686 |')
  })

  it('carries the spec hypothesis and pass bar verbatim, and the cost ladder with its unit', () => {
    const text = desReport(OVERNIGHT)
    const bar = OVERNIGHT.spec as { pass_bar?: string }
    if (typeof bar.pass_bar === 'string') expect(text).toContain(bar.pass_bar)
    expect(text).toContain('## Cost ladder')
    for (const rung of OVERNIGHT.des.cost_ladder) expect(text).toContain(`| ${rung.ticks_per_side === 1 ? '1 tick' : `${rung.ticks_per_side} ticks`} |`)
  })

  it('escapes a pipe inside a table cell', () => {
    expect(mdCell('a | b')).toBe('a \\| b')
    expect(mdCell(null)).toBe('--')
  })
})

describe('instrumentReport: the instrument description as Markdown', () => {
  const nq: Schemas['InstrumentDes'] = {
    root: 'NQ', symbol: 'NQ.V.0', in_universe: true, label: 'instrument description; no price is read',
    contract: { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity', venue: 'CME', units: 'index points', tick: 0.25, tick_usd: 5, point_value_usd: 20, cost_per_side_1tick_usd: 7.5, source: 'nq_lab.dtsmom_universe.TABLE' },
    month_codes: [{ month: 3, name: 'Mar', code: 'H', active: true }, { month: 4, name: 'Apr', code: 'J', active: false }],
    cycle_source: 'nq_lab.mnq_roll.QUARTER_CODES', hours: [{ label: 'Bar times', value: 'bar open, UTC', source: 'catalog' }],
    hours_note: 'trading hours are not recorded in nq-lab',
    related: { last_trading_rule: 'third_friday', first_notice_rule: null, roll_rule: '8 business days before expiry', next_contract: 'MNQZ6', next_roll: '2026-12-08', as_of_et: '2026-09-27', source: 'nq_lab.mnq_roll' },
    coverage: { fence: { is_start: '2010-01-01', is_end: '2022-01-01' }, in_sample_from: '2010-09-28', in_sample_to: '2021-12-31', series: [], gate_reads_logged: 2, gate_reads_this_process: 1 },
    notes: [{ title: 'Fence', text: 'Prices end at 2021-12-31.', source: 'nq_lab.oos_gate' }],
  }

  it('states the contract, the month codes, related dates, coverage and notes, each with its source', () => {
    const text = instrumentReport(nq, 'NQ1 Index')
    expect(text.split('\n')[0]).toBe('# NQ1 Index: futures description')
    expect(text).toContain('| Tick | 0.25 |')
    expect(text).toContain('Mar H (listed)')
    expect(text).toContain('| Next roll | 2026-12-08 |')
    expect(text).toContain('- Fence: Prices end at 2021-12-31. (nq_lab.oos_gate)')
    expect(text).toContain('trading hours are not recorded in nq-lab')
  })
})
