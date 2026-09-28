// The DQ calendar heatmap (ANALYTICS RI4): one block per year, a column per week and a row per weekday, each
// session a square filled by its state (dq.css tokens) and marked with its state letter, so colour is never the
// only cue (WCAG 1.4.1). Drawn as SVG inside ChartA11y: the figure is role="img" named by the data summary, T or
// the Table button gives sessions per year and state as a real table, and hovering a square shows its date, state
// and reason in the readout (and in the square's own title). The keyboard walks the same readout (keyStep: arrows one
// session, Page Up and Page Down one week, Home and End), and the day it reads is outlined like a hovered one. The
// selected day (from the flagged grid) is outlined too.
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import ChartA11y from '../../charts/ChartA11y'
import { DQ } from '../../copy/dq'
import { calendarLayout, cellTitle, heatSummary, keyStep, stateLetter, yearTable } from './model'
import type { DqCounts, DqDay } from './types'

const CELL = 13
const GAP = 2
const STEP = CELL + GAP
const LABEL_W = 44
const WEEKS = 54
const ROWS = 5
const BLOCK_GAP = 6
const BLOCK_H = ROWS * STEP + BLOCK_GAP

export interface CalendarHeatmapProps {
  readonly symbol: string
  readonly days: readonly DqDay[]
  readonly counts: DqCounts
  readonly fence: string
  readonly selected: string | null
}

export default function CalendarHeatmap({ symbol, days, counts, fence, selected }: CalendarHeatmapProps) {
  const years = useMemo(() => calendarLayout(days, fence), [days, fence])
  const table = useMemo(() => yearTable(symbol, days), [symbol, days])
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const dates = useMemo(() => years.flatMap((y) => y.cells.map((c) => c.day.date)).sort(), [years])
  const [hover, setHover] = useState<DqDay | null>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const next = keyStep(dates, hover?.date ?? null, event.key)
    // D36: at an edge (next === null), an arrow key held down (auto-repeat) is swallowed instead of
    // handed back to the panel every time, or holding it walks focus on through the panel's other
    // controls once the first repeat hands focus off. A fresh press still hands it back.
    if (next === null) {
      if (event.repeat && event.key.startsWith('Arrow')) event.preventDefault()
      return
    }
    event.preventDefault()
    setHover(byDate.get(next) ?? null)
  }
  const width = LABEL_W + WEEKS * STEP
  const height = Math.max(1, years.length * BLOCK_H)
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const date = (event.target as Element).closest('[data-date]')?.getAttribute('data-date')
    setHover(date ? (byDate.get(date) ?? null) : null)
  }
  return (
    <ChartA11y label={heatSummary(symbol, days, counts)} table={table} readout={hover ? cellTitle(hover) : ''} onKeyDown={onKeyDown}>
      <svg className="dq-cal" viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="xMinYMin" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {years.map((y, i) => (
          <g key={y.year} transform={`translate(0 ${i * BLOCK_H})`}>
            <text className="dq-cal-year" x={LABEL_W - 6} y={ROWS * STEP / 2} textAnchor="end" dominantBaseline="middle">{y.year}</text>
            {y.cells.map((c) => {
              const letter = stateLetter(c.day.state)
              const x = LABEL_W + c.col * STEP
              const yy = c.row * STEP
              return (
                <g key={c.day.date} data-date={c.day.date} className={`dq-cell dq-${c.day.state}${c.day.date === selected ? ' dq-selected' : ''}${c.day.date === hover?.date ? ' dq-hover' : ''}`}>
                  <title>{cellTitle(c.day)}</title>
                  <rect x={x} y={yy} width={CELL} height={CELL} />
                  {letter ? <text x={x + CELL / 2} y={yy + CELL / 2} textAnchor="middle" dominantBaseline="central">{letter}</text> : null}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </ChartA11y>
  )
}

export function Legend({ counts }: { readonly counts: DqCounts }) {
  const states = ['vendor', 'gated_out', 'rejected', 'rebuilt', 'unrepairable'] as const
  return (
    <ul className="dq-legend" aria-label={DQ.legendLabel}>
      {states.map((s) => (
        <li key={s} title={DQ.stateHelp[s]}>
          <span className={`dq-swatch dq-${s}`} aria-hidden="true">{stateLetter(s)}</span>
          <span>{`${DQ.states[s]} ${counts[s].toLocaleString('en-GB')}`}</span>
          <span className="sr-only">{`: ${DQ.stateHelp[s]}`}</span>
        </li>
      ))}
    </ul>
  )
}
