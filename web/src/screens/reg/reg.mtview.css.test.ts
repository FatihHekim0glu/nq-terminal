// reg.css for MT's tabpanel wrapper and 86) Replication (roadmap R8): the wrapper stacks the open view in a
// column, the family body keeps its G02 rule (a min-height, never a fixed height, so the adjusted grid can
// grow past one screen), and the replication chart has a fixed, positioned box. reg.css.test.ts covers the
// file-wide style rules (tokens only, no transition, no rounded corner).
import { describe, expect, it } from 'vitest'
import { readText } from '../../grids/testing'

const css = readText(new URL('./reg.css', import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, '')

/** A rule's declaration block for one exact selector, first match, anywhere in the file. */
function ruleFor(selector: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2]
  }
  return undefined
}

describe('.mt-view: the tabpanel that wraps the open MT view', () => {
  const view = ruleFor('.reg-screen[data-screen="MT"] > .mt-view')

  it('is a column that takes its content height and can shrink sideways', () => {
    expect(view, '.mt-view rule').toBeTruthy()
    expect(view ?? '').toMatch(/display:\s*flex/)
    expect(view ?? '').toMatch(/flex-direction:\s*column/)
    expect(view ?? '').toMatch(/flex:\s*0 0 auto/)
    expect(view ?? '').toMatch(/min-width:\s*0/)
  })

  it('sets no height of its own, so SV3 and the replication notes follow the body in the panel scroll', () => {
    expect(view ?? '').not.toMatch(/(?<!min-)(?<!max-)height\s*:/)
  })
})

describe('.mt-body inside .mt-view keeps the G02 rule', () => {
  const body = ruleFor('.reg-screen[data-screen="MT"] .mt-view > .mt-body')

  it('has a min-height of one screen and no fixed height', () => {
    expect(body, '.mt-view > .mt-body rule').toBeTruthy()
    expect(body ?? '').toMatch(/flex:\s*0 0 auto/)
    expect(body ?? '').toMatch(/min-height\s*:\s*100cqh/)
    expect(body ?? '').not.toMatch(/(?<!min-)(?<!max-)height\s*:/)
  })
})

describe('86) Replication', () => {
  it('takes its content height in the wrapper', () => {
    expect(ruleFor('.mt-replication') ?? '').toMatch(/flex:\s*0 0 auto/)
  })

  it('gives the scatter a positioned box of fixed height that can shrink sideways', () => {
    const chart = ruleFor('.mt-replication-chart')
    expect(chart, '.mt-replication-chart rule').toBeTruthy()
    expect(chart ?? '').toMatch(/position:\s*relative/)
    expect(chart ?? '').toMatch(/(?<!min-)(?<!max-)height:\s*\d+px/)
    expect(chart ?? '').toMatch(/min-width:\s*0/)
  })
})
