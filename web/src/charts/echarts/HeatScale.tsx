// The legend under a Heatmap (look spec 7.5 and 7.8): the CORR steps between -1.00 and +1.00, the MON
// steps with their names, or the MRET ramp labelled min at the left and max at the right. Fills come
// from heatScale() (the tokens and scales.ts). It sits inside the chart's role="img", so it is
// presentational; the summary and the table view carry the numbers.
import type { CSSProperties } from 'react'
import type { HeatScale } from './heatmapModel'

function rampStyle(stops: readonly { readonly at: number; readonly fill: string }[]): CSSProperties {
  const parts = stops.map((s) => `${s.fill} ${(s.at * 100).toFixed(2)}%`)
  return { background: `linear-gradient(to right, ${parts.join(', ')})` }
}

export function HeatScaleBar({ scale }: { readonly scale: HeatScale }) {
  if (scale.kind === 'none') return null
  if (scale.kind === 'ramp') {
    return (
      <div className="echarts-scale">
        <span className="echarts-scale-end">{scale.low}</span>
        <span className="echarts-scale-ramp" style={rampStyle(scale.stops)} />
        <span className="echarts-scale-end">{scale.high}</span>
      </div>
    )
  }
  if (scale.low === undefined) {
    return (
      <div className="echarts-scale">
        {scale.steps.map((s) => (
          <span key={s.label} className="echarts-scale-named">
            <span className="echarts-scale-step" style={{ background: s.fill }} />
            {s.label}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="echarts-scale">
      <span className="echarts-scale-end">{scale.low}</span>
      <span className="echarts-scale-steps">
        {scale.steps.map((s) => (
          <span key={s.label} className="echarts-scale-step" style={{ background: s.fill }} />
        ))}
      </span>
      <span className="echarts-scale-end">{scale.high}</span>
    </div>
  )
}
