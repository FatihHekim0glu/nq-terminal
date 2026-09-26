// The two-line security header of instrument panels (look spec 4.6), and its hypothesis form.
// Line 1: ticker in white; the tick arrow coloured by the last tick; the last price coloured by the
// sign of the day change (separate spans); change and % change in up/down colours; a 60 by 14
// sparkline. Line 2: amber labels with white values; a `d` flag after the time means served,
// delayed, in-sample. No tick flash. Inside a panel it renders into the panel's quote slot, above the
// red bar, the slot the reference terminal gives it in place of the command zone.
import { QUOTE, fillCopy } from '../copy/workspace'
import { useSlot } from './PanelChrome.slots'
import { formatPercent, formatPercentChange, formatPrice, formatSignedChange, formatThousands } from './QuoteHeader.format'
import './QuoteHeader.css'

export type Direction = 'up' | 'down'

export interface QuoteData {
  /** As displayed, e.g. "NQ1 Index". */
  readonly ticker: string
  /** The instrument root, for the price format (32nds for Treasuries). */
  readonly root: string
  readonly last: number | null
  readonly change: number | null
  /** Percent, e.g. 0.23 for +0.23%. */
  readonly changePct: number | null
  readonly lastTick: Direction | null
  /** ET time, ISO date: "2021-12-31 16:00". */
  readonly time: string | null
  readonly delayed: boolean
  readonly volume: number | null
  readonly open: number | null
  readonly high: number | null
  readonly low: number | null
  /** Realised volatility over 22 sessions, percent. */
  readonly rv22: number | null
  readonly spark: readonly number[]
  readonly decimals?: number
}

const SPARK_W = 60
const SPARK_H = 14

function signClass(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'up' : 'down'
}

function sparkPoints(values: readonly number[]): string {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 2) return ''
  const lo = Math.min(...finite)
  const span = Math.max(...finite) - lo || 1
  const step = SPARK_W / (finite.length - 1)
  return finite.map((v, i) => `${(i * step).toFixed(1)},${(SPARK_H - 1 - ((v - lo) / span) * (SPARK_H - 2)).toFixed(1)}`).join(' ')
}

function Spark({ values }: { readonly values: readonly number[] }) {
  const points = sparkPoints(values)
  return (
    <svg className="quote-spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true" focusable="false">
      {points ? <polyline points={points} fill="none" /> : null}
    </svg>
  )
}

function Pair({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="quote-pair">
      <span className="quote-label">{label}</span> <span className="quote-value">{value}</span>
    </span>
  )
}

export default function QuoteHeader({ quote }: { readonly quote: QuoteData }) {
  const place = useSlot('quote')
  const d = quote.decimals ?? 2
  const price = (v: number | null) => formatPrice(quote.root, v, d)
  const dayClass = signClass(quote.change)
  return place(
    <div className="quote" role="group" aria-label={fillCopy(QUOTE.label, { ticker: quote.ticker })}>
      <div className="quote-line">
        <span className="quote-ticker">{quote.ticker}</span>
        {quote.lastTick ? (
          <span className="quote-tick">
            <span className={`quote-arrow ${quote.lastTick}`} aria-hidden="true">{quote.lastTick === 'up' ? '↑' : '↓'}</span>
            <span className="sr-only">{quote.lastTick === 'up' ? QUOTE.tickUp : QUOTE.tickDown}</span>
          </span>
        ) : null}
        <span className={`quote-last ${dayClass}`}>{price(quote.last)}</span>
        <span className={dayClass}>{formatSignedChange(quote.change, d)}</span>
        <span className={signClass(quote.changePct)}>{formatPercentChange(quote.changePct, 2)}</span>
        <Spark values={quote.spark} />
      </div>
      <div className="quote-line">
        <span className="quote-pair">
          <span className="quote-label">{QUOTE.at}</span> <span className="quote-value">{quote.time ?? '--'}</span>
          {quote.delayed ? (
            <>
              {' '}
              <span className="quote-flag" title={QUOTE.delayedLabel}>{QUOTE.delayed}</span>
              <span className="sr-only">{QUOTE.delayedLabel}</span>
            </>
          ) : null}
        </span>
        <Pair label={QUOTE.vol} value={formatThousands(quote.volume)} />
        <Pair label={QUOTE.open} value={price(quote.open)} />
        <Pair label={QUOTE.high} value={price(quote.high)} />
        <Pair label={QUOTE.low} value={price(quote.low)} />
        <Pair label={QUOTE.rv} value={formatPercent(quote.rv22, 1)} />
      </div>
    </div>,
  )
}

export interface HypothesisHeaderProps {
  readonly name: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly t: number | null
  readonly p: number | null
  readonly round: number | null
}

/** Line 1 for a hypothesis context: `rebal_v0  [FAIL]  t 1.13  p 0.13  round 4`. */
export function HypothesisHeader({ name, verdict, t, p, round }: HypothesisHeaderProps) {
  const place = useSlot('quote')
  const two = (v: number | null) => (v === null ? '--' : formatSignedChange(v, 2).replace(/^\+/, ''))
  return place(
    <div className="quote" role="group" aria-label={fillCopy(QUOTE.label, { ticker: name })}>
      <div className="quote-line">
        <span className="quote-ticker">{name}</span>
        <span className={verdict === 'PASS' ? 'up' : 'down'}>{`[${verdict}]`}</span>
        <span className="quote-value">{`${QUOTE.t} ${two(t)}`}</span>
        <span className="quote-value">{`${QUOTE.p} ${two(p)}`}</span>
        <span className="quote-value">{`${QUOTE.round} ${round ?? '--'}`}</span>
      </div>
    </div>,
  )
}

