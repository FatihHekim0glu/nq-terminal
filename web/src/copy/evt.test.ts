// EVT copy (TASKS Phase 11): the band footnote and honesty wording, alongside the generic dash and
// US-spelling sweep every copy module gets from copyRules.test.ts.
import { describe, expect, it } from 'vitest'
import { EVT } from './evt'
import { fillCopy } from './workspace'

describe('EVT.bandNote (G17: duplicated "Band: band:" prefix)', () => {
  it('does not duplicate the word band when the API note already starts with it', () => {
    // events.py BAND_NOTE starts with 'band: ...' (services/events.py:79); the fixture mirrors that.
    const note = 'band: mean -/+ 1.96 x the cross-event standard error; no p-value is shown on a slice picked on screen'
    const rendered = fillCopy(EVT.bandNote, { note })
    expect(rendered).not.toMatch(/Band:\s*band:/i)
  })

  it('still shows the note verbatim, just once', () => {
    const note = 'band: mean -/+ 1.96 x the cross-event standard error'
    expect(fillCopy(EVT.bandNote, { note })).toContain(note)
  })
})

describe('EVT band wording (U04: align the honesty label with SEAS)', () => {
  it('labels the band a spread, not a confidence interval, as SEAS labels its own', () => {
    expect(EVT.band).toContain('not a confidence interval')
  })

  it('says the same in the chart table caption', () => {
    expect(EVT.caption).toContain('not a confidence interval')
  })
})
