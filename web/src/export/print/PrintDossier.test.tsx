// @vitest-environment jsdom
// PrintDossier: the dossier laid out as React text for the printed page (roadmap 15 part 3). It is pure
// presentation: no provider, no hook, no request. The tests pin the outline (headings, tables with captions
// and scoped headers, verbatim text in pre, figures with alt text and captions, the evidence section that
// starts its own page), the order of the parts, and the safety of the text (a hostile title is a text node,
// never markup; an image that is not a PNG data address is left out).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DOSSIER } from '../../copy/dossier'
import { fillCopy } from '../../copy/workspace'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import { buildDossier } from '../dossier/dossierModel'
import type { Dossier, DossierContext, DossierFigure } from '../dossier/types'
import { PNG_DATA_URL } from '../prepare'
import { PrintDossier } from './PrintDossier'

afterEach(cleanup)

// A 1 x 1 png, so the data URLs below are real ones.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const FIGURE: DossierFigure = { dataUrl: PIXEL, summary: 'Equity curve, 39 sessions, ends at 1.04.', width: 640, height: 320 }
const SECOND: DossierFigure = { dataUrl: PIXEL, summary: 'Drawdown, deepest 6.1 percent.', width: 640, height: 200 }

const HOSTILE = '"><img src=x onerror=alert(1)><script>alert(2)</script> & \'quoted\''

