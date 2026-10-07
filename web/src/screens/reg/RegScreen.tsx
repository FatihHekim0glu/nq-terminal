// REG, the registry board (TASKS 6.1; UI_SPEC 7 "REG and MT"; look spec 7.2, modelled on the equity
// screening layout): red function bar with an amber filter field and 96) Actions, 97) Settings,
// 98) Export; a round rail on the left; the selected screening criteria with their matches (counts
// from GET /api/registry); a sub tab strip (91) Board, 92) Evidence, roadmap #5) outside HOME's REG
// cell, which stays the plain board it always was; the MonitorGrid of every registry row (name,
// round, verdict badge, n, p, control p, Bonferroni, Holm, BH q, spec sha with the registry and
// re-hash status, the tag (edge, [OVERLAY], check) and the amendments); the accepted amendments
// re-hashed now; and the sealed confirmations in their own block with their own alpha. Enter, a
// double click or Number <GO> on a row opens DES for it. The DSR column is SV3's Deflated Sharpe
// ([POST HOC], an extra view only, never a verdict) from GET /api/analytics/deflated. Space marks up to
// eight rows (the basket, also in HOME's REG cell); 95) Compare n then replaces the views with RegCompare,
// their served Basis A screen series, and 97) Settings can clear the basket. While the record watch has
// marked a registry row (roadmap 16), a Seen column first on the board shows NEW or CHG for it. The
// registry's own error and loading lines are PanelFault and PanelLoading. A polite status line (RegStaleBanner, V031)
// says when the registry is older than the newest result or spec. Read only.
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConfirmations, useDeflated, useHypotheses, useMultipleTesting, useRegistry } from '../../api/queries'
import { AmberField } from '../../chrome/Field'
import { useWatchMarks } from '../../chrome/RecordWatch.marks'
import { switchKeepingFocus } from '../../chrome/keepFocus'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import PanelFault, { PanelLoading } from '../../chrome/PanelFault'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { DEFLATED } from '../../copy/deflated'
import { EVIDENCE, REG_VIEW_COPY } from '../../copy/evidence'
import { REG } from '../../copy/reg'
import { SPEC } from '../../copy/tiles'
import MonitorGrid, { type OpenOptions } from '../../grids/MonitorGrid'
import { gridWidth, useElementWidth } from '../../grids/useElementWidth'
import { saveText, sayWhenSaved } from '../../chrome/download'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { toggleMark } from '../runs/basket'
import { regBoardColumns, regRowId } from './regColumns'
import { buildRegRows, confirmationRows, criteria, filterRows, roundGroups, toCsv, type CriterionId, type RegRow, type RoundKey } from './regModel'
import { evidenceCsv } from './evidenceModel'
import { openDes } from './open'
import RegCompare from './RegCompare'
import RegStaleBanner from './RegStaleBanner'
import { AcceptanceBlock, ConfirmBlock, CriteriaBlock, RoundRail, RuleNote, VerdictNotes } from './RegParts'
import { withDeflated } from './deflatedModel'
import { needsDeflated, viewsShown, REG_VIEWS, REG_VIEW_START, type RegView } from './regViews'
import { RegViewBody, useEvidenceData } from './RegViewBody'
import './reg.css'

type FilterCriterion = Exclude<CriterionId, 'rows'>

interface BarProps {
  readonly actions: PanelActions
  readonly filter: string
  readonly onFilter: (text: string) => void
  readonly showChecks: boolean
  readonly onShowChecks: (show: boolean) => void
  readonly onClear: () => void
  /** Hypotheses in the compare basket; 95) Compare is disabled while there are none. */
  readonly basketCount: number
  readonly onCompare: () => void
  readonly onClearBasket: () => void
  readonly onExport: () => void
  /** Set only on 92) Evidence: 98) Export then also offers the evidence matrix as its own CSV. */
  readonly onExportEvidence?: () => void
}

