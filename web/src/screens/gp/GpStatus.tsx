// GP and GIP status text: the session flags line under the controls ([GATED], [REPAIRED], from
// `sessions` of /api/bars), the message that replaces the chart (refusal, error, loading, empty) and
// the footer with the basis, the gate's bookkeeping, the bucket, RV22's basis and the fills note.
import type { ApiError } from '../../api/client'
import { fillCopy } from '../../copy/workspace'
import { GP_COPY as C } from '../../copy/gp'
import type { SessionBadges } from './model'
import type { BarsData } from './useGpData'

const LISTED_DATES = 3

function Tag({ text }: { readonly text: string }) {
  return <span className="gp-tag">{`[${text}]`}</span>
}

function countText(n: number, one: string, many: string): string {
  return n === 1 ? one : fillCopy(many, { n })
}

function firstDates(dates: readonly string[]): string {
  return dates.length === 0 ? '' : ` (${fillCopy(C.firstDates, { dates: dates.slice(0, LISTED_DATES).join(', ') })})`
}

function WindowFlags({ badges }: { readonly badges: SessionBadges }) {
  if (badges.gated.length === 0 && badges.repaired.length === 0) return <span>{C.sessionsNone}</span>
  return (
    <>
      {badges.gated.length > 0 ? (
        <span className="gp-flag">
          <Tag text={C.gated} /> {countText(badges.gated.length, C.gatedOne, C.gatedCount)}{firstDates(badges.gated)}
        </span>
      ) : null}
      {badges.repaired.length > 0 ? (
        <span className="gp-flag">
          <Tag text={C.repaired} /> {countText(badges.repaired.length, C.repairedOne, C.repairedCount)}{firstDates(badges.repaired)}
        </span>
      ) : null}
    </>
  )
}

function DayFlag({ badges, date }: { readonly badges: SessionBadges; readonly date: string }) {
  if (badges.day === 'gated') return <span className="gp-flag"><Tag text={C.gated} /> {fillCopy(C.dayGated, { date })}</span>
  if (badges.day === 'repaired') return <span className="gp-flag"><Tag text={C.repaired} /> {fillCopy(C.dayRepaired, { date })}</span>
  return <span>{fillCopy(C.dayClean, { date })}</span>
}

export interface SessionLineProps {
  readonly badges: SessionBadges
  /** GIP: the date shown; GP: null. */
  readonly date: string | null
}

export function SessionLine({ badges, date }: SessionLineProps) {
  return (
    <div className="gp-sessions" role="group" aria-label={C.sessionsLabel}>
      {!badges.assessed ? <span>{C.notAssessed}</span> : date ? <DayFlag badges={badges} date={date} /> : <WindowFlags badges={badges} />}
      {badges.assessed && badges.source ? <span className="gp-muted">{fillCopy(C.sessionSource, { source: badges.source })}</span> : null}
    </div>
  )
}

export interface ChartMessageProps {
  readonly refusal: string | null
  readonly error: ApiError | null
  readonly text: string | null
  /** The bars are still on their way: the message is marked busy, so readers wait for the chart. */
  readonly busy?: boolean
}

/** Shown in the plot area instead of a chart: amber and centred (look spec 7.6). */
export function ChartMessage({ refusal, error, text, busy = false }: ChartMessageProps) {
  if (refusal) {
    return (
      <div className="gp-message" role="status">
        <p className="gp-message-head">{C.refusedHeading}</p>
        <p>{refusal}</p>
        <p className="gp-muted">{C.refusedLocal}</p>
      </div>
    )
  }
  if (error) {
    const gate = error.kind === 'http' && error.status === 403
    return (
      <div className="gp-message" role="alert">
        <p className="gp-message-head">{gate ? C.refusedServer : fillCopy(C.errorHeading, { status: error.status || error.kind })}</p>
        <p>{error.detail}</p>
      </div>
    )
  }
  return (
    <div className="gp-message" role="status" aria-busy={busy ? true : undefined}>
      <p>{text}</p>
    </div>
  )
}

export interface FooterProps {
  readonly bars: BarsData | undefined
  readonly tf: string
  readonly rvDate: string | null
  readonly notes: readonly string[]
}

export function GpFooter({ bars, tf, rvDate, notes }: FooterProps) {
  const gate = bars?.gate
  const parts: string[] = []
  if (bars) parts.push(fillCopy(C.basis, { label: bars.label, convention: bars.ts_convention }))
  if (gate) {
    parts.push(fillCopy(C.gate, {
      caller: gate.caller,
      years: gate.served_years.length > 0 ? gate.served_years.join(', ') : '--',
      cached: gate.cached ? C.cached : '',
      reads: gate.reads_this_process,
    }))
    parts.push(bars && bars.bucket !== tf ? fillCopy(C.bucketWidened, { bucket: bars.bucket, tf }) : fillCopy(C.bucket, { bucket: bars?.bucket ?? tf }))
  }
  if (bars) parts.push(rvDate ? fillCopy(C.rvBasis, { date: rvDate }) : C.rvMissing)
  // One wrapping paragraph keeps the footer to as few rows as the panel width allows.
  return (
    <p className="gp-footer">
      {[...parts, ...notes].map((part, i) => (
        <span key={part}>
          {i > 0 ? <span aria-hidden="true">{' | '}</span> : null}
          <span>{part}</span>
        </span>
      ))}
    </p>
  )
}
