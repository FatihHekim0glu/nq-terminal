// REG's SV3 request gate (V032 first launch): the Deflated Sharpe request loads scipy.stats in the backend (0.4 to
// 0.6 s on a first launch), so a REG panel that wants it asks only after the registry and the hypotheses have
// answered: HOME's data comes first and the import follows its last response.
import { describe, expect, it } from 'vitest'
import { deflatedRequestable } from './regViews'

describe('deflatedRequestable', () => {
  it('waits for the registry', () => {
    expect(deflatedRequestable(true, false, true)).toBe(false)
  })

  it('waits for the hypotheses to answer or fail', () => {
    expect(deflatedRequestable(true, true, false)).toBe(false)
  })

  it('asks once the registry and the hypotheses have settled', () => {
    expect(deflatedRequestable(true, true, true)).toBe(true)
  })

  it('never asks for a panel that does not want it', () => {
    expect(deflatedRequestable(false, true, true)).toBe(false)
  })
})
