// EvidenceMap (94) Effect map, look spec 7.2, roadmap #5 slice 3): SV3a's served annual Sharpe against each
// trial's years (n / P) on the GlyphScatter kit, tagged [POST HOC] with its basis. Every mark is the trial's
// registry row number on 91) Board, so Number <GO> n opens that row's DES; nothing is ranked or scored. The chart
// sits in ChartA11y (its summary and T table view), and the axis rule, the pinned points, the lines off the axes
// and any trial without a row number are said in words under it. Colour comes from the chart kit's tokens only.
import { GlyphScatter } from '../../charts/echarts/GlyphScatter'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { EVIDENCE_MAP } from '../../copy/evidence'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import type { EvidenceMapView } from './evidenceMapModel'
import { openDes } from './open'
import './reg.css'
import './regViews.css'

const CHART_ID = 'reg-evidence-map'

export interface EvidenceMapProps {
  readonly panelId: string
  readonly map: EvidenceMapView
}

export default function EvidenceMap({ panelId, map }: EvidenceMapProps) {
  useNumbered(
    panelId,
    'reg-evidence-map',
    map.points.map((p) => ({ n: p.n, label: fillCopy(EVIDENCE_MAP.pointOpen, { name: p.name }), run: () => openDes(p.name) })),
  )
  return (
    <section className="reg-map" aria-label={EVIDENCE_MAP.label}>
      <p className="reg-band">
        <span className="reg-band-title">{EVIDENCE_MAP.label}</span> <span className="reg-tag">{SPEC.postHoc}</span>{' '}
        <span className="reg-muted">{EVIDENCE_MAP.basis}</span>
      </p>
      <p className="reg-msg reg-muted">{EVIDENCE_MAP.marks}</p>
      <p className="reg-msg reg-muted">{EVIDENCE_MAP.glyphs}</p>
      <div className="reg-map-chart">
        <GlyphScatter data={map.input} chartId={CHART_ID} />
      </div>
      {map.note === null ? null : <p className="reg-msg reg-muted">{map.note}</p>}
    </section>
  )
}
