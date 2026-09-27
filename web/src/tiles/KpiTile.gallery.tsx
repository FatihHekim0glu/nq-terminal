// Gallery entry /__gallery/KpiTile (TASKS 5.4): the tear sheet's KPI row (look spec 7.5) with
// fixture figures of the volmanaged_v0 kind: a missing MinTRL with its note, a Sharpe with an
// interval, a Basis A alpha among Basis B account figures. Each tile opens its basis and unit.
import { TILE_GALLERY as T } from '../copy/tiles'
import { KPI_FIXTURES } from './gallery.fixtures'
import KpiTile, { KpiRow } from './KpiTile'
import './tiles.gallery.css'

export default function KpiTileGallery() {
  return (
    <section className="tile-gallery" aria-labelledby="kpi-title">
      <h2 id="kpi-title">{T.kpiTitle}</h2>
      <KpiRow>
        {KPI_FIXTURES.map((f) => (
          <KpiTile key={f.kpi.key} kpi={f.kpi} decimals={f.decimals} signed={f.signed} description={f.description} ci={f.ci} />
        ))}
      </KpiRow>
    </section>
  )
}
