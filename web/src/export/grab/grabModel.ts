// The pure part of GRAB (the panel as one image with its labels): the caption that says where the
// picture came from, the file name, line wrapping and the page layout of the composed image. No DOM and
// no canvas here, so every rule is pinned by a plain test. Lazy code: the shell never imports this
// folder (a dynamic import reaches run.ts from the Workspace handle), so nothing here costs first load.
import { CHROME, FRAME_STRIP, STATUS_BAR } from '../../copy/chrome'
import { GRAB } from '../../copy/grab'
import { FENCE } from '../../copy/lineStack'
import { fillCopy } from '../../copy/workspace'
import { etClock } from '../../chrome/StatusBar.format'

/**
 * What a screen knows about the numbers it shows. Every field may be absent; tags are written with
 * their brackets (`[POST HOC]`), basis and window are already worded by the screen (fillCopy over
 * GRAB.caption), and `source` is the path of the GET that fetched the numbers, or several joined with
 * GRAB.caption.pair.
 */
export interface GrabProvenance {
  readonly tags: readonly string[]
  readonly basis: string | null
  readonly unit: string | null
  readonly window: string | null
  readonly n: number | null
  readonly source: string | null
  readonly specSha: string | null
}

export interface GrabFacts {
  /** `1-EQ`: the panel number and mnemonic, or the mnemonic alone. */
  readonly panelLabel: string
  readonly title: string
  /** The link group; `-` (or empty) means none. */
  readonly group: string
  readonly demo: boolean
  readonly fixture: boolean
  readonly provenance: GrabProvenance | null
  /** The server clock from /api/health, an ISO time in UTC; null when unknown. */
  readonly asOfUtc: string | null
  readonly now: Date
}

const SPEC_CHARS = 12
const NO_GROUP = '-'

function clean(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

function present(parts: ReadonlyArray<string | null>): string[] {
  return parts.filter((part): part is string => part !== null)
}

/** The New York time of day for a date, or null when the date is not a real time. */
function etTime(date: Date): string | null {
  return Number.isNaN(date.getTime()) ? null : etClock(date)
}

function panelLine(f: GrabFacts): string {
  const group = clean(f.group)
  const chip = group !== null && group !== NO_GROUP ? fillCopy(GRAB.caption.group, { group }) : null
  const head = present([clean(f.panelLabel), chip]).join(' ')
  return present([
    head || null,
    clean(f.title),
    f.demo ? FRAME_STRIP.demoData : null,
    f.fixture ? STATUS_BAR.fixture : null,
  ]).join(GRAB.caption.separator)
}

function provenanceLine(p: GrabProvenance | null): string {
  if (p === null) return ''
  const tags = present(p.tags.map(clean))
  const sessions = typeof p.n === 'number' && Number.isFinite(p.n) ? fillCopy(GRAB.caption.sessions, { n: p.n }) : null
  const span = present([clean(p.window), sessions]).join(GRAB.caption.pair)
  const sha = clean(p.specSha)
  return present([
    tags.length > 0 ? tags.join(' ') : null,
    clean(p.basis),
    clean(p.unit),
    span || null,
    sha !== null ? fillCopy(GRAB.caption.spec, { sha: sha.slice(0, SPEC_CHARS) }) : null,
  ]).join(GRAB.caption.separator)
}

function sourceLine(f: GrabFacts): string {
  const path = clean(f.provenance?.source)
  const asOf = f.asOfUtc === null ? null : etTime(new Date(f.asOfUtc))
  const grabbed = etTime(f.now)
  return present([
    FENCE.label,
    path !== null ? fillCopy(GRAB.caption.source, { path }) : null,
    asOf !== null ? fillCopy(GRAB.caption.asOf, { time: asOf }) : null,
    grabbed !== null ? fillCopy(GRAB.caption.grabbed, { time: grabbed }) : null,
    CHROME.appTitle,
  ]).join(GRAB.caption.separator)
}

/**
 * The caption under the picture: the panel line, the provenance line (only when the screen gave one
 * or more of its fields) and the fence, source and time line. A blank line is never returned, and
 * a missing value is left out rather than written as a word.
 */
export function grabCaption(f: GrabFacts): string[] {
  return [panelLine(f), provenanceLine(f.provenance), sourceLine(f)].filter((line) => line !== '')
}

const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g
const NAME_EDGES = /^[._]+|[._]+$/g

/** `<title>_<YYYYMMDD>-<HHMMSS>Z.png`, the time in UTC; the title cleaned as the CSV file names are. */
export function grabFileName(title: string, now: Date): string {
  const stem = title.trim().replace(UNSAFE_NAME, '_').replace(NAME_EDGES, '')
  const stamp = Number.isNaN(now.getTime())
    ? '00000000-000000'
    : now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `${stem || 'panel'}_${stamp}Z.png`
}

function breakWord(word: string, maxWidth: number, measure: (text: string) => number): string[] {
  const pieces: string[] = []
  let piece = ''
  for (const char of word) {
    if (piece !== '' && measure(piece + char) > maxWidth) {
      pieces.push(piece)
      piece = char
    } else {
      piece += char
    }
  }
  if (piece !== '') pieces.push(piece)
  return pieces
}

/**
 * `text` in lines no wider than `maxWidth` by `measure` (a canvas measureText in the browser): words
 * are packed greedily, white space is collapsed, and a word wider than a line is cut by character
 * (never inside a surrogate pair). Blank text gives no lines.
 */
export function wrapLine(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line === '' ? word : `${line} ${word}`
    if (measure(joined) <= maxWidth) {
      line = joined
      continue
    }
    if (line !== '') lines.push(line)
    line = ''
    if (measure(word) <= maxWidth) {
      line = word
      continue
    }
    const pieces = breakWord(word, maxWidth, measure)
    lines.push(...pieces.slice(0, -1))
    line = pieces.at(-1) ?? ''
  }
  if (line !== '') lines.push(line)
  return lines
}

