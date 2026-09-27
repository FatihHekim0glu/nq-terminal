import { describe, expect, it } from 'vitest'
import { commandLinkLine } from '../../chrome/CommandLine.bus'
import { parseLine } from '../../commands/line'
import { MNEMONICS, findMnemonic } from '../../commands/registry'
import type { CommandIndexData } from '../../commands/types'
import { HELP_TOPICS } from '../../copy/helpTopics'
import { findCopyViolations } from '../../copy/copyRules'
import { exampleNumbers, relatedNumbers, topicFor } from './helpTopics'

// A command index in the shape of GET /api/commands, holding every context the examples name.
const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
  ],
  universe: ['27F'],
  hypotheses: ['rebal_v0', 'volmanaged_v0'],
  confirmations: ['rebal_v1_confirm'],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

describe('HELP topics (look spec 7.12): one page per mnemonic, examples that run', () => {
  it('has a topic for every mnemonic in the registry and none for anything else', () => {
    expect(Object.keys(HELP_TOPICS).sort()).toEqual(MNEMONICS.map((m) => m.code).sort())
  })

  it('every example is a command link the command line parses to that function (or its help)', () => {
    for (const [code, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.examples.length, code).toBeGreaterThan(0)
      for (const text of topic.examples) {
        const line = commandLinkLine(text)
        expect(line, `${code}: ${text}`).not.toBeNull()
        const result = parseLine(line ?? '', { index: INDEX })
        if (!result.ok) throw new Error(`${code}: ${text} does not parse (${result.error.code})`)
        const action = result.action
        const target = action.kind === 'run' ? action.command.mnemonic.code : action.kind === 'help' ? action.code : null
        expect(target, `${code}: ${text}`).not.toBeNull()
        if (action.kind === 'run') expect(target, `${code}: ${text}`).toBe(code)
      }
    }
  })

  it('born failing: an example with an unknown context or a wrong argument does not parse', () => {
    expect(parseLine('nope_v9 DES', { index: INDEX }).ok).toBe(false)
    expect(parseLine('NQ GP 2m', { index: INDEX }).ok).toBe(false)
  })

  it('related functions are known mnemonics other than the topic itself', () => {
    for (const [code, topic] of Object.entries(HELP_TOPICS)) {
      for (const r of topic.related) {
        expect(findMnemonic(r)?.code, `${code} -> ${r}`).toBe(r)
        expect(r, code).not.toBe(code)
      }
    }
  })

  it('reads as sentences in house style: full stops, no dashes, UK spelling', () => {
    for (const [code, topic] of Object.entries(HELP_TOPICS)) {
      for (const s of [topic.summary, topic.data, ...topic.shows, ...(topic.honesty ? [topic.honesty] : [])]) {
        expect(s, code).toMatch(/[.)"]$/)
      }
    }
    expect(findCopyViolations(HELP_TOPICS)).toEqual([])
  })
})

describe('topicFor and the page numbers (Number <GO>)', () => {
  it('returns the topic with its mnemonic definition', () => {
    const gp = topicFor('GP')
    expect(gp.def.code).toBe('GP')
    expect(gp.copy).toBe(HELP_TOPICS.GP)
  })

  it('numbers examples from 41 and related functions from 51, below the index numbers', () => {
    expect(MNEMONICS.length).toBeLessThan(41)
    expect(exampleNumbers(HELP_TOPICS.GP!)).toEqual([41, 42, 43])
    expect(relatedNumbers(HELP_TOPICS.GP!)).toEqual([51, 52, 53, 54])
  })
})