function RegBar({ actions, filter, onFilter, showChecks, onShowChecks, onClear, basketCount, onCompare, onClearBasket, onExport, onExportEvidence }: BarProps) {
  const items: FunctionBarItem[] = [
    {
      n: FUNCTION_NUMBERS.compare,
      label: basketCount === 0 ? FUNCTION_BAR.compare : fillCopy(REG.compare.bar, { n: basketCount }),
      onRun: onCompare,
      disabled: basketCount === 0,
    },
    {
      n: FUNCTION_NUMBERS.actions,
      label: FUNCTION_BAR.actions,
      menu: [
        { label: REG.actions.openMt, onSelect: () => actions.open('MT') },
        { label: PANEL.related, onSelect: () => actions.related() },
        { label: PANEL.back, onSelect: () => actions.back() },
        { label: PANEL.forward, onSelect: () => actions.forward() },
      ],
    },
    {
      n: FUNCTION_NUMBERS.settings,
      label: FUNCTION_BAR.settings,
      menu: [
        { label: showChecks ? REG.settings.hideChecks : REG.settings.showChecks, onSelect: () => onShowChecks(!showChecks) },
        { label: REG.settings.clear, onSelect: onClear },
        { label: REG.compare.clear, onSelect: onClearBasket },
      ],
    },
    {
      n: FUNCTION_NUMBERS.export,
      label: FUNCTION_BAR.export,
      menu: [
        { label: REG.export.csv, onSelect: onExport },
        ...(onExportEvidence ? [{ label: EVIDENCE.export.csv, onSelect: onExportEvidence }] : []),
      ],
    },
  ]
  const field = <AmberField label={REG.filterLabel} value={filter} onChange={onFilter} placeholder={REG.filterPlaceholder} width="15em" />
  return <FunctionBar panelId={actions.panelId} title={REG.title} items={items} field={field} />
}

function exportRows(rows: readonly RegRow[]): void {
  const saved = saveText(REG.export.fileName, toCsv(rows))
  void sayWhenSaved(saved, { saved: fillCopy(REG.export.done, { file: REG.export.fileName }), unavailable: REG.export.unavailable })
}

/** `withDsr`: whether this render needs SV3's Deflated Sharpe (needsDeflated: the active view and
 *  whether the panel is compact), so a narrow panel showing only the board never asks for it. */
function useRegData(withDsr: boolean) {
  const registry = useRegistry()
  const cards = useHypotheses()
  const mt = useMultipleTesting()
  const confirmations = useConfirmations()
  const deflated = useDeflated(withDsr)
  const rows = useMemo(
    () => (registry.data && (cards.data || cards.isError) ? withDeflated(buildRegRows(registry.data, cards.data ?? []), deflated.data) : null),
    [registry.data, cards.data, cards.isError, deflated.data],
  )
  const confirmRows = useMemo(() => (confirmations.data ? confirmationRows(confirmations.data) : null), [confirmations.data])
  return { registry, cards, alpha: mt.data?.alpha ?? null, rows, confirmations, confirmRows, deflated: deflated.data }
}

interface Filters {
  readonly text: string
  readonly round: RoundKey
  readonly criterion: FilterCriterion | null
  readonly showChecks: boolean
}

const NO_FILTER: Filters = { text: '', round: 'all', criterion: null, showChecks: true }

/** The rows the filters keep, the round rail and the criteria counts. */
function useRegView(data: ReturnType<typeof useRegData>, f: Filters) {
  const { registry, rows, alpha } = data
  const shown = useMemo(() => {
    if (!rows) return []
    const kept = filterRows(rows, { text: f.text, round: f.round, criterion: f.criterion, alpha })
    return f.showChecks ? kept : kept.filter((r) => r.badge !== 'CHECK')
  }, [rows, f, alpha])
  const groups = useMemo(() => (rows ? roundGroups(rows) : []), [rows])
  const crit = useMemo(() => (registry.data && rows ? criteria(registry.data.counts, rows, alpha) : []), [registry.data, rows, alpha])
  return { shown, groups, crit }
}

