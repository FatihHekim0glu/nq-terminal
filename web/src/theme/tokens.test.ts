// Section 8.1 of the look spec in docs/: tokens.css carries every value of sections 2 and 3 exactly.
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import mainTsx from '../main.tsx?raw'
import packageJson from '../../package.json?raw'
import { readRawTokens, readTokens } from './contrast'

// Vitest stubs every stylesheet except tokens.css (vite.config.ts), so index.css is read from disk.
// The app tsconfig carries browser types only, so the two Node built-ins are typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const indexCss = fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8')

// Section 2.1 (existing tokens, new values) and 2.2 (new tokens), verbatim.
const COLOUR_TOKENS: Record<string, string> = {
  bg: '#000000',
  surface: '#000000',
  raised: '#1E1E1E',
  text: '#D7D7D7',
  data: '#FFA028',
  muted: '#A5A5A5',
  'accent-2': '#F06000',
  'c-up': '#51EE6C',
  'c-down': '#FF2C4A',
  'c-down-raised': '#FF5566',
  'c-down-hover': '#FF8A94',
  'cvd-up': '#3399FF',
  border: '#343434',
  'border-int': '#8C8C8C',
  'sel-bg': '#0C2B4A',
  fence: '#FFA028',
  'sec-equity': '#6CB6FF',
  'sec-rates': '#B39DFF',
  'sec-fx': '#38C7E8',
  'sec-energy': '#FF8A3D',
  'sec-metals': '#E0C060',
  'sec-grains': '#9CCC65',
  'sec-livestock': '#F48FB1',
  'sec-benchmark': '#8D9399',
  // Window chrome
  white: '#FFFFFF',
  chrome: '#191919',
  'chrome-rule': '#0A0A0A',
  'chrome-div': '#646464',
  'frame-bg': '#CDCDCD',
  'frame-fg': '#000000',
  'frame-tab-on': '#191919',
  'frame-tab-fg': '#D9DAD9',
  'frame-tab-edge': '#434343',
  'fn-bar': '#870F1E',
  'fn-fg': '#FFFFFF',
  'fn-hover': '#BB152E',
  'fn-press': '#770C1A',
  'fn-div': '#000000',
  'fn-edge': '#1E0306',
  'fn-off': '#4A0A12',
  // Command line
  'cmd-bg': '#000000',
  'cmd-border': '#148EFF',
  'cmd-border-idle': '#163A6B',
  'cmd-caret': '#2B8EFF',
  'cmd-caret-idle': '#003E9A',
  'cmd-cursor': '#328EFD',
  'cmd-cursor-dim': '#00307D',
  'ac-bg': '#1E1E1E',
  'msg-fg': '#FFFFFF',
  // Fields, lists, buttons
  'field-bg': '#FFA028',
  'field-fg': '#000000',
  'field-btn': '#3F3F3F',
  'field-off': '#A69785',
  'field-focus': '#3F85D2',
  'list-bg': '#1E1E1E',
  'list-border': '#B8B8B8',
  'list-sel': '#0F3A66',
  'th-bg': '#232323',
  'th-fg': '#D7D7D7',
  'th-rule': '#505050',
  'tab-bg': '#464646',
  'tab-fg': '#D7D7D7',
  'tab-on': '#9E9E9E',
  'tab-on-fg': '#000000',
  'tab-hover': '#CCCCCC',
  'sel-list': '#0D58A7',
  'sel-toggle': '#0051BA',
  'btn-top': '#333333',
  'btn-bot': '#191919',
  'btn-grey': '#404040',
  'hover-row': '#191919',
  'hover-cell': '#3C3C3C',
  'hover-menu': '#373737',
  focus: '#FFFFFF',
  link: '#53B2F5',
  'dialog-title': '#CBCBCB',
  'dialog-border': '#CBCDC8',
  'tip-bg': '#FFFFFF',
  'tip-border': '#3B3B3B',
  'tip-fg': '#1A1A1A',
  'datatip-bg': '#99CACB',
  // Scrollbars
  'sb-track': '#222222',
  'sb-track-list': '#131313',
  'sb-thumb': '#787878',
  'sb-arrow': '#FFFFFF',
  // Headers, tape, flags
  'legend-bg': '#0C0C0C',
  'cyan-name': '#40EDFF',
  'cyan-chart': '#89FFF1',
  marker: '#FFFF00',
  warn: '#FFE100',
  'flag-bg': '#870F1E',
  'flag-fg': '#FFFFFF',
  'key-cancel': '#FF425A',
  'key-go': '#18BD39',
  'key-sector': '#F0AF00',
  'key-panel': '#1DBBED',
  'tape-bg': '#001230',
  'tape-fg': '#FB9600',
  'tape-src': '#EA5D08',
  'tape-edit': '#001940',
  'bar-pos': '#00851C',
  'bar-neg': '#C31834',
  'bar-mag': '#0051BA',
  // Heat and tile scales
  'heat-up-2': '#51EE6C',
  'heat-up-1': '#39A74C',
  'heat-dn-1': '#BA152D',
  'heat-dn-2': '#FF1E3E',
  'corr-dn-2': '#6C0820',
  'corr-dn-1': '#390014',
  'corr-0': '#000000',
  'corr-up-1': '#002D09',
  'corr-up-2': '#005713',
  'corr-diag': '#4B4B4B',
  'mret-dn-floor': '#5E0A1D',
  'mret-dn-max': '#DE1831',
  'mret-up-floor': '#014D10',
  'mret-up-max': '#18BD39',
  'tile-up-1': '#004A0F',
  'tile-up-2': '#00821B',
  'tile-dn-1': '#7B0B23',
  'tile-dn-2': '#A1132D',
  // Charts (section 6)
  'chart-grid': '#505050',
  'chart-axis': '#FFFFFF',
  'chart-s1': '#FFFFFF',
  'chart-area': '#031D38',
  'chart-vol': '#7189AA',
  'chart-split-outer': '#242424',
  'chart-split-inner': '#484848',
  'chart-year-div': '#808080',
  'candle-up': '#FFFFFF',
  'candle-dn': '#0080FF',
  'last-line': '#F09000',
  'perf-pos': '#007219',
  'perf-neg': '#6A1020',
  'dist-curve': '#F79400',
  'roll-vol': '#00B5F7',
  'zero-line': '#848484',
  // Regime strip (LineStack context layer): one blue ramp, low to high volatility
  'regime-low': '#3A6EA5',
  'regime-mid': '#5FA8E8',
  'regime-high': '#CFE8FF',
}

