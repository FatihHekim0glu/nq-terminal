// Both looks, every pair (TASKS Phase 12): the standard look and amber-classic, each alone and with the
// deuteranopia and protanomaly schemes, are measured on three sets of pairs:
//   1. the default look-spec pairs (CONTRAST_PAIRS and CVD_PAIRS),
//   2. the amber pairs written by hand (AMBER_CLASSIC_PAIRS), and
//   3. the pairs the stylesheets actually write: every rule under src/ that sets a text colour and a fill
//      from tokens (src/theme/cssPairs.ts), so a screen added after the theme is checked without anyone
//      listing it. Disabled controls are exempt from the text minimum (WCAG 1.4.3) and are listed apart.
// The print tokens and the regime ramp must come out of the amber block untouched.
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import {
  COMPONENT_MIN,
  CONTRAST_PAIRS,
  CVD_PAIRS,
  TEXT_MIN,
  auditContrast,
  contrastRatio,
  readTokens,
  type CvdTheme,
} from './contrast'
import {
  AMBER_CLASSIC_PAIRS,
  FIXED_TOKENS,
  auditAmberClassicStructure,
  readAmberClassicTokens,
} from './amberClassic'
import { mergeScans, scanCssPairs, uniquePairs } from './cssPairs'

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
  resolve(...parts: string[]): string
  dirname(p: string): string
}
const url = builtins.getBuiltinModule('node:url') as { fileURLToPath(u: string | URL): string }

const SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const amberCss = fs.readFileSync(new URL('./amberClassic.css', import.meta.url), 'utf8')
/** The token sheets are the values, not users of them. */
const TOKEN_SHEETS = /(?:^|[\\/])(?:tokens|amberClassic)\.css$/

function sheets(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sheets(full)
    return entry.name.endsWith('.css') && !TOKEN_SHEETS.test(full) ? [full] : []
  })
}

const files = sheets(SRC)
const scan = mergeScans(files.map((f) => scanCssPairs(fs.readFileSync(f, 'utf8'), path.relative(SRC, f).replaceAll('\\', '/'))))
const active = uniquePairs(scan.pairs.filter((p) => !p.inactive))
const inactive = uniquePairs(scan.pairs.filter((p) => p.inactive))

type Scheme = CvdTheme | undefined
const SCHEMES: readonly Scheme[] = [undefined, 'deut', 'prot']
const label = (look: string, cvd: Scheme) => (cvd ? `${look} + ${cvd}` : look)
const looks = (cvd: Scheme) => [
  { name: label('standard', cvd), tokens: readTokens(tokensCss, cvd) },
  { name: label('amber-classic', cvd), tokens: readAmberClassicTokens(tokensCss, amberCss, cvd) },
]

describe('the stylesheet scan', () => {
  it('finds the sheets and a real set of pairs (a scanner that finds nothing would pass anything)', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(active.length).toBeGreaterThan(40)
    expect(scan.fills.length).toBeGreaterThan(80)
    for (const must of ['chrome/FunctionBar.css', 'chrome/TabStrip.css', 'chrome/FrameStrip.css', 'chrome/Field.css']) {
      expect(files.map((f) => path.relative(SRC, f).replaceAll('\\', '/')), must).toContain(must)
    }
    const names = new Set(active.map((p) => `${p.fg}/${p.bg}`))
    for (const pair of ['fn-fg/fn-bar', 'tab-fg/tab-bg', 'tab-on-fg/tab-on', 'frame-tab-fg/frame-tab-on']) {
      expect(names.has(pair), pair).toBe(true)
    }
  })

  it('lists the disabled controls apart, and none is worse in amber-classic than in the standard look', () => {
    expect(inactive.map((p) => `${p.selector.replace(/\s+/g, ' ')}: ${p.fg}/${p.bg}`).sort()).toEqual([
      '.field:disabled, .field[aria-disabled="true"]: field-fg/field-off',
      '.fn-btn[aria-disabled="true"]: fn-off/fn-bar',
      '.gp-btn[aria-disabled="true"]: muted/bg',
    ])
    const [standard, amber] = looks(undefined)
    for (const p of inactive) {
      const ratio = (t: Record<string, string>) => contrastRatio(t[p.fg]!, t[p.bg]!)
      expect(ratio(amber!.tokens), `${p.fg}/${p.bg}`).toBeGreaterThanOrEqual(Math.min(ratio(standard!.tokens), p.min))
    }
  })
})

