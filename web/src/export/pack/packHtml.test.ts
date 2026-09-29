// @vitest-environment jsdom
// packHtml: the evidence pack as one self-contained HTML string (roadmap 15 part 2). The tests pin the
// safety of the file (a CSP that allows nothing but data images and inline style, no script, no event
// attribute, no web address, every string escaped, every image re-checked), the palette (read from the
// print tokens and validated as text, never trusted), and the layout (header, series, story, charts,
// evidence, sources, footer). The file is parsed back with a DOM parser, so escaping is judged by what a
// browser makes of it, not by string matching.
import { describe, expect, it } from 'vitest'
import { DOSSIER } from '../../copy/dossier'
import { readRawTokens } from '../../theme/contrast'
import tokensCss from '../../theme/tokens.css?raw'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { buildDossier } from '../dossier/dossierModel'
import type { Dossier, DossierContext, DossierFigure } from '../dossier/types'
import { PNG_DATA_URL } from '../prepare'
import { PACK_CSP, escapeHtml, readPackPalette, renderPackHtml, type PackPalette } from './packHtml'

const TOKENS = readRawTokens(tokensCss)

/** A style that answers like getComputedStyle(document.documentElement) does for the tokens in tokens.css. */
function styleOf(over: Readonly<Record<string, string>> = {}): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
  return { getPropertyValue: (name: string) => over[name] ?? TOKENS[name.replace(/^--/, '')] ?? '' }
}

const PALETTE: PackPalette = readPackPalette(styleOf())

// A 1 x 1 png, so the data URLs below are real ones.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const FIGURE: DossierFigure = { dataUrl: PIXEL, summary: 'Equity curve, 39 sessions, ends at 1.04.', width: 640, height: 320 }

const HOSTILE = '"><img src=x onerror=alert(1)><script>alert(2)</script> & \'quoted\''

const BASE: Dossier = {
  title: 'volmanaged_v0: tear sheet dossier',
  subtitle: 'Volatility managed, daily',
  flags: ['[POST HOC]', 'DEMO DATA'],
  meta: [['Basis', 'A: screen'], ['Unit', 'return per session']],
  story: [
    {
      kind: 'table',
      id: 'kpis',
      title: 'Key figures',
      note: '[POST HOC] Basis A.',
      columns: ['Measure', 'Value', 'Unit', 'Basis', 'Tag', 'Note'],
      rows: [['Sharpe', '1.20', 'ratio', 'A', '[POST HOC]', '']],
    },
    { kind: 'text', id: 'hypothesis', title: 'Hypothesis', lines: ['First line.', 'Second line.'], verbatim: false },
  ],
  evidence: [
    { kind: 'text', id: 'passBar', title: 'Pass bar', lines: ['  indented', 'kept as written'], verbatim: true },
  ],
  sources: ['GET /api/analytics/hypothesis/volmanaged_v0?cost=1'],
  footer: ['Descriptive: no verdict.', 'Made 14:02 ET.'],
}

