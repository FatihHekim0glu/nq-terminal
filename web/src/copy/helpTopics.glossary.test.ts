// U03: the words the terminal prints as labels (PASS, [POST HOC], SPENT, fence, Holm, KILL, TWS, Basis A...)
// were defined nowhere a reader could search: HL answered 'Nothing matches' for several of them. The
// glossary defines them once, and the HELP topic lists it, so HL's help text search finds each.
import { describe, expect, it } from 'vitest'
import { buildSearchIndex } from '../commands/searchIndex'
import { findCopyViolations } from './copyRules'
import { GLOSSARY, HELP_TOPICS } from './helpTopics'

const TERMS = GLOSSARY.map((g) => g.term)

describe('GLOSSARY', () => {
  it('defines every word the dogfood round could not look up', () => {
    const wanted = [
      'PASS', 'FAIL', 'CHECK', '[POST HOC]', '[PRE-REG]', '[SPENT]', '[SEALED]', '[IS]', '[PLUMBING]', '[PROBE]', '[OVERLAY]',
      'Verdict', 'Own bar', 'Family-adjusted p', 'Bonf', 'Holm', 'BH q', 'Hash ok', 'Amend', 'Fence', 'Gate', 'IS', 'Sealed',
      'Basis A', 'Basis B', 'DEMO DATA', 'FIXTURE DATA', 'KILL', 'TWS', 'Gate reads', 'READ ONLY', 'R1', 'RV22',
    ]
    for (const term of wanted) expect(TERMS, term).toContain(term)
  })

  it('has one entry per term, each with a real definition', () => {
    expect(new Set(TERMS).size).toBe(TERMS.length)
    for (const g of GLOSSARY) {
      expect(g.term.trim(), g.term).toBe(g.term)
      expect(g.term.length, g.term).toBeGreaterThan(0)
      expect(g.meaning.length, g.term).toBeGreaterThan(g.term.length + 20)
      expect(g.meaning, g.term).toMatch(/[.)"]$/)
    }
  })

  it('is in house style: no dashes, UK spelling', () => {
    expect(findCopyViolations(GLOSSARY)).toEqual([])
  })

  it('never claims the terminal produces a verdict or an order (the read only rules)', () => {
    const text = GLOSSARY.map((g) => g.meaning).join(' ')
    expect(text).not.toMatch(/terminal (decides|produces a (pass|fail)|places)/i)
    expect(GLOSSARY.find((g) => g.term === 'Verdict')?.meaning).toMatch(/never produces/)
    expect(GLOSSARY.find((g) => g.term === 'KILL')?.meaning).toMatch(/never toggles/)
  })

  it('states the own bar rule where a reader looks for PASS', () => {
    expect(GLOSSARY.find((g) => g.term === 'PASS')?.meaning).toMatch(/own pre-registered bar/)
    expect(GLOSSARY.find((g) => g.term === 'Own bar')?.meaning).toMatch(/family-adjusted p/i)
  })
})

describe('the HELP topic lists the glossary, so help text search finds it', () => {
  it('has one line per entry, term first', () => {
    const shows = HELP_TOPICS.HELP!.shows
    for (const g of GLOSSARY) expect(shows, g.term).toContain(`${g.term}: ${g.meaning}`)
  })

  it('still ends every line as a sentence', () => {
    for (const line of HELP_TOPICS.HELP!.shows) expect(line).toMatch(/[.)"]$/)
  })

  // The terms nothing else in the help text said: before the glossary these were 'Nothing matches'.
  it.each(['TWS', 'DEMO DATA', 'FIXTURE DATA', 'R1', 'Hash ok', 'Own bar', 'Gate reads', 'Family-adjusted p'])(
    'HL finds %s in the HELP page',
    (term) => {
      const hits = buildSearchIndex().search(term)
      expect(hits.some((h) => h.entry.group === 'help' && h.entry.code === 'HELP'), term).toBe(true)
    },
  )

  it('HL shows the phrase around the match, term first', () => {
    const hit = buildSearchIndex().search('TWS').find((h) => h.entry.code === 'HELP' && h.entry.group === 'help')
    expect(hit?.phrase ?? '').toMatch(/^TWS: /)
  })
})
