import { describe, expect, it } from 'vitest'
import { CHROME_WORDS } from '../copy/commands'
import { findCopyViolations } from '../copy/copyRules'
import { describeError } from './messages'
import { displayLine, isSavableName, parseLine, type LineResult } from './line'
import { MNEMONICS } from './registry'
import { sectorWord } from './sectors'
import { isWorkspaceName } from '../state/workspaces'
import { COPY_SUFFIXES } from '../state/remoteStore.keys'
import { workspaceMenu } from '../chrome/WorkspaceMenu'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
    { root: '6E', symbol: '6E.V.0', sector: 'fx' },
    { root: 'ZC', symbol: 'ZC.V.0', sector: 'grains' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0', 'rebal_v0'],
  confirmations: [],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

function action(result: LineResult) {
  if (!result.ok) throw new Error(`expected an action, got ${result.error.code}`)
  return result.action
}

function failure(result: LineResult) {
  if (result.ok) throw new Error(`expected an error, got ${result.action.kind}`)
  return result.error
}

const parse = (line: string, fallback: string | null = null) => parseLine(line, { index: INDEX, fallbackContext: fallback })

describe('spec 8.4 parser cases', () => {
  it('NQ1 INDEX GP 1d: generic ticker, sector key, function and timeframe', () => {
    const a = action(parse('NQ1 INDEX GP 1d'))
    expect(a.kind).toBe('run')
    if (a.kind !== 'run') return
    expect(a.command.context).toEqual({ kind: 'instrument', value: 'NQ' })
    expect(a.command.args).toEqual({ timeframe: '1d' })
    expect(a.command.canonical).toBe('NQ GP 1d')
    expect(a.newPanel).toBe(false)
  })

  it('NQ INDEX GP and NQ GP: the sector key is optional', () => {
    const withSector = action(parse('NQ INDEX GP'))
    const without = action(parse('NQ GP'))
    expect(withSector).toEqual(without)
  })

  it('TY1 COMDTY DES resolves to ZN', () => {
    const a = action(parse('TY1 COMDTY DES'))
    expect(a.kind === 'run' && a.command.context).toEqual({ kind: 'instrument', value: 'ZN' })
  })

  it('C 1 COMDTY GP: the spaced grain ticker', () => {
    const a = action(parse('C 1 COMDTY GP'))
    expect(a.kind === 'run' && a.command.canonical).toBe('ZC GP')
  })

  it('INDEX on its own opens the sector menu', () => {
    expect(action(parse('INDEX'))).toEqual({ kind: 'sector', sector: 'INDEX' })
    expect(action(parse('cmdty'))).toEqual({ kind: 'sector', sector: 'COMDTY' })
  })

  it('NQ1 INDEX loads the context and opens its function menu', () => {
    expect(action(parse('NQ1 INDEX'))).toEqual({ kind: 'context', context: { kind: 'instrument', value: 'NQ' }, newPanel: false })
    expect(action(parse('rebal_v0'))).toEqual({ kind: 'context', context: { kind: 'hypothesis', value: 'rebal_v0' }, newPanel: false })
  })

  it('3 selects numbered item 3 (Number <GO>)', () => {
    expect(action(parse('3'))).toEqual({ kind: 'number', n: 3 })
    expect(action(parse(' 42 '))).toEqual({ kind: 'number', n: 42 })
  })

  it('GP HELP opens the help for GP', () => {
    expect(action(parse('GP HELP'))).toEqual({ kind: 'help', code: 'GP' })
    expect(action(parse('NQ GP HELP'))).toEqual({ kind: 'help', code: 'GP' })
    expect(action(parse('gip help'))).toEqual({ kind: 'help', code: 'GIP' })
  })

  it('NXTW NQ GP opens in a new panel', () => {
    const a = action(parse('NXTW NQ GP'))
    expect(a.kind === 'run' && a.newPanel).toBe(true)
    expect(a.kind === 'run' && a.command.canonical).toBe('NQ GP')
  })

  it('LAST, NO, MENU and HL are chrome words', () => {
    expect(action(parse('LAST'))).toEqual({ kind: 'last' })
    expect(action(parse('no'))).toEqual({ kind: 'tape' })
    expect(action(parse('MENU'))).toEqual({ kind: 'menu' })
    expect(action(parse('HL rebal'))).toEqual({ kind: 'search', query: 'rebal' })
    expect(action(parse('HL'))).toEqual({ kind: 'search', query: '' })
  })

  it('born failing (D14): HL takes a query with punctuation, including the screen titles themselves', () => {
    expect(action(parse('HL Analytics: equity'))).toEqual({ kind: 'search', query: 'Analytics: equity' })
    expect(action(parse('hl P&L'))).toEqual({ kind: 'search', query: 'P&L' })
    expect(action(parse('HL [POST HOC]'))).toEqual({ kind: 'search', query: '[POST HOC]' })
    // A plain over-length line is still refused, HL query included.
    expect(failure(parse(`HL ${'x'.repeat(250)}`)).code).toBe('too-long')
  })

  it('MAIN is HOME', () => {
    const a = action(parse('MAIN'))
    expect(a.kind === 'run' && a.command.mnemonic.code).toBe('HOME')
  })

  it('HELP on its own opens the HELP index screen', () => {
    const a = action(parse('HELP'))
    expect(a.kind === 'run' && a.command.mnemonic.code).toBe('HELP')
  })

  it('rejects NQ COMDTY with a message that names F10', () => {
    const error = failure(parse('NQ COMDTY'))
    expect(error.code).toBe('sector-mismatch')
    expect(describeError(error)).toBe('NQ is an Index future: use INDEX (F10).')
    expect(describeError(failure(parse('ZN INDEX GP')))).toBe('ZN is a Comdty future: use COMDTY (F9).')
  })

  it('rejects 27F INDEX CORR: the universe, hypotheses and runs take no sector', () => {
    expect(failure(parse('27F INDEX CORR')).code).toBe('sector-not-taken')
    expect(failure(parse('za_v0 COMDTY DES')).code).toBe('sector-not-taken')
    expect(failure(parse('nt_dtsmom_v0_ts1 INDEX RUN')).code).toBe('sector-not-taken')
  })

  it('rejects chrome words with trailing text and a bare NXTW', () => {
    expect(failure(parse('LAST 3')).code).toBe('extra-after-word')
    expect(failure(parse('NXTW')).code).toBe('missing-command')
  })

  it('keeps the plain grammar and its errors', () => {
    expect(failure(parse('NQ FOO')).code).toBe('unknown-function')
    expect(failure(parse('')).code).toBe('empty')
    const a = action(parse('GP', 'ES'))
    expect(a.kind === 'run' && a.command.canonical).toBe('ES GP')
  })
})

describe('chrome words RESET, UNDO, WATCH, WATCH SEEN and GRAB (roadmap #15, #16)', () => {
  it('parse in any case', () => {
    expect(action(parse('reset'))).toEqual({ kind: 'reset' })
    expect(action(parse('RESET'))).toEqual({ kind: 'reset' })
    expect(action(parse('undo'))).toEqual({ kind: 'undo' })
    expect(action(parse('Undo'))).toEqual({ kind: 'undo' })
    expect(action(parse('grab'))).toEqual({ kind: 'grab' })
    expect(action(parse('GrAb'))).toEqual({ kind: 'grab' })
    expect(action(parse('watch'))).toEqual({ kind: 'watch' })
    expect(action(parse('WATCH'))).toEqual({ kind: 'watch' })
    expect(action(parse('watch seen'))).toEqual({ kind: 'watch-seen' })
    expect(action(parse('WATCH SEEN'))).toEqual({ kind: 'watch-seen' })
    expect(action(parse('Watch Seen'))).toEqual({ kind: 'watch-seen' })
  })

  it("RESET X, GRAB X, UNDO X and WATCH NOW fail with 'extra-after-word'", () => {
    expect(failure(parse('RESET X')).code).toBe('extra-after-word')
    expect(failure(parse('GRAB X')).code).toBe('extra-after-word')
    expect(failure(parse('UNDO X')).code).toBe('extra-after-word')
    expect(failure(parse('WATCH NOW')).code).toBe('extra-after-word')
    expect(failure(parse('WATCH SEEN NOW')).code).toBe('extra-after-word')
  })

  it('collision guard: no chrome word equals a mnemonic code or a sector word', () => {
    const mnemonicCodes = new Set<string>(MNEMONICS.map((m) => m.code))
    for (const word of Object.keys(CHROME_WORDS)) {
      expect(mnemonicCodes.has(word), word).toBe(false)
      expect(sectorWord(word), word).toBeNull()
    }
  })
})

describe('workspace words SAVE, LOAD and FORGET (roadmap #14)', () => {
  it('SAVE NAME, LOAD NAME and FORGET NAME parse in any case, the name in capitals', () => {
    expect(action(parse('SAVE VMREVIEW'))).toEqual({ kind: 'save', name: 'VMREVIEW' })
    expect(action(parse('LOAD VMREVIEW'))).toEqual({ kind: 'load', name: 'VMREVIEW' })
    expect(action(parse('FORGET VMREVIEW'))).toEqual({ kind: 'forget', name: 'VMREVIEW' })
    expect(action(parse('save my_desk'))).toEqual({ kind: 'save', name: 'MY_DESK' })
    expect(action(parse('Load my_desk'))).toEqual({ kind: 'load', name: 'MY_DESK' })
    expect(action(parse('  forget   Ab  '))).toEqual({ kind: 'forget', name: 'AB' })
  })

  it('LOAD on its own opens the workspace menu (no name)', () => {
    expect(action(parse('LOAD'))).toEqual({ kind: 'load', name: null })
    expect(action(parse('load'))).toEqual({ kind: 'load', name: null })
  })

  it('reads the words without the commands index (the index is not needed for a name)', () => {
    expect(action(parseLine('SAVE VMREVIEW', { index: null }))).toEqual({ kind: 'save', name: 'VMREVIEW' })
    expect(action(parseLine('LOAD', { index: null }))).toEqual({ kind: 'load', name: null })
    expect(action(parseLine('FORGET VMREVIEW', { index: null, fallbackContext: null }))).toEqual({ kind: 'forget', name: 'VMREVIEW' })
  })

  it("SAVE with a name that is a function, a chrome word or a sector key fails with 'bad-name' and names the token", () => {
    for (const bad of ['REG', 'GP', 'RESET', 'UNDO', 'HOME', 'INDEX', 'SAVE', 'LOAD', 'FORGET']) {
      expect(failure(parse(`SAVE ${bad}`)), `SAVE ${bad}`).toEqual({ code: 'bad-name', token: bad })
    }
  })

  it("SAVE with a name outside the rule fails with 'bad-name': one letter, a leading digit or underscore, a hyphen or dot, 17 characters", () => {
    expect(failure(parse('SAVE a-b'))).toEqual({ code: 'bad-name', token: 'A-B' })
    expect(failure(parse('SAVE X'))).toEqual({ code: 'bad-name', token: 'X' })
    expect(failure(parse('SAVE 2FAST')).code).toBe('bad-name')
    expect(failure(parse('SAVE _KEEP')).code).toBe('bad-name')
    expect(failure(parse('SAVE MY.DESK')).code).toBe('bad-name')
    expect(failure(parse('SAVE ABCDEFGHIJKLMNOPQ')).code).toBe('bad-name')
    expect(action(parse('SAVE ABCDEFGHIJKLMNOP'))).toEqual({ kind: 'save', name: 'ABCDEFGHIJKLMNOP' })
  })

  it("SAVE with an order ticket word fails with 'bad-name': a workspace tab must never read as an order control", () => {
    for (const bad of ['BUY', 'SELL', 'ORDER', 'ORDERS', 'SUBMIT', 'CANCEL', 'MODIFY', 'TRANSMIT', 'MY_ORDER', 'SELL_PLAN']) {
      expect(failure(parse(`SAVE ${bad}`)), `SAVE ${bad}`).toEqual({ code: 'bad-name', token: bad })
      expect(isSavableName(bad), bad).toBe(false)
    }
    // Words that only contain those letters inside are fine.
    for (const good of ['REVIEW', 'VMREVIEW', 'BORDER', 'WORDER']) expect(action(parse(`SAVE ${good}`)), good).toEqual({ kind: 'save', name: good })
  })

  it("SAVE's name rule (line.ts, without the store) is the store's isWorkspaceName on every word tried", () => {
    const words = [
      ...MNEMONICS.map((m) => m.code),
      ...Object.keys(CHROME_WORDS),
      'INDEX', 'COMDTY', 'CURNCY', 'EQUITY', 'GOVT', 'CORP',
      'A', 'AB', 'A_', 'A1', '1A', '_A', 'A-B', 'A.B', 'ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOPQ', 'VMREVIEW', 'MY_DESK', 'my_desk', 'Mixed', '', ' ', 'NQ1', 'NQ', 'ES1', 'REGX', 'LOADX', 'SAVEX',
      'BUY', 'SELL', 'ORDER', 'ORDERS', 'SUBMIT', 'CANCEL', 'MODIFY', 'TRANSMIT', 'MY_ORDER', 'SELL_PLAN', 'REVIEW', 'BORDER', 'MODIF', 'XBUY', 'A_BUY',
    ]
    for (const word of words) expect(isSavableName(word), JSON.stringify(word)).toBe(isWorkspaceName(word))
  })

  it('LOAD and FORGET take any word of the command alphabet as the name: the store says when there is no such workspace', () => {
    expect(action(parse('FORGET X'))).toEqual({ kind: 'forget', name: 'X' })
    expect(action(parse('LOAD a-b'))).toEqual({ kind: 'load', name: 'A-B' })
    expect(action(parse('LOAD REG'))).toEqual({ kind: 'load', name: 'REG' })
    expect(action(parse('FORGET reset'))).toEqual({ kind: 'forget', name: 'RESET' })
  })

  it('LOAD and FORGET take a copy the store keeps beside a name, "<name> (conflict)" or "<name> (imported)", in any case', () => {
    expect(action(parse('LOAD MINE (conflict)'))).toEqual({ kind: 'load', name: 'MINE (conflict)' })
    expect(action(parse('  forget  mine   (IMPORTED) '))).toEqual({ kind: 'forget', name: 'MINE (imported)' })
    expect(action(parseLine('FORGET MY_DESK (Conflict)', { index: null, fallbackContext: null }))).toEqual({ kind: 'forget', name: 'MY_DESK (conflict)' })
    // The suffixes are the store's own: a test keeps the two in step.
    for (const suffix of COPY_SUFFIXES) expect(action(parse(`LOAD MINE${suffix}`)), suffix).toEqual({ kind: 'load', name: `MINE${suffix}` })
  })

  it('a copy is never a SAVE name, and no other bracketed word or extra token is taken', () => {
    expect(parse('SAVE MINE (conflict)').ok).toBe(false)
    expect(parse('LOAD MINE (other)').ok).toBe(false)
    expect(parse('LOAD MINE (conflict) X').ok).toBe(false)
    expect(parse('LOAD (conflict)').ok).toBe(false)
    expect(parse('GP MINE (conflict)').ok).toBe(false)
  })

  it('every row of the LOAD menu runs a line that loads exactly the stored name, copies included', () => {
    const recipe = { panels: [{ line: 'REG', group: '-', ref: null, direction: 'right' }] } as const
    const menu = workspaceMenu({ MINE: recipe, 'MINE (conflict)': recipe, 'MINE (imported)': recipe })
    for (const item of menu.items) {
      if (item.act.kind !== 'run') throw new Error(item.label)
      expect(action(parse(item.act.line)), item.label).toEqual({ kind: 'load', name: item.label })
    }
  })

  it("SAVE and FORGET without a name fail with 'missing-name' naming the word", () => {
    expect(failure(parse('SAVE'))).toEqual({ code: 'missing-name', token: 'SAVE' })
    expect(failure(parse('  forget '))).toEqual({ code: 'missing-name', token: 'FORGET' })
  })

  it("more than one name fails with 'extra-after-word'", () => {
    expect(failure(parse('SAVE ONE TWO'))).toEqual({ code: 'extra-after-word', token: 'SAVE' })
    expect(failure(parse('LOAD ONE TWO'))).toEqual({ code: 'extra-after-word', token: 'LOAD' })
    expect(failure(parse('FORGET ONE TWO'))).toEqual({ code: 'extra-after-word', token: 'FORGET' })
  })

  it('a character outside the command alphabet still fails first', () => {
    expect(failure(parse('SAVE MY$DESK')).code).toBe('bad-character')
  })

  it('NXTW does not carry the words: they never open a panel', () => {
    for (const line of ['NXTW SAVE VMREVIEW', 'NXTW LOAD', 'NXTW FORGET VMREVIEW']) {
      expect(parse(line).ok, line).toBe(false)
    }
  })

  it('the new errors read as full sentences with the token filled in and no copy-rule breach', () => {
    const bad = describeError(failure(parse('SAVE REG')))
    expect(bad).toBe('REG is not a workspace name: 2 to 16 letters, digits or _, starting with a letter, and not a function, command or trading word.')
    const missing = describeError(failure(parse('SAVE')))
    expect(missing).toBe('SAVE needs a workspace name, for example SAVE REVIEW.')
    expect(describeError(failure(parse('FORGET')))).toBe('FORGET needs a workspace name, for example FORGET REVIEW.')
    for (const text of [bad, missing]) {
      expect(text).not.toMatch(/[{}]/)
      expect(findCopyViolations({ text })).toEqual([])
    }
  })

  it('the three words are chrome words with a description, and are no function or sector', () => {
    for (const word of ['SAVE', 'LOAD', 'FORGET'] as const) {
      expect(CHROME_WORDS[word].length, word).toBeGreaterThan(10)
      expect(findCopyViolations({ text: CHROME_WORDS[word] }), word).toEqual([])
    }
    expect(CHROME_WORDS.SAVE).toBe('Keep the panels on screen as a named workspace')
    expect(CHROME_WORDS.LOAD).toBe('Open a saved workspace (alone: list them)')
    expect(CHROME_WORDS.FORGET).toBe('Remove a saved workspace')
  })
})

describe('command-line display (spec 3.3)', () => {
  it('shows typed letters in upper case and a sector key in title case', () => {
    expect(displayLine('nq1 index gp 1d')).toBe('NQ1 Index GP 1D')
    expect(displayLine('ty1 cmdty des')).toBe('TY1 Cmdty DES')
    expect(displayLine('za_v0 des')).toBe('ZA_V0 DES')
  })

  it('keeps the length, so the caret does not move', () => {
    for (const line of ['nq1 index gp', '  rebal_v0  des ', 'x']) expect(displayLine(line)).toHaveLength(line.length)
  })
})
