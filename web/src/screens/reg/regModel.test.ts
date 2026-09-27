// The REG model (TASKS 6.1, UI_SPEC 7 "REG and MT", look spec 7.2): registry rows joined to their
// hypothesis cards, the round rail, the screening criteria and the formats every cell uses. The data
// is the API's answer on the real research files (regFixtures.ts).
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import {
  buildRegRows,
  confirmationRows,
  criteria,
  filterRows,
  formatCount,
  formatPValue,
  hashStatus,
  roundGroups,
  shortSha,
  toCsv,
  verdictTone,
  type RegRow,
} from './regModel'

const rows = buildRegRows(REGISTRY, HYPOTHESES)
const byName = (name: string): RegRow => {
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}

describe('buildRegRows: one row per registry row, in file order', () => {
  it('keeps every registry row, registered and check rows alike', () => {
    expect(rows).toHaveLength(REGISTRY.counts.rows)
    expect(rows.map((r) => r.name)).toEqual(REGISTRY.rows.map((r) => r.name))
    expect(rows.filter((r) => r.registered)).toHaveLength(REGISTRY.counts.registered)
    expect(rows.filter((r) => r.badge === 'CHECK')).toHaveLength(REGISTRY.counts.checks)
  })

  it('takes the verdict badge, round, note and re-hash status from the card', () => {
    const overnight = byName('overnight_v0')
    expect(overnight.badge).toBe('PASS')
    expect(overnight.round).toBe(1)
    expect(overnight.rehashOk).toBe(true)
    const dtsmom = byName('dtsmom_v0')
    expect(dtsmom.badge).toBe('FAIL')
    expect(dtsmom.note).toBe('multi-asset universe: 27 CME futures, not NQ')
    expect(byName('carry_v0').round).toBeNull()
    expect(byName('za_v0_C3_gao_momentum').badge).toBe('CHECK')
  })

  it('carries the registry values unchanged', () => {
    const src = REGISTRY.rows.find((r) => r.name === 'overnight_v0')!
    const row = byName('overnight_v0')
    expect([row.n, row.p, row.controlP, row.bonferroni, row.holm, row.bhQ]).toEqual([
      src.n, src.p, src.control_p, src.bonferroni_p, src.holm_p, src.bh_q,
    ])
    expect(row.sha).toBe(src.spec_sha256)
    expect(row.shaOk).toBe(src.spec_sha_ok)
  })

  it('falls back to the registry verdict when a row has no card (born failing: never a silent PASS)', () => {
    const lonely: Schemas['RegistryView'] = {
      counts: { rows: 2, registered: 2, passed: 1, failed: 1, checks: 0 },
      rows: [
        { ...REGISTRY.rows[0]!, name: 'x_v0', verdict: 'PASS [note]' },
        { ...REGISTRY.rows[0]!, name: 'y_v0', verdict: 'FAIL' },
      ],
    }
    const out = buildRegRows(lonely, [])
    expect(out.map((r) => r.badge)).toEqual(['PASS', 'FAIL'])
    expect(out[0]!.note).toBe('note')
    expect(out[0]!.round).toBeNull()
    expect(out[0]!.rehashOk).toBeNull()
  })

  it('reads an unregistered row without a card as a check row', () => {
    const view: Schemas['RegistryView'] = {
      counts: { rows: 1, registered: 0, passed: 0, failed: 0, checks: 1 },
      rows: [{ ...REGISTRY.rows[1]! }],
    }
    expect(buildRegRows(view, [])[0]!.badge).toBe('CHECK')
  })
})

describe('roundGroups: the left rail', () => {
  it('counts every row once, rounds ascending, then rows without a round', () => {
    const groups = roundGroups(rows)
    expect(groups[0]).toMatchObject({ key: 'all', count: rows.length })
    const rest = groups.slice(1)
    expect(rest.reduce((s, g) => s + g.count, 0)).toBe(rows.length)
    expect(rest.map((g) => g.key)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'none'])
    expect(rest.find((g) => g.key === '1')?.count).toBe(4)
    expect(rest.find((g) => g.key === 'none')?.count).toBe(2)
  })
})

describe('criteria: the counts block', () => {
  it('shows the API counts as they are', () => {
    const c = criteria(REGISTRY.counts, rows, MULTIPLE_TESTING.alpha)
    const get = (id: string) => c.find((x) => x.id === id)?.count
    expect(get('rows')).toBe(19)
    expect(get('registered')).toBe(18)
    expect(get('passed')).toBe(2)
    expect(get('failed')).toBe(16)
    expect(get('checks')).toBe(1)
  })

  it('counts registered rows whose stored BH q is below alpha', () => {
    const c = criteria(REGISTRY.counts, rows, 0.05)
    expect(c.find((x) => x.id === 'bh')?.count).toBe(2)
    expect(criteria(REGISTRY.counts, rows, null).find((x) => x.id === 'bh')?.count).toBeNull()
  })
})

