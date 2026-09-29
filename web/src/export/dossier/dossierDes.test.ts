// desDossier: the hypothesis description as a dossier. The spec's hypothesis and pass bar are quoted
// verbatim; the checks, cost ladder, blocks, runs and confirmations are the registry's and the screen
// JSON's own values through DES's formatters; the tear sheet joins only when the browser already holds it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DES, DES_REPORT } from '../../copy/des'
import { DOSSIER } from '../../copy/dossier'
import { TEAR_SV7 } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../../screens/des/desTestData'
import { breakEvenText, checkRows, hypothesisText, passBarText, registrationKpis, type HypothesisDetail } from '../../screens/des/desModel'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import { readSv7, sv7Table } from '../../screens/tear/tearSv7Model'
import { desDossier } from './dossierDes'
import type { DossierContext, DossierInput, DossierSection, DossierTable, DossierText } from './types'

const CTX: DossierContext = { now: new Date('2026-09-28T18:02:11Z'), demo: false, fixture: false, asOfUtc: null }

type DesInput = Extract<DossierInput, { kind: 'des' }>
const bare = (detail: HypothesisDetail): DesInput => ({ kind: 'des', detail, analytics: null })
const withTear = (detail: HypothesisDetail): DesInput => ({ kind: 'des', detail, analytics: HYP_ANALYTICS })