const HOSTILE_DOSSIER: Dossier = {
  title: HOSTILE,
  subtitle: `sub ${HOSTILE}`,
  flags: [`flag ${HOSTILE}`],
  meta: [[`label ${HOSTILE}`, `value ${HOSTILE}`]],
  story: [
    {
      kind: 'table',
      id: `t${HOSTILE}`,
      title: `table ${HOSTILE}`,
      note: `note ${HOSTILE}`,
      columns: [`col ${HOSTILE}`, 'B'],
      rows: [[`cell ${HOSTILE}`, 'b']],
    },
    { kind: 'text', id: 'x', title: `text ${HOSTILE}`, lines: [`line ${HOSTILE}`], verbatim: false },
  ],
  evidence: [{ kind: 'text', id: 'y', title: 'Quoted', lines: [`verbatim ${HOSTILE}`, 'next'], verbatim: true }],
  sources: [`source ${HOSTILE}`],
  footer: [`footer ${HOSTILE}`],
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

const render = (d: Dossier = BASE, figures: readonly DossierFigure[] = [FIGURE], p: PackPalette = PALETTE) => renderPackHtml(d, figures, p)

// ---------------------------------------------------------------- escapeHtml

describe('escapeHtml', () => {
  it('escapes ampersand, less than, greater than, double quote and single quote', () => {
    expect(escapeHtml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &#39;')
  })

  it('escapes the ampersand first, so nothing is escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;')
  })

  it('leaves plain text, unicode and emoji as they are', () => {
    expect(escapeHtml('')).toBe('')
    expect(escapeHtml('Sharpe 1.20, ratio')).toBe('Sharpe 1.20, ratio')
    expect(escapeHtml('naïve café 日本語 📈')).toBe('naïve café 日本語 📈')
  })

  it('leaves no character that could open a tag or close an attribute', () => {
    expect(escapeHtml(HOSTILE)).not.toMatch(/[<>"']/)
  })
})

// ---------------------------------------------------------------- the palette

describe('readPackPalette', () => {
  it('reads the five print tokens and the two font stacks from the style', () => {
    expect(PALETTE).toEqual({
      bg: '#FFFFFF',
      fg: '#000000',
      muted: '#4D4D4D',
      rule: '#8C8C8C',
      label: '#8A4B00',
      fontSans: '"Bergoom", "Source Sans 3", system-ui, sans-serif',
      fontMono: '"PT Mono", ui-monospace, monospace',
    })
  })

  it('trims the white space a custom property carries', () => {
    const palette = readPackPalette(styleOf({ '--print-bg': '  #FFFFFF\n', '--font-mono': ' monospace ' }))
    expect(palette.bg).toBe('#FFFFFF')
    expect(palette.fontMono).toBe('monospace')
  })

  it('accepts lower case hex digits', () => {
    expect(readPackPalette(styleOf({ '--print-fg': '#0a0b0c' })).fg).toBe('#0a0b0c')
  })

  // The production stylesheet is minified, and the browser then reports --print-bg as #fff and --print-fg as
  // #000 (found in the demo build). A three digit colour is the same colour, so it is written out in full.
  it('writes a three digit colour out in full, as the browser reports it for a minified stylesheet', () => {
    const palette = readPackPalette(styleOf({ '--print-bg': '#fff', '--print-fg': '#000', '--print-muted': '#4d4d4d', '--print-label': '#8a4B00', '--print-rule': ' #Abc ' }))
    expect([palette.bg, palette.fg, palette.muted, palette.label, palette.rule]).toEqual(['#ffffff', '#000000', '#4d4d4d', '#8a4B00', '#AAbbcc'])
  })

  it('hands renderPackHtml a palette it accepts, whichever form the browser reported', () => {
    const palette = readPackPalette(styleOf({ '--print-bg': '#fff', '--print-fg': '#000' }))
    expect(parse(render(BASE, [], palette)).querySelector('style')?.textContent).toContain('background: #ffffff')
  })

  it.each(['--print-bg', '--print-fg', '--print-muted', '--print-rule', '--print-label'])('throws on a %s that is not a six digit hex colour', (token) => {
    for (const bad of ['red;}body{', '#FF', '#FFFF', '#FFFFF', '#FFFFFFF', '', 'red', '#GGGGGG', '#GGG', '#FFFFFFFF', 'rgb(0,0,0)', 'var(--x)', '#FFFFFF;', '#FFF;', '#FFFFFF}body{', '#fff}body{', 'url(x)', '#fff url(x)']) {
      expect(() => readPackPalette(styleOf({ [token]: bad })), `${token}: ${bad}`).toThrow(token)
    }
  })

  it.each(['--font-sans', '--font-mono'])('throws on a %s that could leave the declaration', (token) => {
    for (const bad of ['a;b', 'a}b', 'a{b', 'a<b', "a'b", 'url(x)', 'a\\b', '', 'a/*b']) {
      expect(() => readPackPalette(styleOf({ [token]: bad })), `${token}: ${bad}`).toThrow(token)
    }
  })

  it('throws when the tokens are not on the page at all', () => {
    expect(() => readPackPalette({ getPropertyValue: () => '' })).toThrow(/print/)
  })
})

// ---------------------------------------------------------------- the file's safety

describe('renderPackHtml: the file itself', () => {
  const html = render()

  it('is an HTML5 document in UK English, in UTF-8', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="en-GB">')
    expect(html).toContain('<meta charset="utf-8">')
  })

  it('carries the exact content security policy: nothing but data images and inline style', () => {
    expect(PACK_CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'")
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PACK_CSP}">`)
    const doc = parse(html)
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(PACK_CSP)
  })

  it('sends no referrer', () => {
    expect(parse(html).querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
  })

  it('puts the policy before anything that could load', () => {
    expect(html.indexOf('Content-Security-Policy')).toBeGreaterThan(-1)
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style'))
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<img'))
  })

  it('has no script, no web address and no way to load anything else', () => {
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).not.toMatch(/<(link|iframe|object|embed|form|base|a|svg|video|audio|source)\b/i)
    expect(html).not.toMatch(/url\s*\(/i)
    expect(html).not.toMatch(/@import/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('has no event attribute on any element, and no attribute that holds an address', () => {
    const doc = parse(html)
    expect(doc.scripts).toHaveLength(0)
    for (const el of doc.querySelectorAll('*')) {
      for (const name of el.getAttributeNames()) {
        expect(name.startsWith('on'), `${el.tagName} ${name}`).toBe(false)
        if (name !== 'src') expect(el.getAttribute(name), `${el.tagName} ${name}`).not.toMatch(/^\s*(data|javascript|https?):/i)
      }
    }
  })

  it('never writes the words the safety scan bans', () => {
    // Built by concatenation so this file does not hold them.
    expect(html).not.toContain(['src', 'doc'].join(''))
    expect(html).not.toContain(['inner', 'HTML'].join(''))
  })

  it('is the same file for the same input', () => {
    expect(render()).toBe(render())
  })

  it('titles the document with the dossier title', () => {
    expect(parse(html).title).toBe(BASE.title)
  })
})

describe('renderPackHtml: the style', () => {
  const doc = parse(render())
  const css = doc.querySelector('style')?.textContent ?? ''

  it('holds one style element with the palette from the print tokens', () => {
    expect(doc.querySelectorAll('style')).toHaveLength(1)
    for (const value of [PALETTE.bg, PALETTE.fg, PALETTE.muted, PALETTE.rule, PALETTE.label, PALETTE.fontSans, PALETTE.fontMono]) {
      expect(css, value).toContain(value)
    }
  })

  it('prints on A4 landscape with a 12 mm margin and starts the evidence on a new page', () => {
    expect(css.replace(/\s+/g, ' ')).toMatch(/@page\s*\{[^}]*size:\s*A4 landscape/)
    expect(css.replace(/\s+/g, ' ')).toMatch(/@page\s*\{[^}]*margin:\s*12mm/)
    expect(css.replace(/\s+/g, ' ')).toMatch(/\.evidence\s*\{[^}]*break-before:\s*page/)
  })

  it('writes no colour of its own: every colour in it is one of the five palette colours', () => {
    const literals = css.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []
    const allowed = new Set([PALETTE.bg, PALETTE.fg, PALETTE.muted, PALETTE.rule, PALETTE.label])
    for (const literal of literals) expect(allowed.has(literal), literal).toBe(true)
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch)\(/i)
  })

  it('refuses a palette that has been tampered with after it was read', () => {
    for (const bad of [{ bg: 'red;}body{' }, { fg: '#FFF' }, { label: 'x' }, { fontSans: 'a;b' }, { fontMono: '</style><script>' }]) {
      expect(() => render(BASE, [], { ...PALETTE, ...bad }), JSON.stringify(bad)).toThrow()
    }
  })
})

// ---------------------------------------------------------------- escaping

describe('renderPackHtml: every string is escaped', () => {
  const html = render(HOSTILE_DOSSIER, [{ ...FIGURE, summary: HOSTILE }])
  const doc = parse(html)

  it('leaves none of the hostile markup alive', () => {
    expect(html).not.toContain('<script>alert(2)')
    expect(html).not.toContain('<img src=x')
    expect(doc.scripts).toHaveLength(0)
    expect(doc.querySelectorAll('[onerror]')).toHaveLength(0)
    expect(doc.querySelectorAll('img')).toHaveLength(1)
    for (const el of doc.querySelectorAll('*')) expect(el.getAttributeNames().some((n) => n.startsWith('on'))).toBe(false)
  })

  it('round-trips the title, subtitle and flags as text', () => {
    expect(doc.title).toBe(HOSTILE)
    expect(doc.querySelector('h1')?.textContent).toBe(HOSTILE)
    expect(doc.querySelector('header')?.textContent).toContain(`sub ${HOSTILE}`)
    expect(doc.querySelector('header')?.textContent).toContain(`flag ${HOSTILE}`)
  })

  it('round-trips the series label and value as text', () => {
    const meta = doc.querySelector('table.meta')
    expect(meta?.querySelector('th')?.textContent).toBe(`label ${HOSTILE}`)
    expect(meta?.querySelector('td')?.textContent).toBe(`value ${HOSTILE}`)
  })

  it('round-trips a table title, note, column and cell as text', () => {
    const block = doc.querySelector('.story .block')
    expect(block?.querySelector('h2')?.textContent).toBe(`table ${HOSTILE}`)
    expect(block?.querySelector('.note')?.textContent).toBe(`note ${HOSTILE}`)
    expect(block?.querySelector('th')?.textContent).toBe(`col ${HOSTILE}`)
    expect(block?.querySelector('td')?.textContent).toBe(`cell ${HOSTILE}`)
  })

  it('round-trips a prose line and a verbatim line as text', () => {
    expect(doc.querySelector('.story p:not(.note)')?.textContent).toBe(`line ${HOSTILE}`)
    expect(doc.querySelector('.evidence pre')?.textContent).toBe(`verbatim ${HOSTILE}\nnext`)
  })

  it('round-trips the figure summary as its alt text and its caption', () => {
    const figure = doc.querySelector('figure')
    expect(figure?.querySelector('img')?.getAttribute('alt')).toBe(HOSTILE)
    expect(figure?.querySelector('figcaption')?.textContent).toBe(HOSTILE)
  })

  it('round-trips a source line and a footer line as text', () => {
    expect(doc.querySelector('.sources')?.textContent).toContain(`source ${HOSTILE}`)
    expect(doc.querySelector('footer')?.textContent).toContain(`footer ${HOSTILE}`)
  })

  it('keeps a hostile section id out of the id attribute', () => {
    const id = doc.querySelector('.story .block')?.getAttribute('id') ?? ''
    expect(id).toMatch(/^[A-Za-z0-9_-]*$/)
  })
})

// ---------------------------------------------------------------- images

describe('renderPackHtml: the charts', () => {
  const DROPPED: readonly (readonly [string, string])[] = [
    ['a javascript address', 'javascript:alert(1)'],
    ['an svg data address', 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+'],
    ['a jpeg data address', 'data:image/jpeg;base64,/9j/4AAQ'],
    ['a web address', 'https://example.test/chart.png'],
    ['a quote suffixed data address', `${PIXEL}" onerror="alert(1)`],
    ['a data address with a tag after it', `${PIXEL}><script>alert(1)</script>`],
    ['a data address with a line break after it', `${PIXEL}\n`],
    ['a data address with a space in it', 'data:image/png;base64,AAAA BBBB'],
    ['an empty address', ''],
    ['a png header with nothing after it', 'data:image/png;base64,'],
    ['an upper case scheme', PIXEL.replace('data:', 'DATA:')],
  ]

  it('draws a valid png as an image with its alt text, size and caption', () => {
    const doc = parse(render(BASE, [FIGURE]))
    const img = doc.querySelector('section.figures figure img')
    expect(img?.getAttribute('src')).toBe(PIXEL)
    expect(img?.getAttribute('alt')).toBe(FIGURE.summary)
    expect(img?.getAttribute('width')).toBe('640')
    expect(img?.getAttribute('height')).toBe('320')
    expect(doc.querySelector('section.figures figcaption')?.textContent).toBe(FIGURE.summary)
  })

  it.each(DROPPED)('drops %s and keeps the others', (_name, dataUrl) => {
    expect(PNG_DATA_URL.test(dataUrl)).toBe(false)
    const doc = parse(render(BASE, [{ ...FIGURE, summary: 'bad', dataUrl }, { ...FIGURE, summary: 'good' }]))
    const images = [...doc.querySelectorAll('img')]
    expect(images.map((img) => img.getAttribute('alt'))).toEqual(['good'])
    expect(doc.body.innerHTML).not.toContain('bad')
    expect(images.every((img) => PNG_DATA_URL.test(img.getAttribute('src') ?? ''))).toBe(true)
  })

  it('leaves out the charts section when there is no chart, or none that passes', () => {
    expect(parse(render(BASE, [])).querySelector('section.figures')).toBeNull()
    expect(parse(render(BASE, [{ ...FIGURE, dataUrl: 'javascript:alert(1)' }])).querySelector('section.figures')).toBeNull()
  })

  it('heads the charts with the copy heading and says the images are of the screen', () => {
    const section = parse(render(BASE, [FIGURE])).querySelector('section.figures')
    expect(section?.querySelector('h2')?.textContent).toBe(DOSSIER.sections.figures)
    expect(section?.textContent).toContain(DOSSIER.figureNote)
  })

  it('writes the size as whole pixels, or leaves it off when it is not a usable number', () => {
    const doc = parse(render(BASE, [
      { ...FIGURE, summary: 'a', width: 639.6, height: 320.2 },
      { ...FIGURE, summary: 'b', width: Number.NaN, height: -4 },
      { ...FIGURE, summary: 'c', width: Number.POSITIVE_INFINITY, height: 0 },
    ]))
    const [a, b, c] = [...doc.querySelectorAll('img')]
    expect([a?.getAttribute('width'), a?.getAttribute('height')]).toEqual(['640', '320'])
    expect([b?.hasAttribute('width'), b?.hasAttribute('height')]).toEqual([false, false])
    expect([c?.hasAttribute('width'), c?.hasAttribute('height')]).toEqual([false, false])
  })

  it('keeps the charts in the order given', () => {
    const doc = parse(render(BASE, [{ ...FIGURE, summary: 'one' }, { ...FIGURE, summary: 'two' }, { ...FIGURE, summary: 'three' }]))
    expect([...doc.querySelectorAll('figcaption')].map((c) => c.textContent)).toEqual(['one', 'two', 'three'])
  })
})

// ---------------------------------------------------------------- layout

describe('renderPackHtml: the layout', () => {
  const doc = parse(render())

  it('puts the header, the series, the story, the charts, the evidence, the sources and the footer in that order', () => {
    const order = [...doc.body.children].map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${el.className.split(' ')[0]}` : ''}`)
    expect(order).toEqual(['header', 'table.meta', 'section.story', 'section.figures', 'section.evidence', 'section.sources', 'footer'])
  })

  it('writes the title as the one h1, then the subtitle and each flag', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    const header = doc.querySelector('header')
    expect(header?.querySelector('h1')?.textContent).toBe(BASE.title)
    expect(header?.textContent).toContain(BASE.subtitle)
    for (const flag of BASE.flags) expect(header?.textContent).toContain(flag)
  })

  it('lists the series as label and value rows', () => {
    const rows = [...doc.querySelectorAll('table.meta tr')].map((tr) => [tr.querySelector('th')?.textContent, tr.querySelector('td')?.textContent])
    expect(rows).toEqual([['Basis', 'A: screen'], ['Unit', 'return per session']])
  })

  it('writes a table section as a heading, its note, its columns and its rows', () => {
    const block = doc.querySelector('section.story #kpis')
    expect(block?.querySelector('h2')?.textContent).toBe('Key figures')
    expect(block?.querySelector('.note')?.textContent).toBe('[POST HOC] Basis A.')
    expect([...(block?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent)).toEqual(['Measure', 'Value', 'Unit', 'Basis', 'Tag', 'Note'])
    expect([...(block?.querySelectorAll('tbody td') ?? [])].map((td) => td.textContent)).toEqual(['Sharpe', '1.20', 'ratio', 'A', '[POST HOC]', ''])
  })

  it('leaves the note out when there is none', () => {
    const d: Dossier = { ...BASE, story: [{ kind: 'table', id: 'q', title: 'Q', note: null, columns: ['A'], rows: [['1']] }] }
    expect(parse(render(d)).querySelector('.story .note')).toBeNull()
  })

  it('writes prose as one paragraph a line and verbatim text as preformatted text, as written', () => {
    expect([...doc.querySelectorAll('section.story #hypothesis p')].map((p) => p.textContent)).toEqual(['First line.', 'Second line.'])
    expect(doc.querySelector('section.evidence #passBar pre')?.textContent).toBe('  indented\nkept as written')
    expect(doc.querySelector('section.story #hypothesis pre')).toBeNull()
  })

  it('lists each source on its own line, and each footer line as a paragraph', () => {
    expect([...doc.querySelectorAll('section.sources li, section.sources p')].map((el) => el.textContent)).toContain(BASE.sources[0])
    expect([...doc.querySelectorAll('footer p')].map((p) => p.textContent)).toEqual(BASE.footer)
  })

  it('names the sources with the copy heading', () => {
    expect(doc.querySelector('section.sources h2')?.textContent).toBe(DOSSIER.sections.sources)
  })

  it('leaves the series table out when the dossier has none, and a section out when it is empty', () => {
    const d: Dossier = { ...BASE, meta: [], sources: [], evidence: [] }
    const bare = parse(render(d, []))
    expect(bare.querySelector('table.meta')).toBeNull()
    expect(bare.querySelector('section.sources')).toBeNull()
    expect(bare.querySelector('section.evidence')).toBeNull()
    expect(bare.querySelector('section.story')).not.toBeNull()
  })

  it('keeps the evidence class on the evidence section, which the style starts on a new page', () => {
    expect(doc.querySelector('section.evidence')).not.toBeNull()
  })
})

// ---------------------------------------------------------------- a real dossier

describe('renderPackHtml: a real dossier from the tear sheet', () => {
  const CTX: DossierContext = { now: new Date('2026-09-28T18:02:11Z'), demo: true, fixture: false, asOfUtc: '2026-09-28T18:00:00Z' }
  const dossier = buildDossier({ kind: 'tear', target: { kind: 'hypothesis', name: 'volmanaged_v0' }, tab: 'EQ', analytics: HYP_ANALYTICS, card: VOLMANAGED.card }, CTX)
  const html = renderPackHtml(dossier, [FIGURE, { ...FIGURE, summary: 'Drawdown, 39 sessions.' }], PALETTE)
  const doc = parse(html)

  it('has a key figures table with Unit, Basis and Tag columns', () => {
    const heads = [...doc.querySelectorAll('#kpis thead th')].map((th) => th.textContent)
    expect(heads).toEqual(expect.arrayContaining([DOSSIER.cols.unit, DOSSIER.cols.basis, DOSSIER.cols.tag]))
    expect(doc.querySelectorAll('#kpis tbody tr').length).toBeGreaterThan(3)
  })

  it('has the SV7 table, the two images and the descriptive footer', () => {
    expect(doc.querySelector('.evidence #sv7')).not.toBeNull()
    expect(doc.querySelectorAll('img')).toHaveLength(2)
    expect(doc.querySelector('footer')?.textContent).toContain(DOSSIER.descriptive)
    expect(doc.querySelector('footer')?.textContent).toContain(DOSSIER.demoNote)
  })

  it('is self-contained: no script, no web address, no event attribute', () => {
    expect(doc.scripts).toHaveLength(0)
    expect(html).not.toMatch(/https?:\/\//i)
    for (const el of doc.querySelectorAll('*')) expect(el.getAttributeNames().some((n) => n.startsWith('on'))).toBe(false)
  })
})
