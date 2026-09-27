// One market's roll gaps in percent as bars on a time axis from 2010 to the fence (UI_SPEC 6: the dashed
// amber fence line labelled `IS | 2022+ SPENT` at the right end). Drawn as SVG inside ChartA11y, so the
// chart is role="img" named by its data summary and `T` (or the Table button) gives the same numbers as a
// table. Bars are up or down by sign; the sign is also in every number of the summary and the table.
import ChartA11y from '../../charts/ChartA11y'
import { ROLL } from '../../copy/roll'
import type { GapChart as GapChartInput } from './model'
import { formatPct } from './model'

const WIDTH = 1000
const HEIGHT = 200
const BAR_WIDTH = 4

function y(value: number, lo: number, hi: number): number {
  return hi === lo ? HEIGHT / 2 : ((hi - value) / (hi - lo)) * HEIGHT
}

export default function GapChart({ chart }: { readonly chart: GapChartInput }) {
  const { min, max } = chart
  const zero = y(0, min, max)
  return (
    <ChartA11y label={chart.label} table={chart.table}>
      <div className="roll-chart">
        <div className="roll-chart-scale" aria-hidden="true">
          <span>{formatPct(max)}</span>
          <span>{formatPct(min)}</span>
        </div>
        <svg className="roll-chart-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line className="roll-zero" x1={0} x2={WIDTH} y1={zero} y2={zero} />
          {chart.points.map((p) => {
            const top = y(Math.max(p.value, 0), min, max)
            const height = Math.max(1, Math.abs(y(p.value, min, max) - zero))
            return <rect key={p.date} className={p.value >= 0 ? 'roll-bar up' : 'roll-bar down'} x={p.x * WIDTH - BAR_WIDTH / 2} y={top} width={BAR_WIDTH} height={height} />
          })}
          <line className="roll-fence" x1={WIDTH - 1} x2={WIDTH - 1} y1={0} y2={HEIGHT} />
        </svg>
        <div className="roll-chart-axis" aria-hidden="true">
          <span>2010</span>
          <span className="roll-fence-label">{ROLL.fenceLabel}</span>
        </div>
      </div>
    </ChartA11y>
  )
}