function section(sections: readonly DossierSection[], id: string): DossierSection {
  const found = sections.find((s) => s.id === id)
  if (!found) throw new Error(`no section ${id}`)
  return found
}
function table(sections: readonly DossierSection[], id: string): DossierTable {
  const found = section(sections, id)
  if (found.kind !== 'table') throw new Error(`${id} is not a table`)
  return found
}
function text(sections: readonly DossierSection[], id: string): DossierText {
  const found = section(sections, id)
  if (found.kind !== 'text') throw new Error(`${id} is not text`)
  return found
}
/** Every string the dossier makes. Text quoted verbatim from a research file is left out: it is the author's
 * prose (the REBAL hypothesis says "A null is the expected outcome"), not something the model printed. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') {
    if ((value as { verbatim?: unknown }).verbatim === true) return []
    return Object.values(value).flatMap(strings)
  }
  return []
}

afterEach(() => vi.restoreAllMocks())

describe('desDossier: head, flags and registration', () => {
  it('titles the dossier after the hypothesis', () => {
    const d = desDossier(bare(VOLMANAGED), CTX)
    expect(d.title).toBe('volmanaged_v0: hypothesis dossier')
    expect(d.subtitle).toBe(DOSSIER.desSubtitle)
  })

  it('flags the verdict badge and the registration tag; overlay, demo and fixture only when they apply', () => {
    expect(desDossier(bare(VOLMANAGED), CTX).flags).toEqual(['[FAIL]', '[PRE-REG]'])
    expect(desDossier(bare(OVERNIGHT), CTX).flags).toEqual(['[PASS]', '[PRE-REG]'])
    expect(desDossier(bare(ZA_C3), CTX).flags).toEqual(['[CHECK]', '[POST HOC]'])
    const overlay = { ...VOLMANAGED, card: { ...VOLMANAGED.card, tag: 'overlay' as const } }
    expect(desDossier(bare(overlay), CTX).flags).toEqual(['[FAIL]', '[PRE-REG]', '[OVERLAY]'])
    expect(desDossier(bare(overlay), { ...CTX, demo: true, fixture: true }).flags).toEqual(['[FAIL]', '[PRE-REG]', '[OVERLAY]', 'DEMO DATA'])
    expect(desDossier(bare(overlay), { ...CTX, fixture: true }).flags).toEqual(['[FAIL]', '[PRE-REG]', '[OVERLAY]', 'FIXTURE DATA'])
    expect(desDossier(bare(VOLMANAGED), { ...CTX, demo: true }).flags).toEqual(['[FAIL]', '[PRE-REG]', 'DEMO DATA'])
  })

  it('states the registration facts with the DES report labels', () => {
    const d = desDossier(bare(VOLMANAGED), CTX)
    expect(d.meta).toEqual([
      [DES_REPORT.registered, DES.registration.yes],
      [DES_REPORT.verdict, '[FAIL]'],
      [DES_REPORT.tag, 'edge'],
      [DES_REPORT.round, '3'],
      [DES_REPORT.spec, 'volmanaged_v0'],
      [DES_REPORT.sha, `${VOLMANAGED.card.spec_sha256} (registry ok, re-hash ok)`],
      [DES_REPORT.amendments, DES_REPORT.amendmentsNone],
      [DES_REPORT.screen, 'volmanaged_v0'],
    ])
  })

  it('says an unregistered check row, the verdict note, the amendments and their binding', () => {
    const meta = new Map(desDossier(bare(ZA_C3), CTX).meta)
    expect(meta.get(DES_REPORT.registered)).toBe(DES.registration.no)
    expect(meta.get(DES_REPORT.verdict)).toBe('[CHECK] (check inside za_v0 (no own pass bar))')
    const amended = { ...VOLMANAGED, card: { ...VOLMANAGED.card, amendment_files: ['a1.json', 'a2.json'], amendments_ok: true } }
    expect(new Map(desDossier(bare(amended), CTX).meta).get(DES_REPORT.amendments)).toBe(`a1.json, a2.json (${DES_REPORT.amendmentsOk})`)
    const unbound = { ...amended, card: { ...amended.card, amendments_ok: false } }
    expect(new Map(desDossier(bare(unbound), CTX).meta).get(DES_REPORT.amendments)).toBe(`a1.json, a2.json (${DES_REPORT.amendmentsBad})`)
    const unknown = { ...amended, card: { ...amended.card, amendments_ok: null } }
    expect(new Map(desDossier(bare(unknown), CTX).meta).get(DES_REPORT.amendments)).toBe(`a1.json, a2.json (${DES_REPORT.amendmentsUnknown})`)
  })

  it('prints -- for a round and a screen the card does not record', () => {
    const card = { ...VOLMANAGED.card, round: null, screen: null }
    const meta = new Map(desDossier(bare({ ...VOLMANAGED, card }), CTX).meta)
    expect(meta.get(DES_REPORT.round)).toBe('--')
    expect(meta.get(DES_REPORT.screen)).toBe('--')
  })
})

describe('desDossier: story', () => {
  it('quotes the hypothesis and the pass bar verbatim', () => {
    const d = desDossier(bare(VOLMANAGED), CTX)
    expect(d.story.map((s) => s.id)).toEqual(['hypothesis', 'passBar', 'tests'])
    const hypothesis = text(d.story, 'hypothesis')
    expect(hypothesis.title).toBe(DES.hypothesis)
    expect(hypothesis.verbatim).toBe(true)
    expect(hypothesis.lines.join('\n')).toBe(hypothesisText(VOLMANAGED.spec))
    expect(hypothesis.lines.join('\n')).toBe((VOLMANAGED.spec as { hypothesis: string }).hypothesis)
    const bar = text(d.story, 'passBar')
    expect(bar.title).toBe(DES.passBar)
    expect(bar.verbatim).toBe(true)
    expect(bar.lines.join('\n')).toBe((VOLMANAGED.spec as { pass_bar: string }).pass_bar)
  })

  it('keeps a multi-line pass bar line for line, and a JSON pass bar as indented JSON', () => {
    const multi = text(desDossier(bare(REBAL), CTX).story, 'passBar')
    expect(multi.lines.join('\n')).toBe((REBAL.spec as { pass_bar: string }).pass_bar)
    expect(multi.lines.length).toBeGreaterThan(3)
    const json = text(desDossier(bare(ZA_C3), CTX).story, 'passBar')
    expect(json.lines.join('\n')).toBe(passBarText(ZA_C3.spec))
    expect(JSON.parse(json.lines.join('\n'))).toEqual((ZA_C3.spec as { pass_bar: unknown }).pass_bar)
  })

  it('says so, unquoted, when the spec has no hypothesis or pass bar', () => {
    const d = desDossier(bare({ ...VOLMANAGED, spec: null }), CTX)
    expect(text(d.story, 'hypothesis')).toMatchObject({ lines: [DES_REPORT.none], verbatim: false })
    expect(text(d.story, 'passBar')).toMatchObject({ lines: [DES.passBarNone], verbatim: false })
  })

  it('tabulates the registered test values with unit, basis, tag and note', () => {
    const tests = table(desDossier(bare(VOLMANAGED), CTX).story, 'tests')
    expect(tests.title).toBe(DES.kpiRow)
    expect(tests.columns).toEqual([DOSSIER.cols.measure, DOSSIER.cols.value, DOSSIER.cols.unit, DOSSIER.cols.basis, DOSSIER.cols.tag, DOSSIER.cols.note])
    expect(tests.rows.map((r) => r[0])).toEqual(registrationKpis(VOLMANAGED.card).map((k) => k.kpi.label))
    expect(tests.rows).toEqual([
      ['Managed Sharpe, 1 tick', '+0.99', 'Sharpe ratio, annualised (daily)', 'A', '[PRE-REG]', 'Read from headline.1tick.sharpe_m in the screen JSON.'],
      ['n', '2686', 'count', 'A', '[PRE-REG]', ''],
      ['alpha t (gating: smaller of Newey-West lags 5 and 21)', '+1.18', 'ratio', 'A', '[PRE-REG]', ''],
      ['p', '0.1198', 'probability', 'A', '[PRE-REG]', ''],
      ['Control p', '0.1198', 'probability', 'A', '[PRE-REG]', ''],
      ['Bonferroni', '0.2396', 'probability', 'A', '[PRE-REG]', ''],
      ['Holm', '0.1198', 'probability', 'A', '[PRE-REG]', ''],
      ['BH q', '0.1198', 'probability', 'A', '[PRE-REG]', ''],
    ])
  })

  it('prints -- and the registry note for a test value that is not recorded, and [POST HOC] for a check row', () => {
    const tests = table(desDossier(bare(ZA_C3), CTX).story, 'tests')
    const control = tests.rows.find((r) => r[0] === 'Control p') ?? []
    expect(control[1]).toBe('--')
    expect(control[5]).toBe(DES.notRecorded)
    expect(control[4]).toBe('[POST HOC]')
  })

  it('adds the tear sheet key figures when the browser already holds the analytics', () => {
    const d = desDossier(withTear(VOLMANAGED), CTX)
    expect(d.story.map((s) => s.id)).toEqual(['hypothesis', 'passBar', 'tests', 'kpis'])
    expect(table(d.story, 'kpis').rows).toHaveLength(13)
    expect(table(d.story, 'kpis').title).toBe(DOSSIER.sections.kpis)
  })
})

describe('desDossier: evidence', () => {
  it('puts the tear sheet missing note first when there are no analytics, naming the hypothesis', () => {
    const d = desDossier(bare(VOLMANAGED), CTX)
    expect(d.evidence.map((s) => s.id)).toEqual(['tearMissing', 'checks', 'costs', 'blocks', 'runs', 'confirmations'])
    expect(d.evidence[0]).toEqual({
      kind: 'text',
      id: 'tearMissing',
      title: 'volmanaged_v0: tear sheet dossier',
      lines: [fillCopy(DOSSIER.tearMissing, { name: 'volmanaged_v0' })],
      verbatim: false,
    })
    expect(text(d.evidence, 'tearMissing').lines[0]).toContain('Open volmanaged_v0 EQ first')
  })

  it('has no missing note and ends with SV7 when the analytics are held', () => {
    const d = desDossier(withTear(VOLMANAGED), CTX)
    expect(d.evidence.map((s) => s.id)).toEqual(['checks', 'costs', 'blocks', 'runs', 'confirmations', 'sv7'])
    const sv7 = table(d.evidence, 'sv7')
    const model = sv7Table(readSv7(HYP_ANALYTICS.validity.sharpe_difference_tests))
    expect(sv7.rows.map((r) => r.slice(1))).toEqual(model.sections.flatMap((s) => s.rows.map((r) => r.values)))
    expect(sv7.note).toContain(TEAR_SV7.tag)
  })

  it('lists the pass checks as recorded: number, key, reading, result and value', () => {
    const checks = table(desDossier(bare(VOLMANAGED), CTX).evidence, 'checks')
    expect(checks.title).toBe(DES.cards.checks)
    expect(checks.columns).toEqual([DES.checksColumns.number, DES.checksColumns.key, DES.checksColumns.reading, DES.checksColumns.result, DES.checksColumns.value])
    const expected = checkRows(VOLMANAGED.card.pass_checks, 1)
    expect(checks.rows).toHaveLength(3)
    expect(checks.rows.map((r) => r[1])).toEqual(['alpha_t_ge_2', 'blocks_a_gt_0', 'dsr_2tick_gt_0'])
    expect(checks.rows.map((r) => r[2])).toEqual(expected.map((r) => r.reading))
    expect(checks.rows[0]).toEqual(['1', 'alpha_t_ge_2', 'alpha t >= 2', DES.checkFail, DES.checkNone])
    expect(checks.note).toBe(DES.thresholdNote)
    const passed = table(desDossier(bare(OVERNIGHT), CTX).evidence, 'checks')
    expect(passed.rows.map((r) => r[3])).toEqual([DES.checkPass, DES.checkPass, DES.checkPass, DES.checkPass])
  })

  it('shows a recorded check value, path and text, and marks a valueless check with a value result', () => {
    const card = { ...ZA.card, pass_checks: [{ name: 'note', passed: null, value: { dsr: 0.5, n: 12 } }] }
    const checks = table(desDossier(bare({ ...ZA, card }), CTX).evidence, 'checks')
    expect(checks.rows).toEqual([['1', 'note', 'note', DES.checkValue, `${DES.dsrLabel} 0.5000; n 12`]])
  })

  it('says a hypothesis has no pass checks of its own, as text', () => {
    const none = text(desDossier(bare(ZA_C3), CTX).evidence, 'checks')
    expect(none.lines).toEqual([DES.checksNone])
    expect(none.title).toBe(DES.cards.checks)
  })

  it('tabulates the cost ladder with the unit, the basis, the tag and the break-even note', () => {
    const costs = table(desDossier(bare(VOLMANAGED), CTX).evidence, 'costs')
    expect(costs.title).toBe(DES.cards.cost)
    expect(costs.columns).toEqual(DES_REPORT.ladderCols)
    expect(costs.rows).toEqual([['0 ticks', '+3.53'], ['1 tick', '+3.47'], ['2 ticks', '+3.42']])
    expect(costs.note).toContain(breakEvenText(VOLMANAGED.des))
    expect(costs.note).toContain('Break-even 66.11 ticks per side, beyond the ladder')
    expect(costs.note).toContain('alpha, % per year')
    expect(costs.note).toContain(DES.basisLine)
    expect(costs.note).toContain('[PRE-REG]')
  })

  it('says when no break-even is recorded, and when there is no ladder at all', () => {
    expect(table(desDossier(bare(OVERNIGHT), CTX).evidence, 'costs').note).toContain(DES.breakEvenNone)
    expect(text(desDossier(bare(ZA_C3), CTX).evidence, 'costs').lines).toEqual([DES.ladderNone])
  })

  it('tabulates the blocks with their unit, and says when there are none', () => {
    const blocks = table(desDossier(bare(VOLMANAGED), CTX).evidence, 'blocks')
    expect(blocks.title).toBe(DES_REPORT.blocks)
    expect(blocks.columns).toEqual(DES_REPORT.blockCols)
    expect(blocks.rows).toEqual([['2010-13', '+5.96'], ['2014-17', '-1.43'], ['2018-21', '+3.73']])
    expect(blocks.note).toContain('alpha, % per year, 1 tick per side')
    const none = { ...VOLMANAGED, des: { ...VOLMANAGED.des, blocks: [] } }
    expect(text(desDossier(bare(none), CTX).evidence, 'blocks').lines).toEqual([DES.blocksNone])
  })

  it('lists the linked runs and the confirmations, and says when there are none', () => {
    expect(text(desDossier(bare(VOLMANAGED), CTX).evidence, 'runs').lines).toEqual(['nt_volmanaged_v0_fixture_m1'])
    expect(text(desDossier(bare(ZA), CTX).evidence, 'runs').lines).toEqual(ZA.card.nautilus_runs)
    expect(text(desDossier(bare(ZA_C3), CTX).evidence, 'runs').lines).toEqual([DES.runsNone])
    expect(text(desDossier(bare(REBAL), CTX).evidence, 'confirmations').lines).toEqual(['rebal_v1_confirm'])
    expect(text(desDossier(bare(VOLMANAGED), CTX).evidence, 'confirmations').lines).toEqual([DES.confirmationsNone])
    expect(text(desDossier(bare(VOLMANAGED), CTX).evidence, 'confirmations').title).toBe(DES_REPORT.confirmations)
  })
})

describe('desDossier: sources and footer', () => {
  it('names the hypothesis GET, then the analytics GET when they are held', () => {
    expect(desDossier(bare(VOLMANAGED), CTX).sources).toEqual(['GET /api/hypotheses/volmanaged_v0'])
    expect(desDossier(withTear(VOLMANAGED), CTX).sources).toEqual([
      'GET /api/hypotheses/volmanaged_v0',
      'GET /api/analytics/hypothesis/volmanaged_v0?cost=1',
    ])
  })

  it('encodes a name that needs it', () => {
    const odd = { ...VOLMANAGED, card: { ...VOLMANAGED.card, name: 'a b' } }
    expect(desDossier(bare(odd), CTX).sources).toEqual(['GET /api/hypotheses/a%20b'])
  })

  it('closes with the descriptive line, and the demo note only in the demo', () => {
    expect(desDossier(bare(VOLMANAGED), CTX).footer[0]).toBe(DOSSIER.descriptive)
    expect(desDossier(bare(VOLMANAGED), CTX).footer).not.toContain(DOSSIER.demoNote)
    expect(desDossier(bare(VOLMANAGED), { ...CTX, demo: true }).footer).toContain(DOSSIER.demoNote)
  })
})

describe('desDossier: edge cases', () => {
  it('has as many cells in every row as there are columns, in every table', () => {
    for (const detail of [VOLMANAGED, OVERNIGHT, REBAL, ZA, ZA_C3]) {
      const d = desDossier(withTear(detail), CTX)
      for (const s of [...d.story, ...d.evidence]) {
        if (s.kind === 'table') for (const row of s.rows) expect(row).toHaveLength(s.columns.length)
      }
    }
  })

  it('keeps all 17 blocks of a check row, and a wide cost ladder, without loss', () => {
    expect(ZA_C3.des.blocks).toHaveLength(17)
    expect(table(desDossier(bare(ZA_C3), CTX).evidence, 'blocks').rows).toHaveLength(17)
    const ladder = Array.from({ length: 200 }, (_, i) => ({ ticks_per_side: i, value: i / 10 }))
    const wide = { ...VOLMANAGED, des: { ...VOLMANAGED.des, cost_ladder: ladder } }
    expect(table(desDossier(bare(wide), CTX).evidence, 'costs').rows).toHaveLength(200)
  })

  it('prints -- for a non-finite cost or block value and for an unrecorded unit', () => {
    const des = {
      ...VOLMANAGED.des,
      cost_ladder: [{ ticks_per_side: 1, value: Number.NaN }, { ticks_per_side: 2, value: 1.5 }],
      cost_ladder_unit: null,
      blocks: [{ label: 'b1', value: Number.POSITIVE_INFINITY }],
      blocks_unit: null,
      break_even_ticks_per_side: null,
    }
    const d = desDossier(bare({ ...VOLMANAGED, des }), CTX)
    const costs = table(d.evidence, 'costs')
    expect(costs.rows).toEqual([['1 tick', '--'], ['2 ticks', '+1.50']])
    expect(costs.note).toContain('Unit: --')
    expect(table(d.evidence, 'blocks').rows).toEqual([['b1', '--']])
    for (const line of strings(d)) expect(line).not.toMatch(/\b(null|undefined|NaN|Infinity)\b/)
  })

  it('reads a headline with no unit and no label as --, with the default label', () => {
    const card = { ...VOLMANAGED.card, headline_unit: null, headline_display: null, headline_label: null, headline_value: null }
    const headline = table(desDossier(bare({ ...VOLMANAGED, card }), CTX).story, 'tests').rows[0] ?? []
    expect(headline).toEqual([DES.kpiDescription.headline, '--', '--', 'A', '[PRE-REG]', ''])
  })

  it('passes markup characters and unicode in the name through as text', () => {
    const name = 'h<i>&"é'
    const odd = { ...VOLMANAGED, card: { ...VOLMANAGED.card, name } }
    const d = desDossier(bare(odd), CTX)
    expect(d.title).toBe(`${name}: hypothesis dossier`)
    expect(d.sources).toEqual([`GET /api/hypotheses/${encodeURIComponent(name)}`])
  })

  it('keeps CRLF line ends of a quoted pass bar so the quote still joins back to the source', () => {
    const spec = { ...(VOLMANAGED.spec as object), pass_bar: 'line one\r\nline two\n\nline four' }
    const bar = text(desDossier(bare({ ...VOLMANAGED, spec }), CTX).story, 'passBar')
    expect(bar.lines.join('\n')).toBe('line one\r\nline two\n\nline four')
    expect(bar.lines).toHaveLength(4)
  })
})

describe('desDossier: honesty', () => {
  it('holds no null, undefined or NaN in any text, for every fixture with and without analytics', () => {
    for (const detail of [VOLMANAGED, OVERNIGHT, REBAL, ZA, ZA_C3]) {
      for (const input of [bare(detail), withTear(detail)]) {
        for (const line of strings(desDossier(input, CTX))) expect(line).not.toMatch(/\b(null|undefined|NaN)\b/)
      }
    }
  })

  it('makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    desDossier(bare(VOLMANAGED), CTX)
    desDossier(withTear(VOLMANAGED), CTX)
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
    const input = structuredClone(withTear(VOLMANAGED))
    freeze(input)
    expect(() => desDossier(input, CTX)).not.toThrow()
    expect(input).toEqual(withTear(VOLMANAGED))
  })
})
