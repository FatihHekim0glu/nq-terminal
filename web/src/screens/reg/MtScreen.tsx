// MT, the multiple-testing view (TASKS 6.1; UI_SPEC 7 "REG and MT"; ANALYTICS_CATALOG SV4): the family
// line (k, alpha, stored against recomputed), sorted p against rank (PScatter) with the Bonferroni,
// Holm and BH lines, a check that those drawn lines are the API's lines at every rank, the table of
// stored adjusted values, and the sealed confirmations listed apart with their own alpha. Enter on a
// table row opens DES. One GET: /api/multiple-testing.
import { useCallback, useMemo, useState } from 'react'
import { useMultipleTesting } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { PScatter } from '../../charts/echarts/PScatter'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { CONFIRM, MT } from '../../copy/reg'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid from '../../grids/MonitorGrid'
import { MT_COLUMNS, mtRowId } from './regColumns'
import { badgeText, confirmationRows, formatCount, formatPValue, verdictTone } from './regModel'
import { boundaryCheck, buildMtRows, familyLine, linesLine, mtScatterInput, type MtRow, type PScale } from './mtModel'
import { openDes } from './open'
import './reg.css'

function MtBar({ actions, scale, onScale }: { readonly actions: PanelActions; readonly scale: PScale; readonly onScale: (s: PScale) => void }) {
  const items: FunctionBarItem[] = [
    {
      n: FUNCTION_NUMBERS.actions,
      label: FUNCTION_BAR.actions,
      menu: [
        { label: MT.actions.openReg, onSelect: () => actions.open('REG') },
        { label: PANEL.related, onSelect: () => actions.related() },
        { label: PANEL.back, onSelect: () => actions.back() },
        { label: PANEL.forward, onSelect: () => actions.forward() },
      ],
    },
    {
      n: FUNCTION_NUMBERS.settings,
      label: FUNCTION_BAR.settings,
      menu: [{ label: scale === 'log' ? MT.settings.linear : MT.settings.log, onSelect: () => onScale(scale === 'log' ? 'linear' : 'log') }],
    },
  ]
  return <FunctionBar panelId={actions.panelId} title={MT.title} items={items} />
}

function FamilyHead({ mt }: { readonly mt: Schemas['MultipleTesting'] }) {
  const check = useMemo(() => boundaryCheck(mt), [mt])
  return (
    <section className="mt-head" aria-label={MT.familyLabel}>
      <p className="mt-line">
        <span>{familyLine(mt)}</span>{' '}
        <span className={check.ok ? 'reg-ok' : 'down'}>{linesLine(check)}</span>
      </p>
      <p className="mt-line reg-muted">
        <span className="reg-tag">{`[${MT.storedTag}]`}</span> <span>{MT.storedTagNote}</span>{'  '}
        <span className="reg-tag">{`[${MT.computedTag}]`}</span> <span>{MT.computedTagNote}</span>
      </p>
    </section>
  )
}

function MtConfirmations({ list }: { readonly list: readonly Schemas['Confirmation'][] }) {
  const rows = useMemo(() => confirmationRows(list), [list])
  return (
    <section className="reg-confirm mt-confirm" aria-label={CONFIRM.label}>
      <p className="reg-band">
        <span className="reg-band-title">{CONFIRM.heading}</span>{' '}
        <span className="reg-warn">{`[${CONFIRM.spent}]`}</span>{' '}
        <span className="reg-muted">{CONFIRM.note}</span>
      </p>
      {rows.length === 0 ? <p className="reg-msg">{CONFIRM.empty}</p> : (
        <ul className="mt-confirm-list">
          {rows.map((r) => (
            <li key={r.name}>
              <span className="name">{r.name}</span>{' '}
              <span className={verdictTone(r.badge)}>{badgeText(r.badge)}</span>{' '}
              <span>{fillCopy(MT.confirmItem, {
                opening: r.closed ? CONFIRM.closed : CONFIRM.open,
                p: formatPValue(r.p),
                n: formatCount(r.n),
                alpha: fillCopy(CONFIRM.ownAlpha, { alpha: r.alpha === null ? '--' : String(r.alpha) }),
              })}</span>{' '}
              <span className="reg-muted">{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MtBody({ mt, scale }: { readonly mt: Schemas['MultipleTesting']; readonly scale: PScale }) {
  const input = useMemo(() => mtScatterInput(mt, scale), [mt, scale])
  const rows = useMemo(() => buildMtRows(mt), [mt])
  const onOpen = useCallback((row: MtRow) => openDes(row.name), [])
  return (
    <div className="mt-body">
      <FamilyHead mt={mt} />
      <div className="mt-chart">
        {mt.rows.length === 0 ? <p className="reg-msg">{MT.empty}</p> : <PScatter data={input} chartId={MT.chartId} />}
      </div>
      <div className="mt-grid">
        <MonitorGrid label={MT.gridLabel} rows={rows} columns={MT_COLUMNS} rowId={mtRowId} onOpen={onOpen} emptyText={MT.empty} />
      </div>
      <MtConfirmations list={mt.confirmations} />
    </div>
  )
}

export default function MtScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const mt = useMultipleTesting()
  const [scale, setScale] = useState<PScale>('log')
  return (
    <div className="reg-screen" data-screen="MT">
      <MtBar actions={actions} scale={scale} onScale={setScale} />
      {mt.isError ? (
        <p className="reg-msg down" role="alert">{fillCopy(MT.failed, { detail: mt.error.detail })}</p>
      ) : mt.data ? (
        <MtBody mt={mt.data} scale={scale} />
      ) : (
        <p className="reg-msg" role="status">{MT.loading}</p>
      )}
    </div>
  )
}
