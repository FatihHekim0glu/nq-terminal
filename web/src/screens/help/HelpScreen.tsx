// HELP (look spec 7.12; UI_SPEC sections 5 and 7). The red function bar (an amber `<Search help>`
// field that runs HL, `96) Actions`, `Page n/m`, the title), a contents rail on the left, and a body
// that shows either the index (HelpIndex) or one function's help page (HelpTopicPage). A contents item,
// its number and <GO>, a related function on a page, or a request from elsewhere (helpTopic.store:
// `MNEM HELP`, F1) opens a page; the Mnemonics heading or `Back to the help index` returns.
// Number <GO>: 1 to 30 open that function's page; on a page, 41 on run its examples and 51 on open
// its related functions' pages. Typing in `<Search help>` lists matches inside this panel (U19).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { requestLine, commandLinkLine } from '../../chrome/CommandLine.bus'
import { menuOptionId, MenuSheet } from '../../chrome/CommandLine.menu'
import { searchMenu, type MenuItem, type MenuModel } from '../../chrome/CommandLine.menus'
import { AmberField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import { findMnemonic, MNEMONICS, type MnemonicCode, type MnemonicDef } from '../../commands/registry'
import { HELP, HELP_KEYS } from '../../copy/help'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL } from '../../copy/workspace'
import HelpIndex, { LICENCES } from './HelpIndex'
import HelpToc, { type SectionId, type TocEntry, type TocSelection } from './HelpToc'
import HelpTopicPage from './HelpTopicPage'
import { useHelpTopic } from './helpTopic.store'
import { FIRST_EXAMPLE, FIRST_RELATED, topicFor } from './helpTopics'
import '../../chrome/HelpScreen.css'
import './help.css'

export interface HelpScreenProps {
  /** Mnemonics whose screen is built; the rest are listed as placeholders. */
  readonly built: ReadonlySet<MnemonicCode | string>
  /** The index to list; the registry unless a test passes another. */
  readonly mnemonics?: readonly MnemonicDef[]
}

/** HELP's own search (U19): the field's text, its matches and the highlighted one, all owned here so the
 * field (a combobox) and the list it controls always agree. */
interface HelpSearch {
  readonly query: string
  readonly onQueryChange: (value: string) => void
  readonly onSubmit: (value: string) => void
  /** Up and Down move the highlight, Enter chooses it, Escape clears the field. */
  readonly onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  readonly listId: string
  readonly menu: MenuModel | null
  readonly row: number | null
  readonly activeId?: string
  readonly choose: (item: MenuItem) => void
  readonly close: () => void
}

/**
 * The field's matches, inside the HELP panel under the red bar and in normal flow (U19): the command
 * line's own popover is anchored under the command line and covered this field until Esc.
 */
function HelpSearchResults({ search }: { readonly search: HelpSearch }) {
  if (!search.menu) return null
  return (
    <div className="help-search">
      <MenuSheet id={search.listId} menu={search.menu} row={search.row} onChoose={search.choose} onClose={search.close} />
    </div>
  )
}

/**
 * The search state. A plain Enter still runs HL on the command line (D14, and its history line) and hides
 * the list until the next edit, so the results never show twice. Choosing a match (U19; #13: a function
 * that takes a context, or a chrome word, used to loop back into the same search): a function with no
 * context runs its line; one that takes a context opens its help page here, as the contents rail does;
 * a chrome word (HL, NXTW, MENU...) runs itself.
 */
function useHelpSearch(openTopic: (code: MnemonicCode) => void): HelpSearch {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [row, setRow] = useState<number | null>(null)
  const listId = useId()
  const menu = useMemo(() => (query.trim() === '' || submitted ? null : searchMenu(query, null)), [query, submitted])
  const close = () => {
    setQuery('')
    setRow(null)
  }
  const choose = (item: MenuItem) => {
    if (item.act.kind === 'run') requestLine(item.act.line)
    else if (item.act.kind === 'fill') {
      const def = findMnemonic(item.label)
      if (def) openTopic(def.code)
      else requestLine(item.label)
    }
    close()
  }
  const onSubmit = (typed: string) => {
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
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = menu?.items.length ?? 0
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (count === 0) return
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setRow((r) => (r === null ? (dir === 1 ? 0 : count - 1) : Math.min(Math.max(r + dir, 0), count - 1)))
      return
    }
    if (e.key === 'Enter' && row !== null) {
      const item = menu?.items[row]
      if (item) {
        e.preventDefault()
        choose(item)
      }
      return
    }
    // Kept from the command line's window listener (it leaves a defaultPrevented Esc alone), so clearing
    // the field does not also move focus to the command line.
    if (e.key === 'Escape' && query.trim() !== '') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  const active = row !== null ? menu?.items[row] : undefined
  return {
    query, onQueryChange, onSubmit, onKeyDown, listId, menu, row, choose, close,
    activeId: active ? menuOptionId(listId, active.n) : undefined,
  }
}