// Aliases the spec defines by reference, not by value.
const ALIASES: Record<string, string> = {
  accent: 'var(--cmd-border)',
  exc: 'var(--c-down)',
}

// Section 3.2 plus the geometry of sections 2.1 and 4.
const SIZE_TOKENS: Record<string, string> = {
  'fs-data': '15px',
  'row-h': '20px',
  'fs-small': '11px',
  'fs-cmd': '15px',
  'fs-quote': '18px',
  'fs-kpi': '21px',
  'fs-title': '15px',
  'fs-nav': '13px',
  'fs-chart': '13px',
  'fs-fixed': '15px',
  'lh-fixed': '19px',
  'cmd-zone-h': '50px',
  'cmd-box-h': '22px',
  'status-h': '22px',
  'ptitle-h': '18px',
  'fn-h': '21px',
  'sb-w': '15px',
  'caret-phase': '1000ms',
}

const BANNED = ['#070A0E', '#94D53C', '#FFB000', '#063856', '#0B51A8']

describe('tokens.css: section 2 colours (8.1)', () => {
  const tokens = readTokens(tokensCss)
  const raw = readRawTokens(tokensCss)

  it('defines every colour token with its exact value', () => {
    for (const [name, value] of Object.entries(COLOUR_TOKENS)) {
      expect(tokens[name], `--${name}`).toBe(value)
    }
  })

  it('keeps --accent and --exc as aliases and resolves them', () => {
    for (const [name, value] of Object.entries(ALIASES)) {
      expect(raw[name], `--${name}`).toBe(value)
    }
    expect(tokens.accent).toBe('#148EFF')
    expect(tokens.exc).toBe('#FF2C4A')
  })

  it('dims a modal at half black', () => {
    expect(raw.dim?.replace(/\s+/g, '')).toBe('rgba(0,0,0,.5)')
  })

  it('uses no banned value anywhere in the file', () => {
    const upper = tokensCss.toUpperCase()
    for (const hex of BANNED) expect(upper, hex).not.toContain(hex)
  })

  it('has no oklch or alpha surface left from the old theme', () => {
    expect(tokensCss).not.toMatch(/oklch/i)
  })

  it('keeps the link-group chips off the lime and amber', () => {
    for (const name of ['link-a', 'link-b', 'link-c']) {
      expect(tokens[name], `--${name}`).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(tokens['link-a']).toBe('#66ABFF')
  })
})

describe('tokens.css: CVD themes (section 2.3)', () => {
  it('deut: blue up, #FF5566 down on every surface, amber unchanged', () => {
    const t = readTokens(tokensCss, 'deut')
    expect(t['c-up']).toBe('#3399FF')
    expect(t['c-down']).toBe('#FF5566')
    expect(t['c-down-raised']).toBe('#FF5566')
    expect(t['heat-up-2']).toBe('#6BCEFF')
    expect(t['heat-up-1']).toBe('#399CFF')
    expect(t.data).toBe('#FFA028')
    expect(t.exc).toBe('#FF5566')
    expect([t['bar-pos'], t['bar-neg'], t['perf-pos'], t['perf-neg']]).toEqual(['#2F80E0', '#D0485A', '#0F4C9A', '#6A1020'])
  })

  it('prot: blue up, orange down, amber swaps to #FEBA11', () => {
    const t = readTokens(tokensCss, 'prot')
    expect(t['c-up']).toBe('#3399FF')
    expect(t['c-down']).toBe('#FF7329')
    expect(t.data).toBe('#FEBA11')
    expect(t['field-bg']).toBe('#FEBA11')
    expect([t['bar-pos'], t['bar-neg'], t['perf-pos'], t['perf-neg']]).toEqual(['#2B7FE0', '#D5501A', '#0F4C9A', '#6B2A08'])
  })

  it('leaves the default theme untouched by the CVD blocks', () => {
    const t = readTokens(tokensCss)
    expect(t['c-up']).toBe('#51EE6C')
    expect(t.data).toBe('#FFA028')
    expect([t['bar-pos'], t['bar-neg']]).toEqual(['#00851C', '#C31834'])
  })

  it('keeps the regime ramp the same blue in both CVD themes', () => {
    for (const cvd of ['deut', 'prot'] as const) {
      const t = readTokens(tokensCss, cvd)
      expect([t['regime-low'], t['regime-mid'], t['regime-high']], cvd).toEqual(['#3A6EA5', '#5FA8E8', '#CFE8FF'])
    }
  })
})

describe('tokens.css: type, radii and geometry (sections 2.1 and 3)', () => {
  const raw = readRawTokens(tokensCss)

  it('sets every size token', () => {
    for (const [name, value] of Object.entries(SIZE_TOKENS)) {
      expect(raw[name], `--${name}`).toBe(value)
    }
  })

  it('makes every radius 0', () => {
    for (const name of ['r-sm', 'r-md', 'r-lg']) expect(raw[name], `--${name}`).toBe('0')
  })

  it('starts the sans stack with Bergoom, then Source Sans 3', () => {
    expect(raw['font-sans']).toBe('"Bergoom", "Source Sans 3", system-ui, sans-serif')
  })

  it('uses PT Mono for fixed-grid content', () => {
    expect(raw['font-mono']).toBe('"PT Mono", ui-monospace, monospace')
  })

  it('drops the display face and the replaced heights', () => {
    for (const name of ['font-display', 'cmd-h', 'panel-head-h']) {
      expect(raw[name], `--${name}`).toBeUndefined()
    }
    expect(tokensCss).not.toMatch(/Inter|Space Grotesk|JetBrains/)
  })
})

describe('index.css: type rules (section 3)', () => {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')

  it('deletes the uppercase eyebrow and the display class', () => {
    expect(css).not.toMatch(/\.eyebrow\b/)
    expect(css).not.toMatch(/\.disp\b/)
    expect(css).not.toMatch(/text-transform\s*:\s*uppercase/)
  })

  it('removes the zero, cv05 and ss01 font features', () => {
    expect(css).not.toMatch(/'zero'|"zero"/)
    expect(css).not.toMatch(/cv05|ss01/)
  })

  it('sets the body at 15px in the sans stack', () => {
    const body = /(?:^|\n)body\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(body).toMatch(/font-size\s*:\s*var\(--fs-data\)/)
    expect(body).toMatch(/font-family\s*:\s*var\(--font-sans\)/)
    expect(body).toMatch(/background(-color)?\s*:\s*var\(--bg\)/)
    expect(body).toMatch(/letter-spacing\s*:\s*0/)
  })

  it('selects text in the selection navy with --text', () => {
    const sel = /::selection\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(sel).toMatch(/background(-color)?\s*:\s*var\(--sel-bg\)/)
    expect(sel).toMatch(/(?:^|[\s;])color\s*:\s*var\(--text\)/)
  })

  it('draws the keyboard focus ring in 2px --focus', () => {
    const focus = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(focus).toMatch(/outline\s*:\s*2px solid var\(--focus\)/)
  })

  it('keeps numbers tabular without the zero feature', () => {
    expect(css).toMatch(/font-variant-numeric\s*:\s*tabular-nums lining-nums/)
  })

  it('declares the five vendored Bergoom faces', () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '')
    const bergoom = faces.filter((f) => /font-family\s*:\s*"Bergoom"/.test(f))
    const files = bergoom.map((f) => /url\("?\.\.\/assets\/fonts\/bergoom\/([^")]+)"?\)/.exec(f)?.[1]).sort()
    expect(files).toEqual([
      'Bergoom-Bold.woff2',
      'Bergoom-BoldItalic.woff2',
      'Bergoom-Italic.woff2',
      'Bergoom-Regular.woff2',
      'Bergoom-Semibold.woff2',
    ])
    for (const f of bergoom) expect(f).toMatch(/font-display\s*:\s*swap/)
  })

  it('writes no colour literal: every colour comes from a token', () => {
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch)\(/i)
  })

  it('never transitions a colour or background (8.5 e)', () => {
    for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
      expect(m[1]).toMatch(/^\s*(none|opacity|transform)\b/)
    }
  })
})

