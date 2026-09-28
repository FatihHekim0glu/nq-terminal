// G15 regression: REG verdict notes must keep their first and last characters when the verdict's
// bracket text is two groups, '(...) [...]' (backend/nq_terminal/services/research.py:156-157 stripped
// note[1:-1] whenever the note started with '(' or '[' and ended with ')' or ']', even across two
// different bracket groups, losing the outer '(' and ']'). The backend fix is out of scope on this
// machine (no backend here, per the wave brief); this test guards the demo fixture the terminal reads
// instead, so vt_har_v0 and vrp_eq_v0 show their notes whole again.
import { describe, expect, it } from 'vitest'
import { HYPOTHESES } from './regFixtures'

function bracketsBalanced(text: string): boolean {
  const stack: string[] = []
  const closeFor: Record<string, string> = { ')': '(', ']': '[' }
  for (const ch of text) {
    if (ch === '(' || ch === '[') stack.push(ch)
    else if (ch === ')' || ch === ']') {
      if (stack.pop() !== closeFor[ch]) return false
    }
  }
  return stack.length === 0
}

function byName(name: string) {
  const card = HYPOTHESES.find((h) => h.name === name)
  if (!card) throw new Error(`no fixture card ${name}`)
  return card
}

describe('regFixtures HYPOTHESES: verdict_note keeps balanced brackets (G15)', () => {
  it('vt_har_v0: the risk-overlay note keeps both bracket groups whole', () => {
    const card = byName('vt_har_v0')
    expect(bracketsBalanced(card.verdict_note ?? '')).toBe(true)
    expect(card.verdict_note).toBe(
      '(risk overlay: thinner left tail at equal volatility; not an edge) [overlay, not edge: 26 CME futures, in-sample only]',
    )
    expect(card.verdict_note).toBe(card.verdict.replace(/^PASS\s*/, ''))
  })

  it('vrp_eq_v0: the drift note keeps both bracket groups whole', () => {
    const card = byName('vrp_eq_v0')
    expect(bracketsBalanced(card.verdict_note ?? '')).toBe(true)
    expect(card.verdict_note).toBe(
      '(drift: no timing alpha over the constant long book) [ES and YM, VIX/VXD timing, in-sample only]',
    )
    expect(card.verdict_note).toBe(card.verdict.replace(/^FAIL\s*/, ''))
  })

  it('a single-bracket-group note (dtsmom_v0) stays balanced too: the guard never over-fires', () => {
    const card = byName('dtsmom_v0')
    expect(bracketsBalanced(card.verdict_note ?? '')).toBe(true)
    expect(card.verdict_note).toBe('multi-asset universe: 27 CME futures, not NQ')
  })

  it('every card with a verdict_note keeps balanced brackets', () => {
    for (const card of HYPOTHESES) {
      if (card.verdict_note === null) continue
      expect(bracketsBalanced(card.verdict_note), `${card.name}: ${card.verdict_note}`).toBe(true)
    }
  })
})