export default function RegScreen(props: ScreenProps) {
  const actions = usePanelActions()
  const views = viewsShown(actions.panelId)
  const [view, setView] = useState<RegView>('board')
  const active = views ? view : 'board'
  const viewId = useId()
  const main = useElementWidth()
  // A clean watch adds no column, so the narrow threshold sits where it always did; with marks it counts
  // the 44 px Seen column too, so the full set never overflows the panel.
  const watchMarks = useWatchMarks('registry')
  const fullColumns = useMemo(() => regBoardColumns(watchMarks, false), [watchMarks])
  const compact = main.width !== null && main.width < gridWidth(fullColumns)
  const boardColumns = useMemo(() => (compact ? regBoardColumns(watchMarks, true) : fullColumns), [compact, watchMarks, fullColumns])
  const data = useRegData(main.width !== null && needsDeflated(active, compact))
  const { registry, cards, rows, confirmations, confirmRows } = data
  const [f, setF] = useState<Filters>(NO_FILTER)
  const { shown, groups, crit } = useRegView(data, f)
  const [basket, setBasket] = useState<readonly string[]>([])
  const [comparing, setComparing] = useState(false)
  const showCompare = comparing && basket.length > 0
  const marked = useMemo(() => new Set(basket), [basket])
  const onMark = useCallback(
    (row: RegRow) => {
      const next = toggleMark(basket, regRowId(row))
      if (next.full) postMessage(REG.compare.full, 'error')
      else setBasket(next.ids)
    },
    [basket],
  )
  const clearBasket = () => {
    setBasket([])
    setComparing(false)
  }
  // Back unmounts the focused button, so hand keyboard focus to the selected tab, or to the board grid where
  // the panel has no tab strip (HOME's REG cell). clearBasket keeps its 97) Settings button, which stays mounted.
  const rootRef = useRef<HTMLDivElement>(null)
  const backToBoard = useCallback(
    () => switchKeepingFocus(rootRef.current, '[role="tab"][aria-selected="true"], [role="grid"]', () => setComparing(false)),
    [],
  )
  const evidenceData = useEvidenceData(active, { rows, shown, cards: cards.data, confirmations: confirmations.data, deflated: data.deflated })
  const onOpen = useCallback((row: RegRow, options?: OpenOptions) => openDes(row.name, options), [])
  const tag = <span className="reg-tag">{SPEC.preReg}</span>

  const board: ReactNode = (
    <>
      <div className="reg-grid">
        <MonitorGrid label={REG.gridLabel} rows={shown} columns={boardColumns} rowId={regRowId} rowLabel={regRowId} onOpen={onOpen} emptyText={REG.empty} scroll="panel" tabStop marked={marked} onMark={onMark} />
      </div>
      {compact ? <p className="reg-msg reg-muted">{REG.compactNote}</p> : <RuleNote />}
      {data.deflated && !compact ? <p className="reg-msg reg-muted reg-dsr-note">{fillCopy(DEFLATED.regNote, { n: data.deflated.n_trials })}</p> : null}
      <VerdictNotes rows={shown} />
      <AcceptanceBlock acceptances={registry.data?.acceptances} />
      <ConfirmBlock
        panelId={actions.panelId}
        rows={confirmRows}
        error={confirmations.isError ? confirmations.error : null}
        onOpen={openDes}
      />
    </>
  )

  return (
    <div className="reg-screen" data-screen="REG" ref={rootRef}>
      <RegBar
        actions={actions}
        filter={f.text}
        onFilter={(text) => setF((x) => ({ ...x, text }))}
        showChecks={f.showChecks}
        onShowChecks={(showChecks) => setF((x) => ({ ...x, showChecks }))}
        onClear={() => setF(NO_FILTER)}
        basketCount={basket.length}
        onCompare={() => setComparing(true)}
        onClearBasket={clearBasket}
        onExport={() => exportRows(shown)}
        onExportEvidence={
          active === 'evidence' && evidenceData.evidence
            ? () => {
                const ev = evidenceData.evidence!
                exportCsv(csvFileName(EVIDENCE.export.fileName), evidenceCsv(ev), ev.length)
              }
            : undefined
        }
      />
      {views && !showCompare ? (
        <TabStrip
          panelId={actions.panelId}
          label={REG_VIEW_COPY.label}
          variant="sub"
          start={REG_VIEW_START}
          controls={rows !== null && !registry.isError ? viewId : undefined}
          tabs={REG_VIEWS.map((v) => ({ id: v, label: REG_VIEW_COPY[v] }))}
          selected={active}
          onSelect={(id) => setView(id as RegView)}
        />
      ) : null}
      <RegStaleBanner registry={registry.data} />
      {registry.isError ? (
        <PanelFault error={registry.error} failedText={REG.failed} onRetry={() => void registry.refetch()} className="reg-msg" />
      ) : rows === null ? (
        <PanelLoading text={REG.loading} className="reg-msg" />
      ) : showCompare ? (
        <RegCompare names={basket} link={props.params.group} onBack={backToBoard} />
      ) : (
        <div className="reg-body">
          <RoundRail panelId={actions.panelId} groups={groups} selected={f.round} onSelect={(round) => setF((x) => ({ ...x, round }))} />
          <div className="reg-main" ref={main.ref}>
            <CriteriaBlock
              panelId={actions.panelId}
              items={crit}
              selected={f.criterion}
              onToggle={(id) => setF((x) => ({ ...x, criterion: x.criterion === id ? null : id }))}
              tag={tag}
            />
            {cards.isError ? <p className="reg-msg down">{fillCopy(REG.cardsFailed, { detail: cards.error.detail })}</p> : null}
            <div
              id={viewId}
              role={views ? 'tabpanel' : undefined}
              aria-label={views ? `${REG_VIEW_START + REG_VIEWS.indexOf(active)}) ${REG_VIEW_COPY[active]}` : undefined}
              className="reg-view"
            >
              <RegViewBody
                view={active}
                board={board}
                evidence={evidenceData.evidence}
                width={main.width}
                panelId={actions.panelId}
                rows={shown}
                details={evidenceData.details}
                deflated={data.deflated}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
