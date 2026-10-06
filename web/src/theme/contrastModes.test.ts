// The system contrast modes (roadmap Phase D9) on the real stylesheets, with the negative cases that must
// fail each check:
// - forced colours: forcedColors.css uses system colours only, never a box-shadow, leads every selector with
//   :root, and answers every rule under src/ that draws a selected, pressed, current or open state as a fill;
// - prefers-contrast: more: contrastMore.css lifts text to 7:1 and rules to 3:1 in both looks and with both
//   colour-vision themes, never lowers a value, sets only colour tokens the looks may change, and every pair
//   the stylesheets write still passes;
// - neither applies outside its media query, so the default look and its baselines are untouched.
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import { CONTRAST_PAIRS, CVD_PAIRS, auditContrast, contrastRatio, readRawTokens, readTokens, type ContrastPair, type CvdTheme } from './contrast'
import { AMBER_CLASSIC_PAIRS, FIXED_TOKENS, readAmberClassicTokens } from './amberClassic'
import { mergeScans, scanCssPairs, uniquePairs } from './cssPairs'
import {
  FORCED_QUERY,
  MORE_QUERY,
  SYSTEM_COLOURS,
  auditForcedSheet,
  contrastMoreOverrides,
  headsOutside,
  missingForcedStates,
  normaliseSelector,
  readContrastMoreTokens,
  rulesInMedia,
  splitSelectorList,
  stateFillSelectors,
  type Look,
} from './contrastModes'

// Vitest stubs every stylesheet except tokens.css (vite.config.ts), so the sheets are read from disk.
// The app tsconfig carries browser types only, so the Node built-ins are typed here by hand.
interface DirEntry {
  readonly name: string
  isDirectory(): boolean
}
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as {
  readFileSync(path: string | URL, encoding: 'utf8'): string
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[]
}
const path = builtins.getBuiltinModule('node:path') as {
  join(...parts: string[]): string
  relative(from: string, to: string): string
  dirname(p: string): string
  resolve(...parts: string[]): string
}
const url = builtins.getBuiltinModule('node:url') as { fileURLToPath(u: string | URL): string }

const read = (name: string): string => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const forcedCss = read('./forcedColors.css')
const moreCss = read('./contrastMore.css')
const amberCss = read('./amberClassic.css')
const indexCss = read('./index.css')
const sheetsIn = { tokensCss, amberCss, moreCss }

const SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
/** Sheets that are not screens: the token values, the two contrast sheets, the print sheet and the gallery-only sheets. */
const NOT_SCREENS = /(?:^|[\\/])(?:tokens|amberClassic|forcedColors|contrastMore|print)\.css$|gallery|Gallery/

function sheets(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sheets(full)
    return entry.name.endsWith('.css') && !NOT_SCREENS.test(full) ? [full] : []
  })
}
const screenSheets = sheets(SRC).map((file) => ({ file: path.relative(SRC, file).replaceAll('\\', '/'), css: fs.readFileSync(file, 'utf8') }))
const stateSelectors = screenSheets.flatMap(({ css }) => stateFillSelectors(css))

// ---------------------------------------------------------------- forced colours

