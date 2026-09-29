// MT 86) Replication (roadmap R8): each sealed confirmation joined to its parent's registered in-sample p.
// Stored numbers only, tagged [SPENT]: no fit, no test statistic, no verdict of the terminal's own.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { describeGlyphScatter, offScaleLines } from '../../charts/echarts/glyphScatterModel'
import { REPLICATION } from '../../copy/replication'
import { MULTIPLE_TESTING, REGISTRY, CONFIRMATIONS } from './regFixtures'
import { buildReplication, replicationScatter, unmatchedLine, untestedLine } from './replicationModel'

const BASE = CONFIRMATIONS[0]!

function confirmation(over: Partial<Schemas['Confirmation']>): Schemas['Confirmation'] {
  return { ...BASE, ...over }
}

function familyWith(list: readonly Schemas['Confirmation'][]): Schemas['MultipleTesting'] {
  return { ...MULTIPLE_TESTING, confirmations: [...list] }
}

const FAMILY_NAMES = [...MULTIPLE_TESTING.rows].sort((a, b) => a.rank - b.rank).map((r) => r.name)

describe('buildReplication: the served pair, stored numbers only', () => {
  it('joins rebal_v1_confirm to rebal_v0 with the pinned p-values and FAIL badges', () => {
    const view = buildReplication(MULTIPLE_TESTING, REGISTRY)
    expect(view.alpha).toBe(0.05)
    expect(view.k).toBe(21)
    expect(view.points).toEqual([
      {
        confirmation: 'rebal_v1_confirm',
        parent: 'rebal_v0',
        inSampleP: 0.13004898713256266,
        sealedP: 0.3374637034513802,
        ownAlpha: 0.05,
        sealedBadge: 'FAIL',
        inSampleBadge: 'FAIL',
        overlay: false,
        window: 'spent window, opened 2026-09-26, descriptive only',
      },
    ])
    expect(view.ownAlphas).toEqual([0.05])
    expect(view.unmatched).toEqual([])
  })

  it('lists the other 20 family names as untested, in rank order', () => {
    const view = buildReplication(MULTIPLE_TESTING, REGISTRY)
    expect(view.untested).toHaveLength(20)
    expect(view.untested).toEqual(FAMILY_NAMES.filter((n) => n !== 'rebal_v0'))
    expect(view.untested[0]).toBe('vt_har_v0')
    expect(view.untested.at(-1)).toBe('mim_v0')
  })

  it('leaves every stored p exactly as served (nothing is computed from p)', () => {
    const view = buildReplication(familyWith([confirmation({ p: 0.5, alpha: 0.025 })]), REGISTRY)
    expect(view.points[0]!.sealedP).toBe(0.5)
    expect(view.points[0]!.inSampleP).toBe(MULTIPLE_TESTING.rows.find((r) => r.name === 'rebal_v0')!.p)
    expect(view.points[0]!.ownAlpha).toBe(0.025)
  })

  it('reads the in-sample badge as null while the registry is unread, and when the parent has no registry row', () => {
    expect(buildReplication(MULTIPLE_TESTING, undefined).points[0]!.inSampleBadge).toBeNull()
    const thin = { ...REGISTRY, rows: REGISTRY.rows.filter((r) => r.name !== 'rebal_v0') }
    expect(buildReplication(MULTIPLE_TESTING, thin).points[0]!.inSampleBadge).toBeNull()
  })

  it('takes the in-sample badge from the registry text: a PASS parent reads PASS, the unregistered check reads CHECK', () => {
    const view = buildReplication(
      familyWith([confirmation({ name: 'eomtsy_v1_confirm', parent: 'eomtsy_v0', p: 0.01, verdict: 'PASS' })]),
      REGISTRY,
    )
    expect(view.points[0]).toMatchObject({ parent: 'eomtsy_v0', inSampleBadge: 'PASS', sealedBadge: 'PASS' })
  })

  it('marks a confirmation of a risk overlay as an overlay', () => {
    const view = buildReplication(familyWith([confirmation({ name: 'vt_har_v1_confirm', parent: 'vt_har_v0' })]), REGISTRY)
    expect(view.points[0]!.overlay).toBe(true)
    expect(buildReplication(MULTIPLE_TESTING, REGISTRY).points[0]!.overlay).toBe(false)
  })

  it('keeps the served confirmation order, several tests of one parent included', () => {
    const view = buildReplication(
      familyWith([
        confirmation({ name: 'rebal_v1_confirm' }),
        confirmation({ name: 'rebal_v2_confirm', p: 0.02, alpha: 0.0025 }),
      ]),
      REGISTRY,
    )
    expect(view.points.map((p) => p.confirmation)).toEqual(['rebal_v1_confirm', 'rebal_v2_confirm'])
    expect(view.untested).toHaveLength(20)
    expect(view.ownAlphas).toEqual([0.0025, 0.05])
  })

  it('has no points and every name untested when there is no confirmation', () => {
    const view = buildReplication(familyWith([]), REGISTRY)
    expect(view.points).toEqual([])
    expect(view.untested).toEqual(FAMILY_NAMES)
    expect(view.ownAlphas).toEqual([])
  })

  it('ranks the untested names by rank even when the rows are served out of order', () => {
    const shuffled = { ...MULTIPLE_TESTING, confirmations: [], rows: [...MULTIPLE_TESTING.rows].reverse() }
    expect(buildReplication(shuffled, REGISTRY).untested).toEqual(FAMILY_NAMES)
  })
})

