// The evidence pack as one self-contained HTML string (roadmap 15 part 2, slice 2). String building only:
// this file touches no DOM, sets no HTML through a script and makes no request. The file it returns opens
// offline, loads nothing and runs nothing:
//   - a content security policy that allows data images and inline style and nothing else;
//   - no script element, no event attribute, no link, no web address, no font or style file to fetch;
//   - every string of the dossier and of the copy goes through escapeHtml before it is written;
//   - every image is checked against PNG_DATA_URL again here, whoever handed it over, and dropped if it fails;
//   - the palette comes from the --print-* tokens as plain text checked against a pattern, and is checked
//     again when the file is laid out, so a colour that is not a colour can never leave the style element.
// Lazy code: only the dynamic import in the Workspace's export menu reaches it.
import { DOSSIER } from '../../copy/dossier'
import type { Dossier, DossierFigure, DossierSection, DossierTable } from '../dossier/types'
import { PNG_DATA_URL } from '../prepare'

/** The policy written into the file: images only from data addresses, inline style, and nothing else. */
export const PACK_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Text for an HTML text node or a quoted attribute: & < > double quote and single quote become entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

// ---------------------------------------------------------------- the palette

const COLOUR = /^#[0-9A-Fa-f]{6}$/
const FONT = /^[A-Za-z0-9 ",.-]+$/

/** The colours and font stacks the pack is set in. Read from the tokens by readPackPalette(). */
export interface PackPalette {
  readonly bg: string
  readonly fg: string
  readonly muted: string
  readonly rule: string
  readonly label: string
  readonly fontSans: string
  readonly fontMono: string
}

/** The custom property behind each palette field. */
const TOKEN = {
  bg: '--print-bg',
  fg: '--print-fg',
  muted: '--print-muted',
  rule: '--print-rule',
  label: '--print-label',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
} as const satisfies Record<keyof PackPalette, string>

const FIELDS = Object.keys(TOKEN) as (keyof PackPalette)[]
const isFont = (field: keyof PackPalette): boolean => field === 'fontSans' || field === 'fontMono'

const SHORT_COLOUR = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/

/**
 * A three digit hex colour written out in full. The production stylesheet is minified, and the browser then
 * reports --print-bg as #fff and --print-fg as #000; it is the same colour. Anything else is returned as it
 * is, for the check to refuse.
 */
function fullColour(value: string): string {
  const short = SHORT_COLOUR.exec(value)
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value
}

/** Throws when a palette field is not text the style element can hold safely. The value is never echoed. */
function checkPalette(palette: PackPalette): void {
  for (const field of FIELDS) {
    const value = palette[field]
    if (typeof value !== 'string' || !(isFont(field) ? FONT : COLOUR).test(value)) {
      throw new Error(`${TOKEN[field]} is not usable in the evidence pack (${isFont(field) ? 'a plain font stack' : 'a six digit hex colour'} is needed)`)
    }
  }
}

/**
 * The palette from the page's computed style: --print-bg, --print-fg, --print-muted, --print-rule and
 * --print-label (hex colours, three or six digits, returned with six), and --font-sans and --font-mono
 * (letters, digits, spaces, double quotes, commas, full stops and hyphens). Throws, naming the token, when
 * one is missing or is anything else.
 */
export function readPackPalette(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): PackPalette {
  const read = (field: keyof PackPalette): string => {
    const value = style.getPropertyValue(TOKEN[field]).trim()
    return isFont(field) ? value : fullColour(value)
  }
  const palette: PackPalette = {
    bg: read('bg'),
    fg: read('fg'),
    muted: read('muted'),
    rule: read('rule'),
    label: read('label'),
    fontSans: read('fontSans'),
    fontMono: read('fontMono'),
  }
  checkPalette(palette)
  return palette
}

// ---------------------------------------------------------------- the style

function styleSheet(p: PackPalette): string {
  return [
    ':root { color-scheme: light; }',
    '@page { size: A4 landscape; margin: 12mm; }',
    `html { background: ${p.bg}; color: ${p.fg}; }`,
    `body { margin: 0 auto; max-width: 1120px; padding: 12px 16px; font-family: ${p.fontSans}; font-size: 10.5pt; line-height: 1.4; }`,
    'h1 { font-size: 18pt; margin: 0 0 4px; }',
    `h2 { font-size: 12pt; margin: 16px 0 4px; color: ${p.label}; }`,
    `.subtitle, .note, figcaption, footer { color: ${p.muted}; }`,
    'p { margin: 2px 0; }',
    `.flags { color: ${p.label}; font-weight: 700; }`,
    'table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }',
    `th, td { border: 1px solid ${p.rule}; padding: 2px 6px; text-align: left; vertical-align: top; }`,
    `th { color: ${p.label}; }`,
    '.meta { width: auto; min-width: 50%; }',
    `pre { font-family: ${p.fontMono}; white-space: pre-wrap; margin: 4px 0 8px; padding-left: 8px; border-left: 3px solid ${p.rule}; }`,
    'figure { margin: 8px 0; break-inside: avoid; }',
    `img { display: block; max-width: 100%; height: auto; border: 1px solid ${p.rule}; }`,
    'figcaption { margin-top: 2px; }',
    'ul { margin: 2px 0; padding-left: 20px; }',
    `footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid ${p.rule}; }`,
    'tr, .block { break-inside: avoid; }',
    '.evidence { break-before: page; }',
  ].join('\n')
}

// ---------------------------------------------------------------- the body

const esc = (text: string): string => escapeHtml(text)

/** An element id from a section id: letters, digits, underscore and hyphen only, so it can never end an attribute. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '')
}

function tableHtml(t: DossierTable): string {
  const head = t.columns.length === 0 ? '' : `<thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`
  const rows = t.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  return `<table>${head}<tbody>${rows}</tbody></table>`
}

function blockHtml(section: DossierSection): string {
  const id = safeId(section.id)
  const open = `<div class="block"${id === '' ? '' : ` id="${id}"`}>`
  const heading = `<h2>${esc(section.title)}</h2>`
  if (section.kind === 'table') {
    const note = section.note === null || section.note.trim() === '' ? '' : `<p class="note">${esc(section.note)}</p>`
    return `${open}${heading}${note}${tableHtml(section)}</div>`
  }
  // The parser drops the line break right after <pre>, so one is written: the first line survives as it was.
  const body = section.verbatim
    ? `<pre>\n${section.lines.map((line) => esc(line)).join('\n')}</pre>`
    : section.lines.map((line) => `<p>${esc(line)}</p>`).join('')
  return `${open}${heading}${body}</div>`
}

function sectionHtml(className: string, sections: readonly DossierSection[]): string {
  return sections.length === 0 ? '' : `<section class="${className}">${sections.map(blockHtml).join('')}</section>`
}

/** A size in whole pixels for the width or height attribute, or null when it is not a usable number. */
function pixels(size: number): number | null {
  const whole = Math.round(size)
  return Number.isFinite(size) && whole >= 1 ? whole : null
}

function figureHtml(figure: DossierFigure): string {
  const width = pixels(figure.width)
  const height = pixels(figure.height)
  const size = width === null || height === null ? '' : ` width="${width}" height="${height}"`
  return `<figure><img src="${esc(figure.dataUrl)}" alt="${esc(figure.summary)}"${size}><figcaption>${esc(figure.summary)}</figcaption></figure>`
}

function figuresHtml(figures: readonly DossierFigure[]): string {
  // Whoever made the images, only a PNG data address is ever written into the file.
  const kept = figures.filter((figure) => PNG_DATA_URL.test(figure.dataUrl))
  if (kept.length === 0) return ''
  const head = `<h2>${esc(DOSSIER.sections.figures)}</h2><p class="note">${esc(DOSSIER.figureNote)}</p>`
  return `<section class="figures">${head}${kept.map(figureHtml).join('')}</section>`
}

function headerHtml(d: Dossier): string {
  const subtitle = d.subtitle.trim() === '' ? '' : `<p class="subtitle">${esc(d.subtitle)}</p>`
  const flags = d.flags.length === 0 ? '' : `<p class="flags">${d.flags.map((flag) => `<span>${esc(flag)}</span>`).join(' ')}</p>`
  return `<header><h1>${esc(d.title)}</h1>${subtitle}${flags}</header>`
}

function metaHtml(d: Dossier): string {
  if (d.meta.length === 0) return ''
  const rows = d.meta.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')
  return `<table class="meta"><tbody>${rows}</tbody></table>`
}

function sourcesHtml(d: Dossier): string {
  if (d.sources.length === 0) return ''
  return `<section class="sources"><h2>${esc(DOSSIER.sections.sources)}</h2><ul>${d.sources.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></section>`
}

function footerHtml(d: Dossier): string {
  return d.footer.length === 0 ? '' : `<footer>${d.footer.map((line) => `<p>${esc(line)}</p>`).join('')}</footer>`
}

/**
 * The evidence pack: header (title, subtitle, flags), the series table, the story, the charts as images
 * of the panel, the evidence (which starts a new printed page), the sources and the footer. Throws when
 * the palette is not made of plain colours and font stacks. `figures` that are not PNG data addresses are
 * left out.
 */
export function renderPackHtml(d: Dossier, figures: readonly DossierFigure[], p: PackPalette): string {
  checkPalette(p)
  return [
    '<!doctype html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PACK_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(d.title)}</title>`,
    `<style>\n${styleSheet(p)}\n</style>`,
    '</head>',
    '<body>',
    headerHtml(d),
    metaHtml(d),
    sectionHtml('story', d.story),
    figuresHtml(figures),
    sectionHtml('evidence', d.evidence),
    sourcesHtml(d),
    footerHtml(d),
    '</body>',
    '</html>',
  ]
    .filter((part) => part !== '')
    .join('\n')
    .concat('\n')
}
