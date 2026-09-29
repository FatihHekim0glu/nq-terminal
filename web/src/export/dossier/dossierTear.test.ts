// tearDossier: the tear sheet as a dossier. Every value is text the screens' own formatters print; the tests
// pin the shape (meta sequence, KPI rows with unit, basis and tag, SV7 cells equal to sv7Table) and the
// honesty rules (no null in any cell, no request, the demo flag only in the demo).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DES_REPORT } from '../../copy/des'
import { DOSSIER } from '../../copy/dossier'
import { TEAR, TEAR_DD, TEAR_EQ, TEAR_SV7 } from '../../copy/tear'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { RUN_ANALYTICS } from '../../screens/tear/tear.fixtures'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import { formatKpi } from '../../tiles/KpiTile'
import { kpiTiles } from '../../screens/tear/tearKpis'
import { readSv7, sv7Table } from '../../screens/tear/tearSv7Model'
import { cell, noteOf, tearDossier } from './dossierTear'
import type { DossierContext, DossierInput, DossierSection, DossierTable } from './types'

const NOW = new Date('2026-09-28T18:02:11Z')
const CTX: DossierContext = { now: NOW, demo: false, fixture: false, asOfUtc: '2026-09-28T18:02:00Z' }

const HYP: Extract<DossierInput, { kind: 'tear' }> = {
  kind: 'tear',
  target: { kind: 'hypothesis', name: 'volmanaged_v0' },
  tab: 'EQ',
  analytics: HYP_ANALYTICS,
  card: VOLMANAGED.card,
}
const RUN: Extract<DossierInput, { kind: 'tear' }> = {
  kind: 'tear',
  target: { kind: 'run', name: 'nt_volmanaged_v0_fixture_m1' },
  tab: 'RET',
  analytics: RUN_ANALYTICS,
  card: null,
}

function table(sections: readonly DossierSection[], id: string): DossierTable {
  const found = sections.find((s) => s.id === id)
  if (found?.kind !== 'table') throw new Error(`no table ${id}`)
  return found
}