describe('buildReplication: confirmations that cannot be drawn', () => {
  const UNMATCHED = familyWith([
    confirmation({ name: 'orphan_confirm', parent: null }),
    confirmation({ name: 'ghost_confirm', parent: 'ghost_v0' }),
    confirmation({ name: 'unread_confirm', parent: 'tom_v0', p: null }),
    confirmation({ name: 'rebal_v1_confirm' }),
  ])

  it('gives each a reason: no parent, parent not in the family, no p', () => {
    const view = buildReplication(UNMATCHED, REGISTRY)
    expect(view.unmatched).toEqual([
      { confirmation: 'orphan_confirm', reason: 'noParent', parent: null },
      { confirmation: 'ghost_confirm', reason: 'notInFamily', parent: 'ghost_v0' },
      { confirmation: 'unread_confirm', reason: 'noP', parent: 'tom_v0' },
    ])
    expect(view.points.map((p) => p.confirmation)).toEqual(['rebal_v1_confirm'])
  })

  it('does not list a parent as untested when its confirmation exists but has no p', () => {
    const view = buildReplication(UNMATCHED, REGISTRY)
    expect(view.untested).not.toContain('tom_v0')
    expect(view.untested).not.toContain('rebal_v0')
    expect(view.untested).toHaveLength(19)
  })

  it('checks no parent first, then the family, then p', () => {
    const view = buildReplication(familyWith([confirmation({ name: 'x_confirm', parent: null, p: null })]), REGISTRY)
    expect(view.unmatched[0]!.reason).toBe('noParent')
    const ghost = buildReplication(familyWith([confirmation({ name: 'y_confirm', parent: 'ghost_v0', p: null })]), REGISTRY)
    expect(ghost.unmatched[0]!.reason).toBe('notInFamily')
  })

  it('writes one line for them, each with its reason', () => {
    const line = unmatchedLine(buildReplication(UNMATCHED, REGISTRY))
    expect(line).toBe(
      'Not drawn (3): orphan_confirm: no parent recorded; ghost_confirm: parent ghost_v0 is not in the family; unread_confirm: no p recorded.',
    )
  })

  it('writes no unmatched line when everything is drawn', () => {
    expect(unmatchedLine(buildReplication(MULTIPLE_TESTING, REGISTRY))).toBeNull()
  })
})

describe('untestedLine', () => {
  it('names the count and every untested hypothesis', () => {
    const line = untestedLine(buildReplication(MULTIPLE_TESTING, REGISTRY))
    expect(line.startsWith('Never tested in the sealed window (20): vt_har_v0, eomtsy_v0, overnight_v0')).toBe(true)
    expect(line.endsWith('carry_v0, mim_v0.')).toBe(true)
    expect(line).not.toContain('rebal_v0')
  })

  it('says every hypothesis has a confirmation when none is untested', () => {
    const all = familyWith(
      MULTIPLE_TESTING.rows.map((r) => confirmation({ name: `${r.name}_confirm`, parent: r.name })),
    )
    const view = buildReplication(all, REGISTRY)
    expect(view.untested).toEqual([])
    expect(untestedLine(view)).toBe(REPLICATION.untestedNone)
  })
})

