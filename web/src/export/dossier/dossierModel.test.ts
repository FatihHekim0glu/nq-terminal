// buildDossier and the parts both dossiers share: the flags, the footer and the tear sheet sections. The
// footer is the part most likely to print a stray word, so it is pinned line for line, and probed with
// clocks that do not parse.
import { describe, expect, it } from 'vitest'
import { DOSSIER } from '../../copy/dossier'
import { TEAR_SV7 } from '../../copy/tear'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { RUN_ANALYTICS } from '../../screens/tear/tear.fixtures'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import { buildDossier, flags, footer, intervalSection, kpiSection, sv7Section } from './dossierModel'
import { desDossier } from './dossierDes'
import { tearDossier } from './dossierTear'
import type { DossierContext, DossierInput } from './types'

const CTX: DossierContext = { now: new Date('2026-09-28T18:02:11Z'), demo: false, fixture: false, asOfUtc: '2026-09-28T18:02:00Z' }

const TEAR: Extract<DossierInput, { kind: 'tear' }> = {
  kind: 'tear',
  target: { kind: 'hypothesis', name: 'volmanaged_v0' },
  tab: 'DD',
  analytics: HYP_ANALYTICS,
  card: VOLMANAGED.card,
}
const DES: Extract<DossierInput, { kind: 'des' }> = { kind: 'des', detail: VOLMANAGED, analytics: null }

describe('buildDossier: dispatch', () => {
  it('builds a tear sheet dossier for a tear input', () => {
    const d = buildDossier(TEAR, CTX)
    expect(d).toEqual(tearDossier(TEAR, CTX))
    expect(d.title).toBe('volmanaged_v0: tear sheet dossier')
  })

  it('builds a hypothesis dossier for a DES input', () => {
    const d = buildDossier(DES, CTX)
    expect(d).toEqual(desDossier(DES, CTX))
    expect(d.title).toBe('volmanaged_v0: hypothesis dossier')
  })

  it('does not depend on the tab that was open', () => {
    expect(buildDossier({ ...TEAR, tab: 'MRET' }, CTX)).toEqual(buildDossier({ ...TEAR, tab: 'EQ' }, CTX))
  })
})

describe('footer', () => {
  it('says what the dossier is, when it was made in New York time, the server clock and the fence', () => {
    expect(footer(CTX)).toEqual([
      DOSSIER.descriptive,
      'Made 14:02:11 ET from GET answers already in this browser; nothing was recomputed.',
      'Server clock 14:02:00 ET at the last status check.',
      'IS | 2022+ SPENT',
    ])
  })

  it('follows New York time through the winter change', () => {
    const winter = footer({ ...CTX, now: new Date('2026-01-15T18:02:11Z'), asOfUtc: null })
    expect(winter[1]).toBe('Made 13:02:11 ET from GET answers already in this browser; nothing was recomputed.')
  })

  it('adds the demo note last, in the demo only', () => {
    const demo = footer({ ...CTX, demo: true })
    expect(demo.at(-1)).toBe(DOSSIER.demoNote)
    expect(footer(CTX)).not.toContain(DOSSIER.demoNote)
  })

  it('drops the server clock when there is none', () => {
    const lines = footer({ ...CTX, asOfUtc: null })
    expect(lines).toHaveLength(3)
    expect(lines.some((l) => l.includes('Server clock'))).toBe(false)
  })

  it('never prints null, undefined or Invalid for a clock that does not parse', () => {
    const bad: DossierContext[] = [
      { ...CTX, now: new Date('not a date') },
      { ...CTX, asOfUtc: 'yesterday' },
      { ...CTX, asOfUtc: '' },
      { ...CTX, now: new Date(Number.NaN), asOfUtc: null, demo: true },
    ]
    for (const ctx of bad) {
      const lines = footer(ctx)
      expect(lines.length).toBeGreaterThanOrEqual(2)
      for (const line of lines) expect(line).not.toMatch(/null|undefined|Invalid|NaN/)
      expect(lines).toContain(DOSSIER.descriptive)
      expect(lines).toContain('IS | 2022+ SPENT')
    }
    expect(footer(bad[0]!).some((l) => l.startsWith('Made'))).toBe(false)
  })

  it('is never the text null on any built dossier', () => {
    for (const ctx of [CTX, { ...CTX, asOfUtc: null }, { ...CTX, demo: true, fixture: true }]) {
      for (const input of [TEAR, DES, { ...DES, analytics: HYP_ANALYTICS }]) {
        for (const line of buildDossier(input, ctx).footer) expect(line).not.toMatch(/\bnull\b/)
      }
    }
  })
})

describe('flags', () => {
  it('keeps the lead flags, then DEMO DATA, then FIXTURE DATA', () => {
    expect(flags(CTX, ['[PASS]'])).toEqual(['[PASS]'])
    expect(flags({ ...CTX, demo: true }, ['[PASS]'])).toEqual(['[PASS]', 'DEMO DATA'])
    expect(flags({ ...CTX, fixture: true }, [])).toEqual(['FIXTURE DATA'])
    expect(flags({ ...CTX, demo: true, fixture: true }, ['[A]', '[B]'])).toEqual(['[A]', '[B]', 'DEMO DATA', 'FIXTURE DATA'])
  })
})

describe('the shared tear sheet sections', () => {
  it('kpiSection has one row per API KPI and names basis, unit and tag on every one', () => {
    const kpis = kpiSection(RUN_ANALYTICS)
    expect(kpis.kind).toBe('table')
    expect(kpis.rows).toHaveLength(RUN_ANALYTICS.kpis.length)
    expect(kpis.rows[0]).toEqual(['Total return', '-0.36%', 'fraction of the account', 'B', '[POST HOC]', 'Shown as a percentage: the API value times 100.'])
    for (const row of kpis.rows) {
      expect(row[2]).not.toBe('')
      expect(row[3]).toBe('B')
      expect(row[4]).toBe('[POST HOC]')
    }
  })

  it('intervalSection is one row of Sharpe, low, high and z', () => {
    expect(intervalSection(RUN_ANALYTICS).rows).toEqual([['-5.82', '-15.93', '4.30', '1.96']])
  })

  it('sv7Section is a table with costs across, or the reason there is none', () => {
    expect(sv7Section(HYP_ANALYTICS).kind).toBe('table')
    const none = sv7Section(RUN_ANALYTICS)
    expect(none).toMatchObject({ kind: 'text', lines: [TEAR_SV7.notRecorded] })
  })
})