/** Every string a dossier holds, at any depth. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

afterEach(() => vi.restoreAllMocks())

describe('tearDossier: head and series', () => {
  it('titles the dossier after the hypothesis and describes it with the API label', () => {
    const d = tearDossier(HYP, CTX)
    expect(d.title).toBe('volmanaged_v0: tear sheet dossier')
    expect(d.subtitle).toBe(HYP_ANALYTICS.label)
  })

  it('states the series in a fixed sequence, then the registration when a card is given', () => {
    const d = tearDossier(HYP, CTX)
    expect(d.meta.map(([label]) => label)).toEqual([
      TEAR.basis, DOSSIER.fields.unit, TEAR.range, TEAR.sessions, DOSSIER.fields.periods, TEAR_EQ.benchmark, TEAR.hypothesis, DOSSIER.fields.source,
      DES_REPORT.verdict, DES_REPORT.sha, DES_REPORT.round,
    ])
    const meta = new Map(d.meta)
    expect(meta.get(TEAR.basis)).toBe('A: screen (arithmetic on a fixed K)')
    expect(meta.get(DOSSIER.fields.unit)).toBe('return on capital per session')
    expect(meta.get(TEAR.range)).toBe('2011-04-25 to 2011-06-17')
    expect(meta.get(TEAR.sessions)).toBe('39')
    expect(meta.get(DOSSIER.fields.periods)).toBe('252')
    expect(meta.get(TEAR_EQ.benchmark)).toBe('same-exposure buy and hold (r_bh_1)')
    expect(meta.get(TEAR.hypothesis)).toBe('volmanaged_v0, 1 tick per side')
    expect(meta.get(DOSSIER.fields.source)).toBe('volmanaged_v0_daily.csv')
  })

  it('reads the verdict badge, the full spec hash with its check words and the round from the card', () => {
    const meta = new Map(tearDossier(HYP, CTX).meta)
    expect(meta.get(DES_REPORT.verdict)).toBe('[FAIL]')
    expect(meta.get(DES_REPORT.sha)).toBe(`${VOLMANAGED.card.spec_sha256} (registry ok, re-hash ok)`)
    expect(meta.get(DES_REPORT.round)).toBe('3')
  })

  it('says a failed hash check in the DES words, never as ok', () => {
    const card = { ...VOLMANAGED.card, spec_sha_ok: false, spec_rehash_ok: false }
    const sha = new Map(tearDossier({ ...HYP, card }, CTX).meta).get(DES_REPORT.sha)
    expect(sha).toBe(`${VOLMANAGED.card.spec_sha256} (registry MISMATCH, re-hash failed)`)
  })

  it('has no registration rows for a run, and names the run with its frequency', () => {
    const d = tearDossier(RUN, CTX)
    expect(d.title).toBe('nt_volmanaged_v0_fixture_m1: tear sheet dossier')
    expect(d.meta.map(([label]) => label)).toEqual([
      TEAR.basis, DOSSIER.fields.unit, TEAR.range, TEAR.sessions, DOSSIER.fields.periods, TEAR_EQ.benchmark, TEAR.run, DOSSIER.fields.source,
    ])
    const meta = new Map(d.meta)
    expect(meta.get(TEAR.run)).toBe('nt_volmanaged_v0_fixture_m1, Daily')
    expect(meta.get(TEAR_EQ.benchmark)).toBe(TEAR.noBenchmark)
    expect(meta.get(TEAR.basis)).toBe('B: account (compounded from K)')
  })

  it('says monthly for a run asked at M, and a missing cost as --', () => {
    const monthly = { ...RUN_ANALYTICS, context: { ...RUN_ANALYTICS.context, freq: 'M' as const } }
    expect(new Map(tearDossier({ ...RUN, analytics: monthly }, CTX).meta).get(TEAR.run)).toBe('nt_volmanaged_v0_fixture_m1, Monthly')
    const noCost = { ...HYP_ANALYTICS, context: { ...HYP_ANALYTICS.context, cost: null } }
    expect(new Map(tearDossier({ ...HYP, analytics: noCost }, CTX).meta).get(TEAR.hypothesis)).toBe('volmanaged_v0, --')
  })
})

describe('tearDossier: flags', () => {
  it('flags the series tags, and DEMO DATA or FIXTURE DATA only when the context says so', () => {
    expect(tearDossier(HYP, CTX).flags).toEqual(['[POST HOC]', '[PRE-REG]'])
    expect(tearDossier(HYP, { ...CTX, demo: true }).flags).toEqual(['[POST HOC]', '[PRE-REG]', 'DEMO DATA'])
    expect(tearDossier(HYP, { ...CTX, fixture: true }).flags).toEqual(['[POST HOC]', '[PRE-REG]', 'FIXTURE DATA'])
  })

  it('prints the one demo term in the demo, even when the health answer also says fixture', () => {
    expect(tearDossier(HYP, { ...CTX, demo: true, fixture: true }).flags).toEqual(['[POST HOC]', '[PRE-REG]', 'DEMO DATA'])
  })
})

describe('tearDossier: story', () => {
  it('opens with the key figures and the Sharpe interval', () => {
    const d = tearDossier(HYP, CTX)
    expect(d.story.map((s) => s.id)).toEqual(['kpis', 'interval'])
    expect(d.story.map((s) => s.title)).toEqual([DOSSIER.sections.kpis, DOSSIER.sections.interval])
  })

  it('gives every KPI a measure, value, unit, basis and tag, in the API order', () => {
    const kpis = table(tearDossier(HYP, CTX).story, 'kpis')
    expect(kpis.columns).toEqual([DOSSIER.cols.measure, DOSSIER.cols.value, DOSSIER.cols.unit, DOSSIER.cols.basis, DOSSIER.cols.tag, DOSSIER.cols.note])
    expect(kpis.rows.map((r) => r[0])).toEqual(HYP_ANALYTICS.kpis.map((k) => k.label))
    expect(kpis.rows).toHaveLength(13)
    for (const row of kpis.rows) {
      expect(row).toHaveLength(6)
      expect(row[2]).not.toBe('')
      expect(row[3]).toMatch(/^[AB]$/)
      expect(row[4]).toMatch(/^\[(PRE-REG|POST HOC)\]$/)
    }
  })

  it('prints each value as its tile face does, with the API unit beside it', () => {
    const kpis = table(tearDossier(HYP, CTX).story, 'kpis')
    const tiles = kpiTiles(HYP_ANALYTICS)
    tiles.forEach((tile, i) => {
      expect(kpis.rows[i]?.[1]).toBe(formatKpi(tile.kpi.value, tile.kpi.unit, tile.decimals, tile.signed))
      expect(kpis.rows[i]?.[2]).toBe(HYP_ANALYTICS.kpis[i]?.unit)
    })
    const by = (key: string) => kpis.rows[HYP_ANALYTICS.kpis.findIndex((k) => k.key === key)] ?? []
    expect(by('total_return')[1]).toBe('-8.00%')
    expect(by('total_return')[2]).toBe('fraction of K')
    expect(by('sharpe')[1]).toBe('-3.72')
    expect(by('alpha_annual')[1]).toBe('+3.47%')
    expect(by('alpha_annual')[4]).toBe('[PRE-REG]')
    expect(by('psr_0')[1]).toBe('0.067')
  })

  it('shows a missing value as -- with the reason the API gives, and says a percentage is times 100', () => {
    const kpis = table(tearDossier(HYP, CTX).story, 'kpis')
    const trl = kpis.rows[HYP_ANALYTICS.kpis.findIndex((k) => k.key === 'min_trl')] ?? []
    expect(trl[1]).toBe('--')
    expect(trl[5]).toBe('not reachable: the Sharpe is at or below 0')
    const total = kpis.rows[0] ?? []
    expect(total[5]).toBe(TEAR.kpiPercent)
    const sharpe = kpis.rows[HYP_ANALYTICS.kpis.findIndex((k) => k.key === 'sharpe')] ?? []
    expect(sharpe[5]).toBe('')
  })

  it('gives the Sharpe interval with its z, basis, unit and tag in the note', () => {
    const interval = table(tearDossier(HYP, CTX).story, 'interval')
    expect(interval.columns).toEqual([DOSSIER.cols.sharpe, DOSSIER.cols.low, DOSSIER.cols.high, DOSSIER.cols.z])
    expect(interval.rows).toEqual([['-3.72', '-8.59', '1.15', '1.96']])
    expect(interval.note).toContain('[POST HOC]')
    expect(interval.note).toContain('Basis A')
    expect(interval.note).toContain('ratio, annualised (P = 252)')
  })

  it('prints -- for an interval end the API does not send', () => {
    const open = { ...HYP_ANALYTICS, ci: { ...HYP_ANALYTICS.ci, lo: null, hi: null, sharpe: null } }
    const interval = table(tearDossier({ ...HYP, analytics: open }, CTX).story, 'interval')
    expect(interval.rows).toEqual([['--', '--', '--', '1.96']])
  })
})

describe('tearDossier: evidence', () => {
  it('lists SV7, the deepest drawdowns and the yearly returns', () => {
    expect(tearDossier(HYP, CTX).evidence.map((s) => s.id)).toEqual(['sv7', 'drawdowns', 'yearly'])
  })

  it('flattens sv7Table cell for cell, one column per cost', () => {
    const sv7 = table(tearDossier(HYP, CTX).evidence, 'sv7')
    const model = sv7Table(readSv7(HYP_ANALYTICS.validity.sharpe_difference_tests))
    expect(sv7.columns).toEqual([TEAR_SV7.measure, ...model.columns.map((c) => c.label)])
    const cells = model.sections.flatMap((s) => s.rows.map((r) => r.values))
    expect(sv7.rows.map((r) => r.slice(1))).toEqual(cells)
    const labels = model.sections.flatMap((s) => s.rows.map((r) => (s.title === null ? r.label : `${s.title}: ${r.label}`)))
    expect(sv7.rows.map((r) => r[0])).toEqual(labels)
    expect(sv7.rows.length).toBeGreaterThan(5)
  })

  it('names the SV7 basis, the fixed [PRE-REG] tag and the one-sided p note', () => {
    const sv7 = table(tearDossier(HYP, CTX).evidence, 'sv7')
    expect(sv7.title).toBe(TEAR_SV7.title)
    expect(sv7.note).toContain(TEAR_SV7.tag)
    expect(sv7.note).toContain(TEAR_SV7.basis)
    expect(sv7.note).toContain(TEAR_SV7.pNote)
  })

  it('says SV7 is not recorded, as text, when the series has none (sv7Empty)', () => {
    const section = tearDossier(RUN, CTX).evidence.find((s) => s.id === 'sv7')
    expect(section).toEqual({ kind: 'text', id: 'sv7', title: TEAR_SV7.title, lines: [TEAR_SV7.notRecorded], verbatim: false })
  })

  it('notes the SV7 entries that were left out, when some were', () => {
    const tests = { ...HYP_ANALYTICS.validity.sharpe_difference_tests, gross: { label: 'Sharpe difference (m - BH)', ledoit_wolf: 'not a test' } }
    const analytics = { ...HYP_ANALYTICS, validity: { ...HYP_ANALYTICS.validity, sharpe_difference_tests: tests } }
    const sv7 = table(tearDossier({ ...HYP, analytics }, CTX).evidence, 'sv7')
    expect(sv7.note).toContain(TEAR_SV7.droppedOne)
  })

  it('tabulates each drawdown with peak, trough, recovery or --, depth in the drawdown unit, length and open', () => {
    const dd = table(tearDossier(HYP, CTX).evidence, 'drawdowns')
    expect(dd.title).toBe(DOSSIER.sections.drawdowns)
    expect(dd.columns).toEqual([DOSSIER.cols.peak, DOSSIER.cols.trough, DOSSIER.cols.recovery, DOSSIER.cols.depth, DOSSIER.cols.length, DOSSIER.cols.open])
    expect(dd.rows).toEqual([['2011-04-27', '2011-06-17', '--', '-9.49%', '36', 'yes']])
    expect(dd.note).toContain('[POST HOC]')
    expect(dd.note).toContain('fraction of K below the running peak')
    expect(dd.note).toContain(TEAR_DD.lengthUnit.replace('{unit}', 'sessions'))
  })

  it('prints a recovered drawdown with its recovery date and open as no', () => {
    const row = { ...HYP_ANALYTICS.drawdown_table[0]!, recovery: '2011-07-05', trough_to_recovery: 12, open: false, peak: null }
    const analytics = { ...HYP_ANALYTICS, drawdown_table: [row] }
    const dd = table(tearDossier({ ...HYP, analytics }, CTX).evidence, 'drawdowns')
    expect(dd.rows).toEqual([[TEAR_DD.start, '2011-06-17', '2011-07-05', '-9.49%', '36', 'no']])
  })

  it('says there are no drawdown episodes as text when the table is empty', () => {
    const analytics = { ...HYP_ANALYTICS, drawdown_table: [] }
    const section = tearDossier({ ...HYP, analytics }, CTX).evidence.find((s) => s.id === 'drawdowns')
    expect(section).toEqual({ kind: 'text', id: 'drawdowns', title: DOSSIER.sections.drawdowns, lines: [TEAR_DD.tableEmpty], verbatim: false })
  })

  it('tabulates the returns by year in percent, with the unit in the title', () => {
    const yearly = table(tearDossier(HYP, CTX).evidence, 'yearly')
    expect(yearly.title).toBe('Returns by year (%)')
    expect(yearly.columns).toEqual([DOSSIER.cols.year, DOSSIER.cols.value])
    expect(yearly.rows).toEqual([['2011', '-8.00%']])
    expect(yearly.note).toContain('[POST HOC]')
    expect(yearly.note).toContain('Basis A')
    expect(yearly.note).toContain('fraction of K')
  })
})

describe('tearDossier: sources and footer', () => {
  it('names the analytics GET and, with a card, the hypothesis GET', () => {
    expect(tearDossier(HYP, CTX).sources).toEqual([
      'GET /api/analytics/hypothesis/volmanaged_v0?cost=1',
      'GET /api/hypotheses/volmanaged_v0',
    ])
  })

  it('names only the analytics GET for a run, at its frequency', () => {
    expect(tearDossier(RUN, CTX).sources).toEqual(['GET /api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D'])
  })

  it('closes with the descriptive line, the time, the fence and the demo note in the demo only', () => {
    const live = tearDossier(HYP, CTX).footer
    expect(live[0]).toBe(DOSSIER.descriptive)
    expect(live).toContain('IS | 2022+ SPENT')
    expect(live).not.toContain(DOSSIER.demoNote)
    expect(tearDossier(HYP, { ...CTX, demo: true }).footer).toContain(DOSSIER.demoNote)
  })
})

describe('tearDossier: edge cases', () => {
  it('prints -- for every non-finite or absent number, in KPIs, the interval, drawdowns and yearly returns', () => {
    const bad = Number.NaN
    const analytics = {
      ...HYP_ANALYTICS,
      kpis: HYP_ANALYTICS.kpis.map((k, i) => (i < 3 ? { ...k, value: i === 0 ? bad : null } : k)),
      ci: { ...HYP_ANALYTICS.ci, sharpe: Number.POSITIVE_INFINITY, lo: bad, hi: null },
      drawdown_table: [{ ...HYP_ANALYTICS.drawdown_table[0]!, depth: bad, length: Number.POSITIVE_INFINITY }],
      monthly: { ...HYP_ANALYTICS.monthly, yearly: [{ year: 2011, value: null }] },
    }
    const d = tearDossier({ ...HYP, analytics }, CTX)
    const kpis = table(d.story, 'kpis')
    expect(kpis.rows.slice(0, 3).map((r) => r[1])).toEqual(['--', '--', '--'])
    expect(table(d.story, 'interval').rows).toEqual([['--', '--', '--', '1.96']])
    expect(table(d.evidence, 'drawdowns').rows).toEqual([['2011-04-27', '2011-06-17', '--', '--', '--', 'yes']])
    expect(table(d.evidence, 'yearly').rows).toEqual([['2011', '--']])
    for (const text of strings(d)) expect(text).not.toMatch(/\b(null|undefined|NaN|Infinity)\b/)
  })

  it('passes markup characters and unicode through as text, and encodes them only in the GET path', () => {
    const name = 'x<b>&"é'
    const d = tearDossier({ ...HYP, target: { kind: 'hypothesis', name }, card: null }, CTX)
    expect(d.title).toBe(`${name}: tear sheet dossier`)
    expect(d.sources[0]).toBe(`GET /api/analytics/hypothesis/${encodeURIComponent(name)}?cost=1`)
    expect(d.sources[0]).not.toMatch(/[<>"]/)
  })

  it('keeps every row of a very long drawdown table, all as wide as the columns', () => {
    const row = HYP_ANALYTICS.drawdown_table[0]!
    const analytics = { ...HYP_ANALYTICS, drawdown_table: Array.from({ length: 10_000 }, (_, i) => ({ ...row, depth: -i / 100_000 })) }
    const dd = table(tearDossier({ ...HYP, analytics }, CTX).evidence, 'drawdowns')
    expect(dd.rows).toHaveLength(10_000)
    expect(dd.rows.every((r) => r.length === dd.columns.length)).toBe(true)
    expect(dd.rows[9_999]?.[3]).toBe('-10.00%')
  })

  it('names a plural cost in ticks per side, and a zero cost too', () => {
    const cost = (n: number) => new Map(tearDossier({ ...HYP, analytics: { ...HYP_ANALYTICS, context: { ...HYP_ANALYTICS.context, cost: n } } }, CTX).meta).get(TEAR.hypothesis)
    expect(cost(2)).toBe('volmanaged_v0, 2 ticks per side')
    expect(cost(0)).toBe('volmanaged_v0, 0 ticks per side')
  })

  it('joins a KPI note and the percentage note, and reads a blank unit as --', () => {
    const analytics = {
      ...HYP_ANALYTICS,
      kpis: [{ ...HYP_ANALYTICS.kpis[0]!, note: 'read from the file' }, { ...HYP_ANALYTICS.kpis[1]!, unit: '' }],
    }
    const kpis = table(tearDossier({ ...HYP, analytics }, CTX).story, 'kpis')
    expect(kpis.rows[0]?.[5]).toBe(`read from the file ${TEAR.kpiPercent}`)
    expect(kpis.rows[1]?.[2]).toBe('--')
  })

  it('titles the yearly table with the API unit when it has no short form', () => {
    const analytics = { ...HYP_ANALYTICS, monthly: { ...HYP_ANALYTICS.monthly, unit: 't statistic (gating)' } }
    expect(table(tearDossier({ ...HYP, analytics }, CTX).evidence, 'yearly').title).toBe('Returns by year (t statistic (gating))')
  })

  it('writes a note as the tag then one sentence per part, skipping blank parts and never doubling a full stop', () => {
    expect(noteOf('[POST HOC]', 'Basis A', '', '  ', 'Unit: percent.', 'Done!')).toBe('[POST HOC] Basis A. Unit: percent. Done!')
    expect(noteOf('[PRE-REG]')).toBe('[PRE-REG]')
    expect(cell('  ')).toBe('--')
    expect(cell('ratio')).toBe('ratio')
  })

  it('does not change with the tab that was open, since the dossier covers every tab', () => {
    expect(tearDossier({ ...HYP, tab: 'MRET' }, CTX)).toEqual(tearDossier({ ...HYP, tab: 'EQ' }, CTX))
  })

  it('has as many cells in every row as there are columns, in every table', () => {
    for (const input of [HYP, RUN]) {
      const d = tearDossier(input, CTX)
      for (const section of [...d.story, ...d.evidence]) {
        if (section.kind === 'table') for (const row of section.rows) expect(row).toHaveLength(section.columns.length)
      }
    }
  })
})

describe('tearDossier: honesty', () => {
  it('holds no null, undefined or NaN in any text, for a hypothesis or a run', () => {
    for (const input of [HYP, RUN]) {
      for (const text of strings(tearDossier(input, CTX))) {
        expect(text).not.toMatch(/\b(null|undefined|NaN)\b/)
      }
    }
  })

  it('makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    tearDossier(HYP, CTX)
    tearDossier(RUN, CTX)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not touch its input', () => {
    const freeze = <T,>(value: T): T => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
      }
      return value
    }
    const input = structuredClone(HYP)
    freeze(input)
    expect(() => tearDossier(input, CTX)).not.toThrow()
    expect(input).toEqual(HYP)
  })
})
