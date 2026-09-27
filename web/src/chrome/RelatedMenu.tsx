// Related Functions menu (look spec 4.7). A black box with a light 1px edge over a dim that
// covers only the owning panel's stage (red bar and below): the command line, the toolbars and the
// other panels stay bright and usable, so it is a non-modal dialog, and says so (aria-modal="false").
// Focus moving to another panel closes it (WorkspaceController); focus on the chrome keeps it open, so
// Number <GO> typed in the command line still reaches its rows. Italic breadcrumb at the top left,
// `<Cancel> X` at the top right; two columns numbered sequentially across both, category rows
// included. Category rows (white, ending in `>`) open their functions; function rows read
// `N) MNEM  Title` and open that function in this panel. Escape goes up one level, then closes.
// While open, its rows are the panel's numbered items (Number <GO>).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MNEMONICS, findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { RELATED, fillCopy } from '../copy/workspace'
import { MENU_SOURCE, useNumbered } from './PanelChrome.numbers'
import { ROVING_ATTR, ROVING_OVERLAY_ATTR } from './WorkspaceFocus'
import './RelatedMenu.css'

type CategoryKey = keyof typeof RELATED.categories

/** House grouping of the P0 functions (the reference menus group per function; there is no rule). */
const CATEGORY_CODES: ReadonlyArray<readonly [CategoryKey, readonly MnemonicCode[]]> = [
  ['prices', ['GP', 'GIP', 'MON', 'CORR']],
  ['research', ['DES', 'REG', 'MT']],
  ['runs', ['RUNS', 'RUN', 'EQ', 'DD', 'RET', 'RR', 'MRET', 'LEDG']],
  ['live', ['LIVE', 'JRNL', 'OOS']],
  ['terminal', ['HOME', 'HELP']],
]

export interface RelatedFunction {
  readonly code: MnemonicCode
  readonly title: string
}

export interface RelatedCategory {
  readonly key: CategoryKey
  readonly label: string
  readonly functions: readonly RelatedFunction[]
}

function fits(code: MnemonicCode, context: ResolvedContext | null): boolean {
  const def = findMnemonic(code)
  if (!def || def.priority !== 'P0') return false
  return context === null || def.accepts.length === 0 || def.accepts.includes(context.kind)
}

/** The P0 functions that take the panel's context (or none), by category; empty categories dropped. */
export function relatedEntries(context: ResolvedContext | null): RelatedCategory[] {
  const known = new Set(MNEMONICS.map((m) => m.code))
  return CATEGORY_CODES.map(([key, codes]) => ({
    key,
    label: RELATED.categories[key],
    functions: codes
      .filter((code) => known.has(code) && fits(code, context))
      .map((code) => ({ code, title: findMnemonic(code)?.screen ?? code })),
  })).filter((c) => c.functions.length > 0)
}

type Row =
  | { readonly kind: 'category'; readonly n: number; readonly category: RelatedCategory }
  | { readonly kind: 'function'; readonly n: number; readonly fn: RelatedFunction }

function rowsFor(categories: readonly RelatedCategory[], drilled: RelatedCategory | null): Row[] {
  if (drilled) return drilled.functions.map((fn, i) => ({ kind: 'function', n: i + 1, fn }))
  const rows: Row[] = []
  for (const category of categories) {
    rows.push({ kind: 'category', n: rows.length + 1, category })
    for (const fn of category.functions) rows.push({ kind: 'function', n: rows.length + 1, fn })
  }
  return rows
}

/** Splits rows into two columns near the middle, at a category boundary when there is one. */
function columns(rows: readonly Row[]): [Row[], Row[]] {
  const half = Math.ceil(rows.length / 2)
  const starts = rows.map((r, i) => (r.kind === 'category' ? i : -1)).filter((i) => i > 0)
  const cut = starts.length > 0 ? starts.reduce((best, i) => (Math.abs(i - half) < Math.abs(best - half) ? i : best)) : half
  return [rows.slice(0, cut), rows.slice(cut)]
}

export interface RelatedMenuProps {
  readonly panelId: string
  readonly context: ResolvedContext | null
  readonly onOpen: (code: MnemonicCode) => void
  readonly onClose: () => void
}

function RowButton({ row, onActivate, onKey }: { readonly row: Row; readonly onActivate: (row: Row) => void; readonly onKey: (e: KeyboardEvent<HTMLButtonElement>, row: Row) => void }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} className={`related-row related-${row.kind}`} onClick={() => onActivate(row)} onKeyDown={(e) => onKey(e, row)}>
      <span className="related-no">{`${row.n})`}</span>{' '}
      {row.kind === 'category' ? (
        <>
          <span className="related-cat">{row.category.label}</span> <span aria-hidden="true">{'>'}</span>
        </>
      ) : (
        <>
          <span className="related-mnem">{row.fn.code}</span> <span className="related-title">{row.fn.title}</span>
        </>
      )}
    </button>
  )
}

export default function RelatedMenu({ panelId, context, onOpen, onClose }: RelatedMenuProps) {
  const categories = relatedEntries(context)
  const [drilled, setDrilled] = useState<CategoryKey | null>(null)
  const current = categories.find((c) => c.key === drilled) ?? null
  const rows = rowsFor(categories, current)
  const ref = useRef<HTMLDivElement>(null)
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  useEffect(() => {
    items()[0]?.focus()
  }, [drilled])

  const activate = (row: Row) => {
    if (row.kind === 'category') setDrilled(row.category.key)
    else onOpen(row.fn.code)
  }
  const up = () => (drilled ? setDrilled(null) : onClose())
  useNumbered(panelId, MENU_SOURCE, rows.map((row) => ({ n: row.n, label: row.kind === 'category' ? row.category.label : row.fn.code, run: () => activate(row) })))

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, row: Row) => {
    const list = items()
    const index = list.indexOf(event.currentTarget)
    const moves: Readonly<Record<string, number>> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }
    const target = moves[event.key]
    if (target !== undefined) {
      event.preventDefault()
      list[(target + list.length) % list.length]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate(row)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      up()
    } else {
      return
    }
    event.stopPropagation()
  }

  const crumbs = [RELATED.root, context?.value ?? RELATED.noContext, ...(current ? [current.label] : [])]
  const [left, right] = columns(rows)
  return (
    <div className="menu-dim">
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label={RELATED.title}
        className="related"
        tabIndex={-1}
        {...{ [ROVING_OVERLAY_ATTR]: '', [ROVING_ATTR]: '' }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          up()
        }}
      >
        <div className="related-head">
          <span className="menu-crumb">{crumbs.join(' > ')}</span>
          <button type="button" className="related-cancel" aria-label={RELATED.cancelLabel} onClick={onClose}>
            {RELATED.cancel} <span aria-hidden="true">X</span>
          </button>
        </div>
        <div role="menu" aria-label={fillCopy(RELATED.listLabel, { context: context?.value ?? RELATED.noContext })} className="related-cols">
          {[left, right].map((col, i) =>
            col.length > 0 ? (
              <div key={i} role="group" className="related-col">
                {col.map((row) => (
                  <RowButton key={`${row.kind}-${row.n}`} row={row} onActivate={activate} onKey={onKey} />
                ))}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}
