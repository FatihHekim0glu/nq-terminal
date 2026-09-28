// HELP (spec 7.12; UI_SPEC sections 5 and 7): the red function bar (an amber `<Search help>` field
// that runs HL, `96) Actions`, `Page n/m`, the title), then a contents rail on the left (white group
// headings with right-aligned counts; under Mnemonics the numbered amber items, the selected one on
// the selection navy), an italic breadcrumb, then the sections: grammar with runnable `{... <GO>}`
// examples, the numbered mnemonic index (generated from the command registry, so a new mnemonic shows
// here without editing this file; `N <GO>` or its contents item opens that function's help), the keys,
// the drawn keyboard, link groups and licences. Every font listed is under an open licence.
import { useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { findMnemonic, MNEMONICS, type MnemonicCode, type MnemonicDef } from '../commands/registry'
import { HELP, HELP_FONT_LICENCES, HELP_KEYS, HELP_LICENCES } from '../copy/help'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../copy/workspace'
import { commandLinkLine, requestLine } from './CommandLine.bus'
import { menuOptionId, MenuSheet } from './CommandLine.menu'
import { searchMenu, type MenuItem, type MenuModel } from './CommandLine.menus'
import { AmberField } from './Field'
import FunctionBar from './FunctionBar'
import { KeyboardDrawing, KeyTable } from './HelpScreen.keymap'
import { KeyText } from './MessageLine'
import { usePanelActions } from './PanelChrome.actions'
import { useNumbered } from './PanelChrome.numbers'
import { usePanelPage } from './PanelChrome.page'
import { SCREEN_PHASES } from './WorkspaceLayouts'
import { ROVING_ATTR } from './WorkspaceFocus'
import './HelpScreen.css'

export interface HelpScreenProps {
  /** Mnemonics whose screen is built; the rest are listed as placeholders. */
  readonly built: ReadonlySet<MnemonicCode | string>
  /** The index to list; the registry unless a test passes another. */
  readonly mnemonics?: readonly MnemonicDef[]
}

type SectionId = 'mnemonics' | 'keys' | 'links' | 'keyboard' | 'licences'

const roving = { [ROVING_ATTR]: '' }
// Bergoom is listed only when its files are vendored (decision D2 falls back to Source Sans 3 alone).
const BERGOOM_VENDORED = Object.keys(import.meta.glob('../assets/fonts/bergoom/*.woff2')).length > 0
const FONT_LICENCES = [...(BERGOOM_VENDORED ? [HELP_FONT_LICENCES.bergoom] : []), HELP_FONT_LICENCES.sourceSans, HELP_FONT_LICENCES.ptMono]
const LICENCES: ReadonlyArray<readonly [string, string]> = [...HELP_LICENCES, ...FONT_LICENCES]

export function screenStatus(def: MnemonicDef, built: ReadonlySet<string>): string {
  if (built.has(def.code)) return HELP.statusBuilt
  if (def.priority === 'P1') return HELP.statusP1
  if (def.priority === 'P2') return HELP.statusP2
  return fillCopy(HELP.statusPhase, { phase: SCREEN_PHASES[def.code] ?? '?' })
}

function MnemonicIndex({ mnemonics, built }: { readonly mnemonics: readonly MnemonicDef[]; readonly built: ReadonlySet<string> }) {
  const c = HELP.columns
  return (
    <table className="help-table">
      <caption>{HELP.mnemonicsCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{c.number}</th><th scope="col">{c.code}</th><th scope="col">{c.screen}</th>
          <th scope="col">{c.context}</th><th scope="col">{c.priority}</th><th scope="col">{c.status}</th>
        </tr>
      </thead>
      <tbody>
        {mnemonics.map((m, i) => (
          <tr key={m.code} data-built={built.has(m.code) ? 'true' : 'false'}>
            <td className="ix"><span className="hot">{`${i + 1})`}</span></td>
            <th scope="row" className="code">{m.code}</th>
            <td className="prose">{m.screen}</td>
            <td className="muted">{m.context}</td>
            <td className="muted">{m.priority}</td>
            <td className="status">{screenStatus(m, built)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** `{NQ1 Index GP <GO>}` as a command link that runs the line on click or Enter (spec 5.1 item 10). */
function CommandLink({ text }: { readonly text: string }) {
  const line = commandLinkLine(text)
  if (!line) return <code>{text}</code>
  return (
    <span className="cmd-link-wrap">
      <span aria-hidden="true">{'{'}</span>
      <button type="button" className="cmd-link" onClick={() => requestLine(line)} {...roving}>
        <KeyText text={`${line} <GO>`} />
      </button>
      <span aria-hidden="true">{'}'}</span>
    </span>
  )
}

function Licences() {
  return (
    <>
      <p>{HELP.tradingView}</p>
      <p>
        <a href={HELP.tradingViewUrl} target="_blank" rel="noopener noreferrer" {...roving}>
          {HELP.tradingViewLink}
          {' '}<span className="sr-only">{HELP.newTab}</span>
        </a>
      </p>
      <ul className="help-licences" aria-label={HELP.licencesHeading}>
        {LICENCES.map(([name, licence]) => (
          <li key={name}><span>{name}</span> <span className="muted">{licence}</span></li>
        ))}
      </ul>
    </>
  )
}

interface TocEntry {
  readonly id: SectionId
  readonly label: string
  readonly count: number | null
}

/** What the contents rail has selected: a group heading, or one numbered mnemonic under Mnemonics. */
type TocSelection = { readonly kind: 'section'; readonly id: SectionId } | { readonly kind: 'item'; readonly code: string }

interface TocProps {
  readonly entries: readonly TocEntry[]
  readonly mnemonics: readonly MnemonicDef[]
  readonly selected: TocSelection
  readonly onSection: (id: SectionId) => void
  readonly onItem: (code: string) => void
}

const current = (on: boolean) => (on ? 'true' : undefined)

function TocItems({ mnemonics, selected, onItem }: Pick<TocProps, 'mnemonics' | 'selected' | 'onItem'>) {
  return (
    <ul className="toc-items" aria-label={HELP.mnemonicsHeading}>
      {mnemonics.map((m, i) => (
        <li key={m.code}>
          <button type="button" className="toc-item" aria-current={current(selected.kind === 'item' && selected.code === m.code)} onClick={() => onItem(m.code)} {...roving}>
            <span className="ix"><span className="hot">{`${i + 1})`}</span></span> <span>{m.code}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Toc({ entries, mnemonics, selected, onSection, onItem }: TocProps) {
  return (
    <nav className="help-toc" aria-label={HELP.tocLabel}>
      <ul>
        {entries.map((e) => (
          <li key={e.id} className="toc-group">
            <button type="button" aria-current={current(selected.kind === 'section' && selected.id === e.id)} onClick={() => onSection(e.id)} {...roving}>
              <span>{e.label}</span>
              {e.count !== null ? <span className="count">{e.count}</span> : null}
            </button>
            {e.id === 'mnemonics' ? <TocItems mnemonics={mnemonics} selected={selected} onItem={onItem} /> : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}

interface HelpBarProps {
  readonly root: RefObject<HTMLDivElement | null>
  readonly query: string
  readonly onQueryChange: (value: string) => void
  readonly onSubmit: (value: string) => void
  /** Arrow keys move the highlighted result, Enter chooses it, Escape clears the field (U19). */
  readonly onFieldKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  readonly listId: string
  readonly resultsOpen: boolean
  readonly activeId?: string
}

/** The red bar (spec 7.12): `<Search help>` runs HL with what was typed; `96) Actions`; the page. */
function HelpBar({ root, query, onQueryChange, onSubmit, onFieldKeyDown, listId, resultsOpen, activeId }: HelpBarProps) {
  const actions = usePanelActions()
  const page = usePanelPage(root)
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={HELP.title}
      page={page && page.m > 1 ? page : undefined}
      field={
        <AmberField
          label={HELP.searchLabel}
          placeholder={HELP.searchPlaceholder}
          value={query}
          onChange={onQueryChange}
          onSubmit={onSubmit}
          onKeyDown={onFieldKeyDown}
          combobox={{ listId, expanded: resultsOpen, activeId }}
          width="14em"
        />
      }
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
          ],
        },
      ]}
    />
  )
}

/**
 * Results for HELP's own search field, shown inside the HELP panel as the user types (U19), rather
 * than the command line's own popover, which is anchored under the command line and covered this
 * field until Esc. In normal document flow, directly under the field's row, so it never overlaps
 * anything and is never a page-level overlay a stray click could be caught by. The field above owns
 * this listbox (role=combobox, aria-controls, aria-activedescendant): id, menu and the highlighted
 * row all live in HelpScreen, not here, so the field's keyboard handling and this list agree.
 */
interface HelpSearchResultsProps {
  readonly id: string
  readonly menu: MenuModel | null
  readonly row: number | null
  readonly onChoose: (item: MenuItem) => void
  readonly onClose: () => void
}

function HelpSearchResults({ id, menu, row, onChoose, onClose }: HelpSearchResultsProps) {
  if (!menu) return null
  return (
    <div className="help-search">
      <MenuSheet id={id} menu={menu} row={row} onChoose={onChoose} onClose={onClose} />
    </div>
  )
}

/** `N <GO>` on this panel opens the help of mnemonic N: the same numbers as the index and the rail. */
function useNumberedIndex(panelId: string, mnemonics: readonly MnemonicDef[]) {
  useNumbered(panelId, 'help-index', mnemonics.map((m, i) => ({ n: i + 1, label: m.code, run: () => requestLine(`${m.code} HELP`) })))
}

export default function HelpScreen({ built, mnemonics = MNEMONICS }: HelpScreenProps) {
  const root = useRef<HTMLDivElement>(null)
  const { panelId } = usePanelActions()
  const [selected, setSelected] = useState<TocSelection>({ kind: 'section', id: 'mnemonics' })
  const [query, setQuery] = useState('')
  // A plain Enter (D14) runs HL and hides the in-panel list until the next edit, so a result is
  // never shown twice: once as HL's own history line, once as this field's own list (U19).
  const [submitted, setSubmitted] = useState(false)
  const [row, setRow] = useState<number | null>(null)
  const listId = useId()
  const menu = useMemo(() => (query.trim() === '' || submitted ? null : searchMenu(query, null)), [query, submitted])
  useNumberedIndex(panelId, mnemonics)

  const onItem = (code: string) => {
    setSelected({ kind: 'item', code })
    requestLine(`${code} HELP`)
  }
  const closeResults = () => {
    setQuery('')
    setRow(null)
  }
  // Enter still runs HL on the command line (D14, punctuation queries; kept for command history),
  // but the results themselves come from HelpSearchResults below, inside this panel (U19).
  const submitSearch = (typed: string) => {
    const q = typed.trim()
    requestLine(q === '' ? 'HL' : `HL ${q}`)
    setSubmitted(true)
    setRow(null)
  }
  const onQueryChange = (value: string) => {
    setQuery(value)
    setSubmitted(false)
    setRow(null)
  }
  // A context-taking mnemonic (GP, EQ...) or a chrome word (HL, NO, MENU...) used to loop back to
  // the same search instead of opening anything: setQuery(item.act.line) just re-ran it (#13).
  const chooseSearchResult = (item: MenuItem) => {
    if (item.act.kind === 'run') {
      requestLine(item.act.line)
    } else if (item.act.kind === 'fill') {
      const def = findMnemonic(item.label)
      if (def) onItem(def.code)
      else requestLine(item.label)
    }
    closeResults()
  }
  const moveRow = (dir: 1 | -1) => {
    const count = menu?.items.length ?? 0
    if (count === 0) return
    setRow((r) => (r === null ? (dir === 1 ? 0 : count - 1) : Math.min(Math.max(r + dir, 0), count - 1)))
  }
  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveRow(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (e.key === 'Enter' && row !== null && menu) {
      const item = menu.items[row]
      if (item) {
        e.preventDefault()
        chooseSearchResult(item)
      }
      return
    }
    if (e.key === 'Escape' && query.trim() !== '') {
      e.preventDefault()
      e.stopPropagation()
      closeResults()
    }
  }
  const activeItem = row !== null ? (menu?.items[row] ?? null) : null
  const activeId = activeItem ? menuOptionId(listId, activeItem.n) : undefined
  const toc: readonly TocEntry[] = [
    { id: 'mnemonics', label: HELP.mnemonicsHeading, count: mnemonics.length },
    { id: 'keys', label: HELP.keysHeading, count: HELP_KEYS.length },
    { id: 'links', label: HELP.linkHeading, count: HELP.linkGroups.length },
    { id: 'keyboard', label: HELP.keyboardHeading, count: null },
    { id: 'licences', label: HELP.licencesHeading, count: LICENCES.length },
  ]
  const onSection = (id: SectionId) => {
    setSelected({ kind: 'section', id })
    root.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView?.({ block: 'start' })
  }
  return (
    <>
      <HelpBar
        root={root}
        query={query}
        onQueryChange={onQueryChange}
        onSubmit={submitSearch}
        onFieldKeyDown={onFieldKeyDown}
        listId={listId}
        resultsOpen={menu !== null}
        activeId={activeId}
      />
      <HelpSearchResults id={listId} menu={menu} row={row} onChoose={chooseSearchResult} onClose={closeResults} />
      <div className="help" ref={root}>
        <Toc entries={toc} mnemonics={mnemonics} selected={selected} onSection={onSection} onItem={onItem} />
        <div className="help-body">
          <p className="help-crumb">{HELP.crumb}</p>
          <h3 className="help-title">{HELP.title}</h3>
          <p className="help-intro">{HELP.intro}</p>
          <h4>{HELP.grammarHeading}</h4>
          <p className="help-grammar"><KeyText text={HELP.grammar} /></p>
          <p className="help-examples">
            <span className="muted">{HELP.examplesLabel}: </span>
            {HELP.examples.map((ex) => <CommandLink key={ex} text={ex} />)}
          </p>
          <h4 data-section="mnemonics">{HELP.mnemonicsHeading}</h4>
          <MnemonicIndex mnemonics={mnemonics} built={built} />
          <h4 data-section="keys">{HELP.keysHeading}</h4>
          <KeyTable />
          <h4 data-section="keyboard">{HELP.keyboardHeading}</h4>
          <KeyboardDrawing />
          <h4 data-section="links">{HELP.linkHeading}</h4>
          <p>{HELP.linkText}</p>
          <h4 data-section="licences">{HELP.licencesHeading}</h4>
          <Licences />
        </div>
      </div>
    </>
  )
}
