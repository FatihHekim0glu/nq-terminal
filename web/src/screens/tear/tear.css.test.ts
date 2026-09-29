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

describe('.tear-screen: a floor, not a fixed height, so a tall view grows the panel rather than overflowing it (G10)', () => {
  it('sets min-height, not height, for its 390px/100cqh floor', () => {
    const declarations = rule('.tear-screen')
    expect(declarations).toMatch(/min-height:\s*max\(390px,\s*100cqh\)\s*;/)
    expect(declarations).not.toMatch(/[^-]height:\s*max\(390px/)
  })

  // The floor alone is not enough: a view that may shrink to nothing (flex 1 1 0, min-height 0) never
  // grows .tear-screen past it, so in a HOME quadrant the KPI rows wrap, the chart keeps its 160px
  // floor and the view overprints the P1 books below (77px on EQ, 81px on RET, 101px on RR at 1366).
  it('lets the tab view grow the screen: it never shrinks below its content', () => {
    expect(rule('.tear-view')).toMatch(/flex:\s*1\s+0\s+auto\s*;/)
  })

  it("sizes RET's chart and statistics row from the chart's 160px floor, not the statistics' full length", () => {
    const declarations = rule('.tear-split')
    expect(declarations).toMatch(/flex:\s*1\s+1\s+160px\s*;/)
    expect(declarations).toMatch(/min-height:\s*160px\s*;/)
  })
})

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

// Roadmap 10: the DD lanes and the DD2 table mark the same episode. The table's half is a row fill.
describe('the highlighted drawdown row: the selection fill, from tokens', () => {
  it('fills every cell of the highlighted row, the rank row header and the No. cell included, with --sel-bg', () => {
    for (const cell of ['td', 'th']) {
      expect(rule(`.tear-table [data-highlight='true'] ${cell}`), cell).toMatch(/background:\s*var\(--sel-bg\)\s*;/)
    }
  })

  it('lifts the down red on that fill, as the grids do for a selected row (3.9 to 1 otherwise)', () => {
    expect(rule(".tear-table [data-highlight='true']")).toMatch(/--c-down:\s*var\(--c-down-raised\)\s*;/)
  })

  it('reads the No. hint cell (a plain td) muted, right aligned, on the grid row height, no bold', () => {
    const declarations = rule('.tear-no')
    expect(declarations).toMatch(/color:\s*var\(--muted\)\s*;/)
    expect(declarations).toMatch(/text-align:\s*right\s*;/)
    expect(declarations).toMatch(/height:\s*var\(--row-h\)\s*;/)
    expect(declarations).toMatch(/font-weight:\s*400\s*;/)
    expect(declarations).toMatch(/background:\s*var\(--bg\)\s*;/)
  })

  it('keeps the rank row header (a th) as it looked as a cell: on the grid row height, not bold, on the page fill', () => {
    const declarations = rule('.tear-rank')
    expect(declarations).toMatch(/font-weight:\s*400\s*;/)
    expect(declarations).toMatch(/height:\s*var\(--row-h\)\s*;/)
    expect(declarations).toMatch(/padding:\s*0\s+5px\s*;/)
    expect(declarations).toMatch(/background:\s*var\(--bg\)\s*;/)
  })

  it('lets the row hover fill reach the rank row header, which the grid rule (td only) does not', () => {
    expect(rule('.tear-table tbody tr:hover .tear-rank')).toMatch(/background:\s*var\(--hover-row\)\s*;/)
  })

  it('names no colour of its own: the whole sheet stays on tokens', () => {
    expect(STRIPPED).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(STRIPPED).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/)
  })
})

// A short panel gave the lanes pane about 50 px: rows of 3 px, with no text and no room to hover. The DD chart
// wrapper carries the number of drawn lanes and asks for 16 px more than the chart's 160 px floor per lane.
describe('.tear-chart-lanes: the DD chart grows with its lanes', () => {
  it('adds 16px per drawn lane to the 160px floor, from --tear-lane-rows (none by default)', () => {
    expect(rule('.tear-chart-lanes')).toMatch(/min-height:\s*calc\(160px\s*\+\s*var\(--tear-lane-rows,\s*0\)\s*\*\s*16px\)\s*;/)
  })

  it('names no colour of its own', () => {
    expect(rule('.tear-chart-lanes')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/)
  })

  it('comes after .tear-chart, so its min-height wins at equal specificity', () => {
    expect(STRIPPED.indexOf('.tear-chart-lanes {')).toBeGreaterThan(STRIPPED.indexOf('.tear-chart {'))
  })
})
