// A small, safe markdown view for the round summaries DES shows (UI_SPEC section 7 "DES", ARCHITECTURE
// section 9): headings, paragraphs, pipe tables, nested lists and fenced blocks, with bold, inline code,
// links shown as their text only, and `{... <GO>}` command links as buttons that run the line. Every
// piece becomes a React element with its text as a text node, so markup in a summary is shown as text and
// never parsed as HTML.
import { Fragment, type ReactNode } from 'react'
import { commandLinkLine, requestLine } from '../../chrome/CommandLine.bus'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'

export interface ListItem {
  readonly depth: number
  readonly marker: string | null
  readonly text: string
}

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }
  | { readonly kind: 'list'; readonly items: readonly ListItem[] }
  | { readonly kind: 'code'; readonly text: string }

const HEADING = /^(#{1,6})\s+(.*)$/
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const FENCE = /^```/
const INDENT = 2

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isTableLine = (line: string | undefined): boolean => line !== undefined && line.trim().startsWith('|')

interface Cursor {
  readonly lines: readonly string[]
  i: number
}

function readFence(c: Cursor): Block {
  const body: string[] = []
  c.i += 1
  while (c.i < c.lines.length && !FENCE.test(c.lines[c.i] ?? '')) body.push(c.lines[c.i++] ?? '')
  c.i += 1
  return { kind: 'code', text: body.join('\n') }
}

function readTable(c: Cursor): Block {
  const header = cells(c.lines[c.i] ?? '')
  c.i += 2
  const rows: string[][] = []
  while (isTableLine(c.lines[c.i])) rows.push(cells(c.lines[c.i++] ?? ''))
  return { kind: 'table', header, rows }
}

function readList(c: Cursor): Block {
  const items: ListItem[] = []
  for (let m = LIST.exec(c.lines[c.i] ?? ''); m; m = LIST.exec(c.lines[c.i] ?? '')) {
    const marker = m[2] ?? '-'
    items.push({ depth: Math.floor((m[1] ?? '').length / INDENT), marker: /\d/.test(marker) ? marker : null, text: m[3] ?? '' })
    c.i += 1
  }
  return { kind: 'list', items }
}

function readParagraph(c: Cursor): Block {
  const parts: string[] = []
  while (c.i < c.lines.length) {
    const line = c.lines[c.i] ?? ''
    if (line.trim() === '' || HEADING.test(line) || LIST.test(line) || FENCE.test(line) || isTableLine(line)) break
    parts.push(line.trim())
    c.i += 1
  }
  return { kind: 'paragraph', text: parts.join(' ') }
}

/** The markdown's blocks, in order. */
export function parseBlocks(text: string): Block[] {
  const c: Cursor = { lines: text.replace(/\r\n?/g, '\n').split('\n'), i: 0 }
  const blocks: Block[] = []
  while (c.i < c.lines.length) {
    const line = c.lines[c.i] ?? ''
    const heading = HEADING.exec(line)
    if (line.trim() === '') c.i += 1
    else if (FENCE.test(line)) blocks.push(readFence(c))
    else if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      c.i += 1
    } else if (isTableLine(line) && TABLE_RULE.test(c.lines[c.i + 1] ?? '')) blocks.push(readTable(c))
    else if (LIST.test(line)) blocks.push(readList(c))
    else blocks.push(readParagraph(c))
  }
  return blocks
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]*\))|(\{[^{}]+<GO>\s*\})/g
const roving = { [ROVING_ATTR]: '' }

function CommandLink({ text }: { readonly text: string }) {
  const line = commandLinkLine(text) ?? ''
  return (
    <button type="button" className="des-md-cmd" onClick={() => requestLine(line)} {...roving}>
      {text.slice(1, -1).trim()}
    </button>
  )
}

function inlinePiece(token: string, key: number): ReactNode {
  if (token.startsWith('`')) return <code key={key}>{token.slice(1, -1)}</code>
  if (token.startsWith('**')) return <strong key={key}>{token.slice(2, -2)}</strong>
  if (token.startsWith('[')) return <Fragment key={key}>{token.slice(1, token.indexOf(']'))}</Fragment>
  return <CommandLink key={key} text={token} />
}

/** Inline markdown as React nodes: text stays text. */
export function Inline({ text }: { readonly text: string }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(inlinePiece(m[0], at))
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

function Heading({ level, text, base }: { readonly level: number; readonly text: string; readonly base: number }) {
  const Tag = `h${Math.min(6, base + level - 1)}` as 'h4'
  return <Tag className="des-md-h"><Inline text={text} /></Tag>
}

function Table({ header, rows }: { readonly header: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }) {
  return (
    <div className="des-md-tablewrap">
      <table className="des-md-table">
        <thead>
          <tr>{header.map((h, i) => <th key={i} scope="col"><Inline text={h} /></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>{row.map((cell, i) => <td key={i}><Inline text={cell} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Nested lists from the flat items: each item holds the deeper items that follow it. */
function List({ items, depth = 0 }: { readonly items: readonly ListItem[]; readonly depth?: number }) {
  const groups: Array<{ item: ListItem; children: ListItem[] }> = []
  for (const item of items) {
    const parent = groups[groups.length - 1]
    if (item.depth > depth && parent) parent.children.push(item)
    else groups.push({ item, children: [] })
  }
  return (
    <ul className="des-md-list">
      {groups.map(({ item, children }, i) => (
        <li key={i}>
          {item.marker ? `${item.marker} ` : null}
          <Inline text={item.text} />
          {children.length > 0 ? <List items={children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

function BlockView({ block, base }: { readonly block: Block; readonly base: number }) {
  switch (block.kind) {
    case 'heading':
      return <Heading level={block.level} text={block.text} base={base} />
    case 'table':
      return <Table header={block.header} rows={block.rows} />
    case 'list':
      return <List items={block.items} />
    case 'code':
      return <pre className="des-md-pre">{block.text}</pre>
    default:
      return <p className="des-md-p"><Inline text={block.text} /></p>
  }
}

export interface DesMarkdownProps {
  readonly text: string
  /** Names the region for assistive technology; leave it out inside a box that is already named. */
  readonly label?: string
  /** The heading level a `#` heading takes (default 4: under the panel's h2 and the card's h3). */
  readonly baseLevel?: number
}

export default function DesMarkdown({ text, label, baseLevel = 4 }: DesMarkdownProps) {
  return (
    <div className="des-md" role={label ? 'region' : undefined} aria-label={label}>
      {parseBlocks(text).map((block, i) => <BlockView key={i} block={block} base={baseLevel} />)}
    </div>
  )
}
