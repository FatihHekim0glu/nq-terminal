// SEAL (TASKS 9.4; UI_SPEC section 5, P1, and section 6 "Spent window"; look spec 7): the sealed-window
// files of a hypothesis on a screen of their own. The name line, the [SPENT] strip with the API's label
// and, where a confirmation tested the hypothesis, the in-sample against sealed comparison (the DES
// table); then the files as numbered rows (Number <GO> or Show opens one) and the chosen file below:
// CSV through the column allowlist as a table, JSON without price-like keys, markdown as text. A
// confirmation's name shows its parent's files. Every view is spent and descriptive only; nothing is a
// new verdict. `98) Export` saves the file on screen. Every request is a GET.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmations } from '../../api/queries'
import { useHypothesis, useSealedFile, useSealedIndex } from '../../api/queries.screens'
import { requestLine } from '../../chrome/CommandLine.bus'
import { saveText } from '../../chrome/download'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { usePanelPage, type PanelPage } from '../../chrome/PanelChrome.page'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { BOOKS, SEAL } from '../../copy/books'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { EXPORT } from '../../copy/panelParts'
import { BookBar, EmptyGuide, Failed, Loading } from '../cost/BookFrame'
import { NameLine } from '../cost/NameLine'
import DesMarkdown from '../des/DesMarkdown'
import { MISSING, spentStrip, type HypothesisDetail } from '../des/desModel'
import { DesCard, Tag } from '../des/DesParts'
import { Comparison } from '../des/DesSpent'
import { SHOWN_ROWS, cellText, csvRows, sealTarget, sealedExport, sealedFiles, type SealTarget, type SealedFileRow, type SealedView } from './sealModel'

const roving = { [ROVING_ATTR]: '' }

function Bar({ name, page, onExport }: { readonly name: string; readonly page: PanelPage | null; readonly onExport?: () => void }) {
  return (
    <BookBar
      title={SEAL.title}
      mnemonic="SEAL"
      fieldLabel={SEAL.field}
      placeholder={SEAL.placeholder}
      current={name}
      helpLine={SEAL.helpLine}
      page={page}
      onExport={onExport}
      actions={name ? [{ label: BOOKS.actionsDes, onSelect: () => requestLine(`${name} DES`) }] : []}
    />
  )
}

