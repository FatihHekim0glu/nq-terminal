// RET's SV7 layout (finding 7/8): the statistics scroll box holds the stats table and the SV7 card as two
// grid tracks, one column in a narrow panel and side by side (with a wider stats column) at and above the
// tear container's 1180px break, reusing the existing @container tear (min-width: 1180px) pattern.
import { describe, expect, it } from 'vitest'
import css from './tear.css?raw'

const STRIPPED = css.replace(/\/\*[\s\S]*?\*\//g, '')

function rule(selector: string): string {
  for (const m of STRIPPED.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

/** The raw text inside a top-level `@... (query) { ... }` block, brace-depth aware (rules may nest). */
function containerBlock(query: string): string {
  const start = STRIPPED.indexOf(query)
  if (start < 0) throw new Error(`no container query "${query}"`)
  const braceStart = STRIPPED.indexOf('{', start)
  let depth = 0
  let i = braceStart
  for (; i < STRIPPED.length; i += 1) {
    if (STRIPPED[i] === '{') depth += 1
    else if (STRIPPED[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return STRIPPED.slice(braceStart + 1, i)
}

describe('.tear-stats-cols: the SV7 card beside the statistics, one track in a narrow panel', () => {
  it('is a single-column grid outside the wide container', () => {
    const declarations = rule('.tear-stats-cols')
    expect(declarations).toMatch(/display:\s*grid/)
    expect(declarations).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/)
  })
})

describe('the 1180px tear container: the SV7 card beside a wider statistics column', () => {
  const block = containerBlock('@container tear (min-width: 1180px)')

  it('widens the stats scroll box that holds the SV7 card to 728px', () => {
    expect(block).toMatch(/\.tear-stats\.tear-stats-sv7\s*\{[^}]*flex-basis:\s*728px/)
  })

  it('splits that box into two tracks, the statistics and the card', () => {
    expect(block).toMatch(/\.tear-stats-sv7\s*>\s*\.tear-stats-cols\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  })
})
