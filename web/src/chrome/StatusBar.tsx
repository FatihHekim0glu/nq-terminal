// StatusBar (spec 4.10, decision D7): the 22px house status line in the Suggested Functions style: an
// amber label, then segments of a bold white key and a value, divided by 1px rules.
//   Status | Screen HOME | A NQ1 Index | B rebal_v0 | C - | DATA 2010-01-01..2021-12-31 | TWS not monitored
//          | KILL off | Gate reads 7 | READ ONLY | NO ORDER PATH | 14:02:11 ET | <Esc> command
// The safety segments (TWS, KILL, gate reads, READ ONLY, NO ORDER PATH) never shrink; contexts and
// the data window give way first. The kill and health segments sit in one live region (assertive
// while the kill switch is on), so a change of safety state is announced; the clock stays outside it.
// Props only: the caller passes the health query state, so this component never fetches.
import { useEffect, useState, type ReactNode } from 'react'
import type { MnemonicCode } from '../commands/registry'
import { displayContext } from '../commands/sectors'
import type { CommandIndexData, HealthData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'
import { LINK_GROUP_IDS, type LinkContexts } from './ContextStrip'
import { KeyText } from './MessageLine'
import { dataWindowValue, etClock } from './StatusBar.format'
import './StatusBar.css'

export type HealthState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ok'; readonly data: HealthData }

export interface StatusBarProps {
  readonly screen: MnemonicCode
  readonly contexts: LinkContexts
  readonly health: HealthState
  readonly index?: CommandIndexData | null
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

function SafetySegments({ health }: { readonly health: HealthState }) {
  const killOn = health.status === 'ok' && health.data.kill_switch_on
  return (
    <span className="seg-live" role="status" aria-live={killOn ? 'assertive' : 'polite'}>
      <KillSegment health={health} />
      {health.status === 'error' ? (
        <span className="seg keep warn">
          <span className="sr-only">. </span>
          {STATUS_BAR.healthDown}
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

export function StatusBar({ screen, contexts, health, index = null }: StatusBarProps) {
  const clock = useEtClock()
  const data = health.status === 'ok' ? health.data : null
  const range = data ? dataWindowValue(data.fence) : STATUS_BAR.dataFallbackValue
  return (
    <footer className="nqt-status status-bar" aria-label={STATUS_BAR.label} data-chrome="status">
      <span className="status-label">{STATUS_BAR.lead}</span>
      <Seg k={STATUS_BAR.screen}>{screen}</Seg>
      <ContextSegments contexts={contexts} index={index} />
      <Seg k={STATUS_BAR.data} kind="shrink">{range}</Seg>
      {data?.fixture_mode ? <span className="seg keep warn">{STATUS_BAR.fixture}</span> : null}
      <Seg k={STATUS_BAR.tws}>{STATUS_BAR.twsValue}</Seg>
      <SafetySegments health={health} />
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