const BASE: Dossier = {
  title: 'volmanaged_v0: tear sheet dossier',
  subtitle: 'Volatility managed, daily',
  flags: ['[POST HOC]', 'DEMO DATA'],
  meta: [
    ['Basis', 'A: screen'],
    ['Unit', 'return per session'],
  ],
  story: [
    {
      kind: 'table',
      id: 'kpis',
      title: 'Key figures',
      note: '[POST HOC] Basis A.',
      columns: ['Measure', 'Value', 'Unit', 'Basis', 'Tag', 'Note'],
      rows: [
        ['Sharpe', '1.20', 'ratio', 'A', '[POST HOC]', ''],
        ['Sortino', '1.55', 'ratio', 'A', '[POST HOC]', 'downside only'],
      ],
    },
    { kind: 'text', id: 'hypothesis', title: 'Hypothesis', lines: ['First line.', 'Second line.'], verbatim: false },
  ],
  evidence: [
    { kind: 'text', id: 'passBar', title: 'Pass bar', lines: ['  indented', 'kept as written', '', 'after a blank'], verbatim: true },
    { kind: 'table', id: 'dd', title: 'Deepest drawdowns', note: null, columns: ['Peak', 'Depth'], rows: [['2020-02-19', '-6.1%']] },
  ],
  sources: ['GET /api/analytics/hypothesis/volmanaged_v0?cost=1', 'GET /api/hypotheses/volmanaged_v0'],
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

const EMPTY: Dossier = { title: 'Bare', subtitle: '', flags: [], meta: [], story: [], evidence: [], sources: [], footer: [] }

function view(dossier: Dossier = BASE, figures: readonly DossierFigure[] = [FIGURE, SECOND]): HTMLElement {
  const { container } = render(<PrintDossier dossier={dossier} figures={figures} />)
  return container
}

const article = (c: HTMLElement): HTMLElement => {
  const el = c.querySelector<HTMLElement>('article.prt')
  if (!el) throw new Error('no article.prt')
  return el
}

describe('PrintDossier: the outline', () => {
  it('is one article named for the dossier, so a reader finds it as a landmark', () => {
    const c = view()
    expect(c.querySelectorAll('article')).toHaveLength(1)
    expect(article(c).getAttribute('aria-label')).toBe(fillCopy(DOSSIER.printLabel, { title: BASE.title }))
    expect(article(c).getAttribute('aria-label')).toBe('Print dossier: volmanaged_v0: tear sheet dossier')
  })

  it('has one h1, the title, in a header with the subtitle and the flags as a list', () => {
    const head = article(view()).querySelector('header.prt-head')
    expect(head?.querySelectorAll('h1')).toHaveLength(1)
    expect(head?.querySelector('h1')?.textContent).toBe(BASE.title)
    expect(head?.querySelector('p.prt-sub')?.textContent).toBe(BASE.subtitle)
    expect([...(head?.querySelectorAll('ul.prt-flags > li') ?? [])].map((li) => li.textContent)).toEqual(BASE.flags)
    expect(article(view()).querySelectorAll('h1')).toHaveLength(1)
  })

  it('leaves out an empty subtitle and an empty flag list rather than printing empty elements', () => {
    const head = article(view(EMPTY, [])).querySelector('header.prt-head')
    expect(head?.querySelector('h1')?.textContent).toBe('Bare')
    expect(head?.querySelector('p.prt-sub')).toBeNull()
    expect(head?.querySelector('ul')).toBeNull()
  })

  it('treats a subtitle of blanks as none', () => {
    expect(article(view({ ...BASE, subtitle: '   ' })).querySelector('p.prt-sub')).toBeNull()
  })

  it('puts every section title in an h2, under the one h1', () => {
    const el = article(view())
    const h2 = [...el.querySelectorAll('h2')].map((h) => h.textContent)
    expect(h2).toEqual([
      'Key figures',
      'Hypothesis',
      DOSSIER.sections.figures,
      'Pass bar',
      'Deepest drawdowns',
      DOSSIER.sections.sources,
    ])
    expect(el.querySelectorAll('h3, h4, h5, h6')).toHaveLength(0)
  })

  it('lays the parts out in reading order: header, series, story, charts, evidence, sources, footer', () => {
    const kids = [...article(view()).children].map((k) => `${k.tagName.toLowerCase()}.${k.className}`)
    expect(kids).toEqual([
      'header.prt-head',
      'table.prt-meta',
      'div.prt-story',
      'section.prt-figures',
      'section.prt-evidence',
      'section.prt-sources',
      'footer.prt-foot',
    ])
  })

  it('leaves out every part that has nothing in it', () => {
    const kids = [...article(view(EMPTY, [])).children].map((k) => k.tagName.toLowerCase())
    expect(kids).toEqual(['header'])
  })
})

describe('PrintDossier: the series table', () => {
  it('is a table with a hidden caption, a row header per label and a data cell per value', () => {
    const meta = article(view()).querySelector('table.prt-meta')
    expect(meta?.querySelector('caption')?.textContent).toBe(DOSSIER.sections.meta)
    expect(meta?.querySelector('caption')?.classList.contains('sr-only')).toBe(true)
    const rows = [...(meta?.querySelectorAll('tbody > tr') ?? [])]
    expect(rows).toHaveLength(2)
    for (const [i, [label, value]] of BASE.meta.entries()) {
      const th = rows[i]?.querySelector('th')
      expect(th?.getAttribute('scope')).toBe('row')
      expect(th?.textContent).toBe(label)
      expect(rows[i]?.querySelector('td')?.textContent).toBe(value)
    }
    expect(meta?.querySelectorAll('thead')).toHaveLength(0)
  })

  it('is left out with no series', () => {
    expect(article(view({ ...BASE, meta: [] })).querySelector('table.prt-meta')).toBeNull()
  })
})

describe('PrintDossier: tables', () => {
  const kpis = (c: HTMLElement) => article(c).querySelector('.prt-story table')

  it('captions each table with its title and marks every column header scope=col', () => {
    const table = kpis(view())
    expect(table?.querySelector('caption')?.textContent).toBe('Key figures')
    const heads = [...(table?.querySelectorAll('thead th') ?? [])]
    expect(heads.map((h) => h.textContent)).toEqual(['Measure', 'Value', 'Unit', 'Basis', 'Tag', 'Note'])
    for (const h of heads) expect(h.getAttribute('scope')).toBe('col')
  })

  it('prints each row as it was given, an empty cell as an empty cell', () => {
    const rows = [...(kpis(view())?.querySelectorAll('tbody > tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows).toEqual([
      ['Sharpe', '1.20', 'ratio', 'A', '[POST HOC]', ''],
      ['Sortino', '1.55', 'ratio', 'A', '[POST HOC]', 'downside only'],
    ])
  })

  it('states the basis and tag note in its own line above the table', () => {
    const table = kpis(view())
    const note = table?.closest('section')?.querySelector('p.prt-muted')
    expect(note?.textContent).toBe('[POST HOC] Basis A.')
    expect(note?.compareDocumentPosition(table!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('prints no note line when the table has none', () => {
    const dd = [...article(view()).querySelectorAll('.prt-evidence table')][0]
    expect(dd?.closest('section')?.querySelector('p')).toBeNull()
  })

  it('prints a table with no columns without an empty header row', () => {
    const c = view({ ...BASE, story: [{ kind: 'table', id: 'z', title: 'Zero', note: null, columns: [], rows: [['a', 'b']] }] }, [])
    const table = c.querySelector('.prt-story table')
    expect(table?.querySelector('thead')).toBeNull()
    expect(table?.querySelectorAll('tbody td')).toHaveLength(2)
  })

  it('gives every table a caption and every header cell a scope', () => {
    const c = view()
    for (const table of c.querySelectorAll('table')) expect(table.querySelector('caption')?.textContent?.length).toBeGreaterThan(0)
    for (const th of c.querySelectorAll('th')) expect(['row', 'col']).toContain(th.getAttribute('scope'))
  })
})

describe('PrintDossier: text', () => {
  it('prints prose as one paragraph per line under its heading', () => {
    const section = [...article(view()).querySelectorAll('.prt-story section')].find((s) => s.querySelector('h2')?.textContent === 'Hypothesis')
    expect([...(section?.querySelectorAll('p') ?? [])].map((p) => p.textContent)).toEqual(['First line.', 'Second line.'])
    expect(section?.querySelector('pre')).toBeNull()
  })

  it('prints quoted research text in a pre, line for line, with its indentation and blank lines kept', () => {
    const pre = article(view()).querySelector('.prt-evidence pre.prt-pre')
    expect(pre?.textContent).toBe('  indented\nkept as written\n\nafter a blank')
    expect(pre?.previousElementSibling?.tagName).toBe('H2')
    expect(pre?.parentElement?.querySelector('p')).toBeNull()
  })

  it('keeps a lone line of verbatim text as it is', () => {
    const c = view({ ...BASE, evidence: [{ kind: 'text', id: 'v', title: 'One', lines: ['  only'], verbatim: true }] }, [])
    expect(c.querySelector('pre')?.textContent).toBe('  only')
  })

  it('prints no paragraph for prose with no lines', () => {
    const c = view({ ...BASE, story: [{ kind: 'text', id: 'e', title: 'Empty prose', lines: [], verbatim: false }] }, [])
    expect(c.querySelector('.prt-story h2')?.textContent).toBe('Empty prose')
    expect(c.querySelectorAll('.prt-story p')).toHaveLength(0)
  })
})

describe('PrintDossier: charts', () => {
  it('prints each chart as a figure with the summary as alt text and as caption', () => {
    const section = article(view()).querySelector('section.prt-figures')
    expect(section?.querySelector('h2')?.textContent).toBe(DOSSIER.sections.figures)
    expect(section?.querySelector('p.prt-muted')?.textContent).toBe(DOSSIER.figureNote)
    // The heading and its note sit outside the grid the charts are laid in, so a page break can keep them with the first chart.
    expect(section?.querySelector(':scope > h2')).not.toBeNull()
    expect(section?.querySelector(':scope > p.prt-muted')).not.toBeNull()
    const figures = [...(section?.querySelectorAll(':scope > div.prt-figure-grid > figure.prt-figure') ?? [])]
    expect(figures).toHaveLength(2)
    for (const [i, f] of [FIGURE, SECOND].entries()) {
      const img = figures[i]?.querySelector('img')
      expect(img?.getAttribute('alt')).toBe(f.summary)
      expect(img?.getAttribute('src')).toBe(f.dataUrl)
      expect(img?.getAttribute('width')).toBe(String(f.width))
      expect(img?.getAttribute('height')).toBe(String(f.height))
      expect(figures[i]?.querySelector('figcaption')?.textContent).toBe(f.summary)
      expect(figures[i]?.querySelector('img + figcaption')).not.toBeNull()
    }
  })

  it('rounds a fractional size and leaves the size off when it is not a usable number', () => {
    const c = view(BASE, [
      { ...FIGURE, width: 640.4, height: 319.6 },
      { ...SECOND, width: Number.NaN, height: 200 },
      { ...SECOND, width: 640, height: 0 },
    ])
    const imgs = [...c.querySelectorAll('img')]
    expect([imgs[0]?.getAttribute('width'), imgs[0]?.getAttribute('height')]).toEqual(['640', '320'])
    for (const img of imgs.slice(1)) {
      expect(img.hasAttribute('width')).toBe(false)
      expect(img.hasAttribute('height')).toBe(false)
    }
  })

  it('leaves the whole charts section out when there is no chart', () => {
    const c = view(BASE, [])
    expect(c.querySelector('section.prt-figures')).toBeNull()
    expect(c.textContent).not.toContain(DOSSIER.figureNote)
  })

  const NOT_PNG: readonly string[] = [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,AAAA" onerror="alert(1)',
    'data:image/png;base64,AAAA<script>',
    'data:image/png;base64,AAAA AAAA',
    'data:image/jpeg;base64,/9j/4AAQ',
    'https://example.com/chart.png',
    'javascript:alert(1)',
    ' data:image/png;base64,AAAA',
    'data:image/png;base64,AAAA\n',
    'data:image/png;base64,',
    '',
  ]

  it.each(NOT_PNG.map((url) => [url]))('skips a figure whose address is not a PNG data address: %j', (dataUrl) => {
    expect(PNG_DATA_URL.test(dataUrl)).toBe(false)
    const c = view(BASE, [{ ...FIGURE, dataUrl }, SECOND])
    const imgs = [...c.querySelectorAll('img')]
    expect(imgs).toHaveLength(1)
    expect(imgs[0]?.getAttribute('alt')).toBe(SECOND.summary)
    expect(c.querySelectorAll('figure')).toHaveLength(1)
    expect(c.innerHTML).not.toContain('onerror')
  })

  it('leaves the charts section out when every chart is skipped', () => {
    const c = view(BASE, [{ ...FIGURE, dataUrl: 'https://example.com/x.png' }])
    expect(c.querySelector('section.prt-figures')).toBeNull()
    expect(c.querySelectorAll('img')).toHaveLength(0)
  })
})

describe('PrintDossier: evidence, sources and footer', () => {
  it('keeps the evidence in its own section, which the stylesheet starts on a new page', () => {
    const evidence = article(view()).querySelector('section.prt-evidence')
    expect([...(evidence?.querySelectorAll('h2') ?? [])].map((h) => h.textContent)).toEqual(['Pass bar', 'Deepest drawdowns'])
    expect(article(view()).querySelector('.prt-story')?.contains(evidence ?? null)).toBe(false)
  })

  it('leaves the evidence section out when there is none', () => {
    expect(article(view({ ...BASE, evidence: [] })).querySelector('section.prt-evidence')).toBeNull()
  })

  it('lists the sources one line each, under a heading', () => {
    const sources = article(view()).querySelector('section.prt-sources')
    expect(sources?.querySelector('h2')?.textContent).toBe(DOSSIER.sections.sources)
    expect([...(sources?.querySelectorAll('ul > li') ?? [])].map((li) => li.textContent)).toEqual(BASE.sources)
  })

  it('prints the footer lines as paragraphs', () => {
    const foot = article(view()).querySelector('footer.prt-foot')
    expect([...(foot?.querySelectorAll('p') ?? [])].map((p) => p.textContent)).toEqual(BASE.footer)
  })
})

describe('PrintDossier: hostile text is only ever text', () => {
  it('renders every field as a text node: no script, no event attribute, no extra image', () => {
    const c = view(HOSTILE_DOSSIER, [FIGURE])
    expect(c.querySelectorAll('script')).toHaveLength(0)
    expect(c.querySelectorAll('img')).toHaveLength(1)
    for (const el of c.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false)
    }
    expect(c.querySelector('h1')?.textContent).toBe(HOSTILE)
    expect(c.querySelector('p.prt-sub')?.textContent).toBe(`sub ${HOSTILE}`)
    expect(c.querySelector('.prt-story table caption')?.textContent).toBe(`table ${HOSTILE}`)
    expect(c.querySelector('.prt-story table td')?.textContent).toBe(`cell ${HOSTILE}`)
    expect(c.querySelector('.prt-evidence pre')?.textContent).toBe(`verbatim ${HOSTILE}\nnext`)
    expect(c.querySelector('.prt-sources li')?.textContent).toBe(`source ${HOSTILE}`)
    expect(c.querySelector('footer p')?.textContent).toBe(`footer ${HOSTILE}`)
  })

  it('keeps a hostile title out of the label attribute as markup', () => {
    const c = view(HOSTILE_DOSSIER, [])
    expect(article(c).getAttribute('aria-label')).toBe(fillCopy(DOSSIER.printLabel, { title: HOSTILE }))
    expect(c.querySelectorAll('article')).toHaveLength(1)
  })

  it('lets a hostile figure summary reach only alt text and a caption', () => {
    const c = view(BASE, [{ ...FIGURE, summary: HOSTILE }])
    expect(c.querySelector('img')?.getAttribute('alt')).toBe(HOSTILE)
    expect(c.querySelector('figcaption')?.textContent).toBe(HOSTILE)
    expect(c.querySelectorAll('script')).toHaveLength(0)
    expect(c.querySelectorAll('img')).toHaveLength(1)
  })
})

describe('PrintDossier: a real dossier', () => {
  const NOW = new Date('2026-09-28T18:02:11Z')
  const CTX: DossierContext = { now: NOW, demo: true, fixture: false, asOfUtc: '2026-09-28T17:59:30Z' }

  it('lays out the tear sheet dossier the browser builds, every section with a heading and its rows', () => {
    const dossier = buildDossier(
      { kind: 'tear', target: { kind: 'hypothesis', name: 'volmanaged_v0' }, tab: 'EQ', analytics: HYP_ANALYTICS, card: VOLMANAGED.card },
      CTX,
    )
    const c = view(dossier, [FIGURE])
    expect(c.querySelector('h1')?.textContent).toBe('volmanaged_v0: tear sheet dossier')
    const sections = [...dossier.story, ...dossier.evidence]
    const tables = sections.filter((s) => s.kind === 'table')
    expect(c.querySelectorAll('.prt-story table, .prt-evidence table')).toHaveLength(tables.length)
    for (const s of sections) {
      expect([...c.querySelectorAll('h2')].some((h) => h.textContent === s.title), s.title).toBe(true)
    }
    const rows = tables.reduce((n, t) => n + t.rows.length, 0)
    expect(c.querySelectorAll('.prt-story tbody tr, .prt-evidence tbody tr')).toHaveLength(rows)
    expect(c.querySelector('footer')?.textContent).toContain(DOSSIER.descriptive)
    expect(c.querySelectorAll('script')).toHaveLength(0)
  })
})
