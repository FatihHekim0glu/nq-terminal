// HELP (look spec 7.12; UI_SPEC sections 5 and 7). The red function bar (an amber `<Search help>`
// field that runs HL, `96) Actions`, `Page n/m`, the title), a contents rail on the left, and a body
// that shows either the index (HelpIndex) or one function's help page (HelpTopicPage). A contents item,
// its number and <GO>, a related function on a page, or a request from elsewhere (helpTopic.store:
// `MNEM HELP`, F1) opens a page; the Mnemonics heading or `Back to the help index` returns.
// Number <GO>: 1 to 30 open that function's page; on a page, 41 on run its examples and 51 on open
// its related functions' pages.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { requestLine, commandLinkLine } from '../../chrome/CommandLine.bus'
import { AmberField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import { MNEMONICS, type MnemonicCode, type MnemonicDef } from '../../commands/registry'
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

/** The red bar: `<Search help>` runs HL with what was typed; `96) Actions`; the page indicator. */
function HelpBar({ root }: { readonly root: RefObject<HTMLDivElement | null> }) {
  const actions = usePanelActions()
  const page = usePanelPage(root)
  const [query, setQuery] = useState('')
  const search = (typed: string) => {
    const q = typed.trim()
    requestLine(q === '' ? 'HL' : `HL ${q}`)
  }
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={HELP.title}
      page={page && page.m > 1 ? page : undefined}
      field={<AmberField label={HELP.searchLabel} placeholder={HELP.searchPlaceholder} value={query} onChange={setQuery} onSubmit={search} width="14em" />}
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
      <HelpBar root={root} />
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