describe('forcedColors.css: the sheet itself', () => {
  it('reads a real sheet: one media block holding many rules', () => {
    expect(headsOutside(forcedCss, FORCED_QUERY)).toEqual([])
    expect(rulesInMedia(forcedCss, FORCED_QUERY).length).toBeGreaterThan(30)
  })

  it('uses system colours only, no box-shadow, and leads every selector with :root', () => {
    expect(auditForcedSheet(forcedCss)).toEqual([])
  })

  it('never uses forced-color-adjust: none (nothing keeps the amber look)', () => {
    expect(forcedCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/forced-color-adjust/)
  })

  it('draws the keyboard ring as a Highlight outline everywhere, HighlightText on a selected item', () => {
    const rules = rulesInMedia(forcedCss, FORCED_QUERY)
    const ring = rules.find((r) => r.selector === ':root :focus-visible')
    expect(ring?.decls.get('outline-color')).toBe('Highlight !important')
    const selectedRing = rules.find((r) => r.selector.includes(':root .tabs-top .tab[aria-selected="true"]:focus-visible'))
    expect(selectedRing?.decls.get('outline-color')).toBe('HighlightText !important')
    expect(selectedRing?.decls.get('outline-offset')).toBe('-2px')
  })

  it('gives buttons, tabs and fields a boundary that is left off while the keyboard ring is on', () => {
    const boundary = rulesInMedia(forcedCss, FORCED_QUERY).find((r) => r.decls.get('outline') === '1px solid ButtonText')
    expect(boundary?.selector).toMatch(/:is\(button, \[role="button"\], \[role="tab"\]/)
    expect(boundary?.selector).toMatch(/\):not\(\s*:focus-visible,/)
  })

  it('names every system colour it uses from the allowed list', () => {
    const words = new Set(forcedCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/\b[A-Z][A-Za-z]+\b/g) ?? [])
    for (const word of words) expect(SYSTEM_COLOURS, word).toContain(word)
  })

  it('born failing: the audit refuses a token, a literal, a box-shadow, an unled selector, a rule outside the query and a bare forced-color-adjust', () => {
    const planted = `
      .loose { color: CanvasText; }
      @media ${FORCED_QUERY} {
        :root .a { color: var(--focus); }
        :root .b { background-color: #FFA028; }
        :root .c { box-shadow: inset 2px 0 0 Highlight; }
        .d { color: CanvasText; }
        :root .e { forced-color-adjust: none; }
        :root .f { outline: 2px solid; }
        :root .g { border-color: red; }
      }`
    const problems = auditForcedSheet(planted).join('\n')
    expect(problems).toMatch(/\.loose: outside/)
    expect(problems).toMatch(/:root \.a \{ color \}: var\(--focus\) is not a system colour/)
    expect(problems).toMatch(/:root \.b \{ background-color \}: #FFA028 is not a system colour/)
    expect(problems).toMatch(/:root \.c \{ box-shadow \}/)
    expect(problems).toMatch(/\.d: not led by :root/)
    expect(problems).toMatch(/:root \.e: forced-color-adjust: none without/)
    expect(problems).toMatch(/:root \.f \{ outline \}: 2px solid names no system colour/)
    expect(problems).toMatch(/:root \.g \{ border-color \}: red is not a system colour/)
  })

  it('accepts forced-color-adjust: none where the rule supplies its own system text and fill', () => {
    const fine = `@media ${FORCED_QUERY} { :root .swatch { forced-color-adjust: none; color: CanvasText; background-color: Canvas; } }`
    expect(auditForcedSheet(fine)).toEqual([])
  })
})

describe('the MRET heat-scale ramp under forced colours', () => {
  // The ramp's fill is an inline linear-gradient, which forced colours drop unless the element opts out; its
  // stops are already system colours (readLiveChartTokens), so the key must opt out and carry a boundary.
  const echartsCss = fs.readFileSync(path.join(SRC, 'charts/echarts/echarts.css'), 'utf8')
  const optOut = (css: string, selector: string): boolean =>
    rulesInMedia(css, FORCED_QUERY).some((r) => r.selector.split(',').some((s) => s.trim() === selector) && r.decls.get('forced-color-adjust') === 'none')

  it('opts the ramp out of the forced repaint, as the steps are, so its gradient survives', () => {
    expect(optOut(echartsCss, '.echarts-scale-step')).toBe(true)
    expect(optOut(echartsCss, '.echarts-scale-ramp')).toBe(true)
  })

  it('draws a CanvasText boundary round the ramp, as round the steps', () => {
    const rules = rulesInMedia(forcedCss, FORCED_QUERY)
    for (const selector of [':root .echarts-scale-step', ':root .echarts-scale-ramp']) {
      const rule = rules.find((r) => r.selector.split(',').some((s) => s.trim() === selector))
      expect(rule?.decls.get('outline'), selector).toBe('1px solid CanvasText')
    }
  })
})

describe('forcedColors.css: every state drawn as a fill under src/ is answered', () => {
  it('scans a real set of sheets and finds the known states (a scan that finds nothing would pass anything)', () => {
    expect(screenSheets.length).toBeGreaterThan(40)
    expect(stateSelectors.length).toBeGreaterThanOrEqual(20)
    for (const known of [
      '.tabs-top .tab[aria-selected="true"]',
      '.nqt-grid tbody tr[aria-selected="true"] td',
      '.cmdline [cmdk-item][data-selected="true"]',
      '.frame-tab[aria-current="page"]',
      '.tear-table [data-highlight="true"] td',
      '.vcone-row-on',
    ]) {
      expect(stateSelectors, known).toContain(known)
    }
  })

  it('has a Highlight fill and a HighlightText ring for each one', () => {
    expect(missingForcedStates(stateSelectors, forcedCss)).toEqual([])
  })

  it('fills the cells of a selected row of the VCONE grid, whose opaque cell fill would otherwise cover the row', () => {
    const rule = /(?:^|\n)\s*([^{}]*:root \.vcone-row-on td[^{}]*)\{([^}]*)\}/.exec(forcedCss)
    expect(rule?.[1]).toContain(':root .vcone-row-on th')
    expect(rule?.[2]).toMatch(/background-color:\s*Highlight/)
    expect(rule?.[2]).toMatch(/color:\s*HighlightText/)
  })

  // A JOBS row is selected by View log and holds grey buttons (Open in RUN, Stop, Yes, Keep it). The theme repaints their
  // opaque fill as ButtonFace, not Highlight, so HighlightText on them would almost vanish in every Windows contrast theme.
  describe('the buttons inside a selected JOBS row keep their own text and fill pair', () => {
    const rules = rulesInMedia(forcedCss, FORCED_QUERY)
    const withSelector = (wanted: string) => rules.filter((r) => splitSelectorList(r.selector).map(normaliseSelector).includes(wanted))
    const ROW = ':root .live-table tbody tr.jobs-selected td'

    it('takes HighlightText for the row text only, never for a button with its own fill', () => {
      expect(withSelector(`${ROW} *`)).toEqual([])
      const text = withSelector(`${ROW} :not(button)`)
      expect(text).toHaveLength(1)
      expect(text[0]?.decls.get('color')).toBe('HighlightText')
    })

    it('gives the unpressed, enabled buttons ButtonText on ButtonFace (the pressed View log keeps the selection pair, a disabled one GrayText)', () => {
      const own = withSelector(`${ROW} button:not([aria-pressed="true"], :disabled)`)
      expect(own).toHaveLength(1)
      expect(own[0]?.decls.get('color')).toBe('ButtonText')
      expect(own[0]?.decls.get('background-color')).toBe('ButtonFace')
    })

    it('draws the keyboard ring of a button in a selected row in HighlightText, since Highlight would vanish on the row', () => {
      for (const ring of [`${ROW} button:focus-visible`, ':root .vcone-row-on button:focus-visible']) {
        const found = withSelector(ring)
        expect(found, ring).toHaveLength(1)
        expect(found[0]?.decls.get('outline-color'), ring).toBe('HighlightText !important')
      }
    })
  })

  it('born failing: a new screen rule that marks its selection by fill alone is reported', () => {
    const planted = stateFillSelectors('.new-pick[aria-pressed="true"] { background: var(--sel-list); }')
    expect(planted).toEqual(['.new-pick[aria-pressed="true"]'])
    expect(missingForcedStates(planted, forcedCss)).toEqual([
      '.new-pick[aria-pressed="true"]: no Highlight fill',
      '.new-pick[aria-pressed="true"]: no HighlightText ring',
    ])
  })

  it('reads a state by its attribute or its on-class, and skips hover, :not(), custom properties and text-only rules', () => {
    const css = `
      .a[aria-selected="true"], .a:hover { background: var(--x); }
      .b:not([aria-current="page"]) { background: var(--x); }
      .c[aria-pressed="true"] { --panel-maximised: 1; }
      .d[aria-pressed="true"] { font-weight: 700; }
      .e[data-highlight='true'] td { background: var(--x); }
      .f .row-held { box-shadow: inset 2px 0 0 var(--focus); }
      @media (max-width: 700px) { .g[aria-expanded="true"] { background-color: var(--x); } }`
    expect(stateFillSelectors(css).sort()).toEqual([
      '.a[aria-selected="true"]',
      '.e[data-highlight="true"] td',
      '.f .row-held',
      '.g[aria-expanded="true"]',
    ])
  })

  it('splits a selector list on its top-level commas only', () => {
    expect(splitSelectorList(':root :is(a, b):not(.c, .d),\n  :root .e')).toEqual([':root :is(a, b):not(.c, .d)', ':root .e'])
  })

  it('compares selectors with whitespace collapsed and quotes made double', () => {
    expect(normaliseSelector(".t  [data-x='true']\n td")).toBe('.t [data-x="true"] td')
  })
})

