// StatusBar (UI_SPEC sections 2 and 8, SIGNAL .statusline): screen, link-group contexts, data window,
// TWS, the kill switch from GET /api/health, gate reads, READ ONLY, NO ORDER PATH and the ET clock.
// Props only: the caller passes the health query state, so this component never fetches.
// Values (screen number, data window, gate reads, clock) are <b> in the data colour, labels muted.
// The kill and health segments sit in one live region (assertive while the kill switch is on), so
// a change of safety state is announced; the clock stays outside it.
import { useEffect, useState, type ReactNode } from 'react'
import { screenNumber, type MnemonicCode } from '../commands/registry'
import type { HealthData } from '../commands/types'
import { STATUS_BAR } from '../copy/chrome'
import { LINK_GROUP_IDS, type LinkContexts } from './ContextStrip'
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
}

const CLOCK_TICK_MS = 1000

/** `template` with its `{value}` slot as a <b> value, e.g. "gate reads <b>7</b>". */
function labelled(template: string, value: string): ReactNode {
  const [before = '', after = ''] = template.split('{value}')
  return (
    <>
      {before}
      <b>{value}</b>
      {after}
    </>
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
  if (health.status === 'loading') return <span className="seg">{STATUS_BAR.killLoading}</span>
  if (health.status === 'error') {
    return (
      <span className="seg warn" title={STATUS_BAR.healthDownNote}>
        {STATUS_BAR.killUnknown}
      </span>
    )
  }
  if (health.data.kill_switch_on) {
    return (
      <span className="seg alert" title={STATUS_BAR.killOnNote}>
        {STATUS_BAR.killOn}
      </span>
    )
  }
  return <span className="seg">{STATUS_BAR.killOff}</span>
}

function SafetySegments({ health }: { readonly health: HealthState }) {
  const killOn = health.status === 'ok' && health.data.kill_switch_on
  return (
    <span className="seg-live" role="status" aria-live={killOn ? 'assertive' : 'polite'}>
      <KillSegment health={health} />
      {health.status === 'error' ? (
        <span className="seg warn">
          <span className="sr-only">. </span>
          {STATUS_BAR.healthDown}
        </span>
      ) : null}
    </span>
  )
}

export function StatusBar({ screen, contexts, health }: StatusBarProps) {
  const clock = useEtClock()
  const data = health.status === 'ok' ? health.data : null
  const range = data ? dataWindowValue(data.fence) : STATUS_BAR.dataFallbackValue
  return (
    <footer className="statusline status-bar" aria-label={STATUS_BAR.label}>
      <span className="seg">
        {`${STATUS_BAR.screenPrefix} `}
        <b>{screenNumber(screen)}</b>
        {` ${screen}`}
      </span>
      {LINK_GROUP_IDS.map((group) => {
        const value = contexts[group]?.value
        return (
          <span className="seg shrink ctx-seg" key={group} data-group={group} title={value}>
            <span className="grp">{group}</span>
            {` ${value ?? STATUS_BAR.empty}`}
          </span>
        )
      })}
      <span className="seg shrink">{labelled(STATUS_BAR.dataWindow, range)}</span>
      {data?.fixture_mode ? <span className="seg warn">{STATUS_BAR.fixture}</span> : null}
      <span className="seg">{STATUS_BAR.tws}</span>
      <SafetySegments health={health} />
      {data ? <span className="seg">{labelled(STATUS_BAR.gateReads, String(data.gate_reads_this_process))}</span> : null}
      <span className="seg safe">{STATUS_BAR.readOnly}</span>
      <span className="seg safe">{STATUS_BAR.noOrderPath}</span>
      <span className="seg push">
        <time>{labelled(STATUS_BAR.clock, clock)}</time>
      </span>
      <span className="seg">{STATUS_BAR.escHint}</span>
    </footer>
  )
}
