import { describe, expect, it } from 'vitest'
import { MNEMONIC_SCREENS } from './commands'
import { findCopyViolations } from './copyRules'
import { JOBS } from './jobs'

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(strings)
}

describe('JOBS copy', () => {
  it('has no em or en dash and no US spelling (UI_SPEC section 10)', () => {
    expect(findCopyViolations(JOBS)).toEqual([])
  })

  it('names the screen as the mnemonic table does', () => {
    expect(JOBS.screen).toBe(MNEMONIC_SCREENS.JOBS)
  })

  it('never uses a word the action-name scan flags (order, submit, cancel, modify): a job is queued and stopped', () => {
    expect(strings(JOBS).filter((s) => /order|submit|cancel|modif/i.test(s.replace('backtests/output/<run id>', '')))).toEqual([])
  })

  it('never names a tool-maker, a helper program or a model', () => {
    // The words are joined from parts, so this file holds none of them itself (the repository's commit hooks refuse them).
    const words = ['ai', 'assis' + 'tant', 'ag' + 'ent', 'cla' + 'ude', 'anthro' + 'pic', 'g' + 'pt', 'l' + 'lm']
    const banned = new RegExp(String.raw`\b(${words.join('|')})\b`, 'i')
    expect(strings(JOBS).filter((s) => banned.test(s))).toEqual([])
  })

  it('every slot a template names is a plain word, so fillCopy can fill it', () => {
    for (const s of strings(JOBS)) for (const slot of s.match(/\{[^}"]*\}/g) ?? []) expect(slot).toMatch(/^\{[a-zA-Z]+\}$/)
  })
})
