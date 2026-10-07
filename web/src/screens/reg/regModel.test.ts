// The REG model (TASKS 6.1, UI_SPEC 7 "REG and MT", look spec 7.2): registry rows joined to their
// hypothesis cards, the round rail, the screening criteria and the formats every cell uses. The data
// is the API's answer on the real research files (regFixtures.ts).
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import {
  acceptanceLine,
  acceptanceRows,
  amendmentText,
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
    expect(byName('carry_v0').round).toBe(10)
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
      counts: { rows: 2, registered: 2, passed: 1, failed: 1, checks: 0, edges: 2, overlays: 0, passed_edges: 1 },
      acceptances: REGISTRY.acceptances,
      generated_at: null, newest_input_at: null, newest_input_path: null, stale: false,
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
      counts: { rows: 1, registered: 0, passed: 0, failed: 0, checks: 1, edges: 0, overlays: 0, passed_edges: 0 },
      acceptances: REGISTRY.acceptances,
      generated_at: null, newest_input_at: null, newest_input_path: null, stale: false,
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
    expect(rest.map((g) => g.key)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'])
    expect(rest.find((g) => g.key === '1')?.count).toBe(4)
    const lonely = roundGroups([...rows, { ...rows[0]!, name: 'x_v0', round: null }])
    expect(lonely.at(-1)).toMatchObject({ key: 'none', count: 1 })
  })
})

describe('criteria: the counts block', () => {
  it('shows the API counts as they are', () => {
    const c = criteria(REGISTRY.counts, rows, MULTIPLE_TESTING.alpha)
    const get = (id: string) => c.find((x) => x.id === id)?.count
    expect(get('rows')).toBe(22)
    expect(get('registered')).toBe(21)
    expect(get('passed')).toBe(3)
    expect(get('failed')).toBe(18)
    expect(get('checks')).toBe(1)
    expect(get('edges')).toBe(20)
    expect(get('overlays')).toBe(1)
    expect(get('passedEdges')).toBe(2)
  })

  it('counts registered rows whose stored BH q is below alpha', () => {
    const c = criteria(REGISTRY.counts, rows, 0.05)
    expect(c.find((x) => x.id === 'bh')?.count).toBe(3)
    expect(criteria(REGISTRY.counts, rows, null).find((x) => x.id === 'bh')?.count).toBeNull()
  })
})

describe('filterRows', () => {
  it('narrows by text, round and criterion together', () => {
    expect(filterRows(rows, { text: 'fomc', round: 'all', criterion: null }).map((r) => r.name)).toEqual([
      'prefomc_v0', 'fomccycle_v0', 'fomctone_v0',
    ])
    expect(filterRows(rows, { text: '', round: '1', criterion: null })).toHaveLength(4)
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'passed' }).map((r) => r.name)).toEqual(['overnight_v0', 'eomtsy_v0', 'vt_har_v0'])
    expect(filterRows(rows, { text: '', round: '11', criterion: 'passed' }).map((r) => r.name)).toEqual(['eomtsy_v0'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'checks' }).map((r) => r.name)).toEqual(['za_v0_C3_gao_momentum'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'bh', alpha: 0.05 })).toHaveLength(3)
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'overlays' }).map((r) => r.name)).toEqual(['vt_har_v0'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'passedEdges' }).map((r) => r.name)).toEqual(['overnight_v0', 'eomtsy_v0'])
    expect(filterRows(rows, { text: '', round: 'all', criterion: 'edges' })).toHaveLength(20)
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
    expect(head).toBe('name,registered,tag,round,verdict,n,p,control_p,bonferroni_p,holm_p,bh_q,spec_sha256,spec_sha_ok,spec_rehash_ok,amendments,amendments_ok,dsr')
    expect(first).toBe(`za_v0,true,edge,0,FAIL,2778,${String(REGISTRY.rows[0]!.p)},,1,1,${String(REGISTRY.rows[0]!.bh_q)},${REGISTRY.rows[0]!.spec_sha256},true,true,0,true,`)
    const withDsr = toCsv([{ ...rows[0]!, dsr: 0.0160224 }]).split('\r\n')[1]!
    expect(withDsr.endsWith(',true,0.0160224')).toBe(true)
  })

  it('quotes a field with a comma', () => {
    const odd = { ...rows[0]!, name: 'a,b' }
    expect(toCsv([odd]).split('\r\n')[1]!.startsWith('"a,b",')).toBe(true)
  })

  it('guards a name that would run as a spreadsheet formula (91) Board 98) Export, pre-existing)', () => {
    const odd = { ...rows[0]!, name: '=HYPERLINK("x")' }
    const first = toCsv([odd]).split('\r\n')[1]!
    expect(first.startsWith('"\'=HYPERLINK(""x"")"')).toBe(true)
  })
})

describe('tags and amendments (registry rounds 13 and 14; Phase 8)', () => {
  it('carries each row\'s tag and amendments from the registry', () => {
    expect(byName('vt_har_v0')).toMatchObject({ tag: 'overlay', amendments: 2, amendmentFiles: ['vt_har_v0_amend1.json', 'vt_har_v0_amend2.json'], amendmentsOk: true })
    expect(byName('cskew_v0')).toMatchObject({ tag: 'edge', amendments: 1, amendmentsOk: true })
    expect(byName('za_v0_C3_gao_momentum').tag).toBe('check')
    expect(byName('overnight_v0')).toMatchObject({ tag: 'edge', amendments: 0 })
  })

  it('writes the amendments as a count with its binding check in words', () => {
    expect(amendmentText({ amendments: 0, amendmentsOk: true })).toBe('0')
    expect(amendmentText({ amendments: 2, amendmentsOk: true })).toBe('2 ok')
    expect(amendmentText({ amendments: 1, amendmentsOk: false })).toBe('1 NO')
    expect(amendmentText({ amendments: 1, amendmentsOk: null })).toBe('1')
  })

  it('lists the accepted amendments with their hashes then and now, and says whether all are unchanged', () => {
    const rows = acceptanceRows(REGISTRY.acceptances)
    expect(rows.map((r) => r.file)).toEqual([
      'experiments/cskew_v0_amend1.json', 'experiments/vt_har_v0_amend1.json', 'experiments/vt_har_v0_amend2.json',
      'experiments/repair_futures_v2_amendment_1.json',
    ])
    expect(rows[0]).toMatchObject({ spec: 'cskew_v0', rows: 'cskew_v0', accepted: '4d98..8eb9', now: '4d98..8eb9', unchanged: true })
    expect(rows[3]!.rows).toBe('--')
    expect(acceptanceLine(REGISTRY.acceptances)).toBe('Accepted 2026-09-27T03:20:09Z from results/amendment_acceptances.md: 4 amendments, all unchanged.')
  })

  it('born failing: a changed amendment file reads as CHANGED', () => {
    const [first, ...rest] = REGISTRY.acceptances.amendments
    const changed = { ...REGISTRY.acceptances, all_unchanged: false, amendments: [{ ...first!, sha256_now: 'ffff0000', unchanged: false }, ...rest] }
    expect(acceptanceRows(changed)[0]!.unchanged).toBe(false)
    expect(acceptanceLine(changed)).toBe('Accepted 2026-09-27T03:20:09Z from results/amendment_acceptances.md: 4 amendments, 1 CHANGED since acceptance.')
    expect(acceptanceLine({ ...REGISTRY.acceptances, found: false })).toBe('No amendment acceptances recorded: results/amendment_acceptances.md')
  })
})
