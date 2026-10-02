// MT 87) Effective trials, the words and cells over the served `effective_n` (ANALYTICS_CATALOG SV3b): the view reads
// the backend's numbers and computes none (the C8 client-phase exception is closed; the estimators are pinned by
// backend/tests/test_p2_neff.py and by neffMirror.test.ts). The fixture is the served view for the seeded golden panel
// (effectiveN.fixtures.ts, not research data) and the captured real one (effectiveN.real.fixtures.ts).
import { describe, expect, it } from 'vitest'
import { describeHeatmap, heatmapCells } from '../../charts/echarts/heatmapModel'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { fillCopy } from '../../copy/workspace'
import { DEFLATED_REAL } from './deflatedFixtures'
import { SYNTHETIC_VIEW } from './effectiveN.fixtures'
import { EFFECTIVE_N_REAL } from './effectiveN.real.fixtures'
import {
  basisText,
  clustersText,
  dsrHeaders,
  dsrRows,
  effectiveNHeatmap,
  estimateRows,
  refusalText,
  servedOf,
  windowText,
} from './effectiveNModel'
import type { EffectiveNServed } from './effectiveNTypes'

const SERVED = SYNTHETIC_VIEW.effective_n

describe('servedOf', () => {
  it('returns the served effective_n of the SV3 view', () => {
    expect(servedOf(SYNTHETIC_VIEW)).toBe(SERVED)
  })

  it('returns null for a view the backend sent without it (an older answer), never a computed one', () => {
    const { effective_n: _dropped, ...older } = SYNTHETIC_VIEW
    expect(servedOf(older as unknown as typeof SYNTHETIC_VIEW)).toBeNull()
  })
})

describe('the words', () => {
  it('names the basis with the daily and the monthly count the backend served', () => {
    expect(basisText(SERVED)).toBe(
      'Basis A at 1 tick per side, per session (SV3a): the 9 daily trials in the matrix; the 2 monthly books counted as independent trials.',
    )
    expect(basisText(EFFECTIVE_N_REAL)).toContain('the 15 daily trials in the matrix; the 6 monthly books')
  })

  it('names the common window with the session count', () => {
    expect(windowText({ first: '2012-01-03', last: '2021-12-31', sessions: 2484 })).toBe(
      'Common window 2012-01-03 to 2021-12-31: 2,484 sessions that every daily trial records.',
    )
    expect(windowText(EFFECTIVE_N_REAL.window as NonNullable<EffectiveNServed['window']>)).toContain('2,484 sessions')
  })

  it('lists the clusters largest first, each as its trials by name, a trial alone being a cluster of one', () => {
    const text = clustersText(SERVED)
    expect(text.startsWith('Clusters at the cut: ')).toBe(true)
    expect(text.endsWith('.')).toBe(true)
    const groups = text.slice('Clusters at the cut: '.length, -1).split('; ')
    expect(groups).toHaveLength(SERVED.clusters.length)
    expect(groups.map((g) => g.split(', ').length)).toEqual(
      SERVED.sequence.length === 0 ? [] : [...SERVED.clusters].map((c) => c.length).sort((a, b) => b - a),
    )
    expect(groups.join(', ').split(', ').sort()).toEqual([...SERVED.daily].sort())
  })

  it('says each refusal in words with the numbers it names, and nothing about reading series', () => {
    expect(refusalText({ kind: 'no_daily', name: null, sessions: null })).toBe(EFFECTIVE_N.refused.noDaily)
    expect(refusalText({ kind: 'too_few', name: null, sessions: 251 })).toBe(
      'Not computed: only 251 sessions are common to every daily trial (at least 252 are needed).',
    )
    expect(refusalText({ kind: 'degenerate', name: 'za_v0', sessions: null })).toBe(
      'Not computed: za_v0 does not vary on the common window.',
    )
    expect(Object.keys(EFFECTIVE_N.refused).sort()).toEqual(['degenerate', 'noDaily', 'tooFew'])
  })

  it('says the numbers are served, not computed in the browser', () => {
    expect(EFFECTIVE_N.source).toContain('Served by the backend')
    expect(EFFECTIVE_N.source).toContain('qa/crosscheck/p12_neff.py')
    expect(JSON.stringify(EFFECTIVE_N)).not.toMatch(/computed in the browser/i)
    expect(JSON.stringify(EFFECTIVE_N)).not.toContain('not a served number')
  })
})