describe('filterRows', () => {
  it('narrows by text, round and criterion together', () => {
    expect(filterRows(rows, { text: 'fomc', round: 'all', criterion: null }).map((r) => r.name)).toEqual([
      'prefomc_v0', 'fomccycle_v0', 'fomctone_v0',
    ])
    expect(filterRows(rows, { text: '', round: '1', criterion: null })).toHaveLength(4)
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'passed' }).map((r) => r.name)).toEqual(['overnight_v0', 'eomtsy_v0'])
    expect(filterRows(rows, { text: '', round: 'none', criterion: 'passed' }).map((r) => r.name)).toEqual(['eomtsy_v0'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'checks' }).map((r) => r.name)).toEqual(['za_v0_C3_gao_momentum'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'bh', alpha: 0.05 })).toHaveLength(2)
    expect(filterRows(rows, { text: '  ', round: 'all', criterion: null })).toHaveLength(rows.length)
  })
})

describe('formats: each value equals the API value to the displayed precision', () => {
  it('prints p-values to four decimals and missing values as --', () => {
    expect(formatPValue(0.36124070734840386)).toBe('0.3612')
    expect(formatPValue(1)).toBe('1.0000')
    expect(formatPValue(0.0009684826201479617)).toBe('0.0010')
    expect(formatPValue(0.00004)).toBe('<0.0001')
    expect(formatPValue(null)).toBe('--')
    for (const r of rows) {
      if (r.p !== null && r.p >= 1e-4) expect(Math.abs(Number(formatPValue(r.p)) - r.p)).toBeLessThanOrEqual(5e-5)
    }
  })

  it('prints counts with thousands separators', () => {
    expect(formatCount(2778)).toBe('2,778')
    expect(formatCount(50)).toBe('50')
    expect(formatCount(null)).toBe('--')
  })

  it('shortens a sha to its first and last four characters', () => {
    expect(shortSha('b02fa22b15506ec7d8d0de3ae89346418ebacba9ba07d4b7c6c9e0623d30fd89')).toBe('b02f..fd89')
    expect(shortSha('')).toBe('--')
  })

  it('reads the hash status as text, never colour alone', () => {
    expect(hashStatus({ shaOk: true, rehashOk: true })).toEqual({ text: 'ok', ok: true })
    expect(hashStatus({ shaOk: true, rehashOk: null })).toEqual({ text: 'ok', ok: true })
    expect(hashStatus({ shaOk: false, rehashOk: true })).toEqual({ text: 'NO: registry', ok: false })
    expect(hashStatus({ shaOk: true, rehashOk: false })).toEqual({ text: 'NO: re-hash', ok: false })
    expect(hashStatus({ shaOk: false, rehashOk: false })).toEqual({ text: 'NO: both', ok: false })
  })

  it('maps verdicts to up, down and muted text', () => {
    expect(verdictTone('PASS')).toBe('up')
    expect(verdictTone('FAIL')).toBe('down')
    expect(verdictTone('CHECK')).toBe('muted')
  })
})

describe('confirmationRows: sealed confirmations, apart from the family', () => {
  it('keeps each confirmation with its own alpha and spent label', () => {
    const out = confirmationRows(CONFIRMATIONS)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: 'rebal_v1_confirm', parent: 'rebal_v0', alpha: 0.05, badge: 'FAIL', closed: true,
      label: 'spent window, opened 2026-09-26, descriptive only',
    })
  })
})

describe('toCsv: the export', () => {
  it('writes the API values at full precision with a header row', () => {
    const csv = toCsv(rows.slice(0, 1))
    const [head, first] = csv.split('\r\n')
    expect(head).toBe('name,registered,round,verdict,n,p,control_p,bonferroni_p,holm_p,bh_q,spec_sha256,spec_sha_ok,spec_rehash_ok')
    expect(first).toBe(`za_v0,true,0,FAIL,2778,${String(REGISTRY.rows[0]!.p)},,1,1,${String(REGISTRY.rows[0]!.bh_q)},${REGISTRY.rows[0]!.spec_sha256},true,true`)
  })

  it('quotes a field with a comma', () => {
    const odd = { ...rows[0]!, name: 'a,b' }
    expect(toCsv([odd]).split('\r\n')[1]!.startsWith('"a,b",')).toBe(true)
  })
})