function saveView(view: SealedView): void {
  const out = sealedExport(view)
  if (out.type === 'csv') {
    exportCsv(csvFileName(view.name, SEAL.exportName), out.text, out.rows)
    return
  }
  const file = `${view.name}.${out.type}`
  const saved = saveText(file, out.text, out.type === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8')
  postMessage(saved ? fillCopy(EXPORT.doneOne, { n: 1, file }) : EXPORT.unavailable, saved ? 'info' : 'error')
}

function Files({ name, rows, chosen, onChoose }: { readonly name: string; readonly rows: readonly SealedFileRow[]; readonly chosen: string | null; readonly onChoose: (file: string) => void }) {
  const C = SEAL.filesCols
  return (
    <div className="nqt-grid-scroll">
      <table className="nqt-grid books-table" data-testid="seal-files">
        <caption className="books-note">{fillCopy(SEAL.filesCaption, { name })}</caption>
        <thead>
          <tr>
            <th scope="col" className="num books-no">{C.n}</th>
            <th scope="col">{C.name}</th>
            <th scope="col">{C.kind}</th>
            <th scope="col">{C.label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="num muted books-no">{`${r.n})`}</td>
              <th scope="row" className="name">
                {r.served ? (
                  <button type="button" className="books-pick" aria-pressed={chosen === r.name} aria-label={fillCopy(SEAL.open, { name: r.name })} onClick={() => onChoose(r.name)} {...roving}>
                    {r.name}
                  </button>
                ) : r.name}
              </th>
              <td>{r.kind ?? MISSING}</td>
              <td className={r.served ? undefined : 'muted'}>{r.label ?? SEAL.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CsvTable({ view }: { readonly view: SealedView }) {
  const rows = useMemo(() => csvRows(view, SHOWN_ROWS), [view])
  const columns = view.columns ?? []
  const total = view.n_rows ?? rows.length
  return (
    <>
      <p className="books-note">{fillCopy(SEAL.rows, { n: total.toLocaleString('en-GB') })}</p>
      {total > rows.length ? <p className="books-note">{fillCopy(SEAL.rowsShown, { shown: rows.length, n: total.toLocaleString('en-GB') })}</p> : null}
      <div className="nqt-grid-scroll books-csv">
        <table className="nqt-grid books-table" data-testid="seal-csv" aria-label={fillCopy(SEAL.tableLabel, { name: view.name, n: total })}>
          <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={columns[j] ?? j} className={typeof v === 'number' ? 'num' : undefined}>{cellText(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FileView({ name, onView }: { readonly name: string; readonly onView: (view: SealedView | null) => void }) {
  const query = useSealedFile(name)
  const view = query.data
  // The file on screen is what 98) Export saves; none while it loads or when it fails.
  useEffect(() => {
    onView(view ?? null)
    return () => onView(null)
  }, [view, onView])
  return (
    <DesCard title={fillCopy(SEAL.fileTitle, { name })} testId="seal-file">
      {query.isPending ? <Loading name={name} /> : null}
      {query.isError ? <Failed name={name} error={query.error} /> : null}
      {view ? (
        <>
          <p className="books-note"><Tag tag={DES.spent} /> {view.label}</p>
          {view.kind === 'csv' ? <CsvTable view={view} /> : null}
          {view.kind === 'json' ? (
            <>
              <p className="books-note">{SEAL.jsonNote}</p>
              <pre className="books-json" data-testid="seal-json" tabIndex={0} {...roving}>{JSON.stringify(view.data ?? null, null, 2)}</pre>
            </>
          ) : null}
          {view.kind === 'markdown' ? <DesMarkdown text={view.markdown ?? ''} label={view.name} /> : null}
        </>
      ) : null}
    </DesCard>
  )
}

function Sealed({ target, detail, onView }: { readonly target: SealTarget; readonly detail: HypothesisDetail; readonly onView: (view: SealedView | null) => void }) {
  const index = useSealedIndex()
  const confirmations = useConfirmations()
  const actions = usePanelActions()
  const { card } = detail
  const rows = useMemo(() => sealedFiles(card, index.data), [card, index.data])
  const strip = useMemo(() => spentStrip(card, confirmations.data, index.data), [card, confirmations.data, index.data])
  const [chosen, setChosen] = useState<string | null>(null)
  const numbered = useMemo<NumberedItem[]>(() => rows.filter((r) => r.served).map((r) => ({ n: r.n, label: r.name, run: () => setChosen(r.name) })), [rows])
  useNumbered(actions.panelId, 'seal-files', numbered)
  return (
    <div className="books-page">
      <NameLine card={card} />
      {target.confirmation ? <p className="books-note">{fillCopy(SEAL.confirmationOf, { name: target.confirmation, parent: card.name })}</p> : null}
      {rows.length === 0 ? <p className="books-status">{fillCopy(SEAL.none, { name: card.name })}</p> : (
        <>
          <section className="des-spent" aria-label={DES.spentStrip} data-testid="seal-spent">
            <h3 className="des-spent-title">
              <Tag tag={DES.spent} /> <span>{DES.spentStrip}</span> <span className="des-spent-label">{strip?.label ?? DES.spentLabelFallback}</span>
            </h3>
            {strip && strip.confirmations.length > 0 ? <div className="des-spent-body"><Comparison card={card} strip={strip} /></div> : null}
          </section>
          <DesCard title={fillCopy(SEAL.filesTitle, { name: card.name })}>
            {index.isError ? <Failed name={card.name} error={index.error} /> : null}
            <Files name={card.name} rows={rows} chosen={chosen} onChoose={setChosen} />
          </DesCard>
          {chosen ? <FileView key={chosen} name={chosen} onView={onView} /> : <p className="books-note">{SEAL.pick}</p>}
        </>
      )}
    </div>
  )
}

function SealedHypothesis({ target, page }: { readonly target: SealTarget; readonly page: PanelPage | null }) {
  const query = useHypothesis(target.hypothesis)
  const [view, setView] = useState<SealedView | null>(null)
  const shown = target.confirmation ?? target.hypothesis
  return (
    <>
      <Bar name={shown} page={page} onExport={view ? () => saveView(view) : undefined} />
      {query.isPending ? <Loading name={target.hypothesis} /> : null}
      {query.isError ? <Failed name={target.hypothesis} error={query.error} /> : null}
      {query.data ? <Sealed target={target} detail={query.data} onView={setView} /> : null}
    </>
  )
}

function SealRoute({ name, page }: { readonly name: string; readonly page: PanelPage | null }) {
  const confirmations = useConfirmations()
  if (confirmations.isPending) return <><Bar name={name} page={page} /><Loading name={name} /></>
  if (confirmations.isError) {
    return (
      <>
        <Bar name={name} page={page} />
        <p className="books-status books-error" role="alert">{fillCopy(BOOKS.confirmationsFailed, { name, detail: confirmations.error.detail })}</p>
      </>
    )
  }
  return <SealedHypothesis target={sealTarget(name, confirmations.data)} page={page} />
}

export default function SealScreen({ context }: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const name = context?.kind === 'hypothesis' ? context.value : null
  return (
    <div className="books" ref={ref} role="group" aria-label={name ? `${SEAL.title} ${name}` : SEAL.title}>
      {name ? <SealRoute key={name} name={name} page={page} /> : (
        <>
          <Bar name="" page={page} />
          <EmptyGuide text={SEAL.empty} />
        </>
      )}
    </div>
  )
}
