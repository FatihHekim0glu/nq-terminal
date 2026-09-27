// LIVE: the paper book, read only (TASKS 7.3; UI_SPEC section 7 LIVE; look spec 7.11; ANALYTICS_CATALOG
// LV1 to LV3). GETs only, polled every LIVE_POLL_MS: /api/live/status, /performance and /journal.
//
//   red bar      96) Actions                                            Paper book (read only)
//   book strip   Contract MNQZ6  Last close ..  Target .. ct  Held .. ct  Exposure ..  ...  Halted ..
//   guard strip  KILL [off]  Delayed flag not set  VOLMAN_C ..  IB ..  TWS not monitored  Order path none
//   countdown    Decision 15:55:05 ET in ..  Order 15:59:30 ET in ..  Roll 2026-12-08 (MNQZ6) in .. days
//   tiles        mean exposure, sessions, plumbing rows dropped (Basis B, [POST HOC])
//   chart | recon  target against actual (performance rows only) | reconciliation table
//   routes       READ ONLY Routes (one per close row) and Fills, footer strip of totals (/api/live/routes)
//   journals     the journals under live/logs, expected files that are not written yet named
import { useMemo } from 'react'
import { useLiveStatus } from '../../api/queries'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { LIVE } from '../../copy/live'
import { fillCopy } from '../../copy/workspace'
import { actionsItem } from '../oos/panelMenu'
import Countdown from '../../tiles/Countdown'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import JournalsGrid from './JournalsGrid'
import { bookItems, exposureKpis, guardItems, type LiveStatus } from './liveModel'
import PerformancePanel from './PerformancePanel'
import RoutesPanel from './RoutesPanel'
import StateStrip from './StateStrip'
import './live.css'

const KPI_DECIMALS: Readonly<Record<string, number>> = { mean_exposure: 4, sessions: 0, plumbing_rows_skipped: 0 }
const KPI_DESCRIPTIONS: Readonly<Record<string, string>> = {
  mean_exposure: LIVE.kpiMeanExposureDesc,
  sessions: LIVE.kpiSessionsDesc,
  plumbing_rows_skipped: LIVE.kpiPlumbingDesc,
}

function Tiles({ status }: { readonly status: LiveStatus }) {
  const kpis = useMemo(() => exposureKpis(status), [status])
  if (kpis.length === 0) return null
  return (
    <KpiRow label={LIVE.kpiLabel}>
      {kpis.map((k) => (
        <KpiTile key={k.key} kpi={k} decimals={KPI_DECIMALS[k.key] ?? 2} description={KPI_DESCRIPTIONS[k.key]} />
      ))}
    </KpiRow>
  )
}

function Book({ status }: { readonly status: LiveStatus }) {
  const book = useMemo(() => bookItems(status), [status])
  const guards = useMemo(() => guardItems(status), [status])
  return (
    <>
      <div className="live-top">
        <StateStrip label={LIVE.stateLabel} items={book} />
        <StateStrip label={LIVE.guardLabel} items={guards} />
        <div className="live-times">
          <Countdown next={status.next} />
        </div>
        <p className="live-message live-basis">{LIVE.basisNote}</p>
        <Tiles status={status} />
        <PerformancePanel />
      </div>
      <RoutesPanel />
      <div className="live-journals">
        <JournalsGrid status={status} />
      </div>
    </>
  )
}

export default function LiveScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const query = useLiveStatus()
  return (
    <div className="live-screen">
      <FunctionBar
        panelId={actions.panelId}
        title={LIVE.title}
        items={[
          actionsItem(actions),
        ]}
      />
      {query.isError ? (
        <p className="live-message" role="alert">{fillCopy(LIVE.loadError, { detail: query.error.detail })}</p>
      ) : query.data ? (
        <Book status={query.data} />
      ) : (
        <p className="live-message">{LIVE.loading}</p>
      )}
    </div>
  )
}
