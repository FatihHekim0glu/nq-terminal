// print.css: the stylesheet of the print dossier (roadmap 15 part 3). Vitest stubs every stylesheet outside
// its css.include list (vite.config.ts), so the file is read from disk with the Node built-in, as
// theme/tokens.test.ts reads index.css. The rules pinned here: the screen never sees the print root; in
// print media only the root shows, on a named A4 landscape page (@page dossier, so an ordinary print of the
// terminal keeps its own page), with the evidence on a new page; every colour is a
// token; every custom property is one tokens.css defines; nothing loads; nothing outside the dossier's own
// class names is styled; and only run.tsx imports the file, so it loads with the lazy chunk and never with the shell.
import { describe, expect, it } from 'vitest'
import { readRawTokens } from '../../theme/contrast'
import tokensCss from '../../theme/tokens.css?raw'

// The app tsconfig carries browser types only, so the Node built-in is typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const css = fs.readFileSync(new URL('./print.css', import.meta.url), 'utf8')
const runSource = fs.readFileSync(new URL('./run.tsx', import.meta.url), 'utf8')

const TOKENS = readRawTokens(tokensCss)

const bare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The text inside `@media print { ... }` and the sheet without that block. */
function splitPrint(source: string): { inner: string; outer: string } {
  const text = bare(source)
  const at = text.indexOf('@media print')
  if (at < 0) return { inner: '', outer: text }
  const open = text.indexOf('{', at)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return { inner: text.slice(open + 1, i), outer: text.slice(0, at) + text.slice(i + 1) }
    }
  }
  throw new Error('@media print is not closed')
}

const { inner, outer } = splitPrint(css)

/** The body of the first rule whose selector list contains `selector` (as text), or '' when there is none. */
function ruleBody(scope: string, selector: string): string {
  const rules = [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const rule of rules) {
    const list = (rule[1] ?? '').split(',').map((s) => squash(s))
    if (list.includes(selector)) return rule[2] ?? ''
  }
  return ''
}

