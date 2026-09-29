// StatusBar (spec 4.10, decision D7): the 22px house status line in the Suggested Functions style: an
// amber label, then segments of a bold white key and a value, divided by 1px rules.
//   Status | Screen HOME* | A NQ1 Index | B rebal_v0 | C - | DATA 2010-01-01..2021-12-31 | TWS not monitored
//          | KILL off | Gate reads 7 | READ ONLY | NO ORDER PATH | 14:02:11 ET | <Esc> command
// Two segments come from outside the health poll. When the connection state machine says the backend is
// down (roadmap 7), the amber HEALTH unavailable segment reads `API DOWN since 10:05:07 ET` instead. The
// research-record watch (roadmap 16) adds `WATCH no change` (or from now, N new, N changed) right after
// the context segments; it stays out of the way until the six record reads have settled.
// The safety segments (TWS, KILL, gate reads, READ ONLY, NO ORDER PATH) never shrink; contexts and
// the data window give way first. The kill and health segments sit in one live region (assertive
// while the kill switch is on), so a change of safety state is announced; the clock stays outside it.
// The `*` after the screen means the viewer has a saved layout for it (roadmap #6): aria-hidden, with
// the word `edited` after it for a screen reader.
// Props only: the caller passes the health query state, so this component never fetches.
import { useEffect, useState, type ReactNode } from 'react'
import type { MnemonicCode } from '../commands/registry'
import { displayContext } from '../commands/sectors'
import type { ConnectionState } from '../api/connection'
import type { CommandIndexData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'
import { LAYOUT } from '../copy/layout'
import { fillCopy } from '../copy/workspace'
import { LINK_GROUP_IDS, type LinkContexts } from './ContextStrip'
import { KeyText } from './MessageLine'
import { WatchSegment, type RecordWatchView } from './RecordWatch.view'
import { dataWindowValue, etClock, type HealthState } from './StatusBar.format'
import './StatusBar.css'

export type { HealthState }

export interface StatusBarProps {
  readonly screen: MnemonicCode
  /** The viewer has a saved layout for `screen`. */
  readonly edited?: boolean
  readonly contexts: LinkContexts
  readonly health: HealthState
  readonly index?: CommandIndexData | null
  /** The backend connection (roadmap 7): while it is down the health segment names the time it went quiet. */
  readonly connection?: Pick<ConnectionState, 'status' | 'downSince'>
  /** The research-record watch (roadmap 16): its segment follows the context segments. */
  readonly watch?: RecordWatchView
}

const CLOCK_TICK_MS = 1000

/** One segment: a bold key, then its value. `kind` sets how it lays out (see StatusBar.css). */
function Seg({ k, children, kind = 'keep', title }: { readonly k: string; readonly children: ReactNode; readonly kind?: 'keep' | 'shrink'; readonly title?: string }) {
  return (
    <span className={`seg ${kind}`} title={title}>
      <b>{k}</b> {children}
    </span>
  )
}

function useEtClock(): string {
  const [now, setNow] = useState(() => etClock(new Date()))
  useEffect(() => {
    const id = window.setInterval(() => setNow(etClock(new Date())), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function KillSegment({ health }: { readonly health: HealthState }) {
  if (health.status === 'loading') return <Seg k={STATUS_BAR.kill}>{STATUS_BAR.killLoading}</Seg>
  if (health.status === 'error') {
    return (
      <span className="seg keep warn" title={STATUS_BAR.healthDownNote}>
        <b>{STATUS_BAR.kill}</b> {STATUS_BAR.killUnknown}
      </span>
    )
  }
  if (!health.data.kill_switch_on) return <Seg k={STATUS_BAR.kill}>{STATUS_BAR.killOff}</Seg>
  return (
    <span className="seg keep alert" title={STATUS_BAR.killOnNote}>
      <b>{STATUS_BAR.kill}</b> {STATUS_BAR.killOn}
    </span>
  )
}

/** The amber words beside a failed health poll: the time the backend went quiet once it is down, else HEALTH unavailable. */
function healthDownText(connection: StatusBarProps['connection']): string {
  if (connection?.status === 'down' && connection.downSince !== null) return fillCopy(STATUS_BAR.apiDown, { value: etClock(new Date(connection.downSince)) })
  return STATUS_BAR.healthDown
}

function SafetySegments({ health, connection }: { readonly health: HealthState; readonly connection: StatusBarProps['connection'] }) {
  const killOn = health.status === 'ok' && health.data.kill_switch_on
  return (
    <span className="seg-live" role="status" aria-live={killOn ? 'assertive' : 'polite'}>
      <KillSegment health={health} />
      {health.status === 'error' ? (
        <span className="seg keep warn">
          <span className="sr-only">. </span>
          {healthDownText(connection)}
        </span>
      ) : null}
    </span>
  )
}

function ContextSegments({ contexts, index }: { readonly contexts: LinkContexts; readonly index: CommandIndexData | null }) {
  return LINK_GROUP_IDS.map((group) => {
    const context = contexts[group]
    return (
      <Seg key={group} k={group} kind="shrink" title={context?.value}>
        {context ? displayContext(context, index) : STATUS_BAR.empty}
      </Seg>
    )
  })
}

export function StatusBar({ screen, edited, contexts, health, index = null, connection, watch }: StatusBarProps) {
  const clock = useEtClock()
  const data = health.status === 'ok' ? health.data : null
  const range = data ? dataWindowValue(data.fence) : STATUS_BAR.dataFallbackValue
  return (
    <footer className="nqt-status status-bar" aria-label={STATUS_BAR.label} data-chrome="status">
      <span className="status-label">{STATUS_BAR.lead}</span>
      <Seg k={STATUS_BAR.screen}>
        {screen}
        {edited ? (
          <>
            <span aria-hidden="true">{LAYOUT.editedMark}</span> <span className="sr-only">{LAYOUT.editedLabel}</span>
          </>
        ) : null}
      </Seg>
      <ContextSegments contexts={contexts} index={index} />
      {watch ? <WatchSegment view={watch} /> : null}
      <Seg k={STATUS_BAR.data} kind="shrink">{range}</Seg>
      {data?.fixture_mode ? <span className="seg keep warn">{STATUS_BAR.fixture}</span> : null}
      <Seg k={STATUS_BAR.tws}>{STATUS_BAR.twsValue}</Seg>
      <SafetySegments health={health} connection={connection} />
      <Seg k={STATUS_BAR.gateReads}>{data ? String(data.gate_reads_this_process) : STATUS_BAR.missing}</Seg>
      <span className="seg keep flag">{STATUS_BAR.readOnly}</span>
      <span className="seg keep flag">{STATUS_BAR.noOrderPath}</span>
      <span className="seg keep push small">
        <time>{STATUS_BAR.clock.replace('{value}', clock)}</time>
      </span>
      <span className="seg keep small">
        <KeyText text={`${STATUS_BAR.escKey} ${STATUS_BAR.escHint}`} />
      </span>
    </footer>
  )
}
