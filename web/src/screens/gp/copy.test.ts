import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import { GP_COPY } from './copy'
import { GP_SCREEN_META } from './index'

// The app tsconfig carries browser types only, so the one Node built-in used here is typed by hand.
interface NodeFs {
  readFileSync(path: URL): Uint8Array
}
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as NodeFs
// Declarations only: comments may name what the file leaves out.
const css = new TextDecoder().decode(fs.readFileSync(new URL('./GpScreen.css', import.meta.url))).replace(/\/\*[\s\S]*?\*\//g, '')

describe('GP copy (UI_SPEC section 10)', () => {
  it('has no em or en dashes and no US spellings', () => {
    expect(findCopyViolations(GP_COPY)).toEqual([])
    expect(findCopyViolations(GP_SCREEN_META)).toEqual([])
  })

  it('uses house copy for the red bar titles (look spec 7.6)', () => {
    expect(GP_SCREEN_META.map((m) => [m.code, m.title])).toEqual([['GP', GP_COPY.titleGp], ['GIP', GP_COPY.titleGip]])
  })
})

describe('GpScreen.css (UI_SPEC section 3, look spec 8.5 d and e)', () => {
  it('writes no colour of its own: tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/)
  })

  it('has no transition and no rounded corner', () => {
    expect(css).not.toMatch(/transition|animation/)
    expect(css).not.toMatch(/border-radius:\s*[1-9]/)
  })

  it('born failing: the checks catch a hex colour and a transition', () => {
    expect('.x { color: #FFA028 }').toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect('.x { transition: background 0.2s }').toMatch(/transition|animation/)
  })
})