describe.each(SCHEMES)('every pair in both looks (colour scheme: %s)', (cvd) => {
  it.each(looks(cvd).map((l) => [l.name, l.tokens] as const))('%s: the pairs the stylesheets write', (_name, tokens) => {
    const failures = auditContrast(tokens, active).map((f) => {
      const rule = active.find((p) => p.fg === f.fg && p.bg === f.bg)
      return `${f.fg}/${f.bg} ${f.ratio?.toFixed(2) ?? 'missing'} < ${f.min} (${rule?.source}: ${rule?.selector})`
    })
    expect(failures).toEqual([])
  })

  it.each(looks(cvd).map((l) => [l.name, l.tokens] as const))('%s: the look-spec pairs', (_name, tokens) => {
    // One default pair already fails on a colour scheme alone, outside this theme: --c-up on --hover-cell.
    const known = cvd ? ['c-up/hover-cell'] : []
    expect(auditContrast(tokens, CONTRAST_PAIRS).map((f) => `${f.fg}/${f.bg}`)).toEqual(known)
    if (cvd) expect(auditContrast(tokens, CVD_PAIRS)).toEqual([])
  })

  it('amber-classic: the hand-written amber pairs', () => {
    const amber = looks(cvd)[1]!
    expect(auditContrast(amber.tokens, AMBER_CLASSIC_PAIRS)).toEqual([])
  })
})

describe('the amber pair list covers the strip, the tabs and the function bar', () => {
  const has = (fg: string, bg: string, min: number) => AMBER_CLASSIC_PAIRS.some((p) => p.fg === fg && p.bg === bg && p.min === min)

  it('checks the strip text on a hovered frame tab, as text and as the 3:1 focus ring', () => {
    expect(has('frame-fg', 'tab-on', TEXT_MIN)).toBe(true)
    expect(has('frame-fg', 'tab-on', COMPONENT_MIN)).toBe(true)
    expect(has('frame-fg', 'frame-bg', TEXT_MIN)).toBe(true)
  })

  it('checks the frame strip fills the look chooser sits on', () => {
    for (const bg of ['list-bg', 'list-sel', 'hover-menu']) expect(has('data', bg, TEXT_MIN), `data on ${bg}`).toBe(true)
    expect(has('white', 'sel-list', TEXT_MIN)).toBe(true)
    expect(has('white', 'sel-toggle', TEXT_MIN)).toBe(true)
  })

  it('checks every amber-changed text token against the fills the stylesheets put it on', () => {
    // Each (fg, bg) a rule writes where fg is one amber-classic changes is also a hand-listed pair, so a
    // change to the block is checked even if the scan is not run.
    const changed = new Set(['text', 'muted', 'muted-hover', 'th-fg', 'tab-fg', 'frame-tab-fg', 'minibar-fg', 'msg-fg', 'chart-axis', 'fn-fg', 'tab-on-fg'])
    const missing = active
      .filter((p) => changed.has(p.fg))
      .filter((p) => !AMBER_CLASSIC_PAIRS.some((a) => a.fg === p.fg && a.bg === p.bg && a.min >= p.min))
      .map((p) => `${p.fg}/${p.bg} (${p.source}: ${p.selector})`)
    expect(missing).toEqual([])
  })
})

