// The table styles MonitorGrid imports (look spec 4.8 and 4.12), checked as text: every colour
// is a token, the states are hard cuts, and the hovered-cell and selected-row overrides keep the
// text at 4.5:1 (section 8.2). Spec values are the section 2 hex values the tokens carry.
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../theme/contrast'
import css from './grid.css?raw'

const SPEC = {
  muted: '#A5A5A5',
  'muted-hover': '#B4B4B4',
  'c-down-hover': '#FF8A94',
  'c-down-raised': '#FF5566',
  'hover-cell': '#3C3C3C',
  'sel-bg': '#0C2B4A',
  'th-bg': '#232323',
} as const

/** The declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

function tokenOverride(decls: string, name: string): string {
  const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(decls)
  if (!m) throw new Error(`no --${name} override`)
  return (m[1] ?? '').trim()
}

describe('grid.css (look spec 4.8)', () => {
  it('uses tokens for every colour: no hex, rgb or hsl literal', () => {
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('draws the header on --th-bg with a 1px --th-rule top, 20px, sticky, black gaps between cells', () => {
    const th = rule('.nqt-grid thead th')
    expect(th).toMatch(/background:\s*var\(--th-bg\)/)
    expect(th).toMatch(/color:\s*var\(--th-fg\)/)
    expect(th).toMatch(/border-top:\s*1px solid var\(--th-rule\)/)
    expect(th).toMatch(/position:\s*sticky/)
    expect(th).toMatch(/height:\s*var\(--row-h\)/)
    expect(th).toMatch(/box-shadow:\s*inset -1px 0 0 var\(--bg\)/)
  })

  it('has 20px black body rows with no zebra, 0 by 5px padding, amber names and light numbers', () => {
    expect(css).not.toMatch(/nth-child\(\s*(even|odd|2n)/)
    const td = rule('.nqt-grid td')
    expect(td).toMatch(/height:\s*var\(--row-h\)/)
    expect(td).toMatch(/padding:\s*0 5px/)
    expect(rule('.nqt-grid .name')).toMatch(/color:\s*var\(--data\)/)
    expect(rule('.nqt-grid .num')).toMatch(/text-align:\s*right/)
    expect(rule('.nqt-grid .num')).toMatch(/tabular-nums/)
    expect(rule('.nqt-grid tr.total-row td')).toMatch(/color:\s*var\(--white\)/)
  })

  it('hovers the row in --hover-row and the cell in --hover-cell, with a hard cut', () => {
    expect(rule('.nqt-grid tbody tr:hover td')).toMatch(/background:\s*var\(--hover-row\)/)
    expect(rule('.nqt-grid tbody tr td:hover')).toMatch(/background:\s*var\(--hover-cell\)/)
    expect(css).not.toMatch(/transition\s*:(?![^;]*\b(opacity|transform)\b)/)
  })

  it('keeps muted and down text readable inside a hovered cell (8.2: 5.32 and 4.89)', () => {
    const decls = rule('.nqt-grid tbody tr td:hover')
    expect(tokenOverride(decls, 'muted')).toBe('var(--muted-hover)')
    expect(tokenOverride(rule('.nqt-grid td:focus-visible'), 'muted')).toBe('var(--muted-hover)')
    expect(contrastRatio(SPEC['muted-hover'], SPEC['hover-cell'])).toBeGreaterThanOrEqual(4.5)
    expect(tokenOverride(decls, 'c-down')).toBe('var(--c-down-hover)')
    expect(contrastRatio(SPEC['c-down-hover'], SPEC['hover-cell'])).toBeGreaterThanOrEqual(4.5)
  })

  it('born failing: the unmodified muted grey fails in a hovered cell', () => {
    expect(contrastRatio(SPEC.muted, SPEC['hover-cell'])).toBeLessThan(4.5)
  })

  it('switches down text to --c-down-raised on the selected row and on header and band rows', () => {
    for (const sel of ['.nqt-grid tr[aria-selected="true"]', '.nqt-grid thead', '.nqt-grid tr.band-row']) {
      expect(tokenOverride(rule(sel), 'c-down')).toBe('var(--c-down-raised)')
    }
    expect(rule('.nqt-grid tbody tr[aria-selected="true"] td')).toMatch(/background:\s*var\(--sel-bg\)/)
    expect(contrastRatio(SPEC['c-down-raised'], SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(SPEC['c-down-raised'], SPEC['th-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('shows keyboard focus as a 2px --focus ring drawn inside the cell or row', () => {
    const focus = rule('.nqt-grid td:focus-visible')
    expect(focus).toMatch(/outline:\s*2px solid var\(--focus\)/)
    expect(focus).toMatch(/outline-offset:\s*-2px/)
    expect(focus).toMatch(/background:\s*var\(--hover-cell\)/)
  })

  it('draws group rows black and bold white, the filter row amber, and optional rules off by default', () => {
    expect(rule('.nqt-grid tr.group-row td')).toMatch(/color:\s*var\(--white\)/)
    expect(rule('.nqt-grid tr.filter-row td')).toMatch(/background:\s*var\(--field-bg\)/)
    expect(rule('.nqt-grid.ruled td')).toMatch(/border-left:\s*1px solid var\(--th-rule\)/)
  })

  it('sizes inline bars at 60% of the row and colours them by sign or magnitude', () => {
    expect(rule('.nqt-grid .bar')).toMatch(/height:\s*60%/)
    expect(rule('.nqt-grid .bar.pos')).toMatch(/var\(--bar-pos\)/)
    expect(rule('.nqt-grid .bar.neg')).toMatch(/var\(--bar-neg\)/)
    expect(rule('.nqt-grid .bar.mag')).toMatch(/var\(--bar-mag\)/)
  })

  it('uses classic 15px scrollbars from the --sb tokens, never overlay ones', () => {
    expect(rule('.nqt-grid-scroll::-webkit-scrollbar')).toMatch(/width:\s*var\(--sb-w\)/)
    expect(rule('.nqt-grid-scroll::-webkit-scrollbar-thumb')).toMatch(/background:\s*var\(--sb-thumb\)/)
    // Firefox only: in Chromium scrollbar-color switches the ::-webkit-scrollbar styling off.
    expect(css).toMatch(/@supports \(-moz-appearance: none\) \{\s*\.nqt-grid-scroll \{ scrollbar-color: var\(--sb-thumb\) var\(--sb-track\); \}/)
    expect(css).not.toMatch(/overflow:\s*overlay/)
  })

  it('writes warnings in --exc and --warn', () => {
    expect(rule('.nqt-grid-exc')).toMatch(/color:\s*var\(--exc\)/)
    expect(rule('.nqt-grid-warn')).toMatch(/color:\s*var\(--warn\)/)
  })
})

// Added with MonitorGrid and JournalTable (TASKS 5.4).
const ROW_TEXT: Readonly<Record<string, string>> = {
  text: '#D7D7D7',
  data: '#FFA028',
  muted: '#A5A5A5',
  white: '#FFFFFF',
  warn: '#FFE100',
  'c-up': '#51EE6C',
  'c-down-hover': '#FF8A94',
}
const BAND = '#2D2D2D'
const C_DOWN = '#FF2C4A'

describe('grid.css: the active cell of a focused grid (MonitorGrid, aria-activedescendant)', () => {
  it('draws the 2px --focus ring and the hovered-cell fill on the active cell, not on the table', () => {
    const cell = rule('.nqt-grid[role="grid"]:focus-visible .is-active')
    expect(cell).toMatch(/outline:\s*2px solid var\(--focus\)/)
    expect(cell).toMatch(/outline-offset:\s*-2px/)
    expect(cell).toMatch(/background:\s*var\(--hover-cell\)/)
    expect(tokenOverride(cell, 'muted')).toBe('var(--muted-hover)')
    expect(tokenOverride(cell, 'c-down')).toBe('var(--c-down-hover)')
    expect(rule('.nqt-grid[role="grid"]:focus-visible')).toMatch(/outline:\s*none/)
  })
})

describe('grid.css: hatched plumbing rows (UI_SPEC section 6, look spec 7.11)', () => {
  it('hatches plumbing rows in --band stripes over black, with the banner in --warn bold', () => {
    const row = rule('.nqt-grid tbody tr.plumbing-row td')
    expect(row).toMatch(/repeating-linear-gradient\(-45deg, var\(--band\) 0 6px, var\(--bg\) 6px 12px\)/)
    const banner = rule('.nqt-grid .plumbing-banner')
    expect(banner).toMatch(/color:\s*var\(--warn\)/)
    expect(banner).toMatch(/font-weight:\s*700/)
  })

  it('lifts down text to --c-down-hover inside plumbing rows', () => {
    expect(tokenOverride(rule('.nqt-grid tr.plumbing-row'), 'c-down')).toBe('var(--c-down-hover)')
  })

  it.each(Object.entries(ROW_TEXT))('keeps %s text at 4.5:1 on the lighter hatch stripe', (_name, hex) => {
    expect(contrastRatio(hex, BAND)).toBeGreaterThanOrEqual(4.5)
  })

  it('born failing: the plain down red fails on the hatch stripe, which is why it is lifted', () => {
    expect(contrastRatio(C_DOWN, BAND)).toBeLessThan(4.5)
  })

  it('draws journal source codes in --tape-src', () => {
    expect(rule('.nqt-grid .src')).toMatch(/color:\s*var\(--tape-src\)/)
  })
})

describe('grid.css: journal source codes stay readable in every row state', () => {
  const TAPE_SRC = '#EA5D08'
  const TAPE_FG = '#FB9600'

  it('born failing: --tape-src fails on the selection navy, the hatch stripe and the hovered cell', () => {
    for (const bg of [SPEC['sel-bg'], BAND, SPEC['hover-cell']]) expect(contrastRatio(TAPE_SRC, bg)).toBeLessThan(4.5)
  })

  it('lifts --tape-src to --tape-fg on selected, plumbing, hovered and active cells, which passes on each', () => {
    const rules = [
      '.nqt-grid tr[aria-selected="true"]',
      '.nqt-grid tr.plumbing-row',
      '.nqt-grid tbody tr td:hover',
      '.nqt-grid td:focus-visible',
      '.nqt-grid[role="grid"]:focus-visible .is-active',
    ]
    for (const sel of rules) expect(tokenOverride(rule(sel), 'tape-src'), sel).toBe('var(--tape-fg)')
    for (const bg of [SPEC['sel-bg'], BAND, SPEC['hover-cell'], '#000000', '#191919']) expect(contrastRatio(TAPE_FG, bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TAPE_SRC, '#191919')).toBeGreaterThanOrEqual(4.5)
  })
})

// Row marking (roadmap 9): a marked row takes the selection fill, and the glyph makes it more than colour.
describe('grid.css: marked rows (Space marks a row for Compare)', () => {
  it('fills the cells of a marked row with --sel-bg, a token and no literal', () => {
    const decls = rule('.nqt-grid tbody tr[data-marked="true"] td')
    expect(decls).toMatch(/background:\s*var\(--sel-bg\)/)
    expect(decls).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('draws the mark glyph in --white', () => {
    expect(rule('.nqt-grid .mark-glyph')).toMatch(/color:\s*var\(--white\)/)
    expect(contrastRatio('#FFFFFF', SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('lifts down text and journal source codes on a marked row, as on the selected row (same fill)', () => {
    const decls = rule('.nqt-grid tr[data-marked="true"]')
    expect(tokenOverride(decls, 'c-down')).toBe('var(--c-down-raised)')
    expect(tokenOverride(decls, 'tape-src')).toBe('var(--tape-fg)')
    expect(contrastRatio(SPEC['c-down-raised'], SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('wins over row hover as the selection does, but a hovered cell and the focus ring still win over it', () => {
    const at = (needle: string) => {
      const i = css.indexOf(needle)
      if (i < 0) throw new Error(`no ${needle}`)
      return i
    }
    const marked = at('tr[data-marked="true"] td')
    expect(marked).toBeGreaterThan(at('.nqt-grid tbody tr:hover td'))
    expect(marked).toBeLessThan(at('.nqt-grid tbody tr td:hover'))
    expect(marked).toBeLessThan(at('.nqt-grid[role="grid"]:focus-visible .is-active'))
  })

  it('adds no transition: marking is a hard cut like every other state', () => {
    expect(rule('.nqt-grid tbody tr[data-marked="true"] td')).not.toMatch(/transition/)
  })
})