// ---------------------------------------------------------------- prefers-contrast: more

const LOOKS: readonly Look[] = ['standard', 'amber-classic']
const SCHEMES: readonly (CvdTheme | undefined)[] = [undefined, 'deut', 'prot']
const AAA = 7
const GRAPHIC = 3
const DARK_SURFACES = ['bg', 'raised', 'chrome', 'th-bg', 'sel-bg'] as const

const on = (fgs: readonly string[], bgs: readonly string[], min: number): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })))

/** Text lifted to 7:1 (WCAG 1.4.6) where it sits, and every rule and idle edge at 3:1 on its surface. */
const MORE_PAIRS: readonly ContrastPair[] = [
  ...on(['text', 'muted', 'link'], DARK_SURFACES, AAA),
  { fg: 'th-fg', bg: 'th-bg', min: AAA },
  { fg: 'tab-fg', bg: 'tab-bg', min: AAA },
  { fg: 'frame-tab-fg', bg: 'frame-tab-on', min: AAA },
  { fg: 'minibar-fg', bg: 'minibar-bg', min: AAA },
  { fg: 'muted-hover', bg: 'hover-cell', min: AAA },
  ...on(['border', 'border-int', 'th-rule', 'box-border', 'chrome-div'], ['bg', 'raised', 'chrome'], GRAPHIC),
  ...on(['chart-grid', 'zero-line', 'chart-year-div', 'spark-prior', 'cmd-border-idle', 'cmd-caret-idle'], ['bg'], GRAPHIC),
  { fg: 'frame-tab-edge', bg: 'frame-tab-on', min: GRAPHIC },
  ...on(['list-border', 'menu-border'], ['list-bg', 'raised', 'bg'], GRAPHIC),
  { fg: 'sb-thumb', bg: 'sb-track', min: GRAPHIC },
]

