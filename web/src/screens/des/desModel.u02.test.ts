// U02 (polish 3): every adjusted p says which family it is adjusted over, and PASS/FAIL stays each
// hypothesis's own pre-registered bar. The DES tiles of Bonferroni, Holm and BH q carry 'registry family';
// the single-argument registrationKpis (the report and the dossier) keeps its published shape.
import { describe, expect, it } from 'vitest'
import { DES } from '../../copy/des'
import { findCopyViolations } from '../../copy/copyRules'
import { registrationKpis } from './desModel'
import { OVERNIGHT, VOLMANAGED } from './desTestData'

const ADJUSTED = ['bonferroni_p', 'holm_p', 'bh_q'] as const
const byKey = (specs: ReturnType<typeof registrationKpis>) => new Map(specs.map((s) => [s.kpi.key, s]))

describe('registrationKpis with the family shown (U02)', () => {
  const specs = byKey(registrationKpis(OVERNIGHT.card, { family: true }))

  it.each(['bonferroni_p', 'holm_p', 'bh_q'].map((k) => [k]))('%s reads its family beside the value', (key) => {
    const spec = specs.get(key)
    expect(spec, key).toBeDefined()
    expect(spec?.kpi.unit).toBe(DES.family.unit)
    expect(spec?.unit).toBe(DES.units.probability)
  })

  it('keeps every label and value, and leaves p and control p alone', () => {
    const plain = byKey(registrationKpis(OVERNIGHT.card))
    for (const [key, spec] of specs) {
      expect(spec.kpi.label).toBe(plain.get(key)?.kpi.label)
      expect(spec.kpi.value).toBe(plain.get(key)?.kpi.value)
    }
    for (const key of ['p', 'control_p', 'n', 't_stat', 'headline']) {
      expect(specs.get(key)?.kpi.unit, key).toBe(plain.get(key)?.kpi.unit)
      expect(specs.get(key)?.unit, key).toBeUndefined()
    }
  })

  it('states the family and that the adjusted p is context in the popover text of all three', () => {
    for (const key of ADJUSTED) {
      const text = specs.get(key)?.description ?? ''
      expect(text, key).toMatch(/registry family/)
      expect(text, key).toMatch(/does not change (the verdict|PASS or FAIL)/)
    }
  })

  it('a value the registry did not record still says so (the note is unchanged)', () => {
    const none = byKey(registrationKpis({ ...VOLMANAGED.card, holm_p: null }, { family: true }))
    expect(none.get('holm_p')?.kpi.note).toBe(DES.notRecorded)
  })
})

describe('registrationKpis without the family option is unchanged (report and dossier)', () => {
  it('keeps the published units, notes and no popover unit', () => {
    for (const spec of registrationKpis(OVERNIGHT.card)) {
      expect(spec.unit, spec.kpi.key).toBeUndefined()
    }
    const plain = byKey(registrationKpis(OVERNIGHT.card))
    for (const key of ADJUSTED) expect(plain.get(key)?.kpi.unit).toBe(DES.units.probability)
  })
})

describe('the family copy follows the copy rules', () => {
  it('has no dash and no US spelling', () => {
    expect(findCopyViolations({ family: DES.family, kpiDescription: DES.kpiDescription })).toEqual([])
  })

  it("says PASS/FAIL is the spec's own pre-registered bar and that a family named in the bar is the spec's", () => {
    expect(DES.family.note).toMatch(/registry family/)
    expect(DES.family.note).toMatch(/own pre-registered bar/)
    expect(DES.family.note).toMatch(/does not change/)
  })
})