describe('font packages (section 3.1)', () => {
  const pkg = JSON.parse(packageJson) as { dependencies: Record<string, string> }

  it('pins the two OFL fallbacks exactly', () => {
    expect(pkg.dependencies['@fontsource/source-sans-3']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.dependencies['@fontsource/pt-mono']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('removes Inter, Space Grotesk and JetBrains Mono', () => {
    for (const name of ['@fontsource/inter', '@fontsource/space-grotesk', '@fontsource/jetbrains-mono']) {
      expect(pkg.dependencies[name], name).toBeUndefined()
      expect(mainTsx).not.toContain(name)
    }
  })

  it('imports only the weights the spec uses: 400 and 700, plus italics, and PT Mono 400', () => {
    const imports = [...mainTsx.matchAll(/import '(@fontsource\/[^']+)'/g)].map((m) => m[1]).sort()
    expect(imports).toEqual([
      '@fontsource/pt-mono/latin-400.css',
      '@fontsource/source-sans-3/latin-400-italic.css',
      '@fontsource/source-sans-3/latin-400.css',
      '@fontsource/source-sans-3/latin-700-italic.css',
      '@fontsource/source-sans-3/latin-700.css',
    ])
  })

  it('ships the Bergoom licence with the build (OFL condition 2)', () => {
    expect(mainTsx).toContain("import './assets/fonts/bergoom/LICENSE.md?url'")
  })
})

describe('favicon (8.1, 8.5 d)', () => {
  const svg = fs.readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
  const fills = [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase())
  const tokenValues = new Set(Object.values(readRawTokens(tokensCss)).map((v) => v.toUpperCase()))

  it('uses no banned pre-flat-black value', () => {
    for (const banned of ['#070A0E', '#94D53C', '#FFB000', '#063856', '#0B51A8']) expect(fills).not.toContain(banned)
  })

  it('draws only token colours, with square corners', () => {
    expect(fills.length).toBeGreaterThan(0)
    for (const f of fills) expect(tokenValues.has(f), f).toBe(true)
    expect(svg).not.toMatch(/\brx=/)
  })
})
