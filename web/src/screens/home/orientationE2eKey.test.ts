// The e2e specs that measure the bare HOME frame (keys, fkeys, panels, market, tear) start with the first-run
// orientation line (N03) dismissed through e2e/orientation.ts. A spec cannot import from src, so that helper
// restates the storage key; this pins it to the one the line reads, and pins what the helper writes.
import { describe, expect, it } from 'vitest'
import helperSource from '../../../e2e/orientation.ts?raw'
import { ORIENTATION_KEY } from './HomeOrientation'

/** The string a top-level `export const NAME = '...'` of e2e/orientation.ts holds. */
function exported(name: string): string | undefined {
  return new RegExp(`export const ${name} = '([^']*)'`).exec(helperSource)?.[1]
}

describe('constants shared with e2e/orientation.ts', () => {
  it('restates the storage key the orientation line reads', () => {
    expect(exported('ORIENTATION_KEY')).toBe(ORIENTATION_KEY)
  })

  it('writes the dismissed value, which the line compares against', () => {
    expect(exported('ORIENTATION_DISMISSED')).toBe('1')
  })

  it('writes it before the page loads and guards the storage access', () => {
    expect(helperSource).toContain('addInitScript')
    expect(helperSource).toContain('try')
  })
})