export interface GrabMetrics {
  /** Space around the figures and the caption, in CSS px. */
  readonly pad: number
  readonly lineHeight: number
  readonly minWidth: number
  /** The tallest image, in CSS px; a figure that would pass it is left out. */
  readonly maxHeight: number
}

export const GRAB_METRICS: GrabMetrics = { pad: 8, lineHeight: 16, minWidth: 640, maxHeight: 8000 }

/** The most pixels a canvas may have along one side; browsers refuse or blank larger ones. */
export const GRAB_MAX_CANVAS = 16000

export interface GrabBox {
  readonly width: number
  readonly height: number
}

export interface GrabPlacement {
  /** Position in the boxes given. */
  readonly index: number
  readonly x: number
  /** Where the figure's summary text starts. */
  readonly summaryY: number
  /** Where the figure itself starts, under its summary. */
  readonly y: number
}

export interface GrabLayout {
  readonly width: number
  readonly height: number
  readonly placements: readonly GrabPlacement[]
  readonly kept: number
  /** True when a figure was left out for not fitting the maximum height. */
  readonly trimmed: boolean
  /** The 1 px rule above the caption. */
  readonly ruleY: number
  readonly captionY: number
}

/** The image width: the minimum, or the widest figure with its padding, whichever is more. */
export function grabWidth(boxes: readonly GrabBox[], m: GrabMetrics = GRAB_METRICS): number {
  return Math.max(m.minWidth, ...boxes.map((box) => box.width + 2 * m.pad))
}

/**
 * Stacks the figures top to bottom in the order given, each under its wrapped summary lines, then the
 * rule and the wrapped caption. The width holds the widest figure (all of them, so the text is wrapped
 * once for the final width). A figure that would take the image past the maximum height is left out
 * with every later one; the first is always kept, so the image is never empty (grabScale bounds it).
 */
export function grabLayout(
  boxes: readonly GrabBox[],
  summaryLines: readonly number[],
  captionLines: number,
  m: GrabMetrics = GRAB_METRICS,
): GrabLayout {
  const width = grabWidth(boxes, m)
  const tail = 1 + m.pad + Math.max(0, captionLines) * m.lineHeight + m.pad
  const placements: GrabPlacement[] = []
  let y = m.pad
  for (const [index, box] of boxes.entries()) {
    const figureY = y + Math.max(0, summaryLines[index] ?? 0) * m.lineHeight
    const next = figureY + box.height + m.pad
    if (placements.length > 0 && next + tail > m.maxHeight) break
    placements.push({ index, x: m.pad, summaryY: y, y: figureY })
    y = next
  }
  return {
    width,
    height: y + tail,
    placements,
    kept: placements.length,
    trimmed: placements.length < boxes.length,
    ruleY: y,
    captionY: y + 1 + m.pad,
  }
}

function sideCap(side: number): number {
  return side > 0 ? GRAB_MAX_CANVAS / side : Number.POSITIVE_INFINITY
}

/** The drawing scale: the device pixel ratio (at least 1), lowered so neither side passes 16000 px. */
export function grabScale(dpr: number, width: number, height: number): number {
  const ratio = Number.isFinite(dpr) ? Math.max(1, dpr) : 1
  return Math.min(ratio, sideCap(width), sideCap(height))
}