describe('estimateRows', () => {
  const rows = estimateRows(SERVED)

  it('gives four estimator rows in the copy wording, the registered row marked served', () => {
    expect(rows.map((r) => r.label)).toEqual([
      EFFECTIVE_N.estimates.registered,
      EFFECTIVE_N.estimates.participation,
      EFFECTIVE_N.estimates.liJi,
      fillCopy(EFFECTIVE_N.estimates.clusters, { cut: SERVED.cluster_cut }),
    ])
    expect(rows.map((r) => r.served)).toEqual([true, false, false, false])
    expect(rows.map((r) => r.id)).toEqual(['registered', 'participation', 'li_ji', 'clusters'])
  })

  it('prints whole trial counts bare and fractional ones to 2 decimals, SR0 to 4 and 2 decimals', () => {
    expect(rows[0]!.cells.slice(0, 2)).toEqual(['9', '11'])
    expect(rows[3]!.cells.slice(0, 2)).toEqual(['7', '9'])
    expect(rows[1]!.cells[0]).toBe('6.35')
    const registered = SERVED.estimates[0]!.sr0_session as number
    expect(rows[0]!.cells[2]).toBe(registered.toFixed(4))
    expect(rows[0]!.cells[3]).toBe((registered * Math.sqrt(252)).toFixed(2))
  })

  it('prints an integer count that floating point left a hair off (12.000000000000002) as a whole number', () => {
    const li = EFFECTIVE_N_REAL.estimates.find((e) => e.id === 'li_ji')!
    expect(li.n_daily).not.toBe(12)
    const printed = estimateRows(EFFECTIVE_N_REAL).find((r) => r.id === 'li_ji')!
    expect(printed.cells.slice(0, 2)).toEqual(['12', '18'])
  })

  it('prints a missing SR0 as the table prints a missing number, not as zero', () => {
    const missing: EffectiveNServed = {
      ...SERVED,
      estimates: SERVED.estimates.map((e, i) => (i === 1 ? { ...e, sr0_session: null, sr0_annual: null } : e)),
    }
    expect(estimateRows(missing)[1]!.cells.slice(2)).toEqual(['--', '--'])
  })
})

describe('dsrRows and dsrHeaders', () => {
  it('gives one DSR row per registered trial: name, P and four DSR cells with the floor as text', () => {
    const rows = dsrRows(SERVED)
    expect(rows).toHaveLength(11)
    expect(rows[0]!.name).toBe(SERVED.daily[0])
    expect(rows[0]!.periods).toBe('252')
    expect(rows[9]!.periods).toBe('12')
    expect(rows[0]!.cells).toHaveLength(4)
    for (const cell of rows.flatMap((r) => r.cells)) expect(cell).toMatch(/^(\d\.\d+|< 0\.000001|--)$/)
  })

  it('names the registered N in the served column heading', () => {
    expect(dsrHeaders(SYNTHETIC_VIEW).served).toBe('DSR V0, N 11 (served)')
    expect(dsrHeaders(DEFLATED_REAL).served).toBe('DSR V0, N 21 (served)')
    expect(dsrHeaders(SYNTHETIC_VIEW).liJi).toBe(EFFECTIVE_N.dsrCols.liJi)
  })

  it('shows the served DSR column as the SV3 table does, and a smaller N never lowers a DSR', () => {
    for (const d of SERVED.dsr) {
      if (d.served === null) continue
      for (const v of [d.participation, d.li_ji, d.clusters]) if (v !== null) expect(v).toBeGreaterThanOrEqual(d.served - 1e-12)
    }
  })
})

describe('effectiveNHeatmap', () => {
  const input = effectiveNHeatmap(SERVED)

  it('is a corr heatmap of 9 rows and 9 columns, rows numbered and named in the cluster sequence, columns numbered as the rows', () => {
    expect(input.kind).toBe('corr')
    expect(input.name).toBe(EFFECTIVE_N.heatmapName)
    expect(input.decimals).toBe(2)
    expect(input.columns).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(input.rows).toEqual(SERVED.sequence.map((k, i) => `${i + 1}) ${SERVED.daily[k]}`))
    expect(input.values).toHaveLength(9)
    for (const row of input.values) expect(row).toHaveLength(9)
  })

  it('leaves the diagonal null and holds the served correlation of the trials in the sequence elsewhere', () => {
    input.values.forEach((row, i) => {
      row.forEach((value, j) => {
        if (i === j) expect(value, `(${i}, ${j})`).toBeNull()
        else expect(value, `(${i}, ${j})`).toBe(SERVED.correlation[SERVED.sequence[i] as number]![SERVED.sequence[j] as number])
      })
    })
  })

  it('puts the members of a cluster in adjacent rows', () => {
    const position = new Map(SERVED.sequence.map((k, i) => [k, i] as const))
    for (const cluster of SERVED.clusters) {
      const at = cluster.map((k) => position.get(k) as number).sort((a, b) => a - b)
      expect(at[at.length - 1]! - at[0]!).toBe(cluster.length - 1)
    }
  })

  it('is accepted by the heatmap: blank diagonal cells, a summary that names the chart', () => {
    const cells = heatmapCells(input)
    expect(cells).toHaveLength(81)
    expect(cells.filter((c) => c.row === c.col).every((c) => c.value === null && c.label === '')).toBe(true)
    expect(describeHeatmap(input)).toContain(EFFECTIVE_N.heatmapName)
  })
})