describe('print.css: the screen', () => {
  it('reads a stylesheet with a print block', () => {
    expect(css.length).toBeGreaterThan(200)
    expect(inner.length).toBeGreaterThan(200)
    expect(css.match(/@media print/g)).toHaveLength(1)
  })

  it('hides the print root outside print media, and that is the only rule outside them', () => {
    expect(squash(outer)).toBe('#nqt-print-root { display: none; }')
  })

  it('shows the print root in print media', () => {
    expect(ruleBody(inner, '#nqt-print-root')).toMatch(/display:\s*block\s*;/)
  })

  it('relies on no hidden attribute: the Tailwind base hides [hidden] with an important rule in a cascade layer, which nothing here can beat', () => {
    expect(bare(runSource)).not.toMatch(/\.hidden\s*=|setAttribute\(\s*['"]hidden['"]|\bhidden\s*=\s*\{?\s*true/)
  })
})

describe('print.css: the page', () => {
  it('sets an A4 landscape page with a 10mm margin on a named page, and no unnamed page rule', () => {
    // An unnamed @page cannot be scoped, so it would make every later ordinary print of the terminal A4 landscape.
    expect(bare(css)).not.toMatch(/@page\s*\{/)
    expect(inner).not.toMatch(/@page\s*\{/)
    expect(inner).toMatch(/@page\s+dossier\s*\{[^}]*size:\s*A4 landscape/)
    expect(inner).toMatch(/@page\s+dossier\s*\{[^}]*margin:\s*10mm/)
    // Only the print root is on that page; it is what makes the page's size apply, and only in print media.
    expect(ruleBody(inner, '#nqt-print-root')).toMatch(/page:\s*dossier\s*;/)
    expect(outer).not.toMatch(/\bpage:/)
  })

  it('starts the evidence on a new page', () => {
    expect(ruleBody(inner, '.prt-evidence')).toMatch(/break-before:\s*page/)
  })

  it('keeps a chart in one piece and lays the charts out two across', () => {
    expect(ruleBody(inner, '.prt-figure')).toMatch(/break-inside:\s*avoid/)
    expect(ruleBody(inner, '.prt-figure-grid')).toMatch(/display:\s*grid/)
    expect(ruleBody(inner, '.prt-figure-grid')).toMatch(/grid-template-columns:\s*1fr 1fr/)
  })

  it('keeps a table row together, and a heading and its note with what follows them', () => {
    expect(inner).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/)
    expect(inner).toMatch(/h2\s*\{[^}]*break-after:\s*avoid/)
    expect(ruleBody(inner, '.prt-muted')).toMatch(/break-after:\s*avoid/)
  })

  it('lets the page grow past one screen: the app pins html, body and #root to the window height', () => {
    const body = ruleBody(inner, 'html:has(#nqt-print-root)') + ruleBody(inner, 'body:has(> #nqt-print-root)')
    expect(body).toMatch(/height:\s*auto/)
    expect(body).toMatch(/overflow:\s*visible/)
  })

  it('takes the light colour scheme, or the page margin of the dark app is printed dark', () => {
    expect(ruleBody(inner, 'html:has(#nqt-print-root)')).toMatch(/color-scheme:\s*light/)
  })
})

describe('print.css: nothing else prints while the dossier does', () => {
  const hider = [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => /:not\(#nqt-print-root\)/.test(m[1] ?? ''))

  it('hides everything else on the page', () => {
    expect(hider).toBeDefined()
    expect(hider?.[2]).toMatch(/display:\s*none\s*!important/)
  })

  it('does so only while the print root exists, so an ordinary print of the app is not blanked once this file has loaded', () => {
    expect(squash(hider?.[1] ?? '')).toBe('body:has(> #nqt-print-root) > :not(#nqt-print-root)')
  })

  it('paints the page white and the text black with the print tokens, in light colours whatever the screen theme', () => {
    const root = ruleBody(inner, '#nqt-print-root')
    expect(root).toMatch(/color:\s*var\(--print-fg\)/)
    expect(root).toMatch(/background:\s*var\(--print-bg\)/)
    const page = ruleBody(inner, 'html:has(#nqt-print-root)') + ruleBody(inner, 'body:has(> #nqt-print-root)')
    expect(page).toMatch(/background:\s*var\(--print-bg\)/)
  })

  it('sets the text in the sans font at 9.5pt and the quoted text in the mono font', () => {
    const root = ruleBody(inner, '#nqt-print-root')
    expect(root).toMatch(/font-family:\s*var\(--font-sans\)/)
    expect(root).toMatch(/font-size:\s*9\.5pt/)
    expect(ruleBody(inner, '.prt-pre')).toMatch(/font-family:\s*var\(--font-mono\)/)
  })
})

describe('print.css: tokens only', () => {
  it('writes no colour literal', () => {
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/i)
  })

  it('reads every custom property from tokens.css', () => {
    const used = [...new Set([...css.matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map((m) => m[1] ?? ''))]
    expect(used.length).toBeGreaterThan(3)
    expect(used).toEqual(expect.arrayContaining(['print-bg', 'print-fg', 'print-muted', 'print-rule', 'print-label', 'font-sans', 'font-mono']))
    for (const name of used) expect(TOKENS[name], `--${name} is not defined in tokens.css`).toBeDefined()
  })

  it('declares no custom property of its own', () => {
    expect(bare(css)).not.toMatch(/(^|[;{\s])--[a-z0-9-]+\s*:/i)
  })

  it('takes each colour, background and border colour from a var() or a plain keyword', () => {
    const declarations = [...bare(css).matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)]
    const colourish = declarations.filter(([, prop]) => /^(color|background(-color)?|border(-[a-z]+)?|outline(-[a-z]+)?|text-decoration(-color)?|fill|stroke)$/.test(prop ?? ''))
    expect(colourish.length).toBeGreaterThan(4)
    for (const [, prop, value] of colourish) {
      const rest = (value ?? '').replace(/var\(--[a-z0-9-]+\)/g, '').replace(/[0-9.]+(px|mm|pt|em|rem|%)?/g, '')
      expect(rest.replace(/\b(solid|dashed|dotted|none|hidden|transparent|inherit|initial|currentcolor|thin|medium|underline|collapse|separate)\b/gi, '').trim(), `${prop}: ${value}`).toBe('')
    }
  })

  it('has square corners and no motion', () => {
    expect(inner).toMatch(/border-radius:\s*0\b/)
    expect(inner).toMatch(/animation:\s*none/)
    expect(inner).toMatch(/transition:\s*none/)
    expect(css).not.toMatch(/@keyframes/)
  })
})

describe('print.css: it loads nothing and touches nothing of the app', () => {
  it('imports no file and fetches no font, image or script', () => {
    expect(bare(css)).not.toMatch(/@import|@font-face|url\(|image-set\(|expression\(/i)
  })

  it('styles only its own root and its own prt- class names', () => {
    const preludes = [...bare(css).matchAll(/([^{}]+)\{/g)].map((m) => m[1] ?? '').filter((p) => !p.trim().startsWith('@'))
    expect(preludes.length).toBeGreaterThan(10)
    const classes = new Set(preludes.flatMap((p) => [...p.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1] ?? '')))
    expect(classes.size).toBeGreaterThan(5)
    for (const name of classes) expect(name, `.${name}`).toMatch(/^prt(-|$)/)
    const ids = new Set(preludes.flatMap((p) => [...p.matchAll(/#([A-Za-z_][\w-]*)/g)].map((m) => m[1] ?? '')))
    expect([...ids]).toEqual(['nqt-print-root'])
  })

  it('does not restyle bare elements outside the dossier, other than the page itself (html and body)', () => {
    const preludes = [...inner.matchAll(/([^{}]+)\{/g)].map((m) => squash(m[1] ?? '')).filter((p) => !p.startsWith('@'))
    for (const prelude of preludes) {
      for (const selector of prelude.split(',').map((s) => s.trim())) {
        const scoped = selector.includes('#nqt-print-root') || /\.prt(-|\b)/.test(selector)
        expect(scoped, `unscoped selector: ${selector}`).toBe(true)
      }
    }
  })
})

describe('print.css: it loads with the lazy chunk and never with the shell', () => {
  const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  it('is imported by run.tsx', () => {
    expect(runSource).toMatch(/^import '\.\/print\.css'/m)
  })

  it('is imported by no other file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    const importers = Object.entries(SOURCES)
      .filter(([, text]) => /^import\b[^\n]*['"][^'"\n]*print\.css['"]/m.test(text))
      .map(([file]) => file)
    expect(importers).toEqual(['/src/export/print/run.tsx'])
  })
})
