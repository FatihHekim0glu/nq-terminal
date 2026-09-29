// reg.css for MT 87) Effective trials (roadmap #19): the section takes its content height in the tabpanel wrapper,
// and the heatmap has a fixed, positioned box that can shrink sideways. reg.css.test.ts covers the file-wide style
// rules (tokens only, no transition, no rounded corner).
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

describe('87) Effective trials', () => {
  it('takes its content height in the wrapper', () => {
    expect(ruleFor('.mt-neff') ?? '').toMatch(/flex:\s*0 0 auto/)
  })

  it('gives the heatmap a fixed height, a positioned box and a min-width of 0', () => {
    const chart = ruleFor('.mt-neff-chart')
    expect(chart, '.mt-neff-chart rule').toBeTruthy()
    expect(chart ?? '').toMatch(/position:\s*relative/)
    expect(chart ?? '').toMatch(/(?<!min-)(?<!max-)height:\s*440px/)
    expect(chart ?? '').toMatch(/min-width:\s*0/)
  })
})