describe('the tokens the amber block must leave alone', () => {
  it('names the print palette and the regime ramp as fixed', () => {
    expect(FIXED_TOKENS).toEqual(
      expect.arrayContaining(['print-bg', 'print-fg', 'print-muted', 'print-rule', 'print-label', 'regime-low', 'regime-mid', 'regime-high']),
    )
  })

  it('leaves each of them at its default value (the evidence pack reads the print five from the live page)', () => {
    const base = readTokens(tokensCss)
    const amber = readAmberClassicTokens(tokensCss, amberCss)
    for (const name of FIXED_TOKENS) {
      expect(base[name], `--${name} exists`).toBeDefined()
      expect(amber[name], `--${name}`).toBe(base[name])
    }
  })

  it('keeps the evidence pack black on white and the regime ramp 3:1 on the black screen in amber-classic', () => {
    const amber = readAmberClassicTokens(tokensCss, amberCss)
    for (const fg of ['print-fg', 'print-muted', 'print-label']) {
      expect(contrastRatio(amber[fg]!, amber['print-bg']!), fg).toBeGreaterThanOrEqual(TEXT_MIN)
    }
    for (const fg of ['regime-low', 'regime-mid', 'regime-high']) {
      expect(contrastRatio(amber[fg]!, amber.bg!), fg).toBeGreaterThanOrEqual(COMPONENT_MIN)
    }
  })

  it('born failing: the structure audit refuses a print token or a regime step in the amber block', () => {
    for (const name of ['print-fg', 'print-bg', 'regime-mid']) {
      const broken = amberCss.replace(/\}\s*$/, `  --${name}: #FFA028;\n}\n`)
      expect(auditAmberClassicStructure(tokensCss, broken), name).toContainEqual(expect.stringMatching(new RegExp(`--${name}.*fixed`)))
    }
    expect(auditAmberClassicStructure(tokensCss, amberCss)).toEqual([])
  })
})

describe('born-failing cases: the scan rejects what it must', () => {
  const swap = (name: string, value: string): string => {
    const pattern = new RegExp(`(--${name}\\s*:\\s*)#[0-9A-Fa-f]{6}`)
    expect(pattern.test(amberCss), `--${name} present`).toBe(true)
    return amberCss.replace(pattern, `$1${value}`)
  }

  it('fails a table header colour that is too dark on the header fill (th-fg on th-bg)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap('th-fg', '#7A4A00'))
    expect(auditContrast(broken, active)).toContainEqual(expect.objectContaining({ fg: 'th-fg', bg: 'th-bg' }))
  })

  it('fails a selected tab whose black text sits on a too-dark amber (tab-on-fg on tab-on)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap('tab-on', '#3A2A10'))
    expect(auditContrast(broken, active)).toContainEqual(expect.objectContaining({ fg: 'tab-on-fg', bg: 'tab-on' }))
  })

  it('fails a function bar fill too bright for its white title (fn-fg on fn-bar)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap('fn-bar', '#FFA028'))
    expect(auditContrast(broken, active)).toContainEqual(expect.objectContaining({ fg: 'fn-fg', bg: 'fn-bar' }))
  })

  it('fails a text colour that was meant for a hovered frame tab but is too close to it', () => {
    const broken = readAmberClassicTokens(tokensCss, swap('tab-on', '#222222'))
    expect(auditContrast(broken, AMBER_CLASSIC_PAIRS)).toContainEqual(expect.objectContaining({ fg: 'frame-fg', bg: 'tab-on' }))
  })

  it('a planted rule with a failing pair is caught by the same audit', () => {
    const planted = mergeScans([scanCssPairs('.new-screen { color: var(--muted); background: var(--print-bg); }', 'planted.css')])
    const amber = readAmberClassicTokens(tokensCss, amberCss)
    expect(auditContrast(amber, planted.pairs)).toContainEqual(expect.objectContaining({ fg: 'muted', bg: 'print-bg' }))
  })
})
