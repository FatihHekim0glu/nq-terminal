import { afterEach, describe, expect, it } from 'vitest'
import { parseLine } from '../commands/line'
import { MAX_LINE } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import {
  LINK_ACTIONS,
  MAX_LINK_LINES,
  isLinkAction,
  linesFromHash,
  markWorkspaceGone,
  markWorkspaceReady,
  resetWorkspaceReady,
  whenWorkspaceReady,
} from './deepLink'

afterEach(resetWorkspaceReady)

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'CL', symbol: 'CL.V.0', sector: 'energy' },
  ],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: ['nt_volmanaged_v0'],
  registry_error: null,
}

const line = (text: string, newPanel = false) => ({ line: text, newPanel })

describe('linesFromHash: the accepted syntax', () => {
  it('reads one line: percent-decoded, first line replaces', () => {
    expect(linesFromHash('#go=NQ%20GP%201d')).toEqual([line('NQ GP 1d')])
  })

  it('reads two lines in order: the first replaces, the later one opens a new panel', () => {
    expect(linesFromHash('#go=REG&go=LEDG')).toEqual([line('REG'), line('LEDG', true)])
  })

  it('reads a hash written without its leading #', () => {
    expect(linesFromHash('go=REG')).toEqual([line('REG')])
  })

  it('trims the line and keeps the case as written', () => {
    expect(linesFromHash('#go=%20volmanaged_v0%20ret%20')).toEqual([line('volmanaged_v0 ret')])
  })

  it('accepts the whole command alphabet: letters, digits, underscore, dot, hyphen and space', () => {
    expect(linesFromHash('#go=nt_x.v0-9%20SEAS%202024-01-05')).toEqual([line('nt_x.v0-9 SEAS 2024-01-05')])
  })

  it('accepts exactly MAX_LINK_LINES lines and a line of exactly MAX_LINE characters', () => {
    const eight = Array.from({ length: MAX_LINK_LINES }, (_, i) => `go=R${i}`).join('&')
    expect(linesFromHash(`#${eight}`)).toHaveLength(MAX_LINK_LINES)
    const longest = 'A'.repeat(MAX_LINE)
    expect(linesFromHash(`#go=${longest}`)).toEqual([line(longest)])
  })
})

describe('linesFromHash: null means "not a link", an empty list means "a link that is refused"', () => {
  it.each([[''], ['#'], ['#top'], ['#section-2'], ['#x=1'], ['#tab=2&page=3']])('%j is not a link (null): the hash is left alone', (hash) => {
    expect(linesFromHash(hash)).toBeNull()
  })

  it.each([
    ['an empty value', '#go='],
    ['a value that is blank after trimming', '#go=%20%20'],
    ['script text', '#go=%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
    ['a plus sign, which is not a space here', '#go=NQ+GP'],
    ['a semicolon', '#go=REG%3BRESET'],
    ['a newline inside the line', '#go=REG%0ARESET'],
    ['a tab', '#go=REG%09GP'],
    ['a NUL character', '#go=REG%00'],
    ['non-ASCII letters', '#go=%C3%A9cole'],
    ['a line of MAX_LINE + 1 characters', `#go=${'A'.repeat(MAX_LINE + 1)}`],
    ['nine lines', `#${Array.from({ length: MAX_LINK_LINES + 1 }, (_, i) => `go=R${i}`).join('&')}`],
    ['a bad percent-encoding', '#go=%E0%A4%A'],
    ['a lone percent sign', '#go=100%'],
    ['a part whose key is not go, after a good one', '#go=REG&x=1'],
    ['a part whose key is not go, before a good one', '#x=1&go=REG'],
    ['a key that only starts with go', '#go=REG&gone=LEDG'],
    ['an empty part between two lines', '#go=REG&&go=LEDG'],
    ['a trailing ampersand', '#go=REG&'],
    ['a part with no equals sign', '#go=REG&go'],
    ['a line with an equals sign in it', '#go=REG=1'],
  ])('refuses %s', (_name, hash) => {
    expect(linesFromHash(hash)).toEqual([])
  })

  it('refuses a very long hash, in one line or in many, without trouble', () => {
    expect(linesFromHash(`#go=${'%41'.repeat(100_000)}`)).toEqual([])
    expect(linesFromHash(`#go=REG${'&go=REG'.repeat(50_000)}`)).toEqual([])
  })

  it('is total: no input throws', () => {
    for (const hash of ['#go=%', '#go=%%', '#go=%zz', '#&', '#=', '#go=&go=', '\u0000', '#go=\ud800']) {
      expect(() => linesFromHash(hash)).not.toThrow()
    }
  })
})

describe('the link action allowlist', () => {
  const parse = (text: string) => parseLine(text, { index: INDEX, fallbackContext: null })

  it('names exactly run, context and help', () => {
    expect([...LINK_ACTIONS]).toEqual(['run', 'context', 'help'])
  })

  it.each([['volmanaged_v0 RET'], ['NQ GP 1d'], ['REG'], ['NXTW REG'], ['CL1 Comdty'], ['NQ'], ['volmanaged_v0'], ['REG HELP'], ['GP HELP']])(
    '%j may run from a link',
    (text) => {
      expect(isLinkAction(parse(text))).toBe(true)
    },
  )

  it.each([
    ['RESET'],
    ['UNDO'],
    ['WATCH'],
    ['WATCH SEEN'],
    ['GRAB'],
    ['98'],
    ['3'],
    ['HL cost'],
    ['HL'],
    ['LAST'],
    ['NO'],
    ['MENU'],
    ['INDEX'],
  ])('%j never runs from a link', (text) => {
    expect(parse(text).ok).toBe(true)
    expect(isLinkAction(parse(text))).toBe(false)
  })

  it.each([['ZZZ'], ['GP'], ['NQ ZZZ'], ['']])('%j fails to parse and so is not a link action', (text) => {
    expect(parse(text).ok).toBe(false)
    expect(isLinkAction(parse(text))).toBe(false)
  })
})

describe('the workspace-ready signal', () => {
  const pending = async (promise: Promise<void>): Promise<boolean> =>
    Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 15))])

  it('is pending until the workspace is marked ready, then resolves every waiter', async () => {
    const first = whenWorkspaceReady()
    const second = whenWorkspaceReady()
    expect(await pending(first)).toBe(true)
    markWorkspaceReady()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  it('resolves at once while the workspace is ready', async () => {
    markWorkspaceReady()
    await expect(whenWorkspaceReady()).resolves.toBeUndefined()
  })

  it('is pending again once the workspace is gone', async () => {
    markWorkspaceReady()
    markWorkspaceGone()
    expect(await pending(whenWorkspaceReady())).toBe(true)
  })

  it('resetWorkspaceReady forgets the state and the waiters (tests)', async () => {
    const waiting = whenWorkspaceReady()
    resetWorkspaceReady()
    markWorkspaceReady()
    expect(await pending(waiting)).toBe(true)
  })
})
