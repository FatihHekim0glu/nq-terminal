// VCONE's small multiples: the 27 futures at one horizon, one tile each on one shared scale (0 to the rounded
// top of every max), so widths compare across contracts. A tile draws the min to max range, the 10th to 90th
// and 25th to 75th percentile boxes, the median tick and the latest value as a marker, with the latest and
// its rank in figures beside the ticker. The figure is one role="img" named by its summary, with a table view
// of the 27 rows (ChartA11y). Tiles are numbered 1) to 27) (Number <GO>): each opens that contract's cone.
import ChartA11y from '../../charts/ChartA11y'
import { requestLine } from '../../chrome/CommandLine.bus'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { VCONE } from '../../copy/vcone'
import { fillCopy } from '../../copy/workspace'
import { pct, rankText, type SmallView, type Tile } from './model'

const W = 200
const H = 16
const MID = H / 2
const BOX = { range: 2, outer: 6, inner: 10 } as const

function box(lo: number | null, hi: number | null, height: number, className: string) {
  if (lo === null || hi === null) return null
  return <rect className={className} x={lo * W} y={MID - height / 2} width={Math.max(1, (hi - lo) * W)} height={height} />
}

function Strip({ tile }: { readonly tile: Tile }) {
  const { x } = tile
  return (
    <svg className="vcone-strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {box(x.min, x.max, BOX.range, 'vcone-range')}
      {box(x.p10, x.p90, BOX.outer, 'vcone-outer')}
      {box(x.p25, x.p75, BOX.inner, 'vcone-inner')}
      {x.p50 !== null ? <line className="vcone-median" x1={x.p50 * W} x2={x.p50 * W} y1={1} y2={H - 1} /> : null}
      {x.latest !== null ? (
        <polygon className="vcone-marker" points={`${x.latest * W},1 ${x.latest * W + 4},${MID} ${x.latest * W},${H - 1} ${x.latest * W - 4},${MID}`} />
      ) : null}
    </svg>
  )
}

export interface SmallMultiplesProps {
  readonly panelId: string
  readonly view: SmallView
}

export default function SmallMultiples({ panelId, view }: SmallMultiplesProps) {
  useNumbered(panelId, 'vcone-tiles', view.tiles.map((t, i) => ({ n: i + 1, label: fillCopy(VCONE.tileOpen, { ticker: t.ticker }), run: () => requestLine(`${t.root} VCONE`) })))
  return (
    <ChartA11y label={view.label} table={view.table}>
      <ul className="vcone-tiles">
        {view.tiles.map((t, i) => (
          <li key={t.symbol} className="vcone-tile">
            <p className="vcone-tile-head">
              <span className="vcone-n">{`${i + 1})`}</span> <span className="vcone-ticker">{t.ticker}</span>{' '}
              <span className="vcone-tile-value">{pct(t.stats.latest)}</span>{' '}
              <span className="vcone-tile-rank">{`${rankText(t.stats.latest_rank)}`}</span>
            </p>
            <Strip tile={t} />
          </li>
        ))}
      </ul>
      <p className="vcone-scale">{fillCopy(VCONE.scaleNote, { max: view.scaleMax })}</p>
    </ChartA11y>
  )
}
