// @vitest-environment jsdom
// U01: 'About this demo'. The DEMO DATA flag and the demo's data segment had no help behind them, and HL had no
// page to send a reader to. The lines below say plainly what is fixture data, what is synthetic, what comes from the
// research files, what has full evidence and what 'not in the demo dataset' means. They sit at the top of the HELP
// page (a topic has to be one of the registry's mnemonics, so the demo has no code of its own), which HL reads.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSearchIndex } from '../commands/searchIndex'
import { evidenceInDemo } from '../demo/data/analytics'
import { HYPOTHESIS_DETAILS } from '../demo/data/research'
import { DEMO_DETAIL } from '../demo/data/text'
import HelpTopicPage from '../screens/help/HelpTopicPage'
import { DEMO_DATA } from './chrome'
import { findCopyViolations } from './copyRules'
import { DEMO_TOPIC, GLOSSARY, HELP_TOPICS } from './helpTopics'

afterEach(cleanup)

const LINES = DEMO_TOPIC.lines
const line = (lead: string): string => LINES.find((l) => l.startsWith(lead)) ?? ''

describe('DEMO_TOPIC: About this demo', () => {
  it('has a title and one line for each thing a first time reader asks', () => {
    expect(DEMO_TOPIC.title).toBe('About this demo')
    expect(LINES.map((l) => l.split(':')[0])).toEqual([
      'About this demo',
      'Synthetic prices',
      'Captured fixtures',
      'Research files',
      'Full evidence',
      'Not in the demo dataset',
      'Read only',
    ])
  })

  it('says first that the flag and the status segment are one thing, and that nothing is live', () => {
    const first = LINES[0] ?? ''
    expect(first).toContain(DEMO_DATA.term)
    expect(first).toMatch(/status segment/)
    expect(first).toMatch(/no backend/)
    expect(first).toMatch(/Nothing in it is live/)
  })

  it('says that prices are synthetic: seeded, not market data, not through the gate', () => {
    const synthetic = line('Synthetic prices')
    expect(synthetic).toMatch(/seeded generator/)
    expect(synthetic).toMatch(/not market data/)
    expect(synthetic).toMatch(/gate/)
    for (const screenCode of ['MON', 'CORR', 'VCONE', 'SEAS']) expect(synthetic, screenCode).toContain(screenCode)
  })

  it('says what is a captured fixture: DES cards, tear sheets, runs, and that LIVE replays', () => {
    const captured = line('Captured fixtures')
    for (const word of ['DES', 'tear sheets', 'runs', 'ledger', 'paper book']) expect(captured, word).toContain(word)
    expect(captured).toMatch(/LIVE .* replays a recorded journal/)
  })

  it('says what comes from the research files: REG, MT, on a named day, as a snapshot', () => {
    const research = line('Research files')
    expect(research).toContain('REG')
    expect(research).toContain('MT')
    expect(research).toContain('2026-09-27')
    expect(research).toMatch(/snapshot/)
  })

  // The two lines split the demo's DES cards by where each answer came from (demo/data/research.ts): the fixture
  // backend's cards are volmanaged_v0 and overnight_v0, and the others are real answers of GET /api/hypotheses/{name}.
  it('holds exactly the five DES cards the two lines are written for: the guard fails, and asks for the lines to be redone, when one comes or goes', () => {
    expect([...HYPOTHESIS_DETAILS.keys()].sort()).toEqual(['overnight_v0', 'rebal_v0', 'volmanaged_v0', 'za_v0', 'za_v0_C3_gao_momentum'])
  })

  it('calls only the DES cards of volmanaged_v0 and overnight_v0 fixture backend answers', () => {
    const captured = line('Captured fixtures')
    expect(captured).toContain('volmanaged_v0')
    expect(captured).toContain('overnight_v0')
    expect(captured).not.toContain('rebal_v0')
    expect(captured).not.toContain('za_v0')
  })

  it('calls the DES cards of rebal_v0 and za_v0 real answers of the API, in the research files line', () => {
    const research = line('Research files')
    expect(research).toContain('rebal_v0')
    expect(research).toContain('za_v0')
    expect(research).not.toContain('volmanaged_v0')
    expect(research).not.toContain('overnight_v0')
  })

  it('names the hypotheses and runs that have full evidence, as the dataset holds them', () => {
    const evidence = line('Full evidence')
    const held = evidenceInDemo()
    // The line is written for exactly this evidence: it fails, and asks for the line to be redone, if the dataset gains or loses one.
    expect(held.hypotheses).toEqual(['volmanaged_v0'])
    expect(held.costs).toEqual([1])
    expect(held.runs).toEqual(['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01'])
    expect(evidence).toContain('volmanaged_v0 has DES, EQ and RET at 1 tick per side')
    expect(evidence).toMatch(/Two runs have tear sheets/)
    expect(evidence).toContain('smoke_2015_01')
    expect(evidence).toContain('the fixture run of volmanaged_v0')
    expect(evidence).toMatch(/have no tear sheet/)
  })

  it('carries no demo marker into a production build: the bundle check keeps them out of every build but the demo', () => {
    const text = JSON.stringify(HELP_TOPICS) + JSON.stringify(GLOSSARY)
    expect(text).not.toContain('nt_volmanaged_v0_fixture_m1')
    expect(text).not.toContain('nqt-demo')
  })

  it("says what 'not in the demo dataset' means, in the words the refusal uses", () => {
    const gap = line('Not in the demo dataset')
    expect(gap.toLowerCase()).toContain(DEMO_DETAIL.notInDemo)
    expect(gap).toMatch(/no captured answer/)
    expect(gap).toMatch(/not a fault/)
  })

  it('is house style: whole sentences, no dashes, UK spelling', () => {
    expect(findCopyViolations(DEMO_TOPIC)).toEqual([])
    for (const l of LINES) expect(l, l).toMatch(/[.)"]$/)
  })
})

describe('the HELP page carries About this demo', () => {
  beforeEach(() => {
    document.documentElement.dataset.demo = 'on'
  })
  afterEach(() => {
    delete document.documentElement.dataset.demo
  })

  it('lists the lines first, then the rest of the page', () => {
    const shows = HELP_TOPICS.HELP!.shows
    expect(shows.slice(0, LINES.length)).toEqual(LINES)
    expect(shows.length).toBeGreaterThan(LINES.length + GLOSSARY.length)
  })

  it('renders the lines on the HELP topic page', () => {
    render(<HelpTopicPage code="HELP" built={new Set(['HELP'])} onTopic={() => undefined} onIndex={() => undefined} />)
    for (const l of LINES) expect(screen.getByText(l), l).toBeTruthy()
  })

  it('is found by HL for demo, with About this demo as the phrase', () => {
    const hit = buildSearchIndex().search('demo').find((h) => h.entry.group === 'help' && h.entry.code === 'HELP')
    expect(hit).toBeTruthy()
    expect(hit?.phrase ?? '').toMatch(/^About this demo: /)
  })

  it.each(['synthetic', 'fixture', 'snapshot', 'not in the demo dataset', 'volmanaged_v0'])('is found by HL for %s', (word) => {
    const hits = buildSearchIndex().search(word)
    expect(hits.some((h) => h.entry.group === 'help' && h.entry.code === 'HELP'), word).toBe(true)
  })
})

// About this demo says the page runs on captured data with no backend behind it. That is false of the real terminal,
// so the lines lead the HELP page only in the demo (data-demo="on", set by the demo boot before anything renders),
// and HL finds them only there. Everything else on the page is the same in both builds.
describe('outside the demo (no data-demo mark)', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.demo
  })

  it('keeps every About this demo line off the HELP page', () => {
    const shows = HELP_TOPICS.HELP!.shows
    for (const l of LINES) expect(shows, l).not.toContain(l)
  })

  it('does not render the lines on the HELP topic page, and still renders the glossary', () => {
    render(<HelpTopicPage code="HELP" built={new Set(['HELP'])} onTopic={() => undefined} onIndex={() => undefined} />)
    expect(screen.queryByText(LINES[0] ?? '')).toBeNull()
    for (const l of LINES) expect(screen.queryByText(l), l).toBeNull()
    const term = GLOSSARY.find((g) => g.term === 'Own bar')
    expect(screen.getByText(`${term?.term}: ${term?.meaning}`)).toBeTruthy()
  })

  it('does not let HL find a demo only word on the HELP page', () => {
    const hits = buildSearchIndex().search('synthetic')
    expect(hits.some((h) => h.entry.group === 'help' && h.entry.code === 'HELP')).toBe(false)
  })

  it('still finds HELP for demo, through the glossary, and the phrase is not the About this demo line', () => {
    const hit = buildSearchIndex().search('demo').find((h) => h.entry.group === 'help' && h.entry.code === 'HELP')
    expect(hit).toBeTruthy()
    expect(hit?.phrase ?? '').not.toMatch(/^About this demo:/)
  })

  it('keeps the three lines before the glossary and the whole glossary on the page', () => {
    const shows = HELP_TOPICS.HELP!.shows
    expect(shows).toHaveLength(3 + GLOSSARY.length)
    for (const g of GLOSSARY) expect(shows, g.term).toContain(`${g.term}: ${g.meaning}`)
  })
})

describe('the glossary names the one term', () => {
  it('defines DEMO DATA as the demo, for the flag and the status segment, and points to the lines', () => {
    const meaning = GLOSSARY.find((g) => g.term === DEMO_DATA.term)?.meaning ?? ''
    expect(meaning).toMatch(/status line/)
    expect(meaning).toMatch(/About this demo/)
    expect(meaning).not.toMatch(/not research results/)
  })

  it('is true in both builds: it says About this demo leads the page in the demo, not that it does everywhere', () => {
    const meaning = GLOSSARY.find((g) => g.term === DEMO_DATA.term)?.meaning ?? ''
    expect(meaning).toMatch(/In the demo, About this demo leads this page/)
    expect(meaning).not.toMatch(/first on this page/)
  })

  it('keeps FIXTURE DATA for a backend on a fixture folder, and says the demo uses DEMO DATA instead', () => {
    const meaning = GLOSSARY.find((g) => g.term === 'FIXTURE DATA')?.meaning ?? ''
    expect(meaning).toMatch(/fixture folder/)
    expect(meaning).toContain(DEMO_DATA.term)
  })
})
