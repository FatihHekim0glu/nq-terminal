// BLK (TASKS 9.4; UI_SPEC section 5, P1; look spec 7): the blocks of a hypothesis on a screen of their
// own. The red bar with the amber hypothesis field, the name line (cyan name, verdict, tag), then the
// blocks as a numbered table beside the DES bar ladder. Every value is the screen JSON's own, from
// GET /api/hypotheses/{name}, printed exactly as DES prints it; `98) Export` saves them at full precision.
// A sealed-window confirmation has no in-sample blocks and says where to look instead.
import { useMemo, useRef } from 'react'
import { useHypothesis } from '../../api/queries.screens'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { requestLine } from '../../chrome/CommandLine.bus'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { usePanelPage, type PanelPage } from '../../chrome/PanelChrome.page'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { BLK, BOOKS } from '../../copy/books'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { BookBar, EmptyGuide, Failed, HypothesisRoute, Loading, type Confirmation } from '../cost/BookFrame'
import { NameLine } from '../cost/NameLine'
import { MISSING, blocksInput, type HypothesisDetail } from '../des/desModel'
import { DesCard } from '../des/DesParts'
import { blockRows, ladderCsv } from './ladder'
import LadderTable from './LadderTable'

function Blocks({ detail }: { readonly detail: HypothesisDetail }) {
  const { card, des } = detail
  const rows = useMemo(() => blockRows(des), [des])
  const ladder = useMemo(() => blocksInput(des, card.name), [des, card.name])
  const unit = des.blocks_unit ?? MISSING
  return (
    <div className="books-page">
      <NameLine card={card} />
      <p className="books-note">{BOOKS.basis}</p>
      {rows.length === 0 ? <p className="books-status">{fillCopy(BLK.none, { name: card.name })}</p> : (
        <div className="books-cols">
          <DesCard title={fillCopy(DES.blocksName, { name: card.name })}>
            <LadderTable caption={fillCopy(BLK.caption, { name: card.name, unit })} columns={{ n: BLK.cols.n, label: BLK.cols.block, value: BLK.cols.value }} rows={rows} testId="blk-table" />
          </DesCard>
          <DesCard title={fillCopy(BOOKS.unit, { unit })}>
            {ladder ? <div className="books-ladder"><BarLadder data={ladder} chartId="blk-ladder" /></div> : null}
          </DesCard>
        </div>
      )}
    </div>
  )
}

function exportBlocks(detail: HypothesisDetail): void {
  const rows = blockRows(detail.des)
  exportCsv(csvFileName(detail.card.name, BLK.exportName), ladderCsv([BLK.cols.block, BLK.cols.value], rows), rows.length)
}

function HypothesisBlocks({ name, page }: { readonly name: string; readonly page: PanelPage | null }) {
  const query = useHypothesis(name)
  const detail = query.data
  return (
    <>
      <Bar name={name} page={page} onExport={detail && detail.des.blocks.length > 0 ? () => exportBlocks(detail) : undefined} />
      {query.isPending ? <Loading name={name} /> : null}
      {query.isError ? <Failed name={name} error={query.error} /> : null}
      {detail ? <Blocks detail={detail} /> : null}
    </>
  )
}

function ConfirmationBlocks({ conf, page }: { readonly conf: Confirmation; readonly page: PanelPage | null }) {
  return (
    <>
      <Bar name={conf.name} page={page} />
      <p className="books-status">{fillCopy(BLK.confirmation, { name: conf.name, parent: conf.parent ?? MISSING })}</p>
    </>
  )
}

function Bar({ name, page, onExport }: { readonly name: string; readonly page: PanelPage | null; readonly onExport?: () => void }) {
  return (
    <BookBar
      title={BLK.title}
      mnemonic="BLK"
      fieldLabel={BLK.field}
      placeholder={BLK.placeholder}
      current={name}
      helpLine={BLK.helpLine}
      page={page}
      onExport={onExport}
      actions={name ? [{ label: BOOKS.actionsDes, onSelect: () => requestLine(`${name} DES`) }] : []}
    />
  )
}

export default function BlkScreen({ context }: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const name = context?.kind === 'hypothesis' ? context.value : null
  return (
    <div className="books" ref={ref} role="group" aria-label={name ? `${BLK.title} ${name}` : BLK.title}>
      {name ? (
        <HypothesisRoute
          key={name}
          name={name}
          confirmation={(conf) => <ConfirmationBlocks conf={conf} page={page} />}
          hypothesis={(n) => <HypothesisBlocks name={n} page={page} />}
        />
      ) : (
        <>
          <Bar name="" page={page} />
          <EmptyGuide text={BLK.empty} />
        </>
      )}
    </div>
  )
}