describe('replicationScatter: the GlyphScatter input', () => {
  const view = buildReplication(MULTIPLE_TESTING, REGISTRY)
  const input = replicationScatter(view)

  it('reverses log p axes with the registry on x and the sealed window on y, and draws y = x', () => {
    expect(input.x).toMatchObject({ label: REPLICATION.xAxis, scale: 'log', inverse: true, format: 'p' })
    expect(input.y).toMatchObject({ label: REPLICATION.yAxis, scale: 'log', inverse: true, format: 'p' })
    expect(input.diagonal).toBe(REPLICATION.diagonal)
  })

  it('draws the family alpha and alpha/k as x lines and the own alpha as a y line', () => {
    expect(input.lines).toEqual([
      { axis: 'x', value: 0.05, label: 'family alpha 0.05', tone: 'data' },
      { axis: 'x', value: 0.05 / 21, label: 'alpha/k 0.0024', tone: 'accent' },
      { axis: 'y', value: 0.05, label: 'own alpha 0.05', tone: 'data' },
    ])
  })

  it('sets one shared axis floor a decade under the lowest point or line, so no line is off the axes', () => {
    expect(input.x.min).toBe(0.001)
    expect(input.y.min).toBe(0.001)
    expect(offScaleLines(input)).toEqual([])
  })

  it('lowers the floor for a p below every line, so no point is pinned to the edge', () => {
    const low = replicationScatter(buildReplication(familyWith([confirmation({ p: 0.00002 })]), REGISTRY))
    expect(low.y.min).toBe(0.00001)
    expect(low.x.min).toBe(0.00001)
  })

  it('draws one down triangle for the FAIL pair, labelled by its parent, with the sealed verdict as its kind', () => {
    expect(input.points).toEqual([
      {
        label: 'rebal_v0 tested by rebal_v1_confirm',
        tag: 'rebal_v0',
        x: 0.13004898713256266,
        y: 0.3374637034513802,
        glyph: 'down',
        hollow: false,
        kind: '[FAIL]',
      },
    ])
  })

  it('draws PASS as an up triangle and anything else as a ring', () => {
    const three = replicationScatter(
      buildReplication(
        familyWith([
          confirmation({ name: 'a_confirm', parent: 'eomtsy_v0', p: 0.01, verdict: 'PASS' }),
          confirmation({ name: 'b_confirm', parent: 'tom_v0', p: 0.2, verdict: 'FAIL' }),
          confirmation({ name: 'c_confirm', parent: 'za_v0', p: 0.4, verdict: 'not run' }),
        ]),
        REGISTRY,
      ),
    )
    expect(three.points.map((p) => [p.tag, p.glyph, p.kind])).toEqual([
      ['eomtsy_v0', 'up', '[PASS]'],
      ['tom_v0', 'down', '[FAIL]'],
      ['za_v0', 'ring', '[CHECK]'],
    ])
  })

  it('draws an overlay pair hollow', () => {
    const overlay = replicationScatter(buildReplication(familyWith([confirmation({ name: 'vt_confirm', parent: 'vt_har_v0' })]), REGISTRY))
    expect(overlay.points[0]!.hollow).toBe(true)
    expect(describeGlyphScatter(overlay)).toContain('1 hollow')
  })

  it('draws one line per distinct own alpha and none for a missing one', () => {
    const many = replicationScatter(
      buildReplication(
        familyWith([
          confirmation({ name: 'a_confirm', parent: 'tom_v0', alpha: 0.05 }),
          confirmation({ name: 'b_confirm', parent: 'za_v0', alpha: 0.05 }),
          confirmation({ name: 'c_confirm', parent: 'cskew_v0', alpha: 0.025 }),
          confirmation({ name: 'd_confirm', parent: 'mim_v0', alpha: null }),
        ]),
        REGISTRY,
      ),
    )
    const y = (many.lines ?? []).filter((l) => l.axis === 'y')
    expect(y.map((l) => l.value)).toEqual([0.025, 0.05])
    expect(y.map((l) => l.label)).toEqual(['own alpha 0.025', 'own alpha 0.05'])
  })

  it('drops alpha/k when it is the same line as the family alpha (k = 1)', () => {
    const single = replicationScatter({ ...buildReplication(MULTIPLE_TESTING, REGISTRY), k: 1 })
    expect((single.lines ?? []).filter((l) => l.axis === 'x').map((l) => l.label)).toEqual(['family alpha 0.05'])
  })

  it('draws no alpha/k line for an empty family (k = 0)', () => {
    const empty = replicationScatter({ ...buildReplication(MULTIPLE_TESTING, REGISTRY), k: 0 })
    expect((empty.lines ?? []).filter((l) => l.axis === 'x')).toHaveLength(1)
  })

  it('has a name and a summary that read the pair, and no points when nothing is drawn', () => {
    expect(describeGlyphScatter(input)).toContain('Replication: 1 point')
    expect(replicationScatter(buildReplication(familyWith([]), REGISTRY)).points).toEqual([])
  })

  it('draws a sealed p of exactly 0 nowhere on the log axes but keeps it in the table input', () => {
    const zero = replicationScatter(buildReplication(familyWith([confirmation({ p: 0 })]), REGISTRY))
    expect(zero.points).toHaveLength(1)
    expect(zero.points[0]!.y).toBe(0)
    expect(describeGlyphScatter(zero)).toContain('1 not drawn')
  })
})

describe('born failing: no fit, no statistic, no verdict of the terminal', () => {
  const FORBIDDEN = /fit|slope|intercept|regress|correl|r2|rsquared|tstat|zscore|statistic|pvalue|verdictOf|pass(ed)?$/i

  it('has no fit key anywhere in the view, the points or the scatter input', () => {
    const view = buildReplication(MULTIPLE_TESTING, REGISTRY)
    const input = replicationScatter(view)
    const keys = [
      ...Object.keys(view),
      ...view.points.flatMap((p) => Object.keys(p)),
      ...Object.keys(input),
      ...input.points.flatMap((p) => Object.keys(p)),
    ]
    expect(keys.filter((k) => FORBIDDEN.test(k))).toEqual([])
    expect(keys).not.toContain('fit')
    expect(keys).not.toContain('statistic')
  })

  it('draws no line but the diagonal, the alphas and the own alphas', () => {
    const input = replicationScatter(buildReplication(MULTIPLE_TESTING, REGISTRY))
    expect(new Set((input.lines ?? []).map((l) => l.label.replace(/[\d.]+$/, '').trim()))).toEqual(
      new Set(['family alpha', 'alpha/k', 'own alpha']),
    )
  })
})