/** The red bar: `<Search help>` (matches below as you type; Enter runs HL); `96) Actions`; the page indicator. */
function HelpBar({ root, search }: { readonly root: RefObject<HTMLDivElement | null>; readonly search: HelpSearch }) {
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
          value={search.query}
          onChange={search.onQueryChange}
          onSubmit={search.onSubmit}
          onKeyDown={search.onKeyDown}
          combobox={{ listId: search.listId, expanded: search.menu !== null, activeId: search.activeId }}
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

/** Number <GO> for the panel: the index numbers always; a page's examples and related functions too. */
function numberedItems(mnemonics: readonly MnemonicDef[], topic: MnemonicCode | null, open: (code: MnemonicCode) => void): NumberedItem[] {
  const index = mnemonics.map((m, i) => ({ n: i + 1, label: m.code, run: () => open(m.code) }))
  if (!topic) return index
  const { copy } = topicFor(topic)
  const examples = copy.examples.flatMap((ex, i) => {
    const line = commandLinkLine(ex)
    return line ? [{ n: FIRST_EXAMPLE + i, label: line, run: () => requestLine(line) }] : []
  })
  const related = copy.related.map((code, i) => ({ n: FIRST_RELATED + i, label: `${code} HELP`, run: () => open(code as MnemonicCode) }))
  return [...index, ...examples, ...related]
}

/** Opens the topic another part of the terminal asked for, then clears the request. */
function useTopicRequests(open: (code: MnemonicCode) => void) {
  const request = useHelpTopic((s) => s.request)
  useEffect(() => {
    if (!request) return
    open(request.code)
    useHelpTopic.setState({ request: null })
  }, [request, open])
}

export default function HelpScreen({ built, mnemonics = MNEMONICS }: HelpScreenProps) {
  const root = useRef<HTMLDivElement>(null)
  const { panelId } = usePanelActions()
  const [selected, setSelected] = useState<TocSelection>({ kind: 'section', id: 'mnemonics' })
  const [scrollTo, setScrollTo] = useState<SectionId | 'top' | null>(null)
  const topic = selected.kind === 'item' ? selected.code : null
  const openRef = useRef((code: MnemonicCode) => {
    setSelected({ kind: 'item', code })
    setScrollTo('top')
  })
  const open = openRef.current
  const search = useHelpSearch(open)
  useTopicRequests(open)
  useNumbered(panelId, 'help-index', numberedItems(mnemonics, topic, open))
  useLayoutEffect(() => {
    if (!scrollTo) return
    const target = scrollTo === 'top' ? root.current : root.current?.querySelector(`[data-section="${scrollTo}"]`)
    target?.scrollIntoView?.({ block: 'start' })
    setScrollTo(null)
  }, [scrollTo])
  const toc: readonly TocEntry[] = [
    { id: 'mnemonics', label: HELP.mnemonicsHeading, count: mnemonics.length },
    { id: 'keys', label: HELP.keysHeading, count: HELP_KEYS.length },
    { id: 'links', label: HELP.linkHeading, count: HELP.linkGroups.length },
    { id: 'keyboard', label: HELP.keyboardHeading, count: null },
    { id: 'licences', label: HELP.licencesHeading, count: LICENCES.length },
  ]
  const onSection = (id: SectionId) => {
    setSelected({ kind: 'section', id })
    setScrollTo(id)
  }
  return (
    <>
      <HelpBar root={root} search={search} />
      <HelpSearchResults search={search} />
      <div className="help" ref={root}>
        <HelpToc entries={toc} mnemonics={mnemonics} selected={selected} onSection={onSection} onItem={open} />
        <div className="help-body">
          {topic ? (
            <HelpTopicPage code={topic} built={built} onTopic={open} onIndex={() => onSection('mnemonics')} />
          ) : (
            <HelpIndex mnemonics={mnemonics} built={built} />
          )}
        </div>
      </div>
    </>
  )
}