const baseTokens = (look: Look, cvd?: CvdTheme) => (look === 'amber-classic' ? readAmberClassicTokens(tokensCss, amberCss, cvd) : readTokens(tokensCss, cvd))

const scan = mergeScans(screenSheets.map(({ file, css }) => scanCssPairs(css, file)))
const writtenPairs = uniquePairs(scan.pairs.filter((p) => !p.inactive))

/** Tokens declared inside a data-cvd block of tokens.css: the colour-vision themes own these. */
const cvdOwned = new Set(
  [...tokensCss.matchAll(/\[data-cvd="(?:deut|prot)"\][^{]*\{([^}]*)\}/g)].flatMap((m) => [...(m[1] ?? '').matchAll(/--([a-z0-9-]+)\s*:/g)].map((d) => d[1]!)),
)

describe('contrastMore.css: structure', () => {
  it('applies only inside prefers-contrast: more, to the two looks', () => {
    expect(headsOutside(moreCss, MORE_QUERY)).toEqual([])
    expect(rulesInMedia(moreCss, MORE_QUERY).map((r) => r.selector)).toEqual([
      ':root:not([data-theme="amber-classic"])',
      ':root[data-theme="amber-classic"]',
    ])
  })

  it.each(LOOKS)('%s: sets only existing colour tokens, as 6-digit hex, outside the CVD-owned and fixed tokens', (look) => {
    const overrides = contrastMoreOverrides(moreCss, look)
    const known = readRawTokens(tokensCss)
    expect(Object.keys(overrides).length).toBeGreaterThan(10)
    expect(cvdOwned.size).toBeGreaterThan(5)
    for (const [name, value] of Object.entries(overrides)) {
      expect(value, `--${name}`).toMatch(/^#[0-9A-F]{6}$/)
      expect(known[name], `--${name} is a default token`).toBeDefined()
      expect(cvdOwned.has(name), `--${name} belongs to the colour-vision themes`).toBe(false)
      expect(FIXED_TOKENS, `--${name} is fixed`).not.toContain(name)
    }
    for (const rule of rulesInMedia(moreCss, MORE_QUERY)) {
      for (const prop of rule.decls.keys()) expect(prop, 'custom properties only').toMatch(/^--/)
    }
  })

  it.each(LOOKS)('%s: lifts every value it sets (more contrast on the black screen, never less)', (look) => {
    const base = baseTokens(look)
    for (const [name, value] of Object.entries(contrastMoreOverrides(moreCss, look))) {
      expect(contrastRatio(value, base.bg!), `--${name}`).toBeGreaterThan(contrastRatio(base[name]!, base.bg!))
    }
  })

  it('born failing: a value that is darker than the one it replaces is caught by the lift check', () => {
    const darker = moreCss.replace('--muted: #CCCCCC;', '--muted: #707070;')
    const base = baseTokens('standard')
    const muted = contrastMoreOverrides(darker, 'standard').muted!
    expect(contrastRatio(muted, base.bg!)).toBeLessThan(contrastRatio(base.muted!, base.bg!))
  })
})

describe.each(SCHEMES)('contrastMore.css: the pairs (colour scheme: %s)', (cvd) => {
  it.each(LOOKS)('%s: text at 7:1 and rules at 3:1', (look) => {
    const tokens = readContrastMoreTokens(sheetsIn, look, cvd)
    expect(auditContrast(tokens, MORE_PAIRS)).toEqual([])
  })

  it.each(LOOKS)('%s: every pair the stylesheets write still passes', (look) => {
    const tokens = readContrastMoreTokens(sheetsIn, look, cvd)
    expect(auditContrast(tokens, writtenPairs).map((f) => `${f.fg}/${f.bg}`)).toEqual([])
  })

  it.each(LOOKS)('%s: the look-spec pairs still pass', (look) => {
    const tokens = readContrastMoreTokens(sheetsIn, look, cvd)
    // As in the looks test: one default pair already fails on a colour scheme alone, outside this sheet.
    const known = cvd ? ['c-up/hover-cell'] : []
    expect(auditContrast(tokens, CONTRAST_PAIRS).map((f) => `${f.fg}/${f.bg}`)).toEqual(known)
    if (cvd) expect(auditContrast(tokens, CVD_PAIRS)).toEqual([])
    if (look === 'amber-classic') expect(auditContrast(tokens, AMBER_CLASSIC_PAIRS)).toEqual([])
  })
})

describe('contrastMore.css: the reader', () => {
  it('lays the look block over the look and leaves every other token as it was', () => {
    const more = readContrastMoreTokens(sheetsIn, 'standard')
    const base = readTokens(tokensCss)
    expect(more.muted).toBe('#CCCCCC')
    expect(more.data).toBe(base.data)
    expect(readContrastMoreTokens(sheetsIn, 'amber-classic').text).toBe('#FFD699')
  })

  it('born failing: the 7:1 audit catches a muted grey that only meets 4.5:1', () => {
    const weak = moreCss.replace('--muted: #CCCCCC;', '--muted: #8C8C8C;')
    const tokens = readContrastMoreTokens({ ...sheetsIn, moreCss: weak }, 'standard')
    expect(auditContrast(tokens, MORE_PAIRS)).toContainEqual(expect.objectContaining({ fg: 'muted', bg: 'bg' }))
  })
})

// ---------------------------------------------------------------- wiring and the default look

describe('index.css wiring', () => {
  const imports = [...indexCss.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1])

  it('imports both contrast sheets after the token and look sheets', () => {
    expect(imports).toContain('./contrastMore.css')
    expect(imports).toContain('./forcedColors.css')
    expect(imports.indexOf('./contrastMore.css')).toBeGreaterThan(imports.indexOf('./amberClassic.css'))
    expect(imports.indexOf('./forcedColors.css')).toBeGreaterThan(imports.indexOf('./tokens.css'))
  })

  it('leaves the default look alone: neither sheet holds a rule outside its media query', () => {
    expect(headsOutside(forcedCss, FORCED_QUERY)).toEqual([])
    expect(headsOutside(moreCss, MORE_QUERY)).toEqual([])
  })
})
